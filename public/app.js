import { today, addDays, addMonths, parse, ymd, pad, isoWeek, weekStart, weekDays, daysInMonth, daysBetween, decadeOf, periodsFor, ageOn, dayPlan, goalsFor, periodLabel, HORIZONS } from './shared.js'

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
const VIEWS = ['day', 'week', 'month', 'year', 'decade', 'life', 'routines', 'metrics', 'review', 'settings']
const st = { db: null, view: 'day', date: today(), area: null }
let pendingRender = false

function readHash() {
  const [v, d] = location.hash.slice(1).split('/')
  if (VIEWS.includes(v)) st.view = v
  if (/^\d{4}-\d{2}-\d{2}$/.test(d || '')) st.date = d
}
function go(view, date) {
  st.view = view
  if (date) st.date = date
  history.replaceState(null, '', `#${st.view}/${st.date}`)
  render(true)
}

async function loadState() {
  st.db = await (await fetch('/api/state')).json()
}
async function op(name, args, { silent } = {}) {
  const r = await fetch('/api/op', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: name, args }) })
  const out = await r.json()
  if (!r.ok) {
    toast(out.error || 'Something went wrong')
    throw new Error(out.error)
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
      { name: 'detail', label: 'Notes', type: 'textarea' },
      { name: 'area', label: 'Area', type: 'select', options: areaOptions() },
      { name: 'days', label: 'Days', type: 'days' },
      { name: 'time', label: 'When', type: 'select', options: [['', 'Any time'], ['am', 'Morning'], ['pm', 'Evening']] },
      { name: 'start', label: 'Starts', type: 'date' },
      { name: 'end', label: 'Ends', type: 'date' },
      { name: 'goalId', label: 'Serves', type: 'select', options: goalOptions() },
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
  const rank = { active: 0, done: 1, dropped: 2 }
  goals.sort((a, b) => rank[a.status || 'active'] - rank[b.status || 'active'])
  return h(
    'div',
    {},
    goals.length
      ? h(
          'div',
          { class: 'rows' },
          goals.map((g) => {
            const parent = g.parentId && goal(g.parentId)
            return h(
              'button',
              { class: `goal ${g.status || 'active'}`, onclick: () => editGoal(g) },
              dot(g.area),
              h('span', {}, h('div', { class: 'title' }, g.title), (g.measure || parent) && h('div', { class: 'sub' }, g.measure, g.measure && parent ? '. ' : '', parent && `Serves: ${parent.title}`)),
              g.status === 'done' ? h('span', { class: 'muted' }, 'Done') : g.status === 'dropped' ? h('span', { class: 'muted' }, 'Dropped') : h('span', { class: 'bar', title: `${g.progress || 0}%` }, h('i', { style: `width:${g.progress || 0}%` }))
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
    const cycle = () => op('set_item_status', { date: d, key: it.key, status: it.status === 'done' ? 'todo' : 'done' })
    const g = it.goalId && goal(it.goalId)
    const open = () => (it.kind === 'task' ? editTask(st.db.tasks.find((t) => 't:' + t.id === it.key)) : editRoutine(st.db.routines.find((r) => 'r:' + r.id === it.key)))
    return h(
      'div',
      { class: `row ${it.status}` },
      h('button', { class: `mark ${it.status}`, onclick: cycle, 'aria-label': `${it.status === 'done' ? 'Unmark' : 'Mark done'}: ${it.title}`, 'aria-pressed': String(it.status === 'done') }, it.status === 'done' ? icon('check') : it.status === 'skipped' ? icon('x') : null),
      h(
        'div',
        {},
        h('button', { class: 'title', onclick: open, title: 'Edit' }, it.title),
        h('div', { class: 'sub' }, dot(it.area), area(it.area).name, it.target && h('span', { class: 'tnum' }, it.target), it.time && (it.time === 'am' ? 'Morning' : 'Evening'), g && h('span', {}, `For: ${g.title}`)),
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
      sechead('Claude connection'),
      h('p', { class: 'lede' }, 'Claude reads and updates this plan through MCP. With the dashboard running, the endpoint is:'),
      h('p', {}, h('code', {}, url)),
      h('p', { class: 'muted' }, 'To add it to Claude Code, run this once in a terminal:'),
      h('pre', {}, `claude mcp add --transport http --scope user arc ${url}`),
      
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
  const r = await fetch('/api/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: await file.text() })
  const out = await r.json()
  if (!r.ok) return toast(out.error || 'Import failed')
  await loadState()
  render(true)
  toast('Plan imported. The previous plan is in the backups folder.')
}

const VIEW = { day: viewDay, week: viewWeek, month: viewMonth, year: viewYear, decade: viewDecade, life: viewLife, routines: viewRoutines, metrics: viewMetrics, review: viewReview, settings: viewSettings }

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
    for (const g of st.db.goals) if (hit(g.title, g.detail, g.measure)) out.push({ area: g.area, text: g.title, sub: `Goal, ${periodLabel(g.horizon, g.period)}`, go: () => go(g.horizon, periodDate(g.horizon, g.period)) })
    for (const r of st.db.routines) if (hit(r.title, r.target, r.detail)) out.push({ area: r.area, text: r.title, sub: 'Routine', go: () => go('routines') })
    for (const t of st.db.tasks) if (hit(t.title, t.detail)) out.push({ area: t.area, text: t.title, sub: fmt(t.date, { month: 'short', day: 'numeric', year: 'numeric' }), go: () => go('day', t.date) })
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

addEventListener('hashchange', () => {
  readHash()
  render(true)
})
readHash()
buildShell()
loadState().then(() => render(true))
