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
- [Margins](#margins)
- [Bursts](#bursts)
- [The summary line](#the-summary-line)
- [The burst symbol and its font](#the-burst-symbol-and-its-font)
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

While a burst is on (a sudden spike in spend or in context fill, see [Bursts](#bursts)), the row ends with the burst symbol `󰈸`:

```
●●○○  │  5h ▲12% ⧗ 1h44   7d ▲39% ⧗ 2d19h   󰈸   ⋯
```

The color tells you the level at a glance:

| Color | Level | What it means |
|---|---|---|
| gray | `ok` | Nothing to do. |
| yellow | `warm` | Start to plan a stop. |
| orange | `hot` | Finish what is in flight. |
| red | `full` or `over` | Stop. |

Select `⋯` to open the full view, and `[-]` to close it. headroom keeps your choice across sessions.

```
headroom                                                   [-]

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

In the full view, the burst symbol sits next to the number in burst: the context `now` cell, or the `pace` cell of a window. Below the rows, after a blank line, [the summary line](#the-summary-line) says the same in one paragraph, in gray.

## What headroom watches

headroom watches two numbers.

Context fill is the part of the context window that the conversation uses. When it is high, the model has less room for new work, and a fresh session is cheaper.

Pace compares your spend with an even spread until the window resets. A pace of 0% means that you finish the window exactly at its reset. A pace of +50% means that at this speed, the window runs out before its reset. headroom reads the 5-hour window and the 7-day window. For the actions, the worse of the two counts.

Pace counts only after the first 10% of a window (`pace_warmup_percent`), because a young window has too few readings to tell a speed. Without a Claude subscription, there are no rate-limit windows, so only context fill applies.

## A session, step by step

This example uses the default configuration.

| Moment | What you see | What Claude gets |
|---|---|---|
| The session starts. | `●○○○` in gray. | Nothing. |
| The context fill reaches 45%. | The dots turn yellow (`●●○○`). | `headroom: context warm 45%: consider a fresh session at the next natural stop point` |
| The 7-day pace passes +20%. | The `7d` block turns yellow. | The same kind of line, with the run-out time. |
| A large file read adds 12% of context in one tool call. | The row ends with `󰈸`. | `headroom: context burst, up 12% in the last 1 tool call` |
| The context fill reaches 75%. | The dots turn red (`●●●●`). At the next tool call, headroom asks you whether to block tools. | The question waits for your answer. |
| You run `/compact`. | The dots go back to gray. | A line for any level that is still at `warm` or higher. |

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
| `alert` | The band only. | One line about the level. | The level changes. |
| `ask` | A question before the next tool call. | The tool result, or a refusal after a `Block` answer. | The level changes. |
| `block` | The band only. | A refusal for every tool call. | The level changes. |

If two levels are active, the most severe action counts. No level uses `block` by default.

### `alert`

The context fill reaches 50%. Claude gets this line at the next prompt or the next tool result:

```
headroom: context warm 50%: consider a fresh session at the next natural stop point
```

A pace line also gives the run-out time:

```
headroom: 7d pace warm +39%, out in 2d 19h: spending faster than the window allows, ease off
```

If the context or pace falls back to `ok`, Claude gets no line. The band shows the change. If several tool results arrive at the same time, Claude gets the line once.

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

## Margins

A pace that sits on a threshold moves a little at each reading: spend pushes it up, and time without spend pulls it down. Without a margin, a pace that moves between +19% and +21% changes level at each crossing, and Claude gets a line each time.

A margin stops this. A level starts at its threshold, but it ends only when the value falls the margin below that threshold. With the default 5-hour margin of 10 points, the 5-hour `warm` level starts at +20% and ends below +10%. While a level holds this way, the band can show `warm` next to a pace under +20%.

| Key | Default | Applies to |
|---|---|---|
| `pace_5h_margin` | 10 points | The 5-hour pace. It moves fast, so it gets a wide margin. |
| `pace_7d_margin` | 5 points | The 7-day pace. |
| `context_margin` | 0 points | The context fill. It only goes down after `/compact` or `/clear`, so it needs no margin by default. |

## Bursts

A burst is a sudden spike: spend or context fill that grows fast right now, while the averages still look calm. The pace cannot show it, because the pace averages the spend since the window started.

headroom watches three bursts:

| Burst | It lights when | It goes out when |
|---|---|---|
| 5-hour usage | The spend of the last 20 minutes reaches 3 times the sustainable rate (the rate that empties the window exactly at its reset, 20% per hour). | The spend stays under 2 times the sustainable rate for 5 minutes. |
| 7-day usage | The same rule over the last 3 hours. | The spend stays under 2 times the sustainable rate for 45 minutes. |
| Context | The context fill rises 10 points over the last 5 tool calls. | The rise stays under 5 points for 2 tool calls. |

A burst goes out after a short wait below its release bound, so a short dip inside a spike does not turn it off and on again. The wait is a quarter of the lookback.

When a burst lights, Claude gets one line:

```
headroom: 5h burst, 60% per hour over the last 20 minutes
headroom: context burst, up 12% in the last 1 tool call
```

If the same burst lights again inside its lookback (20 minutes, 3 hours, or 5 tool calls), Claude gets no new line. The exception is a burst that got worse than the last line said: 1.5 times the last spend rate, or 10 more points of context rise. Claude then gets a new line at once.

The usage bursts need samples over at least half of their lookback, so a burst cannot light at the first readings of a session. The 7-day lookback is in hours because one point of the 7-day window is about 1h40 of sustainable spend.

## The summary line

The full view and `/headroom` end with one paragraph that says where your consumption stands. headroom builds it from the same numbers as the band, with no model call:

```
Context is warm at 41%, up 12% in the last 5 tool calls. The 5h window is hot at +45% pace and runs out 1h05 before its reset, at 17:35. The last 20 minutes burned 60% per hour, enough to empty it by 16:50. The 7d window is warm at +38% pace and runs out 11h before its reset, on Thursday at 22:00, so 5h is the tighter limit now.
```

- The context part gives its level and fill. The rise shows only while the context burst is on.
- Each window gives its level, its pace, and when it runs out compared with its reset. A window that lasts says when it resets.
- The run-out time comes from the [run-out forecast](#the-run-out-forecast), the same as `⧗`. The burst sentence shows only while that window's burst is on, and uses the burst's own measure.
- When both windows run out before their reset, the last part names the window that runs out first.
- Times are in the local time of your machine.

## The burst symbol and its font

The default burst symbol `󰈸` is the fire icon of the Nerd Fonts (`nf-md-fire`, U+F0238). Your terminal must use a Nerd Font to show it. With another font, it shows as an empty box.

To install a Nerd Font, for example FiraCode Nerd Font:

- macOS: run `brew install --cask font-fira-code-nerd-font`.
- Linux: download `FiraCode.zip` from the [Nerd Fonts releases](https://github.com/ryanoasis/nerd-fonts/releases/latest), extract it into `~/.local/share/fonts`, then run `fc-cache -f`.
- Windows: download `FiraCode.zip` from the same page, extract it, and install the `.ttf` files.

Then set `FiraCode Nerd Font` as the font of your terminal. If you cannot change the font, set `burst_symbol` to a plain character, for example `!`.

## The run-out forecast

The `out` time answers one question: when does the window run out at the current speed?

A plain average since the window started reacts slowly. If you speed up in the last hour, the average hides it. headroom uses the recent speed instead, and gives older readings less and less weight:

1. At each reading, headroom measures the speed since the last reading.
2. It mixes that speed with the speed it had before. Recent readings count more.
3. A reading counts half after one hour in the 5-hour window, and after 24 hours in the 7-day window (`forecast_5h_half_life_minutes`, `forecast_7d_half_life_hours`). A shorter half-life follows recent spend faster, and jumps more.
4. It divides what is left of the window by that speed.

When a window resets, the forecast starts again from the average of the new window. This method is exponential smoothing, the trend part of Holt's method.

## The `/headroom` command

`/headroom` prints the same reading as text:

```
context  52%  warm <65%
5h       61%  pace +12%  ok <20%          out 1h44
7d       44%  pace +39%  warm <50%        out 2d 19h

Context is warm at 52%. The 5h window is ok at +12% pace and runs out 32m before its reset, at 13:44. The 7d window is warm at +39% pace and runs out 1d 23h before its reset, on Saturday at 07:41, so 5h is the tighter limit now.
```

## Reset timer

When the 5-hour window passes `wake_at` (75% by default), headroom sets a timer for the reset of that window. One minute after the reset (`wake_delay_seconds`), it sends a prompt with a fresh reading into the session, so that paused work can continue. Set `wake_at` to 0 to turn the timer off.

## Configuration

Open `/config` and find the headroom rows. Each level has two fields:

- `<number>_<level>_at`: the threshold, for example `context_full_at`.
- `<number>_<level>_action`: one of `none`, `alert`, `ask` or `block`, for example `pace_hot_action`.

The thresholds of one number must go up from level to level. If they do not, headroom does not load and names the fields.

The other fields tune the bursts, the margins, the forecast and the reset timer:

| Key | Default | What it sets |
|---|---|---|
| `burst_factor` | 3 | How many times the sustainable rate lights a usage burst. |
| `burst_release_factor` | 2 | Below how many times the sustainable rate a usage burst starts to go out. Not above `burst_factor`. |
| `burst_5h_minutes` | 20 | The lookback of the 5-hour burst. |
| `burst_7d_hours` | 3 | The lookback of the 7-day burst. |
| `burst_context_calls` | 5 | The tool calls the context burst looks back over. A whole number. |
| `burst_context_points` | 10 | The rise that lights the context burst. |
| `burst_context_release_points` | 5 | Below which rise the context burst starts to go out. Not above `burst_context_points`. |
| `burst_symbol` | `󰈸` | The burst symbol. See [its font](#the-burst-symbol-and-its-font). |
| `pace_5h_margin`, `pace_7d_margin`, `context_margin` | 10, 5, 0 | The [margins](#margins), in points. |
| `forecast_5h_half_life_minutes` | 60 | The half-life of the 5-hour forecast. |
| `forecast_7d_half_life_hours` | 24 | The half-life of the 7-day forecast. |
| `pace_warmup_percent` | 10 | The start of a window, in percent, with no pace. Below 100. |
| `reset_jitter_minutes` | 5 | How far apart two reset times can be and still name the same window. |
| `wake_delay_seconds` | 60 | How long after the 5-hour reset the reset timer wakes the session. |
| `wake_at` | 75 | See [Reset timer](#reset-timer). |

If a value is out of range, headroom does not load and names the field.

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
