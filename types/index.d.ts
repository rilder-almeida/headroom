/** What headroom does when a level is active, from least to most severe. */
export type Action = 'none' | 'alert' | 'ask' | 'block'

/** The name of a level on either ladder. */
export type LevelName = 'warm' | 'hot' | 'full' | 'over'

/** One rung of a ladder: the threshold where it starts and its action. */
export type Level = { name: LevelName; at: number; action: Action }

/** One active level, with the value that reached it and, for pace, its window. */
export type Hit =
  | { ladder: 'context'; level: Level; value: number }
  | { ladder: 'pace'; level: Level; value: number; window: '5h' | '7d' }

/** The current level of each ladder, null when none is reached. */
export type Active = { context: Hit | null; pace: Hit | null }

/** The smoothed spend of one window: the last reading and its rate, in percent per millisecond. */
export type Forecast = { at: number; used: number; resetsAt: string; rate: number }

/** The forecast of each rate-limit window kind seen so far. */
export type Forecasts = Partial<Record<string, Forecast>>

/** The calibration numbers behind bursts, forecasts and the reset timer, durations in milliseconds. */
export type Tuning = {
  burstFactor: number
  releaseFactor: number
  lookback: { five_hour: number; seven_day: number }
  contextCalls: number
  contextRise: number
  contextRelease: number
  halfLife: { five_hour: number; seven_day: number }
  margin: { context: number; five_hour: number; seven_day: number }
  jitter: number
  warmup: number
  wakeDelay: number
}

/** Whether one burst is on, since when it sits below its release bound, and what the model was last told; times are milliseconds for usage and tool-call counts for context. */
export type Latch = { isOn: boolean; belowSince: number | null; told: { at: number; value: number } | null }

/** The latch of each burst: context and each rate-limit window kind. */
export type Latches = Partial<Record<string, Latch>>

/** The level each ladder key stood at after the last reading: `context` and each rate-limit window kind. */
export type Held = Partial<Record<string, LevelName>>

/** One usage reading kept for the burst: when, and the percent used. */
export type Sample = { at: number; used: number }

/** The recent usage samples of one window, tied to its reset time. */
export type Trail = { resetsAt: string; samples: Sample[] }

/** The recent usage samples of each rate-limit window kind. */
export type Samples = Partial<Record<string, Trail>>

/** The last reading headroom measured: context fill and each window. */
export type Reading = {
  context: number | undefined
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
}

/** Whether the person answered the current ask: not yet, continue, or block. */
export type Grant = 'pending' | 'granted' | 'blocked'

declare module 'claude-code' {
  interface PluginState {
    headroom: {
      levels: Shaped<Active>
      pending: string | null
      grant: Shaped<Grant>
      armedFor: string | null
      reading: Reading | null
      forecast: Forecasts
      details: boolean
      samples: Samples
      trail: number[]
      latches: Latches
      held: Held
      calls: number
    }
  }
}
