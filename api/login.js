import { send, readJson, isJsonRequest, handleError } from '../lib/http.js';
import { checkPassword, createSessionCookie } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
  if (!isJsonRequest(req)) return send(res, 415, { error: 'Expected JSON' });
  try {
    const { password } = await readJson(req);
    if (!checkPassword(password)) {
      await new Promise((r) => setTimeout(r, 800)); // slow down guessing
      return send(res, 401, { error: 'Wrong password' });
    }
    return send(res, 200, { ok: true }, { 'Set-Cookie': createSessionCookie() });
  } catch (err) {
    return handleError(res, err);
  }
}
