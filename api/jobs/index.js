import { send, readJson, isJsonRequest, handleError } from '../../lib/http.js';
import { requireAuth } from '../../lib/auth.js';
import { listJobs, validateNewJob, findDuplicate, createJob } from '../../lib/airtable.js';
import { startAutofill } from '../../lib/autofill.js';
import { CHOICES } from '../../lib/config.js';

// GET  /api/jobs → every job with the light fields, plus the select options.
// POST /api/jobs { company, role, link } → adds a job by hand, then asks Claude to fill in the rest.
export default async function handler(req, res) {
  try {
    if (!requireAuth(req, res)) return;

    if (req.method === 'GET') {
      const jobs = await listJobs();
      const { AIRTABLE_BASE_ID: base, AIRTABLE_TABLE_ID: table } = process.env;
      const recordUrlPrefix = base && table && process.env.MOCK !== '1' ? `https://airtable.com/${base}/${table}/` : null;
      return send(res, 200, { jobs, choices: CHOICES, recordUrlPrefix, fetchedAt: new Date().toISOString() });
    }

    if (req.method === 'POST') {
      if (!isJsonRequest(req)) return send(res, 415, { error: 'Expected JSON' });
      const input = validateNewJob(await readJson(req));
      const dup = findDuplicate(await listJobs(), input);
      if (dup) {
        return send(res, 409, { error: `Already in the tracker: ${dup.company} – ${dup.role}`, existingId: dup.id });
      }
      const created = await createJob(input);
      const { job, started, error } = await startAutofill(created.id, created);
      return send(res, 201, { job, autofillStarted: started, autofillError: error || null });
    }

    return send(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, POST' });
  } catch (err) {
    return handleError(res, err);
  }
}
