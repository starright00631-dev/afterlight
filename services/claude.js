import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ASSIST_LIMITS, buildPrompt, runCodex, validateAssistOutput } from './ai.js';
import { HttpError, aborted } from './errors.js';

const command = process.env.AFTERLIGHT_CLAUDE_PATH || 'claude';
const scratch = fileURLToPath(new URL('./scratch/', import.meta.url));
let cached;
let pending;

export async function getClaudeStatus({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cached.time < 60000) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    await mkdir(scratch, { recursive: true });
    let value;
    try {
      const result = await runCodex(['auth', 'status', '--json'], '', { command, provider: 'Claude', timeout: 10000, rejectTools: false });
      const auth = JSON.parse(result.stdout);
      const authenticated = auth.loggedIn === true;
      value = { id: 'claude', name: 'Claude', kind: 'cli', configured: true, reachable: true, authenticated, available: authenticated, model: null, message: authenticated ? 'Local Claude reports a signed-in account. Inference has not been tested by this status check.' : 'Claude CLI is installed but not signed in. Run claude auth login locally; other providers and the reading desk remain usable.' };
    } catch (error) {
      value = { id: 'claude', name: 'Claude', kind: 'cli', configured: false, reachable: false, authenticated: null, available: false, model: null, message: error instanceof HttpError ? error.message : 'Claude CLI did not return a readable authentication status.' };
    }
    cached = { time: Date.now(), value };
    return value;
  })();
  try { return await pending; } finally { pending = undefined; }
}

export function parseClaudeResult(stdout) {
  let result;
  try { result = JSON.parse(stdout); } catch { throw new HttpError(502, 'invalid_ai_output', 'Claude did not return a structured response.'); }
  if (result.is_error) throw new HttpError(503, 'ai_failed', 'Claude could not complete this request. Check its local account and connection.');
  if (result.structured_output && typeof result.structured_output === 'object') return result.structured_output;
  try { return JSON.parse(result.result); } catch { throw new HttpError(502, 'invalid_ai_output', 'Claude did not return the required reading response.'); }
}

export async function assistClaude(input, { signal } = {}) {
  aborted(signal);
  const status = await getClaudeStatus();
  if (!status.available) throw new HttpError(503, 'ai_unavailable', status.message);
  const schema = await readFile(new URL('./answer.schema.json', import.meta.url), 'utf8');
  const result = await runCodex(['--print', '--safe-mode', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--permission-mode', 'dontAsk', '--no-session-persistence', '--output-format', 'json', '--json-schema', schema], buildPrompt(input), { command, provider: 'Claude', signal, timeout: ASSIST_LIMITS.timeout, rejectTools: false });
  if (result.code !== 0) throw new HttpError(503, 'ai_failed', 'Claude could not complete this request. Check its local account and connection.');
  return validateAssistOutput(parseClaudeResult(result.stdout), input, 'Claude');
}
