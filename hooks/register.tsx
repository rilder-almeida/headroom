import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Active, Forecasts, Grant, Held, Hit, Latches, Reading, Samples } from '../types'
import { DARK, contextRise, contextRule, follow, isKept, isSamples, keepOf, latch, lookbackOf, record, span, usageRate, usageRule } from './burst'
import { compact, full } from './band'
import type { BandInput, Span } from './band'
import { ladders } from './config'
import type { Ladders, Tuning } from './config'
import { isForecast, runOut, step } from './forecast'
import { summary } from './summary'
import {
  atLeast,
  contextHit,
  effective,
  line,
  paceHit,
  paceOf,
  rangeOf,
  sameGate,
  sameLevels,
  stageOf,
  windowHit,
  windowOf,
} from './levels'
import type { Limit } from './levels'

const NOTHING: Active = { context: null, pace: null }

const levels = atom({ plugin: 'headroom', key: 'levels' } as const, NOTHING, { shape: 'levels-2' })
const pending = atom({ plugin: 'headroom', key: 'pending' } as const, null)
const armedFor = atom({ plugin: 'headroom', key: 'armedFor' } as const, null as string | null)
const grant = atom({ plugin: 'headroom', key: 'grant' } as const, 'pending' as Grant, { shape: 'grant-2' })
const reading = atom({ plugin: 'headroom', key: 'reading' } as const, null as Reading | null)
const forecast = atom({ plugin: 'headroom', key: 'forecast' } as const, {} as Forecasts)
const details = atom({ plugin: 'headroom', key: 'details' } as const, false)
const samples = atom({ plugin: 'headroom', key: 'samples' } as const, {} as Samples)
const trail = atom({ plugin: 'headroom', key: 'trail' } as const, [] as number[])
const latches = atom({ plugin: 'headroom', key: 'latches' } as const, {} as Latches)
const calls = atom({ plugin: 'headroom', key: 'calls' } as const, 0)
const held = atom({ plugin: 'headroom', key: 'held' } as const, {} as Held)

const offset = (ms: number): number => new Date(ms).getTimezoneOffset()

const KIND = { '5h': 'five_hour', '7d': 'seven_day' } as const

/** The run-out text for the window a pace hit came from. */
const outOf = (hit: Hit, at: Context): string | undefined => {
  if (hit.ladder !== 'pace') {
    return undefined
  }

  const kind = KIND[hit.window]
  const limit = at.limits.find(one => one.kind === kind)
  const out = limit === undefined ? '·' : runOut(at.stored[kind], limit, at.now, at.tuning)

  return out === '·' ? undefined : out
}

type Context = { limits: readonly Limit[]; stored: Forecasts; now: number; tuning: Tuning }

const loud = (active: Active, at: Context): string =>
  [active.context, active.pace]
    .filter((hit): hit is Hit => hit !== null && atLeast(hit.level.action, 'alert'))
    .map(hit => line(hit, outOf(hit, at)))
    .join('\n')

const pct = (value: number): string => `${value}%`.padEnd(5)

const standing = (name: string, value: number, ladder: Ladders['context']): string =>
  `${name} ${rangeOf(value, ladder)}`

const window = (usage: Limit, band: BandInput): string => {
  const { now, config, stored } = band
  const name = windowOf(usage.kind)?.label ?? usage.kind
  const reset = usage.resetsAt === undefined ? NaN : Date.parse(usage.resetsAt)

  if (reset <= now) {
    return `${name} reset, no reading since`
  }

  const pace = paceOf(usage, now, config.tuning.warmup)
  const head = `${name.padEnd(9)}${pct(usage.percentUsed)}`
  const out = `out ${runOut(stored[usage.kind], usage, now, config.tuning)}`

  if (pace === null) {
    return `${head}${'pace n/a'.padEnd(11)}${''.padEnd(17)}${out}`
  }

  const level = windowHit(usage, now, config.pace, band.held, config.tuning)?.level.name ?? 'ok'
  const speed = `pace ${pace.value > 0 ? '+' : ''}${pace.value}%`

  return `${head}${speed.padEnd(11)}${standing(level, pace.value, config.pace).padEnd(17)}${out}`
}

