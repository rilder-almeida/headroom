import { expect, test } from 'claude-code/testing'

import { ladders } from './config'

const DEFAULTS = {
  context: [
    { name: 'warm', at: 45, action: 'alert' },
    { name: 'hot', at: 65, action: 'alert' },
    { name: 'full', at: 75, action: 'ask' },
  ],
  pace: [
    { name: 'warm', at: 20, action: 'alert' },
    { name: 'hot', at: 50, action: 'ask' },
    { name: 'over', at: 100, action: 'ask' },
  ],
  wakeAt: 75,
  symbol: '\u{F0238}',
  tuning: {
    burstFactor: 3,
    releaseFactor: 2,
    lookback: { five_hour: 20 * 60_000, seven_day: 3 * 3_600_000 },
    contextCalls: 5,
    contextRise: 10,
    contextRelease: 5,
    halfLife: { five_hour: 3_600_000, seven_day: 24 * 3_600_000 },
    margin: { context: 0, five_hour: 10, seven_day: 5 },
    jitter: 5 * 60_000,
    warmup: 0.1,
    wakeDelay: 60_000,
  },
}

test('defaults give the spec ladders', () => {
  expect(ladders({})).toEqual(DEFAULTS)
})

test('stored values override defaults', () => {
  const got = ladders({ context_full_at: 80, pace_hot_action: 'block' })

  expect(got.context[2]).toEqual({ name: 'full', at: 80, action: 'ask' })
  expect(got.pace[1]).toEqual({ name: 'hot', at: 50, action: 'block' })
  expect(got.context[0]).toEqual(DEFAULTS.context[0])
})

test('non-ascending thresholds refuse', () => {
  expect(() => ladders({ context_hot_at: 40 })).toThrow(/context_warm_at \(45\).*context_hot_at \(40\)/)
})

test('old keys are not read', () => {
  expect(ladders({ context_critical_at: 10, pace_tight_action: 'block' })).toEqual(DEFAULTS)
})

test('the burst symbol is configurable', () => {
  for (const [value, expected] of [
    ['!!', '!!'],
    [' x ', 'x'],
    ['', '\u{F0238}'],
    ['  ', '\u{F0238}'],
    [3, '\u{F0238}'],
  ] as const) {
    expect(ladders({ burst_symbol: value }).symbol).toBe(expected)
  }
})

test('tuning values override defaults in their units', () => {
  const got = ladders({
    burst_factor: 2,
    burst_release_factor: 1.5,
    burst_5h_minutes: 30,
    burst_7d_hours: 6,
    burst_context_calls: 3,
    burst_context_points: 8,
    burst_context_release_points: 4,
    forecast_5h_half_life_minutes: 30,
    forecast_7d_half_life_hours: 12,
    context_margin: 2,
    pace_5h_margin: 8,
    pace_7d_margin: 3,
    reset_jitter_minutes: 0,
    pace_warmup_percent: 0,
    wake_delay_seconds: 0,
  }).tuning

  expect(got).toEqual({
    burstFactor: 2,
    releaseFactor: 1.5,
    lookback: { five_hour: 30 * 60_000, seven_day: 6 * 3_600_000 },
    contextCalls: 3,
    contextRise: 8,
    contextRelease: 4,
    halfLife: { five_hour: 30 * 60_000, seven_day: 12 * 3_600_000 },
    margin: { context: 2, five_hour: 8, seven_day: 3 },
    jitter: 0,
    warmup: 0,
    wakeDelay: 0,
  })
})

test('out-of-range tuning refuses', () => {
  for (const [options, message] of [
    [{ burst_factor: 0.5 }, /burst_factor \(0\.5\) must be at least 1/],
    [{ burst_context_calls: 2.5 }, /burst_context_calls \(2\.5\) must be a whole number at least 1/],
    [{ reset_jitter_minutes: -1 }, /reset_jitter_minutes \(-1\) must be at least 0/],
    [{ pace_warmup_percent: 100 }, /pace_warmup_percent \(100\) must be below 100/],
    [{ burst_release_factor: 4 }, /burst_release_factor \(4\) must not exceed burst_factor \(3\)/],
    [{ burst_context_release_points: 11 }, /burst_context_release_points \(11\) must not exceed burst_context_points \(10\)/],
  ] as const) {
    expect(() => ladders(options)).toThrow(message)
  }
})
