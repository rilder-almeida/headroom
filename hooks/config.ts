import type { Action, Level } from '../types'

/** Both ladders and the reset-timer threshold, as configured. */
export type Ladders = {
  context: readonly Level[]
  pace: readonly Level[]
  wakeAt: number
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

/** Builds both ladders from the mod's userConfig values, defaults filled in. */
export const ladders = (options: Record<string, unknown>): Ladders => ({
  context: ladder('context', options),
  pace: ladder('pace', options),
  wakeAt: number(options.wake_at, DEFAULT_WAKE_AT),
})
