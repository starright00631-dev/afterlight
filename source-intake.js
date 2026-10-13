import { uid, splitSource } from './domain.js';

export const READING_LIMITS = Object.freeze({ bytes: 20 * 1024 * 1024, characters: 120000, passages: 2000 });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export function readingFileKind(file) {
  if (!file?.size) throw Error('This file is empty. Choose a reading with text.');
  if (file.size > READING_LIMITS.bytes) throw Error('Choose a file up to 20 MB. For a longer book, save a smaller reading excerpt first.');
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return 'pdf';
  if (/\.(md|markdown)$/i.test(file.name) || file.type === 'text/markdown') return 'markdown';
  if (/\.txt$/i.test(file.name) || file.type === 'text/plain') return 'text';
  throw Error('Choose a PDF, text (.txt) or Markdown (.md) reading. Use Backups and examples to restore a workspace backup (.json).');
}

export function prepareReading({ text, title = '', filename = '', kind = 'text' }) {
  if (typeof text !== 'string' || !text.trim()) throw Error('There is no readable text yet. Choose a text-based PDF or paste a transcript.');
  if (text.length > READING_LIMITS.characters) throw Error('This reading is too long. Use an excerpt with up to 120,000 characters.');
  if (!['text', 'markdown', 'pdf'].includes(kind)) throw Error('Unsupported reading format.');
  const paragraphs = splitSource(text);
  if (paragraphs.length > READING_LIMITS.passages) throw Error('Use an excerpt with up to 2,000 passages.');
  const fallback = filename.replace(/\\/g, '/').split('/').pop().replace(/\.(pdf|txt|md|markdown)$/i, '').replace(/[\x00-\x1f\x7f]/g, '').trim();
  const name = String(title).trim() || fallback || 'Untitled reading';
  if (name.length > 300) throw Error('Use a reading title of 300 characters or fewer.');
  return { title: name, text, kind, paragraphs };
}

/** Previewing never writes workspace state. Only Add reading crosses the
 * validated commit boundary, and cancellation prevents stale file results. */
