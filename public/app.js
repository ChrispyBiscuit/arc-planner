import { today, addDays, addMonths, parse, ymd, pad, isoWeek, weekStart, weekDays, daysInMonth, daysBetween, decadeOf, periodsFor, ageOn, dayPlan, goalsFor, periodLabel, HORIZONS } from './shared.js'
import { GOAL_TYPES, TASK_TYPES, ITEM_STATUSES, STATUS_LABELS, CLOSED, PRIORITIES, REQ_KINDS, CRIT_KINDS, OPS_CMP, TEMPLATES, lint, lintPlan, quality, evalItem, effectiveStatus, findItem, ancestors, childGoals, childTasks, childRoutines, itemEnd, normCriteria, criterionProblems } from './model.js'

// ---- tiny DOM kit ------------------------------------------------------------------------------------------------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else if (k === 'value') el.value = v
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
  return el
}
const ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  week: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/>',
  month: '<path d="M8 2v4M16 2v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/>',
  year: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  decade: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  life: '<path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3"/>',
  trend: '<path d="M22 7 13.5 15.5l-5-5L2 17M16 7h6v6"/>',
  review: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  settings: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  board: '<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>'
}
const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24')
  s.setAttribute('class', 'i')
  s.setAttribute('aria-hidden', 'true')
  s.innerHTML = ICONS[name]
  return s
}
const fmt = (s, o) => parse(s).toLocaleDateString('en-US', o)
const num = (n) => Number(n).toLocaleString('en-US')
const plural = (n, w) => `${num(n)} ${w}${n === 1 ? '' : 's'}`

// ---- state -------------------------------------------------------------------------------------------------------
const VIEWS = ['day', 'week', 'month', 'year', 'decade', 'life', 'history', 'routines', 'metrics', 'review', 'settings', 'item', 'inbox', 'board']
const st = { db: null, view: 'day', date: today(), area: null, ref: '' }
let pendingRender = false

function readHash() {
  const [v, d, ref] = location.hash.slice(1).split('/')
  if (VIEWS.includes(v)) st.view = v
  if (/^\d{4}-\d{2}-\d{2}$/.test(d || '')) st.date = d
  st.ref = ref ? decodeURIComponent(ref) : ''
}
function go(view, date, ref) {
  if (st.view === 'item' && draftDirty && !confirm('Leave without saving your changes to this item?')) return
  if (view !== 'item' || ref !== st.ref) draftDirty = false
  st.view = view
  if (date) st.date = date
  st.ref = view === 'item' ? ref || st.ref : ''
  history.pushState(null, '', `#${st.view}/${st.date}${st.view === 'item' ? '/' + encodeURIComponent(st.ref) : ''}`)
  render(true)
}

async function loadState() {
  const r = await fetch('/api/state')
  if (r.status === 401) {
    const e = new Error('signed out')
    e.code = 'AUTH'
    throw e
  }
  st.db = await r.json()
}
/**
 * Runs an operation on the server. Every call says which revision it was based on, so a change made elsewhere since
 * the last load is never overwritten: the server refuses it, and the plan is reloaded.
 */
async function op(name, args, { silent, quiet } = {}) {
  const r = await fetch('/api/op', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: name, args, basedOnRev: st.db?.rev }) })
  const out = await r.json().catch(() => ({ error: 'No answer from Arc' }))
  if (!r.ok) {
    if (out.code === 'STALE') {
      await loadState()
      render()
      toast('The plan changed elsewhere, so it was reloaded. Please try again.')
    } else if (!quiet) toast(out.error || 'Something went wrong')
    const e = new Error(out.error)
    Object.assign(e, { code: out.code, unmet: out.unmet })
    throw e
  }
  await loadState()
  if (!silent) render()
  return out.result
}
function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status' }, msg)
  document.body.append(t)
  setTimeout(() => t.remove(), 3200)
}

const area = (id) => st.db.areas.find((a) => a.id === id) || { id, name: id || 'Unsorted', color: 'grey' }
const dot = (id) => h('span', { class: 'dot', style: `background:var(--${area(id).color || 'grey'})`, title: area(id).name })
const inArea = (x) => !st.area || x.area === st.area
const goal = (id) => st.db.goals.find((g) => g.id === id)
const age = (date) => ageOn(st.db.profile.birthDate, date)

function periodDate(horizon, period) {
  const now = today()
  if (horizon === 'week') {
    const [y, w] = period.split('-W').map(Number)
    return addDays(weekStart(`${y}-01-04`), (w - 1) * 7)
  }
  if (horizon === 'month') return now.startsWith(period) ? now : period + '-01'
  if (horizon === 'year') return now.startsWith(period) ? now : period + '-01-01'
  if (horizon === 'decade') return decadeOf(+now.slice(0, 4)) === +period ? now : period + '-01-01'
  return now
}

// ---- dialogs -----------------------------------------------------------------------------------------------------
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
function formDialog({ title, fields, values = {}, canDelete, confirm = 'Save' }) {
  return new Promise((resolve) => {
    const inputs = {}
    const rows = fields.flatMap((f) => {
      const v = values[f.name] ?? f.default ?? ''
      let input
      if (f.type === 'textarea') input = h('textarea', { class: 'field', rows: 3, value: v, placeholder: f.placeholder })
      else if (f.type === 'select') input = h('select', { class: 'field' }, f.options.map(([val, label]) => h('option', { value: val, selected: String(val) === String(v) }, label)))
      else if (f.type === 'days') {
        const on = new Set(values[f.name] || [0, 1, 2, 3, 4, 5, 6])
        input = h('div', { class: 'days' }, [1, 2, 3, 4, 5, 6, 0].map((d) => h('label', { title: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d] }, h('input', { type: 'checkbox', value: d, checked: on.has(d) }), DOW[d])))
      } else if (f.type === 'checkbox') input = h('input', { type: 'checkbox', checked: v !== false && v !== '' })
      else input = h('input', { class: 'field', type: f.type || 'text', value: v, placeholder: f.placeholder, step: f.step })
      inputs[f.name] = input
      const id = 'f-' + f.name
      if (f.type !== 'days') input.id = id
      return [h('label', { for: id }, f.label), input]
    })
    const read = () =>
      Object.fromEntries(
        fields.map((f) => {
          const el = inputs[f.name]
          if (f.type === 'days') return [f.name, [...el.querySelectorAll('input:checked')].map((i) => +i.value).sort()]
          if (f.type === 'checkbox') return [f.name, el.checked]
          if (f.type === 'number') return [f.name, el.value === '' ? undefined : +el.value]
          return [f.name, el.value]
        })
      )
    const done = (v) => {
      dlg.close()
      dlg.remove()
      resolve(v)
    }
    const dlg = h(
      'dialog',
      { onclose: () => dlg.isConnected && done(null) },
      h(
        'form',
        {
          onsubmit: (e) => {
            e.preventDefault()
            done(read())
          }
        },
        h('h3', {}, title),
        h('div', { class: 'form' }, rows),
        h(
          'div',
          { class: 'actions' },
          canDelete && h('button', { type: 'button', class: 'btn danger', onclick: () => done('delete') }, 'Delete'),
          h('span', { class: 'spacer' }),
          h('button', { type: 'button', class: 'btn', onclick: () => done(null) }, 'Cancel'),
          h('button', { class: 'btn primary' }, confirm)
        )
      )
    )
    document.body.append(dlg)
    dlg.showModal()
  })
}
const areaOptions = () => st.db.areas.map((a) => [a.id, a.name])
const goalOptions = (filter = () => true) => [['', 'None'], ...st.db.goals.filter((g) => (g.status || 'active') === 'active' && filter(g)).map((g) => [g.id, `${periodLabel(g.horizon, g.period)}: ${g.title}`])]

async function editGoal(g, horizon, period) {
  if (g) return openItem('g:' + g.id)
  return newItem('goal', { horizon, period })
}
async function editGoalOld(g, horizon, period) {
  const isNew = !g
  const hz = g?.horizon || horizon
  const up = HORIZONS[HORIZONS.indexOf(hz) + 1]
  const v = await formDialog({
    title: isNew ? `New goal for ${periodLabel(horizon, period)}` : `Goal for ${periodLabel(g.horizon, g.period)}`,
    canDelete: !isNew,
    values: g || { area: st.area || st.db.areas[0]?.id, status: 'active', progress: 0 },
    fields: [
      { name: 'title', label: 'Goal', placeholder: 'What will be true' },
      { name: 'measure', label: 'Measured by', placeholder: 'How you will know it is done' },
      { name: 'detail', label: 'Notes', type: 'textarea' },
      { name: 'area', label: 'Area', type: 'select', options: areaOptions() },
      { name: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['done', 'Done'], ['dropped', 'Dropped']] },
      { name: 'progress', label: 'Progress %', type: 'number' },
      ...(up ? [{ name: 'parentId', label: 'Serves', type: 'select', options: goalOptions((x) => HORIZONS.indexOf(x.horizon) > HORIZONS.indexOf(hz)) }] : [])
    ]
  })
  if (!v) return
  if (v === 'delete') return op('delete_goal', { id: g.id })
  if (!v.title.trim()) return toast('A goal needs a title')
  await op('upsert_goal', isNew ? { ...v, horizon, period } : { ...v, id: g.id })
}
async function editTask(t, date) {
  if (t) return openItem('t:' + t.id)
  return newItem('task', { date: date || today() })
}
async function editTaskOld(t, date) {
  const v = await formDialog({
    title: t ? 'Edit target' : 'New target',
    canDelete: !!t,
    values: t || { date, area: st.area || st.db.areas[0]?.id },
    fields: [
      { name: 'title', label: 'Target' },
      { name: 'target', label: 'Amount', placeholder: 'e.g. 45 min, 5 applications' },
      { name: 'detail', label: 'Notes', type: 'textarea' },
      { name: 'area', label: 'Area', type: 'select', options: areaOptions() },
      { name: 'date', label: 'Day', type: 'date' },
      { name: 'time', label: 'When', type: 'select', options: [['', 'Any time'], ['am', 'Morning'], ['pm', 'Evening']] },
      { name: 'goalId', label: 'Serves', type: 'select', options: goalOptions() }
    ]
  })
  if (!v) return
  if (v === 'delete') return op('delete_task', { id: t.id })
  await op('upsert_task', t ? { ...v, id: t.id } : v)
}
async function editRoutine(r) {
  const v = await formDialog({
    title: r ? 'Edit routine' : 'New routine',
    canDelete: !!r,
    values: r || { area: st.area || st.db.areas[0]?.id, start: today(), active: true },
    fields: [
      { name: 'title', label: 'Routine' },
      { name: 'target', label: 'Amount', placeholder: 'e.g. 8 hours, 30 min' },
      { name: 'criterion', label: 'A session passes when', placeholder: 'e.g. at least 30 minutes, or one section at 80%' },
      { name: 'detail', label: 'Notes', type: 'textarea' },
      { name: 'area', label: 'Area', type: 'select', options: areaOptions() },
      { name: 'days', label: 'Days', type: 'days' },
      { name: 'time', label: 'When', type: 'select', options: [['', 'Any time'], ['am', 'Morning'], ['pm', 'Evening']] },
      { name: 'start', label: 'Starts', type: 'date' },
      { name: 'end', label: 'Ends', type: 'date' },
      { name: 'goalId', label: 'Serves (a habit goal)', type: 'select', options: goalOptions() },
      { name: 'active', label: 'Active', type: 'checkbox' }
    ]
  })
  if (!v) return
  if (v === 'delete') return op('delete_routine', { id: r.id })
  if (!v.title.trim()) return toast('A routine needs a title')
  await op('upsert_routine', r ? { ...v, id: r.id } : v)
}
async function editMetric(m) {
  const v = await formDialog({
    title: m ? 'Edit metric' : 'New metric',
    canDelete: !!m,
    values: m || { area: st.db.areas[0]?.id },
    fields: [
      { name: 'name', label: 'Metric', placeholder: 'e.g. Bodyweight' },
      { name: 'unit', label: 'Unit', placeholder: 'lb' },
      { name: 'area', label: 'Area', type: 'select', options: areaOptions() },
      { name: 'target', label: 'Target', type: 'number', step: 'any' },
      { name: 'targetDate', label: 'By', type: 'date' }
    ]
  })
  if (!v) return
  if (v === 'delete') return op('delete_metric', { id: m.id })
  if (!v.name.trim()) return toast('A metric needs a name')
  await op('upsert_metric', m ? { ...v, id: m.id } : v)
}
async function editPhase(p) {
  const v = await formDialog({
    title: p ? 'Edit chapter' : 'New chapter',
    canDelete: !!p,
    values: p || { startYear: +today().slice(0, 4), endYear: +today().slice(0, 4) + 5 },
    fields: [
      { name: 'title', label: 'Chapter' },
      { name: 'theme', label: 'Theme', placeholder: 'One line: what this stretch is for' },
      { name: 'startYear', label: 'From year', type: 'number' },
      { name: 'endYear', label: 'To year', type: 'number' },
      { name: 'detail', label: 'Notes', type: 'textarea' }
    ]
  })
  if (!v) return
  if (v === 'delete') return op('delete_phase', { id: p.id })
  await op('upsert_phase', p ? { ...v, id: p.id } : v)
}

