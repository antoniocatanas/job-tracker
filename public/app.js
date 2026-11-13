// Job Search Tracker front end. Talks only to /api/* — the Airtable token never reaches the browser.

const ACTIVE = ['New', 'Shortlisted', 'Drafted', 'Applied', 'Interviewing'];
const CLOSED = ['Rejected', 'Skipped', 'JD unavailable'];
// Colours match the Status field in Airtable (blueLight2, cyanLight2, tealLight2, greenLight2,
// greenBright, redLight2, grayLight2, orangeLight2). If you recolour an option there, update it here.
const STATUS_FILL = {
  New: '#cfdfff', Shortlisted: '#d0f0fd', Drafted: '#c2f5e9', Applied: '#d1f7c4', Interviewing: '#20c933',
  Rejected: '#ffdce5', Skipped: '#eeeeee', 'JD unavailable': '#fee2d5', '': '#eeeeee',
};
const STATUS_TEXT = { Interviewing: '#ffffff' }; // Airtable puts white text on bright colours
// Stronger shade of the same hue, for small dots.
const STATUS_COLOR = {
  New: '#2d7ff9', Shortlisted: '#18bfff', Drafted: '#20d9d2', Applied: '#20c933', Interviewing: '#20c933',
  Rejected: '#f82b60', Skipped: '#8b8b8b', 'JD unavailable': '#ff6f2c', '': '#8b8b8b',
};
const ALL_DETAIL_TABS = [
  ['brief', 'Brief'], ['competitors', 'Competitors'], ['jd', 'Job description'], ['assets', 'Interview prep'], ['diligence', 'Due diligence'], ['notes', 'Notes'], ['docsLog', 'Docs log'],
];
const detailTabs = () => ALL_DETAIL_TABS.filter(([k]) => k !== 'diligence' || state.features.diligence);
const DOCS_BUSY = ['Requested', 'Drafting'];
const DOCS_LABEL = { Requested: 'Docs queued', Drafting: 'Drafting docs…', Ready: 'Docs ready', Failed: 'Docs failed' };
const FILL_BUSY = ['Requested', 'Researching'];
const FILL_LABEL = { Requested: 'Queued for Claude', Researching: 'Claude filling in…', Failed: 'Auto-complete failed' };
const isBusy = (j) => DOCS_BUSY.includes(j.docsStatus) || FILL_BUSY.includes(j.autofillStatus);

const state = {
  jobs: [],
  choices: {},
  view: 'pipeline',
  q: '', segment: '', location: '', status: '', stage: '', showClosed: false,
  sort: { key: 'score', dir: 'desc' },
  details: new Map(),
  openId: null,
  tab: 'brief',
  recordUrlPrefix: null,
  notesDraft: null, // { id, value } — survives re-renders until saved
  features: {},
  diligenceDraft: null, // { id, sections } — unsaved due diligence notes
  lastFocus: null,
  generating: null, // job id while the generate request is in flight
  retrying: null, // job id while an auto-complete retry is in flight
  calendar: { configured: false, events: [], byJob: new Map(), error: null },
};

const $ = (s, el = document) => el.querySelector(s);

// Tiny DOM builder. Strings are always set as text, never parsed as HTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v; // CSSOM, allowed under the strict CSP
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);
const trimmed = (v) => (v == null ? '' : String(v).trim());

// ---------------- API ----------------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error('Signed out'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------------- Toast ----------------
let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isErr ? 5000 : 2200);
}

// ---------------- Auth ----------------
function showLogin() {
  $('#app').hidden = true;
  closeDrawer();
  $('#login').hidden = false;
  $('#password').focus();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  const btn = e.submitter || $('#login-form button');
  err.hidden = true;
  btn.disabled = true;
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
    $('#password').value = '';
    $('#login').hidden = true;
    await start();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// ---------------- Theme (Auto → Light → Dark) ----------------
const THEMES = ['auto', 'light', 'dark'];
const THEME_ICON = {
  auto: 'M12 3a9 9 0 1 0 0 18V3z M12 3a9 9 0 0 1 0 18',
  light: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M12 1v3 M12 20v3 M4.2 4.2l2.1 2.1 M17.7 17.7l2.1 2.1 M1 12h3 M20 12h3 M4.2 19.8l2.1-2.1 M17.7 6.3l2.1-2.1',
  dark: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
};
function currentTheme() {
  try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; }
}
function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch {}
  const label = t[0].toUpperCase() + t.slice(1);
  const btn = $('#theme');
  btn.title = `Theme: ${label} (click to change)`;
  btn.setAttribute('aria-label', btn.title);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', THEME_ICON[t]);
  path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  btn.replaceChildren(svg, h('span', { class: 'hide-sm' }, label));
}
$('#theme').addEventListener('click', () => applyTheme(THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length]));
applyTheme(currentTheme());

$('#logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: '{}' }).catch(() => {});
  state.jobs = [];
  state.details.clear();
  showLogin();
});

// ---------------- Loading ----------------
async function load() {
  const data = await api('/api/jobs');
  state.jobs = data.jobs;
  state.choices = data.choices;
  state.features = data.features || {};
  state.recordUrlPrefix = data.recordUrlPrefix || null;
  fillFilterOptions();
  render();
  schedulePoll();
  loadCalendar(); // not awaited: the board shouldn't wait on Google
}

// ---------------- Google Calendar ----------------
async function loadCalendar() {
  try {
    const data = await api('/api/calendar');
    const byJob = new Map();
    for (const ev of data.events || []) for (const id of ev.jobIds) {
      if (!byJob.has(id)) byJob.set(id, []);
      byJob.get(id).push(ev);
    }
    state.calendar = { configured: !!data.configured, events: data.events || [], byJob, error: null };
  } catch (ex) {
    if (ex.message === 'Signed out') return;
    state.calendar = { ...state.calendar, error: ex.message };
  }
  render();
  if (state.openId) renderDrawer();
}

// An event counts as upcoming until it ends (all-day events until the end of that day).
function eventEnd(ev) {
  if (ev.allDay) { const d = new Date(ev.start + 'T00:00:00'); d.setDate(d.getDate() + 1); return d; }
  return new Date(ev.end || ev.start);
}
const isUpcoming = (ev) => eventEnd(ev) > new Date();
const nextEventFor = (id) => (state.calendar.byJob.get(id) || []).find(isUpcoming) || null;

