import test from 'node:test';
import assert from 'node:assert/strict';
import { createExampleState, createState, splitSource } from '../domain.js';
import { validateState } from '../persistence.js';
import { extractPdf } from '../services/pdf.js';
import { mountReadingIntake, prepareReading, readingFileKind, READING_LIMITS } from '../source-intake.js';
import { syntheticTextPdf } from './pdf-fixtures.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() {
  // The change handler intentionally starts asynchronous previewing without
  // returning its promise. Yield through its resolved microtasks and Blob read.
  await new Promise(resolve => setImmediate(resolve));
}

// Executes the actual installed form handlers, with a real workspace validator
// at the save boundary. Browser QA separately verifies the dialog and chooser.
function mount(t, { state = validateState(createExampleState()), readPdf = async () => { throw Error('Unexpected PDF parsing'); }, reject = false } = {}) {
  const nodes = new Map(), saved = [], calls = [], candidates = [];
  let commits = 0, refusing = reject;
  const host = {
    innerHTML: '',
    querySelector: selector => node(selector),
    querySelectorAll: selector => selector === '[data-reading-mode]' ? [node('file-mode'), node('paste-mode')] : [],
  };
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', textContent: '', hidden: ['#reading-preview', '#reading-paste-panel', '#source-cancel'].includes(selector),
      disabled: selector === '#source-submit', files: [], attributes: {},
      dataset: selector === 'file-mode' ? { readingMode: 'file' } : selector === 'paste-mode' ? { readingMode: 'paste' } : {},
      events: new Map(),
      addEventListener(type, handler) { this.events.set(type, handler); },
      setAttribute(name, value) { this.attributes[name] = value; },
    });
    return nodes.get(selector);
  }
  const intake = mountReadingIntake(host, {
    getState: () => state, projectId: state.activeProjectId,
    commitState(candidate) {
      commits++; candidates.push(structuredClone(candidate));
      if (refusing) return false;
      state = validateState(candidate); return true;
    },
    readPdf(file, options) { calls.push({ file, ...options }); return readPdf(file, options); },
    onSaved: source => saved.push(source),
  });
  t.after(() => intake.abort());
  return {
    host, intake, node, saved, calls, candidates,
    get state() { return state; }, get commits() { return commits; },
    reject(value) { refusing = value; }, replace(value) { state = validateState(value); },
    choose(file) { node('#reading-file').files = file ? [file] : []; node('#reading-file').events.get('change')(); },
    cancel() { node('#source-cancel').events.get('click')(); },
    mode(value) { node(`${value}-mode`).events.get('click')(); },
    submit() { let prevented = false; node('#source-form').events.get('submit')({ preventDefault() { prevented = true; } }); return prevented; },
  };
}

test('a genuine two-page PDF is previewed without a write and only Add reading saves canonical source anchors', async t => {
  const bytes = syntheticTextPdf(['Keep evidence beside the explanation.', 'Plan a specific next action.']);
  const file = new File([bytes], 'Useful reading.pdf', { type: 'application/pdf' });
  const parsed = await extractPdf(bytes, file.name);
  const h = mount(t, { readPdf: async selected => { assert.strictEqual(selected, file); return parsed; } });
  const before = structuredClone(h.state);
  h.choose(file); await flush();
  assert.equal(h.commits, 0); assert.deepEqual(h.state, before); assert.equal(h.saved.length, 0);
  assert.equal(h.node('#reading-preview').hidden, false);
  assert.equal(h.node('#reading-preview-text').value, parsed.text);
  assert.match(h.node('#reading-preview-summary').textContent, /Useful reading\.pdf · 2 pages · 2 passages/);
  assert.equal(h.node('#source-submit').disabled, false);
  assert.match(h.host.innerHTML, /readonly/);
  h.node('#reading-title').value = 'My reading';
  assert.equal(h.submit(), true);
  assert.equal(h.commits, 1); assert.equal(h.saved.length, 1);
  assert.equal(h.state.sources.length, before.sources.length + 1);
  const source = h.state.sources.at(-1);
  assert.equal(source.kind, 'pdf'); assert.equal(source.title, 'My reading');
  assert.equal(source.text, parsed.text); assert.deepEqual(source.paragraphs, splitSource(parsed.text));
  assert.equal(h.state.selectedSourceId, source.id); assert.equal(h.state.selectedIdeaId, null);
  assert.equal(h.state.view, 'desk'); assert.equal(h.state.version, 4);
  assert.deepEqual(h.state, validateState(h.state));
  assert.deepEqual(h.state.sources.slice(0, -1), before.sources);
});

