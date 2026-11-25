import { describe, expect, test } from 'claude-code/testing'

import type { BandInput } from './band'
import { ladders } from './config'
import { summary } from './summary'
import type { Latches, Reading, Samples } from '../types'

const MIN = 60_000
const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 25, 12)
const at = (ms: number) => new Date(NOW + ms).toISOString()

const band = (
  context: number | undefined,
  rateLimits: Reading['rateLimits'],
  trail: number[] = [],
  samples: Samples = {},
  latches: Latches = {},
): BandInput => ({ reading: { context, rateLimits }, stored: {}, samples, trail, latches, held: {}, config: ladders({}), now: NOW, offset: () => 0 })

const LIT = { isOn: true, belowSince: null, told: null }

const TIGHT_5H = { kind: 'five_hour', percentUsed: 61, resetsAt: at(137 * MIN) }
const TIGHT_7D = { kind: 'seven_day', percentUsed: 44, resetsAt: at(114.82 * HOUR) }
const CALM_5H = { kind: 'five_hour', percentUsed: 46, resetsAt: at(2.5 * HOUR) }
const CALM_7D = { kind: 'seven_day', percentUsed: 52, resetsAt: at(84 * HOUR) }
const SPIKE: Samples = {
  five_hour: {
    resetsAt: TIGHT_5H.resetsAt,
    samples: [
      { at: NOW - 20 * MIN, used: 41 },
      { at: NOW, used: 61 },
    ],
  },
}

describe('summary', () => {
  for (const [name, input, expected] of [
    [
      'one window lasts, one runs out',
      band(31, [CALM_5H, CALM_7D]),
      'Context is ok at 31%. The 5h window is ok at -8% pace and lasts to its reset at 14:30. The 7d window is ok at +4% pace and runs out 6h27 before its reset, on Saturday at 17:32.',
    ],
    [
      'both windows run out early',
      band(52, [TIGHT_5H, TIGHT_7D]),
      'Context is warm at 52%. The 5h window is ok at +12% pace and runs out 32m before its reset, at 13:44. The 7d window is warm at +39% pace and runs out 1d 23h before its reset, on Saturday at 07:41, so 5h is the tighter limit now.',
    ],
    [
      'a 5h burst and a context burst',
      band(52, [TIGHT_5H, TIGHT_7D], [41, 52], SPIKE, { context: LIT, five_hour: LIT }),
      'Context is warm at 52%, up 11% in the last 1 tool call. The 5h window is ok at +12% pace and runs out 32m before its reset, at 13:44. The last 20 minutes burned 60% per hour, enough to empty it by 12:39. The 7d window is warm at +39% pace and runs out 1d 23h before its reset, on Saturday at 07:41, so 5h is the tighter limit now.',
    ],
    [
      'a burst that would not empty the window',
      band(31, [{ kind: 'five_hour', percentUsed: 46, resetsAt: at(30 * MIN) }], [], {
        five_hour: { resetsAt: at(30 * MIN), samples: [{ at: NOW - 20 * MIN, used: 26 }, { at: NOW, used: 46 }] },
      }, { five_hour: LIT }),
      'Context is ok at 31%. The 5h window is ok at -49% pace and lasts to its reset at 12:30. The last 20 minutes burned 60% per hour.',
    ],
    ['no subscription', band(52, []), 'Context is warm at 52%.'],
    ['context unknown', band(undefined, [CALM_5H]), 'The 5h window is ok at -8% pace and lasts to its reset at 14:30.'],
    ['a young window', band(10, [{ kind: 'five_hour', percentUsed: 3, resetsAt: at(4.8 * HOUR) }]), 'Context is ok at 10%.'],
    ['an unknown window', band(10, [{ kind: 'spend_limit', percentUsed: 30, resetsAt: at(HOUR) }]), 'Context is ok at 10%.'],
  ] as const) {
    test(name, () => {
      expect(summary(input)).toBe(expected)
    })
  }

  test('a burst still lit while its rise eased reports no growth', () => {
    expect(summary(band(45, [], [44, 45], {}, { context: LIT }))).toBe('Context is warm at 45%, up 1% in the last 1 tool call.')
    expect(summary(band(45, [], [45], {}, { context: LIT }))).toBe('Context is warm at 45%.')
  })

  test('a spike with its latch out is not reported', () => {
    expect(summary(band(52, [TIGHT_5H], [41, 52], SPIKE))).toBe(
      'Context is warm at 52%. The 5h window is ok at +12% pace and runs out 32m before its reset, at 13:44.',
    )
  })

  test('no reading yet', () => {
    expect(summary({ ...band(10, []), reading: null })).toBe('')
  })

  test('a context burst over several calls counts them', () => {
    expect(summary(band(45, [], [30, 33, 36, 39, 42, 45], {}, { context: LIT }))).toBe(
      'Context is warm at 45%, up 15% in the last 5 tool calls.',
    )
  })
})
