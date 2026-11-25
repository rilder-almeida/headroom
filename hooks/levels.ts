import type { Action, Active, Hit, Level, LevelName } from '../types'

/** One rate-limit window as the engine reports it. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

const HOUR = 3_600_000

const WINDOWS: Record<string, { length: number; label: '5h' | '7d' }> = {
  five_hour: { length: 5 * HOUR, label: '5h' },
  seven_day: { length: 168 * HOUR, label: '7d' },
}

const SEVERITY: readonly Action[] = ['none', 'alert', 'ask', 'block']

const ADVICE: Record<Hit['ladder'], Partial<Record<LevelName, string>>> = {
  context: {
    warm: 'consider a fresh session at the next natural stop point',
    hot: 'finish the current piece only, then start a fresh session',
    full: 'stop now and start a fresh session',
  },
  pace: {
    warm: 'spending faster than the window allows, ease off',
    hot: 'show the pace and ask before starting long work',
    over: 'start nothing new, finish the current step, then pause',
  },
}

/** The length and short label of a rate-limit window kind headroom knows. */
export const windowOf = (kind: string): { length: number; label: '5h' | '7d' } | undefined =>
  WINDOWS[kind]

const highest = (value: number, ladder: readonly Level[]): Level | undefined =>
  ladder.filter(level => level.at <= value).at(-1)

/** The context level reached by a fill percent, or null. */
export const contextHit = (
  percent: number | undefined,
  ladder: readonly Level[],
): Hit | null => {
  if (percent === undefined) {
    return null
  }

  const level = highest(percent, ladder)

  return level === undefined ? null : { ladder: 'context', level, value: percent }
}

/** How much faster than an even spread to its reset a window is spent, in percent. */
export const paceOf = (
  limit: Limit,
  now: number,
): { value: number; window: '5h' | '7d' } | null => {
  const window = windowOf(limit.kind)
  const reset = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)

  if (window === undefined || Number.isNaN(reset)) {
    return null
  }

  const left = reset - now
  const elapsed = window.length - left

  if (left <= 0 || left > window.length || elapsed < window.length / 10) {
    return null
  }

  return {
    value: Math.round((limit.percentUsed * window.length) / elapsed) - 100,
    window: window.label,
  }
}

/** The highest pace level any window reaches, ties going to the larger value. */
export const paceHit = (
  limits: readonly Limit[],
  now: number,
  ladder: readonly Level[],
): Hit | null => {
  let worst: Hit | null = null

  for (const limit of limits) {
    const pace = paceOf(limit, now)
    const level = pace === null ? undefined : highest(pace.value, ladder)

    if (pace === null || level === undefined) {
      continue
    }

    const isWorse =
      worst === null ||
      level.at > worst.level.at ||
      (level.at === worst.level.at && pace.value > worst.value)

    if (isWorse) {
      worst = { ladder: 'pace', level, value: pace.value, window: pace.window }
    }
  }

  return worst
}

const rank = (action: Action): number => SEVERITY.indexOf(action)

/** The most severe action among the active levels. */
export const effective = (active: Active): Action =>
  [active.context, active.pace].reduce<Action>(
    (most, hit) =>
      hit !== null && rank(hit.level.action) > rank(most) ? hit.level.action : most,
    'none',
  )

/** Whether two readings sit on the same level of each ladder. */
export const sameLevels = (a: Active, b: Active): boolean =>
  a.context?.level.name === b.context?.level.name &&
  a.pace?.level.name === b.pace?.level.name

const gating = (hit: Hit | null): string | undefined =>
  hit !== null && atLeast(hit.level.action, 'ask') ? hit.level.name : undefined

/** Whether two readings hold the same levels that ask or block. */
export const sameGate = (a: Active, b: Active): boolean =>
  gating(a.context) === gating(b.context) && gating(a.pace) === gating(b.pace)

/** Whether an action is at least as severe as another. */
export const atLeast = (action: Action, floor: Action): boolean =>
  rank(action) >= rank(floor)

const value = (hit: Hit): string =>
  hit.ladder === 'context'
    ? `${hit.value}%`
    : `${hit.value > 0 ? '+' : ''}${hit.value}% (${hit.window})`

const label = (hit: Hit): string => `${hit.ladder} ${hit.level.name} ${value(hit)}`

/** The sentence headroom shows and hands to the model for one level. */
export const line = (hit: Hit): string =>
  `headroom: ${label(hit)}: ${ADVICE[hit.ladder][hit.level.name] ?? ''}`

/** The band text: every active level, context first. */
export const band = (active: Active): string =>
  [active.context, active.pace]
    .filter((hit): hit is Hit => hit !== null)
    .map(label)
    .join(' · ')
