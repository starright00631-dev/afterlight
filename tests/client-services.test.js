import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientServices, HOSTED_ASSISTANT_MESSAGE, LOCAL_PDF_UNAVAILABLE_MESSAGE, LOCAL_PDF_RESPONSE_MESSAGE } from '../client-services.js';
import { RUNTIME_CAPABILITIES } from '../runtime-capabilities.js';
import { BROWSER_PDF_LIMITS, createBrowserPdfReader } from '../browser-pdf.js';

const hosted = { mode: 'browser', assistants: false, pdf: 'browser', storage: 'browser-local' };
test('hosted capabilities never send sources or credentials to server routes', async () => {
  let sent = 0, read = 0;
  const settings = { ...hosted };
  const client = createClientServices({ capabilities: settings, fetcher: async () => { sent++; throw Error('Unexpected request'); }, browserPdfReader: async (file, name, signal) => { read++; assert.equal(name, 'private.pdf'); assert.equal(file.name, name); assert.ok(signal); return { text: 'Read locally.' }; } });
  const inventory = await client.providerInventory();
  assert.equal(inventory.providers[0].available, false);
  assert.equal(inventory.providers[0].message, HOSTED_ASSISTANT_MESSAGE);
  settings.assistants = true;
  await assert.rejects(client.connectProvider({ apiKey: 'test-secret' }), /local app/);
  await assert.rejects(client.disconnectProvider({ id: 'compatible' }), /local app/);
  await assert.rejects(client.assist({ source: { text: 'private source' } }), /local app/);
  assert.deepEqual(await client.readPdf({ name: 'private.pdf' }, { signal: new AbortController().signal }), { text: 'Read locally.' });
  assert.equal(sent, 0); assert.equal(read, 1);
  assert.throws(() => createClientServices({ capabilities: { ...hosted, assistants: true } }), /cannot enable/);
});

test('local server mode retains explicit status, provider, assistant and PDF routes', async () => {
  assert.equal(RUNTIME_CAPABILITIES.mode, 'local-server');
  const calls = [], signal = new AbortController().signal;
  const client = createClientServices({ fetcher: async (url, options) => { calls.push({ url, options }); return Response.json(url === '/api/import' ? { title: 'Original name', text: 'Selectable text.', pages: [{ page: 1, text: 'Selectable text.' }] } : { ok: true }); } });
  await client.providerInventory(); await client.connectProvider({ id: 'compatible', apiKey: 'test-secret' }); await client.disconnectProvider({ id: 'compatible' });
  await client.assist({ source: { title: 'A source' } }, { signal });
  const file = { name: 'Original name.pdf' }; await client.readPdf(file, { signal });
  assert.deepEqual(calls.map(call => call.url), ['/api/status', '/api/providers/connect', '/api/providers/disconnect', '/api/assist', '/api/import']);
  assert.equal(JSON.parse(calls[1].options.body).apiKey, 'test-secret');
  assert.strictEqual(calls[3].options.signal, signal);
  assert.strictEqual(calls[4].options.body, file);
  assert.equal(calls[4].options.headers['X-Filename'], 'Original%20name.pdf');
  const failing = createClientServices({ fetcher: async () => Response.json({ error: 'The provider rejected this request.' }, { status: 422 }) });
  await assert.rejects(failing.assist({}), /provider rejected/);
});

test('pre-cancelled imports perform no upload or browser parsing', async () => {
  let started = 0; const controller = new AbortController(); controller.abort();
  for (const capabilities of [RUNTIME_CAPABILITIES, hosted]) {
    const client = createClientServices({ capabilities, fetcher: async () => { started++; }, browserPdfReader: async () => { started++; } });
    await assert.rejects(client.readPdf({ name: 'x.pdf' }, { signal: controller.signal }), error => error.name === 'AbortError');
  }
  assert.equal(started, 0);
});

test('local PDF errors explain an offline reader, unreadable replies and malformed success without masking PDF failures', async () => {
  const file = { name: 'Synthetic.pdf' };
  const unavailable = createClientServices({ fetcher: async () => { throw TypeError('Failed to fetch'); } });
  await assert.rejects(unavailable.readPdf(file), error => error.message === LOCAL_PDF_UNAVAILABLE_MESSAGE);
  for (const response of [new Response('<!doctype html>', { status: 404 }), Response.json({ ok: true }), Response.json({ title: 'Source', text: 'wrong', pages: [{ page: 1, text: 'Original.' }] }), Response.json(null)]) {
    const client = createClientServices({ fetcher: async () => response });
    await assert.rejects(client.readPdf(file), error => error.message === LOCAL_PDF_RESPONSE_MESSAGE);
  }
  for (const message of ['This PDF has no selectable text.', 'This PDF is password protected.', 'Choose a PDF with 80 pages or fewer.', 'Choose a PDF smaller than 20 MB.']) {
    const client = createClientServices({ fetcher: async () => Response.json({ error: message }, { status: 422 }) });
    await assert.rejects(client.readPdf(file), error => error.message === message);
  }
});

