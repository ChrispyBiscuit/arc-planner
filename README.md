# Arc

A life-plan dashboard you check into every day. It shows the same plan at six scales (day, week, month, year,
decade, life) on one arc from today to the end of life, and it speaks MCP so Claude can read it, record what
happened and re-plan.

The interface follows [Glimmr](https://github.com/ChrispyBiscuit/GlimmR)'s design system: neutral zero-hue greys,
ink-on-grey actions, colour used only as a mark, and Archivo for
everything else, with time set large and a scrubber on the right edge.

## Install

Download `Arc-Planner-Setup-x.y.z.exe` from the [latest release](https://github.com/ChrispyBiscuit/arc-planner/releases/latest)
and run it. It is a standard Windows installer with Start menu and desktop shortcuts and an uninstaller. The
installer is not code-signed, so Windows SmartScreen asks once: choose "More info", then "Run anyway".

Arc keeps running in the system tray when its window is closed, so Claude can reach it. The tray menu has
"Start with Windows", "Check for updates" and "Quit Arc".

**Updates are automatic.** Arc checks GitHub releases at start and every six hours, downloads a newer version in
the background and installs it the next time it quits.

## Run from source

Requires Node.js 20 or newer.

```
node server.mjs          # dashboard and MCP in a browser, nothing to install
npm install && npm run app   # the desktop app
npm run dist:win         # build the installer into dist/
npm run release          # build and publish a GitHub release (bump the version first)
npm test                 # date logic, the item model and linter, every operation, the HTTP and MCP server
```

## Structure: every goal and task can be judged done

Goals are one of five types (Outcome, Metric target, Habit, Milestone, Decision) and tasks one of six (Action,
Deliverable, Research, Appointment, Admin, Practice). Every item has the same sections, in order:

1. **Title**: an outcome for goals, verb first for tasks.
2. **Why**: the goal it serves (exactly one horizon up for goals) and how.
3. **Requirements**: other items, money, time, resources, information or people needed first. Unmet blocking
   requirements mark the item blocked.
4. **Proposal**: the approach and the steps.
5. **Acceptance criteria**: each one a yes-or-no with evidence, a metric threshold (checked from readings), a count
   of items done, a routine adherence percentage, or a date.
6. **Dates**: start, target end (required), and for tasks the do date.
7. **Estimate**, **priority** (tasks), **status** and, when closed, the **outcome**.

An item can only be marked done when its criteria are met, unless you give a reason. Items past their end date show
as missed; items waiting on a requirement show as blocked. A linter checks every item, shows a badge (complete,
needs work, invalid) and lists the plan's common gaps in Review. New items from Claude that are not complete are
saved as proposals.

## Inbox, triage and the board

- **Inbox** holds what waits for your decision. *Proposed changes*: edits Claude suggests to existing items (structure,
  dates, parents, or dropping them), each shown as now against proposed, with Accept, Accept and edit, Reject, and bulk
  accept or reject. *New items*: goals and tasks Claude created that are not yet accepted; they show on the plan with a
  dashed edge and do not count toward scores. *Missed*: items past their end date.
- **Triage**: every missed item gets one decision: move it (Today or a date), mark it done, turn a task into a
  routine, or drop it with a reason. Overdue tasks also appear at the top of Today.
- **Board**: goals or tasks in columns by status (proposed, active, blocked, missed, done), filtered by area and
  horizon.

## How it works

- **Routines** are recurring targets (a lifting day, a study block). They fill each day on their own.
- **Targets** are one-off items on a single day. Claude adds these, with a short brief, when it plans a day.
- **Goals** live at a horizon: week, month, year, decade or life. Each can point at the goal above it, so
  today's targets trace up to a life goal ("Line of sight" on the day view).
- **Check-in** records what happened: each target done, partly done or skipped, what you actually did, sleep,
  energy, mood and metric readings.
- **Metrics** are numbers over time with a target (bodyweight, a lift, applications sent).
- **Chapters** divide the life arc into named spans of years.
- **Review** shows the last 30 days by area and by routine, lowest first, plus the log of every plan change.

Keys: `â†` `â†’` step through time, `T` returns to today, `Ctrl K` searches.

## Claude connection (MCP)

With the server running, the MCP endpoint is `http://127.0.0.1:4747/mcp` (Streamable HTTP).

```
claude mcp add --transport http --scope user arc http://127.0.0.1:4747/mcp --header "Authorization: Bearer <token>"
```

The token is created on first run in `~/.arc-planner/token`; Settings shows the full command. Every call to `/api`
and `/mcp` needs it. The desktop window signs itself in; a browser signs in by opening `/?token=<token>` once.

**Excluded topics.** Settings holds a list of topics Claude must never add to the plan. Any change from Claude that
mentions one is refused, and the list is part of the instructions Claude receives.

Clients that launch servers themselves can use stdio instead: `node server.mjs --stdio`. Both read and write the
same file, and the dashboard picks up changes within three seconds.

The daily loop: tell Claude what happened. It calls `get_overview`, records the day with `check_in`, looks at
`get_performance`, then adjusts tomorrow (`plan_day`), routines (`upsert_routine`) and goals (`upsert_goal`), and
writes its reasoning with `log_revision`.

| Tool | Does |
|---|---|
| `get_overview` | Today, active goals at every horizon, last 7 days, streak, metrics, routines, chapters |
| `get_day`, `get_range` | Targets and results for a day or a span |
| `get_performance` | Completion by day, area and routine; metric movement; goal counts |
| `check_in` | Record a day: summary, sleep, energy, mood, item results, metric readings |
| `set_item_status` | Mark one target |
| `plan_day` | Set a day's brief and one-off targets; hide routines for that day |
| `upsert_task`, `delete_task` | One-off targets |
| `list_goals`, `upsert_goal`, `delete_goal` | Goals at any horizon |
| `list_routines`, `upsert_routine`, `delete_routine` | Recurring targets |
| `get_metrics`, `upsert_metric`, `log_metric`, `delete_metric` | Tracked numbers |
| `upsert_phase`, `delete_phase` | Life chapters |
| `update_profile`, `upsert_area` | Date of birth, life expectancy, areas |
| `list_facts`, `add_fact`, `delete_fact` | The history: dated events, decisions and statements |
| `get_item`, `check_criteria`, `update_criterion`, `close_item` | One item in full; evaluate, tick and close against its criteria |
| `propose_changes`, `list_proposals`, `withdraw_proposals` | Suggest changes for the user to review; only the user accepts |
| `list_overdue`, `triage` | Missed and blocked items, and settling them |
| `lint_plan`, `get_templates`, `get_policy` | Plan quality, examples of every type, excluded topics |
| `log_revision`, `get_revisions` | Why the plan changed |

## Data

Everything is one file, `plan.json`. The installed app keeps it in `%APPDATA%\Arc Planner` (tray menu, "Open data
folder"); run from source it is `data/plan.json`. A dated copy is saved to a `backups` folder beside it before the
first change of each day. Settings has Export plan and Import plan for moving it between computers. Updating or uninstalling the app leaves the plan in place. The server listens on
127.0.0.1 only, refuses requests from other hosts or origins, requires the token, and refuses a change based on an
older revision than the one on disk, so a change made elsewhere is never overwritten. Set `ARC_DATA` to keep the file somewhere else,
and `ARC_PORT` to change the port.