// ---- shared pieces -----------------------------------------------------------------------------------------------
function goalList(horizon, period, { add = true } = {}) {
  const goals = goalsFor(st.db, horizon, period).filter(inArea)
  const rank = { proposed: 0, active: 1, accepted: 1, blocked: 1, missed: 2, done: 3, dropped: 4 }
  goals.sort((a, b) => (rank[effectiveStatus(st.db, a, 'goal')] ?? 1) - (rank[effectiveStatus(st.db, b, 'goal')] ?? 1))
  return h(
    'div',
    {},
    goals.length
      ? h(
          'div',
          { class: 'rows' },
          goals.map((g) => {
            const parent = g.parentId && goal(g.parentId)
            const ev = evalItem(st.db, g, 'goal')
            const crit = (g.criteria || []).map((c) => c.text).filter(Boolean).join('. ')
            return h(
              'button',
              { class: `goal ${g.status || 'active'}`, onclick: () => editGoal(g) },
              dot(g.area),
              h('span', {}, h('div', { class: 'title' }, g.title), h('div', { class: 'sub' }, typeLabel('goal', g.type), crit ? `. Done when: ${crit}` : g.measure ? `. ${g.measure}` : '', parent ? `. Serves: ${parent.title}` : '')),
              h('span', { class: 'badges' }, statusBadge(st.db, g, 'goal'), qualityBadge(st.db, g, 'goal'), CLOSED.has(g.status) ? null : h('span', { class: 'bar', title: `${ev.progress}%` }, h('i', { style: `width:${ev.progress}%` })))
            )
          })
        )
      : h('div', { class: 'empty' }, `No goals set for ${periodLabel(horizon, period)} yet.`),
    add && h('div', { class: 'add' }, h('button', { class: 'btn ghost', onclick: () => editGoal(null, horizon, period) }, icon('plus'), 'Add goal'))
  )
}
const sechead = (title, meta, big) => h('div', { class: 'sechead' }, h(big ? 'h2' : 'h3', { class: 'display' }, title), h('span', { class: 'spacer' }), meta && h('span', { class: 'meta tnum' }, meta))
const scoreText = (s) => (s.total ? `${s.done} of ${s.total} done` : 'Nothing scheduled')
const meter = (s) => h('div', { class: 'meter', title: s.pct == null ? '' : `${s.pct}%` }, h('i', { style: `width:${s.pct || 0}%` }))

// ---- views -------------------------------------------------------------------------------------------------------
function viewDay() {
  const d = st.date
  const plan = dayPlan(st.db, d)
  const items = plan.items.filter(inArea)
  const p = periodsFor(d)
  const y = +d.slice(0, 4)
  const left = daysBetween(d, `${y}-12-31`)
  const isToday = d === today()

  const row = (it) => {
    const cycle = () =>
      op('set_item_status', { date: d, key: it.key, status: it.status === 'done' ? 'todo' : 'done' }, { quiet: true }).catch((e) => {
        if (e.code === 'CRITERIA') {
          toast('Its acceptance criteria are not all met yet. Here they are.')
          openItem(it.key)
        } else if (e.code !== 'STALE') toast(e.message)
      })
    const g = it.goalId && goal(it.goalId)
    const task = it.kind === 'task' && st.db.tasks.find((t) => 't:' + t.id === it.key)
    const open = () => (task ? openItem(it.key) : editRoutine(st.db.routines.find((r) => 'r:' + r.id === it.key)))
    return h(
      'div',
      { class: `row ${it.status}${it.proposed ? ' proposed' : ''}` },
      h('button', { class: `mark ${it.status}`, onclick: cycle, 'aria-label': `${it.status === 'done' ? 'Unmark' : 'Mark done'}: ${it.title}`, 'aria-pressed': String(it.status === 'done') }, it.status === 'done' ? icon('check') : it.status === 'skipped' ? icon('x') : null),
      h(
        'div',
        {},
        h('button', { class: 'title', onclick: open, title: 'Edit' }, it.title),
        h('div', { class: 'sub' }, dot(it.area), area(it.area).name, task && task.type ? typeLabel('task', task.type) : null, it.target && h('span', { class: 'tnum' }, it.target), it.time && (it.time === 'am' ? 'Morning' : 'Evening'), task && task.end && task.end !== d ? h('span', { class: 'tnum' }, `Due ${fmt(task.end, { month: 'short', day: 'numeric' })}`) : null, g && h('span', {}, `For: ${g.title}`), task ? statusBadge(st.db, task, 'task') : null, it.criterion ? h('span', {}, `Pass: ${it.criterion}`) : null),
        it.detail && h('div', { class: 'sub' }, it.detail)
      ),
      h(
        'div',
        { class: 'tools' },
        h('input', { class: 'actual tnum', 'aria-label': `What happened: ${it.title}`, placeholder: 'What happened', value: it.actual, onchange: (e) => op('set_item_status', { date: d, key: it.key, actual: e.target.value }, { silent: true }) }),
        h(
          'div',
          { class: 'seg' },
          h('button', { 'aria-pressed': String(it.status === 'partial'), onclick: () => op('set_item_status', { date: d, key: it.key, status: it.status === 'partial' ? 'todo' : 'partial' }) }, 'Partly'),
          h('button', { 'aria-pressed': String(it.status === 'skipped'), onclick: () => op('set_item_status', { date: d, key: it.key, status: it.status === 'skipped' ? 'todo' : 'skipped' }) }, 'Skipped')
        )
      )
    )
  }

  const title = h('input', { placeholder: 'Add a target for this day', 'aria-label': 'New target' })
  const sel = h('select', { 'aria-label': 'Area' }, areaOptions().map(([v, l]) => h('option', { value: v, selected: v === st.area }, l)))
  const addForm = h(
    'form',
    {
      class: 'add',
      onsubmit: (e) => {
        e.preventDefault()
        if (title.value.trim()) op('upsert_task', { date: d, title: title.value.trim(), area: sel.value })
      }
    },
    title,
    sel,
    h('button', { class: 'btn' }, 'Add')
  )

  const c = plan.checkin || {}
  const summary = h('textarea', { class: 'field', rows: 4, placeholder: 'What happened today. Wins, misses, anything that should change the plan.', value: c.summary || '', 'aria-label': 'Check-in notes' })
  const numIn = (name, label, max) => h('label', {}, label, h('input', { class: 'field tnum', type: 'number', step: 'any', min: 0, max, name, value: c[name] ?? '' }))
  const nums = h('div', { class: 'nums' }, numIn('sleepHours', 'Sleep, hours', 24), numIn('energy', 'Energy, 1 to 5', 5), numIn('mood', 'Mood, 1 to 5', 5))
  const metricIns = st.db.metrics.map((m) => {
    const on = (m.entries || []).find((e) => e.date === d)
    const last = (m.entries || []).at(-1)
    return h('label', {}, `${m.name}${m.unit ? ', ' + m.unit : ''}`, h('input', { class: 'field tnum', type: 'number', step: 'any', 'data-metric': m.id, value: on?.value ?? '', placeholder: last ? last.value : '' }))
  })
  const saveCheckin = async () => {
    const args = { date: d, summary: summary.value }
    for (const i of nums.querySelectorAll('input')) if (i.value !== '') args[i.name] = +i.value
    args.metrics = [...checkin.querySelectorAll('[data-metric]')].filter((i) => i.value !== '').map((i) => ({ id: i.dataset.metric, value: +i.value }))
    await op('check_in', args)
    toast('Check-in saved')
  }
  const checkin = h(
    'div',
    { class: 'checkin' },
    summary,
    nums,
    metricIns.length ? h('div', { class: 'nums' }, metricIns) : null,
    h('div', { class: 'nums' }, h('button', { class: 'btn primary', onclick: saveCheckin }, c.at ? 'Update check-in' : 'Save check-in'), h('span', { class: 'muted' }, c.at ? `Saved ${new Date(c.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.` : 'Or tell Claude what happened and it will fill this in.'))
  )

  const chain = h(
    'aside',
    { class: 'chain' },
    sechead('Line of sight'),
    HORIZONS.map((hz) => {
      const gs = goalsFor(st.db, hz, p[hz]).filter((g) => (g.status || 'active') === 'active' && inArea(g))
      return h(
        'div',
        { class: 'step' },
        h('button', { class: 'when', onclick: () => go(hz) }, hz === 'week' ? 'This week' : hz === 'month' ? fmt(d, { month: 'long' }) : hz === 'year' ? String(y) : hz === 'decade' ? `The ${p.decade}s` : 'Life'),
        gs.length ? gs.map((g) => h('div', { class: 'g' }, dot(g.area), h('span', {}, g.title))) : h('div', { class: 'muted' }, 'Nothing set')
      )
    })
  )

  return {
    title: isToday ? 'Today' : 'Day',
    meta: `Week ${isoWeek(d).week}. ${left === 0 ? `Last day of ${y}` : `${plural(left, 'day')} left in ${y}`}.`,
    step: (n) => addDays(d, n),
    body: h(
      'div',
      { class: 'cols' },
      h(
        'div',
        {},
        sechead(fmt(d, { weekday: 'long', month: 'long', day: 'numeric' }), scoreText(dayPlan(st.db, d).score), true),
        plan.brief && h('p', { class: 'lede' }, plan.brief),
        isToday && overdueList().filter((r) => r.kind === 'task' && r.status === 'missed' && inArea(r.item)).length ? [sechead('Overdue', 'Decide each one'), triageList(overdueList().filter((r) => r.kind === 'task' && r.status === 'missed' && inArea(r.item)).slice(0, 8), { compact: true })] : null,
        h('div', { style: 'height:16px' }),
        items.length ? h('div', { class: 'rows' }, items.map(row)) : h('div', { class: 'empty' }, st.area ? `Nothing in ${area(st.area).name} on this day.` : 'Nothing is scheduled for this day. Add a target below, or ask Claude to plan it.'),
        addForm,
        sechead('Check-in'),
        checkin
      ),
      chain
    )
  }
}

function viewWeek() {
  const days = weekDays(st.date)
  const wk = isoWeek(st.date)
  const sameMonth = days[0].slice(0, 7) === days[6].slice(0, 7)
  const range = `${fmt(days[0], { month: 'long', day: 'numeric' })} to ${fmt(days[6], sameMonth ? { day: 'numeric' } : { month: 'long', day: 'numeric' })}`
  const plans = days.map((d) => dayPlan(st.db, d))
  const done = plans.reduce((s, p) => s + p.score.done, 0)
  const total = plans.reduce((s, p) => s + p.score.total, 0)
  return {
    title: 'Week',
    meta: `Week ${wk.week} of ${wk.year}.`,
    step: (n) => addDays(st.date, n * 7),
    body: h(
      'div',
      {},
      sechead(range, total ? `${done} of ${total} targets done` : '', true),
      sechead('Goals this week'),
      goalList('week', wk.key),
      sechead('Days'),
      h(
        'div',
        { class: 'week' },
        plans.map((p) => {
          const items = p.items.filter(inArea)
          return h(
            'div',
            { class: `daycol${p.date === today() ? ' today' : ''}` },
            h('button', { class: 'dhead', onclick: () => go('day', p.date), 'aria-label': `Open ${fmt(p.date, { weekday: 'long', month: 'long', day: 'numeric' })}` }, h('span', { class: 'dnum display tnum' }, +p.date.slice(8)), h('span', { class: 'muted' }, fmt(p.date, { weekday: 'short' })), h('span', { style: 'flex:1' }), p.score.pct != null && p.date <= today() && h('span', { class: 'muted tnum' }, `${p.score.pct}%`)),
            meter(p.date <= today() ? p.score : { pct: 0 }),
            items.map((it) => h('div', { class: `mini ${it.status}` }, dot(it.area), h('span', {}, it.title)))
          )
        })
      )
    )
  }
}

function viewMonth() {
  const y = +st.date.slice(0, 4)
  const m = +st.date.slice(5, 7)
  const key = st.date.slice(0, 7)
  const first = `${key}-01`
  const lead = (parse(first).getDay() || 7) - 1
  const cells = []
  for (let i = 0; i < lead; i++) cells.push(h('div', { class: 'cell out' }))
  for (let day = 1; day <= daysInMonth(y, m); day++) {
    const d = `${key}-${pad(day)}`
    const p = dayPlan(st.db, d)
    const tasks = p.items.filter((it) => it.kind === 'task' && inArea(it))
    cells.push(
      h(
        'button',
        { class: `cell${d === today() ? ' today' : ''}`, onclick: () => go('day', d), 'aria-label': fmt(d, { weekday: 'long', month: 'long', day: 'numeric' }) },
        h('span', { class: 'n tnum' }, day, p.score.total && d <= today() ? h('small', {}, `${p.score.done}/${p.score.total}`) : null),
        d <= today() && p.score.total ? meter(p.score) : null,
        tasks.slice(0, 3).map((it) => h('span', { class: `mini ${it.status}` }, dot(it.area), h('span', {}, it.title))),
        tasks.length > 3 && h('span', { class: 'muted', style: 'font-size:11px' }, `${tasks.length - 3} more`)
      )
    )
  }
  return {
    title: 'Month',
    meta: age(st.date) != null ? `Age ${age(st.date)}.` : '',
    step: (n) => addMonths(st.date, n),
    body: h('div', {}, sechead(fmt(first, { month: 'long', year: 'numeric' }), '', true), sechead('Goals this month'), goalList('month', key), sechead('Days'), h('div', { class: 'month' }, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => h('div', { class: 'dow' }, d)), cells))
  }
}

