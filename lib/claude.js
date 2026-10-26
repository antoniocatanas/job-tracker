// Starts Claude scheduled tasks through their API triggers.
// Docs: https://code.claude.com/docs/en/routines#add-an-api-trigger
//
//   docs      → "Draft CV & cover letter (from job tracker)"   CLAUDE_TASK_FIRE_URL / CLAUDE_TASK_TOKEN
//   autofill  → "Complete job from tracker"                    CLAUDE_AUTOFILL_FIRE_URL / CLAUDE_AUTOFILL_TOKEN

const BETA = 'experimental-cc-routine-2026-04-01';

const TASKS = {
  docs: { url: 'CLAUDE_TASK_FIRE_URL', token: 'CLAUDE_TASK_TOKEN', label: 'Doc generation' },
  autofill: { url: 'CLAUDE_AUTOFILL_FIRE_URL', token: 'CLAUDE_AUTOFILL_TOKEN', label: 'Auto-complete' },
};

function config(kind) {
  const t = TASKS[kind];
  const url = process.env[t.url];
  const token = process.env[t.token];
  if (!url || !token) {
    throw Object.assign(new Error(`${t.label} is not set up yet: add ${t.url} and ${t.token} in Vercel`), { status: 503 });
  }
  if (!/^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/.test(url)) {
    throw Object.assign(new Error(`${t.url} does not look like a Claude task fire URL`), { status: 500 });
  }
  return { url, token };
}

// Both tasks only read a record ID from `text`, so that's all we send.
export async function fireTask(kind, recordId) {
  const { url, token } = config(kind);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': BETA,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: recordId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || body?.error?.type || `HTTP ${res.status}`;
    throw Object.assign(new Error(`Claude: ${msg}`), { status: res.status === 429 ? 429 : 502 });
  }
  return { sessionUrl: body.claude_code_session_url || null };
}

export const fireDocsTask = (recordId) => fireTask('docs', recordId);
export const fireAutofillTask = (recordId) => fireTask('autofill', recordId);