function eventWhen(ev, { short = false } = {}) {
  const start = new Date(ev.allDay ? ev.start + 'T00:00:00' : ev.start);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(start); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that - today) / 86400e3);
  const dayLabel = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday'
    : start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(short ? {} : { year: start.getFullYear() !== today.getFullYear() ? 'numeric' : undefined }) });
  if (ev.allDay) return `${dayLabel} · all day`;
  const time = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (short) return `${dayLabel} ${time}`;
  const end = ev.end ? new Date(ev.end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : null;
  return `${dayLabel} · ${time}${end ? `–${end}` : ''}`;
}

const CAL_ICON = () => h('span', { 'aria-hidden': 'true', class: 'cal-ico' }, '📅');

function calChip(job) {
  const ev = nextEventFor(job.id);
  if (!ev) return null;
  const soon = new Date(ev.allDay ? ev.start + 'T00:00:00' : ev.start) - Date.now() < 2 * 86400e3;
  return h('span', { class: 'chip cal' + (soon ? ' soon' : ''), title: ev.title }, CAL_ICON(), ' ', eventWhen(ev, { short: true }));
}

function renderUpcoming() {
  const el = $('#upcoming');
  const { configured, events, error } = state.calendar;
  const jobById = new Map(state.jobs.map((j) => [j.id, j]));
  const next = events.filter(isUpcoming).slice(0, 6);
  if (!configured || (!next.length && !error)) { el.hidden = true; return; }
  el.hidden = false;
  el.replaceChildren(...[
    h('div', { class: 'up-title' }, CAL_ICON(), ' Upcoming interviews'),
    error ? h('span', { class: 'error' }, `Couldn't read Google Calendar: ${error}`) : null,
    ...next.map((ev) => {
      const job = jobById.get(ev.jobIds[0]) || {};
      return h('div', { class: 'up-item' },
        h('button', { type: 'button', class: 'up-open', title: ev.title, onclick: () => openDrawer(job.id) },
          h('span', { class: 'up-when' }, eventWhen(ev, { short: true })),
          h('span', { class: 'up-company' }, job.company || ev.title)),
        safeUrl(ev.meetUrl) ? h('a', { class: 'up-join', href: safeUrl(ev.meetUrl), target: '_blank', rel: 'noopener noreferrer' }, 'Join ↗') : null);
    })].filter(Boolean));
}

function calendarPanel(job) {
  const { configured, error } = state.calendar;
  if (!configured) return null;
  const evs = state.calendar.byJob.get(job.id) || [];
  const upcoming = evs.filter(isUpcoming);
  const past = evs.filter((e) => !isUpcoming(e)).reverse();
  const row = (ev, isPast) => h('li', { class: 'cal-row' + (isPast ? ' past' : '') },
    h('div', { class: 'cal-when' }, eventWhen(ev)),
    h('div', { class: 'cal-title' }, ev.title),
    ev.location && !safeUrl(ev.location) ? h('div', { class: 'muted cal-loc' }, ev.location) : null,
    !isPast && safeUrl(ev.meetUrl) ? h('a', { class: 'btn cal-join', href: safeUrl(ev.meetUrl), target: '_blank', rel: 'noopener noreferrer' }, 'Join call ↗') : null);
  return h('section', { class: 'cal-panel', 'aria-label': 'Google Calendar' },
    h('div', { class: 'cal-head' }, CAL_ICON(), ' Google Calendar'),
    error ? h('p', { class: 'error' }, `Couldn't read Google Calendar: ${error}`) : null,
    !evs.length && !error ? h('p', { class: 'muted cal-empty' }, `No events mentioning "${job.company || 'this company'}" in the last 30 days or next 4 months.`) : null,
    upcoming.length ? h('ul', { class: 'cal-list' }, upcoming.map((e) => row(e, false))) : null,
    past.length ? h('details', { class: 'cal-past' }, h('summary', {}, `${past.length} past`), h('ul', { class: 'cal-list' }, past.map((e) => row(e, true)))) : null);
}

async function start() {
  $('#app').hidden = false;
  $('#board').replaceChildren(h('div', { class: 'state' }, 'Loading jobs from Airtable…'));
  try {
    await load();
    const fromHash = new URLSearchParams(location.hash.slice(1)).get('job');
    if (fromHash && state.jobs.some((j) => j.id === fromHash)) openDrawer(fromHash);
  } catch (ex) {
    if (ex.message !== 'Signed out') {
      $('#board').replaceChildren(h('div', { class: 'state' }, `Couldn't load jobs: ${ex.message}`));
    }
  }
}

$('#refresh').addEventListener('click', async () => {
  const btn = $('#refresh');
  btn.disabled = true;
  try {
    state.details.clear();
    await load();
    if (state.openId) renderDrawer();
    toast('Up to date with Airtable');
  } catch (ex) {
    if (ex.message !== 'Signed out') toast(ex.message, true);
  } finally {
    btn.disabled = false;
  }
});

function fillFilterOptions() {
  const fill = (sel, opts, label) => {
    const current = sel.value;
    sel.replaceChildren(h('option', { value: '' }, label), ...opts.map((o) => h('option', { value: o }, trimmed(o))));
    sel.value = opts.includes(current) ? current : '';
  };
  fill($('#f-segment'), state.choices.segment || [], 'All segments');
  fill($('#f-location'), state.choices.location || [], 'All locations');
  fill($('#f-status'), state.choices.status || [], 'All statuses');
}

// ---------------- Filtering ----------------
// Filters stack: search, segment, location, status and application stage all apply together.
const NO_STAGE = '__none';
const stageOf = (j) => trimmed(j.appStatus);
const stageMatches = (j, stage) => (stage === NO_STAGE ? !stageOf(j) : stageOf(j) === trimmed(stage));

function filtered({ ignoreStage = false } = {}) {
  const q = state.q.toLowerCase();
  return state.jobs.filter((j) => {
    if (q && !`${j.company || ''} ${j.role || ''}`.toLowerCase().includes(q)) return false;
    if (state.segment && j.segment !== state.segment) return false;
    if (state.location && j.location !== state.location) return false;
    if (!ignoreStage && state.stage && !stageMatches(j, state.stage)) return false;
    if (state.status) return (j.status || 'New') === state.status;
    if (state.view === 'ranked' && !state.showClosed && CLOSED.includes(j.status)) return false;
    return true;
  });
}

