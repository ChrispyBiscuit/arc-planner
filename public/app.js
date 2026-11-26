import { today, addDays, addMonths, parse, ymd, pad, isoWeek, weekStart, weekDays, daysInMonth, daysBetween, decadeOf, periodsFor, ageOn, dayPlan, goalsFor, periodLabel, HORIZONS, repeatLabel, repeatOf } from './shared.js'
import { GOAL_TYPES, TASK_TYPES, ITEM_STATUSES, STATUS_LABELS, CLOSED, PRIORITIES, REQ_KINDS, CRIT_KINDS, OPS_CMP, TEMPLATES, lint, lintPlan, quality, evalItem, effectiveStatus, findItem, ancestors, childGoals, childTasks, childRoutines, itemEnd, normCriteria, criterionProblems, dayLoad, focusFor, decisionsDue, minutesOf, DEFAULT_CAPACITY, CADENCES, CADENCE_LABELS, metricDue, lintRoutine, toMin, fromMin } from './model.js'

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
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  board: '<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>'
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
const VIEWS = ['day', 'week', 'month', 'year', 'decade', 'life', 'history', 'routines', 'metrics', 'review', 'settings', 'item', 'inbox', 'board', 'health']
const st = { db: null, view: 'day', date: today(), area: null, ref: '', sel: '' }
let pendingRender = false
const checkinExtra = new Set()

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
  if (r) return openEditor('r:' + r.id)
  const v = await formDialog({
    title: r ? 'Edit routine' : 'New routine',
    canDelete: !!r,
    values: r || { area: st.area || st.db.areas[0]?.id, start: today(), active: true },
    fields: [
      { name: 'title', label: 'Routine' },
      { name: 'target', label: 'Amount', placeholder: 'e.g. 8 hours, 30 min' },
      { name: 'criterion', label: 'A session passes when', placeholder: 'e.g. at least 30 minutes, or one section at 80%' },
      { name: 'estimate', label: 'Minutes per session', type: 'number' },
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
  const made = await op('upsert_routine', r ? { ...v, id: r.id } : v)
  if (!r && made?.id) openEditor('r:' + made.id)
}
async function editMetric(m) {
  if (m) return openEditor('m:' + m.id)
  const v = await formDialog({
    title: m ? 'Edit metric' : 'New metric',
    canDelete: !!m,
    values: m || { area: st.db.areas[0]?.id },
    fields: [
      { name: 'name', label: 'Metric', placeholder: 'e.g. Bodyweight' },
      { name: 'unit', label: 'Unit', placeholder: 'lb' },
      { name: 'area', label: 'Area', type: 'select', options: areaOptions() },
      { name: 'target', label: 'Target', type: 'number', step: 'any' },
      { name: 'targetDate', label: 'By', type: 'date' },
      { name: 'cadence', label: 'Ask for it', type: 'select', options: CADENCES.map((c) => [c, CADENCE_LABELS[c]]) }
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
          goals.map((g) => goalBlock(g))
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
  const focus = focusFor(st.db, d, plan)
  const focusItems = focus.keys.map((k) => items.find((it) => it.key === k)).filter(Boolean)
  const restItems = items.filter((it) => !focus.keys.includes(it.key))
  const p = periodsFor(d)
  const y = +d.slice(0, 4)
  const left = daysBetween(d, `${y}-12-31`)
  const isToday = d === today()

  const tools = (it) => [
    h('input', { class: 'actual tnum', 'aria-label': `What happened: ${it.title}`, placeholder: 'What happened', value: it.actual, onchange: (e) => op('set_item_status', { date: d, key: it.key, actual: e.target.value }, { silent: true }) }),
    h(
      'div',
      { class: 'seg' },
      h('button', { 'aria-pressed': String(it.status === 'partial'), onclick: () => op('set_item_status', { date: d, key: it.key, status: it.status === 'partial' ? 'todo' : 'partial' }) }, 'Partly'),
      h('button', { 'aria-pressed': String(it.status === 'skipped'), onclick: () => op('set_item_status', { date: d, key: it.key, status: it.status === 'skipped' ? 'todo' : 'skipped' }) }, 'Skipped')
    )
  ]
  const scheduled = items.filter((it) => it.start)
  const unscheduled = items.filter((it) => !it.start)
  const focusStrip = dropZone(
    h(
      'div',
      { class: 'focusstrip' },
      [0, 1, 2].map((i) => {
        const it = focusItems[i]
        if (!it) return h('div', { class: 'fslot empty' }, 'Drop an item here to focus on it')
        return h('button', { class: `fslot ${it.status}`, onclick: () => select(it.key, d), ondblclick: () => openEditor(it.key) }, h('span', { class: 'fnum tnum' }, i + 1), h('span', { class: 'ft' }, it.title), it.start ? h('span', { class: 'muted tnum' }, it.start) : null, it.status === 'done' ? icon('check') : null)
      })
    ),
    {
      accept: (x) => x.date === d && x.kind !== 'goal' && !focus.keys.includes(x.ref),
      drop: (x) => {
        if (focus.keys.length >= 3) return toast('Three focus items at most. Remove one with its star first.')
        changeFocus(d, [...focus.keys, x.ref], 'changed focus')
      }
    }
  )

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
  // Only metrics due today (by their cadence) or already logged today appear; any other can be added from the picker.
  const shownMetrics = st.db.metrics.filter((m) => metricDue(m, d) || (m.entries || []).some((e) => e.date === d) || checkinExtra.has(m.id))
  const metricRow = (m) => {
    const on = (m.entries || []).find((e) => e.date === d)
    const last = [...(m.entries || [])].filter((e) => e.date !== d).sort((a, b) => a.date.localeCompare(b.date)).at(-1)
    return h(
      'label',
      { class: 'mrow' },
      h('span', {}, m.name),
      h('input', { class: 'field tnum', type: 'number', step: 'any', 'data-metric': m.id, value: on?.value ?? '', 'aria-label': m.name }),
      h('span', { class: 'muted tnum' }, m.unit || ''),
      h('span', { class: 'muted tnum' }, last ? `Last ${num(last.value)}${m.unit ? ' ' + m.unit : ''}, ${fmt(last.date, { month: 'short', day: 'numeric' })}` : 'No readings yet')
    )
  }
  const metricIns = shownMetrics.map(metricRow)
  const others = st.db.metrics.filter((m) => !shownMetrics.includes(m)).sort((a, b) => a.name.localeCompare(b.name))
  const picker = others.length
    ? h(
        'select',
        {
          class: 'field',
          'aria-label': 'Log another metric',
          onchange: (e) => {
            if (!e.target.value) return
            checkinExtra.add(e.target.value)
            render()
          }
        },
        h('option', { value: '' }, `Log another reading (${others.length} more metrics)`),
        others.map((m) => h('option', { value: m.id }, m.name))
      )
    : null
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
    metricIns.length ? h('div', { class: 'mgrid' }, h('div', { class: 'muted mhead' }, 'Readings due today'), metricIns) : h('p', { class: 'muted' }, 'No readings are due today. Set how often each metric is logged on the Metrics page.'),
    picker,
    h('div', { class: 'nums' }, h('button', { class: 'btn primary', onclick: saveCheckin }, c.at ? 'Update check-in' : 'Save check-in'), h('span', { class: 'muted' }, c.at ? `Saved ${new Date(c.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.` : 'Or tell Claude what happened and it will fill this in.'))
  )

  const chain = lineOfSight(d, items)

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
        sechead(fmt(d, { weekday: 'long', month: 'long', day: 'numeric' }), focusItems.length ? `Focus ${focusItems.filter((it) => it.status === 'done').length} of ${focusItems.length}. ${scoreText(plan.score)}` : scoreText(plan.score), true),
        plan.brief && h('p', { class: 'lede' }, plan.brief),
        loadLine(d),
        isToday && overdueList().filter((r) => r.kind === 'task' && r.status === 'missed' && inArea(r.item)).length ? [sechead('Overdue', 'Decide each one'), triageList(overdueList().filter((r) => r.kind === 'task' && r.status === 'missed' && inArea(r.item)).slice(0, 8), { compact: true })] : null,
        isToday ? decisionsSection(d) : null,
        h('div', { class: 'sechead' }, h('h3', { class: 'display' }, 'Focus'), h('span', { class: 'spacer' }), focus.chosen ? h('span', { class: 'meta' }, focus.by === 'claude' ? 'Chosen by Claude' : 'Chosen by you') : focusItems.length ? h('span', { class: 'meta' }, 'Suggested: must-do and soonest due. ', h('button', { class: 'linkbtn', onclick: () => setFocus(d, focus.keys) }, 'Keep these')) : null),
        focusStrip,
        h(
          'div',
          { class: 'dayboard' },
          h('div', { class: 'traycol' }, h('div', { class: 'sechead' }, h('h3', { class: 'display' }, 'No time yet'), h('span', { class: 'spacer' }), h('span', { class: 'meta tnum' }, plural(unscheduled.length, 'item'))), tray(d, unscheduled, { focus, tools })),
          h('div', { class: 'calcol' }, h('div', { class: 'sechead' }, h('h3', { class: 'display' }, 'Calendar'), h('span', { class: 'spacer' }), h('span', { class: 'meta' }, 'Drag across empty time or double-click it to add; drag items to move, their top or bottom edge to resize')), h('div', { class: 'daygrid' }, gutter(), timeCol(d, scheduled, { compact: false })))
        ),
        !items.length ? h('div', { class: 'empty' }, st.area ? `Nothing in ${area(st.area).name} on this day.` : 'Nothing is planned for this day. Add a target below, or ask Claude to plan it.') : null,
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
      days.some((x) => x >= today() && dayLoad(st.db, x).over) ? h('div', { class: 'add' }, h('span', { class: 'muted' }, `${plural(days.filter((x) => x >= today() && dayLoad(st.db, x).over).length, 'day')} this week ${days.filter((x) => x >= today() && dayLoad(st.db, x).over).length === 1 ? 'is' : 'are'} over capacity.`), h('button', { class: 'btn', onclick: () => balanceDialog(days[0] < today() ? today() : days[0], days[6]) }, 'Balance this week')) : null,
      sechead('Goals this week'),
      goalList('week', wk.key),
      sechead('Days'),
      weekGrid(plans)
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
    const l = dayLoad(st.db, d, p)
    cells.push(
      dropZone(
        h(
          'div',
          { class: `cell${d === today() ? ' today' : ''}`, 'data-date': d },
          h('button', { class: 'n tnum', onclick: () => go('day', d), 'aria-label': `Open ${fmt(d, { weekday: 'long', month: 'long', day: 'numeric' })}` }, day, h('small', { class: l.over ? 'overtxt' : '' }, hm(l.minutes))),
          d <= today() && p.score.total ? meter(p.score) : null,
          tasks.slice(0, 4).map((it) => block(it, { date: d, compact: true, zone: 'month' })),
          tasks.length > 4 && h('button', { class: 'muted more', onclick: () => go('day', d) }, `${tasks.length - 4} more`)
        ),
        { accept: (x) => x.kind === 'task' && x.date !== d, drop: (x) => moveTask(x.ref, d) }
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

/** Whether a routine lands on this weekday in a typical week, for the weekly load. */
function weeklyOn(r, wd) {
  const { every, interval } = repeatOf(r)
  if (every === 'day') return interval === 1
  return every === 'week' && (r.days || [0, 1, 2, 3, 4, 5, 6]).includes(wd)
}
function viewRoutines() {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const days = (r) => repeatLabel(r)
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
            h('thead', {}, h('tr', {}, ['Routine', 'Amount', 'Minutes', 'Days', 'Runs'].map((t) => h('th', {}, t)))),
            h(
              'tbody',
              {},
              list.map((r) => {
                const over = r.active === false || (r.end && r.end < today())
                return h('tr', { class: over ? 'muted' : '' }, h('td', {}, h('button', { onclick: () => editRoutine(r), style: 'display:flex;gap:8px;align-items:center;font-weight:500' }, dot(r.area), r.title)), h('td', { class: 'tnum' }, r.target || ''), h('td', { class: 'tnum' }, `${minutesOf(st.db, { kind: 'routine', key: 'r:' + r.id })}${r.estimate ? '' : ' (guess)'}`), h('td', {}, days(r)), h('td', { class: 'tnum' }, r.active === false ? 'Paused' : `${r.start ? 'From ' + fmt(r.start, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Always'}${r.end ? ' to ' + fmt(r.end, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}`))
              })
            )
          )
        : h('div', { class: 'empty' }, 'No routines yet.'),
      h('div', { class: 'add' }, h('button', { class: 'btn', onclick: () => editRoutine() }, icon('plus'), 'New routine')),
      sechead('Routine time by weekday', 'Against your daily capacity'),
      h(
        'table',
        {},
        h('tbody', {}, [1, 2, 3, 4, 5, 6, 0].map((wd) => {
          const mins = list.filter((r) => r.active !== false && (!r.end || r.end >= today()) && weeklyOn(r, wd)).reduce((s, r) => s + minutesOf(st.db, { kind: 'routine', key: 'r:' + r.id }), 0)
          const cap = (st.db.policy?.capacity?.minutes || DEFAULT_CAPACITY().minutes)[wd]
          return h('tr', {}, h('td', {}, names[wd]), h('td', { class: 'num tnum' }, hm(mins)), h('td', { class: 'num tnum muted' }, `of ${hm(cap)}`), h('td', {}, mins > cap ? h('span', { class: 'badge q-bad' }, 'Routines alone exceed capacity') : h('span', { class: 'muted tnum' }, `${hm(cap - mins)} left for tasks`)))
        }))
      )
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
                h('button', { onclick: () => editMetric(m) }, h('div', { style: 'display:flex;gap:8px;align-items:center;font-weight:500;font-size:14px' }, dot(m.area), m.name), h('div', { class: 'muted tnum' }, m.target != null ? `Target ${num(m.target)}${m.unit ? ' ' + m.unit : ''}${m.targetDate ? ' by ' + fmt(m.targetDate, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}` : 'No target set'), h('div', { class: 'muted' }, CADENCE_LABELS[m.cadence || 'asNeeded'])),
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
      capacitySection(),
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
let historyMonths = 4
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
        ? [...months].slice(0, historyMonths).map(([k, list]) => [
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
        : h('div', { class: 'empty' }, 'Nothing here yet.'),
      months.size > historyMonths ? h('div', { class: 'add' }, h('button', { class: 'btn', onclick: () => ((historyMonths += 6), render()) }, `Show 6 more months of ${months.size - historyMonths}`)) : null
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
const openItem = (ref) => openEditor(ref)

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
let repeatDraft = {}
function setDraft(fn) {
  fn(draft)
  draftDirty = true
  render()
}

function viewItem(ref = st.ref) {
  const f = findItem(st.db, ref)
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
    for (const k of ['title', 'type', 'area', 'why', 'requirements', 'noRequirements', 'proposal', 'criteria', 'decision', 'start', 'end', 'estimate', 'detail', 'status']) payload[k] = d[k] ?? (k === 'start' || k === 'end' ? '' : undefined)
    if (kind === 'goal') payload.parentId = d.parentId || ''
    else Object.assign(payload, { goalId: d.goalId || '', date: d.date, priority: d.priority || '', target: d.target, time: d.time || '' })
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
    if (editor) return closeEditor(true)
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
      chainChips(f.ref),
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
        kind === 'task' && item.date
          ? area2(
              'Time',
              h('input', {
                class: 'field',
                type: 'time',
                step: 900,
                value: dayPlan(st.db, item.date).items.find((x) => x.key === f.ref)?.start || '',
                onchange: (e) => op('set_slot', { date: item.date, key: f.ref, start: e.target.value || null })
              })
            )
          : null,
        area2('Start', field('start', { type: 'date' })),
        area2('Target end', field('end', { type: 'date', placeholder: kind === 'goal' ? itemEnd(st.db, item, kind) : '' })),
        kind === 'goal' && !d.end ? [h('span'), h('span', { class: 'muted' }, `Defaults to ${fmt(itemEnd(st.db, item, kind), { month: 'long', day: 'numeric', year: 'numeric' })}, the end of its period.`)] : null,
        area2(kind === 'task' ? 'Estimate, minutes' : 'Estimate, hours', field('estimate', { type: 'number', min: 0 })),
        kind === 'task' ? area2('Priority', select('priority', [['', 'Choose'], ...PRIORITIES.map((p) => [p, p[0].toUpperCase() + p.slice(1)])])) : null,
        kind === 'task' ? area2('Shown as', field('target', { placeholder: 'Short amount on the day, e.g. 45 min' })) : null
      ),
      kind === 'task' && item.date
        ? (() => {
            const it = dayPlan(st.db, item.date).items.find((x) => x.key === f.ref)
            if (!it) return null
            return section(
              'On the day',
              fmt(item.date, { weekday: 'long', month: 'short', day: 'numeric' }),
              h(
                'div',
                { class: 'irow' },
                h('div', { class: 'seg' }, ['todo', 'done', 'partial', 'skipped'].map((x) => h('button', { 'aria-pressed': String(it.status === x), onclick: () => (x === 'done' ? toggleDone(item.date, { ...it, status: 'todo' }) : op('set_item_status', { date: item.date, key: f.ref, status: x })) }, { todo: 'To do', done: 'Done', partial: 'Partly', skipped: 'Skipped' }[x]))),
                h('input', { class: 'field grow', placeholder: 'What happened', value: it.actual || '', onchange: (e) => op('set_item_status', { date: item.date, key: f.ref, actual: e.target.value }, { silent: true }) }),
                h('button', { class: 'btn ghost', onclick: () => go('day', item.date) }, 'Go to the day')
              )
            )
          })()
        : null,
      kind === 'task' && !CLOSED.has(item.status)
        ? (() => {
            const date = item.date || today()
            const rx = (repeatDraft.ref === f.ref ? repeatDraft : (repeatDraft = { ref: f.ref, start: date, repeat: null }))
            return section(
              'Repeats',
              'A repeating task becomes a routine that fills each matching day',
              h(
                'div',
                { class: 'irow' },
                repeatControl(rx, () => render(), { none: true }),
                rx.repeat ? h('button', { class: 'btn primary', onclick: () => makeRepeat(item, { repeat: repeatOf(rx), days: rx.repeat.every === 'week' ? rx.days || [0, 1, 2, 3, 4, 5, 6] : undefined }) }, 'Make it repeat') : null
              )
            )
          })()
        : null,
      d.type === 'decision' ? decisionSection(d, kind, f.ref, item) : null,
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
                  children.map((c) => (c.k === 'goal' ? goalBlock(c.it, { compact: true }) : block({ key: c.ref, kind: 'task', title: c.it.title, area: c.it.area, status: c.it.status === 'done' ? 'done' : 'todo' }, { compact: true }))),
                  routines.map((r) => block({ key: 'r:' + r.id, kind: 'routine', title: r.title, area: r.area, target: r.target }, { compact: true }))
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
const FIELD_LABELS = { days: 'Days', active: 'Active', criterion: 'A session passes when', time: 'When', type: 'Type', title: 'Title', why: 'Why', requirements: 'Requirements', noRequirements: 'Nothing needed first', proposal: 'Proposal', criteria: 'Acceptance criteria', start: 'Start', end: 'Target end', estimate: 'Estimate', priority: 'Priority', parentId: 'Serves', goalId: 'Serves', date: 'Do date', area: 'Area', target: 'Shown as', detail: 'Notes' }
function showValue(k, v, kind) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return h('span', { class: 'muted' }, 'None')
  if (k === 'type') return typeLabel(kind, v)
  if (k === 'parentId' || k === 'goalId') {
    const g = goal(v)
    return g ? `${periodLabel(g.horizon, g.period)}: ${g.title}` : v
  }
  if (k === 'area') return area(v).name
  if (k === 'noRequirements' || k === 'active') return v ? 'Yes' : 'No'
  if (k === 'days') return v.length === 7 ? 'Every day' : [1, 2, 3, 4, 5, 6, 0].filter((d) => v.includes(d)).map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')
  if (k === 'time') return v === 'am' ? 'Morning' : v === 'pm' ? 'Evening' : 'Any time'
  if (k === 'estimate') return kind === 'goal' ? `${v} h` : `${v} min`
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
        const f = p.kind === 'routine' ? (() => { const r = st.db.routines.find((x) => 'r:' + x.id === p.ref); return r ? { kind: 'routine', item: r, ref: p.ref } : null })() : findItem(st.db, p.ref)
        const before = f ? f.item : {}
        const after = f ? { ...f.item, ...p.fields } : p.fields
        const qBefore = f ? quality(lint(st.db, f.item, f.kind)) : ''
        const qAfter = f && f.kind !== 'routine' && p.action === 'update' ? quality(lint(st.db, after, f.kind)) : ''
        const qBefore2 = f && f.kind !== 'routine' ? qBefore : ''
        return h(
          'article',
          { class: `prop ${inboxSel.has(p.id) ? 'sel' : ''}` },
          h(
            'header',
            {},
            h('input', { type: 'checkbox', 'aria-label': `Select ${p.title}`, checked: inboxSel.has(p.id), onchange: (e) => (e.target.checked ? inboxSel.add(p.id) : inboxSel.delete(p.id), render()) }),
            dot(p.area),
            h('button', { class: 'title', onclick: () => (f?.kind === 'routine' ? editRoutine(f.item) : openItem(p.ref)) }, f ? f.item.title : p.title),
            h('span', { class: `badge ${p.action === 'drop' ? 's-missed' : ''}` }, p.action === 'drop' ? 'Drop' : 'Update'),
            f ? h('span', { class: 'muted' }, f.kind === 'routine' ? 'Routine' : f.kind === 'goal' ? `${periodLabel(f.item.horizon, f.item.period)} goal` : `Task, ${f.item.date ? fmt(f.item.date, { month: 'short', day: 'numeric' }) : ''}`) : h('span', { class: 'badge q-bad' }, 'Item no longer exists'),
            qAfter ? h('span', { class: 'muted' }, `${qLabel[qBefore2]} → `, h('span', { class: `badge ${qClass[qAfter]}` }, qLabel[qAfter])) : null
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
            p.action === 'update' && f?.kind !== 'routine' ? h('button', { class: 'btn', onclick: async () => (await review([p.id], [], 'accept'), openItem(p.ref)) }, 'Accept and edit') : null,
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
        openEditor(ref)
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
    { class: 'rows triage-list' },
    rows.map((r) => {
      const it = { key: r.ref, kind: r.kind, title: r.item.title, area: r.item.area, goalId: r.kind === 'task' ? r.item.goalId : null, status: 'todo' }
      const el = block(it, {
        compact,
        zone: 'overdue',
        tools: [
          h('span', { class: 'muted tnum small' }, `${r.status === 'blocked' ? 'Blocked' : `Was due ${fmt(r.end, { month: 'short', day: 'numeric' })}`}`),
          r.kind === 'task' ? h('button', { class: 'btn', onclick: () => act(r.ref, 'move', { date: today() }) }, 'Today') : null,
          h('button', { class: 'btn ghost', onclick: () => moveTo(r) }, 'Move'),
          h('button', { class: 'btn ghost', onclick: () => act(r.ref, 'done') }, 'Done'),
          r.kind === 'task' ? h('button', { class: 'btn ghost', onclick: () => act(r.ref, 'routine') }, 'Make routine') : null,
          h('button', { class: 'btn ghost danger', onclick: () => drop(r) }, 'Drop')
        ]
      })
      el.dataset.date = r.item.date || ''
      return el
    })
  )
}

/** Which status moves the board allows, and what they mean: accept, close, reopen. Blocked and missed are derived. */
function boardMoves(ref, to) {
  const f = findItem(st.db, ref)
  if (!f) return { ok: false }
  const from = effectiveStatus(st.db, f.item, f.kind)
  if (from === to) return { ok: false }
  if (to === 'active') return { ok: ['proposed', 'done', 'missed', 'blocked'].includes(from) }
  if (to === 'done') return { ok: from !== 'proposed' }
  return { ok: false }
}
async function boardMove(ref, to) {
  const f = findItem(st.db, ref)
  const from = effectiveStatus(st.db, f.item, f.kind)
  try {
    if (to === 'active' && from === 'proposed') {
      await op('review_proposals', { refs: [ref], decision: 'accept' })
      toast('Accepted')
    } else if (to === 'active' && from === 'done') {
      await op('close_item', { ref, status: 'active' })
      pushUndo(`reopened "${f.item.title}"`, () => op('close_item', { ref, status: 'done', overrideReason: 'Restored by undo' }))
    } else if (to === 'active' && from === 'missed') {
      openEditor(ref)
      toast('It is past its end date: give it a new end date or do date here.')
    } else if (to === 'active' && from === 'blocked') {
      openEditor(ref)
      toast('It is waiting on a requirement: mark the requirement met or remove it here.')
    } else if (to === 'done') {
      await op('close_item', { ref, status: 'done' }, { quiet: true })
      pushUndo(`closed "${f.item.title}"`, () => op('close_item', { ref, status: 'active' }))
      toast('Marked done. Ctrl+Z to undo.')
    }
  } catch (e) {
    if (e.code === 'CRITERIA') {
      toast('Its acceptance criteria are not all met yet. Here they are.')
      openEditor(ref)
    } else if (e.code !== 'STALE') toast(e.message)
  }
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
          dropZone(
            h(
              'section',
              { class: 'bcol', 'data-status': k },
              h('h3', {}, label, h('span', { class: 'muted tnum' }, num(groups[k].length))),
              groups[k].slice(0, LIMIT).map(([kind, x]) => {
                const ref = (kind === 'goal' ? 'g:' : 't:') + x.id
                const el = block({ key: ref, kind, title: x.title, area: x.area, goalId: kind === 'goal' ? null : x.goalId }, { compact: true, dragAny: true, zone: 'board' })
                el.dataset.status = k
                el.append(h('div', { class: 'bq' }, qualityBadge(st.db, x, kind), itemEnd(st.db, x, kind) ? h('span', { class: 'muted tnum' }, fmt(itemEnd(st.db, x, kind), { month: 'short', day: 'numeric', year: 'numeric' })) : null))
                return el
              }),
              groups[k].length > LIMIT ? h('div', { class: 'muted' }, `${num(groups[k].length - LIMIT)} more. Filter by area to narrow.`) : null
            ),
            {
              accept: (d) => d.zone === 'board' && boardMoves(d.ref, k).ok,
              drop: (d) => boardMove(d.ref, k)
            }
          )
        )
      )
    )
  }
}

// ---- focus, capacity, decisions --------------------------------------------------------------------------------------
const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`)
function loadLine(date) {
  const l = dayLoad(st.db, date)
  const pct = Math.min(100, Math.round((l.minutes / (l.capacity || 1)) * 100))
  return h(
    'div',
    { class: `loadline ${l.over ? 'over' : ''}`, title: `Routines ${hm(l.routineMinutes)}, tasks ${hm(l.taskMinutes)}` },
    h('span', { class: 'loadbar' }, h('i', { style: `width:${pct}%` })),
    h('span', { class: 'tnum' }, `${hm(l.minutes)} planned of ${hm(l.capacity)}`),
    l.over ? h('span', { class: 'badge q-bad' }, `Over by ${hm(l.minutes - l.capacity)}`) : null,
    l.over && l.routineMinutes > l.capacity ? h('span', { class: 'muted' }, 'Routines alone fill this day.') : null,
    l.over ? h('button', { class: 'btn ghost', onclick: () => balanceDialog(date, addDays(date, 13)) }, 'Balance the next two weeks') : null
  )
}
async function setFocus(date, keys) {
  await op('set_focus', { date, keys })
}
function focusToggle(date, it, focus) {
  const on = focus.keys.includes(it.key)
  return h(
    'button',
    {
      class: `star ${on ? 'on' : ''}`,
      'aria-pressed': String(on),
      'aria-label': on ? `Remove from focus: ${it.title}` : `Add to focus: ${it.title}`,
      title: on ? 'Remove from focus' : 'Add to focus',
      onclick: () => {
        const base = focus.chosen ? focus.keys : []
        if (on) return setFocus(date, (focus.chosen ? base : focus.keys).filter((k) => k !== it.key))
        if (base.length >= 3) return toast('Three focus items at most. Remove one first.')
        setFocus(date, [...base, it.key])
      }
    },
    icon('star')
  )
}
async function balanceDialog(from, to) {
  const r = await (await fetch('/api/op', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'balance_days', args: { from, to } }) })).json()
  const plan = r.result
  if (!plan) return toast(r.error || 'Could not plan the balance')
  const lines = plan.moves.map((m) => `${fmt(m.from, { weekday: 'short', month: 'short', day: 'numeric' })} → ${fmt(m.to, { weekday: 'short', month: 'short', day: 'numeric' })}: ${m.title} (${hm(m.minutes)})`)
  const stuck = plan.unresolved.length
  const v = await formDialog({
    title: plan.moves.length ? `Move ${plural(plan.moves.length, 'task')} to days with room?` : 'Nothing can be moved',
    confirm: plan.moves.length ? 'Move them' : 'Close',
    fields: [
      {
        name: 'summary',
        label: 'Plan',
        type: 'textarea',
        default: [
          ...lines,
          lines.length ? '' : 'Only could and should tasks with a later end date can move, and every day before their end dates is full.',
          stuck ? `${plural(stuck, 'day')} stay over capacity. Trim routines on the Routines page, drop tasks, or raise capacity in Settings.` : 'Every day ends up within capacity.'
        ]
          .filter((x) => x !== undefined)
          .join('\n')
      }
    ]
  })
  if (v && plan.moves.length) {
    const done = await op('apply_balance', { from, to })
    toast(`Moved ${plural(done.moves.length, 'task')}`)
  }
}
function decisionsSection(date) {
  const due = decisionsDue(st.db, date, 7).filter((x) => inArea(x))
  if (!due.length) return null
  return [
    sechead('Decisions due', 'Within a week'),
    h(
      'div',
      { class: 'rows' },
      due.slice(0, 6).map((x) => {
        const f = findItem(st.db, x.ref)
        return block({ key: x.ref, kind: f.kind, title: x.question, area: x.area, goalId: f.kind === 'task' ? f.item.goalId : null, status: 'todo' }, { zone: 'decisions', tools: [h('span', { class: 'muted small tnum' }, `${x.options ? plural(x.options, 'option') : 'No options yet'}, due ${fmt(x.due, { month: 'short', day: 'numeric' })}`), h('button', { class: 'btn', onclick: () => openEditor(x.ref) }, 'Decide')] })
      })
    )
  ]
}
async function decideDialog(ref, item) {
  const d = item.decision || {}
  if (!(d.options || []).length) return toast('List the options first, then decide.')
  const v = await formDialog({
    title: d.question || item.title,
    confirm: 'Record decision',
    values: { option: d.chosen ?? 0 },
    fields: [
      { name: 'option', label: 'Chosen', type: 'select', options: d.options.map((o, i) => [i, o.text]) },
      { name: 'reasons', label: 'Why', type: 'textarea' }
    ]
  })
  if (!v) return
  const r = await op('decide', { ref, option: +v.option, reasons: v.reasons })
  toast(r.closedNow ? 'Decided and closed. It is in the history.' : 'Decided. Other criteria are still open.')
}
function decisionSection(d, kind, ref, item) {
  d.decision ||= { question: '', options: [], affects: [] }
  const dec = d.decision
  const rows = dec.options.map((o, i) =>
    h(
      'div',
      { class: 'irow' },
      h('span', { class: `mark small ${dec.chosen === i ? 'done' : ''}`, title: dec.chosen === i ? 'Chosen' : '' }, dec.chosen === i ? icon('check') : null),
      h('input', { class: 'field grow', value: o.text, placeholder: 'Option', oninput: (e) => ((dec.options[i].text = e.target.value), (draftDirty = true)) }),
      h('input', { class: 'field grow', value: o.notes || '', placeholder: 'For and against', oninput: (e) => ((dec.options[i].notes = e.target.value), (draftDirty = true)) }),
      h('button', { class: 'icon-btn', 'aria-label': 'Remove option', onclick: () => setDraft((x) => (x.decision.options.splice(i, 1), x.decision.chosen === i && (x.decision.chosen = null))) }, icon('x'))
    )
  )
  return h(
    'section',
    { class: 'isec' },
    h('div', { class: 'isec-head' }, h('h3', { class: 'display' }, 'Decision'), h('span', { class: 'muted' }, dec.chosen != null && dec.options[dec.chosen] ? `Chose "${dec.options[dec.chosen].text}"${dec.chosenAt ? ` on ${fmt(dec.chosenAt, { month: 'short', day: 'numeric' })}` : ''}` : 'Not decided yet')),
    h('input', { class: 'field', style: 'width:100%', value: dec.question, placeholder: 'The question this decision answers', oninput: (e) => ((dec.question = e.target.value), (draftDirty = true)) }),
    h('div', { class: 'ilist', style: 'margin-top:8px' }, rows),
    h(
      'div',
      { class: 'add' },
      h('button', { class: 'btn ghost', onclick: () => setDraft((x) => x.decision.options.push({ text: '', notes: '' })) }, icon('plus'), 'Add option'),
      h('label', { class: 'chk' }, 'Review by', h('input', { class: 'field', type: 'date', value: dec.reviewBy || '', oninput: (e) => ((dec.reviewBy = e.target.value || undefined), (draftDirty = true)) })),
      h('span', { class: 'spacer', style: 'flex:1' }),
      h('button', { class: 'btn primary', onclick: async () => (draftDirty ? toast('Save first, then decide.') : decideDialog(ref, item)) }, dec.chosen != null ? 'Change decision' : 'Decide')
    ),
    dec.reasons ? h('p', { class: 'muted' }, `Why: ${dec.reasons}`) : null
  )
}
function capacitySection() {
  const mins = st.db.policy?.capacity?.minutes || DEFAULT_CAPACITY().minutes
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const inputs = mins.map((m, i) => h('input', { class: 'field num tnum', type: 'number', min: 0, max: 24, step: 0.5, value: m / 60, 'aria-label': `${names[i]} hours` }))
  return [
    sechead('Daily capacity'),
    h('p', { class: 'lede' }, 'Hours you have for planned items each day: routines and tasks together. Days over this show a warning, and Claude cannot add a task to a full day.'),
    h('div', { class: 'capgrid' }, [1, 2, 3, 4, 5, 6, 0].map((i) => h('label', {}, names[i].slice(0, 3), inputs[i]))),
    h('div', { class: 'add' }, h('button', { class: 'btn', onclick: async () => (await op('set_capacity', { minutes: inputs.map((x) => Math.round((+x.value || 0) * 60)) }), toast('Saved')) }, 'Save capacity'))
  ]
}

// ---- blocks: one component for everything plannable, with selection, drag and drop, keyboard and undo --------------
// A block is a task, a routine session or a goal. Click selects it, double-click or Enter opens the editor, Space
// ticks it, Alt+arrows move it, and it can be dragged onto any drop zone (a day, a focus list, a board column).
const undoStack = []
function pushUndo(label, fn) {
  undoStack.push({ label, fn })
  if (undoStack.length > 50) undoStack.shift()
}
async function undo() {
  const u = undoStack.pop()
  if (!u) return toast('Nothing to undo')
  try {
    await u.fn()
    toast(`Undone: ${u.label}`)
  } catch (e) {
    toast(`Could not undo: ${e.message}`)
  }
}

function taskOf(ref) {
  return st.db.tasks.find((t) => 't:' + t.id === ref)
}
function routineOf(ref) {
  return st.db.routines.find((r) => 'r:' + r.id === ref)
}

/** Moves a task to a date, with undo. */
async function moveTask(ref, date, { quiet } = {}) {
  const t = taskOf(ref)
  if (!t) return
  if (t.date === date) return
  const was = { date: t.date, end: t.end }
  try {
    await op('move_task', { ref, date }, { quiet: true })
    pushUndo(`moved "${t.title}"`, () => op('upsert_task', { id: t.id, date: was.date, end: was.end || '' }))
    if (!quiet) toast(`Moved to ${fmt(date, { weekday: 'short', month: 'short', day: 'numeric' })}. Ctrl+Z to undo.`)
  } catch (e) {
    if (e.code !== 'STALE') toast(e.message)
  }
}
async function toggleDone(date, it) {
  const before = it.status
  const next = before === 'done' ? 'todo' : 'done'
  try {
    await op('set_item_status', { date, key: it.key, status: next }, { quiet: true })
    pushUndo(`${next === 'done' ? 'ticked' : 'unticked'} "${it.title}"`, () => op('set_item_status', { date, key: it.key, status: before }))
  } catch (e) {
    if (e.code === 'CRITERIA') {
      toast('Its acceptance criteria are not all met yet. Here they are.')
      openEditor(it.key)
    } else if (e.code !== 'STALE') toast(e.message)
  }
}
async function changeFocus(date, keys, label) {
  const before = st.db.days?.[date]?.focus || []
  await op('set_focus', { date, keys })
  pushUndo(label, () => op('set_focus', { date, keys: before }))
}
async function reorder(date, keys) {
  const before = st.db.days?.[date]?.order || dayPlan(st.db, date).items.map((it) => it.key)
  await op('reorder_day', { date, keys }, { silent: false })
  pushUndo('reordered the day', () => op('reorder_day', { date, keys: before }))
}

/**
 * The block element. `it` is a day-plan item ({ key, kind, title, area, status, ... }) or a goal or task card.
 * opts: date (the day it sits on), compact, focus (focus info for the star), zone (the list it belongs to).
 */
function block(it, opts = {}) {
  const ref = it.key
  const task = it.kind === 'task' ? taskOf(ref) : null
  const goalRec = it.kind === 'goal' ? goal(ref.slice(2)) : null
  const mins = it.kind === 'goal' ? null : minutesOf(st.db, it)
  const g = it.goalId && goal(it.goalId)
  const chips = []
  if (!opts.inGrid) chips.push(h('span', { class: 'chip area' }, dot(it.area), area(it.area).name))
  if (it.start && opts.date) chips.push(h('span', { class: 'chip tnum' }, `${it.start}${mins ? `–${fromMin(Math.min(1439, toMin(it.start) + mins))}` : ''}`))
  if (it.kind === 'routine') chips.push(h('span', { class: 'chip' }, 'Routine'))
  if (task?.type && !opts.inGrid) chips.push(h('span', { class: 'chip' }, typeLabel('task', task.type)))
  if (goalRec) chips.push(h('span', { class: 'chip' }, `${typeLabel('goal', goalRec.type)}, ${periodLabel(goalRec.horizon, goalRec.period)}`))
  if (mins != null && !it.start) chips.push(h('span', { class: 'chip tnum' }, hm(mins)))
  if (task?.priority === 'must') chips.push(h('span', { class: 'chip must' }, 'Must'))
  if (task?.end && opts.date && task.end !== opts.date && !opts.inGrid) chips.push(h('span', { class: 'chip tnum' }, `Due ${fmt(task.end, { month: 'short', day: 'numeric' })}`))
  const sb = task ? statusBadge(st.db, task, 'task') : goalRec ? statusBadge(st.db, goalRec, 'goal') : null
  if (sb) chips.push(sb)
  if (!opts.compact && !opts.inGrid && g) chips.push(h('span', { class: 'chip faint', title: g.title }, `For: ${g.title.length > 48 ? g.title.slice(0, 46) + '…' : g.title}`))
  const movable = it.kind === 'goal' || it.kind === 'routine' || (it.kind === 'task' && !CLOSED.has(task?.status))
  const el = h(
    'div',
    {
      class: `blk ${it.kind} ${it.status || ''} ${it.proposed || task?.status === 'proposed' ? 'proposed' : ''} ${opts.compact ? 'compact' : ''} ${opts.inGrid ? 'ingrid' : ''} ${st.sel === ref + '@' + (opts.date || '') ? 'sel' : ''}`,
      tabindex: 0,
      role: 'button',
      'aria-label': `${it.title}. ${it.kind}${it.start ? ` at ${it.start}` : ''}. Double-click or Enter to edit.`,
      'data-ref': ref,
      'data-date': opts.date || '',
      'data-zone': opts.zone || '',
      onclick: (e) => {
        if (suppressClick || e.target.closest('button, input, select, .resize')) return
        select(ref, opts.date)
      },
      ondblclick: (e) => {
        if (e.target.closest('button, input, select, .resize')) return
        openEditor(ref)
      },
      onkeydown: (e) => blockKey(e, it, opts),
      onpointerdown: (e) => {
        if (!movable || e.target.closest('button, input, select, .resize')) return
        beginPointerDrag(e, { ref, kind: it.kind, date: opts.date, zone: opts.zone, minutes: mins || 30, start: it.start || '' }, el)
      }
    },
    opts.date && it.kind !== 'goal'
      ? h('span', { class: 'lead' }, opts.focus && !opts.inGrid ? focusToggle(opts.date, it, opts.focus) : null, h('button', { class: `mark ${it.status}`, onclick: () => toggleDone(opts.date, it), 'aria-label': `${it.status === 'done' ? 'Unmark' : 'Mark done'}: ${it.title}`, 'aria-pressed': String(it.status === 'done') }, it.status === 'done' ? icon('check') : it.status === 'skipped' ? icon('x') : null))
      : goalRec
        ? h('span', { class: 'lead' }, dot(goalRec.area))
        : null,
    h('div', { class: 'bbody' }, h('div', { class: 'btitle' }, it.title), h('div', { class: 'chips' }, chips)),
    opts.tools ? h('div', { class: 'tools' }, opts.tools) : null
  )
  if (opts.inGrid)
    el.append(
      h('div', { class: 'resize top', title: 'Drag to change when it starts', onpointerdown: (e) => beginResize(e, it, opts.date, el, 'top') }),
      h('div', { class: 'resize', title: 'Drag to change how long it takes', onpointerdown: (e) => beginResize(e, it, opts.date, el) })
    )
  return el
}

let dragging = null
function select(ref, date) {
  st.sel = ref + '@' + (date || '')
  document.querySelectorAll('.blk.sel').forEach((x) => x.classList.remove('sel'))
  document.querySelector(`.blk[data-ref="${CSS.escape(ref)}"][data-date="${date || ''}"]`)?.classList.add('sel')
  if (st.view === 'day') {
    keepFocus = true
    render()
  }
}

async function blockKey(e, it, opts) {
  if (e.target !== e.currentTarget) return
  const ref = it.key
  if (e.key === 'Enter') {
    e.preventDefault()
    return openEditor(ref)
  }
  if (e.key === ' ' && opts.date && it.kind !== 'goal') {
    e.preventDefault()
    return toggleDone(opts.date, it)
  }
  if ((e.key === 'f' || e.key === 'F') && opts.focus) {
    e.preventDefault()
    e.currentTarget.querySelector('.star')?.click()
    return
  }
  if (!e.altKey) return
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && it.kind === 'task' && opts.date) {
    e.preventDefault()
    const to = addDays(opts.date, e.key === 'ArrowLeft' ? -1 : 1)
    st.sel = ref + '@' + to
    keepFocus = true
    await moveTask(ref, to, { quiet: true })
    if (st.view === 'day') go('day', to)
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && opts.date && opts.zone) {
    e.preventDefault()
    const keys = [...document.querySelectorAll(`.blk[data-zone="${opts.zone}"][data-date="${opts.date}"]`)].map((x) => x.dataset.ref)
    const i = keys.indexOf(ref)
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1
    if (i < 0 || j < 0 || j >= keys.length) return
    ;[keys[i], keys[j]] = [keys[j], keys[i]]
    keepFocus = true
    if (opts.zone === 'focus') return changeFocus(opts.date, keys, 'reordered focus')
    const all = dayPlan(st.db, opts.date).items.map((x) => x.key)
    const focusKeys = focusFor(st.db, opts.date).keys
    reorder(opts.date, [...focusKeys, ...keys, ...all.filter((k) => !keys.includes(k) && !focusKeys.includes(k))])
  }
}
let keepFocus = false

/**
 * Turns an element into a drop zone. accept(drag) says whether this drag may land here; drop(drag, beforeRef) acts.
 * Lists that can be reordered get a before-marker under the pointer.
 */
function dropZone(el, opts) {
  zones.set(el, opts)
  el.dataset.dropzone = '1'
  return el
}
const insertBefore = (list, key, before) => {
  const out = list.filter((k) => k !== key)
  const i = before ? out.indexOf(before) : -1
  if (i < 0) out.push(key)
  else out.splice(i, 0, key)
  return out
}

// ---- the editor: one modal for every goal and task ---------------------------------------------------------------
// ---- editors: one for each kind of thing, stacked so a link inside one opens the next on top --------------------
const stack = []
let editor = null
function openEditor(ref) {
  ref = String(ref)
  const kind = ref.startsWith('r:') ? 'routine' : ref.startsWith('m:') ? 'metric' : 'item'
  if (!findAnyClient(ref)) return toast('That item no longer exists')
  if (editor) {
    editor.saved = { draft, draftRef, draftDirty }
    editor.dlg.close()
  }
  draft = null
  draftRef = ''
  draftDirty = false
  const dlg = h('dialog', { class: `editor ${kind}`, 'aria-label': 'Edit' })
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault()
    closeEditor()
  })
  dlg.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      dlg.querySelector('.item-bar .btn.primary')?.click()
    }
  })
  document.body.append(dlg)
  editor = { ref, kind, dlg }
  stack.push(editor)
  renderEditor()
  dlg.showModal()
}
function closeEditor(force) {
  if (!editor) return
  if (!force && draftDirty && !confirm('Close without saving your changes?')) return
  editor.dlg.close()
  editor.dlg.remove()
  stack.pop()
  editor = stack.at(-1) || null
  if (editor) {
    ;({ draft, draftRef, draftDirty } = editor.saved || { draft: null, draftRef: '', draftDirty: false })
    editor.dlg.showModal()
    renderEditor()
  } else draftDirty = false
  render()
}
function renderEditor() {
  if (!editor) return
  const scroller = editor.dlg.querySelector('.editor-body')
  const top = scroller?.scrollTop || 0
  const v = editor.kind === 'routine' ? viewRoutineEditor(editor.ref) : editor.kind === 'metric' ? viewMetricEditor(editor.ref) : viewItem(editor.ref)
  const below = stack.length > 1 ? stack.at(-2) : null
  editor.dlg.replaceChildren(
    h(
      'header',
      { class: 'editor-head' },
      below ? h('button', { class: 'btn ghost', onclick: () => closeEditor() }, icon('left'), `Back to ${(findAnyClient(below.ref)?.item.title || findAnyClient(below.ref)?.item.name || '').slice(0, 40)}`) : null,
      h('span', { class: 'kindtag' }, v.title),
      h('span', { class: 'muted' }, v.meta || ''),
      h('span', { style: 'flex:1' }),
      h('span', { class: 'muted small' }, 'Ctrl+Enter saves, Esc closes'),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => closeEditor() }, icon('x'))
    ),
    h('div', { class: 'editor-body scroll' }, v.body)
  )
  editor.dlg.querySelector('.editor-body').scrollTop = top
}

// ---- week and month with blocks ----------------------------------------------------------------------------------
const expandedRoutines = new Set()
function dayColumn(p, { compact = true } = {}) {
  const items = p.items.filter(inArea)
  const tasks = items.filter((it) => it.kind === 'task')
  const routines = items.filter((it) => it.kind === 'routine')
  const l = dayLoad(st.db, p.date, p)
  const rMin = routines.reduce((s, it) => s + minutesOf(st.db, it), 0)
  const open = expandedRoutines.has(p.date)
  const col = h(
    'div',
    { class: `daycol${p.date === today() ? ' today' : ''}`, 'data-date': p.date },
    h(
      'button',
      { class: 'dhead', onclick: () => go('day', p.date), 'aria-label': `Open ${fmt(p.date, { weekday: 'long', month: 'long', day: 'numeric' })}` },
      h('span', { class: 'dnum display tnum' }, +p.date.slice(8)),
      h('span', { class: 'muted' }, fmt(p.date, { weekday: 'short' })),
      h('span', { style: 'flex:1' }),
      p.score.pct != null && p.date <= today() ? h('span', { class: 'muted tnum' }, `${p.score.pct}%`) : null
    ),
    h('div', { class: `loadmini ${l.over ? 'over' : ''}`, title: `Routines ${hm(l.routineMinutes)}, tasks ${hm(l.taskMinutes)}, capacity ${hm(l.capacity)}` }, h('span', { class: 'loadbar' }, h('i', { style: `width:${Math.min(100, Math.round((l.minutes / (l.capacity || 1)) * 100))}%` })), h('span', { class: 'tnum' }, `${hm(l.minutes)}/${hm(l.capacity)}`)),
    tasks.map((it) => block(it, { date: p.date, compact, zone: 'week' })),
    routines.length
      ? h(
          'button',
          { class: 'rfold', 'aria-expanded': String(open), onclick: () => (open ? expandedRoutines.delete(p.date) : expandedRoutines.add(p.date), render()) },
          `${plural(routines.length, 'routine')}, ${hm(rMin)}`,
          h('span', { class: 'muted' }, open ? ' Hide' : ' Show')
        )
      : null,
    open ? routines.map((it) => block(it, { date: p.date, compact })) : null
  )
  return dropZone(col, {
    accept: (d) => d.kind === 'task' && d.date !== p.date,
    drop: (d) => moveTask(d.ref, p.date)
  })
}

// ---- the drag engine: pointer events, so it works with a mouse, a pen or a finger ---------------------------------
const zones = new WeakMap()
let suppressClick = false
const GRID = { start: 6, end: 24, ppm: 1.1 }
function acceptingZone(x, y, d) {
  let el = document.elementFromPoint(x, y)
  while (el) {
    if (el.dataset?.dropzone) {
      const o = zones.get(el)
      if (o && o.accept(d)) return el
    }
    el = el.parentElement
  }
  return null
}
function clearZone(z) {
  z.classList.remove('over')
  z.querySelectorAll(':scope .drop-before').forEach((x) => x.classList.remove('drop-before'))
  z.querySelector(':scope > .slotpreview')?.remove()
}
function hoverZone(z, ev, d) {
  const o = zones.get(z)
  z.classList.add('over')
  if (o.grid) {
    const r = z.getBoundingClientRect()
    const top = ev.clientY - r.top - (d.grabY || 0)
    let m = GRID.start * 60 + Math.round(top / GRID.ppm / 15) * 15
    m = Math.max(GRID.start * 60, Math.min(GRID.end * 60 - 15, m))
    let pv = z.querySelector(':scope > .slotpreview')
    if (!pv) z.append((pv = h('div', { class: 'slotpreview' })))
    pv.style.top = `${(m - GRID.start * 60) * GRID.ppm}px`
    pv.style.height = `${Math.max(15, d.minutes || 30) * GRID.ppm}px`
    pv.textContent = fromMin(m)
    return { time: fromMin(m) }
  }
  if (o.ordered) {
    z.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'))
    const before = [...z.querySelectorAll('.blk:not(.dragging)')].find((b) => {
      const rr = b.getBoundingClientRect()
      return ev.clientY < rr.top + rr.height / 2
    })
    if (before) before.classList.add('drop-before')
    return { before: before?.dataset.ref || null }
  }
  return {}
}
function beginPointerDrag(e, d, sourceEl) {
  if (e.button !== 0) return
  const sx = e.clientX
  const sy = e.clientY
  const touch = e.pointerType === 'touch'
  const t0 = Date.now()
  let started = false
  let ghost = null
  let cur = null
  let info = {}
  const finish = (commit) => {
    removeEventListener('pointermove', move)
    removeEventListener('pointerup', up)
    removeEventListener('pointercancel', cancel)
    removeEventListener('keydown', esc)
    if (!started) return
    ghost?.remove()
    sourceEl.classList.remove('dragging')
    document.body.classList.remove('dragging-any')
    const z = cur
    if (z) clearZone(z)
    dragging = null
    suppressClick = true
    setTimeout(() => (suppressClick = false), 0)
    if (commit && z) zones.get(z).drop(d, info.before || null, info)
  }
  const move = (ev) => {
    if (!started) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return
      if (touch && Date.now() - t0 < 250) return finish(false)
      started = true
      dragging = d
      const r = sourceEl.getBoundingClientRect()
      d.grabY = sy - r.top
      sourceEl.classList.add('dragging')
      document.body.classList.add('dragging-any')
      ghost = sourceEl.cloneNode(true)
      ghost.classList.add('dragghost')
      ghost.style.width = `${Math.min(r.width, 320)}px`
      document.body.append(ghost)
    }
    ev.preventDefault()
    ghost.style.transform = `translate(${ev.clientX - 12}px, ${ev.clientY - d.grabY}px)`
    const z = acceptingZone(ev.clientX, ev.clientY, d)
    if (cur && cur !== z) clearZone(cur)
    cur = z
    info = z ? hoverZone(z, ev, d) : {}
  }
  const up = () => finish(true)
  const cancel = () => finish(false)
  const esc = (ev) => ev.key === 'Escape' && finish(false)
  addEventListener('pointermove', move, { passive: false })
  addEventListener('pointerup', up)
  addEventListener('pointercancel', cancel)
  addEventListener('keydown', esc)
}
/**
 * Drags a calendar block's edge. The bottom edge changes how long it takes; the top edge changes when it starts and
 * keeps the end where it was. Snaps to 15 minutes and shows the times while dragging; Escape cancels.
 */
function beginResize(e, it, date, el, edge = 'bottom') {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const sy = e.clientY
  const len0 = minutesOf(st.db, it)
  const s0 = toMin(it.start) ?? GRID.start * 60
  const end0 = s0 + len0
  let s = s0
  let len = len0
  const tip = h('div', { class: 'resizetip tnum' })
  el.append(tip)
  el.classList.add('resizing')
  const show = () => {
    const vs = Math.max(GRID.start * 60, s)
    el.style.top = `${(vs - GRID.start * 60) * GRID.ppm}px`
    el.style.height = `${Math.max(25, s + len - vs) * GRID.ppm - 2}px`
    tip.textContent = `${fromMin(s)}–${fromMin(Math.min(1439, s + len))}, ${hm(len)}`
  }
  show()
  const move = (ev) => {
    ev.preventDefault()
    const dm = (ev.clientY - sy) / GRID.ppm
    if (edge === 'top') {
      s = Math.max(GRID.start * 60, Math.min(end0 - 15, Math.round((s0 + dm) / 15) * 15))
      len = end0 - s
    } else len = Math.max(15, Math.min(GRID.end * 60 - s0, Math.round((len0 + dm) / 15) * 15))
    show()
  }
  const finish = async (keep) => {
    removeEventListener('pointermove', move)
    removeEventListener('pointerup', up)
    removeEventListener('pointercancel', cancel)
    removeEventListener('keydown', esc)
    suppressClick = true
    setTimeout(() => (suppressClick = false), 0)
    tip.remove()
    el.classList.remove('resizing')
    if (!keep || (s === s0 && len === len0)) return render()
    const args = { date, key: it.key, minutes: len, ...(s !== s0 ? { start: fromMin(s) } : {}) }
    try {
      await op('set_slot', args, { quiet: true })
      pushUndo(`resized "${it.title}"`, () => op('set_slot', { date, key: it.key, minutes: len0, ...(s !== s0 ? { start: it.start } : {}) }))
    } catch (err) {
      if (err.code !== 'STALE') toast(err.message)
      render()
    }
  }
  const up = () => finish(true)
  const cancel = () => finish(false)
  const esc = (ev) => ev.key === 'Escape' && finish(false)
  addEventListener('pointermove', move, { passive: false })
  addEventListener('pointerup', up)
  addEventListener('pointercancel', cancel)
  addEventListener('keydown', esc)
}

/** Puts an item at a time; a task from another day moves to this day. */
async function placeAt(d, date, time) {
  try {
    if (d.kind === 'task' && d.date !== date) {
      const t = taskOf(d.ref)
      const was = { date: t.date, end: t.end, start: d.start }
      await op('move_task', { ref: d.ref, date, start: time }, { quiet: true })
      pushUndo(`moved "${t.title}"`, async () => {
        await op('upsert_task', { id: t.id, date: was.date, end: was.end || '' })
        await op('set_slot', { date: was.date, key: d.ref, start: was.start || null })
      })
      toast(`Moved to ${fmt(date, { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}. Ctrl+Z to undo.`)
    } else {
      await op('set_slot', { date, key: d.ref, start: time }, { quiet: true })
      pushUndo('changed a time', () => op('set_slot', { date, key: d.ref, start: d.start || null }))
    }
  } catch (e) {
    if (e.code !== 'STALE') toast(e.message)
  }
}
async function unschedule(d, date) {
  if (!d.start) return
  await op('set_slot', { date, key: d.ref, start: null })
  pushUndo('unscheduled an item', () => op('set_slot', { date, key: d.ref, start: d.start }))
}

/** Lays overlapping items side by side. */
function lanes(list) {
  const items = list.map((x) => ({ ...x })).sort((a, b) => a.s - b.s || b.e - a.e)
  let cluster = []
  let clusterEnd = -1
  const flush = () => {
    const ends = []
    for (const x of cluster) {
      let lane = ends.findIndex((e) => e <= x.s)
      if (lane < 0) lane = ends.push(0) - 1
      ends[lane] = x.e
      x.lane = lane
    }
    for (const x of cluster) x.lanes = ends.length
    cluster = []
  }
  for (const x of items) {
    if (x.s >= clusterEnd && cluster.length) flush()
    cluster.push(x)
    clusterEnd = Math.max(clusterEnd, x.e)
  }
  if (cluster.length) flush()
  return items
}
/** One day's column of the calendar: hour lines, the items at their times, and a drop target that snaps to 15 minutes. */
function timeCol(date, items, { compact = true } = {}) {
  const hgt = (GRID.end - GRID.start) * 60 * GRID.ppm
  const col = h('div', { class: `tcol${date === today() ? ' today' : ''}`, 'data-date': date, style: `height:${hgt}px` })
  for (let hr = GRID.start; hr < GRID.end; hr++) col.append(h('div', { class: 'hline', style: `top:${(hr - GRID.start) * 60 * GRID.ppm}px` }))
  if (date === today()) {
    const n = new Date()
    const m = n.getHours() * 60 + n.getMinutes()
    if (m >= GRID.start * 60 && m < GRID.end * 60) col.append(h('div', { class: 'nowline', style: `top:${(m - GRID.start * 60) * GRID.ppm}px` }))
  }
  const placed = lanes(items.map((it) => ({ it, s: Math.max(GRID.start * 60, toMin(it.start)), e: Math.max(GRID.start * 60, toMin(it.start)) + Math.max(25, minutesOf(st.db, it)) })))
  for (const x of placed) {
    const el = block(x.it, { date, compact, zone: 'grid', inGrid: true })
    el.style.top = `${(x.s - GRID.start * 60) * GRID.ppm}px`
    el.style.height = `${(x.e - x.s) * GRID.ppm - 2}px`
    el.style.left = `calc(${(100 / x.lanes) * x.lane}% + 2px)`
    el.style.width = `calc(${100 / x.lanes}% - 4px)`
    col.append(el)
  }
  // Empty space: double-click makes a 30-minute item there; press and drag sweeps out a range.
  const minuteAt = (y) => {
    const m = GRID.start * 60 + Math.floor((y - col.getBoundingClientRect().top) / GRID.ppm / 15) * 15
    return Math.max(GRID.start * 60, Math.min(GRID.end * 60 - 15, m))
  }
  const empty = (e) => !e.target.closest('.blk, .slotpreview')
  col.addEventListener('dblclick', (e) => {
    if (!empty(e)) return
    const s = minuteAt(e.clientY)
    createAt(date, s, Math.min(GRID.end * 60, s + 30))
  })
  col.addEventListener('pointerdown', (e) => {
    if (!empty(e) || e.button !== 0 || e.pointerType === 'touch') return
    const a = minuteAt(e.clientY)
    let b = a
    let sweep = null
    const move = (ev) => {
      b = minuteAt(ev.clientY)
      if (b === a && !sweep) return
      ev.preventDefault()
      const s = Math.min(a, b)
      const en = Math.max(a, b) + 15
      if (!sweep) col.append((sweep = h('div', { class: 'slotpreview sweep' })))
      sweep.style.top = `${(s - GRID.start * 60) * GRID.ppm}px`
      sweep.style.height = `${(en - s) * GRID.ppm}px`
      sweep.textContent = `${fromMin(s)}–${fromMin(en)}, ${hm(en - s)}`
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      if (!sweep) return
      sweep.remove()
      suppressClick = true
      setTimeout(() => (suppressClick = false), 0)
      createAt(date, Math.min(a, b), Math.max(a, b) + 15)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  })
  return dropZone(col, {
    grid: true,
    accept: (d) => d.kind === 'task' || (d.kind === 'routine' && d.date === date),
    drop: (d, _b, info) => info.time && placeAt(d, date, info.time)
  })
}
// ---- repeating: presets for quick choices, and the full control --------------------------------------------------
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th')
function repeatPresets(date, { none = true } = {}) {
  const d = parse(date)
  return [
    ...(none ? [['', "Doesn't repeat"]] : []),
    ['day', 'Every day'],
    ['weekdays', 'Every weekday, Monday to Friday'],
    ['week', `Every week on ${DAY_LONG[d.getDay()]}`],
    ['month', `Every month on the ${ord(d.getDate())}`],
    ['year', `Every year on ${fmt(date, { month: 'long', day: 'numeric' })}`],
    ['custom', 'Custom']
  ]
}
/** A preset as routine fields: { repeat, days }. */
function presetRule(p, date) {
  const wd = parse(date).getDay()
  if (p === 'day') return { repeat: { every: 'day', interval: 1 }, days: undefined }
  if (p === 'weekdays') return { repeat: { every: 'week', interval: 1 }, days: [1, 2, 3, 4, 5] }
  if (p === 'week') return { repeat: { every: 'week', interval: 1 }, days: [wd] }
  if (p === 'month') return { repeat: { every: 'month', interval: 1 }, days: undefined }
  if (p === 'year') return { repeat: { every: 'year', interval: 1 }, days: undefined }
  return null
}
/** Which preset a routine's rule matches, or 'custom'. */
function presetOf(r, date) {
  const { every, interval } = repeatOf(r)
  if (interval !== 1) return 'custom'
  const days = r.days || [0, 1, 2, 3, 4, 5, 6]
  if (every === 'day' || (every === 'week' && days.length === 7)) return 'day'
  if (every === 'week' && days.join() === '1,2,3,4,5') return 'weekdays'
  if (every === 'week' && days.length === 1 && days[0] === parse(date).getDay()) return 'week'
  if ((every === 'month' || every === 'year') && (r.start || date) === date) return every
  return 'custom'
}
/**
 * The full repeat control, editing x.repeat and x.days in place.
 * x.start anchors monthly and yearly repeats. change() is called after every edit.
 */
function repeatControl(x, change, { none = false, showStart = false } = {}) {
  const anchor = x.start || today()
  const preset = x._custom ? 'custom' : x.repeat === null ? '' : presetOf(x, anchor)
  const r = repeatOf(x)
  const days = x.days || [0, 1, 2, 3, 4, 5, 6]
  const set = (fn) => (fn(x), change())
  return h(
    'div',
    { class: 'repeatctl' },
    h(
      'select',
      {
        class: 'field',
        'aria-label': 'Repeats',
        onchange: (e) =>
          set((y) => {
            const v = e.target.value
            y._custom = v === 'custom'
            if (v === '') y.repeat = null
            else if (v !== 'custom') Object.assign(y, presetRule(v, anchor))
            else y.repeat ||= { every: 'week', interval: 1 }
          })
      },
      repeatPresets(anchor, { none }).map(([v, l]) => h('option', { value: v, selected: v === preset }, l))
    ),
    preset === 'custom'
      ? h(
          'div',
          { class: 'repeatcustom' },
          h('span', {}, 'Every'),
          h('input', { class: 'field num', type: 'number', min: 1, max: 99, value: r.interval, 'aria-label': 'How many', onchange: (e) => set((y) => (y.repeat = { every: r.every, interval: Math.max(1, Math.min(99, +e.target.value || 1)) })) }),
          h('select', { class: 'field', 'aria-label': 'Unit', onchange: (e) => set((y) => (y.repeat = { every: e.target.value, interval: r.interval })) }, ['day', 'week', 'month', 'year'].map((u) => h('option', { value: u, selected: r.every === u }, r.interval === 1 ? u : u + 's'))),
          r.every === 'week'
            ? h('div', { class: 'days' }, [1, 2, 3, 4, 5, 6, 0].map((wd) => h('label', {}, h('input', { type: 'checkbox', checked: days.includes(wd), onchange: (e) => set((y) => (y.days = e.target.checked ? [...new Set([...days, wd])].sort() : days.filter((z) => z !== wd))) }), DOW[wd])))
            : null
        )
      : null,
    x.repeat !== null ? h('div', { class: 'muted small' }, `${repeatLabel({ ...x, start: anchor })}, from ${fmt(anchor, { month: 'short', day: 'numeric', year: 'numeric' })}${x.end ? ` until ${fmt(x.end, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}.`) : null,
    showStart ? null : null
  )
}
/** Turns a task into a routine that repeats by rule; opens the routine afterwards. */
async function makeRepeat(task, rule) {
  const before = new Set(st.db.routines.map((r) => r.id))
  try {
    await op('triage', { ref: 't:' + task.id, action: 'routine', repeat: rule.repeat, days: rule.days }, { quiet: true })
  } catch (e) {
    if (e.code !== 'STALE') toast(e.message)
    return
  }
  const made = st.db.routines.find((r) => !before.has(r.id))
  toast(`"${task.title}" now repeats. It lives in Routines.`)
  closeEditor(true)
  if (made) openEditor('r:' + made.id)
}

/** Makes a task at a time on a day: a short form, then it lands on the calendar. */
async function createAt(date, s, e) {
  const p = periodsFor(date)
  const near = st.db.goals.filter((g) => !CLOSED.has(g.status || 'active') && g.status !== 'proposed' && inArea(g) && ['week', 'month', 'year'].includes(g.horizon) && g.period === p[g.horizon])
  near.sort((a, b) => HORIZONS.indexOf(a.horizon) - HORIZONS.indexOf(b.horizon))
  const v = await formDialog({
    title: `New task, ${fmt(date, { weekday: 'short', month: 'short', day: 'numeric' })} at ${fromMin(s)}`,
    confirm: 'Add',
    values: { minutes: e - s, type: 'action', start: fromMin(s) },
    fields: [
      { name: 'title', label: 'What', placeholder: 'Verb first, e.g. Call the bank about the card' },
      { name: 'start', label: 'Starts', type: 'time', step: 900 },
      { name: 'minutes', label: 'Minutes', type: 'number' },
      { name: 'type', label: 'Type', type: 'select', options: Object.entries(TASK_TYPES).map(([k, t]) => [k, t.label]) },
      { name: 'goalId', label: 'Serves', type: 'select', options: [['', 'Nothing yet'], ...near.map((g) => [g.id, `${periodLabel(g.horizon, g.period)}: ${g.title}`])] },
      { name: 'repeat', label: 'Repeats', type: 'select', options: repeatPresets(date) },
      { name: 'until', label: 'Repeats until (optional)', type: 'date' },
      { name: 'open', label: 'Open the full editor after', type: 'checkbox', default: false }
    ]
  })
  if (!v || v === 'delete') return
  if (!v.title?.trim()) return toast('Give it a name first')
  const g = v.goalId && goal(v.goalId)
  if (v.repeat) {
    // A repeating item is a routine: it fills each matching day on its own.
    const rule = presetRule(v.repeat === 'custom' ? 'week' : v.repeat, date)
    try {
      const r = await op('upsert_routine', { title: v.title.trim(), area: g?.area || st.area || 'life', goalId: v.goalId || '', estimate: Math.max(5, v.minutes || 30), startTime: isTimeStr(v.start) ? v.start : fromMin(s), start: date, end: v.until || '', repeat: rule.repeat, days: rule.days }, { quiet: true })
      pushUndo(`added "${r.title}"`, () => op('delete_routine', { id: r.id }))
      toast(`Added "${r.title}", ${lower1(repeatLabel({ ...rule, start: date }))}. Ctrl+Z to undo.`)
      if (v.open || v.repeat === 'custom') openEditor('r:' + r.id)
    } catch (err) {
      if (err.code !== 'STALE') toast(err.message)
    }
    return
  }
  try {
    const t = await op('upsert_task', { title: v.title.trim(), type: v.type, date, end: date, estimate: Math.max(5, v.minutes || 30), goalId: v.goalId || undefined, area: g?.area || st.area || 'life' }, { silent: true, quiet: true })
    await op('set_slot', { date, key: 't:' + t.id, start: isTimeStr(v.start) ? v.start : fromMin(s) }, { quiet: true })
    pushUndo(`added "${t.title}"`, () => op('delete_task', { id: t.id }))
    toast(`Added "${t.title}". Ctrl+Z to undo.`)
    if (v.open) openEditor('t:' + t.id)
  } catch (err) {
    if (err.code !== 'STALE') toast(err.message)
  }
}
const lower1 = (x) => x.charAt(0).toLowerCase() + x.slice(1)
const isTimeStr = (x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x || '')
function gutter() {
  const g = h('div', { class: 'tgutter', style: `height:${(GRID.end - GRID.start) * 60 * GRID.ppm}px` })
  for (let hr = GRID.start; hr < GRID.end; hr++) g.append(h('div', { class: 'hlabel tnum', style: `top:${(hr - GRID.start) * 60 * GRID.ppm}px` }, `${hr % 12 || 12}${hr < 12 ? 'am' : 'pm'}`))
  return g
}
/** The tray of a day's items with no time yet; dropping a scheduled item here unschedules it. */
function tray(date, items, opts = {}) {
  const z = h('div', { class: `tray zone ${opts.compact ? 'compact' : ''}` }, items.length ? items.map((it) => block(it, { date, compact: opts.compact, zone: 'tray', focus: opts.focus, tools: opts.tools ? opts.tools(it) : null })) : h('div', { class: 'muted traytip' }, opts.compact ? '' : 'Nothing unscheduled. Drag an item here to take it off the clock.'))
  return dropZone(z, {
    ordered: !opts.compact,
    accept: (d) => d.kind === 'task' || d.date === date,
    drop: async (d, before) => {
      if (d.kind === 'task' && d.date !== date) return moveTask(d.ref, date)
      await unschedule(d, date)
      if (!opts.compact && before !== undefined) {
        const keys = insertBefore(items.map((x) => x.key), d.ref, before)
        reorder(date, keys)
      }
    }
  })
}
function weekGrid(plans) {
  const cols = plans.map((p) => ({ p, items: p.items.filter(inArea) }))
  return h(
    'div',
    { class: 'wgrid' },
    h('div', { class: 'wrow whead' }, h('div', { class: 'tgutter-head' }), cols.map(({ p }) => {
      const l = dayLoad(st.db, p.date, p)
      return h(
        'button',
        { class: `wday${p.date === today() ? ' today' : ''}`, onclick: () => go('day', p.date) },
        h('span', { class: 'dnum display tnum' }, +p.date.slice(8)),
        h('span', { class: 'muted' }, fmt(p.date, { weekday: 'short' })),
        h('span', { class: `loadmini ${l.over ? 'over' : ''}` }, h('span', { class: 'loadbar' }, h('i', { style: `width:${Math.min(100, Math.round((l.minutes / (l.capacity || 1)) * 100))}%` })), h('span', { class: 'tnum' }, `${hm(l.minutes)}/${hm(l.capacity)}`))
      )
    })),
    h('div', { class: 'wrow wtray' }, h('div', { class: 'tgutter-head muted' }, 'No time'), cols.map(({ p, items }) => {
      const un = items.filter((it) => !it.start)
      const tasks = un.filter((it) => it.kind === 'task')
      const rts = un.filter((it) => it.kind === 'routine')
      const open = expandedRoutines.has(p.date)
      const t = tray(p.date, [...tasks, ...(open ? rts : [])], { compact: true })
      if (rts.length) t.append(h('button', { class: 'rfold', onclick: () => (open ? expandedRoutines.delete(p.date) : expandedRoutines.add(p.date), render()) }, `${plural(rts.length, 'routine')} with no time${open ? ', hide' : ''}`))
      return t
    })),
    h('div', { class: 'wrow wbody' }, gutter(), cols.map(({ p, items }) => timeCol(p.date, items.filter((it) => it.start))))
  )
}

// ---- references, links and line of sight --------------------------------------------------------------------------
/** A clickable reference to a goal, task, routine or metric: opens its editor. */
function refChip(ref, label, extra = {}) {
  const f = findAnyClient(ref)
  if (!f) return null
  return h(
    'button',
    { class: `refchip ${extra.cls || ''}`, title: 'Open', onclick: (e) => (e.stopPropagation(), openEditor(ref)) },
    dot(f.item.area),
    h('span', {}, label || (f.kind === 'goal' ? `${periodLabel(f.item.horizon, f.item.period)}: ${f.item.title}` : f.item.title || f.item.name))
  )
}
function findAnyClient(ref) {
  const s = String(ref)
  if (s.startsWith('r:')) {
    const r = routineOf(s)
    return r ? { kind: 'routine', item: r, ref: s } : null
  }
  if (s.startsWith('m:')) {
    const m = st.db.metrics.find((x) => 'm:' + x.id === s)
    return m ? { kind: 'metric', item: m, ref: s } : null
  }
  return findItem(st.db, s)
}
/** The goals an item serves, nearest first, up to the life goal. */
function chainOf(ref) {
  const f = findAnyClient(ref)
  if (!f) return []
  const out = []
  const seen = new Set()
  let g = goal(f.kind === 'goal' ? f.item.parentId : f.item.goalId)
  while (g && !seen.has(g.id)) {
    seen.add(g.id)
    out.push(g)
    g = goal(g.parentId)
  }
  return out
}
function chainChips(ref) {
  const c = chainOf(ref)
  if (!c.length && ref.startsWith('g:') && goal(ref.slice(2))?.horizon === 'life') return null
  if (!c.length) return h('span', { class: 'muted' }, 'Not linked to a goal yet. Drag it onto a goal, or choose one below.')
  return h('nav', { class: 'chainchips', 'aria-label': 'Serves' }, [...c].reverse().map((g, i) => [i ? h('span', { class: 'sep', 'aria-hidden': 'true' }, '›') : null, refChip('g:' + g.id)]))
}

/** Line of sight: the goals the day's items actually serve, by horizon, each one clickable and a drop target. */
function lineOfSight(date, items) {
  const selRef = st.sel && st.sel.endsWith('@' + date) ? st.sel.split('@')[0] : null
  const served = new Map()
  for (const it of items) for (const g of chainOf(it.key)) (served.get(g.id) || served.set(g.id, new Set()).get(g.id)).add(it.key)
  const selChain = new Set(selRef ? chainOf(selRef).map((g) => g.id) : [])
  const p = periodsFor(date)
  const label = { week: 'This week', month: fmt(date, { month: 'long' }), year: date.slice(0, 4), decade: `The ${p.decade}s`, life: 'Life' }
  const highlight = (gid, on) => {
    for (const k of served.get(gid) || []) document.querySelectorAll(`.blk[data-ref="${CSS.escape(k)}"][data-date="${date}"]`).forEach((b) => b.classList.toggle('related', on))
  }
  return h(
    'aside',
    { class: 'chain los' },
    sechead('Line of sight', selRef ? 'For the selected item' : 'What today serves'),
    selRef ? h('p', { class: 'muted small' }, 'Click an item to see what it serves; click a goal to open it; drag a task onto a goal to link them.') : h('p', { class: 'muted small' }, 'Select an item to see its chain. Hover a goal to see the items that serve it. Drag a task onto a goal to link them.'),
    HORIZONS.map((hz) => {
      let gs = [...served.keys()].map(goal).filter((g) => g && g.horizon === hz && inArea(g))
      gs.sort((a, b) => (selChain.has(b.id) ? 1 : 0) - (selChain.has(a.id) ? 1 : 0) || served.get(b.id).size - served.get(a.id).size)
      const linked = gs.length
      if (!linked) gs = goalsFor(st.db, hz, p[hz]).filter((g) => !CLOSED.has(g.status || 'active') && inArea(g)).slice(0, 3)
      return h(
        'div',
        { class: 'step' },
        h('button', { class: 'when', onclick: () => go(hz === 'life' ? 'life' : hz, date) }, label[hz], !linked && gs.length ? h('span', { class: 'muted' }, ' (not linked to today)') : null),
        gs.length
          ? gs.map((g) =>
              goalDropTarget(
                h(
                  'button',
                  {
                    class: `losgoal ${selChain.has(g.id) ? 'hit' : ''} ${linked ? '' : 'unlinked'}`,
                    'data-ref': 'g:' + g.id,
                    onclick: () => !suppressClick && openEditor('g:' + g.id),
                    onmouseenter: () => highlight(g.id, true),
                    onmouseleave: () => highlight(g.id, false),
                    onpointerdown: (e) => beginPointerDrag(e, { ref: 'g:' + g.id, kind: 'goal' }, e.currentTarget)
                  },
                  dot(g.area),
                  h('span', { class: 'lt' }, g.title),
                  served.get(g.id) ? h('span', { class: 'muted tnum' }, `${served.get(g.id).size}`) : null
                ),
                g.id
              )
            )
          : h('div', { class: 'muted' }, 'Nothing set')
      )
    })
  )
}

// ---- linking by drag: drop a task, routine or goal onto a goal ---------------------------------------------------
function canServe(d, goalId) {
  const g = goal(goalId)
  if (!g || !d) return false
  if (d.kind === 'task') return taskOf(d.ref)?.goalId !== goalId
  if (d.kind === 'routine') return routineOf(d.ref)?.goalId !== goalId
  if (d.kind === 'goal') {
    const child = goal(d.ref.slice(2))
    if (!child || child.id === goalId || child.parentId === goalId) return false
    if (HORIZONS.indexOf(g.horizon) <= HORIZONS.indexOf(child.horizon)) return false
    return !chainOf('g:' + goalId).some((x) => x.id === child.id)
  }
  return false
}
async function setServes(d, goalId) {
  const g = goal(goalId)
  try {
    if (d.kind === 'task') {
      const t = taskOf(d.ref)
      const was = t.goalId || ''
      await op('upsert_task', { id: t.id, goalId })
      pushUndo(`linked "${t.title}"`, () => op('upsert_task', { id: t.id, goalId: was }))
      toast(`"${t.title}" now serves "${g.title}". Ctrl+Z to undo.`)
    } else if (d.kind === 'routine') {
      const r = routineOf(d.ref)
      const was = r.goalId || ''
      await op('upsert_routine', { id: r.id, goalId })
      pushUndo(`linked "${r.title}"`, () => op('upsert_routine', { id: r.id, goalId: was }))
      toast(`"${r.title}" now serves "${g.title}".`)
    } else if (d.kind === 'goal') {
      const c = goal(d.ref.slice(2))
      const was = c.parentId || ''
      await op('upsert_goal', { id: c.id, parentId: goalId })
      pushUndo(`moved "${c.title}" under another goal`, () => op('upsert_goal', { id: c.id, parentId: was }))
      toast(`"${c.title}" now serves "${g.title}". Ctrl+Z to undo.`)
    }
  } catch (e) {
    if (e.code !== 'STALE') toast(e.message)
  }
}
function goalDropTarget(el, goalId) {
  return dropZone(el, { accept: (d) => canServe(d, goalId), drop: (d) => setServes(d, goalId) })
}
/** A goal as a block: double-click opens it, drag it onto another goal to re-parent, drop work onto it to link. */
function goalBlock(g, opts = {}) {
  const ev = evalItem(st.db, g, 'goal')
  const el = block({ key: 'g:' + g.id, kind: 'goal', title: g.title, area: g.area }, { compact: opts.compact, zone: 'goals' })
  const crit = (g.criteria || []).map((c) => c.text).filter(Boolean).join('. ')
  el.querySelector('.chips').append(
    h('span', { class: 'chip' }, CLOSED.has(g.status) ? STATUS_LABELS[g.status] : `${ev.progress}%`),
    crit && !opts.compact ? h('span', { class: 'chip faint', title: crit }, `Done when: ${crit.length > 70 ? crit.slice(0, 68) + '…' : crit}`) : null,
    qualityBadge(st.db, g, 'goal')
  )
  if (!CLOSED.has(g.status)) el.append(h('span', { class: 'bar', title: `${ev.progress}%` }, h('i', { style: `width:${ev.progress}%` })))
  return goalDropTarget(el, g.id)
}

// ---- the routine editor ------------------------------------------------------------------------------------------
function viewRoutineEditor(ref) {
  const r = routineOf(ref)
  if (!r) return { title: 'Routine', body: h('div', { class: 'empty' }, 'This routine no longer exists.') }
  if (draftRef !== ref || !draftDirty) {
    draft = JSON.parse(JSON.stringify(r))
    draftRef = ref
    draftDirty = false
  }
  const d = draft
  const field = (key, attrs = {}) => h('input', { class: 'field', value: d[key] ?? '', oninput: (e) => ((d[key] = attrs.type === 'number' ? (e.target.value === '' ? undefined : +e.target.value) : e.target.value), (draftDirty = true)), ...attrs })
  // The last four weeks.
  let sched = 0
  let got = 0
  const strip = []
  for (let i = 27; i >= 0; i--) {
    const dt = addDays(today(), -i)
    const it = dayPlan(st.db, dt).items.find((x) => x.key === ref)
    if (!it) {
      strip.push(h('i', { class: 'off', title: fmt(dt, { month: 'short', day: 'numeric' }) }))
      continue
    }
    sched++
    got += it.status === 'done' ? 1 : it.status === 'partial' ? 0.5 : 0
    strip.push(h('i', { class: it.status, title: `${fmt(dt, { month: 'short', day: 'numeric' })}: ${it.status}` }))
  }
  const save = async () => {
    await op('upsert_routine', { id: r.id, title: d.title, target: d.target, criterion: d.criterion, estimate: d.estimate ?? '', startTime: d.startTime || '', days: d.days, repeat: d.repeat ? repeatOf(d) : null, time: d.time || '', start: d.start || '', end: d.end || '', area: d.area, goalId: d.goalId || '', detail: d.detail, active: d.active !== false })
    draftDirty = false
    toast('Saved')
  }
  const habitGoals = [['', 'None'], ...st.db.goals.filter((g) => !CLOSED.has(g.status || 'active')).sort((a, b) => (a.type === 'habit' ? -1 : 0) - (b.type === 'habit' ? -1 : 0)).map((g) => [g.id, `${g.type === 'habit' ? 'Habit. ' : ''}${periodLabel(g.horizon, g.period)}: ${g.title}`])]
  return {
    title: 'Routine',
    meta: `${d.active === false ? 'Paused' : 'Active'}, ${lower1(repeatLabel(d))}`,
    body: h(
      'div',
      { class: 'item-page' },
      chainChips(ref),
      h('input', { class: 'item-title display', value: d.title, 'aria-label': 'Title', oninput: (e) => ((d.title = e.target.value), (draftDirty = true)) }),
      h(
        'div',
        { class: 'item-bar' },
        h('span', { class: 'badge' }, `${sched ? Math.round((got / sched) * 100) : 0}% of the last ${plural(sched, 'session')}`),
        h('span', { class: 'rstrip', 'aria-label': 'Last four weeks' }, strip),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn primary', onclick: save }, 'Save'),
        h('button', { class: 'btn', onclick: async () => (await op('upsert_routine', { id: r.id, active: r.active === false }), toast(r.active === false ? 'Resumed' : 'Paused')) }, r.active === false ? 'Resume' : 'Pause'),
        h('button', { class: 'btn ghost', onclick: async () => (await op('upsert_routine', { id: r.id, end: addDays(today(), -1) }), toast('Ended. It stays in past days.')) }, 'End it')
      ),
      h(
        'div',
        { class: 'form item-grid' },
        h('label', {}, 'Amount'),
        field('target', { placeholder: 'e.g. 45 min' }),
        h('label', {}, 'Minutes'),
        field('estimate', { type: 'number', min: 0 }),
        h('label', {}, 'Usual start'),
        field('startTime', { type: 'time', step: 900 }),
        h('label', {}, 'A session passes when'),
        field('criterion', { placeholder: 'Checkable, e.g. one section at 80%' }),
        h('label', {}, 'When'),
        h('select', { class: 'field', onchange: (e) => ((d.time = e.target.value), (draftDirty = true)) }, [['', 'Any time'], ['am', 'Morning'], ['pm', 'Evening']].map(([v, l]) => h('option', { value: v, selected: (d.time || '') === v }, l))),
        h('label', {}, 'Repeats'),
        repeatControl(d, () => ((draftDirty = true), render())),
        h('label', {}, 'Area'),
        h('select', { class: 'field', onchange: (e) => ((d.area = e.target.value), (draftDirty = true)) }, areaOptions().map(([v, l]) => h('option', { value: v, selected: d.area === v }, l))),
        h('label', {}, 'Starts'),
        field('start', { type: 'date' }),
        h('label', {}, 'Ends'),
        field('end', { type: 'date' }),
        h('label', {}, 'Serves'),
        h('select', { class: 'field', onchange: (e) => setDraft((x) => (x.goalId = e.target.value)) }, habitGoals.map(([v, l]) => h('option', { value: v, selected: (d.goalId || '') === v }, l)))
      ),
      h('section', { class: 'isec' }, h('div', { class: 'isec-head' }, h('h3', { class: 'display' }, 'Notes')), h('textarea', { class: 'field', rows: 4, value: d.detail || '', oninput: (e) => ((d.detail = e.target.value), (draftDirty = true)) })),
      lintRoutine(st.db, d).length ? h('section', { class: 'isec' }, h('div', { class: 'isec-head' }, h('h3', { class: 'display' }, 'Checks')), h('ul', { class: 'issues' }, lintRoutine(st.db, d).map((i) => h('li', { class: i.level }, i.msg)))) : null,
      h('div', { class: 'add' }, h('button', { class: 'btn danger', onclick: async () => { if (await formDialog({ title: `Delete "${r.title}" and its place in past days? Ending it keeps the history.`, fields: [], confirm: 'Delete' })) { await op('delete_routine', { id: r.id }); closeEditor(true) } } }, 'Delete'))
    )
  }
}

// ---- the metric editor -------------------------------------------------------------------------------------------
function viewMetricEditor(ref) {
  const m = st.db.metrics.find((x) => 'm:' + x.id === ref)
  if (!m) return { title: 'Metric', body: h('div', { class: 'empty' }, 'This metric no longer exists.') }
  if (draftRef !== ref || !draftDirty) {
    draft = JSON.parse(JSON.stringify(m))
    draftRef = ref
    draftDirty = false
  }
  const d = draft
  const field = (key, attrs = {}) => h('input', { class: 'field', value: d[key] ?? '', oninput: (e) => ((d[key] = attrs.type === 'number' ? (e.target.value === '' ? undefined : +e.target.value) : e.target.value), (draftDirty = true)), ...attrs })
  const entries = [...(m.entries || [])].sort((a, b) => b.date.localeCompare(a.date))
  const newDate = h('input', { class: 'field', type: 'date', value: today(), 'aria-label': 'Reading date' })
  const newVal = h('input', { class: 'field num tnum', type: 'number', step: 'any', placeholder: 'Value', 'aria-label': 'Reading value' })
  const usedBy = [...st.db.goals, ...st.db.tasks].filter((x) => (x.criteria || []).some((c) => c.metricId === m.id))
  return {
    title: 'Metric',
    meta: CADENCE_LABELS[m.cadence || 'asNeeded'],
    body: h(
      'div',
      { class: 'item-page' },
      h('input', { class: 'item-title display', value: d.name, 'aria-label': 'Name', oninput: (e) => ((d.name = e.target.value), (draftDirty = true)) }),
      h('div', { class: 'item-bar' }, h('span', { class: 'v display tnum' }, entries[0] ? `${num(entries[0].value)} ${m.unit || ''}` : 'No readings'), entries[0] ? h('span', { class: 'muted' }, `on ${fmt(entries[0].date, { month: 'short', day: 'numeric', year: 'numeric' })}`) : null, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: async () => (await op('upsert_metric', { id: m.id, name: d.name, unit: d.unit, area: d.area, target: d.target, targetDate: d.targetDate, cadence: d.cadence || 'asNeeded' }), (draftDirty = false), toast('Saved')) }, 'Save')),
      spark(m),
      h(
        'div',
        { class: 'form item-grid' },
        h('label', {}, 'Unit'),
        field('unit'),
        h('label', {}, 'Ask for it'),
        h('select', { class: 'field', onchange: (e) => ((d.cadence = e.target.value), (draftDirty = true)) }, CADENCES.map((c) => h('option', { value: c, selected: (d.cadence || 'asNeeded') === c }, CADENCE_LABELS[c]))),
        h('label', {}, 'Target'),
        field('target', { type: 'number', step: 'any' }),
        h('label', {}, 'By'),
        field('targetDate', { type: 'date' }),
        h('label', {}, 'Area'),
        h('select', { class: 'field', onchange: (e) => ((d.area = e.target.value), (draftDirty = true)) }, areaOptions().map(([v, l]) => h('option', { value: v, selected: d.area === v }, l)))
      ),
      usedBy.length ? h('section', { class: 'isec' }, h('div', { class: 'isec-head' }, h('h3', { class: 'display' }, 'Used by'), h('span', { class: 'muted' }, 'Acceptance criteria that read this metric')), h('div', { class: 'refs' }, usedBy.map((x) => refChip((x.horizon ? 'g:' : 't:') + x.id)))) : null,
      h(
        'section',
        { class: 'isec' },
        h('div', { class: 'isec-head' }, h('h3', { class: 'display' }, 'Readings'), h('span', { class: 'muted' }, plural(entries.length, 'reading'))),
        h('form', { class: 'add', onsubmit: async (e) => (e.preventDefault(), newVal.value !== '' && (await op('log_metric', { id: m.id, date: newDate.value, value: +newVal.value }), toast('Logged'))) }, newDate, newVal, h('button', { class: 'btn' }, 'Add reading')),
        h(
          'table',
          {},
          h(
            'tbody',
            {},
            entries.map((e) =>
              h(
                'tr',
                {},
                h('td', { class: 'tnum' }, fmt(e.date, { month: 'short', day: 'numeric', year: 'numeric' })),
                h('td', {}, h('input', { class: 'field num tnum', type: 'number', step: 'any', value: e.value, 'aria-label': `Reading on ${e.date}`, onchange: (ev) => ev.target.value !== '' && op('log_metric', { id: m.id, date: e.date, value: +ev.target.value }) })),
                h('td', {}, h('button', { class: 'icon-btn', 'aria-label': `Delete the reading on ${e.date}`, onclick: () => op('delete_reading', { id: m.id, date: e.date }) }, icon('x')))
              )
            )
          )
        )
      ),
      h('div', { class: 'add' }, h('button', { class: 'btn danger', onclick: async () => { if (await formDialog({ title: `Delete "${m.name}" and all ${plural(entries.length, 'reading')}?`, fields: [], confirm: 'Delete' })) { await op('delete_metric', { id: m.id }); closeEditor(true) } } }, 'Delete metric'))
    )
  }
}

// ---- health: the Garmin watch, read from the Garmin Sync app on this machine --------------------------------------
const health = { status: null, dash: null, loadedAt: 0, dashAt: 0, busy: false, timer: null, syncing: false }
const SVGNS = 'http://www.w3.org/2000/svg'
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(SVGNS, tag)
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v)
  return e
}
const clock = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const shortDay = (d) => fmt(d, { month: 'short', day: 'numeric' })

/** Fetches Garmin Sync's state through Arc. The full dashboard is reloaded at most every two minutes unless forced. */
async function loadHealth({ force = false } = {}) {
  if (health.busy) return
  health.busy = true
  try {
    const get = (p) => fetch(p).then((r) => (r.ok ? r.json() : { offline: true, error: `Arc answered ${r.status}` })).catch(() => ({ offline: true, error: 'Arc did not answer' }))
    const wantDash = force || !health.dash || health.dash.offline || Date.now() - health.dashAt > 120000
    const [s, d] = await Promise.all([get('/api/health/status'), wantDash ? get('/api/health/dashboard') : null])
    health.status = s
    if (d) {
      health.dash = d
      health.dashAt = Date.now()
    }
    health.loadedAt = Date.now()
  } finally {
    health.busy = false
  }
  if (st.view === 'health' && !document.querySelector('dialog[open]')) render()
}
/** While the Health page is open, readings refresh every 15 seconds. */
function watchHealth() {
  if (health.timer) return
  health.timer = setInterval(() => {
    if (st.view !== 'health') {
      clearInterval(health.timer)
      health.timer = null
      return
    }
    if (!document.hidden) loadHealth()
  }, 15000)
}
async function syncHealth() {
  health.syncing = true
  render()
  const r = await fetch('/api/health/sync', { method: 'POST' })
    .then((x) => x.json())
    .catch(() => ({ offline: true }))
  toast(r.offline ? 'Garmin Sync is not running.' : 'Asked the watch for new files. New data shows here as it arrives.')
  setTimeout(async () => {
    health.syncing = false
    await loadHealth({ force: true })
  }, 4000)
}

/**
 * A small chart. series: [{ x, y, lo?, hi? }] with x in [x0, x1]. kind: 'line' (gaps over maxGap break the line),
 * 'bars', or 'step' (sleep stages). A readout follows the pointer.
 */
function hchart({ label, unit = '', series, x0, x1, kind = 'line', yMin, yMax, goal, maxGap = Infinity, ticks = [], fmtX, fmtY = (v) => num(Math.round(v)), yLabels, height = 120 }) {
  const W = 600
  const H = height
  const pad = 6
  const ys = series.flatMap((p) => [p.y, p.lo, p.hi]).filter((v) => v != null).concat(goal != null ? [goal] : [])
  let lo = yMin ?? Math.min(...ys)
  let hi = yMax ?? Math.max(...ys)
  if (lo === hi) (lo -= 1), (hi += 1)
  const X = (x) => ((x - x0) / (x1 - x0 || 1)) * W
  const Y = (y) => H - pad - ((y - lo) / (hi - lo)) * (H - pad * 2)
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'hsvg', role: 'img', 'aria-label': label })
  if (goal != null) svg.append(svgEl('line', { class: 'c-goal', x1: 0, x2: W, y1: Y(goal), y2: Y(goal) }))
  if (kind === 'bars') {
    const bw = Math.max(2, (W / Math.max(1, x1 - x0 + 1)) * 0.7)
    for (const p of series) svg.append(svgEl('rect', { class: 'c-bar', x: X(p.x) - bw / 2, y: Y(p.y), width: bw, height: Math.max(1, H - pad - Y(p.y)) }))
  } else {
    // Range bands (low to high), then the line in runs split at gaps.
    const banded = series.filter((p) => p.lo != null && p.hi != null)
    if (banded.length > 1) svg.append(svgEl('polygon', { class: 'c-band', points: [...banded.map((p) => `${X(p.x)},${Y(p.hi)}`), ...[...banded].reverse().map((p) => `${X(p.x)},${Y(p.lo)}`)].join(' ') }))
    let run = []
    const flush = () => {
      if (run.length > 1) svg.append(svgEl('polyline', { class: 'c-line', points: run.join(' ') }))
      else if (run.length === 1) {
        const [x, y] = run[0].split(',')
        svg.append(svgEl('line', { class: 'c-pt', x1: x, x2: x, y1: y, y2: y }))
      }
      run = []
    }
    let prev = null
    for (const p of series) {
      if (prev && p.x - prev.x > maxGap) flush()
      if (kind === 'step' && prev && run.length) run.push(`${X(p.x)},${Y(prev.y)}`)
      run.push(`${X(p.x)},${Y(p.y)}`)
      prev = p
    }
    flush()
  }
  const cursor = svgEl('line', { class: 'c-cursor', x1: -10, x2: -10, y1: 0, y2: H })
  svg.append(cursor)
  const readout = h('span', { class: 'hread tnum muted' }, '')
  const last = series.at(-1)
  const idle = last ? `${fmtY(last.y)}${unit ? ' ' + unit : ''}${fmtX ? `, ${fmtX(last.x)}` : ''}` : ''
  readout.textContent = idle
  const plot = h('div', { class: 'hplot' }, svg, yLabels ? h('div', { class: 'hy tnum' }, yLabels.map(([v, t]) => h('span', { style: `top:${(Y(v) / H) * 100}%` }, t))) : h('div', { class: 'hy tnum' }, h('span', { style: 'top:0' }, fmtY(hi)), h('span', { style: 'top:100%' }, fmtY(lo))))
  plot.addEventListener('pointermove', (e) => {
    if (!series.length) return
    const r = plot.getBoundingClientRect()
    const x = x0 + ((e.clientX - r.left) / r.width) * (x1 - x0)
    let best = series[0]
    for (const p of series) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p
    cursor.setAttribute('x1', X(best.x))
    cursor.setAttribute('x2', X(best.x))
    readout.textContent = `${best.label || fmtY(best.y) + (unit ? ' ' + unit : '')}${best.lo != null ? ` (${fmtY(best.lo)}–${fmtY(best.hi)})` : ''}${fmtX ? `, ${fmtX(best.x)}` : ''}`
  })
  plot.addEventListener('pointerleave', () => {
    cursor.setAttribute('x1', -10)
    cursor.setAttribute('x2', -10)
    readout.textContent = idle
  })
  return h(
    'div',
    { class: 'hchart' },
    h('div', { class: 'hhead' }, h('span', { class: 'hname' }, label), readout),
    plot,
    ticks.length ? h('div', { class: 'hx tnum muted' }, ticks.map(([x, t]) => h('span', { style: `left:${(X(x) / W) * 100}%` }, t))) : null
  )
}

