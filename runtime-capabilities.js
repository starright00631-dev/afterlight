// The Pages build replaces this file in its output. Never infer privileges from a hostname.
export const RUNTIME_CAPABILITIES = Object.freeze({
  mode: 'local-server',
  assistants: true,
  pdf: 'server',
  storage: 'browser-local'
});