// Application stage dropdown, with counts for the jobs the other filters leave in view.
function renderStageOptions() {
  const sel = $('#f-stage');
  const hideClosed = !state.status && !state.showClosed; // the board hides closed jobs too
  const base = filtered({ ignoreStage: true }).filter((j) => !(hideClosed && CLOSED.includes(j.status)));
  const count = (stage) => base.filter((j) => stageMatches(j, stage)).length;
  const opts = [...(state.choices.appStatus || []).map((o) => [o, trimmed(o)]), [NO_STAGE, 'No stage yet']];
  sel.replaceChildren(
    h('option', { value: '' }, 'All application stages'),
    ...opts.map(([value, label]) => h('option', { value }, `${label} (${count(value)})`)),
  );
  sel.value = opts.some(([v]) => v === state.stage) ? state.stage : '';
  sel.classList.toggle('active', Boolean(state.stage));
}

function setStageFilter(s) {
  state.stage = s;
  render();
}

const stageLabel = () => (state.stage === NO_STAGE ? 'No stage yet' : trimmed(state.stage));

const byScore = (a, b) => (b.score ?? -1) - (a.score ?? -1) || String(a.company).localeCompare(String(b.company));

// ---------------- Rendering ----------------
function render() {
  $('#app').dataset.view = state.view;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
  renderStats();
  renderUpcoming();
  renderStageOptions();
  if (state.view === 'pipeline') {
    $('#board').hidden = false;
    $('#table-wrap').hidden = true;
    renderBoard();
  } else {
    $('#board').hidden = true;
    $('#table-wrap').hidden = false;
    renderTable();
  }
}

function renderStats() {
  const count = (s) => state.jobs.filter((j) => (j.status || 'New') === s).length;
  const active = state.jobs.filter((j) => ACTIVE.includes(j.status || 'New') && j.score != null);
  const avg = active.length ? Math.round(active.reduce((s, j) => s + j.score, 0) / active.length) : '–';
  const cell = (label, value, extra) => h('div', { class: 'stat' },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, value, extra ? h('small', {}, extra) : null));
  const statusCell = (s) => {
    const on = state.status === s;
    return h('button', {
      type: 'button',
      class: 'stat stat-status' + (on ? ' on' : '') + (state.status && !on ? ' off' : ''),
      style: `background:${STATUS_FILL[s]};color:${STATUS_TEXT[s] || '#1d1f25'}`,
      'aria-pressed': String(on),
      title: on ? 'Show all statuses' : `Show only ${s}`,
      onclick: () => setStatusFilter(on ? '' : s),
    },
    h('div', { class: 'stat-label' }, s),
    h('div', { class: 'stat-value' }, count(s)));
  };
  $('#stats').replaceChildren(
    ...[...ACTIVE, 'Rejected'].map(statusCell),
    cell('Avg score', avg, typeof avg === 'number' ? ' /100' : null),
  );
}

function setStatusFilter(s) {
  state.status = s;
  $('#f-status').value = s;
  render();
}

// "· Applied · Second Stage · Clear" — what's narrowing the view, with one click to undo it.
function activeFilterNote() {
  const parts = [state.status, state.stage && stageLabel()].filter(Boolean);
  if (!parts.length) return [];
  return [` · ${parts.join(' · ')} · `, h('button', {
    type: 'button', class: 'linkish',
    onclick: () => { state.stage = ''; setStatusFilter(''); },
  }, 'Show all')];
}

function scoreBadge(score) {
  if (score == null) return h('span', { class: 'score', title: 'No score' }, '–');
  const cls = score >= 70 ? 'hi' : score >= 50 ? 'mid' : '';
  return h('span', { class: `score ${cls}`, title: `Score ${score}/100` }, score);
}

function shortOte(ote) {
  const t = trimmed(ote);
  if (!t || /^not listed/i.test(t)) return null;
  return t.length > 28 ? t.slice(0, 27) + '…' : t;
}

function card(job) {
  const dead = trimmed(job.select) === 'Dead';
  const filling = FILL_BUSY.includes(job.autofillStatus);
  const el = h('button', {
    class: 'card' + (dead ? ' dead' : '') + (filling ? ' filling' : ''), draggable: 'true', type: 'button',
    onclick: () => openDrawer(job.id),
    ondragstart: (e) => { e.dataTransfer.setData('text/plain', job.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); },
    ondragend: () => el.classList.remove('dragging'),
  },
  h('div', { class: 'card-top' }, h('div', { class: 'card-company' }, job.company || 'Untitled'), scoreBadge(job.score)),
  job.role ? h('div', { class: 'card-role' }, job.role) : null,
  reasonLine(job),
  h('div', { class: 'card-meta' },
    calChip(job),
    FILL_LABEL[job.autofillStatus] ? h('span', { class: `chip fill-${job.autofillStatus.toLowerCase()}` },
      filling ? h('span', { class: 'spinner', 'aria-hidden': 'true', style: 'width:10px;height:10px;display:inline-block;vertical-align:-1px;margin-right:5px' }) : null,
      FILL_LABEL[job.autofillStatus]) : null,
    job.segment ? h('span', { class: 'chip' }, job.segment) : null,
    job.location ? h('span', { class: 'chip' }, job.location) : null,
    shortOte(job.ote) ? h('span', { class: 'chip', title: job.ote }, shortOte(job.ote)) : null,
    job.appStatus ? h('span', { class: 'chip app' }, trimmed(job.appStatus)) : null,
    job.select ? h('span', { class: 'chip ' + (dead ? 'deadc' : 'alive') }, trimmed(job.select)) : null,
    job.docsStatus ? h('span', { class: `chip docs docs-${job.docsStatus.toLowerCase()}` }, DOCS_LABEL[job.docsStatus] || job.docsStatus) : null,
  ));
  return el;
}

function renderBoard() {
  const list = filtered();
  const columns = state.status ? [state.status] : [...ACTIVE, ...(state.showClosed ? CLOSED : [])];
  $('#board').classList.toggle('single', Boolean(state.status));
  const groups = Object.fromEntries(columns.map((c) => [c, []]));
  let hidden = 0;
  for (const j of list) {
    const s = j.status || 'New';
    if (groups[s]) groups[s].push(j); else hidden++;
  }
  $('#count').replaceChildren(`${list.length - hidden} shown` + (hidden ? ` · ${hidden} closed hidden` : ''), ...activeFilterNote());

  $('#board').replaceChildren(...columns.map((status) => {
    const jobs = groups[status].sort(byScore);
    const body = h('div', { class: 'col-body' },
      jobs.length ? jobs.map(card) : h('div', { class: 'col-empty' }, 'Nothing here'));
    const col = h('section', { class: 'col', 'aria-label': status },
      h('div', { class: 'col-head' },
        h('span', { class: 'dot', style: `background:${STATUS_COLOR[status]}` }),
        status, h('span', { class: 'n' }, jobs.length)),
      body);
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop-target'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop-target'); });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drop-target');
      const id = e.dataTransfer.getData('text/plain');
      const job = state.jobs.find((j) => j.id === id);
      if (job && (job.status || 'New') !== status) changeStatus(id, status);
    });
    return col;
  }));
}

