import { send, handleError } from '../lib/http.js';
import { isAuthenticated } from '../lib/auth.js';

// GET /api/session → { signedIn: boolean }
export default function handler(req, res) {
  try {
    return send(res, 200, { signedIn: isAuthenticated(req) });
  } catch (err) {
    return handleError(res, err);
  }
}