function viewYear() {
  const y = +st.date.slice(0, 4)
  const now = today()
  const sheets = []
  for (let m = 1; m <= 12; m++) {
    const key = `${y}-${pad(m)}`
    const lead = (parse(key + '-01').getDay() || 7) - 1
    const sq = []
    for (let i = 0; i < lead; i++) sq.push(h('span', { class: 'sq blank' }))
    for (let day = 1; day <= daysInMonth(y, m); day++) {
      const d = `${key}-${pad(day)}`
      const s = d <= now ? dayPlan(st.db, d).score : null
      sq.push(h('button', { class: `sq${d > now ? ' future' : ''}${d === now ? ' today' : ''}`, title: `${fmt(d, { month: 'short', day: 'numeric' })}${s?.total ? `: ${s.pct}%` : ''}`, 'aria-label': fmt(d, { month: 'long', day: 'numeric' }), onclick: () => go('day', d) }, s?.pct ? h('i', { style: `opacity:${0.25 + (s.pct / 100) * 0.75}` }) : null))
    }
    const n = goalsFor(st.db, 'month', key).filter(inArea).length
    sheets.push(h('div', {}, h('button', { class: 'sheet-title', onclick: () => go('month', key + '-01') }, h('span', { class: 'display' }, fmt(key + '-01', { month: 'long' })), h('span', { class: 'muted tnum' }, n ? plural(n, 'goal') : '')), h('div', { class: 'sheet' }, sq)))
  }
  const a = age(`${y}-12-31`)
  const phases = st.db.phases.filter((p) => p.startYear <= y && p.endYear >= y)
  return {
    title: 'Year',
    meta: [a != null && `The year you turn ${a}.`, phases.length && `Chapter: ${phases.map((p) => p.title).join(', ')}.`].filter(Boolean).join(' '),
    step: (n) => addMonths(st.date, n * 12),
    body: h('div', {}, sechead(String(y), '', true), sechead('Goals this year'), goalList('year', String(y)), sechead('Days', 'Greener squares are days with more targets met'), h('div', { class: 'year' }, sheets))
  }
}

function viewDecade() {
  const start = decadeOf(+st.date.slice(0, 4))
  const nowY = +today().slice(0, 4)
  return {
    title: 'Decade',
    meta: age(`${start}-12-31`) != null ? `Ages ${Math.max(0, age(`${start}-12-31`))} to ${age(`${start + 9}-12-31`)}.` : '',
    step: (n) => addMonths(st.date, n * 120),
    body: h(
      'div',
      {},
      sechead(`The ${start}s`, '', true),
      sechead('Goals this decade'),
      goalList('decade', String(start)),
      sechead('Years'),
      h(
        'div',
        { class: 'rows' },
        Array.from({ length: 10 }, (_, i) => start + i).map((y) => {
          const ph = st.db.phases.filter((p) => p.startYear <= y && p.endYear >= y)
          const a = age(`${y}-12-31`)
          return h(
            'div',
            { class: `yr${y === nowY ? ' now' : ''}` },
            h('button', { class: 'yhead', onclick: () => go('year', y === nowY ? today() : `${y}-01-01`) }, h('div', { class: 'display tnum' }, y), a != null && a >= 0 && h('div', { class: 'muted' }, `Age ${a}`), ph.map((p) => h('div', { class: 'muted' }, p.title))),
            goalList('year', String(y), { add: y >= nowY })
          )
        })
      )
    )
  }
}

function viewLife() {
  const { birthDate, lifeExpectancy = 85 } = st.db.profile
  const now = today()
  let grid = h('div', { class: 'empty' }, 'Set your date of birth in Settings to draw the arc.')
  let lede = ''
  if (birthDate) {
    const by = +birthDate.slice(0, 4)
    const a = ageOn(birthDate, now)
    const lastBirthday = `${by + a}${birthDate.slice(4)}`
    const lived = a * 52 + Math.min(51, Math.floor(daysBetween(lastBirthday, now) / 7))
    const total = lifeExpectancy * 52
    lede = `You are in week ${num(lived + 1)} of ${num(total)}. At a life expectancy of ${lifeExpectancy}, ${num(Math.max(0, total - lived - 1))} weeks remain. Each row is a year of your life and each square a week.`
    grid = h('div', { class: 'life' })
    let html = ''
    for (let yr = 0; yr < lifeExpectancy; yr++) {
      if (yr && yr % 10 === 0) html += '<div class="gap"></div>'
      let w = ''
      for (let k = 0; k < 52; k++) {
        const i = yr * 52 + k
        w += i < lived ? '<i class="past"></i>' : i === lived ? '<i class="now"></i>' : '<i></i>'
      }
      const ph = st.db.phases.filter((p) => p.startYear === by + yr)
      html += `<div class="age tnum">${yr % 5 === 0 ? `${yr} <span>(${by + yr})</span>` : ''}</div><div class="wks">${w}</div><div class="ph"></div>`
      grid.insertAdjacentHTML('beforeend', html)
      html = ''
      if (ph.length) grid.lastElementChild.textContent = ph.map((p) => `${p.title}, ${p.startYear} to ${p.endYear}`).join('; ')
    }
  }
  const phases = [...st.db.phases].sort((a, b) => a.startYear - b.startYear)
  return {
    title: 'Life',
    meta: age(now) != null ? `Age ${age(now)}.` : '',
    body: h(
      'div',
      {},
      sechead('The whole arc', '', true),
      lede && h('p', { class: 'lede' }, lede),
      sechead('Life goals'),
      goalList('life', 'life'),
      sechead('Chapters'),
      phases.length
        ? h(
            'div',
            { class: 'rows' },
            phases.map((p) =>
              h('button', { class: 'phase', onclick: () => editPhase(p) }, h('span', {}, h('div', { class: 'display tnum' }, `${p.startYear} to ${p.endYear}`), birthDate && h('div', { class: 'muted' }, `Ages ${p.startYear - +birthDate.slice(0, 4)} to ${p.endYear - +birthDate.slice(0, 4)}`)), h('span', {}, h('div', { style: 'font-size:14px;font-weight:500' }, p.title), p.theme && h('div', {}, p.theme), p.detail && h('div', { class: 'muted' }, p.detail)))
            )
          )
        : h('div', { class: 'empty' }, 'No chapters yet.'),
      h('div', { class: 'add' }, h('button', { class: 'btn ghost', onclick: () => editPhase() }, icon('plus'), 'Add chapter')),
      sechead('Weeks'),
      grid
    )
  }
}

function viewRoutines() {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const days = (r) => (!r.days || r.days.length === 7 ? 'Every day' : [1, 2, 3, 4, 5, 6, 0].filter((d) => r.days.includes(d)).map((d) => names[d]).join(', '))
  const list = st.db.routines.filter(inArea)
  return {
    title: 'Routines',
    meta: 'Recurring targets that fill each day on their own.',
    body: h(
      'div',
      {},
      sechead('Routines', plural(list.filter((r) => r.active !== false && (!r.end || r.end >= today())).length, 'active routine'), true),
      h('div', { style: 'height:16px' }),
      list.length
        ? h(
            'table',
            {},
            h('thead', {}, h('tr', {}, ['Routine', 'Amount', 'Days', 'Runs'].map((t) => h('th', {}, t)))),
            h(
              'tbody',
              {},
              list.map((r) => {
                const over = r.active === false || (r.end && r.end < today())
                return h('tr', { class: over ? 'muted' : '' }, h('td', {}, h('button', { onclick: () => editRoutine(r), style: 'display:flex;gap:8px;align-items:center;font-weight:500' }, dot(r.area), r.title)), h('td', { class: 'tnum' }, r.target || ''), h('td', {}, days(r)), h('td', { class: 'tnum' }, r.active === false ? 'Paused' : `${r.start ? 'From ' + fmt(r.start, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Always'}${r.end ? ' to ' + fmt(r.end, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}`))
              })
            )
          )
        : h('div', { class: 'empty' }, 'No routines yet.'),
      h('div', { class: 'add' }, h('button', { class: 'btn', onclick: () => editRoutine() }, icon('plus'), 'New routine'))
    )
  }
}

function spark(m) {
  const e = m.entries || []
  if (e.length < 2) return h('div', { class: 'muted' }, e.length ? 'One reading so far.' : 'No readings yet.')
  const vals = e.map((x) => x.value).concat(m.target != null ? [m.target] : [])
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const t0 = parse(e[0].date).getTime()
  const span = parse(e.at(-1).date).getTime() - t0 || 1
  const yOf = (v) => 44 - ((v - lo) / (hi - lo || 1)) * 40
  const pts = e.map((x) => `${(((parse(x.date).getTime() - t0) / span) * 300).toFixed(1)},${yOf(x.value).toFixed(1)}`).join(' ')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 300 48')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('class', 'spark')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', `${m.name} from ${e[0].value} to ${e.at(-1).value}${m.unit ? ' ' + m.unit : ''}`)
  svg.innerHTML = (m.target != null ? `<line class="t" x1="0" x2="300" y1="${yOf(m.target)}" y2="${yOf(m.target)}"/>` : '') + `<polyline class="l" points="${pts}"/>`
  return svg
}
function viewMetrics() {
  const list = st.db.metrics.filter(inArea)
  return {
    title: 'Metrics',
    meta: 'Numbers you track over time. The dashed line is the target.',
    body: h(
      'div',
      {},
      sechead('Metrics', '', true),
      h('div', { style: 'height:16px' }),
      list.length
        ? h(
            'div',
            { class: 'rows' },
            list.map((m) => {
              const last = (m.entries || []).at(-1)
              const input = h('input', { class: 'field tnum', type: 'number', step: 'any', style: 'width:96px', placeholder: 'Today', 'aria-label': `Log ${m.name}` })
              return h(
                'div',
                { class: 'metric' },
                h('button', { onclick: () => editMetric(m) }, h('div', { style: 'display:flex;gap:8px;align-items:center;font-weight:500;font-size:14px' }, dot(m.area), m.name), h('div', { class: 'muted tnum' }, m.target != null ? `Target ${num(m.target)}${m.unit ? ' ' + m.unit : ''}${m.targetDate ? ' by ' + fmt(m.targetDate, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}` : 'No target set')),
                spark(m),
                h(
                  'form',
                  {
                    style: 'display:flex;gap:8px;align-items:center',
                    onsubmit: (ev) => {
                      ev.preventDefault()
                      if (input.value !== '') op('log_metric', { id: m.id, value: +input.value })
                    }
                  },
                  h('span', { class: 'v display tnum' }, last ? num(last.value) : ''),
                  h('span', { class: 'muted' }, last ? `${m.unit || ''} on ${fmt(last.date, { month: 'short', day: 'numeric' })}` : ''),
                  input,
                  h('button', { class: 'btn' }, 'Log')
                )
              )
            })
          )
        : h('div', { class: 'empty' }, 'No metrics yet.'),
      h('div', { class: 'add' }, h('button', { class: 'btn', onclick: () => editMetric() }, icon('plus'), 'New metric'))
    )
  }
}

