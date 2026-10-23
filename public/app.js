// Job Search Tracker front end. Talks only to /api/* — the Airtable token never reaches the browser.

const ACTIVE = ['New', 'Shortlisted', 'Drafted', 'Applied', 'Interviewing'];
const CLOSED = ['Rejected', 'Skipped', 'JD unavailable'];
const STATUS_COLOR = {
  New: '#5b8def', Shortlisted: '#2bb3c0', Drafted: '#2f9e8f', Applied: '#3fa45b', Interviewing: '#1f7a4f',
  Rejected: '#c4554a', Skipped: '#9aa29d', 'JD unavailable': '#d38a2c', '': '#9aa29d',
};
const DETAIL_TABS = [
  ['brief', 'Brief'], ['jd', 'Job description'], ['assets', 'Interview prep'], ['notes', 'Notes'], ['docsLog', 'Docs log'],
];
const DOCS_BUSY = ['Requested', 'Drafting'];
const DOCS_LABEL = { Requested: 'Docs requested', Drafting: 'Drafting docs…', Ready: 'Docs ready', Failed: 'Docs failed' };

const state = {
  jobs: [],
  choices: {},
  view: 'pipeline',
  q: '', segment: '', location: '', status: '', showClosed: false,
  sort: { key: 'score', dir: 'desc' },
  details: new Map(),
  openId: null,
  tab: 'brief',
  recordUrlPrefix: null,
  notesDraft: null, // { id, value } — survives re-renders until saved
  lastFocus: null,
  generating: null, // job id while the generate request is in flight
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
  state.recordUrlPrefix = data.recordUrlPrefix || null;
  fillFilterOptions();
  render();
  schedulePoll();
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
function filtered() {
  const q = state.q.toLowerCase();
  return state.jobs.filter((j) => {
    if (q && !`${j.company || ''} ${j.role || ''}`.toLowerCase().includes(q)) return false;
    if (state.segment && j.segment !== state.segment) return false;
    if (state.location && j.location !== state.location) return false;
    if (state.view === 'ranked') {
      if (state.status) return j.status === state.status;
      if (!state.showClosed && CLOSED.includes(j.status)) return false;
    }
    return true;
  });
}

const byScore = (a, b) => (b.score ?? -1) - (a.score ?? -1) || String(a.company).localeCompare(String(b.company));

// ---------------- Rendering ----------------
function render() {
  $('#app').dataset.view = state.view;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
  renderStats();
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
  $('#stats').replaceChildren(
    ...ACTIVE.map((s) => cell(s, count(s))),
    cell('Avg score', avg, typeof avg === 'number' ? ' /100' : null),
  );
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
  const el = h('button', {
    class: 'card' + (dead ? ' dead' : ''), draggable: 'true', type: 'button',
    onclick: () => openDrawer(job.id),
    ondragstart: (e) => { e.dataTransfer.setData('text/plain', job.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); },
    ondragend: () => el.classList.remove('dragging'),
  },
  h('div', { class: 'card-top' }, h('div', { class: 'card-company' }, job.company || 'Untitled'), scoreBadge(job.score)),
  job.role ? h('div', { class: 'card-role' }, job.role) : null,
  h('div', { class: 'card-meta' },
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
  const columns = [...ACTIVE, ...(state.showClosed ? CLOSED : [])];
  const groups = Object.fromEntries(columns.map((c) => [c, []]));
  let hidden = 0;
  for (const j of list) {
    const s = j.status || 'New';
    if (groups[s]) groups[s].push(j); else hidden++;
  }
  $('#count').textContent = `${list.length - hidden} shown` + (hidden ? ` · ${hidden} closed hidden` : '');

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
      if (job && (job.status || 'New') !== status) saveField(id, 'status', status);
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
  $('#count').textContent = `${list.length} shown`;

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
        j.appStatus ? h('div', { class: 'muted', style: 'font-size:12.5px' }, trimmed(j.appStatus)) : null),
      h('td', { class: 'hide-col mono', style: 'white-space:nowrap' }, j.dateFound || '–'),
    )))));
}

// ---------------- Saving ----------------
async function saveField(id, key, value) {
  const job = state.jobs.find((j) => j.id === id);
  const prev = job ? job[key] : undefined;
  if (job) job[key] = value; // optimistic
  const detail = state.details.get(id);
  if (detail) detail[key] = value;
  render();
  try {
    const { job: saved } = await api(`/api/jobs/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ [key]: value }) });
    if (job) for (const k of Object.keys(job)) if (k in saved) job[k] = saved[k];
    state.details.set(id, saved);
    render();
    if (state.openId === id) renderDrawer();
    toast(key === 'notes' ? 'Notes saved' : `${saved.company || 'Job'} → ${trimmed(value) || 'cleared'}`);
    return true;
  } catch (ex) {
    if (job) job[key] = prev;
    if (detail) detail[key] = prev;
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
    onchange: (e) => saveField(state.openId, key, e.target.value || null),
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

  const tabs = h('div', { class: 'd-tabs', role: 'tablist' }, DETAIL_TABS.map(([key, label]) => {
    const empty = detail && !trimmed(detail[key]) && key !== 'notes';
    return h('button', {
      role: 'tab', 'aria-selected': String(state.tab === key),
      onclick: () => { state.tab = key; renderDrawer(); },
    }, empty ? h('span', { class: 'empty' }, label) : label);
  }));

  let panel;
  if (!detail) {
    panel = h('div', { class: 'd-panel' }, [80, 95, 60, 90, 70].map((w) => h('div', { class: 'skeleton', style: `width:${w}%` })));
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

  $('#drawer-body').replaceChildren(head, controls, docsPanel(job), tabs, panel);
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
  else if (status === 'Requested') detail = 'Claude is starting. This usually takes 5–10 minutes; you can close this panel.';
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
    toast('Claude is drafting your CV and cover letter');
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
  if (!state.jobs.some((j) => DOCS_BUSY.includes(j.docsStatus))) return;
  pollTimer = setTimeout(poll, 20_000);
}

async function poll() {
  if (document.hidden) return schedulePoll();
  const before = new Map(state.jobs.map((j) => [j.id, j.docsStatus]));
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
$('#f-status').addEventListener('change', (e) => { state.status = e.target.value; render(); });
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
