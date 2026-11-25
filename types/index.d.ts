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
    }
  }
}
