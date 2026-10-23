import { send, handleError } from '../../lib/http.js';
import { requireAuth } from '../../lib/auth.js';
import { listJobs } from '../../lib/airtable.js';
import { CHOICES } from '../../lib/config.js';

// GET /api/jobs → every job with the light fields, plus the select options.
export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
  try {
    if (!requireAuth(req, res)) return;
    const jobs = await listJobs();
    const { AIRTABLE_BASE_ID: base, AIRTABLE_TABLE_ID: table } = process.env;
    const recordUrlPrefix = base && table && process.env.MOCK !== '1' ? `https://airtable.com/${base}/${table}/` : null;
    return send(res, 200, { jobs, choices: CHOICES, recordUrlPrefix, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return handleError(res, err);
  }
}