function viewReview() {
  const to = today()
  const days = Array.from({ length: 30 }, (_, i) => addDays(to, i - 29))
  const plans = days.map((d) => dayPlan(st.db, d))
  const scored = plans.filter((p) => p.score.total)
  const overall = scored.length ? Math.round(scored.reduce((s, p) => s + p.score.pct, 0) / scored.length) : null
  const tally = (keyOf, label) => {
    const map = new Map()
    for (const p of plans)
      for (const it of p.items) {
        const k = keyOf(it)
        if (!k) continue
        const row = map.get(k) || { label: label(it), area: it.area, n: 0, done: 0, partial: 0, skipped: 0 }
        row.n++
        if (row[it.status] !== undefined) row[it.status]++
        map.set(k, row)
      }
    return [...map.values()].map((r) => ({ ...r, pct: Math.round(((r.done + r.partial * 0.5) / r.n) * 100) })).sort((a, b) => a.pct - b.pct)
  }
  const table = (rows, head) =>
    rows.length
      ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, head), h('th', { class: 'num' }, 'Scheduled'), h('th', { class: 'num' }, 'Done'), h('th', { class: 'num' }, 'Skipped'), h('th', { class: 'num' }, 'Met'))), h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, h('span', { style: 'display:flex;gap:8px;align-items:center' }, dot(r.area), r.label)), h('td', { class: 'num tnum' }, r.n), h('td', { class: 'num tnum' }, r.done), h('td', { class: 'num tnum' }, r.skipped), h('td', { class: 'num tnum' }, `${r.pct}%`)))))
      : h('div', { class: 'empty' }, 'Nothing scheduled in this span yet.')
  const revs = st.db.revisions.slice(-40).reverse()
  return {
    title: 'Review',
    meta: 'The last 30 days.',
    body: h(
      'div',
      {},
      sechead(overall == null ? 'No days scored yet' : `${overall}% of targets met`, `${fmt(days[0], { month: 'short', day: 'numeric' })} to ${fmt(to, { month: 'short', day: 'numeric' })}`, true),
      h('p', { class: 'lede' }, `${plural(plans.filter((p) => p.checkin).length, 'check-in')} in 30 days. Lowest rows come first, since those are the ones to rethink.`),
      h('div', { style: 'height:20px' }),
      h('div', { class: 'strip', role: 'img', 'aria-label': 'Targets met per day, last 30 days' }, plans.map((p) => h('i', { class: p.score.pct ? '' : 'none', style: `height:${p.score.pct || 0}%`, title: `${fmt(p.date, { month: 'short', day: 'numeric' })}: ${p.score.pct ?? 0}%` }))),
      planQualitySection(),
      sechead('By area'),
      table(tally((it) => it.area, (it) => area(it.area).name), 'Area'),
      sechead('By routine'),
      table(tally((it) => it.kind === 'routine' && it.key, (it) => it.title), 'Routine'),
      sechead('Plan changes'),
      revs.length ? h('table', {}, h('tbody', {}, revs.map((r) => h('tr', {}, h('td', { class: 'muted tnum', style: 'white-space:nowrap;width:1%' }, new Date(r.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })), h('td', { class: 'muted', style: 'width:1%' }, r.actor === 'claude' ? 'Claude' : 'You'), h('td', {}, r.summary))))) : h('div', { class: 'empty' }, 'No changes recorded yet.')
    )
  }
}