const stressWord = (v) => (v == null ? '' : v <= 25 ? 'resting' : v <= 50 ? 'low' : v <= 75 ? 'medium' : 'high')
function healthNow(L) {
  const v = (k) => L[k]?.value
  const cell = (label, value, unitOrSub, goal) =>
    value == null
      ? null
      : h(
          'div',
          { class: 'hnow' },
          h('div', { class: 'muted' }, label),
          h('div', {}, h('span', { class: 'v display tnum' }, typeof value === 'number' ? num(Math.round(value)) : value), unitOrSub ? h('span', { class: 'muted' }, ' ' + unitOrSub) : null),
          goal ? h('div', { class: 'meter', title: `${Math.round((value / goal) * 100)}% of ${num(goal)}` }, h('i', { style: `width:${Math.min(100, (value / goal) * 100)}%` })) : null
        )
  return h(
    'div',
    { class: 'hnowgrid' },
    cell('Heart rate', v('hr'), 'bpm'),
    cell('Resting heart rate', v('resting_hr'), 'bpm'),
    cell('Stress', v('stress'), stressWord(v('stress'))),
    cell('Body battery', v('body_battery'), 'of 100', 100),
    cell('Steps', v('steps'), v('steps_goal') ? `of ${num(v('steps_goal'))}` : '', v('steps_goal')),
    cell('Intensity minutes', v('intensity_minutes'), v('intensity_goal') ? `of ${num(v('intensity_goal'))} this week` : 'this week', v('intensity_goal')),
    cell('Floors climbed', v('floors_up'), v('floors_goal') ? `of ${v('floors_goal')}` : '', v('floors_goal')),
    cell('SpO2', v('spo2'), '%'),
    cell('Respiration', v('respiration'), 'breaths/min'),
    cell('Calories', v('calories'), v('active_calories') != null ? `${num(v('active_calories'))} active` : '')
  )
}

