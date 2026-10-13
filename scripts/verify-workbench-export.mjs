import fs from 'node:fs';
import assert from 'node:assert/strict';
import { validateState, saveState, loadState } from '../persistence.js';

// These files come from the isolated localhost UI acceptance workflow, not a
// user's learning history. Keep the published optical fixtures separate.
const raw = JSON.parse(fs.readFileSync(new URL('../qa/workbench-export.json', import.meta.url), 'utf8'));
const state = validateState(raw.state);
assert.deepEqual(state, raw.state);
const records = new Map();
const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
assert.equal(saveState(storage, state), true);
assert.deepEqual(loadState(storage).state, state);

const ics = fs.readFileSync(new URL('../qa/workbench-calendar.ics', import.meta.url), 'utf8').replace(/\r?\n /g, '').replace(/\r\n/g, '\n');
const events = ics.split('BEGIN:VEVENT\n').slice(1).map(part => part.split('END:VEVENT')[0]);
const planned = state.workbench.blocks.filter(block => block.status === 'planned');
assert.equal(events.length, planned.length);
const utc = (date, minute) => new Date(Date.parse(`${date}T00:00:00+08:00`) + minute * 60000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
for (const block of planned) {
  const event = events.find(item => item.includes(`UID:${encodeURIComponent(block.id)}@afterlight.local\n`));
  assert.ok(event, `Missing accepted allocation ${block.id}`);
  assert.ok(event.includes(`DTSTART:${utc(block.date, block.startMinute)}\n`));
  assert.ok(event.includes(`DTEND:${utc(block.date, block.startMinute + block.minutes)}\n`));
}
const revised = state.actions.find(action => action.title.includes('finish line'));
assert.equal(revised.minutes, 30);
assert.equal(revised.remainingMinutes, 15);
assert.equal(revised.status, 'todo');
assert.equal(state.workbench.sessions.length, 2);
assert.deepEqual(state.workbench.sessions.map(session => session.outcome), ['continue', 'finished']);
assert.equal(state.attempts.length, 2);
assert.equal(state.attempts[1].couldNotRecall, true);
assert.equal(state.reviewSession, null);
assert.equal(state.session, null);
console.log(JSON.stringify({
  version: state.version, projects: state.projects.length, actions: state.actions.length,
  attempts: state.attempts.length, sessions: state.workbench.sessions.length,
  plannedBlocks: planned.length, originalEstimate: revised.minutes, explicitRemaining: revised.remainingMinutes,
  calendarIdentitiesAndUTCTimes: 'matched to accepted allocations', workspaceRoundTrip: 'identical',
}, null, 2));