function viewSettings() {
  const p = st.db.profile
  const f = (name, label, type = 'text', extra = {}) => [h('label', { for: 's-' + name }, label), h('input', { class: 'field', id: 's-' + name, name, type, value: p[name] ?? '', ...extra })]
  const dark = document.documentElement.classList.contains('dark')
  const url = `${location.origin}/mcp`
  const policyBox = h('textarea', { class: 'field', rows: 6, value: (st.db.policy?.excluded || []).join('\n'), 'aria-label': 'Excluded topics' })
  fetch('/api/token')
    .then((r) => r.json())
    .then((t) => {
      const el = document.getElementById('mcp-cmd')
      if (el) el.textContent = `claude mcp add --transport http --scope user arc ${url} --header "Authorization: Bearer ${t.token}"`
    })
    .catch(() => {})
  const showUpdate = (u) => {
    const el = document.getElementById('upd-state')
    if (!el) return
    el.textContent = `Version ${u.version}. ${u.state}${/[.…]$/.test(u.state) ? '' : '.'}`
    document.getElementById('upd-check').hidden = !u.desktop
    document.getElementById('upd-install').hidden = !u.ready
  }
  const update = async (action) => {
    showUpdate(await (await fetch('/api/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })).json())
    for (const ms of [1500, 4000, 9000, 20000, 45000, 90000]) setTimeout(() => fetch('/api/update').then((r) => r.json()).then(showUpdate).catch(() => {}), ms)
  }
  fetch('/api/update')
    .then((r) => r.json())
    .then(showUpdate)
    .catch(() => {})
  const picker = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: () => picker.files[0] && importFile(picker.files[0]) })
  fetch('/api/version')
    .then((r) => r.json())
    .then((v) => {
      const el = document.getElementById('plan-path')
      if (el && v.file) el.textContent = v.file
    })
    .catch(() => {})
  return {
    title: 'Settings',
    body: h(
      'div',
      { style: 'max-width:640px' },
      sechead('You', '', true),
      h('div', { style: 'height:16px' }),
      h(
        'form',
        {
          class: 'form',
          onsubmit: async (e) => {
            e.preventDefault()
            const d = new FormData(e.target)
            await op('update_profile', { name: d.get('name'), birthDate: d.get('birthDate'), lifeExpectancy: +d.get('lifeExpectancy') || 85 })
            toast('Saved')
          }
        },
        f('name', 'Name'),
        f('birthDate', 'Date of birth', 'date'),
        f('lifeExpectancy', 'Plan to age', 'number', { min: 1, max: 130 }),
        h('span'),
        h('div', {}, h('button', { class: 'btn primary' }, 'Save'))
      ),
      sechead('Appearance'),
      h(
        'div',
        { class: 'seg' },
        ['Dark', 'Light'].map((t) =>
          h(
            'button',
            {
              'aria-pressed': String(dark === (t === 'Dark')),
              onclick: () => {
                document.documentElement.classList.toggle('dark', t === 'Dark')
                try {
                  localStorage.setItem('arc-theme', t.toLowerCase())
                } catch {}
                render()
              }
            },
            t
          )
        )
      ),
      h('div', { style: 'height:16px' }),
      h('div', { class: 'muted', style: 'margin-bottom:6px' }, 'Interface size'),
      h(
        'div',
        { class: 'seg', role: 'group', 'aria-label': 'Interface size' },
        SCALES.map((z) =>
          h(
            'button',
            {
              'aria-pressed': String(scale() === z),
              onclick: () => {
                setScale(z)
                render()
              }
            },
            `${z}%`
          )
        )
      ),
      sechead('Updates'),
      h('p', { class: 'lede', id: 'upd-state' }, 'Checking…'),
      h(
        'div',
        { class: 'add' },
        h('button', { class: 'btn', id: 'upd-check', onclick: () => update('check') }, 'Check for updates'),
        h('button', { class: 'btn primary', id: 'upd-install', hidden: true, onclick: () => update('install') }, 'Restart and update')
      ),
      sechead('Excluded topics'),
      h('p', { class: 'lede' }, 'Claude is told never to add these to the plan, and any change from Claude that mentions one is refused. One per line.'),
      policyBox,
      h('div', { class: 'add' }, h('button', { class: 'btn', onclick: async () => (await op('set_policy', { excluded: policyBox.value.split('\n') }), toast('Saved')) }, 'Save excluded topics')),
      sechead('Claude connection'),
      h('p', { class: 'lede' }, 'Claude reads and updates this plan through MCP, signed in with a private token kept on this computer. With Arc running, the endpoint is:'),
      h('p', {}, h('code', {}, url)),
      h('p', { class: 'muted' }, 'To connect Claude Code, run this once in a terminal:'),
      h('pre', { id: 'mcp-cmd' }, 'Loading…'),
      
      sechead('Your data'),
      h('p', { class: 'lede' }, 'Everything is one file on this computer, with a dated backup kept beside it each day the plan changes. Nothing is sent anywhere.'),
      h('p', {}, h('code', { id: 'plan-path' }, 'plan.json')),
      h(
        'div',
        { class: 'add' },
        h('button', { class: 'btn', onclick: exportPlan }, 'Export plan'),
        h('button', { class: 'btn', onclick: () => picker.click() }, 'Import plan'),
        picker
      )
    )
  }
}

function exportPlan() {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(st.db, null, 1)], { type: 'application/json' })), download: `arc-plan-${today()}.json` })
  a.click()
  URL.revokeObjectURL(a.href)
}
async function importFile(file) {
  const ok = await formDialog({ title: `Replace the whole plan with ${file.name}?`, fields: [], confirm: 'Replace plan' })
  if (!ok) return
  const r = await fetch(`/api/import?basedOnRev=${st.db.rev}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: await file.text() })
  const out = await r.json()
  if (!r.ok) return toast(out.error || 'Import failed')
  await loadState()
  render(true)
  toast('Plan imported. The previous plan is in the backups folder.')
}

const SCALES = [80, 90, 100, 110, 125, 150, 175]
function scale() {
  try {
    return +localStorage.getItem('arc-scale') || 100
  } catch {
    return 100
  }
}
function setScale(z) {
  document.documentElement.style.zoom = z === 100 ? '' : z / 100
  try {
    localStorage.setItem('arc-scale', z)
  } catch {}
}

async function editFact(f) {
  const v = await formDialog({
    title: f ? 'Edit history entry' : 'New history entry',
    canDelete: !!f,
    values: f || { date: today(), area: st.area || st.db.areas[0]?.id, kind: 'event' },
    fields: [
      { name: 'title', label: 'What' },
      { name: 'detail', label: 'Detail', type: 'textarea' },
      { name: 'date', label: 'When', type: 'date' },
      { name: 'area', label: 'Area', type: 'select', options: areaOptions() },
      { name: 'kind', label: 'Kind', type: 'select', options: ['event', 'decision', 'reading', 'plan', 'idea', 'pattern', 'purchase', 'statement'].map((k) => [k, k[0].toUpperCase() + k.slice(1)]) }
    ]
  })
  if (!v) return
  if (v === 'delete') return op('delete_fact', { id: f.id })
  if (!v.title.trim()) return toast('An entry needs a title')
  await op('add_fact', f ? { ...v, id: f.id } : v)
}

let historyQuery = ''
let historyTimer = 0
const entries = (n) => `${num(n)} ${n === 1 ? 'entry' : 'entries'}`
function viewHistory() {
  const q = historyQuery.trim().toLowerCase()
  const facts = (st.db.facts || []).filter((f) => inArea(f) && (!q || `${f.title} ${f.detail || ''}`.toLowerCase().includes(q)))
  facts.sort((a, b) => b.date.localeCompare(a.date))
  const months = new Map()
  for (const f of facts) {
    const k = f.date.slice(0, 7)
    if (!months.has(k)) months.set(k, [])
    months.get(k).push(f)
  }
  const a = st.area && area(st.area)
  const filter = h('input', {
    class: 'field',
    type: 'search',
    style: 'width:280px',
    placeholder: 'Filter the history…',
    'aria-label': 'Filter the history',
    value: historyQuery,
    oninput: (e) => {
      historyQuery = e.target.value
      clearTimeout(historyTimer)
      historyTimer = setTimeout(() => {
        render()
        const el = document.querySelector('.content input[type=search]')
        el?.focus()
        el?.setSelectionRange(historyQuery.length, historyQuery.length)
      }, 250)
    }
  })
  return {
    title: 'History',
    meta: 'What happened, what you decided and what you said, newest first.',
    body: h(
      'div',
      {},
      sechead(a ? a.name : 'Everything', entries(facts.length), true),
      a?.summary && h('div', { class: 'lede', style: 'white-space:pre-wrap' }, a.summary),
      !a && (st.db.facts || []).length ? h('p', { class: 'lede' }, 'Choose an area on the left to read where it stands and see only its history.') : null,
      h('div', { class: 'add' }, filter, h('button', { class: 'btn', onclick: () => editFact() }, icon('plus'), 'Add entry')),
      facts.length
        ? [...months].map(([k, list]) => [
            sechead(fmt(k + '-01', { month: 'long', year: 'numeric' }), entries(list.length)),
            h(
              'div',
              { class: 'rows' },
              list.map((f) =>
                h(
                  'button',
                  { class: 'fact', onclick: () => editFact(f) },
                  h('span', { class: 'muted tnum' }, fmt(f.date, { month: 'short', day: 'numeric' })),
                  dot(f.area),
                  h('span', {}, h('div', { class: 'title' }, f.title), f.detail && h('div', { class: 'sub' }, f.detail)),
                  h('span', { class: 'muted' }, f.kind ? f.kind[0].toUpperCase() + f.kind.slice(1) : '')
                )
              )
            )
          ])
        : h('div', { class: 'empty' }, 'Nothing here yet.')
    )
  }
}

// ---- structured items: item page, quick create, badges -------------------------------------------------------------
const typeLabel = (kind, t) => (kind === 'goal' ? GOAL_TYPES : TASK_TYPES)[t]?.label || 'No type'
const qClass = { complete: 'q-ok', 'needs work': 'q-warn', invalid: 'q-bad' }
const qLabel = { complete: 'Complete', 'needs work': 'Needs work', invalid: 'Invalid' }
function qualityBadge(db, item, kind) {
  const issues = lint(db, item, kind)
  const q = quality(issues)
  return h('span', { class: `badge ${qClass[q]}`, title: issues.map((i) => i.msg).join('\n') || 'Complete' }, qLabel[q])
}
function statusBadge(db, item, kind) {
  const s = effectiveStatus(db, item, kind)
  return s === 'active' ? null : h('span', { class: `badge s-${s}` }, STATUS_LABELS[s])
}
const openItem = (ref) => go('item', undefined, ref)

/** Goals a goal or task can serve: for a goal, those exactly one horizon up first, then any longer horizon. */
function parentOptions(kind, item) {
  const rank = (g) => HORIZONS.indexOf(g.horizon)
  const own = kind === 'goal' ? HORIZONS.indexOf(item.horizon) : -1
  const list = st.db.goals.filter((g) => g.id !== item.id && rank(g) > own && !CLOSED.has(g.status || 'active'))
  list.sort((a, b) => rank(a) - rank(b) || String(a.period).localeCompare(String(b.period)) || a.title.localeCompare(b.title))
  return [['', 'None'], ...list.map((g) => [g.id, `${periodLabel(g.horizon, g.period)}: ${g.title}`])]
}

async function newItem(kind, defaults = {}) {
  const types = kind === 'goal' ? GOAL_TYPES : TASK_TYPES
  const probe = { horizon: defaults.horizon || 'week', id: '' }
  const v = await formDialog({
    title: kind === 'goal' ? `New goal for ${periodLabel(defaults.horizon, defaults.period)}` : 'New task',
    confirm: 'Create and open',
    values: { type: kind === 'goal' ? 'outcome' : 'action', area: st.area || defaults.area || st.db.areas[0]?.id, end: defaults.date || '', template: true, ...defaults },
    fields: [
      { name: 'title', label: kind === 'goal' ? 'Outcome' : 'Task', placeholder: kind === 'goal' ? 'What will be true' : 'Start with a verb' },
      { name: 'type', label: 'Type', type: 'select', options: Object.entries(types).map(([k, t]) => [k, `${t.label}: ${t.hint}`]) },
      { name: 'area', label: 'Area', type: 'select', options: areaOptions() },
      ...(kind === 'goal' && defaults.horizon === 'life' ? [] : [{ name: kind === 'goal' ? 'parentId' : 'goalId', label: 'Serves', type: 'select', options: parentOptions(kind, probe) }]),
      ...(kind === 'task' ? [{ name: 'date', label: 'Do date', type: 'date' }] : []),
      { name: 'end', label: 'Target end', type: 'date' },
      { name: 'template', label: 'Start from the template', type: 'checkbox' }
    ]
  })
  if (!v) return
  if (!v.title.trim()) return toast(kind === 'goal' ? 'A goal needs a title' : 'A task needs a title')
  const { template, ...args } = v
  if (template) {
    const tpl = TEMPLATES[kind][args.type]
    Object.assign(args, { requirements: tpl.requirements, proposal: tpl.proposal, criteria: tpl.criteria.map((c) => ({ ...c, by: c.by === '' ? args.end || '' : c.by })) })
  }
  if (!args.end) delete args.end
  const r = await op(kind === 'goal' ? 'upsert_goal' : 'upsert_task', kind === 'goal' ? { ...args, horizon: defaults.horizon, period: defaults.period } : args)
  openItem((kind === 'goal' ? 'g:' : 't:') + r.id)
}

// The item page edits a draft; Save writes the whole item at once.
let draft = null
let draftRef = ''
let draftDirty = false
const clone = (x) => JSON.parse(JSON.stringify(x))
function setDraft(fn) {
  fn(draft)
  draftDirty = true
  render()
}

function viewItem() {
  const f = findItem(st.db, st.ref)
  if (!f) return { title: 'Item', body: h('div', { class: 'empty' }, 'This item no longer exists.') }
  const { kind, item } = f
  if (draftRef !== f.ref || !draftDirty) {
    draft = clone(item)
    draft.requirements ||= []
    draft.proposal ||= { approach: '', steps: [] }
    draft.criteria ||= []
    draftRef = f.ref
    draftDirty = false
  }
  const d = draft
  const types = kind === 'goal' ? GOAL_TYPES : TASK_TYPES
  const issues = lint(st.db, d, kind)
  const ev = evalItem(st.db, d, kind)
  const eff = effectiveStatus(st.db, item, kind)
  const up = ancestors(st.db, item, kind)
  const field = (key, attrs = {}) => h('input', { class: 'field', value: d[key] ?? '', oninput: (e) => ((d[key] = attrs.type === 'number' ? (e.target.value === '' ? undefined : +e.target.value) : e.target.value), (draftDirty = true)), ...attrs })
  const select = (key, options, onchange) => h('select', { class: 'field', onchange: (e) => (onchange ? onchange(e.target.value) : setDraft((x) => (x[key] = e.target.value))) }, options.map(([v, l]) => h('option', { value: v, selected: String(d[key] ?? '') === String(v) }, l)))
  const area2 = (label, input) => [h('label', {}, label), input]
  const removeBtn = (fn, what) => h('button', { class: 'icon-btn', 'aria-label': `Remove ${what}`, title: 'Remove', onclick: fn }, icon('x'))
  const section = (title, hint, ...kids) => h('section', { class: 'isec' }, h('div', { class: 'isec-head' }, h('h3', { class: 'display' }, title), hint && h('span', { class: 'muted' }, hint)), ...kids)

  const save = async () => {
    const payload = { id: item.id }
    for (const k of ['title', 'type', 'area', 'why', 'requirements', 'noRequirements', 'proposal', 'criteria', 'start', 'end', 'estimate', 'detail', 'status']) payload[k] = d[k] ?? (k === 'start' || k === 'end' ? '' : undefined)
    if (kind === 'goal') payload.parentId = d.parentId || ''
    else Object.assign(payload, { goalId: d.goalId || '', date: d.date, priority: d.priority || '', target: d.target })
    if (CLOSED.has(payload.status)) delete payload.status
    try {
      const r = await op(kind === 'goal' ? 'upsert_goal' : 'upsert_task', payload)
      draftDirty = false
      render()
      toast(r.quality === 'complete' ? 'Saved. The item is complete.' : `Saved. ${r.issues.length} thing${r.issues.length === 1 ? '' : 's'} still to fill in.`)
    } catch {}
  }
  const close = async (status) => {
    if (draftDirty) await save()
    const v = await formDialog({
      title: status === 'done' ? 'Mark done' : 'Drop this item',
      confirm: status === 'done' ? 'Mark done' : 'Drop it',
      fields: [
        { name: 'outcome', label: 'What happened', type: 'textarea' },
        { name: 'lesson', label: 'One lesson', type: 'textarea' },
        ...(status === 'done' && !ev.allMet && ev.criteria.length ? [{ name: 'overrideReason', label: 'Not all criteria are met. Why close it anyway?', type: 'textarea' }] : [])
      ]
    })
    if (!v) return
    try {
      await op('close_item', { ref: f.ref, status, ...v }, { quiet: true })
      draftDirty = false
      render()
    } catch (e) {
      toast(e.code === 'CRITERIA' ? 'Some acceptance criteria are not met yet. Meet them, or give a reason to close anyway.' : e.message)
    }
  }
  const reopen = () => op('close_item', { ref: f.ref, status: 'active' })
  const del = async () => {
    const ok = await formDialog({ title: `Delete "${item.title}"? This cannot be undone; dropping keeps the history.`, fields: [], confirm: 'Delete' })
    if (!ok) return
    await op(kind === 'goal' ? 'delete_goal' : 'delete_task', { id: item.id })
    draftDirty = false
    go(kind === 'goal' ? item.horizon || 'year' : 'day', kind === 'task' ? item.date : periodDate(item.horizon, item.period))
  }
  const fillTemplate = () => {
    const tpl = TEMPLATES[kind][d.type]
    if (!tpl) return toast('Choose a type first')
    setDraft((x) => {
      if (!x.why) x.why = tpl.why
      if (!x.requirements.length) x.requirements = clone(tpl.requirements)
      if (!x.proposal.approach && !x.proposal.steps.length) x.proposal = clone(tpl.proposal)
      if (!x.criteria.length) x.criteria = tpl.criteria.map((c, i) => ({ ...c, id: 'c' + (i + 1), by: c.by === '' ? x.end || '' : c.by }))
    })
  }

  // Requirements.
  const reqRows = d.requirements.map((r, i) =>
    h(
      'div',
      { class: 'irow' },
      h('select', { class: 'field', 'aria-label': 'Kind', onchange: (e) => setDraft((x) => (x.requirements[i].kind = e.target.value)) }, Object.entries(REQ_KINDS).map(([k, l]) => h('option', { value: k, selected: r.kind === k }, l))),
      r.kind === 'item'
        ? h(
            'select',
            { class: 'field grow', 'aria-label': 'Item', onchange: (e) => setDraft((x) => Object.assign(x.requirements[i], { itemId: e.target.value, text: e.target.selectedOptions[0].textContent })) },
            [['', 'Choose an item'], ...st.db.goals.filter((g) => g.id !== item.id).map((g) => ['g:' + g.id, `Goal: ${g.title}`]), ...st.db.tasks.filter((t) => t.id !== item.id).map((t) => ['t:' + t.id, `Task: ${t.title}`])].map(([v, l]) => h('option', { value: v, selected: r.itemId === v }, l))
          )
        : h('input', { class: 'field grow', value: r.text, placeholder: 'What is needed', oninput: (e) => ((x) => ((x.requirements[i].text = e.target.value), (draftDirty = true)))(d) }),
      ['money', 'time'].includes(r.kind) ? h('input', { class: 'field num', type: 'number', step: 'any', value: r.amount ?? '', placeholder: r.kind === 'money' ? '$' : 'hours', 'aria-label': 'Amount', oninput: (e) => ((d.requirements[i].amount = e.target.value === '' ? null : +e.target.value), (draftDirty = true)) }) : null,
      r.kind !== 'item' ? h('label', { class: 'chk', title: 'Blocks the item until met' }, h('input', { type: 'checkbox', checked: r.blocking, onchange: (e) => setDraft((x) => (x.requirements[i].blocking = e.target.checked)) }), 'Blocks') : null,
      r.kind !== 'item' ? h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: r.met, onchange: (e) => setDraft((x) => (x.requirements[i].met = e.target.checked)) }), 'Met') : h('span', { class: 'muted' }, findItem(st.db, r.itemId)?.item.status === 'done' ? 'Done' : 'Not done'),
      removeBtn(() => setDraft((x) => x.requirements.splice(i, 1)), 'requirement')
    )
  )

  // Proposal steps.
  const stepRows = d.proposal.steps.map((s, i) =>
    h(
      'div',
      { class: 'irow' },
      h('input', { type: 'checkbox', 'aria-label': 'Step done', checked: s.done, onchange: (e) => setDraft((x) => (x.proposal.steps[i].done = e.target.checked)) }),
      h('span', { class: 'muted tnum' }, `${i + 1}.`),
      h('input', { class: 'field grow', value: s.text, oninput: (e) => ((d.proposal.steps[i].text = e.target.value), (draftDirty = true)) }),
      removeBtn(() => setDraft((x) => x.proposal.steps.splice(i, 1)), 'step')
    )
  )

  // Acceptance criteria.
  const metricOpts = [['', 'Choose a metric'], ...st.db.metrics.map((m) => [m.id, `${m.name}${m.unit ? ` (${m.unit})` : ''}`])]
  const routineOpts = [['', 'Choose a routine'], ...st.db.routines.map((r) => [r.id, r.title])]
  const critRows = ev.criteria.map((c, i) => {
    const set = (k, v, rerender) => {
      d.criteria[i][k] = v
      draftDirty = true
      if (rerender) render()
    }
    const inp = (k, attrs = {}) => h('input', { class: 'field', value: c[k] ?? '', oninput: (e) => set(k, attrs.type === 'number' ? (e.target.value === '' ? null : +e.target.value) : e.target.value), ...attrs })
    const sel = (k, opts) => h('select', { class: 'field', onchange: (e) => set(k, e.target.value, true) }, opts.map(([v, l]) => h('option', { value: v, selected: String(c[k] ?? '') === String(v) }, l)))
    const probs = criterionProblems(st.db, c)
    return h(
      'div',
      { class: `crit ${c.eval.met ? 'met' : ''}` },
      h(
        'div',
        { class: 'irow' },
        ['check', 'date'].includes(c.kind)
          ? h('input', { type: 'checkbox', 'aria-label': 'Met', checked: !!c.met, onchange: (e) => setDraft((x) => Object.assign(x.criteria[i], { met: e.target.checked }, x.criteria[i].kind === 'date' ? { on: e.target.checked ? today() : undefined } : {})) })
          : h('span', { class: `mark small ${c.eval.met ? 'done' : ''}`, title: c.eval.met ? 'Met' : 'Not met' }, c.eval.met ? icon('check') : null),
        h('select', { class: 'field', 'aria-label': 'Kind', onchange: (e) => setDraft((x) => (x.criteria[i] = normCriteria([{ ...x.criteria[i], kind: e.target.value }])[0])) }, Object.entries(CRIT_KINDS).map(([k, l]) => h('option', { value: k, selected: c.kind === k }, l))),
        h('input', { class: 'field grow', value: c.text, placeholder: 'The statement that must be true', oninput: (e) => set('text', e.target.value) }),
        removeBtn(() => setDraft((x) => x.criteria.splice(i, 1)), 'criterion')
      ),
      h(
        'div',
        { class: 'irow sub' },
        c.kind === 'check' ? [h('span', { class: 'muted' }, 'Evidence'), inp('evidence', { class: 'field grow', placeholder: 'What proves it: a file, a link, a receipt' })] : null,
        c.kind === 'metric' ? [sel('metricId', metricOpts), sel('op', OPS_CMP.map((o) => [o, o])), inp('value', { type: 'number', step: 'any', class: 'field num' })] : null,
        c.kind === 'count' ? [sel('of', [['children', 'Child goals and tasks done'], ['tasks', 'Tasks done'], ['instances', 'Routine sessions done']]), h('span', { class: 'muted' }, 'at least'), inp('value', { type: 'number', class: 'field num' })] : null,
        c.kind === 'adherence' ? [sel('routineId', routineOpts), inp('pct', { type: 'number', class: 'field num', placeholder: '%' }), h('span', { class: 'muted' }, '% over'), inp('windowDays', { type: 'number', class: 'field num' }), h('span', { class: 'muted' }, 'days')] : null,
        c.kind === 'date' ? [h('span', { class: 'muted' }, 'By'), inp('by', { type: 'date' })] : null,
        h('span', { class: 'spacer' }),
        h('span', { class: 'muted tnum' }, c.eval.label)
      ),
      probs.length ? h('div', { class: 'irow sub warnline' }, probs.map((p) => p.msg).join('. ')) : null
    )
  })
  const newCritKind = h('select', { class: 'field', 'aria-label': 'Kind of criterion' }, Object.entries(CRIT_KINDS).map(([k, l]) => h('option', { value: k }, l)))

  const children =
    kind === 'goal'
      ? [
          ...childGoals(st.db, item).map((g) => ({ ref: 'g:' + g.id, it: g, k: 'goal', label: `${periodLabel(g.horizon, g.period)}` })),
          ...childTasks(st.db, item).map((t) => ({ ref: 't:' + t.id, it: t, k: 'task', label: t.date ? fmt(t.date, { month: 'short', day: 'numeric' }) : 'Task' }))
        ]
      : []
  const routines = kind === 'goal' ? childRoutines(st.db, item) : []

  return {
    title: kind === 'goal' ? 'Goal' : 'Task',
    meta: kind === 'goal' ? `${typeLabel(kind, d.type)}, ${periodLabel(item.horizon, item.period)}` : `${typeLabel(kind, d.type)}${item.date ? `, on ${fmt(item.date, { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}`,
    body: h(
      'div',
      { class: 'item-page' },
      up.length ? h('nav', { class: 'crumbs', 'aria-label': 'Serves' }, up.map((g) => h('button', { onclick: () => openItem('g:' + g.id) }, `${periodLabel(g.horizon, g.period)}: ${g.title}`))) : null,
      h('input', { class: 'item-title display', value: d.title, 'aria-label': 'Title', placeholder: kind === 'goal' ? 'What will be true' : 'Start with a verb', oninput: (e) => ((d.title = e.target.value), (draftDirty = true)) }),
      h(
        'div',
        { class: 'item-bar' },
        h('span', { class: `badge s-${eff}` }, STATUS_LABELS[eff]),
        qualityBadge(st.db, d, kind),
        h('span', { class: 'bar wide', title: `${ev.progress}%` }, h('i', { style: `width:${ev.progress}%` })),
        h('span', { class: 'muted tnum' }, `${ev.progress}%${ev.computed ? '' : ' (manual)'}`),
        h('span', { class: 'spacer' }),
        draftDirty ? h('span', { class: 'muted' }, 'Unsaved changes') : null,
        h('button', { class: 'btn primary', onclick: save }, 'Save'),
        CLOSED.has(item.status) ? h('button', { class: 'btn', onclick: reopen }, 'Reopen') : [h('button', { class: 'btn', onclick: () => close('done') }, 'Mark done'), h('button', { class: 'btn ghost', onclick: () => close('dropped') }, 'Drop')]
      ),
      h(
        'div',
        { class: 'form item-grid' },
        area2('Type', select('type', [['', 'Choose a type'], ...Object.entries(types).map(([k, t]) => [k, `${t.label}: ${t.hint}`])])),
        area2('Status', select('status', ITEM_STATUSES.filter((s) => !CLOSED.has(s) || s === item.status).map((s) => [s, STATUS_LABELS[s]]))),
        area2('Area', select('area', areaOptions())),
        area2('Serves', select(kind === 'goal' ? 'parentId' : 'goalId', parentOptions(kind, item))),
        kind === 'task' ? area2('Do date', field('date', { type: 'date' })) : null,
        area2('Start', field('start', { type: 'date' })),
        area2('Target end', field('end', { type: 'date', placeholder: kind === 'goal' ? itemEnd(st.db, item, kind) : '' })),
        kind === 'goal' && !d.end ? [h('span'), h('span', { class: 'muted' }, `Defaults to ${fmt(itemEnd(st.db, item, kind), { month: 'long', day: 'numeric', year: 'numeric' })}, the end of its period.`)] : null,
        area2(kind === 'task' ? 'Estimate, minutes' : 'Estimate, hours', field('estimate', { type: 'number', min: 0 })),
        kind === 'task' ? area2('Priority', select('priority', [['', 'Choose'], ...PRIORITIES.map((p) => [p, p[0].toUpperCase() + p.slice(1)])])) : null,
        kind === 'task' ? area2('Shown as', field('target', { placeholder: 'Short amount on the day, e.g. 45 min' })) : null
      ),
      section('Why', kind === 'goal' ? 'How it serves the goal above it' : 'How it serves its goal', h('textarea', { class: 'field', rows: 2, value: d.why || '', oninput: (e) => ((d.why = e.target.value), (draftDirty = true)) })),
      section(
        'Requirements',
        'What must be true or available first',
        reqRows.length ? h('div', { class: 'ilist' }, reqRows) : null,
        h(
          'div',
          { class: 'add' },
          h('button', { class: 'btn ghost', onclick: () => setDraft((x) => x.requirements.push({ kind: 'info', text: '', met: false, blocking: false })) }, icon('plus'), 'Add requirement'),
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!d.noRequirements, onchange: (e) => setDraft((x) => (x.noRequirements = e.target.checked)) }), 'Nothing is needed first')
        )
      ),
      section(
        'Proposal',
        'How it will be done',
        h('textarea', { class: 'field', rows: 3, placeholder: 'The approach', value: d.proposal.approach, oninput: (e) => ((d.proposal.approach = e.target.value), (draftDirty = true)) }),
        stepRows.length ? h('div', { class: 'ilist' }, stepRows) : null,
        h('div', { class: 'add' }, h('button', { class: 'btn ghost', onclick: () => setDraft((x) => x.proposal.steps.push({ text: '', done: false })) }, icon('plus'), 'Add step'))
      ),
      section(
        'Acceptance criteria',
        ev.criteria.length ? (ev.allMet ? 'All met' : `${ev.criteria.filter((c) => c.eval.met).length} of ${ev.criteria.length} met`) : 'How anyone can tell it is done',
        critRows.length ? h('div', { class: 'ilist' }, critRows) : h('div', { class: 'empty' }, 'No criteria yet. Without one, nobody can tell whether this is done.'),
        item.measure && !d.criteria.some((c) => c.text === item.measure)
          ? h('div', { class: 'legacy' }, h('span', { class: 'muted' }, `Earlier "measured by": ${item.measure}`), h('button', { class: 'btn ghost', onclick: () => setDraft((x) => x.criteria.push(normCriteria([{ kind: 'check', text: item.measure, id: 'c' + (x.criteria.length + 1) }])[0])) }, 'Use as a criterion'))
          : null,
        h('div', { class: 'add' }, newCritKind, h('button', { class: 'btn ghost', onclick: () => setDraft((x) => x.criteria.push(normCriteria([{ kind: newCritKind.value, text: '', id: 'c' + (Math.max(0, ...x.criteria.map((c) => +String(c.id).replace(/\D/g, '') || 0)) + 1), by: x.end || '' }])[0])) }, icon('plus'), 'Add criterion'))
      ),
      section('Notes', '', h('textarea', { class: 'field', rows: 4, value: d.detail || '', oninput: (e) => ((d.detail = e.target.value), (draftDirty = true)) })),
      item.outcome ? section('Outcome', item.outcome.at ? `Closed ${new Date(item.outcome.at).toLocaleDateString('en-US', { dateStyle: 'medium' })}` : '', item.outcome.text && h('p', {}, item.outcome.text), item.outcome.lesson && h('p', { class: 'muted' }, `Lesson: ${item.outcome.lesson}`), item.outcome.override && h('p', { class: 'muted' }, `Closed with criteria unmet: ${item.outcome.override}`)) : null,
      section(
        'Checks',
        qLabel[quality(issues)],
        issues.length ? h('ul', { class: 'issues' }, issues.map((i) => h('li', { class: i.level }, i.msg))) : h('p', { class: 'muted' }, 'Everything required is filled in.'),
        TEMPLATES[kind][d.type] && (!d.requirements.length || !d.criteria.length || !d.proposal.approach) ? h('div', { class: 'add' }, h('button', { class: 'btn ghost', onclick: fillTemplate }, `Fill empty sections from the ${typeLabel(kind, d.type)} template`)) : null
      ),
      kind === 'goal'
        ? section(
            'Under this goal',
            plural(children.length + routines.length, 'item'),
            children.length || routines.length
              ? h(
                  'div',
                  { class: 'rows' },
                  children.map((c) => h('button', { class: 'goal', onclick: () => openItem(c.ref) }, dot(c.it.area), h('span', {}, h('div', { class: 'title' }, c.it.title), h('div', { class: 'sub' }, `${c.k === 'goal' ? 'Goal' : 'Task'}, ${c.label}`)), h('span', { class: 'badges' }, statusBadge(st.db, c.it, c.k), qualityBadge(st.db, c.it, c.k)))),
                  routines.map((r) => h('button', { class: 'goal', onclick: () => editRoutine(r) }, dot(r.area), h('span', {}, h('div', { class: 'title' }, r.title), h('div', { class: 'sub' }, `Routine${r.criterion ? `. Pass: ${r.criterion}` : ''}`)), h('span')))
                )
              : h('div', { class: 'empty' }, 'Nothing yet.'),
            h(
              'div',
              { class: 'add' },
              HORIZONS.indexOf(item.horizon) > 0 ? h('button', { class: 'btn ghost', onclick: () => newItem('goal', { horizon: HORIZONS[HORIZONS.indexOf(item.horizon) - 1], period: childPeriod(item), parentId: item.id, area: item.area }) }, icon('plus'), `Add ${HORIZONS[HORIZONS.indexOf(item.horizon) - 1]} goal`) : null,
              h('button', { class: 'btn ghost', onclick: () => newItem('task', { goalId: item.id, area: item.area, date: today() }) }, icon('plus'), 'Add task')
            )
          )
        : null,
      h('p', { class: 'muted prov' }, `From ${item.origin === 'you' ? 'you' : item.origin === 'mined' ? 'your own words in past conversations' : 'Claude'}${item.source ? `, ${item.source}` : ''}${item.createdAt ? `. Created ${new Date(item.createdAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}` : ''}${item.updatedAt ? `, updated ${new Date(item.updatedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}` : ''}.`),
      h('div', { class: 'add' }, h('button', { class: 'btn danger', onclick: del }, 'Delete'))
    )
  }
}
/** A sensible period for a new child goal: the current one if it falls inside the parent, else the parent's first. */
function childPeriod(g) {
  const hz = HORIZONS[HORIZONS.indexOf(g.horizon) - 1]
  const p = periodsFor(today())[hz]
  const end = itemEnd(st.db, g, 'goal')
  const start = g.horizon === 'life' ? today() : g.horizon === 'decade' ? `${g.period}-01-01` : g.horizon === 'year' ? `${g.period}-01-01` : g.horizon === 'month' ? `${g.period}-01` : today()
  if (today() >= start && today() <= end) return p
  return periodsFor(start)[hz]
}

