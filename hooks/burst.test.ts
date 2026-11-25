import { describe, expect, test } from 'claude-code/testing'

import { DARK, contextRise, contextRule, follow, isSamples, latch, record, span, usageRate, usageRule } from './burst'
import type { Latch, Rule } from './burst'
import type { Trail } from './burst'
import { ladders } from './config'

const T = ladders({}).tuning

const MIN = 60_000
const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 25, 12)
const at = (ms: number) => new Date(NOW + ms).toISOString()
const R5 = at(2 * HOUR)
const R7 = at(60 * HOUR)

const trail = (resetsAt: string, points: [number, number][]): Trail => ({
  resetsAt,
  samples: points.map(([ago, used]) => ({ at: NOW - ago, used })),
})

describe('record', () => {
  for (const [name, prev, limit, expected] of [
    ['no trail yet, start one', undefined, { kind: 'five_hour', percentUsed: 30, resetsAt: R5 }, trail(R5, [[0, 30]])],
    ['same window, append the reading', trail(R5, [[10 * MIN, 20]]), { kind: 'five_hour', percentUsed: 30, resetsAt: R5 }, trail(R5, [[10 * MIN, 20], [0, 30]])],
    ['a sample is past the lookback, drop it', trail(R5, [[25 * MIN, 10], [10 * MIN, 20]]), { kind: 'five_hour', percentUsed: 30, resetsAt: R5 }, trail(R5, [[10 * MIN, 20], [0, 30]])],
    ['the 7d lookback, keep three hours', trail(R7, [[4 * HOUR, 10], [2 * HOUR, 12]]), { kind: 'seven_day', percentUsed: 14, resetsAt: R7 }, trail(R7, [[2 * HOUR, 12], [0, 14]])],
    ['the window reset, start over', trail(R5, [[10 * MIN, 20]]), { kind: 'five_hour', percentUsed: 2, resetsAt: at(5 * HOUR) }, trail(at(5 * HOUR), [[0, 2]])],
    ['usage dropped, start over', trail(R5, [[10 * MIN, 20]]), { kind: 'five_hour', percentUsed: 15, resetsAt: R5 }, trail(R5, [[0, 15]])],
    ['the same instant again, replace the last sample', trail(R5, [[10 * MIN, 20], [0, 25]]), { kind: 'five_hour', percentUsed: 26, resetsAt: R5 }, trail(R5, [[10 * MIN, 20], [0, 26]])],
    ['an unknown window, keep nothing', undefined, { kind: 'spend_limit', percentUsed: 30, resetsAt: R5 }, undefined],
    ['no reset time, keep nothing', undefined, { kind: 'five_hour', percentUsed: 30 }, undefined],
  ] as const) {
    test(name, () => {
      expect(record(prev, limit, NOW, T)).toEqual(expected)
    })
  }
})

describe('usageRate', () => {
  for (const [name, kept, limit, expected] of [
    ['a 5h trail over 20 minutes, 60% per hour', trail(R5, [[20 * MIN, 20], [0, 40]]), { kind: 'five_hour', percentUsed: 40, resetsAt: R5 }, 60],
    ['a 7d trail over three hours, 2% per hour', trail(R7, [[3 * HOUR, 10], [0, 16]]), { kind: 'seven_day', percentUsed: 16, resetsAt: R7 }, 2],
    ['samples past the lookback are ignored', trail(R5, [[40 * MIN, 0], [20 * MIN, 20], [0, 40]]), { kind: 'five_hour', percentUsed: 40, resetsAt: R5 }, 60],
    ['under half the lookback, no rate', trail(R5, [[9 * MIN, 20], [0, 40]]), { kind: 'five_hour', percentUsed: 40, resetsAt: R5 }, null],
    ['no trail, no rate', undefined, { kind: 'five_hour', percentUsed: 40, resetsAt: R5 }, null],
    ['an old window, no rate', trail(R5, [[20 * MIN, 20], [0, 40]]), { kind: 'five_hour', percentUsed: 40, resetsAt: at(5 * HOUR) }, null],
  ] as const) {
    test(name, () => {
      const got = usageRate(kept, limit, NOW, T)

      expect(got === null ? null : Math.round(got * HOUR * 1000) / 1000).toBe(expected)
    })
  }
})

describe('follow', () => {
  for (const [name, prev, percent, expected] of [
    ['the first reading, start the trail', [], 30, [30]],
    ['context grows, append', [30, 33], 36, [30, 33, 36]],
    ['past six readings, keep the last six', [1, 2, 3, 4, 5, 6], 7, [2, 3, 4, 5, 6, 7]],
    ['context dropped, start over', [30, 40], 12, [12]],
    ['no percent, keep the trail', [30], undefined, [30]],
  ] as const) {
    test(name, () => {
      expect(follow(prev, percent, T)).toEqual([...expected])
    })
  }
})

describe('contextRise', () => {
  for (const [name, kept, expected] of [
    ['one jump of 11', [30, 41], 11],
    ['five steps of 3', [30, 33, 36, 39, 42, 45], 15],
    ['a flat trail', [30, 30], 0],
    ['a single reading', [30], null],
    ['no reading', [], null],
  ] as const) {
    test(name, () => {
      expect(contextRise(kept)).toBe(expected)
    })
  }
})

