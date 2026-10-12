import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createProviderRouter } from '../services/providers.js';
import { assistCompatible, normalizeBaseUrl, parseAssistantJson, probeCompatible, validateConnection } from '../services/compatible.js';
import { parseClaudeResult } from '../services/claude.js';
import { validateAssistInput, validateAssistOutput } from '../services/ai.js';
import { createServer } from '../server.js';

const source = { title: 'Original note', paragraphs: [{ id: 'p-1', text: 'An explicit next action makes it easier to resume the work.' }] };
const input = { mode: 'explain', source, question: '', paragraphId: 'p-1' };
const answer = { answer: 'Write a concrete place to begin next time.', ideas: [{ title: 'A restart point', explanation: 'Make the next action explicit.', question: 'What would you do first?', paragraphId: 'p-1' }], citations: [{ paragraphId: 'p-1', quote: 'An explicit next action' }] };
const codexStatus = async () => ({ available: true, provider: 'Codex', message: 'Signed in' });
const claudeStatus = async () => ({ id: 'claude', name: 'Claude', kind: 'cli', configured: true, reachable: true, authenticated: false, available: false, model: null, message: 'Fixture CLI signed out' });

async function fixture(t, handler) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    seen.push({ path: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
    res.setHeader('Content-Type', 'application/json');
    if (handler) return handler(req, res, seen.at(-1));
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }));
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, seen };
}

test('connection URL and credential binding prevent insecure remote transport or key relocation', () => {
  assert.equal(normalizeBaseUrl('http://localhost:11434/v1/'), 'http://localhost:11434/v1');
  assert.throws(() => normalizeBaseUrl('http://api.example/v1'), /HTTPS/);
  assert.throws(() => normalizeBaseUrl('https://user:pass@api.example/v1'), /key field/);
  assert.throws(() => normalizeBaseUrl('https://api.example/v1?key=secret'), /key field/);
  assert.throws(() => normalizeBaseUrl('https://api.example/v1/chat/completions'), /base URL/);
  const first = validateConnection({ id: 'compatible', baseUrl: 'https://first.example/v1', model: 'm', apiKey: 'NON_SECRET_FIXTURE_VALUE' });
  assert.equal(validateConnection({ id: 'compatible', model: 'other' }, first).apiKey, first.apiKey);
  assert.equal(validateConnection({ id: 'compatible', baseUrl: 'https://second.example/v1', model: 'm' }, first).apiKey, '');
  assert.equal(validateConnection({ id: 'compatible', model: 'm', apiKey: '' }, first).apiKey, '');
  assert.throws(() => validateConnection({ id: 'deepseek', baseUrl: 'https://another.example/v1', model: 'm' }), /custom endpoints/);
});

test('real HTTP model discovery and reading response pass through the neutral router without tool requests', async t => {
  const api = await fixture(t);
  const router = createProviderRouter({ env: {}, codexStatus, claudeStatus, codexAssist: async raw => validateAssistOutput(answer, validateAssistInput(raw)) });
  const connected = await router.connect({ id: 'compatible', baseUrl: api.baseUrl, model: 'fixture-model', responseFormat: 'schema', apiKey: 'NON_SECRET_FIXTURE_VALUE' });
  assert.equal(connected.provider.configured, true);
  assert.equal(connected.provider.reachable, true);
  assert.equal(connected.provider.available, true);
  assert.equal(connected.provider.authenticated, null, 'a public models endpoint does not verify the key');
  assert.ok(!JSON.stringify(connected).includes('NON_SECRET_FIXTURE_VALUE'));
  const response = await router.assist({ ...input, providerId: 'compatible' });
  assert.equal(response.providerId, 'compatible');
  assert.equal(response.citations[0].quote, answer.citations[0].quote);
  const request = api.seen.find(entry => entry.path.endsWith('/chat/completions'));
  assert.equal(request.body.model, 'fixture-model');
  assert.equal(request.body.response_format.type, 'json_schema');
  assert.equal(request.body.tools, undefined);
  assert.ok(request.body.messages[1].content.includes(source.paragraphs[0].text));
  assert.ok(!JSON.stringify(request.body).includes('NON_SECRET_FIXTURE_VALUE'));
  const legacy = await router.assist(input);
  assert.equal(legacy.provider, 'Codex');
  assert.equal(legacy.providerId, 'codex');
  const disconnected = await router.disconnect({ id: 'compatible' });
  assert.equal(disconnected.provider.configured, false);
  assert.equal(disconnected.provider.keyConfigured, false);
});

test('authentication is confirmed only against a protected model list; failures do not leak server error text', async t => {
  const api = await fixture(t, (req, res) => {
    if (req.url.endsWith('/models') && req.headers.authorization === 'Bearer NON_SECRET_FIXTURE_VALUE') return res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }));
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'server tried to echo NON_SECRET_FIXTURE_VALUE' }));
  });
  const config = validateConnection({ id: 'compatible', baseUrl: api.baseUrl, model: 'fixture-model', apiKey: 'NON_SECRET_FIXTURE_VALUE' });
  assert.equal((await probeCompatible(config)).authenticated, true);
  const rejected = await probeCompatible({ ...config, apiKey: 'WRONG_FIXTURE_VALUE' });
  assert.equal(rejected.available, false);
  assert.equal(rejected.reachable, true);
  assert.equal(rejected.authenticated, false);
  assert.ok(!rejected.message.includes('NON_SECRET_FIXTURE_VALUE'));
  await assert.rejects(assistCompatible(config, validateAssistInput(input)), error => error.code === 'provider_auth' && !error.message.includes('NON_SECRET_FIXTURE_VALUE'));
});

