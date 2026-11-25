import { describe, expect, test } from 'claude-code/testing'

import { compact, full, plain } from './band'
import type { BandInput } from './band'
import { ladders } from './config'
import type { Reading } from '../types'

const MIN = 60_000
const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 25, 12)
const at = (ms: number) => new Date(NOW + ms).toISOString()

const input = (context: number | undefined, rateLimits: Reading['rateLimits']): BandInput => ({
  reading: { context, rateLimits },
  stored: {},
  config: ladders({}),
  now: NOW,
})

const CALM = input(31, [
  { kind: 'five_hour', percentUsed: 46, resetsAt: at(2.5 * HOUR) },
  { kind: 'seven_day', percentUsed: 52, resetsAt: at(84 * HOUR) },
])
const WARM = input(52, [
  { kind: 'five_hour', percentUsed: 61, resetsAt: at(137 * MIN) },
  { kind: 'seven_day', percentUsed: 44, resetsAt: at(114.82 * HOUR) },
])
const TIGHT = input(80, [{ kind: 'five_hour', percentUsed: 81, resetsAt: at(2.5 * HOUR) }])
const SOLO = input(52, [])

describe('compact', () => {
  for (const [name, band, expected, colors] of [
    ['a calm session', CALM, '●○○○  │  5h ▼8%   7d ▲4% ⧗ 3d5h', ['inactive', 'inactive', 'inactive']],
    ['warm context and 7d', WARM, '●●○○  │  5h ▲12% ⧗ 1h44   7d ▲39% ⧗ 2d19h', ['warning', 'inactive', 'warning']],
    ['full context, hot 5h', TIGHT, '●●●●  │  5h ▲62% ⧗ 35m', ['error', 'claude']],
    ['no subscription', SOLO, '●●○○', ['warning']],
    ['a young window', input(52, [{ kind: 'five_hour', percentUsed: 3, resetsAt: at(4.8 * HOUR) }]), '●●○○  │  5h n/a', ['warning']],
  ] as const) {
    test(name, () => {
      const spans = compact(band)
      const marks = spans.filter(span => /^[●○▲▼]/.test(span.text)).map(span => span.color)

      expect(plain(spans)).toBe(expected)
      expect(marks).toEqual([...colors])
    })
  }

  test('window blocks sit three spaces apart', () => {
    expect(plain(compact(WARM))).toContain('⧗ 1h44   7d')
  })

  test('the run-out time stays plain text', () => {
    expect(compact(WARM).filter(span => span.text.includes('⧗')).map(span => span.color)).toEqual([undefined, undefined])
  })

  test('no reading yet', () => {
    expect(plain(compact({ ...SOLO, reading: null }))).toBe('○○○○')
  })
})

describe('full', () => {
  for (const [name, band, expected] of [
    [
      'both windows',
      WARM,
      [
        'context                   │            5h               7d',
        'now    52%                │ now        61%              44%',
        'level  warm <65%          │ pace       +12%             +39%',
        '                          │ level      ok <+20%         warm <+50%',
        '                          │ out        1h44             2d 19h',
      ],
    ],
    ['no subscription', SOLO, ['context', 'now    52%', 'level  warm <65%']],
  ] as const) {
    test(name, () => {
      expect(full(band).map(plain)).toEqual([...expected])
    })
  }

  test('the separator sits in one column on every row', () => {
    const columns = full(WARM).map(row => plain(row).indexOf('│'))

    expect(new Set(columns).size).toBe(1)
  })

  test('the level cell takes its level color', () => {
    const level = full(WARM)[2]?.find(span => span.text.startsWith('warm'))

    expect(level?.color).toBe('warning')
  })
})
