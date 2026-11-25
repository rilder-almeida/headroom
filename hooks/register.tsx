import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Active, Forecasts, Grant, Hit, Reading } from '../types'
import { ladders } from './config'
import type { Ladders } from './config'
import { isForecast, runOut, step } from './forecast'
import {
  atLeast,
  band,
  contextHit,
  effective,
  left,
  line,
  paceHit,
  paceOf,
  sameGate,
  sameLevels,
  stageOf,
  windowHit,
  windowOf,
} from './levels'
import type { Limit } from './levels'

const NOTHING: Active = { context: null, pace: null }

const levels = atom({ plugin: 'headroom', key: 'levels' } as const, NOTHING, { shape: 'levels-1' })
const pending = atom({ plugin: 'headroom', key: 'pending' } as const, null)
const armedFor = atom({ plugin: 'headroom', key: 'armedFor' } as const, null as string | null)
const grant = atom({ plugin: 'headroom', key: 'grant' } as const, 'pending' as Grant, { shape: 'grant-2' })
const reading = atom({ plugin: 'headroom', key: 'reading' } as const, null as Reading | null)
const forecast = atom({ plugin: 'headroom', key: 'forecast' } as const, {} as Forecasts)

const KIND = { '5h': 'five_hour', '7d': 'seven_day' } as const

/** The run-out text for the window a pace hit came from. */
const outOf = (hit: Hit, limits: readonly Limit[], stored: Forecasts, now: number): string | undefined => {
  if (hit.ladder !== 'pace') {
    return undefined
  }

  const kind = KIND[hit.window]
  const limit = limits.find(one => one.kind === kind)
  const out = limit === undefined ? '·' : runOut(stored[kind], limit, now)

  return out === '·' ? undefined : out
}

type Context = { limits: readonly Limit[]; stored: Forecasts; now: number }

const loud = (active: Active, at: Context, only?: (hit: Hit) => boolean): string =>
  [active.context, active.pace]
    .filter((hit): hit is Hit => hit !== null && atLeast(hit.level.action, 'alert'))
    .filter(hit => only?.(hit) ?? true)
    .map(hit => line(hit, outOf(hit, at.limits, at.stored, at.now)))
    .join('\n')

const pct = (value: number): string => `${value}%`.padEnd(5)

const standing = (name: string, value: number, ladder: Ladders['context']): string => {
  const room = left(value, ladder)

  return room === null ? name : `${name} · ${room}% left`
}

const window = (usage: Limit, now: number, config: Ladders, stored: Forecasts): string => {
  const name = windowOf(usage.kind)?.label ?? usage.kind
  const reset = usage.resetsAt === undefined ? NaN : Date.parse(usage.resetsAt)

  if (reset <= now) {
    return `${name} reset, no reading since`
  }

  const pace = paceOf(usage, now)
  const head = `${name.padEnd(9)}${pct(usage.percentUsed)}`
  const out = `out ${runOut(stored[usage.kind], usage, now)}`

  if (pace === null) {
    return `${head}${'pace n/a'.padEnd(11)}${''.padEnd(17)}${out}`
  }

  const level = windowHit(usage, now, config.pace)?.level.name ?? 'ok'
  const speed = `pace ${pace.value > 0 ? '+' : ''}${pace.value}%`

  return `${head}${speed.padEnd(11)}${standing(level, pace.value, config.pace).padEnd(17)}${out}`
}

const report = (usage: SessionUsage, now: number, config: Ladders, stored: Forecasts): string => {
  const percent = usage.context.percent
  const lines = [
    percent === undefined
      ? 'context n/a'
      : `${'context'.padEnd(9)}${pct(percent)}${standing(contextHit(percent, config.context)?.level.name ?? 'ok', percent, config.context)}`,
  ]

  if (usage.rateLimits.length === 0) {
    lines.push('no rate-limit windows (no subscription)')
  }

  return [...lines, ...usage.rateLimits.map(limit => window(limit, now, config, stored))].join('\n')
}

const STORE_KEY = 'forecast'

const loadForecasts = async ($: EngineInterface): Promise<Forecasts> => {
  const value = await $.store.get(STORE_KEY)

  if (value === undefined) {
    return {}
  }

  const entries = typeof value === 'object' && value !== null ? Object.entries(value) : []

  if (entries.length === 0 || !entries.every(([, one]) => isForecast(one))) {
    $.ui.log(`headroom: its stored forecast is unreadable: ${JSON.stringify(value)}`, { to: 'debug' })

    return {}
  }

  return Object.fromEntries(entries)
}

let timer: { cancel: () => void } | null = null