test('configured but unreachable or missing-model providers never claim availability', async t => {
  const api = await fixture(t);
  const config = validateConnection({ id: 'compatible', baseUrl: api.baseUrl, model: 'missing' });
  const missing = await probeCompatible(config);
  assert.equal(missing.configured, true);
  assert.equal(missing.reachable, true);
  assert.equal(missing.available, false);
  const unreachable = await probeCompatible({ ...config, baseUrl: 'http://127.0.0.1:1/v1' }, { timeout: 200 });
  assert.equal(unreachable.configured, true);
  assert.equal(unreachable.reachable, false);
  assert.equal(unreachable.available, false);
});

test('HTTP assistance rejects fabricated citations, tool calls and credential echoes', async t => {
  let mode = 'citation';
  const api = await fixture(t, (req, res) => {
    let message = { content: JSON.stringify({ ...answer, citations: [{ paragraphId: 'p-1', quote: 'invented quotation' }] }) };
    if (mode === 'tools') message = { tool_calls: [{ id: 'tool', function: { name: 'run' } }], content: '{}' };
    if (mode === 'secret') message = { content: JSON.stringify({ ...answer, answer: 'NON_SECRET_FIXTURE_VALUE' }) };
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message }] }));
  });
  const config = validateConnection({ id: 'compatible', baseUrl: api.baseUrl, model: 'fixture-model', apiKey: 'NON_SECRET_FIXTURE_VALUE' });
  await assert.rejects(assistCompatible(config, validateAssistInput(input)), error => error.code === 'invalid_ai_citation');
  mode = 'tools';
  await assert.rejects(assistCompatible(config, validateAssistInput(input)), error => error.code === 'unexpected_ai_tool');
  mode = 'secret';
  await assert.rejects(assistCompatible(config, validateAssistInput(input)), error => error.code === 'provider_secret_output');
  assert.deepEqual(parseAssistantJson('```json\n' + JSON.stringify(answer) + '\n```'), answer);
  assert.deepEqual(parseClaudeResult(JSON.stringify({ is_error: false, structured_output: answer })), answer);
  assert.throws(() => parseClaudeResult(JSON.stringify({ is_error: true })), /could not complete/);
});

test('provider HTTP timeout and user cancellation are distinguished', async t => {
  const api = await fixture(t, (req, res) => { setTimeout(() => { if (!res.destroyed) res.end('{}'); }, 100); });
  const config = validateConnection({ id: 'compatible', baseUrl: api.baseUrl, model: 'fixture-model' });
  await assert.rejects(assistCompatible(config, validateAssistInput(input), { timeout: 15 }), error => error.code === 'ai_timeout');
  const controller = new AbortController();
  const pending = assistCompatible(config, validateAssistInput(input), { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error.code === 'cancelled');
});

test('the router rejects overlapping requests across providers and releases its shared slot', async () => {
  let release;
  let claudeCalls = 0;
  const router = createProviderRouter({ env: {}, codexStatus, claudeStatus,
    codexAssist: async () => { await new Promise(resolve => { release = resolve; }); return { provider: 'Codex', ...answer }; },
    claudeAssist: async () => { claudeCalls++; return { provider: 'Claude', ...answer }; },
  });
  const first = router.assist(input);
  await assert.rejects(router.assist({ ...input, providerId: 'claude' }), error => error.code === 'ai_busy' && error.status === 429);
  assert.equal(claudeCalls, 0);
  release();
  await first;
  assert.equal((await router.assist({ ...input, providerId: 'claude' })).providerId, 'claude');
  assert.equal(claudeCalls, 1);
});

test('API response size is bounded and redirects cannot forward a connection key', async t => {
  let mode = 'redirect';
  const api = await fixture(t, (req, res) => {
    if (mode === 'redirect') { res.writeHead(302, { Location: 'https://unrelated.example/v1/chat/completions' }); return res.end('{}'); }
    res.setHeader('Content-Length', 1024 * 1024 + 1);
    res.end('x'.repeat(1024 * 1024 + 1));
  });
  const config = validateConnection({ id: 'compatible', baseUrl: api.baseUrl, model: 'fixture-model', apiKey: 'NON_SECRET_FIXTURE_VALUE' });
  await assert.rejects(assistCompatible(config, validateAssistInput(input)), error => error.code === 'provider_http' && /302/.test(error.message));
  assert.equal(api.seen.length, 1);
  mode = 'size';
  await assert.rejects(assistCompatible(config, validateAssistInput(input)), error => error.code === 'provider_response_size');
});

test('connection HTTP routes preserve local origin restrictions and expose only sanitized provider status', async t => {
  const api = await fixture(t);
  const router = createProviderRouter({ env: {}, codexStatus, claudeStatus });
  const server = createServer({ providerRouter: router, aiStatus: codexStatus });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({ id: 'compatible', baseUrl: api.baseUrl, model: 'fixture-model', apiKey: 'NON_SECRET_FIXTURE_VALUE' });
  const blocked = await fetch(base + '/api/providers/connect', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body });
  assert.equal(blocked.status, 403);
  const connected = await fetch(base + '/api/providers/connect', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body });
  assert.equal(connected.status, 200);
  assert.ok(!(await connected.text()).includes('NON_SECRET_FIXTURE_VALUE'));
  const status = await (await fetch(base + '/api/status')).json();
  assert.equal(status.ai.provider, 'Codex');
  assert.equal(status.defaultProvider, 'codex');
  assert.deepEqual(status.providers.map(provider => provider.id), ['codex', 'claude', 'ollama', 'deepseek', 'compatible']);
  assert.ok(!JSON.stringify(status).includes('NON_SECRET_FIXTURE_VALUE'));
  const reply = await fetch(base + '/api/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, providerId: 'compatible' }) });
  assert.equal(reply.status, 200);
  assert.equal((await reply.json()).providerId, 'compatible');
});
