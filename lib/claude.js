// Starts the "Draft CV & cover letter" Claude scheduled task through its API trigger.
// Docs: https://code.claude.com/docs/en/routines#add-an-api-trigger

const BETA = 'experimental-cc-routine-2026-04-01';

function config() {
  const url = process.env.CLAUDE_TASK_FIRE_URL;
  const token = process.env.CLAUDE_TASK_TOKEN;
  if (!url || !token) {
    throw Object.assign(new Error('Doc generation is not set up yet: add CLAUDE_TASK_FIRE_URL and CLAUDE_TASK_TOKEN in Vercel'), { status: 503 });
  }
  if (!/^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/.test(url)) {
    throw Object.assign(new Error('CLAUDE_TASK_FIRE_URL does not look like a Claude task fire URL'), { status: 500 });
  }
  return { url, token };
}

// The task only reads a record ID from `text`, so that's all we send.
export async function fireDocsTask(recordId) {
  const { url, token } = config();
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
