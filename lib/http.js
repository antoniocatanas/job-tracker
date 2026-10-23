const MAX_BODY = 100_000;

export function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

export function isJsonRequest(req) {
  return String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json');
}

// Works both on Vercel (body already parsed) and with the local dev server (raw stream).
export async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

export function handleError(res, err) {
  console.error(err);
  if (err instanceof SyntaxError) return send(res, 400, { error: 'Invalid JSON' });
  if (err.status && err.status < 500 && err.fromAirtable !== true) {
    return send(res, err.status, { error: err.message });
  }
  // Airtable or configuration problem: surface a readable message, never the token.
  return send(res, 502, { error: err.message || 'Something went wrong' });
}
