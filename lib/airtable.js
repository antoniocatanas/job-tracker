import { FIELD_IDS, LIST_KEYS, DETAIL_KEYS, CHOICES, EDITABLE, NEW_JOB_LIMITS } from './config.js';
import * as mock from './mock.js';

const API = 'https://api.airtable.com/v0';
const RECORD_ID = /^rec[A-Za-z0-9]{14}$/;
const useMock = () => process.env.MOCK === '1';

function env() {
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_TABLE_ID;
  if (!token || !base || !table) {
    throw Object.assign(new Error('Airtable is not configured: set AIRTABLE_TOKEN, AIRTABLE_BASE_ID and AIRTABLE_TABLE_ID'), { status: 500 });
  }
  return { token, base, table };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function airtable(path, init = {}) {
  const { token } = env();
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    if (res.status === 429) { // Airtable allows 5 requests/second per base
      await sleep(1000 * (attempt + 1));
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.error?.message || body?.error?.type || body?.error || `HTTP ${res.status}`;
      throw Object.assign(new Error(`Airtable: ${msg}`), { status: res.status, fromAirtable: true });
    }
    return body;
  }
  throw Object.assign(new Error('Airtable rate limit: try again in a moment'), { status: 429, fromAirtable: true });
}

function toJob(record, keys) {
  const f = record.fields || {};
  const job = { id: record.id, createdTime: record.createdTime };
  for (const k of keys) job[k] = f[FIELD_IDS[k]] ?? null;
  // Score is a single select in Airtable ("64"), so turn it into a number for sorting and averages.
  if ('score' in job && job.score != null) {
    const n = Number(job.score);
    job.score = Number.isFinite(n) ? n : null;
  }
  return job;
}

export function assertRecordId(id) {
  if (!RECORD_ID.test(String(id))) throw Object.assign(new Error('Invalid record id'), { status: 400 });
}

export async function listJobs() {
  if (useMock()) return mock.list(LIST_KEYS);
  const { base, table } = env();
  const params = new URLSearchParams({ returnFieldsByFieldId: 'true', pageSize: '100' });
  for (const k of LIST_KEYS) params.append('fields[]', FIELD_IDS[k]);
  const jobs = [];
  let offset;
  do {
    if (offset) params.set('offset', offset);
    const data = await airtable(`/${base}/${table}?${params}`);
    jobs.push(...data.records.map((r) => toJob(r, LIST_KEYS)));
    offset = data.offset;
  } while (offset);
  return jobs;
}

export async function getJob(id) {
  assertRecordId(id);
  if (useMock()) return mock.get(id, DETAIL_KEYS);
  const { base, table } = env();
  const record = await airtable(`/${base}/${table}/${id}?returnFieldsByFieldId=true`);
  return toJob(record, DETAIL_KEYS);
}

// Only fields listed in EDITABLE can be written, and select values must match the base's options.
export function validatePatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Expected a JSON object'), { status: 400 });
  }
  const keys = Object.keys(body);
  if (!keys.length) throw Object.assign(new Error('Nothing to update'), { status: 400 });
  const clean = {};
  for (const key of keys) {
    const kind = EDITABLE[key];
    const value = body[key];
    if (!kind) throw Object.assign(new Error(`Field "${key}" cannot be edited here`), { status: 400 });
    if (value === null || value === '') { clean[key] = null; continue; }
    if (kind === 'select' && !CHOICES[key].includes(value)) {
      throw Object.assign(new Error(`"${value}" is not a valid option for ${key}`), { status: 400 });
    }
    if (kind === 'text' && (typeof value !== 'string' || value.length > 50_000)) {
      throw Object.assign(new Error(`${key} must be text under 50,000 characters`), { status: 400 });
    }
    clean[key] = value;
  }
  return clean;
}

export async function updateJob(id, patch) {
  assertRecordId(id);
  return writeFields(id, validatePatch(patch));
}

// Server-side writes that skip the user-edit allowlist (used for Docs status / Docs log).
export async function writeFields(id, clean) {
  assertRecordId(id);
  if (useMock()) return mock.update(id, clean, DETAIL_KEYS);
  const { base, table } = env();
  const fields = {};
  for (const [k, v] of Object.entries(clean)) fields[FIELD_IDS[k]] = v;
  const record = await airtable(`/${base}/${table}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, returnFieldsByFieldId: true }),
  });
  return toJob(record, DETAIL_KEYS);
}

// ---------------- Jobs added by hand ----------------

// Validates { company, role, link } from the "Add job" form.
export function validateNewJob(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Expected a JSON object'), { status: 400 });
  }
  const clean = {};
  for (const key of ['company', 'role', 'link']) {
    const value = typeof body[key] === 'string' ? body[key].trim().replace(/\s+/g, ' ') : '';
    if (!value) throw Object.assign(new Error(`${key[0].toUpperCase() + key.slice(1)} is required`), { status: 400 });
    if (value.length > NEW_JOB_LIMITS[key]) throw Object.assign(new Error(`${key} is too long`), { status: 400 });
    clean[key] = value;
  }
  let url;
  try { url = new URL(clean.link); } catch { url = null; }
  if (!url || !['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error('Link must be a full web address starting with https://'), { status: 400 });
  }
  clean.link = url.href;
  return clean;
}

// Same posting even if the link has tracking parameters or a trailing slash.
const normLink = (u) => {
  try {
    const url = new URL(u);
    return (url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/+$/, '')).toLowerCase();
  } catch { return String(u || '').toLowerCase(); }
};
const normText = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function findDuplicate(jobs, { company, role, link }) {
  const l = normLink(link);
  return jobs.find((j) => (j.link && normLink(j.link) === l)
    || (normText(j.company) === normText(company) && normText(j.role) === normText(role))) || null;
}

export async function createJob({ company, role, link }) {
  const fields = {
    company, role, link,
    status: 'New',
    dateFound: new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }), // YYYY-MM-DD
    autofillStatus: 'Requested',
  };
  if (useMock()) return mock.create(fields, DETAIL_KEYS);
  const { base, table } = env();
  const body = { fields: {}, returnFieldsByFieldId: true };
  for (const [k, v] of Object.entries(fields)) body.fields[FIELD_IDS[k]] = v;
  const record = await airtable(`/${base}/${table}`, { method: 'POST', body: JSON.stringify(body) });
  return toJob(record, DETAIL_KEYS);
}
