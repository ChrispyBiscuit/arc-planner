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

## Working with blocks

Every task, routine session, goal, overdue item and decision on screen is a block.

- **Day and Week are calendars.** Each day has an hour grid from 6am to midnight and a "No time yet" tray. Drag a block
  onto the grid to give it a time (snaps to 15 minutes), drag it to another day's column to move it there, drag its
  bottom edge to change how long it takes (its top edge to change when it starts; the times show as you drag,
  Escape cancels), and drag it back to the tray to take it off the clock.
- **Add on the calendar:** double-click empty time for a 30-minute task, or press and drag across empty time to sweep
  out its length. A short form asks for the name, type and the goal it serves.
- Routines can have a usual start time; a day can move or clear it without changing the routine.
- **Repeating:** the new-item form and the task editor have a Repeats option (every day, every weekday, weekly,
  monthly, yearly, or custom: every n days, weeks, months or years, with weekdays for weekly). A repeating task becomes a
  routine anchored on its day, keeping its time and length. Monthly repeats on the 29th to 31st land on the last day of
  shorter months.
- **Click** selects; **double-click** or **Enter** opens that kind's own editor: tasks (with their time, the day's
  record and the goal chain above them), goals (with their children as blocks), routines and metrics (readings can be
  edited or removed). Links inside an editor open the next editor on top, with a Back button.
- **Line of sight** is built from the goals the day's items actually serve, by horizon. Click a goal to open it, hover
  to highlight the items that serve it, drop a task, routine or goal onto it to link them.
- **Focus** is a strip of three slots; drop an item there to focus on it.
- **Drag** works with a mouse, pen or finger. Escape cancels a drag.
- **Keyboard:** Space ticks the selected block, Alt+Left and Alt+Right move a task a day, Alt+Up and Alt+Down reorder,
  F adds or removes it from focus.
- **Ctrl+Z** undoes moves, time changes, links, reorders, ticks and focus changes.
- A task moved past its end date carries the end with it, but never past the end of the goal it serves.

## A doable day

- **Focus.** Each day leads with up to three focus items. Until you choose (the star on each row), Arc suggests the
  must-do tasks and whatever is due soonest; blocked items are never suggested. Everything else sits under "If there's
  time". Claude can set the focus when it plans a day.
- **Capacity.** Settings holds the hours you have each weekday. Every routine and task has minutes (its estimate,
  else a duration at the start of its target, else a default), and each day shows its load against capacity. The
  Routines page shows routine time per weekday, so you can see when routines alone fill a day. Claude cannot add a
  task to a full day; it is told the next day with room.
- **Balancing.** "Balance" on a full day or week moves could-priority tasks, then should-priority, to the next day
  with room before their end date. Must tasks and the focus you chose never move. You see the moves first.
- **Decisions.** A goal or task of type Decision has a question, options with notes and a review date. Decide records
  the choice and your reasons in the history and closes it. Decisions due within a week show on Today.
- **Progress** comes from acceptance criteria, or for a goal without criteria, from the share of its children done.

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
- **Health** shows your Garmin watch's data from the Garmin Sync app on this computer: readings now (heart rate,
  resting heart rate, stress, body battery, steps, intensity minutes, floors, SpO2, respiration, calories), the last
  24 hours, the last 30 days, last night's sleep by stage, and activities. It refreshes every 15 seconds while open,
  and **Sync now** asks the watch for new files. Arc only reads Garmin Sync, at `http://127.0.0.1:8765` (set
  `ARC_GARMIN_URL` to change it; it must be on this machine), and never copies the data into the plan. When Garmin
  Sync isn't running the page says so and fills in once it starts.

Keys: `←` `â†’` step through time, `T` returns to today, `Ctrl K` searches.

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
| `move_task`, `reorder_day` | Move a task to another day, reorder a day |
| `set_slot`, `delete_reading` | Put an item at a time on a day and set its length; remove a metric reading |
| `set_focus`, `balance_days`, `decide` | Focus three, moves off full days (read-only), record a decision |
| `lint_plan`, `get_templates`, `get_policy` | Plan quality, examples of every type, excluded topics |
| `log_revision`, `get_revisions` | Why the plan changed |
| `get_health` | Garmin watch readings now, daily averages, last night's sleep and recent activities (read only) |

## Data

Everything is one file, `plan.json`. The installed app keeps it in `%APPDATA%\Arc Planner` (tray menu, "Open data
folder"); run from source it is `data/plan.json`. A dated copy is saved to a `backups` folder beside it before the
first change of each day. Settings has Export plan and Import plan for moving it between computers. Updating or uninstalling the app leaves the plan in place. The server listens on
127.0.0.1 only, refuses requests from other hosts or origins, requires the token, and refuses a change based on an
older revision than the one on disk, so a change made elsewhere is never overwritten. Set `ARC_DATA` to keep the file somewhere else,
and `ARC_PORT` to change the port.
