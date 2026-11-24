import { describe, expect, test } from 'claude-code/testing'

import { ladders } from './config'
import {
  band,
  contextHit,
  effective,
  line,
  paceHit,
  paceOf,
  sameGate,
  sameLevels,
} from './levels'

const D = ladders({})
const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 23, 12)
const resetIn = (ms: number) => new Date(NOW + ms).toISOString()

describe('contextHit', () => {
  for (const [percent, expected] of [
    [44, null],
    [45, 'opportunity'],
    [64, 'opportunity'],
    [65, 'critical'],
    [80, 'limit'],
    [undefined, null],
  ] as const) {
    test(`${percent} gives ${expected}`, () => {
      expect(contextHit(percent, D.context)?.level.name ?? null).toBe(expected)
    })
  }
})

describe('paceOf', () => {
  for (const [name, limit, expected] of [
    ['half the 5h window at 75%', { kind: 'five_hour', percentUsed: 75, resetsAt: resetIn(2.5 * HOUR) }, { value: 50, window: '5h' }],
    ['the 7d window evenly spent', { kind: 'seven_day', percentUsed: 50, resetsAt: resetIn(84 * HOUR) }, { value: 0, window: '7d' }],
    ['under 10% elapsed', { kind: 'five_hour', percentUsed: 5, resetsAt: resetIn(4.6 * HOUR) }, null],
    ['no reset time', { kind: 'five_hour', percentUsed: 75 }, null],
    ['a reset in the past', { kind: 'five_hour', percentUsed: 75, resetsAt: resetIn(-HOUR) }, null],
    ['a reset beyond the window', { kind: 'five_hour', percentUsed: 75, resetsAt: resetIn(6 * HOUR) }, null],
    ['a spend limit', { kind: 'spend_limit', percentUsed: 75, resetsAt: resetIn(HOUR) }, null],
  ] as const) {
    test(name, () => {
      expect(paceOf(limit, NOW)).toEqual(expected)
    })
  }
})

test('paceHit takes the worst window', () => {
  const hit = paceHit(
    [
      { kind: 'five_hour', percentUsed: 77, resetsAt: resetIn(2.5 * HOUR) },
      { kind: 'seven_day', percentUsed: 92, resetsAt: resetIn(84 * HOUR) },
    ],
    NOW,
    D.pace,
  )

  expect(hit).toEqual({ ladder: 'pace', level: D.pace[1], value: 84, window: '7d' })
})

test('paceHit is null with no windows', () => {
  expect(paceHit([], NOW, D.pace)).toBeNull()
})

const limit = { ladder: 'context', level: D.context[2]!, value: 77 } as const
const critical = { ladder: 'context', level: D.context[1]!, value: 67 } as const
const tight = { ladder: 'pace', level: D.pace[0]!, value: 25, window: '5h' } as const
const short = { ladder: 'pace', level: D.pace[1]!, value: 54, window: '5h' } as const

describe('effective', () => {
  for (const [name, active, expected] of [
    ['nothing active', { context: null, pace: null }, 'none'],
    ['the most severe wins', { context: limit, pace: tight }, 'ask'],
    ['one ladder alone', { context: null, pace: tight }, 'alert'],
  ] as const) {
    test(name, () => {
      expect(effective(active)).toBe(expected)
    })
  }
})

describe('sameLevels', () => {
  for (const [name, a, b, expected] of [
    ['same names, other values', { context: critical, pace: null }, { context: { ...critical, value: 70 }, pace: null }, true],
    ['a level appears', { context: null, pace: null }, { context: critical, pace: null }, false],
    ['a level changes', { context: critical, pace: null }, { context: limit, pace: null }, false],
  ] as const) {
    test(name, () => {
      expect(sameLevels(a, b)).toBe(expected)
    })
  }
})

describe('sameGate', () => {
  for (const [name, a, b, expected] of [
    ['an alert level appears', { context: limit, pace: null }, { context: limit, pace: tight }, true],
    ['an ask level appears', { context: limit, pace: null }, { context: limit, pace: short }, false],
    ['an ask level leaves', { context: limit, pace: null }, { context: critical, pace: null }, false],
  ] as const) {
    test(name, () => {
      expect(sameGate(a, b)).toBe(expected)
    })
  }
})

describe('line', () => {
  for (const [hit, expected] of [
    [limit, 'headroom: context limit 77%: stop now and start a fresh session'],
    [short, 'headroom: pace short +54% (5h): show the pace and ask before starting long work'],
  ] as const) {
    test(expected, () => {
      expect(line(hit)).toBe(expected)
    })
  }
})

test('band lists each active level', () => {
  expect(band({ context: critical, pace: short })).toBe(
    'context critical 67% · pace short +54% (5h)',
  )
})
