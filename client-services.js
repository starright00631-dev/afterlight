import { RUNTIME_CAPABILITIES } from './runtime-capabilities.js';

export const HOSTED_ASSISTANT_MESSAGE = 'Assistants are available in the local app. This hosted edition keeps sources and work in your browser; it does not connect to a provider.';
export function checkCancelled(signal) {
  if (signal?.aborted) { const error = new Error('Import cancelled. Your existing sources are unchanged.'); error.name = 'AbortError'; throw error; }
}

export function createClientServices({ capabilities = RUNTIME_CAPABILITIES, fetcher = (...args) => fetch(...args), browserPdfReader = async (...args) => (await import('./browser-pdf.js')).readBrowserPdf(...args) } = {}) {
  capabilities = Object.freeze({ ...capabilities });
  if (!['local-server', 'browser'].includes(capabilities.mode) || capabilities.storage !== 'browser-local') throw Error('Unsupported application capabilities.');
  if (capabilities.mode === 'browser' && (capabilities.assistants || capabilities.pdf !== 'browser')) throw Error('The browser build cannot enable local server capabilities.');
  const requireAssistants = () => { if (!capabilities.assistants) throw Error(HOSTED_ASSISTANT_MESSAGE); };
  async function request(path, options = {}) {
    checkCancelled(options.signal);
    const response = await fetcher(path, options);
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'The local service could not complete this request.');
    return result;
  }
  const json = (value, signal) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal });
  return Object.freeze({
    capabilities,
    async providerInventory() {
      if (!capabilities.assistants) return { providers: [{ id: 'browser', name: 'Local assistants', available: false, message: HOSTED_ASSISTANT_MESSAGE }], pdf: true };
      return request('/api/status');
    },
    async connectProvider(settings) { requireAssistants(); return request('/api/providers/connect', json(settings)); },
    async disconnectProvider(settings) { requireAssistants(); return request('/api/providers/disconnect', json(settings)); },
    async assist(input, { signal } = {}) { requireAssistants(); return request('/api/assist', json(input, signal)); },
    async readPdf(file, { signal } = {}) {
      checkCancelled(signal);
      if (capabilities.pdf === 'browser') return browserPdfReader(file, file.name || 'Imported document.pdf', signal);
      if (capabilities.pdf !== 'server') throw Error('PDF reading is unavailable in this edition.');
      return request('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Filename': encodeURIComponent(file.name || 'Imported document.pdf') }, body: file, signal });
    }
  });
}
