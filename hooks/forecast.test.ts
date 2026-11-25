import { describe, expect, test } from 'claude-code/testing'

import { duration, isForecast, outIn, runOut, step } from './forecast'
import type { Forecast } from './forecast'
import { ladders } from './config'

const T = ladders({}).tuning

const MIN = 60_000
const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 25, 12)
const at = (ms: number) => new Date(NOW + ms).toISOString()

const R7 = at(84 * HOUR)
const r0 = 0.5 / HOUR
const prev7: Forecast = { at: NOW - 24 * HOUR, used: 20, resetsAt: R7, rate: r0 }
const seed5 = 61 / (163 * MIN)

describe('step', () => {
  for (const [name, prev, limit, now, expected] of [
    ['seeds on the first reading', undefined, { kind: 'five_hour', percentUsed: 61, resetsAt: at(137 * MIN) }, NOW, seed5],
    ['keeps a steady rate', prev7, { kind: 'seven_day', percentUsed: 20 + r0 * 24 * HOUR, resetsAt: R7 }, NOW, r0],
    ['weighs one half-life as half', prev7, { kind: 'seven_day', percentUsed: 20 + 2 * r0 * 24 * HOUR, resetsAt: R7 }, NOW, 1.5 * r0],
    ['keeps a reset 4:59 apart', prev7, { kind: 'seven_day', percentUsed: 20 + 2 * r0 * 24 * HOUR, resetsAt: at(84 * HOUR + 299_000) }, NOW, 1.5 * r0],
    ['reseeds on a reset 5:01 apart', prev7, { kind: 'seven_day', percentUsed: 44, resetsAt: at(84 * HOUR + 301_000) }, NOW, 44 / (84 * HOUR - 301_000)],
    ['ignores reset jitter', prev7, { kind: 'seven_day', percentUsed: 20 + 2 * r0 * 24 * HOUR, resetsAt: at(84 * HOUR + 30_000) }, NOW, 1.5 * r0],
    ['reseeds on a new reset', prev7, { kind: 'seven_day', percentUsed: 44, resetsAt: at(86 * HOUR) }, NOW, 44 / (82 * HOUR)],
    ['reseeds when usage drops', prev7, { kind: 'seven_day', percentUsed: 10, resetsAt: R7 }, NOW, 10 / (84 * HOUR)],
  ] as const) {
    test(name, () => {
      const got = step(prev, limit, now, T)

      expect(Math.abs((got?.rate ?? NaN) / expected - 1)).toBeLessThan(1e-9)
      expect(got).toMatchObject({ at: now, used: limit.percentUsed, resetsAt: limit.resetsAt })
    })
  }

  for (const [name, prev, limit, now, expected] of [
    ['no time passed', prev7, { kind: 'seven_day', percentUsed: 30, resetsAt: R7 }, prev7.at, prev7],
    ['the clock went back', prev7, { kind: 'seven_day', percentUsed: 30, resetsAt: R7 }, prev7.at - HOUR, prev7],
    ['first 10% of the window', undefined, { kind: 'five_hour', percentUsed: 5, resetsAt: at(4.6 * HOUR) }, NOW, undefined],
    ['an unknown window', undefined, { kind: 'spend_limit', percentUsed: 50, resetsAt: at(HOUR) }, NOW, undefined],
    ['no reset time', undefined, { kind: 'five_hour', percentUsed: 50 }, NOW, undefined],
  ] as const) {
    test(name, () => {
      expect(step(prev, limit, now, T)).toEqual(expected)
    })
  }
})

describe('outIn', () => {
  const limit = { kind: 'five_hour', percentUsed: 61, resetsAt: at(137 * MIN) }
  const state = (rate: number): Forecast => ({ at: NOW, used: 61, resetsAt: limit.resetsAt, rate })

  for (const [name, forecast, used, expected] of [
    ['runs out before the reset', state(22.4 / HOUR), 61, (39 / 22.4) * HOUR],
    ['no spend', state(0), 61, null],
    ['runs out after the reset', state(5 / HOUR), 61, null],
    ['no forecast', undefined, 61, null],
    ['usage past 100%', state(1 / HOUR), 104, 0],
  ] as const) {
    test(name, () => {
      const got = outIn(forecast, { ...limit, percentUsed: used }, NOW)

      if (expected === null) {
        expect(got).toBeNull()
      } else {
        expect(Math.abs((got ?? 0) - expected)).toBeLessThan(1000)
      }
    })
  }
})

describe('duration', () => {
  for (const [ms, expected] of [
    [48 * MIN, '48m'],
    [104 * MIN, '1h44'],
    [65 * MIN, '1h05'],
    [50 * HOUR, '2d 2h'],
    [24 * HOUR, '1d 0h'],
  ] as const) {
    test(expected, () => {
      expect(duration(ms)).toBe(expected)
    })
  }
})

describe('isForecast', () => {
  for (const [name, value, expected] of [
    ['a forecast', { at: 1, used: 2, resetsAt: 'x', rate: 3 }, true],
    ['no rate', { at: 1, used: 2, resetsAt: 'x' }, false],
    ['null', null, false],
    ['a string', 'x', false],
  ] as const) {
    test(name, () => {
      expect(isForecast(value)).toBe(expected)
    })
  }
})

describe('runOut', () => {
  const limit = { kind: 'five_hour', percentUsed: 81, resetsAt: at(2.5 * HOUR) }

  for (const [name, stored, expected] of [
    ['seeds without a stored forecast', undefined, '35m'],
    ['lasts to the reset at a slow stored rate', { at: NOW - MIN, used: 81, resetsAt: limit.resetsAt, rate: 1 / HOUR }, '·'],
  ] as const) {
    test(name, () => {
      expect(runOut(stored, limit, NOW, T)).toBe(expected)
    })
  }
})