function renderTable() {
  const list = filtered();
  const { key, dir } = state.sort;
  const mul = dir === 'asc' ? 1 : -1;
  list.sort((a, b) => {
    const va = a[key], vb = b[key];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))) * mul;
  });
  $('#count').replaceChildren(`${list.length} shown`, ...activeFilterNote());

  const th = (label, k, cls) => {
    const active = state.sort.key === k;
    return h('th', {
      class: cls, 'data-sort': k, 'aria-sort': active ? (dir === 'asc' ? 'ascending' : 'descending') : null,
      onclick: () => {
        state.sort = { key: k, dir: active && dir === 'desc' ? 'asc' : (active ? 'desc' : (k === 'score' || k === 'dateFound' ? 'desc' : 'asc')) };
        renderTable();
      },
    }, label, active ? h('span', { class: 'arrow' }, dir === 'asc' ? '▲' : '▼') : null);
  };

  if (!list.length) {
    $('#table-wrap').replaceChildren(h('div', { class: 'state' }, 'No jobs match these filters.'));
    return;
  }

  $('#table-wrap').replaceChildren(h('table', {},
    h('thead', {}, h('tr', {},
      h('th', { class: 'rank' }, '#'),
      th('Score', 'score'), th('Company & role', 'company'), th('Segment', 'segment', 'hide-col'),
      th('Location', 'location', 'hide-col'), th('OTE', 'ote', 'hide-col'), th('Status', 'status'),
      th('Found', 'dateFound', 'hide-col'))),
    h('tbody', {}, list.map((j, i) => h('tr', { onclick: () => openDrawer(j.id) },
      h('td', { class: 'rank' }, i + 1),
      h('td', {}, scoreBadge(j.score)),
      h('td', {}, h('div', { class: 't-company' }, j.company || 'Untitled'), h('div', { class: 't-role' }, j.role || '')),
      h('td', { class: 'hide-col' }, j.segment || '–'),
      h('td', { class: 'hide-col' }, j.location || '–'),
      h('td', { class: 'hide-col', title: j.ote || '' }, shortOte(j.ote) || h('span', { class: 'muted' }, 'Not listed')),
      h('td', {}, h('span', { class: 'status-pill' }, h('span', { class: 'dot', style: `background:${STATUS_COLOR[j.status || '']}` }), j.status || '–'),
        j.appStatus ? h('div', { class: 'muted', style: 'font-size:12.5px' }, trimmed(j.appStatus)) : null,
        calChip(j)),
      h('td', { class: 'hide-col mono', style: 'white-space:nowrap' }, j.dateFound || '–'),
    )))));
}

// ---------------- Saving ----------------
async function saveField(id, key, value) {
  return saveFields(id, { [key]: value });
}

async function saveFields(id, patch) {
  const keys = Object.keys(patch);
  const key = keys[0];
  const value = patch[key];
  const job = state.jobs.find((j) => j.id === id);
  const detail = state.details.get(id);
  const prevJob = job ? Object.fromEntries(keys.map((k) => [k, job[k]])) : null;
  const prevDetail = detail ? Object.fromEntries(keys.map((k) => [k, detail[k]])) : null;
  if (job) Object.assign(job, patch); // optimistic
  if (detail) Object.assign(detail, patch);
  render();
  if (state.openId === id) renderDrawer();
  try {
    const { job: saved } = await api(`/api/jobs/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
    if (job) for (const k of Object.keys(job)) if (k in saved) job[k] = saved[k];
    state.details.set(id, saved);
    render();
    if (state.openId === id) renderDrawer();
    toast(key === 'notes' ? 'Notes saved'
      : REASON_KEYS.includes(key) ? 'Reason saved'
        : `${saved.company || 'Job'} → ${trimmed(value) || 'cleared'}${keys.some((k) => REASON_KEYS.includes(k) && patch[k]) ? ' (reason saved)' : ''}`);
    return true;
  } catch (ex) {
    if (job) Object.assign(job, prevJob);
    if (detail) Object.assign(detail, prevDetail);
    render();
    if (state.openId === id) renderDrawer();
    if (ex.message !== 'Signed out') toast(`Couldn't save: ${ex.message}`, true);
    return false;
  }
}

// ---------------- Text rendering ----------------
// Turns plain text into paragraphs, bullet lists and headings, with safe links.
function linkify(text) {
  const parts = [];
  const re = /(https?:\/\/[^\s)]+)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(h('a', { href: m[1], target: '_blank', rel: 'noopener noreferrer' }, m[1]));
    last = m.index + m[1].length;
  }
  parts.push(text.slice(last));
  return parts;
}

// Inline markdown: **bold**, *italic* / _italic_, [text](url), bare URLs.
function inlineMd(text) {
  const out = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(?<![\w*])[*_]([^*_]+)[*_](?![\w*])/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...linkify(text.slice(last, m.index)));
    if (m[1] != null) out.push(h('strong', {}, m[1]));
    else if (m[2] != null) out.push(h('a', { href: m[3], target: '_blank', rel: 'noopener noreferrer' }, m[2]));
    else out.push(h('em', {}, m[4]));
    last = m.index + m[0].length;
  }
  out.push(...linkify(text.slice(last)));
  return out;
}

