import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPages, createBrowserGraph, PAGES_FILES, BROWSER_CAPABILITIES } from '../scripts/build-pages.mjs';
import { createStudy, studyReportHTML } from '../studies.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
async function cleanup(path) { assert.ok(resolve(path).startsWith(dist + '\\') || resolve(path).startsWith(dist + '/')); await rm(path, { recursive: true, force: true }); }
const normalize = text => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const moduleReferences = text => [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.\/[^'"\r\n]+)\1/g)].map(match => match[2]);

test('Pages build includes the authored app and locked PDF resources while excluding private/server files', async () => {
  await mkdir(dist, { recursive: true }); const output = await mkdtemp(join(dist, '.pages-test-'));
  await cleanup(output);
  try {
    const { manifest } = await buildPages({ outDir: output }); const files = Object.keys(manifest.files);
    assert.deepEqual(manifest.capabilities, BROWSER_CAPABILITIES);
    assert.equal(manifest.pdfJsVersion, JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')).packages['node_modules/pdfjs-dist'].version);
    for (const file of PAGES_FILES) assert.ok(files.includes(file), file);
    assert.match(manifest.buildId, /^[0-9a-f]{64}$/);
    assert.equal((await readFile(join(output, 'app.js'), 'utf8')).replace(/\?build=[0-9a-f]{64}/g, ''), normalize(await readFile(join(root, 'app.js'), 'utf8')));
    let moduleCount = 0;
    for (const file of PAGES_FILES.filter(file => file.endsWith('.js'))) {
      const body = await readFile(join(output, file), 'utf8'); assert.ok(!body.includes('\r'));
      for (const specifier of moduleReferences(body)) {
        if (specifier.startsWith('./vendor/')) { assert.equal(specifier, './vendor/pdfjs/pdf.mjs'); continue; }
        const target = new URL(specifier, 'https://pages.test/afterlight/');
        assert.equal(target.searchParams.get('build'), manifest.buildId, `${file}: ${specifier}`);
        assert.ok(files.includes(target.pathname.replace('/afterlight/', '')));
        moduleCount++;
      }
    }
    assert.ok(moduleCount >= 25);
    assert.equal(await readFile(join(output, 'vendor/pdfjs/pdf.mjs'), 'utf8'), await readFile(join(root, 'node_modules/pdfjs-dist/build/pdf.mjs'), 'utf8'));
    for (const file of ['assets/mark.svg', 'assets/room-day.png', 'assets/room-night.png', 'assets/table-oak.png', 'assets/table-oak-refined.png', 'assets/reading-book.png', 'assets/lamp-brass.png', 'docs/table-material-prompts.md', 'vendor/pdfjs/pdf.mjs', 'vendor/pdfjs/pdf.worker.mjs', 'vendor/pdfjs/LICENSE', 'NOTICE', 'CREDITS.md', 'licenses/pdfjs-dist-LICENSE.txt', 'licenses/napi-rs-canvas-LICENSE.txt']) assert.ok(files.includes(file), file);
    for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
      for (const name of await readdir(join(root, 'node_modules', 'pdfjs-dist', folder))) if (name.startsWith('LICENSE')) assert.ok(files.includes(`vendor/pdfjs/${folder}/${name}`), name);
    }
    assert.ok(!files.some(file => /^(services|tests|scripts|qa|node_modules|openspec)\//.test(file) || ['server.js', 'package.json', 'package-lock.json', 'source-fixture.pdf'].includes(file)));
    assert.match(await readFile(join(output, 'runtime-capabilities.js'), 'utf8'), /"mode": "browser"/);
    assert.match(await readFile(join(root, 'runtime-capabilities.js'), 'utf8'), /mode: 'local-server'/);
    const index = await readFile(join(output, 'index.html'), 'utf8');
    for (const view of ['lab', 'desk', 'library', 'week', 'quiet']) assert.ok(index.includes(`id="${view}-view"`));
    assert.match(index, /afterlight-runtime" content="browser/); assert.match(index, /connect-src 'self'/);
    for (const file of ['app.js', 'style.css', 'studio.css', 'calendar-overview.css']) assert.ok(index.includes(`./${file}?build=${manifest.buildId}`));
    assert.ok(index.includes(`name="afterlight-build" content="${manifest.buildId}"`));
    const client = await readFile(join(output, 'client-services.js'), 'utf8'), pdfReader = await readFile(join(output, 'browser-pdf.js'), 'utf8');
    assert.ok(client.includes(`import('./browser-pdf.js?build=${manifest.buildId}')`));
    assert.ok(pdfReader.includes(`from './client-services.js?build=${manifest.buildId}'`));
    const css = studyReportHTML(createStudy({ projectId: 'pages-test' })).match(/<style>([\s\S]*?)<\/style>/)[1];
    assert.ok(index.includes(`sha256-${createHash('sha256').update(css).digest('base64')}`));
    const rebuilt = await buildPages({ outDir: output }); assert.deepEqual(rebuilt.manifest, manifest);
  } finally { await cleanup(output); }
});

test('browser graph fingerprint changes with content or version and is stable across LF/CRLF input order', async () => {
  const inputs = Object.fromEntries(await Promise.all(PAGES_FILES.map(async file => [file, await readFile(join(root, file), 'utf8')])));
  const original = structuredClone(inputs), options = { inputs, version: '3.2.0', pdfJsVersion: '6.4.299', assets: { 'assets/room-day.png': 'day-hash', 'assets/room-night.png': 'night-hash' } };
  const graph = createBrowserGraph(options);
  const reorderedCRLF = Object.fromEntries(Object.entries(inputs).reverse().map(([file, text]) => [file, normalize(text).replace(/\n/g, '\r\n')]));
  assert.deepEqual(createBrowserGraph({ ...options, inputs: reorderedCRLF, assets: { 'assets/room-night.png': 'night-hash', 'assets/room-day.png': 'day-hash' } }), graph);
  assert.deepEqual(inputs, original);
  for (const changed of [
    createBrowserGraph({ ...options, inputs: { ...inputs, 'field-difference.js': inputs['field-difference.js'] + '\n// Changed field calculation.\n' } }),
    createBrowserGraph({ ...options, version: '3.2.1' }),
    createBrowserGraph({ ...options, assets: { ...options.assets, 'assets/room-day.png': 'changed-art-hash' } })
  ]) {
    assert.notEqual(changed.buildId, graph.buildId);
    assert.ok(changed.inputs['index.html'].includes(`./app.js?build=${changed.buildId}`));
    assert.ok(changed.inputs['studio-renderer.js'].includes(`./field-difference.js?build=${changed.buildId}`));
    assert.ok(!changed.inputs['studio-renderer.js'].includes(`build=${graph.buildId}`));
  }
  const imports = createBrowserGraph({ ...options, inputs: { ...inputs, 'app.js': inputs['app.js'] + "\nexport { checkCancelled } from './client-services.js';\nimport './optics.js';\nconst lazyField = import('./field-difference.js');\n" } });
  for (const specifier of moduleReferences(imports.inputs['app.js'])) assert.equal(new URL(specifier, 'https://pages.test/afterlight/').searchParams.get('build'), imports.buildId);
});

test('Pages build refuses unsafe output paths and preserves an unrelated folder', async () => {
  await assert.rejects(buildPages({ outDir: root }), /dedicated folder/);
  await mkdir(dist, { recursive: true }); const output = await mkdtemp(join(dist, '.pages-test-'));
  await writeFile(join(output, 'keep.txt'), 'Preserve this file.');
  try { await assert.rejects(buildPages({ outDir: output }), /preserved/); assert.equal(await readFile(join(output, 'keep.txt'), 'utf8'), 'Preserve this file.'); }
  finally { await cleanup(output); }
});