const RULE: Rule = { on: 3, off: 2, settle: 5, pause: 20, isWorse: (value, told) => value >= told * 1.5 }
const ON: Latch = { isOn: true, belowSince: null, told: { at: 0, value: 3 } }

describe('latch', () => {
  for (const [name, prev, value, at, expected, tell] of [
    ['lights at the on bound and tells', DARK, 3, 0, { isOn: true, belowSince: null, told: { at: 0, value: 3 } }, true],
    ['stays dark below the on bound', DARK, 2.9, 0, DARK, false],
    ['holds above the off bound without telling', ON, 2.5, 6, ON, false],
    ['starts settling below the off bound', ON, 1.8, 10, { ...ON, belowSince: 10 }, false],
    ['a dip that comes back resets the settling', { ...ON, belowSince: 10 }, 2.4, 12, ON, false],
    ['still on before the settle time', { ...ON, belowSince: 10 }, 1.5, 14, { ...ON, belowSince: 10 }, false],
    ['goes out after the settle time', { ...ON, belowSince: 10 }, 1.5, 15, { isOn: false, belowSince: null, told: { at: 0, value: 3 } }, false],
    ['no value counts as below', ON, null, 10, { ...ON, belowSince: 10 }, false],
    ['relights inside the pause in silence', { ...DARK, told: { at: 0, value: 3 } }, 3.1, 19, { isOn: true, belowSince: null, told: { at: 0, value: 3 } }, false],
    ['relights after the pause and tells', { ...DARK, told: { at: 0, value: 3 } }, 3.1, 20, { isOn: true, belowSince: null, told: { at: 20, value: 3.1 } }, true],
    ['tells inside the pause when it got worse', { ...DARK, told: { at: 0, value: 3 } }, 4.5, 5, { isOn: true, belowSince: null, told: { at: 5, value: 4.5 } }, true],
    ['tells while on when it got worse', ON, 4.6, 8, { ...ON, told: { at: 8, value: 4.6 } }, true],
  ] as const) {
    test(name, () => {
      expect(latch(prev, value, at, RULE)).toEqual({ next: expected, tell })
    })
  }
})

describe('rules', () => {
  test('the 5h usage rule in percent per millisecond', () => {
    const rule = usageRule('five_hour', T)

    expect([rule?.on, rule?.off, rule?.settle, rule?.pause].map(one => (one === undefined ? one : Math.round(one * 1e9) / 1e9))).toEqual([
      Math.round((60 / HOUR) * 1e9) / 1e9,
      Math.round((40 / HOUR) * 1e9) / 1e9,
      5 * MIN,
      20 * MIN,
    ])
    expect(rule?.isWorse(1.5, 1)).toBe(true)
    expect(rule?.isWorse(1.4, 1)).toBe(false)
  })

  test('an unknown window has no rule', () => {
    expect(usageRule('spend_limit', T)).toBeUndefined()
  })

  test('the context rule in points and tool calls', () => {
    const rule = contextRule(T)

    expect([rule.on, rule.off, rule.settle, rule.pause]).toEqual([10, 5, 2, 5])
    expect(rule.isWorse(20, 10)).toBe(true)
    expect(rule.isWorse(19, 10)).toBe(false)
  })
})

describe('isSamples', () => {
  for (const [name, value, expected] of [
    ['a stored trail, accept it', { five_hour: trail(R5, [[0, 30]]) }, true],
    ['nothing stored per window, accept it', {}, true],
    ['a sample is not a number, reject it', { five_hour: { resetsAt: R5, samples: [{ at: 'x', used: 1 }] } }, false],
    ['no reset, reject it', { five_hour: { samples: [] } }, false],
    ['an array, reject it', [], false],
  ] as const) {
    test(name, () => {
      expect(isSamples(value)).toBe(expected)
    })
  }
})

describe('span', () => {
  for (const [ms, expected] of [
    [20 * MIN, '20 minutes'],
    [MIN, '1 minute'],
    [3 * HOUR, '3 hours'],
    [HOUR, '1 hour'],
    [90 * MIN, '90 minutes'],
  ] as const) {
    test(expected, () => {
      expect(span(ms)).toBe(expected)
    })
  }
})

describe('tuned rules', () => {
  const tuned = ladders({ burst_factor: 2, burst_release_factor: 1, burst_context_calls: 2, burst_context_points: 5, burst_context_release_points: 1 }).tuning

  test('a lower factor lights at 2x and releases at 1x', () => {
    const rule = usageRule('five_hour', tuned)

    expect([rule?.on, rule?.off].map(one => Math.round((one ?? 0) * HOUR))).toEqual([40, 20])
  })

  test('fewer calls keep a shorter trail and settle sooner', () => {
    expect(follow([1, 2, 3], 4, tuned)).toEqual([2, 3, 4])
    expect(contextRule(tuned).settle).toBe(1)
  })
})
