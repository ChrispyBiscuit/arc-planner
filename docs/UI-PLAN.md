# Arc UI plan: blocks, direct manipulation, one editor

Written after a quality pass on 1.3.1 (all views, desktop and narrow widths, light and dark, against a large real
plan: about 1,000 goals and tasks, 1,000 history entries, 1,000 pending proposals).

## Quality findings

| # | Severity | Finding |
|---|---|---|
| Q1 | High | **Items are text, not objects.** Week and month views list items as plain lines; only the day header is clickable. Nothing can be selected, moved or opened where it is shown. |
| Q2 | High | **No direct manipulation.** Moving a task to another day means opening it and retyping its do date. Reordering a day, or moving something into focus, has no gesture at all beyond the star. |
| Q3 | High | **Three different editing surfaces.** Goals and tasks open a full page, routines and metrics a small form, "what happened" edits inline. Users have to learn each. |
| Q4 | High | **Day rows are walls of text.** Each row prints its notes, parent goal, criterion and badges inline, so a day of 15 items is several screens long. |
| Q5 | Medium | **Week columns are unreadable at real volume.** Routines and tasks are mixed in one bullet list per day, 15 to 20 lines each, with no grouping, no load indicator at the top and no way to act on an item. |
| Q6 | Medium | **No undo.** A wrong tick, focus change or move has to be found and reversed by hand. |
| Q7 | Medium | **Inbox bulk actions are page-sized.** With 1,000 proposals, accepting by area or batch takes 25 pages of "select shown". |
| Q8 | Medium | **Every change refetches the whole plan** (about 1.8 MB with pending proposals). Fast today (about 40 ms), but it grows with history. |
| Q9 | Low | **History renders every entry** (about 1,100 rows, 0.2 s). |
| Q10 | Low | **Status is partly colour-only** (marks and dots); keyboard users cannot reach most actions without tabbing through every control. |

Rendering itself is fast: every view except History draws in 6 to 64 ms.

## Target model

- **Every plannable thing is a block**: tasks, routine sessions, goals and focus items share one component with the
  same anatomy: a done mark, the title, a row of small chips (area, type, minutes, due, status), and nothing else.
  Notes, criteria and history live in the editor, not on the block.
- **Click selects, double-click (or Enter) opens the editor.** The editor is one modal for every kind of item, with
  the full structured form (the same content as the item page), saved with Save or Ctrl+Enter, closed with Escape.
- **Blocks move by drag and drop, and by keyboard.**
  - Day: drag to reorder; drag into or out of Focus.
  - Week and month: drag a task to another day.
  - Board: drag between status columns (accept, mark done, reopen).
  - Keyboard: Alt+Left/Right moves the selected task a day, Alt+Up/Down reorders, Space ticks it, F opens focus.
- **Undo** (Ctrl+Z) for moves, reorders, ticks and focus changes.
- **Week columns** show tasks as blocks, routines folded into one "N routines, 4h 10m" block that expands, and a
  load bar at the top of each day.

## Rules a move must respect

- A task moved later than its end date extends the end only up to its goal's end; beyond that the move is refused
  with the reason.
- Routines repeat, so a routine session cannot be dragged to another day; its editor changes its days.
- Claude's moves still respect capacity; the user's never are refused for capacity, only warned.

## Milestones

| Version | Contents |
|---|---|
| 1.4 | Block component everywhere a task or routine appears; one editor modal; drag and drop on day, week, month and board; keyboard moves; undo; week columns with folded routines and load bars; day rows without inline notes; History paging. |
| 1.5 | Inbox bulk actions by area, batch and type; incremental state updates after each change instead of a full reload; keyboard command palette for every action. |
| 1.6 | Goal tree view with drag to re-parent; month and year views with goal blocks; phone layout for check-in. |
