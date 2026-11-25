import { describe, expect, test } from 'claude-code/testing'

import { ladders } from './config'
import {
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
} from './levels'

const D = ladders({})
const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 23, 12)
const resetIn = (ms: number) => new Date(NOW + ms).toISOString()

describe('contextHit', () => {
  for (const [percent, expected] of [
    [44, null],
    [45, 'warm'],
    [64, 'warm'],
    [65, 'hot'],
    [80, 'full'],
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

const full = { ladder: 'context', level: D.context[2]!, value: 77 } as const
const hot = { ladder: 'context', level: D.context[1]!, value: 67 } as const
const warm = { ladder: 'pace', level: D.pace[0]!, value: 25, window: '5h' } as const
const paceHot = { ladder: 'pace', level: D.pace[1]!, value: 54, window: '5h' } as const

describe('effective', () => {
  for (const [name, active, expected] of [
    ['nothing active', { context: null, pace: null }, 'none'],
    ['the most severe wins', { context: full, pace: warm }, 'ask'],
    ['one ladder alone', { context: null, pace: warm }, 'alert'],
  ] as const) {
    test(name, () => {
      expect(effective(active)).toBe(expected)
    })
  }
})

describe('sameLevels', () => {
  for (const [name, a, b, expected] of [
    ['same names, other values', { context: hot, pace: null }, { context: { ...hot, value: 70 }, pace: null }, true],
    ['a level appears', { context: null, pace: null }, { context: hot, pace: null }, false],
    ['a level changes', { context: hot, pace: null }, { context: full, pace: null }, false],
  ] as const) {
    test(name, () => {
      expect(sameLevels(a, b)).toBe(expected)
    })
  }
})

describe('sameGate', () => {
  for (const [name, a, b, expected] of [
    ['an alert level appears', { context: full, pace: null }, { context: full, pace: warm }, true],
    ['an ask level appears', { context: full, pace: null }, { context: full, pace: paceHot }, false],
    ['an ask level leaves', { context: full, pace: null }, { context: hot, pace: null }, false],
  ] as const) {
    test(name, () => {
      expect(sameGate(a, b)).toBe(expected)
    })
  }
})

const hot66 = { ladder: 'context', level: D.context[1]!, value: 66 } as const
const warm7d = { ladder: 'pace', level: D.pace[0]!, value: 39, window: '7d' } as const

describe('line', () => {
  for (const [name, hit, out, expected] of [
    ['context', hot66, undefined, 'headroom: context hot 66%: finish the current piece only, then start a fresh session'],
    ['context ignores out', hot66, '1h', 'headroom: context hot 66%: finish the current piece only, then start a fresh session'],
    ['pace with out', warm7d, '2d 2h', 'headroom: 7d pace warm +39%, out in 2d 2h: spending faster than the window allows, ease off'],
    ['pace without out', warm7d, undefined, 'headroom: 7d pace warm +39%: spending faster than the window allows, ease off'],
    ['last level', full, undefined, 'headroom: context full 77%: stop now and start a fresh session'],
  ] as const) {
    test(name, () => {
      expect(line(hit, out)).toBe(expected)
    })
  }
})

describe('rangeOf', () => {
  for (const [name, value, ladder, expected] of [
    ['context warm', 52, 'context', '<65%'],
    ['context ok', 30, 'context', '<45%'],
    ['context full', 80, 'context', '>75%'],
    ['pace below zero', -40, 'pace', '<+20%'],
    ['pace warm', 39, 'pace', '<+50%'],
    ['pace over', 120, 'pace', '>+100%'],
  ] as const) {
    test(name, () => {
      expect(rangeOf(value, D[ladder], ladder === 'pace')).toBe(expected)
    })
  }
})

describe('stageOf', () => {
  for (const [name, hit, expected] of [
    ['ok', null, 0],
    ['warm', warm, 1],
    ['hot', hot, 2],
    ['full', full, 3],
  ] as const) {
    test(name, () => {
      expect(stageOf(hit, hit?.ladder === 'pace' ? D.pace : D.context)).toBe(expected)
    })
  }
})

describe('windowHit', () => {
  for (const [name, limit, expected] of [
    ['5h at pace +62', { kind: 'five_hour', percentUsed: 81, resetsAt: resetIn(2.5 * HOUR) }, { name: 'hot', value: 62, window: '5h' }],
    ['7d evenly spent', { kind: 'seven_day', percentUsed: 50, resetsAt: resetIn(84 * HOUR) }, null],
    ['under 10% elapsed', { kind: 'five_hour', percentUsed: 5, resetsAt: resetIn(4.6 * HOUR) }, null],
  ] as const) {
    test(name, () => {
      const hit = windowHit(limit, NOW, D.pace)

      expect(hit === null ? null : { name: hit.level.name, value: hit.value, window: hit.ladder === 'pace' ? hit.window : null }).toEqual(expected)
    })
  }
})
