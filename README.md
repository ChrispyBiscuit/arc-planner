# Arc

A life-plan dashboard you check into every day. It shows the same plan at six scales (day, week, month, year,
decade, life) on one arc from today to the end of life, and it speaks MCP so Claude can read it, record what
happened and re-plan.

The interface follows [Glimmr](https://github.com/ChrispyBiscuit/GlimmR)'s design system: neutral zero-hue greys,
ink-on-grey actions, colour used only as a mark, the Akira Expanded wordmark (when installed) and Archivo for
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
```

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

Keys: `←` `→` step through time, `T` returns to today, `Ctrl K` searches.

## Claude connection (MCP)

With the server running, the MCP endpoint is `http://127.0.0.1:4747/mcp` (Streamable HTTP).

```
claude mcp add --transport http --scope user arc http://127.0.0.1:4747/mcp
```

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
| `log_revision`, `get_revisions` | Why the plan changed |

## Data

Everything is one file, `plan.json`. The installed app keeps it in `%APPDATA%\Arc Planner` (tray menu, "Open data
folder"); run from source it is `data/plan.json`. A dated copy is saved to a `backups` folder beside it before the
first change of each day. Updating or uninstalling the app leaves the plan in place. The server listens on
127.0.0.1 only and refuses requests from other hosts or origins. Set `ARC_DATA` to keep the file somewhere else,
and `ARC_PORT` to change the port.