function renderText(text, { markdown = false } = {}) {
  const root = h('div', { class: 'prose' });
  let list = null;
  const inline = markdown ? inlineMd : linkify;
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (bullet) {
      if (!list) { list = h('ul'); root.append(list); }
      list.append(h('li', {}, inline(bullet[1])));
      continue;
    }
    list = null;
    if (!line.trim()) continue;
    const mdHead = markdown && line.match(/^(#{1,3})\s+(.*)$/);
    if (mdHead) { root.append(h(`h${mdHead[1].length + 1}`, {}, inline(mdHead[2]))); continue; }
    if (/^SCORE\s+\d+\s*\/\s*100/i.test(line)) { root.append(h('div', { class: 'score-line' }, line)); continue; }
    // ALL-CAPS lines such as "REQUIREMENTS MET (CV evidence)" become section headings.
    const lettersOnly = line.replace(/\(.*?\)/g, '').replace(/[^A-Za-z]/g, '');
    if (lettersOnly.length >= 4 && lettersOnly === lettersOnly.toUpperCase() && line.length < 70) {
      root.append(h('h4', {}, line)); continue;
    }
    root.append(h('p', {}, inline(line)));
  }
  return root;
}

// ---------------- Drawer ----------------
async function openDrawer(id) {
  if (!state.openId) state.lastFocus = document.activeElement;
  state.openId = id;
  history.replaceState(null, '', `#job=${id}`);
  $('#scrim').hidden = false;
  const drawer = $('#drawer');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  renderDrawer();
  if (!state.details.has(id)) {
    try {
      const { job } = await api(`/api/jobs/${encodeURIComponent(id)}`);
      state.details.set(id, job);
      if (state.openId === id) renderDrawer();
    } catch (ex) {
      if (ex.message !== 'Signed out') toast(`Couldn't load details: ${ex.message}`, true);
    }
  }
  $('.d-close')?.focus();
}

function closeDrawer() {
  if (!state.openId) return;
  state.openId = null;
  history.replaceState(null, '', location.pathname);
  $('#scrim').hidden = true;
  const drawer = $('#drawer');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  if (state.lastFocus?.isConnected) state.lastFocus.focus();
}

$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.openId) closeDrawer(); });

function selectControl(label, key, value) {
  const opts = state.choices[key] || [];
  const sel = h('select', {
    onchange: (e) => (key === 'status' ? changeStatus(state.openId, e.target.value || null) : saveField(state.openId, key, e.target.value || null)),
  }, h('option', { value: '' }, '—'), opts.map((o) => h('option', { value: o }, trimmed(o))));
  sel.value = opts.includes(value) ? value : '';
  return h('label', {}, label, sel);
}

function renderDrawer() {
  const id = state.openId;
  if (!id) return;
  const base = state.jobs.find((j) => j.id === id) || {};
  const detail = state.details.get(id);
  const job = { ...base, ...(detail || {}) };

  const links = [
    ['Job posting', job.link], ['Drive folder', job.driveFolder], ['Meeting prep', job.meetingPrep],
    ['Open in Airtable', state.recordUrlPrefix ? state.recordUrlPrefix + id : null],
  ].filter(([, u]) => safeUrl(u));

  const head = h('div', { class: 'd-head' },
    h('button', { class: 'btn btn-ghost d-close', 'aria-label': 'Close', onclick: closeDrawer }, '✕'),
    h('h2', { class: 'd-company', id: 'd-company' }, job.company || 'Untitled'),
    h('div', { class: 'd-role' }, job.role || ''),
    h('div', { class: 'd-meta' },
      scoreBadge(job.score),
      job.segment ? h('span', { class: 'chip' }, job.segment) : null,
      job.location ? h('span', { class: 'chip' }, job.location) : null,
      job.ote ? h('span', { class: 'chip', title: job.ote }, `OTE: ${job.ote.length > 60 ? job.ote.slice(0, 59) + '…' : job.ote}`) : null,
      job.dateFound ? h('span', { class: 'chip' }, `Found ${job.dateFound}`) : null),
    links.length ? h('div', { class: 'd-links' }, links.map(([label, u]) =>
      h('a', { class: 'btn', href: safeUrl(u), target: '_blank', rel: 'noopener noreferrer' }, label, ' ↗'))) : null);

  const controls = h('div', { class: 'd-controls' },
    selectControl('Status', 'status', job.status),
    selectControl('Application', 'appStatus', job.appStatus),
    selectControl('Alive / Dead', 'select', job.select));

  if (!detailTabs().some(([k]) => k === state.tab)) state.tab = 'brief';
  const tabs = h('div', { class: 'd-tabs', role: 'tablist' }, detailTabs().map(([key, label]) => {
    const empty = detail && !trimmed(detail[key]) && key !== 'notes' && key !== 'diligence';
    if (key === 'diligence' && detail) label = [label, h('span', { class: 'dd-count' }, `${diligenceCount(detail.diligence)}/5`)];
    return h('button', {
      role: 'tab', 'aria-selected': String(state.tab === key),
      onclick: () => { state.tab = key; renderDrawer(); },
    }, empty ? h('span', { class: 'empty' }, label) : label);
  }));

  let panel;
  if (!detail) {
    panel = h('div', { class: 'd-panel' }, [80, 95, 60, 90, 70].map((w) => h('div', { class: 'skeleton', style: `width:${w}%` })));
  } else if (state.tab === 'diligence') {
    panel = diligencePanel(id, detail);
  } else if (state.tab === 'notes') {
    const ta = h('textarea', { 'aria-label': 'Notes' });
    const draft = state.notesDraft?.id === id ? state.notesDraft.value : null;
    ta.value = draft ?? (detail.notes || '');
    const status = h('span', { class: 'muted' }, '');
    const save = h('button', {
      class: 'btn btn-primary', disabled: true,
      onclick: async () => {
        save.disabled = true;
        status.textContent = 'Saving…';
        const value = ta.value;
        const ok = await saveField(id, 'notes', value);
        if (ok && state.notesDraft?.value === value) state.notesDraft = null;
        status.textContent = ok ? '' : 'Not saved';
        save.disabled = ok;
      },
    }, 'Save notes');
    const sync = () => {
      const dirty = ta.value !== (detail.notes || '');
      save.disabled = !dirty;
      status.textContent = dirty ? 'Unsaved changes' : '';
      state.notesDraft = dirty ? { id, value: ta.value } : null;
    };
    ta.addEventListener('input', sync);
    queueMicrotask(sync);
    ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !save.disabled) save.click(); });
    panel = h('div', { class: 'd-panel notes-edit' }, ta, h('div', { class: 'notes-actions' }, save, status,
      h('span', { class: 'muted', style: 'margin-left:auto' }, '⌘/Ctrl + Enter to save')));
  } else {
    const text = detail[state.tab];
    panel = h('div', { class: 'd-panel' }, trimmed(text)
      ? renderText(text, { markdown: state.tab === 'assets' })
      : h('p', { class: 'empty-note' }, 'Nothing here yet.'));
  }

  $('#drawer-body').replaceChildren(...[head, fillBanner(job), controls, reasonPanel(job), calendarPanel(job), docsPanel(job), tabs, panel].filter(Boolean));
}

