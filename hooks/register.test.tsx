import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderSurface, SessionRateLimit } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 23, 12)
const resetIn = (ms: number) => new Date(NOW + ms).toISOString()

const usage = (on: On, percent: number | undefined, rateLimits: SessionRateLimit[]) =>
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { window: 1_000_000, percent }, rateLimits },
  }))

const start = async (on: On, $: Engine, stored?: Record<string, unknown>) => {
  mock.store(on, stored)
  on('command.register', () => ({ value: { command: 'headroom' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

const run = ($: Engine) =>
  $.command.run({
    command: 'headroom',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

test('the command reports context, windows and pace', async ($, on) => {
  mock.clock(on, { now: NOW })
  usage(on, 67, [
    { kind: 'five_hour', percentUsed: 30, resetsAt: resetIn(2.5 * HOUR) },
    { kind: 'seven_day', percentUsed: 40, resetsAt: resetIn(84 * HOUR) },
  ])
  await start(on, $)

  const { text } = await run($)

  expect(text?.split('\n')).toEqual([
    'context  67%  hot <75%',
    '5h       30%  pace -40%  ok <20%          out ·',
    '7d       40%  pace -20%  ok <20%          out ·',
  ])
})

test('the command says why pace is missing', async ($, on) => {
  mock.clock(on, { now: NOW })
  usage(on, 10, [])
  await start(on, $)

  const { text } = await run($)

  expect(text).toContain('context  10%  ok <45%')
  expect(text).toContain('no rate-limit windows (no subscription)')
})

const BAND = {
  plugin: 'headroom',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 3,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 3 },
    view: {},
  },
} as const

const submit = ($: Engine, text: string) =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

const harness = async ($: Engine, on: On, stored?: Record<string, unknown>) => {
  const toasts: string[] = []
  const contexts: (readonly string[] | undefined)[] = []

  mock.clock(on, { now: NOW })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('prompt.submit', (_, e) => {
    contexts.push(e.context)

    return { text: e.text }
  })
  on('classic.PostToolUse', () => ({}))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  await start(on, $, stored)

  const measure = (percent: number | undefined, rateLimits: SessionRateLimit[] = []) =>
    $.session.measure({ context: { window: 1_000_000, percent }, rateLimits, changed: ['context'] })

  return { toasts, contexts, measure }
}

const WARM_50 = 'headroom: context warm 50%: consider a fresh session at the next natural stop point'

test('a rise past alert toasts once and queues the line', async ($, on) => {
  const { toasts, measure } = await harness($, on)

  await measure(50)
  await measure(52)

  expect(toasts).toEqual([WARM_50])
})

test('the line reaches the model once', async ($, on) => {
  const { contexts, measure } = await harness($, on)

  await measure(50)
  await submit($, 'hi')
  await submit($, 'again')

  expect(contexts).toEqual([[WARM_50], undefined])
})

test('a finished tool refreshes the level mid-turn', async ($, on) => {
  usage(on, 50, [])
  const { toasts } = await harness($, on)

  const after = await $.classic.PostToolUse({
    tool_name: 'Bash',
    tool_input: {},
    tool_response: {},
    tool_use_id: 't1',
  })

  expect(toasts).toEqual([WARM_50])
  expect(after.additionalContext).toEqual([WARM_50])
})

test('parallel tool results raise one notice', async ($, on) => {
  usage(on, 50, [])
  const { toasts } = await harness($, on)
  const result = (id: string) =>
    $.classic.PostToolUse({ tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: id })

  await Promise.all([result('t1'), result('t2'), result('t3')])

  expect(toasts).toEqual([WARM_50])
})

test('the forecast is stored only when a window moves', async ($, on) => {
  const stored: unknown[] = []
  const used = { now: 40 }
  const clock = mock.clock(on, { now: NOW })
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { window: 1_000_000, percent: 10 },
      rateLimits: [{ kind: 'five_hour', percentUsed: used.now, resetsAt: resetIn(2.5 * HOUR) }],
    },
  }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_, e) => {
    stored.push(e.value)

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('classic.PostToolUse', () => ({}))
  on('command.register', () => ({ value: { command: 'headroom' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const result = (id: string) =>
    $.classic.PostToolUse({ tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: id })

  await result('t1')
  await result('t2')
  used.now = 41
  await clock.advance(60_000)
  await result('t3')

  expect(stored).toHaveLength(2)
})

test('the line reaches the model mid-turn', async ($, on) => {
  const { contexts, measure } = await harness($, on)

  await measure(50)
  const after = await $.classic.PostToolUse({
    tool_name: 'Bash',
    tool_input: {},
    tool_response: {},
    tool_use_id: 't1',
  })
  await submit($, 'hi')

  expect(after.additionalContext).toEqual([WARM_50])
  expect(contexts).toEqual([undefined])
})

test('a fall back to ok toasts nothing', async ($, on) => {
  const { toasts, contexts, measure } = await harness($, on)

  await measure(50)
  await submit($, 'hi')
  await measure(10)
  await submit($, 'again')

  expect(toasts).toEqual([WARM_50])
  expect(contexts).toEqual([[WARM_50], undefined])
})

const HOT_67 = 'headroom: context hot 67%: finish the current piece only, then start a fresh session'

test('only a rise toasts, every change into alert reaches the model', async ($, on) => {
  const { toasts, contexts, measure } = await harness($, on)

  await measure(50)
  await submit($, 'a')
  await measure(67)
  await submit($, 'b')
  await measure(50)
  await submit($, 'c')

  expect(toasts).toEqual([WARM_50, HOT_67])
  expect(contexts).toEqual([[WARM_50], [HOT_67], [WARM_50]])
})

test('a rise to a level set to none toasts nothing', { options: { context_warm_action: 'none' } }, async ($, on) => {
  const { toasts, measure } = await harness($, on)

  await measure(50)

  expect(toasts).toEqual([])
})

test('a pace line carries its run-out time', async ($, on) => {
  const { toasts, measure } = await harness($, on)

  await measure(10, [{ kind: 'five_hour', percentUsed: 81, resetsAt: resetIn(2.5 * HOUR) }])

  expect(toasts).toEqual(['headroom: 5h pace hot +62%, out in 35m: show the pace and ask before starting long work'])
})

test('a reading steps the forecast and stores it', async ($, on) => {
  const stored: unknown[] = []
  mock.clock(on, { now: NOW })
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_, e) => {
    stored.push(e.value)

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('command.register', () => ({ value: { command: 'headroom' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const limit = { kind: 'five_hour', percentUsed: 81, resetsAt: resetIn(2.5 * HOUR) }
  await $.session.measure({ context: { window: 1_000_000, percent: 10 }, rateLimits: [limit], changed: ['rateLimits'] })

  expect(stored.at(-1)).toMatchObject({ five_hour: { used: 81, resetsAt: limit.resetsAt } })
})

test('a jump to full is one transition', async ($, on) => {
  const { toasts, measure } = await harness($, on)

  await measure(10)
  await measure(80)

  expect(toasts).toEqual(['headroom: context full 80%: stop now and start a fresh session'])
})

test('no reading, no level', async ($, on) => {
  const { toasts, measure } = await harness($, on)

  await measure(undefined)

  expect(toasts).toEqual([])
})

test('the band always shows, above the rows beneath it', async ($, on) => {
  const { measure } = await harness($, on)

  for (const surface of ['terminal', 'desktop'] as const) {
    await measure(10)
    const band = await $.ui.mount({ ...BAND, surface })

    expect(await band.find({ type: 'Text', text: '●○○○' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: 'engine' })).toBeDefined()
    await band.unmount()
  }
})

test('the details button toggles the full view', async ($, on) => {
  const { measure } = await harness($, on)

  await measure(10)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'details' })

  expect(await band.find({ type: 'Text', text: 'level  ok <45%' })).toBeDefined()

  await band.press({ key: 'details' })

  expect(await band.find({ type: 'Text', text: 'level  ok <45%' })).toBeUndefined()
  await band.unmount()
})

test('a stored toggle opens the full view', async ($, on) => {
  const { measure } = await harness($, on, { details: true })

  await measure(10)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await band.find({ type: 'Text', text: 'now    10%' })).toBeDefined()
  await band.unmount()
})

test('the band yields to a survey', async ($, on) => {
  const { measure } = await harness($, on)

  await measure(50)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })

  expect(await band.find({ type: 'Text', text: /●/ })).toBeUndefined()
  await band.unmount()
})

const LIMIT_80 = 'headroom: context full 80%: stop now and start a fresh session'

const gate = async (
  $: Engine,
  on: On,
  answers: (string | Promise<string>)[] = [],
  surfaces: RenderSurface[] | 'broken' = ['terminal'],
) => {
  const asked: string[] = []
  const labels: string[] = []
  const ran: string[] = []

  mock.clock(on, { now: NOW })
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('tool.call', async (_, e) => {
    if (e.tool !== 'AskUserQuestion') {
      ran.push(e.tool_use_id ?? e.tool)

      return { result: {} }
    }

    const question = e.questions[0]?.question ?? ''
    asked.push(question)
    labels.push(...(e.questions[0]?.options.map(option => option.label) ?? []))
    const answer = await (answers.shift() ?? 'Continue')

    return answer === 'dismiss'
      ? { deny: 'dismissed' }
      : { result: { questions: e.questions, answers: { [question]: answer } } }
  })
  on('session.surfaces', () => {
    if (surfaces === 'broken') {
      throw new Error('api changed')
    }

    return { value: surfaces }
  })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'headroom' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: surfaces === 'broken' ? 'terminal' : surfaces[0] ?? null, isInteractive: false })

  const measure = (percent: number, rateLimits: SessionRateLimit[] = []) =>
    $.session.measure({ context: { window: 1_000_000, percent }, rateLimits, changed: ['context'] })
  const call = (id: string, agentId?: string) =>
    $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: id, agentId })

  return { asked, labels, ran, measure, call }
}

test('ask confirms once per level', async ($, on) => {
  const { asked, labels, ran, measure, call } = await gate($, on, ['Continue'])

  await measure(80)
  await call('a')
  await call('b')

  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain(LIMIT_80)
  expect(asked[0]).toContain('Block tools until this level changes?')
  expect(labels).toEqual(['Continue', 'Block'])
  expect(ran).toEqual(['a', 'b'])
})

test('the Block answer blocks until the next transition', async ($, on) => {
  const { ran, measure, call } = await gate($, on, ['Block'])

  await measure(80)
  const first = await call('a')
  const second = await call('b')
  await measure(50)
  await call('c')

  expect(first.deny).toContain(LIMIT_80)
  expect(second.deny).toContain(LIMIT_80)
  expect(ran).toEqual(['c'])
})

test('a rise to another ask level asks again', async ($, on) => {
  const { asked, measure, call } = await gate($, on, ['Continue', 'Continue'])
  const hot = [{ kind: 'five_hour', percentUsed: 80, resetsAt: resetIn(2.5 * HOUR) }]

  await measure(10, hot)
  await call('a')
  await measure(80, hot)
  await call('b')

  expect(asked).toHaveLength(2)
})

test('block denies every call', { options: { context_full_action: 'block' } }, async ($, on) => {
  const { asked, ran, measure, call } = await gate($, on)

  await measure(80)
  const got = await call('a')

  expect(got.deny).toContain(LIMIT_80)
  expect(asked).toEqual([])
  expect(ran).toEqual([])
})

test('AskUserQuestion is never gated', { options: { context_full_action: 'block' } }, async ($, on) => {
  const { asked, measure } = await gate($, on)

  await measure(80)
  const got = await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [{ question: 'Go on?', header: 'Go', options: [{ label: 'Yes', description: 'go on' }, { label: 'No', description: 'stop' }], multiSelect: false }],
  })

  expect(got.deny).toBeUndefined()
  expect(asked).toEqual(['Go on?'])
})

