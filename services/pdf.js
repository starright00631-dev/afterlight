import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fileURLToPath } from 'node:url';
import { HttpError, aborted } from './errors.js';

export const PDF_LIMITS = Object.freeze({ bytes: 20 * 1024 * 1024, pages: 80, characters: 120000 });
// PDF.js's Node resource factory reads filesystem paths, not file:// strings.
// Forward slashes also satisfy its trailing-slash check on Windows.
const pdfResourceRoot = new URL('../../', import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
const resourcePath = folder => fileURLToPath(new URL(`${folder}/`, pdfResourceRoot)).replaceAll('\\', '/');

export function pdfTitle(filename = '') {
  let value = String(filename).slice(0, 500);
  try { value = decodeURIComponent(value); } catch { /* A literal filename remains usable. */ }
  return value.replace(/\\/g, '/').split('/').pop().replace(/\.pdf$/i, '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 180) || 'Imported document';
}

export async function extractPdf(bytes, filename, signal) {
  aborted(signal);
  if (!bytes?.length || bytes.length > PDF_LIMITS.bytes) throw new HttpError(413, 'pdf_size', 'Choose a PDF smaller than 20 MB.');
  if (!Buffer.from(bytes).subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new HttpError(422, 'invalid_pdf', 'This file is not a readable PDF.');
  const task = getDocument({ data: Uint8Array.from(bytes), verbosity: 0, disableFontFace: true, useSystemFonts: false, enableXfa: false, isEvalSupported: false, stopAtErrors: true,
    cMapUrl: resourcePath('cmaps'), cMapPacked: true,
    standardFontDataUrl: resourcePath('standard_fonts'), wasmUrl: resourcePath('wasm') });
  const cancel = () => { void task.destroy().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const doc = await task.promise;
    if (doc.numPages > PDF_LIMITS.pages) throw new HttpError(422, 'pdf_pages', 'Choose a PDF with 80 pages or fewer.');
    const pages = [];
    let count = 0;
    for (let page = 1; page <= doc.numPages; page++) {
      aborted(signal);
      const handle = await doc.getPage(page);
      const content = await handle.getTextContent({ disableNormalization: false });
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        text += item.str + (item.hasEOL ? '\n' : ' ');
        if (text.length + count > PDF_LIMITS.characters) throw new HttpError(422, 'pdf_text_limit', 'This PDF contains too much text. Choose an excerpt with at most 120,000 characters.');
      }
      text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      count += text.length;
      pages.push({ page, text });
      handle.cleanup();
    }
    const text = pages.map(p => p.text).filter(Boolean).join('\n\n');
    if (!/[\p{L}\p{N}]/u.test(text)) throw new HttpError(422, 'pdf_no_text', 'This PDF has no selectable text. Use a text-based PDF or paste an OCR transcript.');
    if (text.length > PDF_LIMITS.characters) throw new HttpError(422, 'pdf_text_limit', 'Choose a PDF excerpt with at most 120,000 characters.');
    return { title: pdfTitle(filename), text, pages };
  } catch (error) {
    aborted(signal);
    if (error instanceof HttpError) throw error;
    if (error.name === 'PasswordException') throw new HttpError(422, 'pdf_password', 'This PDF is password protected. Import an unlocked copy.');
    throw new HttpError(422, 'invalid_pdf', 'The PDF could not be read. Try a text-based, unlocked PDF.');
  } finally {
    signal?.removeEventListener('abort', cancel);
    await task.destroy().catch(() => {});
  }
}