const wake = async ($: EngineInterface, config: Ladders) => {
  timer = null
  await update($, armedFor, () => null)
  $.ui.toast('headroom: the 5h window reset')

  const fresh = report(await $.session.usage(), await $.clock.now(), config, await read($, forecast))

  await $.prompt.submit({ text: `headroom: the 5h window reset. Fresh reading:\n${fresh}` })
}

const arm = async ($: EngineInterface, config: Ladders, resetsAt: string) => {
  const wait = Date.parse(resetsAt) + 60_000 - (await $.clock.now())

  timer?.cancel()
  await update($, armedFor, () => resetsAt)
  timer = $.clock.after(Math.max(0, wait), () => {
    wake($, config).catch((error: unknown) => {
      $.ui.log(`headroom: wake failed: ${String(error)}`, { to: 'debug' })
    })
  })
}

let live: { active: Active; grant: Grant; epoch: number } | null = null

const current = async ($: EngineInterface) => {
  live ??= { active: await read($, levels), grant: await read($, grant), epoch: 0 }

  return live
}

const actionOf = (state: NonNullable<typeof live>) =>
  state.grant === 'blocked' ? 'block' : effective(state.active)

const isGating = ($: EngineInterface, state: typeof live): boolean => {
  try {
    return state !== null && atLeast(actionOf(state), 'ask')
  } catch (error) {
    $.ui.log(`headroom: its stored levels are unreadable: ${String(error)}`, { to: 'debug' })

    return false
  }
}

const answerOf = (answer: string): Grant | null =>
  answer === 'Continue' ? 'granted' : answer === 'Block' ? 'blocked' : null

export const register: Register = (on, options) => {
  const config = ladders(options)
  let asking: { epoch: number; answer: Promise<Grant | null> } | null = null

  on('session.start', async ($, e, next) => {
    const stored = await loadForecasts($).catch((error: unknown) => {
      $.ui.log(`headroom: its stored forecast could not be read: ${String(error)}`, { to: 'debug' })

      return {}
    })

    await update($, forecast, () => stored)

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
    const now = await $.clock.now()
    const active: Active = {
      context: contextHit(e.context.percent, config.context),
      pace: paceHit(e.rateLimits, now, config.pace),
    }
    const state = await current($)
    const before = state.active
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
        const moved = step(kept[limit.kind], limit, now)

        return moved === undefined ? [] : [[limit.kind, moved]]
      }),
    )
    const stored = { ...kept, ...stepped }
    const at: Context = { limits: e.rateLimits, stored, now }

    await update($, forecast, () => stored)
    await update($, reading, () => ({ context: e.context.percent, rateLimits: [...e.rateLimits] }))
    await $.store.set(STORE_KEY, stored).catch((error: unknown) => {
      $.ui.log(`headroom: the forecast could not be stored: ${String(error)}`, { to: 'debug' })
    })

    state.active = active
    await update($, levels, () => active)

    if (!sameGate(before, active)) {
      state.epoch += 1
      state.grant = 'pending'
      await update($, grant, () => 'pending')
    }

    if (!sameLevels(before, active)) {
      const rose = loud(active, at, hit =>
        stageOf(hit, config[hit.ladder]) > stageOf(before[hit.ladder], config[hit.ladder]),
      )

      if (rose !== '') {
        $.ui.toast(rose)
      }

      if (atLeast(effective(active), 'alert')) {
        const text = loud(active, at)
        await update($, pending, () => text)
      } else if (atLeast(effective(before), 'alert')) {
        await update($, pending, () => null)
      }
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'AskUserQuestion' || e.agentId !== undefined) {
      return next(e)
    }

    const state = await current($)
    const last = await read($, reading)
    const at: Context = { limits: last?.rateLimits ?? [], stored: await read($, forecast), now: await $.clock.now() }

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

      if (chosen !== null) {
        state.grant = chosen
        await update($, grant, () => chosen)
      }

      return chosen === 'granted' ? next(e) : { deny: reason }
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
    const text = await read($, pending)

    if (text === null) {
      return next(e)
    }

    await update($, pending, () => null)

    return next({ ...e, context: [...(e.context ?? []), text] })
  })

  on('classic.PostToolUse', async ($, e, next) => {
    const ran = await next(e)
    const text = await read($, pending)

    if (text === null) {
      return ran
    }

    await update($, pending, () => null)

    return { ...ran, additionalContext: [...(ran.additionalContext ?? []), text] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const active = await read($, levels)

    if (e.props.hasSurvey || !atLeast(effective(active), 'alert')) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text color="warning">{band(active)}</Text>
      </Box>
    )
  })

  on('command.run', { command: 'headroom' }, async $ => ({
    text: report(await $.session.usage(), await $.clock.now(), config, await read($, forecast)),
    isTextDisplayOnly: true,
  }))
}