const report = (usage: SessionUsage, band: BandInput): string => {
  const { config } = band
  const percent = usage.context.percent
  const lines = [
    percent === undefined
      ? 'context n/a'
      : `${'context'.padEnd(9)}${pct(percent)}${standing(contextHit(percent, config.context, band.held, config.tuning)?.level.name ?? 'ok', percent, config.context)}`,
  ]

  if (usage.rateLimits.length === 0) {
    lines.push('no rate-limit windows (no subscription)')
  }

  const footer = summary(band)

  return [...lines, ...usage.rateLimits.map(limit => window(limit, band)), ...(footer === '' ? [] : ['', footer])].join('\n')
}

const STORE_KEY = 'forecast'
const SAMPLES_KEY = 'samples'
const KEPT_KEY = 'burst'

let saved = ''

const bandOf = async ($: EngineInterface, config: Ladders, last: Reading | null): Promise<BandInput> => ({
  reading: last,
  stored: await read($, forecast),
  samples: await read($, samples),
  trail: await read($, trail),
  latches: await read($, latches),
  held: await read($, held),
  config,
  now: await $.clock.now(),
  offset,
})

const readingOf = (usage: Pick<SessionUsage, 'context' | 'rateLimits'>): Reading => ({
  context: usage.context.percent,
  rateLimits: [...usage.rateLimits],
})

const loadSamples = async ($: EngineInterface): Promise<Samples> => {
  const value = await $.store.get(SAMPLES_KEY)

  if (value === undefined) {
    return {}
  }

  if (!isSamples(value)) {
    $.ui.log(`headroom: its stored burst samples are unreadable: ${JSON.stringify(value)}`, { to: 'debug' })

    return {}
  }

  return value
}

const usageLine = (kind: string, rate: number, tuning: Tuning): string =>
  `headroom: ${windowOf(kind)?.label ?? kind} burst, ${Math.round(rate * 3_600_000)}% per hour over the last ${span(lookbackOf(kind, tuning) ?? 0)}`

const contextLine = (rise: number, count: number): string =>
  `headroom: context burst, up ${rise}% in the last ${count} tool call${count === 1 ? '' : 's'}`

const loadForecasts = async ($: EngineInterface): Promise<Forecasts> => {
  const value = await $.store.get(STORE_KEY)

  if (value === undefined) {
    return {}
  }

  const entries = typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.entries(value) : null

  if (entries === null || !entries.every(([, one]) => isForecast(one))) {
    $.ui.log(`headroom: its stored forecast is unreadable: ${JSON.stringify(value)}`, { to: 'debug' })

    return {}
  }

  return Object.fromEntries(entries)
}

let timer: { cancel: () => void } | null = null

const wake = async ($: EngineInterface, config: Ladders) => {
  timer = null
  await update($, armedFor, () => null)

  const usage = await $.session.usage()
  const fresh = report(usage, await bandOf($, config, readingOf(usage)))

  await $.prompt.submit({ text: `headroom: the 5h window reset. Fresh reading:\n${fresh}` })
}

const arm = async ($: EngineInterface, config: Ladders, resetsAt: string) => {
  const wait = Date.parse(resetsAt) + config.tuning.wakeDelay - (await $.clock.now())

  timer?.cancel()
  await update($, armedFor, () => resetsAt)
  timer = $.clock.after(Math.max(0, wait), () => {
    wake($, config).catch((error: unknown) => {
      $.ui.log(`headroom: wake failed: ${String(error)}`, { to: 'debug' })
    })
  })
}

type Live = { active: Active; grant: Grant; epoch: number }

let live: Live | null = null
let loading: Promise<Live> | null = null

const load = async ($: EngineInterface): Promise<Live> => {
  live = { active: await read($, levels), grant: await read($, grant), epoch: 0 }

  return live
}