// ---------------- CV & cover letter generation ----------------
function docsPanel(job) {
  const status = job.docsStatus || '';
  const busy = DOCS_BUSY.includes(status);
  const ready = status === 'Ready';
  const box = h('input', { type: 'checkbox', id: 'gen-docs' });
  box.checked = busy || ready;
  box.disabled = busy || state.generating === job.id;
  box.addEventListener('change', () => {
    if (!box.checked) { box.checked = ready; return; } // unticking does nothing
    generateDocs(job.id);
  });

  const folder = safeUrl(job.driveFolder);
  let detail;
  if (state.generating === job.id) detail = 'Starting Claude…';
  else if (status === 'Requested') detail = 'Queued. Claude checks for requests every hour, then takes about 10 minutes to draft. You can close this panel.';
  else if (status === 'Drafting') detail = 'Claude is researching the company and writing both documents…';
  else if (ready) detail = h('span', {}, 'Saved to Google Drive. ', folder ? h('a', { href: folder, target: '_blank', rel: 'noopener noreferrer' }, 'Open folder ↗') : null);
  else if (status === 'Failed') detail = 'The last attempt failed (see Docs log). Tick to try again.';
  else detail = 'Claude drafts a tailored CV and cover letter into this job\'s Drive folder.';

  return h('div', { class: `d-docs${busy ? ' busy' : ''}${ready ? ' ready' : ''}${status === 'Failed' ? ' failed' : ''}` },
    h('label', { class: 'd-docs-main', for: 'gen-docs' },
      box,
      h('span', { class: 'd-docs-title' }, 'Generate CV & cover letter'),
      busy || state.generating === job.id ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : null),
    h('div', { class: 'd-docs-detail' }, detail),
    ready ? h('button', { class: 'btn btn-ghost d-docs-again', type: 'button', onclick: () => {
      if (confirm('Draft a new version? The current documents are kept and the new ones are saved as v2, v3…')) generateDocs(job.id);
    } }, 'Generate again') : null);
}

async function generateDocs(id) {
  state.generating = id;
  if (state.openId === id) renderDrawer();
  try {
    const { job: saved } = await api('/api/generate', { method: 'POST', body: JSON.stringify({ id }) });
    mergeJob(saved);
    toast('Queued: Claude will draft your CV and cover letter within the hour');
  } catch (ex) {
    if (ex.message !== 'Signed out') toast(ex.message, true);
    // Refresh this job so the panel shows the real state (e.g. Failed).
    try { mergeJob((await api(`/api/jobs/${encodeURIComponent(id)}`)).job); } catch {}
  } finally {
    state.generating = null;
    render();
    if (state.openId === id) renderDrawer();
    schedulePoll();
  }
}

function mergeJob(saved) {
  const job = state.jobs.find((j) => j.id === saved.id);
  if (job) for (const k of Object.keys(job)) if (k in saved) job[k] = saved[k];
  state.details.set(saved.id, saved);
}

// While any job is being drafted, re-check Airtable every 20 seconds.
let pollTimer = null;
function schedulePoll() {
  clearTimeout(pollTimer);
  const busy = state.jobs.filter(isBusy);
  if (!busy.length) return;
  // Auto-complete is quicker than drafting, so check more often while one is running.
  // Jobs only waiting in the queue are checked once a minute.
  const working = busy.some((j) => j.docsStatus === 'Drafting' || j.autofillStatus === 'Researching');
  pollTimer = setTimeout(poll, working ? 15_000 : 60_000);
}

async function poll() {
  if (document.hidden) return schedulePoll();
  const before = new Map(state.jobs.map((j) => [j.id, j.docsStatus]));
  const beforeFill = new Map(state.jobs.map((j) => [j.id, j.autofillStatus]));
  try {
    const data = await api('/api/jobs');
    state.jobs = data.jobs;
    for (const j of state.jobs) {
      const was = before.get(j.id);
      if (was !== j.docsStatus) {
        state.details.delete(j.id); // refetch full record (Drive folder, Docs log)
        if (j.docsStatus === 'Ready' && DOCS_BUSY.includes(was)) toast(`CV & cover letter ready: ${j.company}`);
        if (j.docsStatus === 'Failed' && DOCS_BUSY.includes(was)) toast(`Drafting failed for ${j.company}. See Docs log.`, true);
      }
      const wasFill = beforeFill.get(j.id);
      if (wasFill !== j.autofillStatus) {
        state.details.delete(j.id);
        if (FILL_BUSY.includes(wasFill) && j.autofillStatus === 'Done') {
          toast(j.score != null ? `${j.company} filled in: scored ${j.score}/100` : `${j.company} filled in (${j.status})`);
        }
        if (FILL_BUSY.includes(wasFill) && j.autofillStatus === 'Failed') toast(`Couldn't complete ${j.company}. See Brief.`, true);
      }
    }
    render();
    if (state.openId && !state.details.has(state.openId)) {
      renderDrawer();
      const { job } = await api(`/api/jobs/${encodeURIComponent(state.openId)}`);
      state.details.set(job.id, job);
      renderDrawer();
    }
  } catch {}
  schedulePoll();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) schedulePoll(); });

// ---------------- Jobs added by hand ----------------
function fillBanner(job) {
  const st = job.autofillStatus;
  if (st === 'Requested' || st === 'Researching' || state.retrying === job.id) {
    return h('div', { class: 'd-fill' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }),
      st === 'Researching'
        ? 'Claude is reading the posting and researching the company. The score and brief appear here when it\'s done.'
        : 'Queued. Claude checks for new jobs every hour, then takes a few minutes to fill this in. You can close this panel.');
  }
  if (st === 'Failed') {
    return h('div', { class: 'd-fill failed' }, 'Claude couldn\'t complete this job (see Brief).',
      h('button', { class: 'btn', type: 'button', onclick: () => retryAutofill(job.id) }, 'Try again'));
  }
  return null;
}

async function retryAutofill(id) {
  state.retrying = id;
  renderDrawer();
  try {
    const { job } = await api('/api/autofill', { method: 'POST', body: JSON.stringify({ id }) });
    mergeJob(job);
    toast('Queued: Claude will fill in this job within the hour');
  } catch (ex) {
    if (ex.message !== 'Signed out') toast(ex.message, true);
    try { mergeJob((await api(`/api/jobs/${encodeURIComponent(id)}`)).job); } catch {}
  } finally {
    state.retrying = null;
    render();
    if (state.openId === id) renderDrawer();
    schedulePoll();
  }
}

const addDialog = $('#add-dialog');
const addForm = $('#add-form');
const addError = $('#add-error');