function planQualitySection() {
  const r = lintPlan(st.db)
  const bad = r.items.filter((i) => i.quality === 'invalid' && inArea(i)).slice(0, 40)
  return [
    sechead('Plan quality', `${num(r.complete)} complete, ${num(r.needsWork)} need work, ${num(r.invalid)} invalid`),
    h('p', { class: 'lede' }, 'Every goal and task needs a type, why, requirements, a proposal, checkable acceptance criteria and a target end date. The most common gaps:'),
    h('table', {}, h('tbody', {}, r.commonProblems.slice(0, 8).map((p) => h('tr', {}, h('td', {}, p.msg), h('td', { class: 'num tnum' }, num(p.n)))))),
    bad.length ? [h('h3', { class: 'display', style: 'margin:20px 0 8px' }, 'Invalid items to fix first'), h('div', { class: 'rows' }, bad.map((i) => h('button', { class: 'goal', onclick: () => openItem(i.ref) }, dot(i.area), h('span', {}, h('div', { class: 'title' }, i.title), h('div', { class: 'sub' }, i.issues.filter((x) => x.level === 'error').map((x) => x.msg).join('. '))), h('span', { class: 'badge q-bad' }, 'Invalid'))))] : null
  ]
}

// ---- inbox, triage, board -------------------------------------------------------------------------------------------
const FIELD_LABELS = { type: 'Type', title: 'Title', why: 'Why', requirements: 'Requirements', noRequirements: 'Nothing needed first', proposal: 'Proposal', criteria: 'Acceptance criteria', start: 'Start', end: 'Target end', estimate: 'Estimate', priority: 'Priority', parentId: 'Serves', goalId: 'Serves', date: 'Do date', area: 'Area', target: 'Shown as', detail: 'Notes' }
function showValue(k, v, kind) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return h('span', { class: 'muted' }, 'None')
  if (k === 'type') return typeLabel(kind, v)
  if (k === 'parentId' || k === 'goalId') {
    const g = goal(v)
    return g ? `${periodLabel(g.horizon, g.period)}: ${g.title}` : v
  }
  if (k === 'area') return area(v).name
  if (k === 'noRequirements') return v ? 'Yes' : 'No'
  if (k === 'estimate') return kind === 'task' ? `${v} min` : `${v} h`
  if (k === 'requirements') return h('ul', {}, v.map((r) => h('li', {}, `${REQ_KINDS[r.kind] || r.kind}: ${r.text || r.itemId}${r.amount != null ? ` (${r.kind === 'money' ? '$' : ''}${r.amount}${r.kind === 'time' ? ' h' : ''})` : ''}${r.blocking ? ', blocks' : ''}`)))
  if (k === 'proposal') return !v.approach && !v.steps?.length ? h('span', { class: 'muted' }, 'None') : h('div', {}, v.approach || '', v.steps?.length ? h('ol', {}, v.steps.map((s) => h('li', {}, s.text))) : null)
  if (k === 'criteria')
    return h(
      'ul',
      {},
      v.map((c) => {
        const m = c.metricId && st.db.metrics.find((x) => x.id === c.metricId)
        const r = c.routineId && st.db.routines.find((x) => x.id === c.routineId)
        const how = c.kind === 'check' ? (c.evidence ? `evidence: ${c.evidence}` : '') : c.kind === 'metric' ? `${m ? m.name : c.metricId} ${c.op} ${c.value}` : c.kind === 'count' ? `${c.of} done at least ${c.value}` : c.kind === 'adherence' ? `${r ? r.title : c.routineId} at ${c.pct}% over ${c.windowDays} days` : c.kind === 'date' ? `by ${c.by}` : ''
        return h('li', {}, c.text, how ? h('span', { class: 'muted' }, ` (${how})`) : null)
      })
    )
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return fmt(v, { month: 'short', day: 'numeric', year: 'numeric' })
  return String(v)
}

