// Local stand-in for Vercel: serves /public and routes /api/* to the same handlers Vercel runs.
// Usage: npm run dev        (real Airtable, reads .env)
//        npm run dev:mock   (fictional data, no token needed)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
process.env.NODE_ENV = 'development';
if (process.env.MOCK === '1') {
  process.env.APP_PASSWORD ??= 'demo';
  process.env.SESSION_SECRET ??= 'local-mock-secret-that-is-at-least-32-chars';
}

const routes = [
  [/^\/api\/login$/, './api/login.js'],
  [/^\/api\/logout$/, './api/logout.js'],
  [/^\/api\/session$/, './api/session.js'],
  [/^\/api\/generate$/, './api/generate.js'],
  [/^\/api\/jobs\/?$/, './api/jobs/index.js'],
  [/^\/api\/jobs\/([^/]+)$/, './api/jobs/[id].js', 'id'],
];

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };

// Apply the same security headers Vercel will send (from vercel.json).
const headerRules = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).headers || [];

http.createServer(async (req, res) => {
  for (const rule of headerRules) for (const { key, value } of rule.headers) res.setHeader(key, value);
  const url = new URL(req.url, 'http://localhost');
  for (const [re, file, param] of routes) {
    const m = url.pathname.match(re);
    if (!m) continue;
    req.query = Object.fromEntries(url.searchParams);
    if (param) req.query[param] = decodeURIComponent(m[1]);
    const { default: handler } = await import(file);
    return handler(req, res);
  }
  let file = path.join(root, 'public', path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(root, 'public'))) { res.statusCode = 403; return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'public', 'index.html');
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(process.env.PORT || 3000, () => {
  console.log(`Job tracker running at http://localhost:${process.env.PORT || 3000}${process.env.MOCK === '1' ? '  (mock data, password: demo)' : ''}`);
});
