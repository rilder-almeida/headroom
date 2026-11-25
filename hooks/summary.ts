import type { BandInput } from './band'
import { contextRise, lookbackOf, span, usageRate } from './burst'
import { duration, outIn, step } from './forecast'
import { contextHit, paceOf, windowHit, windowOf } from './levels'
import type { Limit } from './levels'

const HOUR = 3_600_000

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const ORDER = ['five_hour', 'seven_day']

const two = (value: number): string => String(value).padStart(2, '0')

const local = (band: BandInput, ms: number): Date => new Date(ms - band.offset(ms) * 60_000)

const clock = (band: BandInput, ms: number): { time: string; isToday: boolean } => {
  const date = local(band, ms)
  const today = local(band, band.now)
  const time = `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`
  const isToday = date.toISOString().slice(0, 10) === today.toISOString().slice(0, 10)

  return { time: isToday ? time : `${WEEKDAYS[date.getUTCDay()]} at ${time}`, isToday }
}

const when = (band: BandInput, ms: number): string => {
  const { time, isToday } = clock(band, ms)

  return `${isToday ? 'at' : 'on'} ${time}`
}

const perHour = (rate: number): string => {
  const value = rate * HOUR

  return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
}

type Part = { label: string; out: number | null; head: string; burst: string }

const part = (band: BandInput, limit: Limit): Part | null => {
  const window = windowOf(limit.kind)
  const pace = paceOf(limit, band.now, band.config.tuning.warmup)
  const reset = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)

  if (window === undefined || pace === null || Number.isNaN(reset)) {
    return null
  }

  const level = windowHit(limit, band.now, band.config.pace, band.held, band.config.tuning)?.level.name ?? 'ok'
  const out = outIn(step(band.stored[limit.kind], limit, band.now, band.config.tuning), limit, band.now)
  const fate =
    out === null
      ? `lasts to its reset ${when(band, reset)}`
      : `runs out ${duration(reset - band.now - out)} before its reset, ${when(band, band.now + out)}`
  const rate = band.latches[limit.kind]?.isOn === true ? usageRate(band.samples[limit.kind], limit, band.now, band.config.tuning) : null
  const empty = rate === null ? Infinity : band.now + (100 - limit.percentUsed) / rate
  const burst =
    rate === null
      ? ''
      : ` The last ${span(lookbackOf(limit.kind, band.config.tuning) ?? 0)} burned ${perHour(rate)}% per hour${empty < reset ? `, enough to empty it by ${clock(band, empty).time}` : ''}.`

  return {
    label: window.label,
    out,
    head: `The ${window.label} window is ${level} at ${pace.value > 0 ? '+' : ''}${pace.value}% pace and ${fate}`,
    burst,
  }
}

const context = (band: BandInput): string => {
  const percent = band.reading?.context

  if (percent === undefined) {
    return ''
  }

  const level = contextHit(percent, band.config.context, band.held, band.config.tuning)?.level.name ?? 'ok'
  const rise = band.latches.context?.isOn === true ? contextRise(band.trail) : null
  const calls = band.trail.length - 1
  const growth = rise === null || rise <= 0 ? '' : `, up ${rise}% in the last ${calls} tool call${calls === 1 ? '' : 's'}`

  return `Context is ${level} at ${percent}%${growth}.`
}

/** One plain-prose diagnosis of context and each window: level, pace, run-out against the reset, and any burst. */
export const summary = (band: BandInput): string => {
  if (band.reading === null) {
    return ''
  }

  const parts = [...band.reading.rateLimits]
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
    .map(limit => part(band, limit))
    .filter((one): one is Part => one !== null)
  const early = parts.filter(one => one.out !== null)
  const tighter = early.length > 1 ? early.reduce((a, b) => ((b.out ?? 0) < (a.out ?? 0) ? b : a)) : undefined
  const windows = parts.map((one, i) => {
    const tail = tighter !== undefined && i === parts.length - 1 ? `, so ${tighter.label} is the tighter limit now` : ''

    return `${one.head}${tail}.${one.burst}`
  })

  return [context(band), ...windows].filter(text => text !== '').join(' ')
}
