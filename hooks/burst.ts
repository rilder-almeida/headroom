import { isSameReset } from './forecast'
import { windowOf } from './levels'
import type { Limit } from './levels'
import type { Held, Kept, Latch, Latches, Sample, Samples, Trail, Tuning } from '../types'

export type { Kept, Latch, Latches, Sample, Samples, Trail }

const MIN = 60_000
const HOUR = 60 * MIN

/** How far back the burst of a window kind looks, or undefined for a kind headroom does not know. */
export const lookbackOf = (kind: string, tuning: Tuning): number | undefined =>
  kind === 'five_hour' || kind === 'seven_day' ? tuning.lookback[kind] : undefined

/** A lookback in words: `20 minutes`, `3 hours`, `1 hour`. */
export const span = (ms: number): string => {
  const [count, unit] = ms % HOUR === 0 ? [ms / HOUR, 'hour'] : [Math.round(ms / MIN), 'minute']

  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

const isSameWindow = (resetsAt: string, limit: Limit, tuning: Tuning): boolean =>
  limit.resetsAt !== undefined && isSameReset(Date.parse(limit.resetsAt), Date.parse(resetsAt), tuning)

/** The trail after one more reading: older samples dropped, a reset or a drop starting it over. */
export const record = (prev: Trail | undefined, limit: Limit, now: number, tuning: Tuning): Trail | undefined => {
  const lookback = lookbackOf(limit.kind, tuning)

  if (lookback === undefined || limit.resetsAt === undefined || Number.isNaN(Date.parse(limit.resetsAt))) {
    return undefined
  }

  const last = prev?.samples.at(-1)
  const kept =
    prev !== undefined && last !== undefined && isSameWindow(prev.resetsAt, limit, tuning) && limit.percentUsed >= last.used
      ? prev.samples.filter(sample => sample.at >= now - lookback && sample.at < now)
      : []

  return { resetsAt: limit.resetsAt, samples: [...kept, { at: now, used: limit.percentUsed }] }
}

/** The recent spend of a window in percent per millisecond, or null while its samples span under half the lookback. */
export const usageRate = (trail: Trail | undefined, limit: Limit, now: number, tuning: Tuning): number | null => {
  const lookback = lookbackOf(limit.kind, tuning)
  const samples = trail?.samples.filter(sample => sample.at >= now - (lookback ?? 0)) ?? []
  const first = samples[0]
  const last = samples.at(-1)

  if (
    trail === undefined ||
    lookback === undefined ||
    first === undefined ||
    last === undefined ||
    !isSameWindow(trail.resetsAt, limit, tuning) ||
    last.at - first.at < lookback / 2
  ) {
    return null
  }

  return (last.used - first.used) / (last.at - first.at)
}

/** The context trail after one tool call: the last readings kept, a drop starting it over. */
export const follow = (prev: readonly number[], percent: number | undefined, tuning: Tuning): number[] => {
  if (percent === undefined) {
    return [...prev]
  }

  const last = prev.at(-1)

  return last !== undefined && percent < last ? [percent] : [...prev, percent].slice(-(tuning.contextCalls + 1))
}

/** The context rise over the trail, or null with fewer than two readings. */
export const contextRise = (trail: readonly number[]): number | null => {
  const first = trail[0]
  const last = trail.at(-1)

  return first === undefined || last === undefined || trail.length < 2 ? null : last - first
}

/** When a burst lights, holds, goes out and speaks: times in milliseconds for usage, tool calls for context. */
export type Rule = { on: number; off: number; settle: number; pause: number; isWorse: (value: number, told: number) => boolean }

/** A latch nothing has lit yet. */
export const DARK: Latch = { isOn: false, belowSince: null, told: null }

const WORSE = 1.5

/** The rule of a window kind's usage burst, in percent per millisecond, or undefined for a kind headroom does not know. */
export const usageRule = (kind: string, tuning: Tuning): Rule | undefined => {
  const window = windowOf(kind)
  const lookback = lookbackOf(kind, tuning)

  if (window === undefined || lookback === undefined) {
    return undefined
  }

  const safe = 100 / window.length

  return {
    on: tuning.burstFactor * safe,
    off: tuning.releaseFactor * safe,
    settle: lookback / 4,
    pause: lookback,
    isWorse: (value, told) => value >= told * WORSE,
  }
}

/** The rule of the context burst, in points and tool calls. */
export const contextRule = (tuning: Tuning): Rule => ({
  on: tuning.contextRise,
  off: tuning.contextRelease,
  settle: Math.ceil(tuning.contextCalls / 4),
  pause: tuning.contextCalls,
  isWorse: (value, told) => value >= told + tuning.contextRise,
})

/** The latch after one more value, and whether the model hears about it: on lighting outside the pause, or when it got worse than last told. */
export const latch = (prev: Latch, value: number | null, at: number, rule: Rule): { next: Latch; tell: boolean } => {
  const level = value ?? -Infinity
  const lights = !prev.isOn && level >= rule.on
  const belowSince = prev.isOn && level < rule.off ? (prev.belowSince ?? at) : null
  const isOn = lights || (prev.isOn && (belowSince === null || at - belowSince < rule.settle))
  const { told } = prev
  const tell =
    isOn &&
    value !== null &&
    ((lights && (told === null || at - told.at >= rule.pause)) || (told !== null && rule.isWorse(value, told.value)))

  return { next: { isOn, belowSince: isOn ? belowSince : null, told: tell ? { at, value } : told }, tell }
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const isSample = (value: unknown): value is Sample =>
  typeof value === 'object' && value !== null && 'at' in value && 'used' in value && isNumber(value.at) && isNumber(value.used)

const isTrail = (value: unknown): value is Trail =>
  typeof value === 'object' &&
  value !== null &&
  'resetsAt' in value &&
  'samples' in value &&
  typeof value.resetsAt === 'string' &&
  Array.isArray(value.samples) &&
  value.samples.every(isSample)

/** Whether a stored value has the shape of the usage samples. */
export const isSamples = (value: unknown): value is Samples =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every(isTrail)

const NAMES = ['warm', 'hot', 'full', 'over']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isLatch = (value: unknown): value is Latch =>
  isRecord(value) &&
  typeof value.isOn === 'boolean' &&
  (value.belowSince === null || isNumber(value.belowSince)) &&
  (value.told === null || (isRecord(value.told) && isNumber(value.told.at) && isNumber(value.told.value)))

/** Whether a stored value has the shape of the kept usage burst and margin state. */
export const isKept = (value: unknown): value is Kept =>
  isRecord(value) &&
  isRecord(value.latches) &&
  Object.values(value.latches).every(isLatch) &&
  isRecord(value.held) &&
  Object.values(value.held).every(name => typeof name === 'string' && NAMES.includes(name))

const usageOnly = <T>(record: Partial<Record<string, T>>): Partial<Record<string, T>> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => windowOf(key) !== undefined))

/** The part of the burst and margin state that belongs to the account: the rate-limit windows, never the context. */
export const keepOf = (latches: Latches, held: Held): Kept => ({ latches: usageOnly(latches), held: usageOnly(held) })
