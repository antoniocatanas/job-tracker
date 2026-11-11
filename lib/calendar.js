// Reads Google Calendar through its private iCal link ("Secret address in iCal format")
// and matches events to jobs by company name. Read-only: nothing is ever written to the calendar.
import * as mock from './mock.js';

const PAST_DAYS = 30;
const FUTURE_DAYS = 120;
const CACHE_MS = 5 * 60 * 1000;
const MAX_BYTES = 15 * 1024 * 1024;

let cache = null; // { key, at, events }

export function calendarUrls() {
  return String(process.env.GOOGLE_CALENDAR_ICS_URL || '')
    .split(/[\s,]+/)
    .map((u) => u.trim().replace(/^webcal:\/\//i, 'https://'))
    .filter((u) => /^https:\/\//i.test(u));
}

export function isConfigured() {
  return process.env.MOCK === '1' || calendarUrls().length > 0;
}

// ---------- iCal parsing ----------

function unescapeText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

// Offset (ms) of a time zone from UTC at a given instant.
function tzOffset(ts, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ts));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
}

function zonedToUtc(y, mo, d, h, mi, s, timeZone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  try {
    const first = guess - tzOffset(guess, timeZone);
    return guess - tzOffset(first, timeZone);
  } catch {
    return guess; // Unknown TZID: treat as UTC rather than dropping the event
  }
}

// Returns { iso, allDay } or null.
export function parseDate(value, params = {}) {
  const m = String(value).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  if (hh === undefined || params.VALUE === 'DATE') {
    return { iso: `${y}-${mo}-${d}`, allDay: true, ts: Date.UTC(+y, +mo - 1, +d) };
  }
  const ts = z
    ? Date.UTC(+y, +mo - 1, +d, +hh, +mi, +(ss || 0))
    : params.TZID
      ? zonedToUtc(+y, +mo, +d, +hh, +mi, +(ss || 0), params.TZID.replace(/^"|"$/g, ''))
      : Date.UTC(+y, +mo - 1, +d, +hh, +mi, +(ss || 0)); // floating time
  return { iso: new Date(ts).toISOString(), allDay: false, ts };
}

export function parseIcs(text) {
  const lines = String(text).replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT') { if (ev) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [name, ...rawParams] = line.slice(0, colon).split(';');
    const value = line.slice(colon + 1);
    const params = Object.fromEntries(rawParams.map((p) => { const i = p.indexOf('='); return [p.slice(0, i).toUpperCase(), p.slice(i + 1)]; }));
    switch (name.toUpperCase()) {
      case 'UID': ev.uid = value; break;
      case 'SUMMARY': ev.title = unescapeText(value); break;
      case 'DESCRIPTION': ev.description = unescapeText(value); break;
      case 'LOCATION': ev.location = unescapeText(value); break;
      case 'STATUS': ev.status = value.toUpperCase(); break;
      case 'DTSTART': ev.start = parseDate(value, params); break;
      case 'DTEND': ev.end = parseDate(value, params); break;
      case 'RECURRENCE-ID': ev.recurrenceId = value; break;
      default: break;
    }
  }
  return events.filter((e) => e.start && e.status !== 'CANCELLED');
}

// ---------- Matching ----------

const SUFFIX = /\b(inc|ltd|limited|llc|plc|gmbh|sas|sa|bv|corp|corporation|co|company|group|technologies|technology|labs|hq)\.?$/i;

function companyKey(name) {
  return String(name || '').toLowerCase().replace(/[’']/g, '').replace(SUFFIX, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Words that are too common to safely match on their own.
const TOO_GENERIC = new Set(['the', 'one', 'call', 'meet', 'zoom', 'team', 'work', 'home', 'plan', 'go', 'ai', 'hub', 'data']);

// Several roles at one company: an interview belongs to the one you're actually in process for.
const IN_PROCESS = ['Interviewing', 'Applied'];
function pickJobs(list) {
  if (list.length < 2) return list;
  for (const status of IN_PROCESS) {
    const hits = list.filter((j) => j.status === status);
    if (hits.length) return hits;
  }
  return list;
}

export function matchEvents(events, jobs) {
  const companies = new Map(); // key → [jobs]
  for (const j of jobs) {
    const key = companyKey(j.company);
    if (key.length < 2 || TOO_GENERIC.has(key)) continue;
    if (!companies.has(key)) companies.set(key, []);
    companies.get(key).push(j);
  }
  const patterns = [...companies.keys()]
    .sort((a, b) => b.length - a.length)
    .map((key) => [key, new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(key).replace(/ /g, '[^\\p{L}\\p{N}]+')}($|[^\\p{L}\\p{N}])`, 'iu')]);

  const out = [];
  for (const e of events) {
    const fields = [e.title, e.location, e.description].map((v) => String(v || '').toLowerCase().replace(/[’']/g, ''));
    let hit = null;
    for (const fieldText of fields) { // the title wins over the description
      hit = patterns.find(([, re]) => re.test(fieldText));
      if (hit) break;
    }
    if (!hit) continue;
    const meet = (String(e.description || '') + ' ' + String(e.location || '')).match(/https:\/\/(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s<>"']+/i);
    out.push({
      id: `${e.uid || ''}|${e.recurrenceId || e.start.iso}`,
      title: e.title || '(No title)',
      start: e.start.iso,
      end: e.end?.iso || null,
      allDay: e.start.allDay,
      location: e.location ? String(e.location).slice(0, 300) : null,
      meetUrl: meet ? meet[0] : null,
      jobIds: pickJobs(companies.get(hit[0])).map((j) => j.id),
    });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// ---------- Fetching ----------

async function fetchIcs(url) {
  const res = await fetch(url, { headers: { Accept: 'text/calendar' }, redirect: 'follow' });
  if (!res.ok) {
    const hint = res.status === 404 || res.status === 403
      ? ' (check that the secret iCal address in Vercel is current: resetting it in Google Calendar changes it)'
      : '';
    throw Object.assign(new Error(`Google Calendar answered HTTP ${res.status}${hint}`), { status: 502 });
  }
  const text = await res.text();
  if (text.length > MAX_BYTES) throw Object.assign(new Error('Calendar feed is too large'), { status: 502 });
  if (!text.includes('BEGIN:VCALENDAR')) throw Object.assign(new Error("That calendar link didn't return an iCal feed"), { status: 502 });
  return text;
}

async function loadEvents() {
  if (process.env.MOCK === '1') return parseIcs(mock.calendarIcs());
  const urls = calendarUrls();
  const key = urls.join(' ');
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.events;
  const from = Date.now() - PAST_DAYS * 86400e3;
  const to = Date.now() + FUTURE_DAYS * 86400e3;
  const texts = await Promise.all(urls.map(fetchIcs));
  const events = texts.flatMap(parseIcs).filter((e) => e.start.ts >= from && e.start.ts <= to);
  cache = { key, at: Date.now(), events };
  return events;
}

export async function interviewEvents(jobs) {
  return matchEvents(await loadEvents(), jobs);
}