let inboxTab = 'changes'
let inboxShown = 40
const inboxSel = new Set()
function viewInbox() {
  const props = st.db.proposals || []
  const byArea = props.filter(inArea)
  const newItems = [...st.db.goals.map((g) => ['goal', g]), ...st.db.tasks.map((t) => ['task', t])].filter(([, x]) => x.status === 'proposed' && inArea(x))
  const od = overdueList()
  const missed = od.filter((r) => r.status === 'missed' && inArea(r.item))
  const tab = (id, label, n) => h('button', { 'aria-pressed': String(inboxTab === id), onclick: () => ((inboxTab = id), (inboxShown = 40), inboxSel.clear(), render(true)) }, `${label} ${num(n)}`)
  const review = async (ids, refs, decision) => {
    if (!ids.length && !refs.length) return toast('Select something first')
    const r = await op('review_proposals', { ids, refs, decision })
    for (const x of [...ids, ...refs]) inboxSel.delete(x)
    toast(`${decision === 'accept' ? 'Accepted' : 'Rejected'} ${num(r.done)}${r.failed.length ? `. ${r.failed.length} could not be applied: ${r.failed[0].error}` : ''}`)
  }
  let body
  if (inboxTab === 'changes') {
    const shown = byArea.slice(0, inboxShown)
    body = [
      h('p', { class: 'lede' }, byArea.length ? 'Changes Claude proposes to existing goals and tasks. Nothing changes until you accept. Accept applies the change; Accept and edit applies it and opens the item.' : 'Nothing waiting.'),
      byArea.length
        ? h(
            'div',
            { class: 'bulk' },
            h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: shown.length && shown.every((p) => inboxSel.has(p.id)), onchange: (e) => (shown.forEach((p) => (e.target.checked ? inboxSel.add(p.id) : inboxSel.delete(p.id))), render()) }), `Select the ${num(shown.length)} shown`),
            h('span', { class: 'spacer' }),
            h('span', { class: 'muted' }, `${num(inboxSel.size)} selected`),
            h('button', { class: 'btn', onclick: () => review([...inboxSel].filter((x) => x.startsWith('pr_')), [], 'reject') }, 'Reject selected'),
            h('button', { class: 'btn primary', onclick: () => review([...inboxSel].filter((x) => x.startsWith('pr_')), [], 'accept') }, 'Accept selected')
          )
        : null,
      shown.map((p) => {
        const f = findItem(st.db, p.ref)
        const before = f ? f.item : {}
        const after = f ? { ...f.item, ...p.fields } : p.fields
        const qBefore = f ? quality(lint(st.db, f.item, f.kind)) : ''
        const qAfter = f && p.action === 'update' ? quality(lint(st.db, after, f.kind)) : ''
        return h(
          'article',
          { class: `prop ${inboxSel.has(p.id) ? 'sel' : ''}` },
          h(
            'header',
            {},
            h('input', { type: 'checkbox', 'aria-label': `Select ${p.title}`, checked: inboxSel.has(p.id), onchange: (e) => (e.target.checked ? inboxSel.add(p.id) : inboxSel.delete(p.id), render()) }),
            dot(p.area),
            h('button', { class: 'title', onclick: () => openItem(p.ref) }, f ? f.item.title : p.title),
            h('span', { class: `badge ${p.action === 'drop' ? 's-missed' : ''}` }, p.action === 'drop' ? 'Drop' : 'Update'),
            f ? h('span', { class: 'muted' }, f.kind === 'goal' ? `${periodLabel(f.item.horizon, f.item.period)} goal` : `Task, ${f.item.date ? fmt(f.item.date, { month: 'short', day: 'numeric' }) : ''}`) : h('span', { class: 'badge q-bad' }, 'Item no longer exists'),
            qAfter ? h('span', { class: 'muted' }, `${qLabel[qBefore]} → `, h('span', { class: `badge ${qClass[qAfter]}` }, qLabel[qAfter])) : null
          ),
          h('p', { class: 'reason' }, p.reason, p.by === 'claude' ? h('span', { class: 'muted' }, ` Proposed by Claude${p.batch ? `, ${p.batch}` : ''}.`) : null),
          p.action === 'update'
            ? h(
                'table',
                { class: 'diff' },
                h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Now'), h('th', {}, 'Proposed'))),
                h(
                  'tbody',
                  {},
                  Object.keys(p.fields).map((k) => h('tr', {}, h('th', {}, FIELD_LABELS[k] || k), h('td', {}, showValue(k, before[k], f?.kind)), h('td', {}, showValue(k, p.fields[k], f?.kind))))
                )
              )
            : null,
          h(
            'footer',
            {},
            h('button', { class: 'btn ghost', onclick: () => review([p.id], [], 'reject') }, 'Reject'),
            p.action === 'update' ? h('button', { class: 'btn', onclick: async () => (await review([p.id], [], 'accept'), openItem(p.ref)) }, 'Accept and edit') : null,
            h('button', { class: 'btn primary', onclick: () => review([p.id], [], 'accept') }, p.action === 'drop' ? 'Drop it' : 'Accept')
          )
        )
      }),
      byArea.length > inboxShown ? h('div', { class: 'add' }, h('button', { class: 'btn', onclick: () => ((inboxShown += 40), render()) }, `Show 40 more of ${num(byArea.length - inboxShown)}`)) : null
    ]
  } else if (inboxTab === 'new') {
    body = [
      h('p', { class: 'lede' }, newItems.length ? 'New goals and tasks Claude created that are waiting for you. They show on the plan with a dashed edge and do not count toward scores until accepted. Rejecting deletes them.' : 'Nothing waiting.'),
      newItems.length
        ? h('div', { class: 'bulk' }, h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => review([], newItems.map(([k, x]) => (k === 'goal' ? 'g:' : 't:') + x.id), 'reject') }, `Reject all ${num(newItems.length)}`), h('button', { class: 'btn primary', onclick: () => review([], newItems.map(([k, x]) => (k === 'goal' ? 'g:' : 't:') + x.id), 'accept') }, `Accept all ${num(newItems.length)}`))
        : null,
      h(
        'div',
        { class: 'rows' },
        newItems.slice(0, 200).map(([k, x]) => {
          const ref = (k === 'goal' ? 'g:' : 't:') + x.id
          return h('div', { class: 'goal' }, dot(x.area), h('button', { onclick: () => openItem(ref) }, h('div', { class: 'title' }, x.title), h('div', { class: 'sub' }, k === 'goal' ? `${periodLabel(x.horizon, x.period)} goal` : `Task, ${x.date || ''}`)), h('span', { class: 'badges' }, qualityBadge(st.db, x, k), h('button', { class: 'btn ghost', onclick: () => review([], [ref], 'reject') }, 'Reject'), h('button', { class: 'btn', onclick: () => review([], [ref], 'accept') }, 'Accept')))
        })
      )
    ]
  } else {
    body = [h('p', { class: 'lede' }, missed.length ? 'Goals and tasks past their target end date and not closed. Decide each one: move it, mark it done, turn a task into a routine, or drop it.' : 'Nothing is overdue.'), triageList(missed)]
  }
  return {
    title: 'Inbox',
    meta: 'What waits for your decision.',
    body: h('div', {}, h('div', { class: 'seg tabs' }, tab('changes', 'Proposed changes', byArea.length), tab('new', 'New items', newItems.length), tab('missed', 'Missed', missed.length)), h('div', { style: 'height:16px' }), body)
  }
}

function overdueList() {
  const rows = []
  for (const [kind, list] of [['goal', st.db.goals], ['task', st.db.tasks]])
    for (const x of list) {
      const s = effectiveStatus(st.db, x, kind)
      if (s === 'missed' || s === 'blocked') rows.push({ ref: (kind === 'goal' ? 'g:' : 't:') + x.id, kind, status: s, item: x, end: itemEnd(st.db, x, kind) })
    }
  return rows.sort((a, b) => String(a.end).localeCompare(String(b.end)))
}

function triageList(rows, { compact } = {}) {
  const act = async (ref, action, extra = {}) => {
    try {
      await op('triage', { ref, action, ...extra }, { quiet: true })
    } catch (e) {
      if (e.code === 'CRITERIA') {
        toast('Its acceptance criteria are not all met. Here they are.')
        openItem(ref)
      } else if (e.code !== 'STALE') toast(e.message)
    }
  }
  const moveTo = async (r) => {
    const v = await formDialog({ title: `Move "${r.item.title}"`, confirm: 'Move', values: { date: addDays(today(), 1) }, fields: [{ name: 'date', label: r.kind === 'task' ? 'New do date' : 'New end date', type: 'date' }] })
    if (v?.date) act(r.ref, 'move', { date: v.date })
  }
  const drop = async (r) => {
    const v = await formDialog({ title: `Drop "${r.item.title}"`, confirm: 'Drop', fields: [{ name: 'reason', label: 'Why', type: 'textarea' }] })
    if (v) act(r.ref, 'drop', { reason: v.reason || 'Dropped in triage' })
  }
  return h(
    'div',
    { class: 'rows' },
    rows.map((r) =>
      h(
        'div',
        { class: `triage ${compact ? 'compact' : ''}` },
        dot(r.item.area),
        h('button', { class: 'tl', onclick: () => openItem(r.ref) }, h('div', { class: 'title' }, r.item.title), h('div', { class: 'sub' }, `${r.kind === 'goal' ? `${periodLabel(r.item.horizon, r.item.period)} goal` : 'Task'}, ${r.status === 'blocked' ? 'blocked' : `was due ${fmt(r.end, { month: 'short', day: 'numeric' })}`}`)),
        h(
          'span',
          { class: 'badges' },
          r.kind === 'task' ? h('button', { class: 'btn', onclick: () => act(r.ref, 'move', { date: today() }) }, 'Today') : null,
          h('button', { class: 'btn ghost', onclick: () => moveTo(r) }, 'Move'),
          h('button', { class: 'btn ghost', onclick: () => act(r.ref, 'done') }, 'Done'),
          r.kind === 'task' ? h('button', { class: 'btn ghost', onclick: () => act(r.ref, 'routine') }, 'Make routine') : null,
          h('button', { class: 'btn ghost danger', onclick: () => drop(r) }, 'Drop')
        )
      )
    )
  )
}