const current = ($: EngineInterface) => {
  loading ??= load($)

  return loading
}

const actionOf = (state: Live) =>
  state.grant === 'blocked' ? 'block' : effective(state.active)

const isGating = ($: EngineInterface, state: Live | null): boolean => {
  try {
    return state !== null && actionOf(state) === 'block'
  } catch (error) {
    $.ui.log(`headroom: its stored levels are unreadable: ${String(error)}`, { to: 'debug' })

    return false
  }
}

const answerOf = (answer: string): Grant | null =>
  answer === 'Continue' ? 'granted' : answer === 'Block' ? 'blocked' : null

const measure = async (
  $: EngineInterface,
  config: Ladders,
  e: Pick<SessionUsage, 'context' | 'rateLimits'>,
  isToolCall = false,
) => {
  const now = await $.clock.now()
  const previous = await read($, held)
  const active: Active = {
    context: contextHit(e.context.percent, config.context, previous, config.tuning),
    pace: paceHit(e.rateLimits, now, config.pace, previous, config.tuning),
  }
  const standing: Held = Object.fromEntries([
    ...(active.context === null ? [] : [['context', active.context.level.name]]),
    ...e.rateLimits.flatMap(limit => {
      const hit = windowHit(limit, now, config.pace, previous, config.tuning)

      return hit === null ? [] : [[limit.kind, hit.level.name]]
    }),
  ])

  await update($, held, () => standing)
  const state = await current($)
  const before = state.active

  state.active = active
  const hot = e.rateLimits.find(limit => limit.kind === 'five_hour')
  const hotReset = hot?.resetsAt === undefined ? NaN : Date.parse(hot.resetsAt)

  if (
    config.wakeAt > 0 &&
    hot?.resetsAt !== undefined &&
    hotReset > now &&
    hot.percentUsed >= config.wakeAt &&
    (await read($, armedFor)) !== hot.resetsAt
  ) {
    await arm($, config, hot.resetsAt)
  }

  const kept = await read($, forecast)
  const stepped: Forecasts = Object.fromEntries(
    e.rateLimits.flatMap(limit => {
      const moved = step(kept[limit.kind], limit, now, config.tuning)

      return moved === undefined ? [] : [[limit.kind, moved]]
    }),
  )
  const stored = { ...kept, ...stepped }
  const at: Context = { limits: e.rateLimits, stored, now, tuning: config.tuning }

  await update($, forecast, () => stored)
  await update($, reading, () => readingOf(e))

  const keptSamples = await read($, samples)
  const recorded: Samples = Object.fromEntries(
    e.rateLimits.flatMap(limit => {
      const next = record(keptSamples[limit.kind], limit, now, config.tuning)

      return next === undefined ? [] : [[limit.kind, next]]
    }),
  )

  await update($, samples, () => ({ ...keptSamples, ...recorded }))

  const told: string[] = []
  const lit: Latches = { ...(await read($, latches)) }

  e.rateLimits.forEach(limit => {
    const rule = usageRule(limit.kind, config.tuning)

    if (rule === undefined) {
      return
    }

    const rate = usageRate(recorded[limit.kind], limit, now, config.tuning)
    const { next, tell } = latch(lit[limit.kind] ?? DARK, rate, now, rule)

    lit[limit.kind] = next

    if (tell && rate !== null) {
      told.push(usageLine(limit.kind, rate, config.tuning))
    }
  })

  if (isToolCall) {
    const count = await update($, calls, prev => prev + 1)
    const kept = await update($, trail, prev => follow(prev, e.context.percent, config.tuning))
    const rise = contextRise(kept)
    const { next, tell } = latch(lit.context ?? DARK, rise, count, contextRule(config.tuning))

    lit.context = next

    if (tell && rise !== null) {
      told.push(contextLine(rise, kept.length - 1))
    }
  }

  await update($, latches, () => lit)

  const moved = Object.entries(stepped).some(
    ([kind, one]) => kept[kind]?.used !== one?.used || kept[kind]?.resetsAt !== one?.resetsAt,
  )

  if (moved) {
    await $.store.set(STORE_KEY, stored).catch((error: unknown) => {
      $.ui.log(`headroom: the forecast could not be stored: ${String(error)}`, { to: 'debug' })
    })
    await $.store.set(SAMPLES_KEY, await read($, samples)).catch((error: unknown) => {
      $.ui.log(`headroom: the burst samples could not be stored: ${String(error)}`, { to: 'debug' })
    })
  }

  await update($, levels, () => active)

  if (!sameGate(before, active)) {
    state.epoch += 1
    state.grant = 'pending'
    await update($, grant, () => 'pending')
  }

  if (!sameLevels(before, active)) {
    if (atLeast(effective(active), 'alert')) {
      const text = loud(active, at)
      await update($, pending, () => text)
    } else if (atLeast(effective(before), 'alert')) {
      await update($, pending, () => null)
    }
  }

  if (told.length > 0) {
    await update($, pending, text => [...(text === null ? [] : [text]), ...told].join('\n'))
  }

  const keep = keepOf(await read($, latches), await read($, held))
  const shot = JSON.stringify(keep)

  if (shot !== saved) {
    await $.store
      .set(KEPT_KEY, keep)
      .then(() => {
        saved = shot
      })
      .catch((error: unknown) => {
        $.ui.log(`headroom: the burst state could not be stored: ${String(error)}`, { to: 'debug' })
      })
  }
}

