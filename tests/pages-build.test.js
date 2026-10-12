import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPages, PAGES_FILES, BROWSER_CAPABILITIES } from '../scripts/build-pages.mjs';
import { createStudy, studyReportHTML } from '../studies.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
async function cleanup(path) { assert.ok(resolve(path).startsWith(dist + '\\') || resolve(path).startsWith(dist + '/')); await rm(path, { recursive: true, force: true }); }

test('Pages build includes the authored app and locked PDF resources while excluding private/server files', async () => {
  await mkdir(dist, { recursive: true }); const output = await mkdtemp(join(dist, '.pages-test-'));
  await cleanup(output);
  try {
    const { manifest } = await buildPages({ outDir: output }); const files = Object.keys(manifest.files);
    assert.deepEqual(manifest.capabilities, BROWSER_CAPABILITIES);
    assert.equal(manifest.pdfJsVersion, JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')).packages['node_modules/pdfjs-dist'].version);
    for (const file of PAGES_FILES) assert.ok(files.includes(file), file);
    assert.equal(await readFile(join(output, 'app.js'), 'utf8'), await readFile(join(root, 'app.js'), 'utf8'));
    for (const file of ['assets/mark.svg', 'assets/room-day.png', 'assets/room-night.png', 'assets/table-oak.png', 'vendor/pdfjs/pdf.mjs', 'vendor/pdfjs/pdf.worker.mjs', 'vendor/pdfjs/LICENSE', 'NOTICE', 'CREDITS.md', 'licenses/pdfjs-dist-LICENSE.txt', 'licenses/napi-rs-canvas-LICENSE.txt']) assert.ok(files.includes(file), file);
    for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
      for (const name of await readdir(join(root, 'node_modules', 'pdfjs-dist', folder))) if (name.startsWith('LICENSE')) assert.ok(files.includes(`vendor/pdfjs/${folder}/${name}`), name);
    }
    assert.ok(!files.some(file => /^(services|tests|scripts|qa|node_modules|openspec)\//.test(file) || ['server.js', 'package.json', 'package-lock.json', 'source-fixture.pdf'].includes(file)));
    assert.match(await readFile(join(output, 'runtime-capabilities.js'), 'utf8'), /"mode": "browser"/);
    assert.match(await readFile(join(root, 'runtime-capabilities.js'), 'utf8'), /mode: 'local-server'/);
    const index = await readFile(join(output, 'index.html'), 'utf8');
    for (const view of ['lab', 'desk', 'library', 'week', 'quiet']) assert.ok(index.includes(`id="${view}-view"`));
    assert.match(index, /afterlight-runtime" content="browser/); assert.match(index, /connect-src 'self'/);
    const css = studyReportHTML(createStudy({ projectId: 'pages-test' })).match(/<style>([\s\S]*?)<\/style>/)[1];
    assert.ok(index.includes(`sha256-${createHash('sha256').update(css).digest('base64')}`));
    const rebuilt = await buildPages({ outDir: output }); assert.deepEqual(rebuilt.manifest, manifest);
  } finally { await cleanup(output); }
});

test('Pages build refuses unsafe output paths and preserves an unrelated folder', async () => {
  await assert.rejects(buildPages({ outDir: root }), /dedicated folder/);
  await mkdir(dist, { recursive: true }); const output = await mkdtemp(join(dist, '.pages-test-'));
  await writeFile(join(output, 'keep.txt'), 'Preserve this file.');
  try { await assert.rejects(buildPages({ outDir: output }), /preserved/); assert.equal(await readFile(join(output, 'keep.txt'), 'utf8'), 'Preserve this file.'); }
  finally { await cleanup(output); }
});