function viewHealth() {
  watchHealth()
  if (!health.loadedAt && !health.busy) loadHealth({ force: true })
  const s = health.status
  const d = health.dash
  const title = 'Health'
  if (!s && !d) return { title, meta: 'From your Garmin watch', body: h('div', { class: 'empty' }, 'Reading Garmin Sync…') }
  if (s?.offline && (!d || d.offline))
    return {
      title,
      meta: 'From your Garmin watch',
      body: h(
        'div',
        { class: 'hoffline' },
        h('h2', { class: 'display' }, 'Garmin Sync is not running'),
        h('p', { class: 'muted' }, `Arc shows your watch's data by reading the Garmin Sync app on this computer${s.source ? ` at ${s.source}` : ''}. Start Garmin Sync and this page fills in by itself.`),
        h('button', { class: 'btn', onclick: () => loadHealth({ force: true }) }, 'Try again')
      )
    }
  const L = s?.latest || d?.latest || {}
  const name = s?.device?.name || d?.device?.name || 'your watch'
  const state = s?.offline
    ? { ok: false, text: 'Garmin Sync is not answering; showing what it last sent.' }
    : s?.syncing || health.syncing
      ? { ok: true, text: `Syncing with ${name}${s?.detail ? `: ${s.detail}` : ''}` }
      : s?.connected
        ? { ok: true, text: `Connected to ${name}${s.last_sync ? `. Files checked ${clock(s.last_sync)}` : ''}` }
        : s?.status === 'waiting'
          ? { ok: false, text: `${name} is out of reach. Garmin Sync keeps listening; turning on Broadcast Heart Rate on the watch for a few seconds reconnects it.` }
          : { ok: false, text: `Not connected to ${name}${s?.last_error ? `: ${s.last_error}` : ''}` }
  const latestAt = Object.values(L)
    .map((x) => x?.ts)
    .filter(Boolean)
    .sort()
    .at(-1)

  // Last 24 hours.
  const now = Date.now()
  const from = now - 864e5
  const ticks24 = Array.from({ length: 5 }, (_, i) => {
    const t = from + (i * 864e5) / 4
    return [t, new Date(t).toLocaleTimeString('en-US', { hour: 'numeric' })]
  })
  const series = (pts) => (pts || []).map((p) => ({ x: Date.parse(p.t), y: p.v })).filter((p) => p.x >= from && p.y != null)
  const today24 = [
    ['Heart rate', 'bpm', series(d?.today?.hr), {}],
    ['Stress', '', series(d?.today?.stress).filter((p) => p.y >= 0), { yMin: 0, yMax: 100 }],
    ['Body battery', '', series(d?.today?.body_battery), { yMin: 0, yMax: 100 }]
  ].filter(([, , pts]) => pts.length)

  // Last 30 days, by local day.
  const end = today()
  const start = addDays(end, -29)
  const idx = (day) => daysBetween(start, day)
  const daily = (rows, f = (r) => ({ y: r.v })) => (rows || []).filter((r) => r.d >= start && r.d <= end && r.v != null).map((r) => ({ x: idx(r.d), ...f(r), day: r.d }))
  const dayTicks = [0, 7, 14, 21, 29].map((i) => [i, shortDay(addDays(start, i))])
  const fmtDay = (i) => fmt(addDays(start, Math.round(i)), { weekday: 'short', month: 'short', day: 'numeric' })
  const D = d?.daily || {}
  const trends = [
    ['Heart rate, daily average and range', 'bpm', daily(D.hr, (r) => ({ y: r.v, lo: r.lo, hi: r.hi })), {}],
    ['Steps', '', daily(D.steps), { kind: 'bars', yMin: 0, goal: L.steps_goal?.value }],
    ['Stress, daily average', '', daily(D.stress), { yMin: 0, yMax: 100 }],
    ['Body battery, daily range', '', daily(D.battery, (r) => ({ y: r.v, lo: r.lo, hi: r.hi })), { yMin: 0, yMax: 100 }],
    ['HRV, nightly average', 'ms', daily(D.hrv), {}]
  ].filter(([, , pts]) => pts.length)

  // Sleep.
  const sl = d?.sleep
  const stages = { 0: 'Deep', 1: 'Light', 2: 'REM', 3: 'Awake' }
  const sleepPts = (sl?.points || []).map((p) => ({ x: Date.parse(p.t), y: p.v, label: p.label }))
  const tot = sl?.totals

  // Activities.
  const acts = d?.activities || []
  const dur = (sec) => (sec == null ? '' : hm(Math.round(sec / 60)))
  const sport = (a) => {
    const s1 = String(a.sport || 'activity').replace(/_/g, ' ')
    const s2 = a.sub_sport && a.sub_sport !== 'generic' ? String(a.sub_sport).replace(/_/g, ' ') : ''
    return (s2 ? `${s1}, ${s2}` : s1).replace(/^./, (c) => c.toUpperCase())
  }

  return {
    title,
    meta: `From ${name}, through Garmin Sync`,
    body: h(
      'div',
      { class: 'health' },
      h(
        'div',
        { class: 'hstatus' },
        h('span', { class: `hdot ${state.ok ? 'on' : ''}` }),
        h('span', { class: 'hstate' }, state.text),
        h('span', { class: 'spacer' }),
        s?.source ? h('a', { class: 'btn ghost', href: s.source, target: '_blank', rel: 'noopener' }, 'Open Garmin Sync') : null,
        h('button', { class: 'btn primary', disabled: !!(s?.offline || health.syncing || s?.syncing), onclick: syncHealth }, health.syncing || s?.syncing ? 'Syncing…' : 'Sync now')
      ),
      sechead('Right now', latestAt ? `As of ${clock(latestAt)}` : ''),
      Object.keys(L).length ? healthNow(L) : h('div', { class: 'empty' }, 'No live readings yet. They arrive while the watch is connected.'),
      sechead('Last 24 hours', ''),
      today24.length
        ? h('div', { class: 'hcharts' }, today24.map(([label, unit, pts, o]) => hchart({ label, unit, series: pts, x0: from, x1: now, maxGap: 20 * 60000, ticks: ticks24, fmtX: clock, ...o })))
        : h('div', { class: 'empty' }, 'Nothing recorded in the last 24 hours.'),
      sechead('Last 30 days', `${shortDay(start)} to ${shortDay(end)}`),
      trends.length
        ? h('div', { class: 'hcharts' }, trends.map(([label, unit, pts, o]) => hchart({ label, unit, series: pts, x0: 0, x1: 29, ticks: dayTicks, fmtX: fmtDay, maxGap: 1, ...o })))
        : h('div', { class: 'empty' }, 'No daily data yet.'),
      sechead('Sleep', sl?.day ? `Night ending ${fmt(sl.day, { weekday: 'short', month: 'short', day: 'numeric' })}` : ''),
      sleepPts.length > 1
        ? h(
            'div',
            {},
            tot?.asleep ? h('p', { class: 'hsleep' }, h('span', { class: 'display tnum' }, hm(tot.asleep)), h('span', { class: 'muted' }, ` asleep, ${clock(tot.start)} to ${clock(tot.end)}. Deep ${hm(tot.deep)}, light ${hm(tot.light)}, REM ${hm(tot.rem)}, awake ${hm(tot.awake)}.`)) : null,
            hchart({ label: 'Stages', series: sleepPts, x0: sleepPts[0].x, x1: sleepPts.at(-1).x, kind: 'step', yMin: 0, yMax: 3, fmtX: clock, fmtY: (v) => stages[Math.round(v)] || '', yLabels: [[3, 'Awake'], [2, 'REM'], [1, 'Light'], [0, 'Deep']], height: 100, ticks: [[sleepPts[0].x, clock(sleepPts[0].x)], [sleepPts.at(-1).x, clock(sleepPts.at(-1).x)]] })
          )
        : h('div', { class: 'empty' }, 'No sleep synced yet. Sleep reaches this computer when Garmin Sync downloads it from the watch before your phone does.'),
      sechead('Activities', acts.length ? plural(acts.length, 'activity').replace('activitys', 'activities') : ''),
      acts.length
        ? h(
            'div',
            { class: 'hscroll' },
            h(
              'table',
              { class: 'htable' },
              h('thead', {}, h('tr', {}, ['When', 'Activity', 'Time', 'Distance', 'Avg HR', 'Max HR', 'Ascent', 'Calories', 'Aerobic TE'].map((c) => h('th', {}, c)))),
              h(
                'tbody',
                {},
                acts.slice(0, 50).map((a) =>
                  h(
                    'tr',
                    {},
                    h('td', { class: 'tnum' }, new Date(a.start_time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
                    h('td', {}, sport(a)),
                    h('td', { class: 'tnum' }, dur(a.elapsed_s)),
                    h('td', { class: 'tnum' }, a.distance_m ? `${(a.distance_m / 1000).toFixed(2)} km` : ''),
                    h('td', { class: 'tnum' }, a.avg_hr ?? ''),
                    h('td', { class: 'tnum' }, a.max_hr ?? ''),
                    h('td', { class: 'tnum' }, a.ascent_m ? `${Math.round(a.ascent_m)} m` : ''),
                    h('td', { class: 'tnum' }, a.calories ?? ''),
                    h('td', { class: 'tnum' }, a.aerobic_te != null ? (+a.aerobic_te).toFixed(1) : '')
                  )
                )
              )
            )
          )
        : h('div', { class: 'empty' }, 'No activities synced yet.'),
      s?.log?.length
        ? h('details', { class: 'hlog' }, h('summary', { class: 'muted' }, `Watch: ${name}${s.device?.firmware ? `, firmware ${s.device.firmware}` : ''}. Recent activity`), h('pre', { class: 'tnum' }, s.log.slice(-12).join('\n')))
        : null
    )
  }
}

const VIEW = { inbox: viewInbox, board: viewBoard, item: viewItem, history: viewHistory, day: viewDay, week: viewWeek, month: viewMonth, year: viewYear, decade: viewDecade, life: viewLife, routines: viewRoutines, metrics: viewMetrics, review: viewReview, settings: viewSettings, health: viewHealth }

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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      return undo()
    }
    if (e.altKey || document.activeElement?.classList.contains('blk')) return
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
      item('health', 'Health', 'heart'),
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
  if (editor) renderEditor()
  if (keepFocus && st.sel) {
    keepFocus = false
    const [ref, date] = st.sel.split('@')
    document.querySelector(`.blk[data-ref="${CSS.escape(ref)}"][data-date="${date}"]`)?.focus()
  }
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
