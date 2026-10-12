import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PAGES_FILES = Object.freeze(['index.html', 'style.css', 'studio.css', 'app.js', 'domain.js', 'persistence.js', 'calendar.js', 'optics.js', 'studies.js', 'studio-ui.js', 'studio-view-state.js', 'studio-renderer.js', 'field-difference.js', 'runtime-capabilities.js', 'client-services.js', 'browser-pdf.js']);
const ASSETS = ['mark.svg', 'room-day.png', 'room-night.png', 'table-oak.png'];
export const BROWSER_CAPABILITIES = Object.freeze({ mode: 'browser', assistants: false, pdf: 'browser', storage: 'browser-local' });
const hash = (content) => createHash('sha256').update(content).digest('hex');
const normalizeText = (text) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const browserCapabilitiesModule = () => `// Generated Pages capabilities. No local service or provider connections.\nexport const RUNTIME_CAPABILITIES = Object.freeze(${JSON.stringify(BROWSER_CAPABILITIES, null, 2)});\n`;

export function createBrowserGraph({ inputs, assets = {}, version, pdfJsVersion }) {
  const normalized = {};
  for (const file of PAGES_FILES) {
    if (typeof inputs[file] !== 'string') throw Error(`Missing authored browser input: ${file}`);
    normalized[file] = normalizeText(inputs[file]);
  }
  normalized['runtime-capabilities.js'] = browserCapabilitiesModule();
  const records = Object.keys(normalized).sort().map(file => [file, normalized[file]]);
  const assetRecords = Object.keys(assets).sort().map(file => [file, assets[file]]);
  const buildId = hash(JSON.stringify({ format: 'afterlight-pages-graph-v1', version, pdfJsVersion, capabilities: BROWSER_CAPABILITIES, inputs: records, assets: assetRecords }));
  function reference(specifier) {
    const target = new URL(specifier, 'https://build.invalid/');
    const file = target.pathname.slice(1);
    if (file.startsWith('vendor/')) return specifier;
    if (!PAGES_FILES.includes(file)) throw Error(`The browser graph references an unpublished module: ${specifier}`);
    target.searchParams.set('build', buildId);
    return `${specifier.split(/[?#]/, 1)[0]}${target.search}${target.hash}`;
  }
  const graph = {};
  for (const [file, text] of Object.entries(normalized)) {
    graph[file] = file.endsWith('.js') ? text.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.\/[^'"\r\n]+\.m?js(?:[?#][^'"\r\n]*)?)(\2)/g,
      (match, prefix, quote, specifier) => `${prefix}${quote}${reference(specifier)}${quote}`) : text;
  }
  graph['index.html'] = graph['index.html'].replace(/(\b(?:src|href)=)(['"])(\.\/(?:app\.js|style\.css|studio\.css))(?:\?[^'"]*)?\2/g,
    (match, prefix, quote, specifier) => `${prefix}${quote}${reference(specifier)}${quote}`);
  return { buildId, inputs: graph };
}

function verifyOutputPath(path) {
  const dist = resolve(projectRoot, 'dist'), output = resolve(path), rel = relative(dist, output);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || resolve(dist, rel) !== output) throw Error('Pages output must be a dedicated folder inside this project’s dist directory.');
  return output;
}
async function verifyDist() {
  const dist = resolve(projectRoot, 'dist');
  if ((await lstat(dist)).isSymbolicLink() || (await realpath(dist)).toLowerCase() !== dist.toLowerCase()) throw Error('The Pages build refuses a linked dist directory.');
}
async function removeGenerated(path) { verifyOutputPath(path); await verifyDist(); await rm(path, { recursive: true, force: true }); }
async function copyPublic(source, destination, sourceRoot = projectRoot) {
  const actual = await realpath(source), rel = relative(await realpath(sourceRoot), actual);
  if (rel === '..' || rel.startsWith(`..${sep}`) || (await lstat(source)).isSymbolicLink()) throw Error('The Pages build refuses linked files outside its public inputs.');
  const info = await lstat(source);
  if (info.isDirectory()) { await mkdir(destination, { recursive: true }); for (const entry of (await readdir(source)).sort()) await copyPublic(join(source, entry), join(destination, entry), sourceRoot); }
  else if (info.isFile()) { await mkdir(dirname(destination), { recursive: true }); await copyFile(source, destination); }
  else throw Error('A Pages input is not a regular public file.');
}
async function filesUnder(directory, prefix = '') {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await filesUnder(join(directory, entry.name), path));
    else files.push(path);
  }
  return files;
}

