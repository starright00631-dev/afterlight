import { assist as codexAssistDefault, getAiStatus, validateAssistInput } from './ai.js';
import { assistClaude, getClaudeStatus } from './claude.js';
import { API_IDS, assistCompatible, envConnections, probeCompatible, validateConnection } from './compatible.js';
import { HttpError, aborted } from './errors.js';

export const PROVIDER_IDS = Object.freeze(['codex', 'claude', ...API_IDS]);
export const DEFAULT_PROVIDER = 'codex';

export function createProviderRouter({ env = process.env, fetchImpl = fetch, codexAssist = codexAssistDefault, codexStatus = getAiStatus, claudeAssist = assistClaude, claudeStatus = getClaudeStatus, probeTimeout, assistTimeout } = {}) {
  const connections = new Map(envConnections(env).map(record => [record.id, record]));
  const checks = new Map();
  let active = false;

  async function apiStatus(id, { fresh = false, signal } = {}) {
    const config = connections.get(id);
    const cached = checks.get(id);
    if (!fresh && cached?.config === config && Date.now() - cached.time < 30000) return cached.value;
    const value = await probeCompatible(config, { fetchImpl, signal, timeout: probeTimeout });
    if (connections.get(id) === config) checks.set(id, { config, time: Date.now(), value });
    return value;
  }

  async function status(options = {}) {
    const values = await Promise.all([
      Promise.resolve(codexStatus(options)).then(ai => {
        const reachable = ai.available || /not signed in/i.test(ai.message);
        return { id: 'codex', name: 'Codex', kind: 'cli', configured: reachable, reachable, authenticated: reachable ? Boolean(ai.available) : null, available: Boolean(ai.available), model: null, message: ai.available ? 'Local Codex reports a signed-in account. This check does not test model inference.' : ai.message };
      }),
      claudeStatus(options),
      ...API_IDS.map(id => apiStatus(id, options)),
    ]);
    return { defaultProvider: DEFAULT_PROVIDER, providers: values };
  }

  async function connect(raw, { signal } = {}) {
    const next = validateConnection(raw, connections.get(raw?.id));
    connections.set(next.id, next);
    checks.delete(next.id);
    return { provider: await apiStatus(next.id, { fresh: true, signal }) };
  }

  async function disconnect(raw, options = {}) {
    if (!raw || !API_IDS.includes(raw.id)) throw new HttpError(400, 'invalid_provider', 'Choose an API connection to disconnect. CLI accounts are managed in their own terminals.');
    const current = connections.get(raw.id);
    connections.set(raw.id, { ...current, model: '', apiKey: '', origin: 'none' });
    checks.delete(raw.id);
    return { provider: await apiStatus(raw.id, { ...options, fresh: true }) };
  }

  async function assist(raw, { signal } = {}) {
    const input = validateAssistInput(raw);
    const id = raw.providerId ?? DEFAULT_PROVIDER;
    if (!PROVIDER_IDS.includes(id)) throw new HttpError(400, 'invalid_provider', 'Choose a listed assistance provider.');
    if (active) throw new HttpError(429, 'ai_busy', 'Another assistance request is running. Wait for it to finish.');
    active = true;
    try {
      aborted(signal);
      let result;
      if (id === 'codex') result = await codexAssist(input, { signal });
      else if (id === 'claude') result = await claudeAssist(input, { signal });
      else {
        const config = connections.get(id);
        const verified = await apiStatus(id, { signal });
        if (!verified.available) throw new HttpError(503, 'provider_unavailable', verified.message);
        result = await assistCompatible(config, input, { fetchImpl, signal, timeout: assistTimeout });
      }
      return { ...result, providerId: id };
    } finally { active = false; }
  }

  return { status, connect, disconnect, assist };
}

export const providerRouter = createProviderRouter();
