import { send, readJson, isJsonRequest, handleError } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { getJob, writeFields, assertRecordId } from '../lib/airtable.js';
import { startAutofill } from '../lib/autofill.js';

// POST /api/autofill { id } → retries "Complete job from tracker" for a job added by hand.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
  if (!isJsonRequest(req)) return send(res, 415, { error: 'Expected JSON' });
  try {
    if (!requireAuth(req, res)) return;
    const { id } = await readJson(req);
    assertRecordId(id);
    const current = await getJob(id);
    if (['Requested', 'Researching'].includes(current.autofillStatus)) {
      return send(res, 409, { error: 'Claude is already working on this one. Give it a few minutes.' });
    }
    if (!current.link) return send(res, 400, { error: 'This job has no link to work from.' });
    const requested = await writeFields(id, { autofillStatus: 'Requested' });
    const { job, started, error } = await startAutofill(id, requested);
    if (!started) return send(res, 502, { error, job });
    return send(res, 200, { job });
  } catch (err) {
    return handleError(res, err);
  }
}
