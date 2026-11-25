import { paceOf, windowOf } from './levels'
import type { Limit } from './levels'
import type { Forecast } from '../types'

export type { Forecast }

const MIN = 60_000
const HOUR = 60 * MIN
const JITTER = 5 * MIN

/** How long a reading takes to weigh half as much, per window kind. */
export const HALF_LIFE: Record<string, number> = { five_hour: HOUR, seven_day: 24 * HOUR }

const seed = (limit: Limit, now: number, reset: number): Forecast | undefined => {
  const window = windowOf(limit.kind)

  if (window === undefined || limit.resetsAt === undefined || paceOf(limit, now) === null) {
    return undefined
  }

  return {
    at: now,
    used: limit.percentUsed,
    resetsAt: limit.resetsAt,
    rate: limit.percentUsed / (window.length - (reset - now)),
  }
}

/** The forecast after one more reading, smoothed with the window's half-life. */
export const step = (prev: Forecast | undefined, limit: Limit, now: number): Forecast | undefined => {
  const reset = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)
  const halfLife = HALF_LIFE[limit.kind]

  if (Number.isNaN(reset) || halfLife === undefined) {
    return undefined
  }

  const isSameWindow =
    prev !== undefined &&
    Math.abs(reset - Date.parse(prev.resetsAt)) <= JITTER &&
    limit.percentUsed >= prev.used

  if (!isSameWindow) {
    return seed(limit, now, reset)
  }

  const gap = now - prev.at

  if (gap <= 0) {
    return prev
  }

  const segment = (limit.percentUsed - prev.used) / gap
  const alpha = 1 - 2 ** (-gap / halfLife)

  return {
    at: now,
    used: limit.percentUsed,
    resetsAt: limit.resetsAt ?? prev.resetsAt,
    rate: alpha * segment + (1 - alpha) * prev.rate,
  }
}

/** Milliseconds until the window runs out at the forecast rate, or null when it lasts to its reset. */
export const outIn = (state: Forecast | undefined, limit: Limit, now: number): number | null => {
  const reset = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)

  if (state === undefined || state.rate <= 0 || Number.isNaN(reset)) {
    return null
  }

  const out = (100 - limit.percentUsed) / state.rate

  return out < reset - now ? out : null
}

/** A short duration: `48m`, `1h05`, `2d 2h`. */
export const duration = (ms: number): string => {
  const minutes = Math.floor(ms / MIN)
  const hours = Math.floor(minutes / 60)

  if (hours === 0) {
    return `${minutes}m`
  }

  if (hours < 24) {
    return `${hours}h${String(minutes % 60).padStart(2, '0')}`
  }

  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** Whether a stored value has the shape of a forecast. */
export const isForecast = (value: unknown): value is Forecast =>
  typeof value === 'object' &&
  value !== null &&
  'at' in value &&
  'used' in value &&
  'resetsAt' in value &&
  'rate' in value &&
  isNumber(value.at) &&
  isNumber(value.used) &&
  typeof value.resetsAt === 'string' &&
  isNumber(value.rate)

/** The run-out text of a window from its stored forecast: a duration, or `·` when it lasts to its reset. */
export const runOut = (stored: Forecast | undefined, limit: Limit, now: number): string => {
  const out = outIn(step(stored, limit, now), limit, now)

  return out === null ? '·' : duration(out)
}
