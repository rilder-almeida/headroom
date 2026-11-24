# headroom

headroom is a Claude Code mod. It watches two numbers in your session. If a number gets high, headroom acts:

- Context fill: the part of the context window that the conversation uses.
- Pace: how fast you spend a rate-limit window, compared with an even spread until that window resets. A pace of +50% means that at this speed, the window runs out before its reset.

headroom reads both numbers from Claude Code itself. It starts no extra process and makes no model call.

## Install

```
/plugin install headroom --marketplace rilder-almeida/headroom
```

## Levels

Each number has three levels. Each level has a threshold and an action.

| Number | Level | Starts at | Default action |
|---|---|---|---|
| Context fill | `opportunity` | 45% | alert |
| Context fill | `critical` | 65% | alert |
| Context fill | `limit` | 75% | ask |
| Pace | `tight` | +20% | alert |
| Pace | `short` | +50% | ask |
| Pace | `overrun` | +100% | ask |

Pace uses the 5-hour and the 7-day windows, and the worse of the two counts. Pace counts only after the first 10% of a window. Without a Claude subscription there are no rate-limit windows, so only context fill applies.

## Actions

- `none`: headroom does nothing.
- `alert`: If the level changes, headroom shows a short notice. It keeps a line above the prompt while the level is active. It also gives Claude one line about the level.
- `ask`: before the next tool call, headroom asks you once whether to continue. Your answer holds until the level changes. If you choose Stop, Claude cannot use tools until the level changes.
- `block`: Claude cannot use tools while the level is active.

`ask` and `block` act on tool calls in the main session. They do not stop a subagent that already runs, and they never stop a question that Claude asks you. In a session with nobody to ask, such as `claude -p`, `ask` acts as `alert`.

If headroom itself fails while an ask or block level is active, it refuses the tool call, and the reason says `headroom: its guard failed`. If no such level is active, the call runs. If every tool call shows that reason, run `/plugin disable headroom` and report the problem.

## Reset timer

When the 5-hour window passes `wake_at` (75% by default), headroom sets a timer for the reset of that window. At the reset, it sends a prompt with a fresh reading into the session, so that paused work can continue. Set `wake_at` to 0 to turn the timer off.

## Command

`/headroom` shows the context fill, each rate-limit window, its pace, and the current level.

## Configuration

Open `/config` and find the headroom rows. Each level has two fields:

- `<number>_<level>_at`: the threshold, for example `context_limit_at`.
- `<number>_<level>_action`: one of `none`, `alert`, `ask` or `block`, for example `pace_short_action`.

The thresholds of one number must go up from level to level. If they do not, headroom does not load and names the fields.

## Development

```
task lint   # validate the mod, types included
task test   # run the tests
task ci     # both
```