test('a refused save leaves existing readings and preview intact and supports an explicit retry', async t => {
  const h = mount(t, { reject: true }), before = structuredClone(h.state);
  h.choose(new File(['Read this unchanged passage.'], 'Passage.txt', { type: 'text/plain' })); await flush();
  const preview = h.node('#reading-preview-text').value;
  h.submit();
  assert.equal(h.commits, 1); assert.deepEqual(h.state, before); assert.equal(h.saved.length, 0);
  assert.equal(h.node('#reading-preview').hidden, false); assert.equal(h.node('#source-submit').disabled, false);
  assert.equal(h.node('#reading-preview-text').value, preview);
  assert.match(h.node('#source-error').textContent, /existing workspace is intact; the preview is still here/);
  h.reject(false); h.submit();
  assert.equal(h.commits, 2); assert.equal(h.saved.length, 1);
  assert.equal(h.state.sources.length, before.sources.length + 1);
});

test('a successful Add reading closes its commit boundary before a second submit can duplicate the source', async t => {
  const h = mount(t), before = structuredClone(h.state);
  h.choose(new File(['Save this reading once.'], 'Once.txt', { type: 'text/plain' })); await flush();
  h.submit(); const saved = structuredClone(h.state);
  h.submit();
  assert.equal(h.commits, 1); assert.equal(h.saved.length, 1);
  assert.equal(h.state.sources.length, before.sources.length + 1);
  assert.deepEqual(h.state, saved);
});

test('cancelled PDF results cannot reveal stale text or add a reading', async t => {
  const pending = deferred(), h = mount(t, { readPdf: () => pending.promise }), before = structuredClone(h.state);
  h.choose(new File(['%PDF- synthetic pending'], 'Pending.pdf', { type: 'application/pdf' }));
  assert.equal(h.node('#source-cancel').hidden, false);
  h.cancel(); assert.equal(h.calls[0].signal.aborted, true);
  pending.resolve({ title: 'Pending', text: 'A cancelled result.', pages: [{ page: 1, text: 'A cancelled result.' }] }); await flush();
  assert.equal(h.node('#reading-preview').hidden, true); assert.equal(h.node('#source-submit').disabled, true);
  assert.match(h.node('#reading-status').textContent, /cancelled.*existing readings are unchanged/);
  h.submit(); assert.equal(h.commits, 0); assert.deepEqual(h.state, before);
});

test('switching files ignores an earlier late success and keeps only the selected reading', async t => {
  const first = deferred(), second = deferred();
  const h = mount(t, { readPdf: file => file.name === 'First.pdf' ? first.promise : second.promise });
  h.choose(new File(['%PDF- first'], 'First.pdf', { type: 'application/pdf' }));
  h.choose(new File(['%PDF- second'], 'Second.pdf', { type: 'application/pdf' }));
  assert.equal(h.calls[0].signal.aborted, true);
  second.resolve({ text: 'The selected reading.', pages: [{ page: 1, text: 'The selected reading.' }] }); await flush();
  first.resolve({ text: 'The obsolete reading.', pages: [{ page: 1, text: 'The obsolete reading.' }] }); await flush();
  assert.equal(h.node('#reading-preview-text').value, 'The selected reading.');
  assert.match(h.node('#reading-preview-summary').textContent, /^Second\.pdf/);
  h.submit(); assert.equal(h.state.sources.at(-1).title, 'Second'); assert.equal(h.state.sources.at(-1).text, 'The selected reading.');
  assert.equal(h.saved.length, 1);
});

test('switching to paste aborts pending extraction and cannot let a late PDF failure replace the pasted source', async t => {
  const pending = deferred(), h = mount(t, { readPdf: () => pending.promise });
  h.choose(new File(['%PDF- pending'], 'Pending.pdf', { type: 'application/pdf' }));
  h.mode('paste'); assert.equal(h.calls[0].signal.aborted, true);
  assert.equal(h.node('#reading-file-panel').hidden, true); assert.equal(h.node('#reading-paste-panel').hidden, false);
  h.node('#reading-paste').value = 'A pasted source.\n\nA second passage.';
  h.node('#reading-title').value = 'Transcript';
  pending.reject(Error('Do not show an obsolete file failure.')); await flush();
  assert.equal(h.node('#source-error').textContent, '');
  h.submit(); assert.equal(h.saved.length, 1);
  assert.equal(h.state.sources.at(-1).kind, 'text'); assert.equal(h.state.sources.at(-1).title, 'Transcript');
  assert.equal(h.state.sources.at(-1).paragraphs.length, 2);
});