export async function buildPages({ outDir = join(projectRoot, 'dist', 'pages') } = {}) {
  const output = verifyOutputPath(outDir), dist = join(projectRoot, 'dist');
  await mkdir(dist, { recursive: true });
  await verifyDist();
  const pdfRoot = join(projectRoot, 'node_modules', 'pdfjs-dist');
  const [application, locked, pdf] = await Promise.all([readFile(join(projectRoot, 'package.json'), 'utf8'), readFile(join(projectRoot, 'package-lock.json'), 'utf8'), readFile(join(pdfRoot, 'package.json'), 'utf8')]).then(values => values.map(JSON.parse));
  if (locked.packages?.['node_modules/pdfjs-dist']?.version !== pdf.version) throw Error('Install the locked PDF.js dependency with npm ci before building Pages.');
  const staging = await mkdtemp(join(dist, '.pages-build-'));
  try {
    for (const file of PAGES_FILES) await copyPublic(join(projectRoot, file), join(staging, file));
    for (const file of ASSETS) await copyPublic(join(projectRoot, 'assets', file), join(staging, 'assets', file));
    const authored = {}, assets = {};
    for (const file of PAGES_FILES) authored[file] = await readFile(join(staging, file), 'utf8');
    for (const file of ASSETS) {
      const path = join(staging, 'assets', file);
      if (file.endsWith('.svg')) await writeFile(path, normalizeText(await readFile(path, 'utf8')));
      assets[`assets/${file}`] = hash(await readFile(path));
    }
    const graph = createBrowserGraph({ inputs: authored, assets, version: application.version, pdfJsVersion: pdf.version });
    for (const [file, text] of Object.entries(graph.inputs)) await writeFile(join(staging, file), text);
    for (const file of ['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.md', 'CREDITS.md']) {
      try { await copyPublic(join(projectRoot, file), join(staging, file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const notices = await readFile(join(projectRoot, 'THIRD-PARTY-NOTICES.md'), 'utf8');
    for (const file of new Set([...notices.matchAll(/licenses\/([A-Za-z0-9._-]+\.txt)/g)].map(match => match[1]))) await copyPublic(join(projectRoot, 'licenses', file), join(staging, 'licenses', file));
    const vendor = join(staging, 'vendor', 'pdfjs');
    for (const file of ['pdf.mjs', 'pdf.worker.mjs']) await copyPublic(join(pdfRoot, 'build', file), join(vendor, file), pdfRoot);
    await copyPublic(join(pdfRoot, 'LICENSE'), join(vendor, 'LICENSE'), pdfRoot);
    // Copy the complete resource directories, including all upstream license notices.
    for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) await copyPublic(join(pdfRoot, folder), join(vendor, folder), pdfRoot);
    const reportStyle = graph.inputs['studies.js'].match(/<style>([\s\S]*?)<\/style>/)?.[1];
    if (!reportStyle) throw Error('The printable study stylesheet is missing.');
    const styleHash = createHash('sha256').update(reportStyle).digest('base64');
    const policy = `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'sha256-${styleHash}'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'`;
    const index = await readFile(join(staging, 'index.html'), 'utf8');
    await writeFile(join(staging, 'index.html'), index.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><meta name="afterlight-runtime" content="browser"><meta name="afterlight-build" content="${graph.buildId}">`));
    await writeFile(join(staging, '.nojekyll'), '');
    const files = {};
    for (const file of await filesUnder(staging)) { const bytes = await readFile(join(staging, file)); files[file] = { bytes: bytes.length, sha256: hash(bytes) }; }
    const manifest = { format: 'afterlight-pages-build', version: application.version, buildId: graph.buildId, pdfJsVersion: pdf.version, capabilities: BROWSER_CAPABILITIES, files };
    await writeFile(join(staging, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    try {
      if ((await lstat(output)).isSymbolicLink()) throw Error('The output folder is a link; it was preserved.');
      let previous; try { previous = JSON.parse(await readFile(join(output, 'build-manifest.json'), 'utf8')); } catch { throw Error('The output folder is not an earlier Afterlight Pages build; it was preserved.'); }
      if (previous.format !== 'afterlight-pages-build') throw Error('The output folder is not an earlier Afterlight Pages build; it was preserved.');
      await removeGenerated(output);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(staging, output);
    return { output, manifest };
  } catch (error) { await removeGenerated(staging); throw error; }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { output, manifest } = await buildPages();
  console.log(`Pages build ready: ${output} (${Object.keys(manifest.files).length} public files, PDF.js ${manifest.pdfJsVersion}, build ${manifest.buildId}).`);
}
