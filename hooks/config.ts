import type { Action, Level, Tuning } from '../types'

export type { Tuning }

/** Both ladders, the reset-timer threshold, the burst symbol and the tuning numbers, as configured. */
export type Ladders = {
  context: readonly Level[]
  pace: readonly Level[]
  wakeAt: number
  symbol: string
  tuning: Tuning
}

const ACTIONS: readonly Action[] = ['none', 'alert', 'ask', 'block']

const DEFAULTS: { context: readonly Level[]; pace: readonly Level[] } = {
  context: [
    { name: 'warm', at: 45, action: 'alert' },
    { name: 'hot', at: 65, action: 'alert' },
    { name: 'full', at: 75, action: 'ask' },
  ],
  pace: [
    { name: 'warm', at: 20, action: 'alert' },
    { name: 'hot', at: 50, action: 'ask' },
    { name: 'over', at: 100, action: 'ask' },
  ],
}

const DEFAULT_WAKE_AT = 75

const DEFAULT_SYMBOL = '\u{F0238}'

const number = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const action = (value: unknown, fallback: Action): Action =>
  ACTIONS.find(one => one === value) ?? fallback

const ladder = (
  name: 'context' | 'pace',
  options: Record<string, unknown>,
): Level[] => {
  const levels = DEFAULTS[name].map(level => ({
    name: level.name,
    at: number(options[`${name}_${level.name}_at`], level.at),
    action: action(options[`${name}_${level.name}_action`], level.action),
  }))

  levels.forEach((level, i) => {
    const before = levels[i - 1]

    if (before !== undefined && level.at <= before.at) {
      throw new Error(
        `headroom: ${name}_${before.name}_at (${before.at}) must be below ${name}_${level.name}_at (${level.at})`,
      )
    }
  })

  return levels
}

const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

type Knob = { key: string; fallback: number; unit: number; min: number; isWhole?: boolean }

const KNOBS = {
  burstFactor: { key: 'burst_factor', fallback: 3, unit: 1, min: 1 },
  releaseFactor: { key: 'burst_release_factor', fallback: 2, unit: 1, min: 0 },
  lookback5h: { key: 'burst_5h_minutes', fallback: 20, unit: MINUTE, min: 1 },
  lookback7d: { key: 'burst_7d_hours', fallback: 3, unit: HOUR, min: 1 },
  contextCalls: { key: 'burst_context_calls', fallback: 5, unit: 1, min: 1, isWhole: true },
  contextRise: { key: 'burst_context_points', fallback: 10, unit: 1, min: 1 },
  contextRelease: { key: 'burst_context_release_points', fallback: 5, unit: 1, min: 0 },
  halfLife5h: { key: 'forecast_5h_half_life_minutes', fallback: 60, unit: MINUTE, min: 1 },
  halfLife7d: { key: 'forecast_7d_half_life_hours', fallback: 24, unit: HOUR, min: 1 },
  contextMargin: { key: 'context_margin', fallback: 0, unit: 1, min: 0 },
  margin5h: { key: 'pace_5h_margin', fallback: 10, unit: 1, min: 0 },
  margin7d: { key: 'pace_7d_margin', fallback: 5, unit: 1, min: 0 },
  jitter: { key: 'reset_jitter_minutes', fallback: 5, unit: MINUTE, min: 0 },
  warmup: { key: 'pace_warmup_percent', fallback: 10, unit: 0.01, min: 0 },
  wakeDelay: { key: 'wake_delay_seconds', fallback: 60, unit: SECOND, min: 0 },
} as const satisfies Record<string, Knob>

const knob = (options: Record<string, unknown>, spec: Knob): number => {
  const value = number(options[spec.key], spec.fallback)

  if (value < spec.min || (spec.isWhole === true && !Number.isInteger(value))) {
    throw new Error(`headroom: ${spec.key} (${value}) must be ${spec.isWhole === true ? 'a whole number ' : ''}at least ${spec.min}`)
  }

  return value * spec.unit
}

const tuning = (options: Record<string, unknown>): Tuning => {
  const warmup = knob(options, KNOBS.warmup)

  if (warmup >= 1) {
    throw new Error(`headroom: pace_warmup_percent (${warmup * 100}) must be below 100`)
  }

  const below = (low: Knob, high: Knob) => {
    if (knob(options, low) > knob(options, high)) {
      throw new Error(`headroom: ${low.key} (${knob(options, low)}) must not exceed ${high.key} (${knob(options, high)})`)
    }
  }

  below(KNOBS.releaseFactor, KNOBS.burstFactor)
  below(KNOBS.contextRelease, KNOBS.contextRise)

  return {
    burstFactor: knob(options, KNOBS.burstFactor),
    releaseFactor: knob(options, KNOBS.releaseFactor),
    lookback: { five_hour: knob(options, KNOBS.lookback5h), seven_day: knob(options, KNOBS.lookback7d) },
    contextCalls: knob(options, KNOBS.contextCalls),
    contextRise: knob(options, KNOBS.contextRise),
    contextRelease: knob(options, KNOBS.contextRelease),
    halfLife: { five_hour: knob(options, KNOBS.halfLife5h), seven_day: knob(options, KNOBS.halfLife7d) },
    margin: {
      context: knob(options, KNOBS.contextMargin),
      five_hour: knob(options, KNOBS.margin5h),
      seven_day: knob(options, KNOBS.margin7d),
    },
    jitter: knob(options, KNOBS.jitter),
    warmup,
    wakeDelay: knob(options, KNOBS.wakeDelay),
  }
}

/** Builds the configuration from the mod's userConfig values, defaults filled in. */
export const ladders = (options: Record<string, unknown>): Ladders => ({
  context: ladder('context', options),
  pace: ladder('pace', options),
  wakeAt: number(options.wake_at, DEFAULT_WAKE_AT),
  tuning: tuning(options),
  symbol: typeof options.burst_symbol === 'string' && options.burst_symbol.trim() !== '' ? options.burst_symbol.trim() : DEFAULT_SYMBOL,
})
