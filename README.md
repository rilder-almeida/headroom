# headroom

headroom is a Claude Code mod. It watches two numbers in your session and shows them in a band above the prompt. If a number gets high, headroom acts:

- Context fill: the part of the context window that the conversation uses.
- Pace: how fast you spend a rate-limit window, compared with an even spread until that window resets. A pace of +50% means that at this speed, the window runs out before its reset.

headroom reads both numbers from Claude Code itself. It starts no extra process and makes no model call.

## Install

```
/plugin install headroom --marketplace rilder-almeida/headroom
```

## Upgrade to 1.0.0

Version 1.0.0 renames the levels. headroom does not read the old `/config` keys, so set your values again under the new keys:

| Old key part | New key part |
|---|---|
| `context_opportunity` | `context_warm` |
| `context_critical` | `context_hot` |
| `context_limit` | `context_full` |
| `pace_tight` | `pace_warm` |
| `pace_short` | `pace_hot` |
| `pace_overrun` | `pace_over` |

For example, `context_limit_action` is now `context_full_action`.

## Levels

Each number has three levels above `ok`. Each level has a threshold and an action.

| Number | Level | Starts at | Default action |
|---|---|---|---|
| Context fill | `warm` | 45% | alert |
| Context fill | `hot` | 65% | alert |
| Context fill | `full` | 75% | ask |
| Pace | `warm` | +20% | alert |
| Pace | `hot` | +50% | ask |
| Pace | `over` | +100% | ask |

Pace uses the 5-hour and the 7-day windows. For the actions, the worse of the two counts. Pace counts only after the first 10% of a window. Without a Claude subscription there are no rate-limit windows, so only context fill applies.

## The band

The band is always above the prompt. Its compact row looks like this:

```
●●○○  │  5h ▲12% ⧗ 1h44   7d ▲39% ⧗ 2d 19h                      ⋯
```

- The four dots are the context levels: `ok`, `warm`, `hot`, `full`. The filled dots show the level that the context fill reached.
- Each window shows its pace (`▲` above an even spread, `▼` below it) and its run-out time after `⧗`. `⧗ ·` means that the window lasts until its reset.
- The colors follow the level: gray for `ok`, yellow for `warm`, orange for `hot`, red for `full` and `over`.

Select `⋯` to open the full view. Select it again to go back. headroom keeps your choice across sessions.

```
context                   │            5h               7d
now    52%                │ now        61%              44%
level  warm · 13% left    │ pace       +12%             +39%
                          │ level      ok · 8% left     warm · 11% left
                          │ out        1h44             2d 19h
```

- `now`: how much of the context window or of the rate-limit window is used.
- `pace`: the spend speed, compared with an even spread until the reset.
- `level`: the current level, and the points left until the next level starts.
- `out`: the time until the window runs out at the forecast speed.

## Run-out forecast

The forecast uses the recent spend speed, not only the average since the window started. At each reading, headroom mixes the speed since the last reading with the speed it had before. Older readings count less and less. A reading counts half after one hour in the 5-hour window, and after 24 hours in the 7-day window. When a window resets, the forecast starts again from the average of the new window.

## Actions

- `none`: headroom does nothing.
- `alert`: when a level goes up, headroom shows a short notice. It gives Claude one line about each level at the next prompt or the next tool result. The band shows the level all the time.
- `ask`: before the next tool call, headroom asks you once whether to block tools.
- `block`: Claude cannot use tools while the level is active.

If two levels are active, the most severe action counts. No level uses `block` by default.

### Example: alert

The context fill reaches 50%. headroom shows this notice, and Claude gets the same line:

```
headroom: context warm 50%: consider a fresh session at the next natural stop point
```

A pace line also gives the run-out time, for example `headroom: 7d pace warm +39%, out in 2d 19h: ...`. If a level goes down, headroom shows no notice.

### Example: ask

The context fill reaches 76%. Claude tries to run a tool. Before the tool runs, headroom asks you:

```
headroom: context full 76%: stop now and start a fresh session
Block tools until this level changes?
[Continue]  [Block]
```

- If you select `Continue`, the tool runs, and later tool calls run without a question.
- If you select `Block`, headroom blocks tools as the `block` action does.

Your answer holds until a level with `ask` or `block` changes, for example after `/compact`. Then the next tool call asks again. If Claude runs several tools at the same time, you get one question for all of them. In a session with nobody to ask, such as `claude -p`, `ask` acts as `alert`.

### Example: block

You set `pace_over_action` to `block`, and the 5-hour pace goes above +100%. Claude tries to run a tool. headroom refuses it with no question, and Claude gets the level line as the result:

```
headroom: 5h pace over +104%, out in 20m: start nothing new, finish the current step, then pause
```

Claude can still answer in text, but it cannot read, edit or run commands. When the level goes down, tools run again.

`ask` and `block` act on tool calls in the main session. They do not stop a subagent that already runs, and they never stop a question that Claude asks you.

If headroom itself fails while tools are blocked, it keeps them blocked, and Claude gets `headroom: its guard failed while block was on, so tools stay blocked. Try again, or run /plugin disable headroom.` If tools are not blocked, the call runs. If every tool call shows that line, run `/plugin disable headroom` and report the problem.

## Reset timer

When the 5-hour window passes `wake_at` (75% by default), headroom sets a timer for the reset of that window. At the reset, it sends a prompt with a fresh reading into the session, so that paused work can continue. Set `wake_at` to 0 to turn the timer off.

## Command

`/headroom` shows the context fill and each rate-limit window:

```
context  52%  warm · 13% left
5h       61%  pace +12%  ok · 8% left     out 1h44
7d       44%  pace +39%  warm · 11% left  out 2d 19h
```

## Configuration

Open `/config` and find the headroom rows. Each level has two fields:

- `<number>_<level>_at`: the threshold, for example `context_full_at`.
- `<number>_<level>_action`: one of `none`, `alert`, `ask` or `block`, for example `pace_hot_action`.

The thresholds of one number must go up from level to level. If they do not, headroom does not load and names the fields.

## Development

```
task lint   # validate the mod, types included
task test   # run the tests
task ci     # both
```
