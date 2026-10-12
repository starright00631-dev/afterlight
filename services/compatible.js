import { readFileSync } from 'node:fs';
import { ASSIST_LIMITS, buildPrompt, validateAssistOutput } from './ai.js';
import { HttpError, aborted } from './errors.js';

const schema = JSON.parse(readFileSync(new URL('./answer.schema.json', import.meta.url), 'utf8'));
export const API_LIMITS = Object.freeze({ responseBytes: 1024 * 1024, probeTimeout: 4000 });
export const API_IDS = Object.freeze(['ollama', 'deepseek', 'compatible']);
export const RESPONSE_FORMATS = Object.freeze(['json', 'schema', 'none']);

export function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) throw new HttpError(400, 'invalid_connection', 'Enter the provider API base URL.');
  let url;
  try { url = new URL(value); } catch { throw new HttpError(400, 'invalid_connection', 'Enter a valid HTTP API base URL.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !loopback) || url.username || url.password || url.search || url.hash) throw new HttpError(400, 'invalid_connection', 'Use HTTPS for remote providers, or HTTP on localhost. Put the key in the key field, not the URL.');
  if (url.pathname.replace(/\/$/, '').endsWith('/chat/completions') || url.pathname.replace(/\/$/, '').endsWith('/models')) throw new HttpError(400, 'invalid_connection', 'Use the API base URL, such as /v1, without /chat/completions or /models.');
  return url.href.replace(/\/+$/, '');
}

function text(value, max, field, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\x00-\x1f\x7f]/.test(value)) throw new HttpError(400, 'invalid_connection', `${field} is missing or invalid.`);
  return value.trim();
}

export function validateConnection(raw, previous) {
  if (!raw || typeof raw !== 'object' || !API_IDS.includes(raw.id)) throw new HttpError(400, 'invalid_provider', 'Choose Ollama, DeepSeek, or an OpenAI-compatible API.');
  const defaults = { ollama: { name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', requiresKey: false }, deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', requiresKey: true }, compatible: { name: 'OpenAI-compatible API', baseUrl: '', requiresKey: false } }[raw.id];
  const baseUrl = normalizeBaseUrl(raw.baseUrl || previous?.baseUrl || defaults.baseUrl);
  if (raw.id === 'deepseek' && baseUrl !== defaults.baseUrl && baseUrl !== 'https://api.deepseek.com') throw new HttpError(400, 'invalid_connection', 'Use the OpenAI-compatible option for custom endpoints.');
  const apiKey = Object.hasOwn(raw, 'apiKey') ? text(raw.apiKey, 4096, 'API key', true) : previous?.baseUrl === baseUrl ? previous.apiKey || '' : '';
  const model = text(raw.model ?? previous?.model ?? '', 200, 'Model', true);
  const name = raw.id === 'compatible' ? text(raw.name || previous?.name || defaults.name, 80, 'Provider name') : defaults.name;
  const responseFormat = raw.responseFormat || previous?.responseFormat || 'json';
  if (!RESPONSE_FORMATS.includes(responseFormat)) throw new HttpError(400, 'invalid_connection', 'Choose JSON, JSON schema or prompt-only output.');
  if (apiKey && [baseUrl, model, name].some(value => value.includes(apiKey))) throw new HttpError(400, 'invalid_connection', 'Keep credentials only in the API key field.');
  return { id: raw.id, name, baseUrl, model, apiKey, responseFormat, requiresKey: defaults.requiresKey, origin: 'memory' };
}

export function envConnections(env) {
  const records = [
    { id: 'ollama', baseUrl: env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1', model: env.OLLAMA_MODEL || '', apiKey: env.OLLAMA_API_KEY || '' },
    { id: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: env.DEEPSEEK_MODEL || '', apiKey: env.DEEPSEEK_API_KEY || '' },
    { id: 'compatible', baseUrl: env.AFTERLIGHT_API_BASE_URL || '', model: env.AFTERLIGHT_API_MODEL || '', apiKey: env.AFTERLIGHT_API_KEY || '', name: env.AFTERLIGHT_API_NAME || 'OpenAI-compatible API', responseFormat: env.AFTERLIGHT_API_RESPONSE_FORMAT || 'json' },
  ];
  return records.map(raw => {
    if (!raw.baseUrl) return { id: raw.id, name: raw.name, baseUrl: '', model: '', apiKey: '', responseFormat: 'json', requiresKey: false, origin: 'none' };
    try { return { ...validateConnection(raw), origin: raw.model || raw.apiKey ? 'environment' : 'none' }; }
    catch { return { id: raw.id, name: raw.name || raw.id, baseUrl: '', model: '', apiKey: '', responseFormat: 'json', requiresKey: raw.id === 'deepseek', origin: 'invalid', configurationError: true }; }
  });
}

export async function boundedJson(response, limit = API_LIMITS.responseBytes) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new HttpError(502, 'provider_response_size', 'The provider returned too much data.'); }
  const chunks = [];
  let bytes = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > limit) throw new HttpError(502, 'provider_response_size', 'The provider returned too much data.');
      chunks.push(chunk);
    }
  }
  try { return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')); }
  catch { throw new HttpError(502, 'provider_response_json', 'The provider returned unreadable JSON. Check its API compatibility.'); }
}

function authHeaders(config) { return config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}; }
function scopedSignal(signal, timeout) {
  const timer = AbortSignal.timeout(timeout);
  return { timer, signal: signal ? AbortSignal.any([signal, timer]) : timer };
}