function showAddError(msg, existingId) {
  addError.replaceChildren(msg, existingId
    ? h('button', { type: 'button', class: 'btn btn-ghost add-error-open', onclick: () => { addDialog.close(); openDrawer(existingId); } }, 'Open it')
    : null);
  addError.hidden = false;
}

$('#add-job').addEventListener('click', () => {
  addForm.reset();
  addError.hidden = true;
  addDialog.showModal();
  $('#add-company').focus();
});
$('#add-cancel').addEventListener('click', () => addDialog.close());

// Pasting a link into Company or Role usually means it belongs in Link.
for (const sel of ['#add-company', '#add-role']) {
  $(sel).addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text')?.trim() || '';
    if (/^https?:\/\/\S+$/i.test(text) && !$('#add-link').value) {
      e.preventDefault();
      $('#add-link').value = text;
    }
  });
}

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  addError.hidden = true;
  const company = $('#add-company').value.trim();
  const role = $('#add-role').value.trim();
  const link = $('#add-link').value.trim();
  if (!company || !role || !link) return showAddError('Company, role and link are all needed.');
  if (!safeUrl(link)) return showAddError('The link should start with https://');

  const btn = $('#add-submit');
  btn.disabled = true;
  btn.textContent = 'Adding…';
  try {
    const res = await fetch('/api/jobs', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, role, link }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { addDialog.close(); return showLogin(); }
    if (!res.ok) return showAddError(data.error || `Couldn't add it (${res.status})`, data.existingId);

    const job = data.job;
    state.jobs.push(job);
    state.details.set(job.id, job);
    addDialog.close();
    // Make sure the new card is visible.
    if (state.status && state.status !== 'New') { state.status = ''; $('#f-status').value = ''; }
    render();
    schedulePoll();
    toast(data.autofillStarted
      ? `${job.company} added. Claude fills in the rest within the hour.`
      : `${job.company} added, but Claude couldn't start: ${data.autofillError}`, !data.autofillStarted);
  } catch (ex) {
    showAddError(ex.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add and complete';
  }
});

// ---------------- Controls ----------------
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  state.view = b.dataset.view;
  try { localStorage.setItem('jt-view', state.view); } catch {}
  render();
}));

let qTimer;
$('#q').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value.trim(); render(); }, 120); });
$('#f-segment').addEventListener('change', (e) => { state.segment = e.target.value; render(); });
$('#f-location').addEventListener('change', (e) => { state.location = e.target.value; render(); });
$('#f-status').addEventListener('change', (e) => setStatusFilter(e.target.value));
$('#f-stage').addEventListener('change', (e) => setStageFilter(e.target.value));
$('#f-closed').addEventListener('change', (e) => { state.showClosed = e.target.checked; render(); });

// ---------------- Boot ----------------
try { state.view = localStorage.getItem('jt-view') === 'ranked' ? 'ranked' : 'pipeline'; } catch {}

(async () => {
  try {
    const { signedIn } = await api('/api/session');
    if (signedIn) await start(); else showLogin();
  } catch {
    showLogin();
  }
})();


// ---------------- Skip / rejection reasons ----------------
// Moving a job to Skipped or Rejected (drawer dropdown or drag on the board) asks why.
// The reason goes to "Skip reason" / "Rejection reason" in Airtable, in the same save as the status.
const REASON_FOR = {
  Skipped: {
    key: 'skipReason', title: 'Why are you skipping this one?', label: 'Skip reason',
    ideas: ['OTE too low', 'Wrong segment', 'Location / relocation', 'Not my experience', 'Company not compelling', 'Role too junior'],
  },
  Rejected: {
    key: 'rejectReason', title: 'What happened?', label: 'Rejection reason',
    ideas: ['No response', 'After application', 'After screening', 'After second stage', 'After final stage', 'Role filled / paused'],
  },
};
const REASON_KEYS = Object.values(REASON_FOR).map((r) => r.key);

const reasonDialog = h('dialog', { class: 'add-dialog reason-dialog', 'aria-labelledby': 'reason-title' });
document.body.append(reasonDialog);

// Resolves with the reason text ('' if left empty), or null if cancelled.
function askReason(job, status) {
  const cfg = REASON_FOR[status];
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); if (reasonDialog.open) reasonDialog.close(); };
    const ta = h('textarea', { id: 'reason-text', rows: 4, maxlength: 2000, placeholder: 'A line or two is plenty' });
    ta.value = trimmed(job[cfg.key]);
    const addIdea = (idea) => {
      const cur = ta.value.trim();
      if (cur.toLowerCase().includes(idea.toLowerCase())) return;
      ta.value = cur ? `${cur}; ${idea}` : idea;
      ta.focus();
    };
    const form = h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); finish(ta.value.trim()); } },
      h('h2', { id: 'reason-title' }, cfg.title),
      h('p', { class: 'muted' }, `${job.company || 'This job'}${job.role ? ` – ${job.role}` : ''} → ${status}`),
      h('div', { class: 'reason-ideas' }, cfg.ideas.map((idea) => h('button', { type: 'button', class: 'chip reason-idea', onclick: () => addIdea(idea) }, '+ ', idea))),
      h('label', { class: 'field' }, h('span', {}, cfg.label), ta),
      h('div', { class: 'add-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => finish(null) }, 'Cancel'),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => finish('') }, 'No reason'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, `Save as ${status}`)));
    ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') form.requestSubmit(); });
    reasonDialog.onclose = () => finish(null); // Esc
    reasonDialog.replaceChildren(form);
    reasonDialog.showModal();
    ta.focus();
  });
}

async function changeStatus(id, status) {
  const job = state.jobs.find((j) => j.id === id);
  const cfg = REASON_FOR[status];
  if (!job || !cfg) return saveField(id, 'status', status);
  const reason = await askReason({ ...job, ...(state.details.get(id) || {}) }, status);
  if (reason === null) { // cancelled: put the dropdown back
    render();
    if (state.openId === id) renderDrawer();
    return false;
  }
  return saveFields(id, reason ? { status, [cfg.key]: reason } : { status });
}

async function editReason(id, status) {
  const job = { ...state.jobs.find((j) => j.id === id), ...(state.details.get(id) || {}) };
  const cfg = REASON_FOR[status];
  const reason = await askReason(job, status);
  if (reason === null || reason === trimmed(job[cfg.key])) return;
  saveFields(id, { [cfg.key]: reason || null });
}