test('subagent calls pass', { options: { context_full_action: 'block' } }, async ($, on) => {
  const { ran, measure, call } = await gate($, on)

  await measure(80)
  await call('a', 'agent-1')

  expect(ran).toEqual(['a'])
})

test('a session no surface draws never asks', async ($, on) => {
  const { asked, ran, measure, call } = await gate($, on, [], [])

  await measure(80)
  await call('a')

  expect(asked).toEqual([])
  expect(ran).toEqual(['a'])
})

test('a dismissed ask lets the call run and asks again', async ($, on) => {
  const { asked, ran, measure, call } = await gate($, on, ['dismiss', 'Continue'])

  await measure(80)
  const first = await call('a')
  await call('b')

  expect(first.deny).toBeUndefined()
  expect(asked).toHaveLength(2)
  expect(ran).toEqual(['a', 'b'])
})

test('parallel calls share one ask', async ($, on) => {
  const { asked, ran, measure, call } = await gate($, on, ['Continue'])

  await measure(80)
  await Promise.all([call('a'), call('b')])

  expect(asked).toHaveLength(1)
  expect(ran.sort()).toEqual(['a', 'b'])
})

type TimerSetup = { seed?: string; isSubmitBroken?: boolean; windows?: SessionRateLimit[] }

const timer = async ($: Engine, on: On, setup: TimerSetup = {}) => {
  const { seed, isSubmitBroken = false } = setup
  const windows = setup.windows ?? [{ kind: 'five_hour', percentUsed: 3, resetsAt: resetIn(5 * HOUR) }]
  const toasts: string[] = []
  const prompts: string[] = []
  const clock = mock.clock(on, { now: NOW })

  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('prompt.submit', (_, e) => {
    if (isSubmitBroken) {
      throw new Error('host gone')
    }

    prompts.push(e.text)

    return { text: e.text }
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  usage(on, 20, windows)
  mock.store(on)
  on('command.register', () => ({ value: { command: 'headroom' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  let isSeeded = seed === undefined

  on('state.get', (_, e, next) => {
    if (isSeeded || e.key !== 'armedFor') {
      return next(e)
    }

    isSeeded = true

    return { value: { value: seed, version: 0 } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const measure = (percentUsed: number, resetsAt: string) =>
    $.session.measure({
      context: { window: 1_000_000, percent: 20 },
      rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt }],
      changed: ['rateLimits'],
    })

  return { toasts, prompts, clock, measure }
}

test('the timer arms past wake_at and fires at reset', async ($, on) => {
  const { prompts, toasts, clock, measure } = await timer($, on)

  await measure(80, resetIn(HOUR))
  await clock.advance(HOUR + 60_000)

  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('5h window reset')
  expect(prompts[0]).toContain('context  20%  ok <45%')
  expect(toasts).toContain('headroom: the 5h window reset')
})

test('one timer per reset', async ($, on) => {
  const { prompts, clock, measure } = await timer($, on)

  await measure(80, resetIn(HOUR))
  await measure(81, resetIn(HOUR))
  await clock.advance(HOUR + 60_000)

  expect(prompts).toHaveLength(1)
})

test('wake_at 0 never arms', { options: { wake_at: 0 } }, async ($, on) => {
  const { prompts, clock, measure } = await timer($, on)

  await measure(99, resetIn(HOUR))
  await clock.advance(HOUR + 60_000)

  expect(prompts).toEqual([])
})

test('below wake_at never arms', async ($, on) => {
  const { prompts, clock, measure } = await timer($, on)

  await measure(74, resetIn(HOUR))
  await clock.advance(HOUR + 60_000)

  expect(prompts).toEqual([])
})

const ARMED = resetIn(HOUR / 2)
const HOT = [{ kind: 'five_hour', percentUsed: 80, resetsAt: ARMED }]

test('a reload re-arms', async ($, on) => {
  const { prompts, clock } = await timer($, on, { seed: ARMED, windows: HOT })

  await clock.advance(HOUR / 2 + 60_000)

  expect(prompts).toHaveLength(1)
})

test('a drawn session asks even when not interactive', async ($, on) => {
  const { asked, measure, call } = await gate($, on, ['Continue'], ['desktop'])

  await measure(80)
  await call('a')

  expect(asked).toHaveLength(1)
})

test('an alert level does not ask again', async ($, on) => {
  const { asked, ran, measure, call } = await gate($, on, ['Continue', 'Continue'])
  const tight = [{ kind: 'five_hour', percentUsed: 75, resetsAt: resetIn(2 * HOUR) }]

  await measure(80)
  await call('a')
  await measure(80, tight)
  await call('b')
  await measure(80)
  await call('c')

  expect(asked).toHaveLength(1)
  expect(ran).toEqual(['a', 'b', 'c'])
})

const deferred = () => {
  let resolve: (answer: string) => void = () => {}
  const promise = new Promise<string>(done => {
    resolve = done
  })

  return { promise, resolve }
}

const OVERRUN = [{ kind: 'five_hour', percentUsed: 100, resetsAt: resetIn(2.5 * HOUR) }]

test('an answer to an old level does not decide a new one', async ($, on) => {
  const open = deferred()
  const { asked, ran, measure, call } = await gate($, on, [open.promise, 'Continue'])

  await measure(80)
  const waiting = call('a')
  await measure(80, OVERRUN)
  open.resolve('Continue')
  await waiting

  expect(asked).toHaveLength(2)
  expect(asked[1]).toContain('pace over')
  expect(ran).toEqual(['a'])
})

test('a typed answer lets the call run and asks again', async ($, on) => {
  const { asked, ran, measure, call } = await gate($, on, ['maybe later', 'Continue'])

  await measure(80)
  const first = await call('a')
  await call('b')

  expect(first.deny).toBeUndefined()
  expect(asked).toHaveLength(2)
  expect(ran).toEqual(['a', 'b'])
})

const STORED_LIMIT = {
  context: { ladder: 'context', level: { name: 'full', at: 75, action: 'block' }, value: 80 },
  pace: null,
}

test('a value stored under another shape reads as no level', { options: { context_full_action: 'block' } }, async ($, on) => {
  on('state.get', (_, e, next) =>
    e.key === 'levels' ? { value: { value: STORED_LIMIT, version: 0 } } : next(e),
  )
  const { ran, call } = await gate($, on)

  const got = await call('a')

  expect(got.deny).toBeUndefined()
  expect(ran).toEqual(['a'])
})

test('a failing guard with no known level lets the call run', async ($, on) => {
  on('state.get', (_, e, next) =>
    e.key === 'levels' ? { value: { value: { shape: 'levels-1', value: null }, version: 0 } } : next(e),
  )
  const { ran, call } = await gate($, on)

  const got = await call('a')

  expect(got.deny).toBeUndefined()
  expect(ran).toEqual(['a'])
})

test('a malformed value under the same shape lets the call run', async ($, on) => {
  on('state.get', (_, e, next) =>
    e.key === 'levels'
      ? { value: { value: { shape: 'levels-2', value: { context: 'bad', pace: null } }, version: 0 } }
      : next(e),
  )
  const logs: string[] = []
  on('ui.log', (_, e) => {
    logs.push(e.text)

    return { value: undefined }
  })
  const { ran, call } = await gate($, on)

  await call('a')

  expect(ran).toEqual(['a'])
  expect(logs.some(text => text.includes('stored levels are unreadable'))).toBe(true)
})

test('a failing guard while an ask level is active lets the call run', async ($, on) => {
  const { ran, measure, call } = await gate($, on, [], 'broken')

  await measure(80)
  const got = await call('a')

  expect(got.deny).toBeUndefined()
  expect(ran).toEqual(['a'])
})

test('a failing guard while block is on keeps tools blocked', { options: { pace_hot_action: 'block' } }, async ($, on) => {
  const broken = { now: false }
  on('state.get', (_, e, next) =>
    broken.now && e.key === 'reading' ? { value: { value: { context: 10, rateLimits: 5 }, version: 1 } } : next(e),
  )
  const { ran, measure, call } = await gate($, on)

  await measure(10, [{ kind: 'five_hour', percentUsed: 81, resetsAt: resetIn(2.5 * HOUR) }])
  broken.now = true
  const got = await call('a')

  expect(got.deny).toBe('headroom: its guard failed while block was on, so tools stay blocked. Try again, or run /plugin disable headroom.')
  expect(ran).toEqual([])
})

test('levels stored under the old names are dropped', async ($, on) => {
  on('state.get', (_, e, next) =>
    e.key === 'levels'
      ? { value: { value: { shape: 'levels-1', value: { context: { ladder: 'context', level: { name: 'critical', at: 65, action: 'ask' }, value: 66 }, pace: null } }, version: 1 } }
      : next(e),
  )
  const { asked, ran, call } = await gate($, on)

  await call('a')

  expect(asked).toEqual([])
  expect(ran).toEqual(['a'])
})

test('the command marks a window that reset since the last reading', async ($, on) => {
  mock.clock(on, { now: NOW })
  usage(on, 20, [{ kind: 'five_hour', percentUsed: 80, resetsAt: resetIn(-60_000) }])
  await start(on, $)

  const { text } = await run($)

  expect(text).toContain('5h reset, no reading since')
  expect(text).not.toContain('80%')
})

test('the command labels a young window by its length', async ($, on) => {
  mock.clock(on, { now: NOW })
  usage(on, 20, [{ kind: 'five_hour', percentUsed: 3, resetsAt: resetIn(4.8 * HOUR) }])
  await start(on, $)

  const { text } = await run($)

  expect(text).toContain('5h       3%   pace n/a')
  expect(text).toContain('out ·')
})

test('a reset already past never arms', async ($, on) => {
  const { prompts, clock, measure } = await timer($, on)

  await measure(80, resetIn(-60_000))
  await clock.advance(HOUR)

  expect(prompts).toEqual([])
})

test('a failed wake is logged', async ($, on) => {
  const logs: string[] = []
  on('ui.log', (_, e) => {
    logs.push(e.text)

    return { value: undefined }
  })
  const { clock, measure } = await timer($, on, { isSubmitBroken: true })

  await measure(80, resetIn(HOUR))
  await clock.advance(HOUR + 60_000)

  expect(logs.some(text => text.includes('wake failed'))).toBe(true)
})

test('a reload under a raised wake_at drops the timer', { options: { wake_at: 90 } }, async ($, on) => {
  const { prompts, clock } = await timer($, on, { seed: ARMED, windows: HOT })

  await clock.advance(HOUR)

  expect(prompts).toEqual([])
})

test('a reload never wakes for a reset already past', async ($, on) => {
  const past = resetIn(-60_000)
  const { prompts, clock } = await timer($, on, {
    seed: past,
    windows: [{ kind: 'five_hour', percentUsed: 80, resetsAt: past }],
  })

  await clock.advance(HOUR)

  expect(prompts).toEqual([])
})

test('a clear cancels the timer', async ($, on) => {
  on('session.end', () => ({ sessionId: 's1' }))
  const { prompts, clock, measure } = await timer($, on)

  await measure(80, resetIn(HOUR))
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  await clock.advance(HOUR + 60_000)

  expect(prompts).toEqual([])
})

test('another end keeps the timer', async ($, on) => {
  on('session.end', () => ({ sessionId: 's1' }))
  const { prompts, clock, measure } = await timer($, on)

  await measure(80, resetIn(HOUR))
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
  await clock.advance(HOUR + 60_000)

  expect(prompts).toHaveLength(1)
})

test('a stored forecast loads at session start', async ($, on) => {
  const limit = { kind: 'five_hour', percentUsed: 81, resetsAt: resetIn(2.5 * HOUR) }
  mock.clock(on, { now: NOW })
  usage(on, 10, [limit])
  mock.store(on, { forecast: { five_hour: { at: NOW - 60_000, used: 81, resetsAt: limit.resetsAt, rate: 1 / HOUR } } })
  on('command.register', () => ({ value: { command: 'headroom' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const { text } = await run($)

  expect(text).toContain('out ·')
})

test('a broken stored forecast is ignored and logged', async ($, on) => {
  const logs: string[] = []
  mock.clock(on, { now: NOW })
  usage(on, 10, [{ kind: 'five_hour', percentUsed: 81, resetsAt: resetIn(2.5 * HOUR) }])
  mock.store(on, { forecast: 'x' })
  on('ui.log', (_, e) => {
    logs.push(e.text)

    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'headroom' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const { text } = await run($)

  expect(text).toContain('out 35m')
  expect(logs.some(line => line.includes('stored forecast is unreadable'))).toBe(true)
})

test('an empty stored forecast is not reported as unreadable', async ($, on) => {
  const logs: string[] = []
  mock.clock(on, { now: NOW })
  usage(on, 10, [])
  mock.store(on, { forecast: {} })
  on('ui.log', (_, e) => {
    logs.push(e.text)

    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'headroom' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(logs.filter(line => line.includes('unreadable'))).toEqual([])
})
