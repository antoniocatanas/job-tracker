import { send, readJson, isJsonRequest, handleError } from '../../lib/http.js';
import { requireAuth } from '../../lib/auth.js';
import { getJob, updateJob } from '../../lib/airtable.js';

// GET   /api/jobs/:id → one job with every field (brief, JD, notes, prep)
// PATCH /api/jobs/:id → update Status, Application Status, Select or Notes
export default async function handler(req, res) {
  try {
    if (!requireAuth(req, res)) return;
    const id = req.query?.id ?? decodeURIComponent(new URL(req.url, 'http://localhost').pathname.split('/').pop());

    if (req.method === 'GET') return send(res, 200, { job: await getJob(id) });

    if (req.method === 'PATCH') {
      if (!isJsonRequest(req)) return send(res, 415, { error: 'Expected JSON' });
      const job = await updateJob(id, await readJson(req));
      return send(res, 200, { job });
    }

    return send(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, PATCH' });
  } catch (err) {
    return handleError(res, err);
  }
}
