import { send, readJson, isJsonRequest, handleError } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { getJob, writeFields, assertRecordId } from '../lib/airtable.js';
import { fireDocsTask } from '../lib/claude.js';
import * as mock from '../lib/mock.js';

const IN_PROGRESS = ['Requested', 'Drafting'];
const STALE_MS = 45 * 60 * 1000; // a run stuck this long can be retried

// POST /api/generate { id } → marks the job "Requested" and starts the Claude task.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
  if (!isJsonRequest(req)) return send(res, 415, { error: 'Expected JSON' });
  try {
    if (!requireAuth(req, res)) return;
    const { id } = await readJson(req);
    assertRecordId(id);

    const job = await getJob(id);
    const startedAt = Date.parse((job.docsLog || '').match(/Requested from web app at (\S+)/)?.[1] || '');
    const stale = !startedAt || Date.now() - startedAt > STALE_MS;
    if (IN_PROGRESS.includes(job.docsStatus) && !stale) {
      return send(res, 409, { error: 'Already being drafted. Give it a few minutes.' });
    }
    if (!job.jd && !job.link) {
      return send(res, 400, { error: 'This job has no job description or link to work from.' });
    }

    const requestedAt = new Date().toISOString();
    const log = `Requested from web app at ${requestedAt}`;
    let saved = await writeFields(id, { docsStatus: 'Requested', docsLog: log });

    if (process.env.MOCK === '1') {
      mock.simulateDocs(id);
      return send(res, 200, { job: saved, sessionUrl: null });
    }

    try {
      const { sessionUrl } = await fireDocsTask(id);
      if (sessionUrl) saved = await writeFields(id, { docsLog: `${log}\nClaude session: ${sessionUrl}` });
      return send(res, 200, { job: saved, sessionUrl });
    } catch (err) {
      await writeFields(id, { docsStatus: 'Failed', docsLog: `${log}\nCould not start Claude: ${err.message}` }).catch(() => {});
      throw err;
    }
  } catch (err) {
    return handleError(res, err);
  }
}
