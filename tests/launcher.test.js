import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, healthIdentity } from '../server.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const launcher = path.join(root, 'scripts', 'launch.ps1');

function check(port, options = [], script = launcher) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-CheckOnly', '-NoBrowser', '-Port', String(port), '-NodePath', process.execPath, ...options], { cwd: path.dirname(root), windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

function spacedCopy(t, { dependencies = false } = {}) {
  const runtime = path.resolve(root, '.runtime');
  mkdirSync(runtime, { recursive: true });
  const directory = mkdtempSync(path.join(runtime, 'launcher path with spaces '));
  assert.ok(path.resolve(directory).startsWith(runtime + path.sep));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(runtime + path.sep));
    rmSync(directory, { recursive: true, force: true });
  });
  mkdirSync(path.join(directory, 'scripts'));
  copyFileSync(launcher, path.join(directory, 'scripts', 'launch.ps1'));
  for (const name of ['package.json', 'package-lock.json']) copyFileSync(path.join(root, name), path.join(directory, name));
  writeFileSync(path.join(directory, 'server.js'), '// CheckOnly never starts this file.\n');
  if (dependencies) {
    const pdf = path.join(directory, 'node_modules', 'pdfjs-dist');
    mkdirSync(pdf, { recursive: true });
    const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    writeFileSync(path.join(pdf, 'package.json'), JSON.stringify({ version: lock.packages['node_modules/pdfjs-dist'].version }));
    mkdirSync(path.join(pdf, 'legacy', 'build'), { recursive: true });
    writeFileSync(path.join(pdf, 'legacy', 'build', 'pdf.mjs'), '// CheckOnly checks presence without importing this fixture.\n');
  }
  return directory;
}

async function freePort() {
  const probe = http.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function fixture(t, response) {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(response)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server;
}

test('health handshake identifies this copy without exposing a filesystem path or invoking providers', async t => {
  let statusCalls = 0;
  const server = createServer({ aiStatus: async () => { statusCalls++; throw new Error('health must not probe a provider'); } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  const identity = await response.json();
  assert.deepEqual(identity, healthIdentity(root));
  assert.match(identity.rootFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(identity.pid, process.pid);
  assert.equal(Object.keys(identity).length, 4);
  assert.equal(statusCalls, 0);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('CheckOnly reuses a matching Afterlight handshake without starting a server or browser', { skip: process.platform !== 'win32' }, async t => {
  const server = await fixture(t, healthIdentity(root));
  const result = await check(server.address().port);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /already running.*verified PID/);
  assert.equal(server.listening, true);
});

test('CheckOnly leaves an unrelated port owner running and reports the collision', { skip: process.platform !== 'win32' }, async t => {
  const server = await fixture(t, { id: 'unrelated-fixture', pid: process.pid });
  const result = await check(server.address().port);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /already used by another application/);
  assert.equal(server.listening, true);
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/health`)).status, 200);
});

test('CheckOnly rejects a different Afterlight folder or version without terminating it', { skip: process.platform !== 'win32' }, async t => {
  const server = await fixture(t, { ...healthIdentity(root), rootFingerprint: '0'.repeat(64) });
  const result = await check(server.address().port);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /different Afterlight version or folder/);
  assert.equal(server.listening, true);
});

test('CheckOnly handles a spaced extracted path from another working directory without runtime writes', { skip: process.platform !== 'win32' }, async t => {
  const directory = spacedCopy(t, { dependencies: true });
  const result = await check(await freePort(), [], path.join(directory, 'scripts', 'launch.ps1'));
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Checks passed/);
  assert.equal(existsSync(path.join(directory, '.runtime')), false);
});

test('CheckOnly reports missing dependencies without installing or starting a server', { skip: process.platform !== 'win32' }, async t => {
  const directory = spacedCopy(t);
  const result = await check(await freePort(), [], path.join(directory, 'scripts', 'launch.ps1'));
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /locked dependencies are missing/);
  assert.equal(existsSync(path.join(directory, 'node_modules')), false);
  assert.equal(existsSync(path.join(directory, '.runtime')), false);
});
