# headroom

A gauge for your Claude Code session. headroom shows how full the context window is and how fast you spend your rate limits, in one quiet line above the prompt. When a number gets high, it warns you, asks you, or stops tool calls, as you choose.

```
●●○○  │  5h ▲12% ⧗ 1h44   7d ▲39% ⧗ 2d19h        ⋯
```

headroom reads both numbers from Claude Code itself. It starts no extra process and makes no model call.

## Contents

- [Install](#install)
- [Read the band in ten seconds](#read-the-band-in-ten-seconds)
- [What headroom watches](#what-headroom-watches)
- [A session, step by step](#a-session-step-by-step)
- [Levels](#levels)
- [Actions](#actions)
- [The run-out forecast](#the-run-out-forecast)
- [The `/headroom` command](#the-headroom-command)
- [Reset timer](#reset-timer)
- [Configuration](#configuration)
- [Upgrade to 1.0.0](#upgrade-to-100)
- [Development](#development)

## Install

```
/plugin install headroom --marketplace rilder-almeida/headroom
```

The band appears above the prompt at the next session start. You do not need to configure anything.

## Read the band in ten seconds

```
●●○○  │  5h ▲12% ⧗ 1h44   7d ▲39% ⧗ 2d19h        ⋯
↑        ↑  ↑      ↑                             ↑
1        2  3      4                             5
```

1. Context level: one dot per level (`ok`, `warm`, `hot`, `full`). The filled dots show the level that the context fill reached.
2. The rate-limit window: `5h` for 5 hours, `7d` for 7 days.
3. Pace: `▲` faster than an even spread until the reset, `▼` slower.
4. Run-out time: how long until this window runs out at the current speed. A window with no `⧗` lasts until its reset.
5. The button that opens the full view.

The color tells you the level at a glance:

| Color | Level | What it means |
|---|---|---|
| gray | `ok` | Nothing to do. |
| yellow | `warm` | Start to plan a stop. |
| orange | `hot` | Finish what is in flight. |
| red | `full` or `over` | Stop. |

Select `⋯` to open the full view. headroom keeps your choice across sessions.

```
context                   │            5h               7d
now    52%                │ now        61%              44%
level  warm <65%          │ pace       +12%             +39%
                          │ level      ok <20%          warm <50%
                          │ out        1h44             2d 19h
```

Each row answers one question:

| Row | Question |
|---|---|
| `now` | How much is used? |
| `pace` | How fast is it spent, compared with an even spread until the reset? |
| `level` | Which level is it at, and where does the next level start? |
| `out` | When does the window run out at the current speed? |

## What headroom watches

headroom watches two numbers.

Context fill is the part of the context window that the conversation uses. When it is high, the model has less room for new work, and a fresh session is cheaper.

Pace compares your spend with an even spread until the window resets. A pace of 0% means that you finish the window exactly at its reset. A pace of +50% means that at this speed, the window runs out before its reset. headroom reads the 5-hour window and the 7-day window. For the actions, the worse of the two counts.

Pace counts only after the first 10% of a window, because a young window has too few readings to tell a speed. Without a Claude subscription, there are no rate-limit windows, so only context fill applies.

## A session, step by step

This example uses the default configuration.

| Moment | What you see | What Claude gets |
|---|---|---|
| The session starts. | `●○○○` in gray. | Nothing. |
| The context fill reaches 45%. | The dots turn yellow (`●●○○`), and a notice appears. | `headroom: context warm 45%: consider a fresh session at the next natural stop point` |
| The 7-day pace passes +20%. | The `7d` block turns yellow, and a notice appears. | The same kind of line, with the run-out time. |
| The context fill reaches 75%. | The dots turn red (`●●●●`). At the next tool call, headroom asks you whether to block tools. | The question waits for your answer. |
| You run `/compact`. | The dots go back to gray. No notice appears for a level that goes down. | A line for any level that is still at `warm` or higher. |

## Levels

Each number has three levels above `ok`. Each level has a threshold and an action.

| Number | Level | Starts at | Default action |
|---|---|---|---|
| Context fill | `warm` | 45% | `alert` |
| Context fill | `hot` | 65% | `alert` |
| Context fill | `full` | 75% | `ask` |
| Pace | `warm` | +20% | `alert` |
| Pace | `hot` | +50% | `ask` |
| Pace | `over` | +100% | `ask` |

## Actions

| Action | What you see | What Claude gets | Until when |
|---|---|---|---|
| `none` | The band only. | Nothing. | Always. |
| `alert` | A notice on each rise of the level. | One line about the level. | The level changes. |
| `ask` | A question before the next tool call. | The tool result, or a refusal after a `Block` answer. | The level changes. |
| `block` | The band only. | A refusal for every tool call. | The level changes. |

If two levels are active, the most severe action counts. No level uses `block` by default.

### `alert`

The context fill reaches 50%. headroom shows a notice, and Claude gets the same line at the next prompt or the next tool result:

```
headroom: context warm 50%: consider a fresh session at the next natural stop point
```

A pace line also gives the run-out time:

```
headroom: 7d pace warm +39%, out in 2d 19h: spending faster than the window allows, ease off
```

If a level goes down, headroom shows no notice. The band shows the change.

### `ask`

The context fill reaches 76%. Claude tries to run a tool. Before the tool runs, headroom asks you:

```
headroom: context full 76%: stop now and start a fresh session
Block tools until this level changes?
[Continue]  [Block]
```

- If you select `Continue`, the tool runs, and later tool calls run without a question.
- If you select `Block`, headroom blocks tools as the `block` action does.
- If you close the question with no answer, the tool runs, and the next tool call asks again.

Your answer holds until a level with `ask` or `block` changes, for example after `/compact`. Then the next tool call asks again. If Claude runs several tools at the same time, you get one question for all of them. In a session with nobody to ask, such as `claude -p`, `ask` acts as `alert`.

### `block`

You set `pace_over_action` to `block`, and the 5-hour pace goes above +100%. Claude tries to run a tool. headroom refuses it with no question, and Claude gets the level line as the result:

```
headroom: 5h pace over +104%, out in 20m: start nothing new, finish the current step, then pause
```

Claude can still answer in text, but it cannot read, edit or run commands. When the level goes down, tools run again.

### Limits of `ask` and `block`

- They act on tool calls in the main session. They do not stop a subagent that already runs.
- They never stop a question that Claude asks you.
- If headroom itself fails while tools are blocked, it keeps them blocked. Claude then gets this line:

  ```
  headroom: its guard failed while block was on, so tools stay blocked. Try again, or run /plugin disable headroom.
  ```

  If every tool call shows that line, run `/plugin disable headroom` and report the problem.

## The run-out forecast

The `out` time answers one question: when does the window run out at the current speed?

A plain average since the window started reacts slowly. If you speed up in the last hour, the average hides it. headroom uses the recent speed instead, and gives older readings less and less weight:

1. At each reading, headroom measures the speed since the last reading.
2. It mixes that speed with the speed it had before. Recent readings count more.
3. A reading counts half after one hour in the 5-hour window, and after 24 hours in the 7-day window.
4. It divides what is left of the window by that speed.

When a window resets, the forecast starts again from the average of the new window. This method is exponential smoothing, the trend part of Holt's method.

## The `/headroom` command

`/headroom` prints the same reading as text:

```
context  52%  warm <65%
5h       61%  pace +12%  ok <20%          out 1h44
7d       44%  pace +39%  warm <50%        out 2d 19h
```

## Reset timer

When the 5-hour window passes `wake_at` (75% by default), headroom sets a timer for the reset of that window. At the reset, it sends a prompt with a fresh reading into the session, so that paused work can continue. Set `wake_at` to 0 to turn the timer off.

## Configuration

Open `/config` and find the headroom rows. Each level has two fields:

- `<number>_<level>_at`: the threshold, for example `context_full_at`.
- `<number>_<level>_action`: one of `none`, `alert`, `ask` or `block`, for example `pace_hot_action`.

The thresholds of one number must go up from level to level. If they do not, headroom does not load and names the fields.

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

## Development

```
task lint   # validate the mod, types included
task test   # run the tests
task ci     # both
```
