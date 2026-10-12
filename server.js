import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getAiStatus } from './services/ai.js';
import { providerRouter as defaultProviderRouter } from './services/providers.js';
import { extractPdf, PDF_LIMITS } from './services/pdf.js';
import { HttpError } from './services/errors.js';

const root = dirname(fileURLToPath(import.meta.url));
const applicationPackage = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
export function healthIdentity(directory = root) {
  const normalizedRoot = resolve(directory).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  return { id: 'afterlight-local', version: applicationPackage.version, pid: process.pid,
    rootFingerprint: createHash('sha256').update(normalizedRoot, 'utf8').digest('hex') };
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

export function validLocalRequest(req) {
  let host;
  try { host = new URL(`http://${req.headers.host}`); } catch { return false; }
  if (!['localhost', '127.0.0.1'].includes(host.hostname) || host.username || host.password || host.pathname !== '/') return false;
  if (Number(host.port || 80) !== req.socket.localPort) return false;
  if (req.method === 'POST') {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    const origin = req.headers.origin;
    if (origin && origin !== host.origin) return false;
  }
  return true;
}

export async function readBody(req, limit, signal) {
  const length = Number(req.headers['content-length']);
  if (Number.isFinite(length) && length > limit) {
    req.resume();
    throw new HttpError(413, 'body_size', 'This request is too large. Choose a shorter excerpt or smaller file.');
  }
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      req.removeListener('data', data);
      req.removeListener('end', end);
      req.removeListener('error', error);
      signal?.removeEventListener('abort', cancel);
    };
    const fail = failure => { cleanup(); req.resume(); reject(failure); };
    const cancel = () => fail(new HttpError(499, 'cancelled', 'The request was cancelled.'));
    const data = chunk => {
      size += chunk.length;
      if (size > limit) return fail(new HttpError(413, 'body_size', 'This request is too large. Choose a shorter excerpt or smaller file.'));
      chunks.push(chunk);
    };
    const end = () => { cleanup(); resolveBody(Buffer.concat(chunks, size)); };
    const error = () => fail(new HttpError(400, 'body_read', 'The uploaded data could not be read.'));
    req.on('data', data);
    req.once('end', end);
    req.once('error', error);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}

export function resolveStaticPath(pathname, directory = root) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'invalid_path', 'The requested path is invalid.'); }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(part => part === '..' || part === '.' || part.startsWith('.'))) throw new HttpError(403, 'forbidden', 'This path is not public.');
  const path = resolve(directory, `.${decoded === '/' ? '/index.html' : decoded}`);
  const rel = relative(directory, path);
  if (rel.startsWith(`..${sep}`) || rel === '..' || !rel || /^(services|tests|node_modules|scripts)([\\/]|$)/i.test(rel) || ['server.js', 'package.json', 'package-lock.json'].includes(rel.toLowerCase()) || !mime[extname(path).toLowerCase()]) throw new HttpError(403, 'forbidden', 'This path is not public.');
  return path;
}

function headers(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
}

function json(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

export function createServer({ directory = root, providerRouter = defaultProviderRouter, aiAssist = providerRouter.assist, aiStatus = getAiStatus, pdfImport = extractPdf } = {}) {
  const server = http.createServer(async (req, res) => {
    headers(res);
    const controller = new AbortController();
    req.once('aborted', () => controller.abort());
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      if (!validLocalRequest(req)) throw new HttpError(403, 'local_only', 'Afterlight accepts requests from its own localhost page only.');
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, healthIdentity(directory));
      if (url.pathname === '/api/status' && req.method === 'GET') {
        const [ai, providers] = await Promise.all([aiStatus(), providerRouter.status({ fresh: url.searchParams.get('fresh') === '1', signal: controller.signal })]);
        return json(res, 200, { ai, pdf: true, ...providers });
      }
      if (['/api/providers/connect', '/api/providers/disconnect'].includes(url.pathname) && req.method === 'POST') {
        if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'json_type', 'Send connection settings as JSON.');
        let input;
        try { input = JSON.parse((await readBody(req, 16 * 1024, controller.signal)).toString('utf8')); }
        catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'invalid_json', 'The connection request is not valid JSON.'); }
        const operation = url.pathname.endsWith('/disconnect') ? providerRouter.disconnect : providerRouter.connect;
        return json(res, 200, await operation(input, { signal: controller.signal }));
      }
      if (url.pathname === '/api/import' && req.method === 'POST') {
        if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/pdf') throw new HttpError(415, 'pdf_type', 'Upload a PDF using application/pdf.');
        const data = await readBody(req, PDF_LIMITS.bytes, controller.signal);
        return json(res, 200, await pdfImport(data, req.headers['x-filename'] || '', controller.signal));
      }
      if (url.pathname === '/api/assist' && req.method === 'POST') {
        if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'json_type', 'Send the reading request as JSON.');
        const bytes = await readBody(req, 768 * 1024, controller.signal);
        let input;
        try { input = JSON.parse(bytes.toString('utf8')); } catch { throw new HttpError(400, 'invalid_json', 'The reading request is not valid JSON.'); }
        return json(res, 200, await aiAssist(input, { signal: controller.signal }));
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'not_found', 'This API route does not exist.');
      if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'method', 'Use GET to read this page.');
      const path = resolveStaticPath(url.pathname, directory);
      let actual;
      try { actual = await realpath(path); } catch (error) { if (error.code === 'ENOENT') throw new HttpError(404, 'not_found', 'This file does not exist.'); throw error; }
      const rel = relative(await realpath(directory), actual);
      if (rel.startsWith(`..${sep}`) || rel === '..') throw new HttpError(403, 'forbidden', 'This path is not public.');
      const info = await stat(actual);
      if (!info.isFile()) throw new HttpError(404, 'not_found', 'This file does not exist.');
      res.writeHead(200, { 'Content-Type': mime[extname(path).toLowerCase()], 'Content-Length': info.size });
      res.end(req.method === 'HEAD' ? undefined : await readFile(actual));
    } catch (error) {
      const expected = error instanceof HttpError;
      if (!expected) console.error('Afterlight request failed:', error.name, error.code || 'internal');
      json(res, expected ? error.status : 500, { error: expected ? error.message : 'The local service could not complete this request.', code: expected ? error.code : 'internal' });
    }
  });
  server.requestTimeout = 150000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 5180);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a number from 1 to 65535.');
  const server = createServer();
  server.on('error', error => { console.error(`Afterlight could not start (${error.code || error.name}).`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Afterlight is ready at http://127.0.0.1:${port}`));
}