export async function probeCompatible(config, { fetchImpl = fetch, signal, timeout = API_LIMITS.probeTimeout } = {}) {
  const configured = Boolean(config.baseUrl && config.model && (!config.requiresKey || config.apiKey));
  const base = { id: config.id, name: config.name, kind: 'api', configured, reachable: null, authenticated: null, available: false, model: config.model || null, baseUrl: config.baseUrl || null, responseFormat: config.responseFormat, keyConfigured: Boolean(config.apiKey), connectionSource: config.origin, models: [] };
  if (config.configurationError) return { ...base, message: 'This provider has invalid server environment settings.' };
  if (!config.baseUrl || (config.requiresKey && !config.apiKey)) return { ...base, message: config.requiresKey ? 'Add a server-held API key and model to connect this provider.' : 'Enter an API base URL and model to connect.' };
  const scoped = scopedSignal(signal, timeout);
  try {
    const response = await fetchImpl(`${config.baseUrl}/models`, { headers: authHeaders(config), redirect: 'manual', signal: scoped.signal });
    if (response.status === 401 || response.status === 403) { await response.body?.cancel(); return { ...base, reachable: true, authenticated: false, message: 'The provider rejected these credentials or model-list permissions.' }; }
    if (!response.ok) { await response.body?.cancel(); return { ...base, reachable: true, message: `The endpoint replied with HTTP ${response.status}; its model list could not be verified.` }; }
    const result = await boundedJson(response);
    if (!Array.isArray(result.data)) return { ...base, reachable: true, message: 'The endpoint did not return an OpenAI-compatible model list.' };
    const models = result.data.map(model => model?.id).filter(id => typeof id === 'string' && id.length <= 200 && (!config.apiKey || !id.includes(config.apiKey))).slice(0, 200);
    let authenticated = null;
    if (config.apiKey && config.requiresKey) authenticated = true;
    else if (config.apiKey) {
      // A public /models endpoint cannot establish that a key is valid.
      // Only contrast a successful authorized request with an auth rejection.
      try {
        const publicResponse = await fetchImpl(`${config.baseUrl}/models`, { redirect: 'manual', signal: scoped.signal });
        authenticated = [401, 403].includes(publicResponse.status) ? true : null;
        await publicResponse.body?.cancel();
      } catch { /* Reachability is already observed; authentication stays unknown. */ }
    }
    const available = configured && models.includes(config.model);
    aborted(signal);
    return { ...base, reachable: true, authenticated, available, models, message: available ? 'Endpoint and selected model verified by its model list. No reading text was sent; inference is not yet tested.' : config.model ? 'The selected model is absent from this endpoint’s model list. Choose a listed model.' : 'Endpoint reached. Choose a model from its list to enable assistance.' };
  } catch (error) {
    aborted(signal);
    return { ...base, reachable: error instanceof HttpError ? true : false, message: error instanceof HttpError ? error.message : scoped.timer.aborted ? 'The endpoint did not respond to its model-list check within four seconds.' : 'The endpoint could not be reached. Check the server URL and whether the local service is running.' };
  }
}

export function parseAssistantJson(content) {
  if (typeof content !== 'string' || content.length > API_LIMITS.responseBytes) throw new HttpError(502, 'invalid_ai_output', 'The provider did not return a text reading response.');
  const fenced = content.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try { return JSON.parse(fenced ? fenced[1] : content); } catch { throw new HttpError(502, 'invalid_ai_output', 'The provider did not return the requested JSON response. Try JSON output mode or a compatible model.'); }
}

export async function assistCompatible(config, input, { fetchImpl = fetch, signal, timeout = ASSIST_LIMITS.timeout } = {}) {
  aborted(signal);
  if (!config.baseUrl || !config.model || (config.requiresKey && !config.apiKey)) throw new HttpError(503, 'provider_unconfigured', 'Configure this provider’s endpoint, model and required key first.');
  const scoped = scopedSignal(signal, timeout);
  const body = { model: config.model, stream: false, messages: [{ role: 'system', content: `Return only a JSON object conforming to this schema. Never call tools. Schema: ${JSON.stringify(schema)}` }, { role: 'user', content: buildPrompt(input) }] };
  if (config.responseFormat === 'json') body.response_format = { type: 'json_object' };
  if (config.responseFormat === 'schema') body.response_format = { type: 'json_schema', json_schema: { name: 'afterlight_reading', strict: true, schema } };
  try {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(config) }, body: JSON.stringify(body), redirect: 'manual', signal: scoped.signal });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new HttpError(503, 'provider_auth', 'The provider rejected these credentials or inference permissions.');
      if (response.status === 429) throw new HttpError(429, 'provider_rate_limit', 'The provider is rate limited. Wait before trying again.');
      throw new HttpError(502, 'provider_http', `The provider could not complete this request (HTTP ${response.status}). Check the model and selected output format.`);
    }
    const completion = await boundedJson(response);
    const choice = completion.choices?.[0];
    if (choice?.message?.tool_calls?.length || choice?.message?.function_call) throw new HttpError(502, 'unexpected_ai_tool', 'The provider attempted a tool action instead of a reading response.');
    if (choice?.finish_reason === 'length') throw new HttpError(502, 'incomplete_ai_output', 'The provider truncated its response. Try a shorter excerpt.');
    if (choice?.message?.refusal) throw new HttpError(422, 'provider_refusal', 'The provider declined this reading request.');
    const output = validateAssistOutput(parseAssistantJson(choice?.message?.content), input, config.name);
    if (config.apiKey && JSON.stringify(output).includes(config.apiKey)) throw new HttpError(502, 'provider_secret_output', 'The provider returned sensitive connection data; the response was withheld.');
    return output;
  } catch (error) {
    aborted(signal);
    if (error instanceof HttpError) throw error;
    if (scoped.timer.aborted) throw new HttpError(504, 'ai_timeout', 'The provider did not finish within two minutes. Try a shorter excerpt.');
    throw new HttpError(503, 'provider_unreachable', 'The provider could not be reached. Check its endpoint and connection.');
  }
}
