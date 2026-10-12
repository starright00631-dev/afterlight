import { checkCancelled } from './client-services.js';

export const BROWSER_PDF_LIMITS = Object.freeze({ bytes: 20 * 1024 * 1024, pages: 80, characters: 120000 });
const defaultResources = new URL('./vendor/pdfjs/', import.meta.url).href;
export function browserPdfTitle(filename = '') {
  let value = String(filename).slice(0, 500);
  try { value = decodeURIComponent(value); } catch {}
  return value.replace(/\\/g, '/').split('/').pop().replace(/\.pdf$/i, '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 180) || 'Imported document';
}

export function createBrowserPdfReader({ loadPdfJs = () => import('./vendor/pdfjs/pdf.mjs'), resourceBase = defaultResources, workerUrl = new URL('pdf.worker.mjs', resourceBase).href } = {}) {
  return async function readPdf(file, filename, signal) {
    checkCancelled(signal);
    if (!file?.size || file.size > BROWSER_PDF_LIMITS.bytes) throw Error('Choose a PDF smaller than 20 MB.');
    const data = new Uint8Array(await file.arrayBuffer());
    checkCancelled(signal);
    if (!data.length || data.length > BROWSER_PDF_LIMITS.bytes) throw Error('Choose a PDF smaller than 20 MB.');
    if (!new TextDecoder().decode(data.subarray(0, 1024)).includes('%PDF-')) throw Error('This file is not a readable PDF.');
    const pdfjs = await loadPdfJs();
    checkCancelled(signal);
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const task = pdfjs.getDocument({ data, verbosity: 0, disableFontFace: true, useSystemFonts: false, enableXfa: false, isEvalSupported: false, stopAtErrors: true,
      cMapUrl: new URL('cmaps/', resourceBase).href, cMapPacked: true,
      standardFontDataUrl: new URL('standard_fonts/', resourceBase).href,
      wasmUrl: new URL('wasm/', resourceBase).href, iccUrl: new URL('iccs/', resourceBase).href });
    const cancel = () => { void task.destroy().catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
      const doc = await task.promise;
      checkCancelled(signal);
      if (doc.numPages > BROWSER_PDF_LIMITS.pages) throw Error('Choose a PDF with 80 pages or fewer.');
      const pages = []; let count = 0;
      for (let page = 1; page <= doc.numPages; page++) {
        checkCancelled(signal);
        const handle = await doc.getPage(page);
        try {
          const content = await handle.getTextContent({ disableNormalization: false });
          checkCancelled(signal);
          let text = '';
          for (const item of content.items) {
            if (typeof item.str !== 'string') continue;
            text += item.str + (item.hasEOL ? '\n' : ' ');
            if (text.length + count > BROWSER_PDF_LIMITS.characters) throw Error('This PDF contains too much text. Choose an excerpt with at most 120,000 characters.');
          }
          text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
          count += text.length; pages.push({ page, text });
        } finally { handle.cleanup(); }
      }
      const text = pages.map(page => page.text).filter(Boolean).join('\n\n');
      if (!/[\p{L}\p{N}]/u.test(text)) throw Error('This PDF has no selectable text. Use a text-based PDF or paste an OCR transcript.');
      if (text.length > BROWSER_PDF_LIMITS.characters) throw Error('Choose a PDF excerpt with at most 120,000 characters.');
      return { title: browserPdfTitle(filename), text, pages };
    } catch (error) {
      checkCancelled(signal);
      if (error.name === 'PasswordException') throw Error('This PDF is password protected. Import an unlocked copy.');
      if (/80 pages|too much text|120,000|no selectable text/.test(error.message)) throw error;
      throw Error('The PDF could not be read. Try a text-based, unlocked PDF.');
    } finally {
      signal?.removeEventListener('abort', cancel);
      await task.destroy().catch(() => {});
    }
  };
}

export const readBrowserPdf = createBrowserPdfReader();
