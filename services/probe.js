// Explicit, synthetic provider smoke test. Running this script requests one inference.
import { assist, getAiStatus } from './ai.js';

console.log(JSON.stringify({ event: 'auth_status', ai: await getAiStatus({ fresh: true }) }));
const source = { title: 'Synthetic retrieval-practice note', paragraphs: [{ id: 'probe-1', text: 'Retrieval practice means trying to recall an idea before looking at the answer. A learner can close the notes, explain the idea in their own words, and then check what they missed.' }] };
try {
  const result = await assist({ mode: 'explain', source, question: 'What is one useful first step?', paragraphId: 'probe-1' });
  console.log(JSON.stringify({ event: 'inference_passed', result }));
} catch (error) {
  console.log(JSON.stringify({ event: 'inference_failed', status: error.status, code: error.code, message: error.message }));
  process.exitCode = 1;
}