let boardKind = 'task'
let boardHorizon = ''
function viewBoard() {
  const cols = [
    ['proposed', 'Proposed'],
    ['active', 'Active'],
    ['blocked', 'Blocked'],
    ['missed', 'Missed'],
    ['done', 'Done']
  ]
  const items = (boardKind === 'goal' ? st.db.goals.map((x) => ['goal', x]) : st.db.tasks.map((x) => ['task', x])).filter(([, x]) => inArea(x) && (!boardHorizon || x.horizon === boardHorizon))
  const groups = Object.fromEntries(cols.map(([k]) => [k, []]))
  for (const [k, x] of items) {
    let s = effectiveStatus(st.db, x, k)
    if (s === 'accepted') s = 'active'
    if (groups[s]) groups[s].push([k, x])
  }
  for (const g of Object.values(groups)) g.sort((a, b) => String(itemEnd(st.db, a[1], a[0])).localeCompare(String(itemEnd(st.db, b[1], b[0]))))
  const LIMIT = 60
  return {
    title: 'Board',
    meta: 'Every goal or task by status. Click a card to open it.',
    body: h(
      'div',
      {},
      h(
        'div',
        { class: 'bulk' },
        h('div', { class: 'seg' }, h('button', { 'aria-pressed': String(boardKind === 'task'), onclick: () => ((boardKind = 'task'), (boardHorizon = ''), render()) }, 'Tasks'), h('button', { 'aria-pressed': String(boardKind === 'goal'), onclick: () => ((boardKind = 'goal'), render()) }, 'Goals')),
        boardKind === 'goal' ? h('select', { class: 'field', 'aria-label': 'Horizon', onchange: (e) => ((boardHorizon = e.target.value), render()) }, [['', 'All horizons'], ...HORIZONS.map((x) => [x, x[0].toUpperCase() + x.slice(1)])].map(([v, l]) => h('option', { value: v, selected: boardHorizon === v }, l))) : null
      ),
      h(
        'div',
        { class: 'board' },
        cols.map(([k, label]) =>
          h(
            'section',
            { class: 'bcol' },
            h('h3', {}, label, h('span', { class: 'muted tnum' }, num(groups[k].length))),
            groups[k].slice(0, LIMIT).map(([kind, x]) =>
              h(
                'button',
                { class: `card ${x.status === 'proposed' ? 'proposed' : ''}`, onclick: () => openItem((kind === 'goal' ? 'g:' : 't:') + x.id) },
                h('div', { class: 'title' }, x.title),
                h('div', { class: 'sub' }, dot(x.area), typeLabel(kind, x.type), itemEnd(st.db, x, kind) ? ` · ${fmt(itemEnd(st.db, x, kind), { month: 'short', day: 'numeric', year: 'numeric' })}` : ''),
                qualityBadge(st.db, x, kind)
              )
            ),
            groups[k].length > LIMIT ? h('div', { class: 'muted' }, `${num(groups[k].length - LIMIT)} more. Filter by area to narrow.`) : null
          )
        )
      )
    )
  }
}

const VIEW = { inbox: viewInbox, board: viewBoard, item: viewItem, history: viewHistory, day: viewDay, week: viewWeek, month: viewMonth, year: viewYear, decade: viewDecade, life: viewLife, routines: viewRoutines, metrics: viewMetrics, review: viewReview, settings: viewSettings }

// ---- shell -------------------------------------------------------------------------------------------------------
let side, mainEl, results
function buildShell() {
  const input = h('input', {
    type: 'search',
    placeholder: 'Search goals, routines and targets…',
    'aria-label': 'Search',
    oninput: () => search(input.value),
    onkeydown: (e) => {
      if (e.key === 'Escape') {
        input.value = ''
        search('')
        input.blur()
      }
      if (e.key === 'ArrowDown') results.querySelector('button')?.focus()
    }
  })
  results = h('div', { class: 'results scroll', hidden: true })
  side = h('aside', { class: 'sidebar' })
  mainEl = h('div', { style: 'display:contents' })
  document.getElementById('app').replaceChildren(
    h('div', { class: 'shell' }, side, h('main', { class: 'main' }, h('div', { class: 'topbar' }, h('div', { class: 'search' }, icon('search'), input, results), h('span', { style: 'flex:1' }), h('button', { class: 'icon-btn', 'aria-label': 'Settings', title: 'Settings', onclick: () => go('settings') }, icon('settings'))), mainEl))
  )
  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      input.focus()
      return
    }
    if (document.querySelector('dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return
    const v = VIEW[st.view]()
    if (e.key === 'ArrowLeft' && v.step) go(st.view, v.step(-1))
    if (e.key === 'ArrowRight' && v.step) go(st.view, v.step(1))
    if (e.key.toLowerCase() === 't') go(st.view, today())
  })
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search')) results.hidden = true
  })

  function search(q) {
    q = q.trim().toLowerCase()
    if (!q) return (results.hidden = true)
    const hit = (...s) => s.some((x) => (x || '').toLowerCase().includes(q))
    const out = []
    for (const g of st.db.goals) if (hit(g.title, g.detail, g.measure)) out.push({ area: g.area, text: g.title, sub: `Goal, ${periodLabel(g.horizon, g.period)}`, go: () => openItem('g:' + g.id) })
    for (const r of st.db.routines) if (hit(r.title, r.target, r.detail)) out.push({ area: r.area, text: r.title, sub: 'Routine', go: () => go('routines') })
    for (const t of st.db.tasks) if (hit(t.title, t.detail)) out.push({ area: t.area, text: t.title, sub: fmt(t.date, { month: 'short', day: 'numeric', year: 'numeric' }), go: () => openItem('t:' + t.id) })
    for (const f of st.db.facts || []) if (out.length < 60 && hit(f.title, f.detail)) out.push({ area: f.area, text: f.title, sub: `History, ${fmt(f.date, { month: 'short', day: 'numeric', year: 'numeric' })}`, go: () => ((historyQuery = f.title), go('history')) })
    for (const p of st.db.phases) if (hit(p.title, p.theme, p.detail)) out.push({ area: null, text: p.title, sub: `Chapter, ${p.startYear} to ${p.endYear}`, go: () => go('life') })
    results.replaceChildren(
      ...(out.length
        ? out.slice(0, 30).map((r) =>
            h(
              'button',
              {
                onclick: () => {
                  results.hidden = true
                  input.value = ''
                  r.go()
                }
              },
              r.area ? dot(r.area) : h('span', { class: 'dot', style: 'visibility:hidden' }),
              h('span', { style: 'flex:1;min-width:0' }, r.text),
              h('span', { class: 'muted' }, r.sub)
            )
          )
        : [h('div', { class: 'empty' }, 'No matches.')])
    )
    results.hidden = false
  }
}

function renderSidebar() {
  const item = (view, label, ic, count) => h('button', { class: 'nav', 'aria-current': st.view === view ? 'page' : null, onclick: () => go(view, view === 'day' ? today() : undefined) }, icon(ic), h('span', { class: 'label' }, label), count != null && h('span', { class: 'count tnum' }, count))
  const t = dayPlan(st.db, today()).score
  const last = st.db.revisions.at(-1)
  side.replaceChildren(
    h(
      'nav',
      { class: 'scroll', 'aria-label': 'Views' },
      item('day', 'Today', 'sun', t.total ? `${t.done}/${t.total}` : null),
      item('week', 'Week', 'week'),
      item('month', 'Month', 'month'),
      item('year', 'Year', 'year'),
      item('decade', 'Decade', 'decade'),
      item('life', 'Life', 'life'),
      h('div', { class: 'section-title' }, 'Areas'),
      st.db.areas.map((a) => {
        const n = st.db.goals.filter((g) => g.area === a.id && (g.status || 'active') === 'active').length
        return h(
          'button',
          {
            class: 'nav',
            'aria-pressed': String(st.area === a.id),
            'aria-current': st.area === a.id ? 'page' : null,
            title: st.area === a.id ? 'Show all areas' : `Show only ${a.name}`,
            onclick: () => {
              st.area = st.area === a.id ? null : a.id
              render()
            }
          },
          h('span', { style: 'width:16px;display:flex;justify-content:center' }, dot(a.id)),
          h('span', { class: 'label' }, a.name),
          h('span', { class: 'count tnum' }, n || '')
        )
      }),
      h('div', { class: 'section-title' }, 'Plan'),
      item('inbox', 'Inbox', 'inbox', (st.db.proposals || []).length + st.db.goals.filter((g) => g.status === 'proposed').length + st.db.tasks.filter((t) => t.status === 'proposed').length + overdueList().filter((r) => r.status === 'missed').length || null),
      item('board', 'Board', 'board'),
      item('history', 'History', 'history', (st.db.facts || []).length || null),
      item('routines', 'Routines', 'repeat', st.db.routines.filter((r) => r.active !== false && (!r.end || r.end >= today())).length),
      item('metrics', 'Metrics', 'trend', st.db.metrics.length || null),
      item('review', 'Review', 'review')
    ),
    h('div', { class: 'foot' }, last ? `Last changed ${new Date(last.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} by ${last.actor === 'claude' ? 'Claude' : 'you'}.` : 'No changes yet.')
  )
}

function scrubber() {
  const y = +st.date.slice(0, 4)
  let items = []
  if (['day', 'week', 'month'].includes(st.view)) {
    items = Array.from({ length: 12 }, (_, i) => {
      const key = `${y}-${pad(i + 1)}`
      const day = Math.min(+st.date.slice(8), daysInMonth(y, i + 1))
      return { label: fmt(key + '-01', { month: 'short' }), on: st.date.startsWith(key), date: `${key}-${pad(day)}` }
    })
  } else if (st.view === 'year') {
    const d0 = decadeOf(y)
    items = Array.from({ length: 12 }, (_, i) => d0 - 1 + i).map((yy) => ({ label: String(yy), on: yy === y, date: `${yy}${st.date.slice(4, 8)}01` }))
  } else if (st.view === 'decade' || st.view === 'life') {
    const by = st.db.profile.birthDate ? +st.db.profile.birthDate.slice(0, 4) : y - 30
    const end = by + (st.db.profile.lifeExpectancy || 85)
    for (let d = decadeOf(by); d <= decadeOf(end); d += 10) items.push({ label: `${d}s`, on: st.view === 'decade' && decadeOf(y) === d, date: `${d === decadeOf(+today().slice(0, 4)) ? +today().slice(0, 4) : d}-01-01`, view: 'decade' })
  }
  return h('div', { class: 'scrub', 'aria-label': 'Jump through time' }, items.map((it) => h('button', { class: 'tnum', 'aria-current': String(!!it.on), onclick: () => go(it.view || st.view, it.date) }, it.label)))
}

let lastKey = ''
function render(resetScroll) {
  if (!st.db) return
  pendingRender = false
  renderSidebar()
  const v = VIEW[st.view]()
  const key = st.view + st.date
  const old = mainEl.querySelector('.content')
  const top = !resetScroll && key === lastKey && old ? old.scrollTop : 0
  lastKey = key
  const content = h('div', { class: 'content scroll' }, v.body)
  mainEl.replaceChildren(
    h(
      'div',
      { class: 'viewhead' },
      h('h1', {}, v.title),
      v.meta && h('span', { class: 'muted tnum' }, v.meta),
      st.area && h('button', { class: 'btn ghost', onclick: () => ((st.area = null), render()) }, `Only ${area(st.area).name}`, icon('x')),
      h('span', { class: 'spacer' }),
      v.step &&
        h(
          'div',
          { class: 'stepper' },
          h('button', { class: 'icon-btn', 'aria-label': 'Earlier', onclick: () => go(st.view, v.step(-1)) }, icon('left')),
          h('button', { class: 'btn', onclick: () => go(st.view, today()) }, 'Today'),
          h('button', { class: 'icon-btn', 'aria-label': 'Later', onclick: () => go(st.view, v.step(1)) }, icon('right'))
        )
    ),
    h('div', { class: 'body' }, content, scrubber())
  )
  content.scrollTop = top
  document.title = `Arc: ${v.title}`
}

// Pick up changes Claude makes over MCP without a refresh, but never under the user's hands.
const busy = () => document.querySelector('dialog[open]') || (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && document.activeElement.closest('.content'))
setInterval(async () => {
  try {
    const { rev } = await (await fetch('/api/rev')).json()
    if (st.db && rev !== st.db.rev) {
      await loadState()
      if (busy()) pendingRender = true
      else render()
    } else if (pendingRender && !busy()) render()
  } catch {}
}, 3000)

addEventListener('popstate', () => {
  readHash()
  render(true)
})
addEventListener('hashchange', () => {
  readHash()
  render(true)
})
readHash()
buildShell()
loadState().then(
  () => render(true),
  (e) => {
    document.getElementById('app').replaceChildren(
      h('div', { class: 'content', style: 'max-width:560px;margin:80px auto' }, h('h2', { class: 'display' }, 'Arc'), h('p', { class: 'lede' }, e.code === 'AUTH' ? 'This page needs Arc\'s private token. Open Arc from its desktop window, or open the link printed by "node server.mjs", which signs this browser in.' : 'Arc is not answering. Make sure the app is running.'))
    )
  }
)
