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

/** Whether the person answered the current ask: not yet, continue, or block. */
export type Grant = 'pending' | 'granted' | 'blocked'

declare module 'claude-code' {
  interface PluginState {
    headroom: {
      levels: Shaped<Active>
      pending: string | null
      grant: Shaped<Grant>
      armedFor: string | null
    }
  }
}