export function mountReadingIntake(host, { getState, commitState, readPdf, projectId, onSaved, browserPdf = false }) {
  const lifetime = new AbortController();
  let request = null, generation = 0, reading = null, mode = 'file';
  const project = getState().projects.find(item => item.id === projectId);
  host.innerHTML = `<form id="source-form" class="dialog-form reading-intake"><p class="reading-purpose">Bring a reading you want to understand. Keep its passages beside your notes, turn one into a review question, or plan a concrete task.</p><div class="reading-method" aria-label="Reading input"><button type="button" data-reading-mode="file" aria-pressed="true">Choose a file</button><button type="button" data-reading-mode="paste" aria-pressed="false">Paste text</button></div><label>Reading title<input id="reading-title" maxlength="300" placeholder="Use the file name, or name this reading"></label><div id="reading-file-panel"><label>PDF, text or Markdown<input id="reading-file" type="file" accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"></label><p class="helper-copy">Selecting a file prepares a text preview. PDFs: up to 20 MB and 80 pages. Scanned pages need a text transcript.</p></div><div id="reading-paste-panel" hidden><label>Text to keep<textarea id="reading-paste" rows="7" maxlength="120000" placeholder="Paste your reading or OCR transcript. Separate passages with a blank line."></textarea></label></div><p id="reading-status" class="reading-status" role="status" aria-live="polite">Choose a file to check its text before adding it.</p><section id="reading-preview" class="reading-preview" hidden aria-labelledby="reading-preview-title"><h3 id="reading-preview-title">Check the extracted text</h3><p id="reading-preview-summary" class="helper-copy"></p><label class="sr-only" for="reading-preview-text">Extracted reading text</label><textarea id="reading-preview-text" rows="7" readonly></textarea><p class="helper-copy">This text becomes your source in Desk and Library. Check equations and tables against the PDF before citing them.</p></section><p id="source-error" class="form-error" role="alert"></p><div class="reading-intake-actions"><button id="source-submit" class="primary" disabled>Add reading</button><button id="source-cancel" type="button" class="text-button" hidden>Cancel reading file</button></div><p class="helper-copy">Adds to ${esc(project?.title || 'this project')}. ${browserPdf ? 'PDF text is extracted in this browser.' : 'PDF text is extracted by the local app on this computer.'} Your PDF file is not retained in the workspace backup; its extracted text is. A reading goes to an assistant only when you ask.</p></form>`;
  const node = selector => host.querySelector(selector);
  const form = node('#source-form'), fileInput = node('#reading-file'), title = node('#reading-title');
  const preview = node('#reading-preview'), status = node('#reading-status'), error = node('#source-error');
  const add = node('#source-submit'), cancel = node('#source-cancel');
  function cancelRequest() { generation++; request?.abort(); request = null; cancel.hidden = true; }
  function setMode(nextMode) {
    cancelRequest(); mode = nextMode; reading = null; preview.hidden = true; error.textContent = '';
    node('#reading-file-panel').hidden = mode !== 'file'; node('#reading-paste-panel').hidden = mode !== 'paste';
    for (const button of host.querySelectorAll('[data-reading-mode]')) button.setAttribute('aria-pressed', String(button.dataset.readingMode === mode));
    add.disabled = mode === 'file'; status.textContent = mode === 'file' ? 'Choose a file to check its text before adding it.' : 'Your pasted text will be kept as the source.';
    if (mode === 'file') fileInput.value = '';
  }
  async function previewFile(file) {
    cancelRequest(); reading = null; preview.hidden = true; error.textContent = ''; add.disabled = true;
    if (!file) { status.textContent = 'Choose a file to check its text before adding it.'; return; }
    const token = generation, controller = new AbortController(); request = controller;
    cancel.hidden = false; status.textContent = `Reading ${file.name}…`;
    try {
      const kind = readingFileKind(file);
      const result = kind === 'pdf' ? await readPdf(file, { signal: controller.signal }) : { text: await file.text() };
      if (lifetime.signal.aborted || controller.signal.aborted || token !== generation) return;
      reading = prepareReading({ text: result.text, title: title.value, filename: file.name, kind });
      node('#reading-preview-text').value = reading.text;
      const pages = kind === 'pdf' && Array.isArray(result.pages) ? ` · ${result.pages.length} page${result.pages.length === 1 ? '' : 's'}` : '';
      node('#reading-preview-summary').textContent = `${file.name}${pages} · ${reading.paragraphs.length} passage${reading.paragraphs.length === 1 ? '' : 's'}`;
      preview.hidden = false; add.disabled = false;
      status.textContent = 'Text ready. Review the preview, then choose Add reading.';
      preview.scrollIntoView?.({ block: 'nearest' });
    } catch (caught) {
      if (lifetime.signal.aborted || token !== generation) return;
      reading = null; status.textContent = 'The reading has not been added.';
      error.textContent = caught.name === 'AbortError' ? 'File reading cancelled. Choose it again to retry.' : caught.message;
      error.scrollIntoView?.({ block: 'nearest' });
    } finally { if (token === generation) { request = null; cancel.hidden = true; } }
  }
  for (const button of host.querySelectorAll('[data-reading-mode]')) button.addEventListener('click', () => setMode(button.dataset.readingMode));
  fileInput.addEventListener('change', () => { void previewFile(fileInput.files?.[0]); });
  cancel.addEventListener('click', () => { cancelRequest(); reading = null; preview.hidden = true; add.disabled = true; status.textContent = 'File reading cancelled. Your existing readings are unchanged.'; fileInput.value = ''; });
  form.addEventListener('submit', event => {
    event.preventDefault(); error.textContent = '';
    if (lifetime.signal.aborted) return;
    try {
      const prepared = mode === 'paste' ? prepareReading({ text: node('#reading-paste').value, title: title.value }) : reading;
      if (!prepared) throw Error('Choose a file and wait for its text preview first.');
      const candidate = structuredClone(getState());
      if (!candidate.projects.some(item => item.id === projectId) || candidate.activeProjectId !== projectId) throw Error('The project changed. Reopen Add a reading in the project you want.');
      if (candidate.sources.length >= 100) throw Error('This workspace supports 100 readings. Back up older material before removing a reading.');
      if (candidate.sources.reduce((sum, item) => sum + item.text.length, 0) + prepared.text.length > 10000000) throw Error('Your workspace has reached its text limit. Save a backup before removing older readings.');
      const current = prepareReading({ ...prepared, title: title.value.trim() || prepared.title });
      const source = { id: uid('source'), projectId, ...current, createdAt: new Date().toISOString() };
      candidate.sources.push(source); candidate.activeProjectId = projectId; candidate.selectedSourceId = source.id; candidate.selectedIdeaId = null; candidate.view = 'desk';
      if (commitState(candidate) === false) { error.textContent = 'The reading could not be saved. Your existing workspace is intact; the preview is still here.'; error.scrollIntoView?.({ block: 'nearest' }); return; }
      lifetime.abort();
      onSaved(source);
    } catch (caught) { error.textContent = caught.message; error.scrollIntoView?.({ block: 'nearest' }); }
  });
  lifetime.signal.addEventListener('abort', cancelRequest, { once: true });
  return { abort() { lifetime.abort(); } };
}