test('local PDF cancellation remains an AbortError before, during and after the response', async () => {
  const original = new DOMException('The operation was aborted.', 'AbortError');
  const interrupted = createClientServices({ fetcher: async () => { throw original; } });
  await assert.rejects(interrupted.readPdf({ name: 'Synthetic.pdf' }), error => error === original);
  const controller = new AbortController();
  const cancelled = createClientServices({ fetcher: async () => { controller.abort(); return Response.json({ error: 'Do not display a stale error.' }, { status: 422 }); } });
  await assert.rejects(cancelled.readPdf({ name: 'Synthetic.pdf' }, { signal: controller.signal }), error => error.name === 'AbortError');
  const bodyController = new AbortController();
  const whileParsing = createClientServices({ fetcher: async () => ({ ok: true, json: async () => { bodyController.abort(); throw SyntaxError('Response interrupted'); } }) });
  await assert.rejects(whileParsing.readPdf({ name: 'Synthetic.pdf' }, { signal: bodyController.signal }), error => error.name === 'AbortError');
});

// Synthetic PDF created solely to check selectable-text extraction; it contains no user material.
function textPdf(text = 'Browser PDF extraction works.', pages = 1) {
  const safe = text.replace(/[\\()]/g, '\\$&');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (let i = 0; i < pages; i++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    const content = text ? `BT /F1 12 Tf 72 720 Td (${safe}) Tj ET` : '';
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  let result = '%PDF-1.4\n'; const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(result)); result += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([result], { type: 'application/pdf' });
}
const readRealPdf = createBrowserPdfReader({ loadPdfJs: () => import('pdfjs-dist/legacy/build/pdf.mjs'), resourceBase: new URL('../node_modules/pdfjs-dist/', import.meta.url).href, workerUrl: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href });

test('browser reader extracts a real digital PDF with the locked parser', async () => {
  const result = await readRealPdf(textPdf('Original selectable text.', 2), 'Reading%20file.pdf');
  assert.equal(result.title, 'Reading file');
  assert.deepEqual(result.pages, [{ page: 1, text: 'Original selectable text.' }, { page: 2, text: 'Original selectable text.' }]);
  assert.equal(result.text, 'Original selectable text.\n\nOriginal selectable text.');
});

test('browser reader mirrors byte, page, text and no-OCR limits', async () => {
  await assert.rejects(readRealPdf({ size: BROWSER_PDF_LIMITS.bytes + 1 }, 'large.pdf'), /20 MB/);
  await assert.rejects(readRealPdf(new Blob(['not a PDF']), 'bad.pdf'), /not a readable PDF/);
  await assert.rejects(readRealPdf(textPdf('Too many pages.', 81), 'pages.pdf'), /80 pages/);
  const textLimitReader = createBrowserPdfReader({ loadPdfJs: async () => ({ GlobalWorkerOptions: {}, getDocument() { return { promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'x'.repeat(120001) }] }), cleanup() {} }) }), destroy: async () => {} }; } }) });
  await assert.rejects(textLimitReader(textPdf(), 'long.pdf'), /120,000/);
  await assert.rejects(readRealPdf(textPdf(''), 'scan.pdf'), /no selectable text/);
});

test('browser parser uses only configured same-origin resources and disables evaluation', async () => {
  let options; const module = { GlobalWorkerOptions: {}, getDocument(value) { options = value; return { promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'A passage.', hasEOL: true }] }), cleanup() {} }) }), destroy: async () => {} }; } };
  const base = 'https://starright00631-dev.github.io/afterlight/vendor/pdfjs/';
  const read = createBrowserPdfReader({ loadPdfJs: async () => module, resourceBase: base });
  assert.equal((await read(textPdf(), 'source.pdf')).text, 'A passage.');
  assert.equal(module.GlobalWorkerOptions.workerSrc, base + 'pdf.worker.mjs');
  assert.equal(options.cMapUrl, base + 'cmaps/'); assert.equal(options.standardFontDataUrl, base + 'standard_fonts/');
  assert.equal(options.wasmUrl, base + 'wasm/'); assert.equal(options.iccUrl, base + 'iccs/');
  assert.equal(options.isEvalSupported, false); assert.equal(options.enableXfa, false); assert.equal(options.stopAtErrors, true);
});

test('cancelling a running browser PDF destroys its task and returns no source', async () => {
  let rejectTask, started, destroyed = 0; const ready = new Promise(resolve => { started = resolve; });
  const module = { GlobalWorkerOptions: {}, getDocument() { const promise = new Promise((resolve, reject) => { rejectTask = reject; }); started(); return { promise, destroy: async () => { destroyed++; rejectTask(Error('Loading task destroyed')); } }; } };
  const read = createBrowserPdfReader({ loadPdfJs: async () => module }); const controller = new AbortController();
  const pending = read(textPdf(), 'source.pdf', controller.signal); await ready; controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError'); assert.ok(destroyed >= 1);
});