test('disposing a pending intake prevents both late preview and saves', async t => {
  const pending = deferred(), h = mount(t, { readPdf: () => pending.promise }), before = structuredClone(h.state);
  h.choose(new File(['%PDF- pending'], 'Pending.pdf', { type: 'application/pdf' }));
  h.intake.abort(); pending.reject(new DOMException('Aborted', 'AbortError')); await flush();
  assert.equal(h.calls[0].signal.aborted, true); assert.equal(h.node('#reading-preview').hidden, true);
  h.mode('paste'); h.node('#reading-paste').value = 'This must not be saved.'; h.submit();
  assert.equal(h.commits, 0); assert.deepEqual(h.state, before); assert.equal(h.saved.length, 0);
});

test('file validation keeps workspace JSON, empty files and oversize material out of reading intake', async t => {
  const h = mount(t), before = structuredClone(h.state);
  for (const [file, message] of [
    [new File(['{}'], 'Workspace.json', { type: 'application/json' }), /restore a workspace backup \(\.json\)/],
    [new File([], 'Empty.txt', { type: 'text/plain' }), /empty/],
    [{ name: 'Too large.pdf', size: READING_LIMITS.bytes + 1, type: 'application/pdf' }, /up to 20 MB/],
  ]) {
    h.choose(file); await flush();
    assert.match(h.node('#source-error').textContent, message);
    assert.equal(h.node('#source-submit').disabled, true); assert.equal(h.node('#reading-preview').hidden, true);
    h.submit(); assert.equal(h.commits, 0);
  }
  assert.equal(h.calls.length, 0); assert.deepEqual(h.state, before);
  assert.equal(readingFileKind(new File(['# Heading'], 'Reading.md')), 'markdown');
  assert.equal(readingFileKind(new File(['Transcript'], 'Reading.txt')), 'text');
  assert.equal(readingFileKind(new File(['%PDF- content'], 'READING.PDF')), 'pdf');
});

test('more than 160 passages can be previewed and saved with the real 2,000-passage workspace boundary', async t => {
  const text = Array.from({ length: 201 }, (_, index) => `Reading passage ${index + 1}.`).join('\n\n');
  const h = mount(t);
  h.choose(new File([text], 'Long reading.md', { type: 'text/markdown' })); await flush();
  assert.equal(h.node('#source-submit').disabled, false);
  assert.match(h.node('#reading-preview-summary').textContent, /201 passages/);
  h.submit(); assert.equal(h.saved.length, 1); assert.equal(h.state.sources.at(-1).paragraphs.length, 201);
  assert.equal(h.state.sources.at(-1).kind, 'markdown');
  const boundary = Array.from({ length: 2000 }, (_, index) => `P${index}`).join('\n\n');
  assert.equal(prepareReading({ text: boundary }).paragraphs.length, 2000);
  const full = mount(t);
  full.choose(new File([boundary], 'Full passage boundary.txt')); await flush();
  full.submit(); assert.equal(full.saved.length, 1); assert.equal(full.state.sources.at(-1).paragraphs.length, 2000);
  assert.throws(() => prepareReading({ text: `${boundary}\n\nOne passage too many` }), /2,000/);
  assert.throws(() => prepareReading({ text: 'x'.repeat(READING_LIMITS.characters + 1) }), /120,000/);
});

test('a project changed after preview cannot receive a source through an old dialog', async t => {
  const h = mount(t);
  h.choose(new File(['Keep its project link correct.'], 'Reading.txt')); await flush();
  const next = structuredClone(h.state), other = createState().projects[0];
  next.projects.push(other); next.activeProjectId = other.id; next.selectedSourceId = null; next.selectedIdeaId = null;
  h.replace(next); const before = structuredClone(h.state);
  h.submit(); assert.equal(h.commits, 0); assert.deepEqual(h.state, before);
  assert.match(h.node('#source-error').textContent, /project changed/);
  assert.equal(h.node('#reading-preview').hidden, false);
});
