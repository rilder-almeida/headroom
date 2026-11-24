import { expect, test } from 'claude-code/testing'

import { ladders } from './config'

const DEFAULTS = {
  context: [
    { name: 'opportunity', at: 45, action: 'alert' },
    { name: 'critical', at: 65, action: 'alert' },
    { name: 'limit', at: 75, action: 'ask' },
  ],
  pace: [
    { name: 'tight', at: 20, action: 'alert' },
    { name: 'short', at: 50, action: 'ask' },
    { name: 'overrun', at: 100, action: 'ask' },
  ],
  wakeAt: 75,
}

test('defaults give the spec ladders', () => {
  expect(ladders({})).toEqual(DEFAULTS)
})

test('stored values override defaults', () => {
  const got = ladders({ context_limit_at: 80, pace_short_action: 'block' })

  expect(got.context[2]).toEqual({ name: 'limit', at: 80, action: 'ask' })
  expect(got.pace[1]).toEqual({ name: 'short', at: 50, action: 'block' })
  expect(got.context[0]).toEqual(DEFAULTS.context[0])
})

test('non-ascending thresholds refuse', () => {
  expect(() => ladders({ context_critical_at: 30 })).toThrow(
    /context_opportunity_at.*context_critical_at/,
  )
})