const take = async ($: EngineInterface): Promise<string | null> => {
  let taken: string | null = null

  await update($, pending, text => {
    taken = text

    return null
  })

  return taken
}

export const register: Register = (on, options) => {
  const config = ladders(options)
  let asking: { epoch: number; answer: Promise<Grant | null> } | null = null

  on('session.start', async ($, e, next) => {
    const stored = await loadForecasts($).catch((error: unknown) => {
      $.ui.log(`headroom: its stored forecast could not be read: ${String(error)}`, { to: 'debug' })

      return {}
    })

    await update($, forecast, () => stored)

    const kept = await loadSamples($).catch((error: unknown) => {
      $.ui.log(`headroom: its stored burst samples could not be read: ${String(error)}`, { to: 'debug' })

      return {}
    })

    await update($, samples, () => kept)

    const state = await $.store.get(KEPT_KEY).catch((error: unknown) => {
      $.ui.log(`headroom: its stored burst state could not be read: ${String(error)}`, { to: 'debug' })

      return undefined
    })

    if (isKept(state)) {
      const kept = keepOf(state.latches, state.held)

      saved = JSON.stringify(kept)
      await update($, latches, () => kept.latches)
      await update($, held, () => kept.held)
    } else if (state !== undefined) {
      $.ui.log(`headroom: its stored burst state is unreadable: ${JSON.stringify(state)}`, { to: 'debug' })
    }

    const isFull = await $.store.get('details').catch((error: unknown) => {
      $.ui.log(`headroom: the details toggle could not be read: ${String(error)}`, { to: 'debug' })

      return false
    })

    await update($, details, () => isFull === true)

    const armed = await read($, armedFor)

    if (armed !== null) {
      const now = await $.clock.now()
      const hot = (await $.session.usage()).rateLimits.find(
        limit => limit.kind === 'five_hour' && limit.resetsAt === armed,
      )
      const isStillDue =
        config.wakeAt > 0 &&
        hot !== undefined &&
        hot.percentUsed >= config.wakeAt &&
        Date.parse(armed) > now

      if (isStillDue) {
        await arm($, config, armed)
      } else {
        await update($, armedFor, () => null)
      }
    }

    await $.command.register({
      name: 'headroom',
      description: 'Show context, rate-limit windows, pace and run-out time',
    })

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      timer?.cancel()
      timer = null
      await update($, armedFor, () => null)
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await measure($, config, e)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'AskUserQuestion' || e.agentId !== undefined) {
      return next(e)
    }

    const state = await current($)
    const last = await read($, reading)
    const at: Context = { limits: last?.rateLimits ?? [], stored: await read($, forecast), now: await $.clock.now(), tuning: config.tuning }

    for (;;) {
      const action = actionOf(state)
      const reason = loud(state.active, at)

      if (action === 'block') {
        return { deny: reason }
      }

      if (action !== 'ask' || (await $.session.surfaces()).length === 0) {
        return next(e)
      }

      const asked = state.epoch

      if (state.grant === 'granted') {
        return next(e)
      }

      if (asking?.epoch !== asked) {
        asking = {
          epoch: asked,
          answer: $.ui
            .ask(`${reason}\nBlock tools until this level changes?`, ['Continue', 'Block'])
            .then(answerOf)
            .catch((error: unknown) => {
              $.ui.log(`headroom: the ask got no answer: ${String(error)}`, { to: 'debug' })

              return null
            }),
        }
      }

      const chosen = await asking.answer

      if (state.epoch !== asked) {
        continue
      }

      asking = null

      if (chosen === null) {
        return next(e)
      }

      state.grant = chosen
      await update($, grant, () => chosen)
    }
  }).catch(($, e, next) => {
    if (next.called) {
      return next(e)
    }

    if (isGating($, live)) {
      return {
        deny: 'headroom: its guard failed while block was on, so tools stay blocked. Try again, or run /plugin disable headroom.',
      }
    }

    $.ui.log('headroom: its guard failed with no ask or block level active, so the call runs', {
      to: 'debug',
    })

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const text = await take($)

    if (text === null) {
      return next(e)
    }

    return next({ ...e, context: [...(e.context ?? []), text] })
  })

  on('classic.PostToolUse', async ($, e, next) => {
    const ran = await next(e)

    await $.session
      .usage()
      .then(usage => measure($, config, usage, true))
      .catch((error: unknown) => {
        $.ui.log(`headroom: the reading after a tool could not be taken: ${String(error)}`, { to: 'debug' })
      })
    const text = await take($)

    if (text === null) {
      return ran
    }

    return { ...ran, additionalContext: [...(ran.additionalContext ?? []), text] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const below = await next(e).catch((error: unknown) => {
      $.ui.log(`headroom: nothing drew beneath the band: ${String(error)}`, { to: 'debug' })

      return undefined
    })
    const band = await bandOf($, config, await read($, reading))
    const isFull = await read($, details)
    const footer = isFull ? summary(band) : ''
    const rows = isFull ? [[{ text: 'headroom' }], [{ text: ' ' }], ...full(band)] : [compact(band)]
    const toggle = async () => {
      const shown = await update($, details, open => !open)

      await $.store.set('details', shown).catch((error: unknown) => {
        $.ui.log(`headroom: the details toggle could not be stored: ${String(error)}`, { to: 'debug' })
      })
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const row = (spans: readonly Span[], i: number) => (
      <Text key={`band-${i}`} wrap="truncate-end">
        {spans.map((span, j) => (
          <Text key={`span-${j}`} color={span.color}>
            {span.text}
          </Text>
        ))}
      </Text>
    )
    const mine = (
      <Box flexDirection="column">
        {rows.map((spans, i) =>
          i === 0 ? (
            <Box key="band-head" flexDirection="row">
              {row(spans, i)}
              <Box flexGrow={1} />
              <Button key="details" plain label={isFull ? '[-]' : '⋯'} onPress={toggle} />
            </Box>
          ) : (
            row(spans, i)
          ),
        )}
        {footer === '' ? null : <Text key="band-gap"> </Text>}
        {footer === '' ? null : (
          <Text key="band-summary" color="subtle" wrap="wrap">
            {footer}
          </Text>
        )}
      </Box>
    )

    return below === undefined ? mine : <Box flexDirection="column">{mine}{below}</Box>
  })

  on('command.run', { command: 'headroom' }, async $ => ({
    text: await $.session.usage().then(async usage => report(usage, await bandOf($, config, readingOf(usage)))),
    isTextDisplayOnly: true,
  }))
}
