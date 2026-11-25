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
