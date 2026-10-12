import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createServer, resolveStaticPath, validLocalRequest } from '../server.js';
import { validateAssistInput, validateAssistOutput, parseCodexEvents, buildPrompt, createAssistant } from '../services/ai.js';
import { extractPdf, pdfTitle } from '../services/pdf.js';

const source = { title: 'Recall', paragraphs: [{ id: 'p-1', text: 'Retrieval practice means recalling an idea before looking at the answer.' }, { id: 'p-2', text: 'A break can help someone return with a clear next step.' }] };
const input = { mode: 'explain', source, question: '', paragraphId: 'p-1' };
const output = { answer: 'Recall the idea first.', ideas: [{ title: 'Recall', explanation: 'Try remembering before rereading.', question: 'What do you remember?', paragraphId: 'p-1' }], citations: [{ paragraphId: 'p-1', quote: 'recalling an idea before looking at the answer' }] };

test('source validation rejects duplicate IDs, missing selections and excessive source', () => {
  assert.deepEqual(validateAssistInput(input), input);
  assert.throws(() => validateAssistInput({ ...input, source: { ...source, paragraphs: [...source.paragraphs, source.paragraphs[0]] } }), /unique/);
  assert.throws(() => validateAssistInput({ ...input, paragraphId: 'unknown' }), /missing/);
  assert.throws(() => validateAssistInput({ ...input, mode: 'question' }), /question first/);
  assert.throws(() => validateAssistInput({ ...input, source: { ...source, paragraphs: [{ id: 'p', text: 'x'.repeat(120001) }] } }), /120000/);
});

test('only literal quotations and known paragraph anchors are accepted', () => {
  assert.equal(validateAssistOutput(output, input).provider, 'Codex');
  assert.throws(() => validateAssistOutput({ ...output, citations: [{ paragraphId: 'p-1', quote: 'a made up result' }] }, input), /could not be found/);
  assert.throws(() => validateAssistOutput({ ...output, ideas: [{ ...output.ideas[0], paragraphId: 'unknown' }] }, input), /outside/);
  assert.throws(() => validateAssistOutput({ ...output, citations: [{ paragraphId: 'p-1', quote: '' }] }, input), /quotation/);
});

test('Codex JSONL is parsed without evaluating model text and tool events are rejected', () => {
  const event = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(output) } });
  assert.deepEqual(parseCodexEvents('a CLI warning\n' + event + '\n'), output);
  assert.throws(() => parseCodexEvents(JSON.stringify({ type: 'item.started', item: { type: 'command_execution' } })), /tool action/);
  assert.throws(() => parseCodexEvents(event + '\n{"type":"turn.failed"}'), /could not complete/);
  assert.match(buildPrompt(input), /untrusted DATA/);
});

test('AI accepts one request at a time, supplies restrictions and releases its slot after completion', async () => {
  let release;
  let captured;
  const reading = createAssistant({ status: async () => ({ available: true }), run: async (args, prompt) => {
    captured = { args, prompt };
    await new Promise(resolve => { release = resolve; });
    return { code: 0, stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(output) } }) };
  } });
  const first = reading(input);
  await Promise.resolve();
  await assert.rejects(reading(input), error => error.status === 429);
  assert.ok(captured.args.includes('read-only'));
  assert.ok(captured.args.includes('--ignore-user-config'));
  assert.ok(captured.args.includes('features.shell_tool=false'));
  assert.ok(captured.args.includes('web_search="disabled"'));
  assert.ok(!captured.args.includes('--model'));
  assert.ok(captured.prompt.includes(source.paragraphs[0].text));
  release();
  assert.equal((await first).provider, 'Codex');
  const next = reading(input);
  await Promise.resolve();
  release();
  await next;
});

test('cancellation before inference sends no source and releases the busy slot', async () => {
  let sent = 0;
  const reading = createAssistant({ status: async () => ({ available: true }), run: async () => { sent++; throw new Error('unexpected call'); } });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(reading(input, { signal: controller.signal }), error => error.code === 'cancelled');
  await assert.rejects(reading(input, { signal: controller.signal }), error => error.code === 'cancelled');
  assert.equal(sent, 0);
});

function textPdf({ text = 'Real PDF text extraction works.', pages = 1 } = {}) {
  const safe = text.replace(/[\\()]/g, '\\$&');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (let i = 0; i < pages; i++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    const content = text ? `BT /F1 12 Tf 72 720 Td (${safe}) Tj ET` : '';
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  let result = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(result)); result += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}

test('PDF.js extracts actual page text and rejects unreadable, empty and over-page files', async () => {
  const result = await extractPdf(textPdf(), 'Real%20notes.pdf');
  assert.equal(result.title, 'Real notes');
  assert.equal(result.pages[0].page, 1);
  assert.match(result.text, /Real PDF text extraction works/);
  await assert.rejects(extractPdf(Buffer.from('not a pdf'), 'bad.pdf'), /not a readable PDF/);
  await assert.rejects(extractPdf(textPdf({ text: '' }), 'scan.pdf'), /no selectable text/);
  await assert.rejects(extractPdf(textPdf({ pages: 81 }), 'long.pdf'), /80 pages/);
  assert.equal(pdfTitle('C:\\folder\\my.pdf'), 'my');
});

test('static paths and request origins reject traversal and unrelated hosts', () => {
  assert.throws(() => resolveStaticPath('/%2e%2e/private.js'), /not public/);
  assert.throws(() => resolveStaticPath('/services/ai.js'), /not public/);
  assert.throws(() => resolveStaticPath('/server.js'), /not public/);
  assert.throws(() => resolveStaticPath('/%zz'), /invalid/);
  const req = { method: 'POST', socket: { localPort: 5180 }, headers: { host: '127.0.0.1:5180', origin: 'http://127.0.0.1:5180' } };
  assert.equal(validLocalRequest(req), true);
  assert.equal(validLocalRequest({ ...req, headers: { ...req.headers, origin: 'https://evil.example' } }), false);
  assert.equal(validLocalRequest({ ...req, headers: { host: 'evil.example:5180' } }), false);
});

test('HTTP API returns real PDF text, rejects cross-origin writes and exposes no service code', async t => {
  let calls = 0;
  const server = createServer({ aiStatus: async () => ({ available: true, provider: 'Codex', message: 'Test transport' }), aiAssist: async value => { calls++; return validateAssistOutput(output, validateAssistInput(value)); } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = await fetch(base + '/api/status');
  assert.equal((await status.json()).pdf, true);
  assert.match(status.headers.get('content-security-policy'), /script-src 'self'/);
  const imported = await fetch(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-filename': 'notes.pdf' }, body: textPdf() });
  assert.equal(imported.status, 200);
  assert.match((await imported.json()).text, /Real PDF/);
  const forbidden = await fetch(base + '/api/assist', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify(input) });
  assert.equal(forbidden.status, 403);
  assert.equal(calls, 0);
  const reply = await fetch(base + '/api/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(reply.status, 200);
  assert.equal(calls, 1);
  assert.equal((await reply.json()).citations.length, 1);
  assert.equal((await fetch(base + '/services/ai.js')).status, 403);
  const oversized = await fetch(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.alloc(20 * 1024 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  const chunkedStatus = await new Promise((resolveStatus, reject) => {
    const req = request(base + '/api/assist', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, res => { res.resume(); res.once('end', () => resolveStatus(res.statusCode)); });
    req.on('error', reject);
    req.write(Buffer.alloc(768 * 1024));
    req.end(Buffer.alloc(1));
  });
  assert.equal(chunkedStatus, 413);
});
