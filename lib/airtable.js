import { FIELD_IDS, LIST_KEYS, DETAIL_KEYS, CHOICES, EDITABLE } from './config.js';
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
  const clean = validatePatch(patch);
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
