import { send, handleError } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { listJobs } from '../lib/airtable.js';
import { isConfigured, interviewEvents } from '../lib/calendar.js';

// GET /api/calendar → Google Calendar events that mention a company in the tracker.
// Only matched events are returned; the rest of the calendar never leaves the server.
export default async function handler(req, res) {
  try {
    if (!requireAuth(req, res)) return;
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
    if (!isConfigured()) return send(res, 200, { configured: false, events: [] });
    const events = await interviewEvents(await listJobs());
    return send(res, 200, { configured: true, events, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return handleError(res, err);
  }
}