function reasonPanel(job) {
  const cfg = REASON_FOR[job.status];
  // Show the reason for the current status, plus any older one (e.g. skipped before, now rejected).
  const rows = Object.entries(REASON_FOR)
    .filter(([status, r]) => status === job.status || trimmed(job[r.key]))
    .map(([status, r]) => h('div', { class: 'reason-row' },
      h('div', { class: 'reason-label' }, r.label),
      trimmed(job[r.key]) ? h('div', { class: 'reason-text' }, trimmed(job[r.key])) : h('div', { class: 'muted reason-text' }, 'No reason added'),
      h('button', { type: 'button', class: 'btn btn-ghost reason-edit', onclick: () => editReason(job.id, status) }, trimmed(job[r.key]) ? 'Edit' : 'Add')));
  if (!rows.length && !cfg) return null;
  return h('section', { class: 'reason-panel', 'aria-label': 'Reasons' }, rows);
}

function reasonLine(job) {
  const cfg = REASON_FOR[job.status];
  const text = cfg && trimmed(job[cfg.key]);
  if (!text) return null;
  return h('div', { class: 'card-reason', title: text }, text.length > 90 ? text.slice(0, 89) + '…' : text);
}

// ---------------- Due diligence ----------------
// Five checks to run on a company before accepting an offer. All five live in one Airtable
// long-text field, as "### 1. Title" sections, so they stay readable in Airtable too.
const DILIGENCE = [
  {
    title: 'Quota attainment',
    hint: 'Do reps actually earn the OTE? Check RepVue, Bravado and Glassdoor AE reviews. Healthy: 60%+ of ramped AEs at quota. Under 30–40% means a broken quota or a struggling product.',
    ask: 'What % of the London AE team hit their number last quarter, and what did the median rep actually earn?',
  },
  {
    title: 'Lead flow & pipeline',
    hint: 'Where closed-won comes from. Red flags: "lots of inbound" right after marketing cuts, or 100% cold outbound with no SDRs and little brand.',
    ask: "What share of a ramped AE's closed-won comes from inbound, SDR-sourced meetings and self-sourced outbound?",
  },
  {
    title: 'AE tenure',
    hint: 'LinkedIn → company → People → current and past AEs. Good: several AEs at 18+ months, some promoted. Bad: most leave within 7–11 months. Message 1–2 former London AEs for a candid take.',
    ask: null,
  },
  {
    title: 'Product-market fit & retention',
    hint: 'G2 / Gartner Peer Insights reviews from the last 6–12 months, especially "What do you dislike?". NDR of 105–120%+ is healthy; under 95% is leaky.',
    ask: 'What is your net dollar retention, and how has it moved this year?',
  },
  {
    title: 'Comp plan & ramp',
    hint: 'Get the plan in writing. Look for a 3–6 month ramp (draw or reduced quota) that fits the sales cycle, uncapped commission with accelerators from 100%, and no harsh clawbacks on churn.',
    ask: 'Can I see the commission plan document, including ramp, accelerators and clawbacks?',
  },
];

// "### 1. Quota attainment\n…" → ['…', '', …] plus any text outside the sections (kept, shown as Other).
function parseDiligence(text) {
  const sections = DILIGENCE.map(() => '');
  let other = '';
  const src = String(text || '').replace(/\r\n/g, '\n');
  const re = /^###\s*(\d)\.[^\n]*\n?/gm;
  const marks = [...src.matchAll(re)];
  other = (marks.length ? src.slice(0, marks[0].index) : src).trim();
  marks.forEach((m, i) => {
    const body = src.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : src.length).trim();
    const n = Number(m[1]) - 1;
    if (n >= 0 && n < DILIGENCE.length) sections[n] = sections[n] ? `${sections[n]}\n${body}` : body;
    else other = [other, body].filter(Boolean).join('\n');
  });
  return { sections, other };
}

function serializeDiligence({ sections, other }) {
  const parts = sections.map((body, i) => (body.trim() ? `### ${i + 1}. ${DILIGENCE[i].title}\n${body.trim()}` : null)).filter(Boolean);
  if (other.trim()) parts.unshift(other.trim());
  return parts.join('\n\n');
}

const diligenceCount = (text) => parseDiligence(text).sections.filter((s) => s.trim()).length;

function diligencePanel(id, detail) {
  const saved = parseDiligence(detail.diligence);
  const draft = state.diligenceDraft?.id === id ? state.diligenceDraft.value : null;
  const current = draft || { sections: [...saved.sections], other: saved.other };
  const status = h('span', { class: 'muted' }, '');
  const save = h('button', { class: 'btn btn-primary', disabled: true }, 'Save');
  const savedText = serializeDiligence(saved);

  const sync = () => {
    const dirty = serializeDiligence(current) !== savedText;
    save.disabled = !dirty;
    status.textContent = dirty ? 'Unsaved changes' : '';
    state.diligenceDraft = dirty ? { id, value: current } : null;
  };

  const box = (value, onInput, label, rows) => {
    const ta = h('textarea', { 'aria-label': label, rows, placeholder: 'Your findings…' });
    ta.value = value;
    ta.addEventListener('input', () => { onInput(ta.value); sync(); });
    ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !save.disabled) save.click(); });
    return ta;
  };

  save.addEventListener('click', async () => {
    save.disabled = true;
    status.textContent = 'Saving…';
    const value = serializeDiligence(current);
    const ok = await saveField(id, 'diligence', value || null);
    if (ok) state.diligenceDraft = null;
    else status.textContent = 'Not saved';
  });

  const items = DILIGENCE.map((d, i) => h('section', { class: 'dd-item' + (current.sections[i].trim() ? ' done' : '') },
    h('div', { class: 'dd-head' }, h('span', { class: 'dd-num' }, i + 1), h('h3', {}, d.title)),
    h('p', { class: 'dd-hint' }, d.hint),
    d.ask ? h('p', { class: 'dd-ask' }, h('strong', {}, 'Ask: '), `"${d.ask}"`) : null,
    box(current.sections[i], (v) => { current.sections[i] = v; }, d.title, 3)));

  queueMicrotask(sync);
  return h('div', { class: 'd-panel dd' },
    h('p', { class: 'muted dd-intro' }, 'Check the company like an investor before you sign. Notes save to the "Due diligence" column in Airtable.'),
    items,
    current.other ? h('section', { class: 'dd-item' }, h('div', { class: 'dd-head' }, h('h3', {}, 'Other notes')),
      box(current.other, (v) => { current.other = v; }, 'Other notes', 3)) : null,
    h('div', { class: 'notes-actions dd-actions' }, save, status,
      h('span', { class: 'muted', style: 'margin-left:auto' }, '⌘/Ctrl + Enter to save')));
}
