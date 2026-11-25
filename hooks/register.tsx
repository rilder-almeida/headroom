import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Active, Grant, Hit } from '../types'
import { ladders } from './config'
import type { Ladders } from './config'
import {
  atLeast,
  band,
  contextHit,
  effective,
  line,
  paceHit,
  paceOf,
  sameGate,
  sameLevels,
  windowOf,
} from './levels'

const NOTHING: Active = { context: null, pace: null }

const levels = atom({ plugin: 'headroom', key: 'levels' } as const, NOTHING, { shape: 'levels-1' })
const pending = atom({ plugin: 'headroom', key: 'pending' } as const, null)
const armedFor = atom({ plugin: 'headroom', key: 'armedFor' } as const, null as string | null)
const grant = atom({ plugin: 'headroom', key: 'grant' } as const, 'pending' as Grant, { shape: 'grant-2' })

const loud = (active: Active): string =>
  [active.context, active.pace]
    .filter((hit): hit is Hit => hit !== null && atLeast(hit.level.action, 'alert'))
    .map(line)
    .join('\n')

const window = (usage: SessionUsage['rateLimits'][number], now: number): string => {
  const name = windowOf(usage.kind)?.label ?? usage.kind
  const reset = usage.resetsAt === undefined ? NaN : Date.parse(usage.resetsAt)

  if (reset <= now) {
    return `${name} reset, no reading since`
  }

  const pace = paceOf(usage, now)
  const speed = pace === null ? 'pace n/a' : `pace ${pace.value > 0 ? '+' : ''}${pace.value}%`

  return `${name} ${usage.percentUsed}% used, ${speed}`
}

const report = (usage: SessionUsage, now: number, config: Ladders): string => {
  const percent = usage.context.percent
  const context = contextHit(percent, config.context)
  const lines = [
    percent === undefined
      ? 'context: no reading yet'
      : `context ${percent}% (${context?.level.name ?? 'ok'})`,
  ]

  if (usage.rateLimits.length === 0) {
    lines.push('no rate-limit windows (no subscription)')
  }

  return [...lines, ...usage.rateLimits.map(limit => window(limit, now))].join('\n')
}

let timer: { cancel: () => void } | null = null

const wake = async ($: EngineInterface, config: Ladders) => {
  timer = null
  await update($, armedFor, () => null)
  $.ui.toast('headroom: the 5h window reset')

  const reading = report(await $.session.usage(), await $.clock.now(), config)

  await $.prompt.submit({ text: `headroom: the 5h window reset. Fresh reading:\n${reading}` })
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

const isGating = ($: EngineInterface, state: typeof live): boolean => {
  try {
    return state !== null && atLeast(effective(state.active), 'ask')
  } catch (error) {
    $.ui.log(`headroom: its stored levels are unreadable: ${String(error)}`, { to: 'debug' })

    return false
  }
}

const answerOf = (answer: string): Grant | null =>
  answer === 'Continue' ? 'granted' : answer === 'Stop' ? 'blocked' : null

export const register: Register = (on, options) => {
  const config = ladders(options)
  let asking: { epoch: number; answer: Promise<Grant | null> } | null = null

  on('session.start', async ($, e, next) => {
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
      description: 'Show context fill, rate-limit windows and pace',
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

    state.active = active
    await update($, levels, () => active)

    if (!sameGate(before, active)) {
      state.epoch += 1
      state.grant = 'pending'
      await update($, grant, () => 'pending')
    }

    if (!sameLevels(before, active)) {
      if (atLeast(effective(active), 'alert')) {
        const text = loud(active)
        $.ui.toast(text)
        await update($, pending, () => text)
      } else if (atLeast(effective(before), 'alert')) {
        $.ui.toast('back within headroom')
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

    for (;;) {
      const action = effective(state.active)
      const reason = loud(state.active)

      if (action === 'block') {
        return { deny: reason }
      }

      if (action !== 'ask' || (await $.session.surfaces()).length === 0) {
        return next(e)
      }

      const asked = state.epoch

      if (state.grant !== 'pending') {
        return state.grant === 'granted' ? next(e) : { deny: reason }
      }

      if (asking?.epoch !== asked) {
        asking = {
          epoch: asked,
          answer: $.ui
            .ask(`${reason}\nContinue anyway?`, ['Continue', 'Stop'])
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
        deny: 'headroom: its guard failed, so the call was refused. Try again, or run /plugin disable headroom.',
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
    text: report(await $.session.usage(), await $.clock.now(), config),
    isTextDisplayOnly: true,
  }))
}
