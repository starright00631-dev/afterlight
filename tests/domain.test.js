import test from 'node:test';
import assert from 'node:assert/strict';
import { uid, todayISO, localStudyDate, dueIdeas, addDays, splitSource, createState, createExampleState, scheduleActions, sessionElapsed, reviewDue } from '../domain.js';

test('review queue uses the latest assessment and the Shanghai calendar date across midnight', () => {
  assert.equal(localStudyDate('2026-10-11T17:00:00.000Z'),'2026-10-12');
  const ideas=[{id:'new'},{id:'later'},{id:'due'}];
  const attempts=[
    {ideaId:'later',createdAt:'2026-10-09T12:00:00Z',dueAt:'2026-10-10T12:00:00Z'},
    {ideaId:'later',createdAt:'2026-10-11T12:00:00Z',dueAt:'2026-10-14T17:00:00Z'},
    {ideaId:'due',createdAt:'2026-10-10T12:00:00Z',dueAt:'2026-10-11T17:00:00Z'},
  ];
  assert.deepEqual(dueIdeas(ideas,attempts,'2026-10-11').map(idea=>idea.id),['new']);
  assert.deepEqual(dueIdeas(ideas,attempts,'2026-10-12').map(idea=>idea.id),['new','due']);
  assert.throws(()=>localStudyDate('not-a-date'));
});

const plan = (overrides = {}) => ({ startDate: '2026-10-11', days: 7, dailyMinutes: 90, startTime: '19:00', restMinutes: 5, ...overrides });
const action = (id, minutes, overrides = {}) => ({ id, minutes, status: 'todo', dependsOn: [], deadline: null, ...overrides });
const scheduledMinutes = (result, id) => result.days.flatMap((day) => day.blocks).filter((block) => block.actionId === id).reduce((sum, block) => sum + block.minutes, 0);

test('source paragraphs retain exact content, stable anchors, repeated passages, and Unicode', () => {
  const text = '  First paragraph.\r\nStill first.  \r\n\r\n 第二段 🙂 \n\nFirst paragraph.\nStill first.';
  const paragraphs = splitSource(text);
  assert.deepEqual(paragraphs.map((paragraph) => paragraph.text), ['First paragraph.\nStill first.', '第二段 🙂', 'First paragraph.\nStill first.']);
  assert.deepEqual(paragraphs, splitSource(text));
  assert.deepEqual(paragraphs.map((paragraph) => paragraph.index), [0, 1, 2]);
  assert.notEqual(paragraphs[0].id, paragraphs[2].id);
  assert.deepEqual(splitSource(' \n\n '), []);
  assert.throws(() => splitSource(null));
  assert.throws(() => splitSource('x'.repeat(1_000_001)));
});

test('fresh projects have no fake work, while the example is explicit, connected, and independent', () => {
  const state = createState();
  assert.equal(state.version, 2);
  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].example, false);
  assert.equal(state.activeProjectId, state.projects[0].id);
  assert.deepEqual(state.sources, []);
  assert.deepEqual(state.attempts, []);
  assert.deepEqual(state.actions, []);
  const example = createExampleState();
  assert.equal(example.projects[0].example, true);
  assert.match(example.projects[0].title, /example/i);
  assert.equal(example.sources[0].paragraphs.length, 4);
  assert.equal(example.ideas.length, 2);
  assert.equal(example.actions.length, 4);
  assert.equal(example.attempts.length, 0);
  assert.ok(example.actions.every((item) => item.status === 'todo' && item.draft === '' && item.completedAt === null));
  assert.ok(example.ideas.every((idea) => example.sources[0].paragraphs.some((paragraph) => paragraph.id === idea.paragraphId)));
  assert.equal(scheduleActions(example.actions, example.projects[0].plan).overflow.length, 0);
  example.projects[0].title = 'Changed';
  assert.notEqual(createExampleState().projects[0].title, 'Changed');
  assert.notEqual(uid('project'), uid('project'));
  assert.throws(() => uid('<script>'));
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('calendar helpers cross month/year and leap boundaries and reject nonexistent dates', () => {
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.throws(() => addDays('2026-02-29', 1));
  assert.throws(() => addDays('2026-10-32', 1));
  assert.throws(() => addDays('2026-10-11', 0.5));
  assert.equal(reviewDue('again', '2026-12-31T23:00:00.000Z'), '2027-01-01T23:00:00.000Z');
  assert.equal(reviewDue('uncertain', '2026-10-11T11:00:00.000Z'), '2026-10-14T11:00:00.000Z');
  assert.equal(reviewDue('understood', '2026-10-11T11:00:00.000Z'), '2026-10-18T11:00:00.000Z');
  assert.throws(() => reviewDue('mastered', '2026-10-11T11:00:00.000Z'));
  assert.throws(() => reviewDue('again', '2026-02-30T11:00:00.000Z'));
});

test('long work splits across days with exact totals and absolute wall-clock blocks', () => {
  const items = [action('a', 120), action('b', 20)];
  const original = structuredClone(items);
  const result = scheduleActions(items, plan());
  assert.deepEqual(items, original);
  assert.equal(result.days.length, 7);
  assert.deepEqual(result.days[0].blocks, [{ actionId: 'a', startMinute: 1140, endMinute: 1230, minutes: 90 }]);
  assert.deepEqual(result.days[1].blocks, [
    { actionId: 'a', startMinute: 1140, endMinute: 1170, minutes: 30 },
    { actionId: 'b', startMinute: 1175, endMinute: 1195, minutes: 20 },
  ]);
  assert.equal(result.days[1].restMinutes, 5);
  assert.equal(result.days[1].used, 55);
  assert.equal(result.totalWorkMinutes, 140);
  assert.equal(result.totalCapacityMinutes, 630);
  assert.equal(result.availableMinutes, 485);
  assert.equal(result.finishDate, '2026-10-12');
  assert.deepEqual(result.overflow, []);
});

test('breaks count against the window and are not charged before the first block or after the last', () => {
  const exact = scheduleActions([action('a', 45), action('b', 40)], plan({ days: 1 }));
  assert.equal(exact.days[0].used, 90);
  assert.equal(exact.availableMinutes, 0);
  assert.equal(exact.days[0].restMinutes, 5);
  assert.equal(exact.finishDate, '2026-10-11');
  const overflow = scheduleActions([action('a', 45), action('b', 45)], plan({ days: 1 }));
  assert.equal(scheduledMinutes(overflow, 'b'), 40);
  assert.equal(overflow.finishDate, null);
  assert.match(overflow.overflow[0].reason, /5 work minutes/);
  const nextDay = scheduleActions([action('a', 8), action('b', 2)], plan({ days: 2, dailyMinutes: 10 }));
  assert.equal(nextDay.days[0].used, 8);
  assert.equal(nextDay.days[1].used, 2);
  assert.equal(nextDay.days[1].restMinutes, 0);
  const empty = scheduleActions([], plan());
  assert.equal(empty.availableMinutes, 630);
  assert.equal(empty.finishDate, null);
});

test('deadline priority respects dependencies and never labels unfinished work feasible', () => {
  const items = [
    action('unrelated', 50),
    action('child', 20, { dependsOn: ['parent'], deadline: '2026-10-11' }),
    action('parent', 30),
  ];
  const result = scheduleActions(items, plan());
  assert.deepEqual(result.days[0].blocks.map((block) => block.actionId), ['parent', 'child', 'unrelated']);
  const late = scheduleActions([action('parent', 50), action('child', 40, { dependsOn: ['parent'], deadline: '2026-10-11' })], plan());
  assert.equal(scheduledMinutes(late, 'child'), 35);
  assert.equal(late.finishDate, null);
  assert.equal(late.days.slice(1).flatMap((day) => day.blocks).length, 0);
  assert.match(late.overflow[0].reason, /deadline/i);
  const expired = scheduleActions([action('expired', 10, { deadline: '2026-10-10' })], plan());
  assert.equal(scheduledMinutes(expired, 'expired'), 0);
  assert.match(expired.overflow[0].reason, /deadline/i);
});

test('blocked, missing, and cyclic work remains explicit and blocks its descendants', () => {
  const result = scheduleActions([
    action('blocked', 20, { status: 'blocked' }),
    action('dependent', 10, { dependsOn: ['blocked'] }),
    action('missing', 10, { dependsOn: ['absent'] }),
    action('cycle-a', 10, { dependsOn: ['cycle-b'] }),
    action('cycle-b', 10, { dependsOn: ['cycle-a'] }),
    action('cycle-child', 10, { dependsOn: ['cycle-a'] }),
    action('finished', 50, { status: 'done' }),
    action('ready', 10, { dependsOn: ['finished'] }),
  ], plan());
  assert.equal(result.overflow.length, 6);
  assert.deepEqual(result.days.flatMap((day) => day.blocks).map((block) => block.actionId), ['ready']);
  assert.equal(result.totalWorkMinutes, 80);
  assert.equal(result.finishDate, null);
  assert.match(result.overflow.find((entry) => entry.actionId === 'cycle-b').reason, /cycle/);
  const failedParent = scheduleActions([action('parent', 100), action('child', 10, { dependsOn: ['parent'] })], plan({ days: 1 }));
  assert.equal(scheduledMinutes(failedParent, 'parent'), 90);
  assert.equal(scheduledMinutes(failedParent, 'child'), 0);
  assert.equal(failedParent.overflow.length, 2);
});

test('wall-clock sessions resume accurately while paused sessions do not grow or go negative', () => {
  const session = { actionId: 'a', running: true, startedAt: 100000, elapsedMs: 20000, goalMinutes: 25 };
  assert.equal(sessionElapsed(session, 160000), 80000);
  assert.equal(sessionElapsed(JSON.parse(JSON.stringify(session)), 220000), 140000);
  assert.equal(sessionElapsed(session, 90000), 20000);
  assert.deepEqual(session, { actionId: 'a', running: true, startedAt: 100000, elapsedMs: 20000, goalMinutes: 25 });
  const paused = { ...session, running: false, startedAt: null, elapsedMs: 80000 };
  assert.equal(sessionElapsed(paused, 999999), 80000);
  assert.throws(() => sessionElapsed({ ...paused, startedAt: 100 }, 999999));
  assert.throws(() => sessionElapsed({ ...session, elapsedMs: NaN }, 999999));
});

test('invalid scheduling values fail explicitly while a zero-time budget yields honest overflow', () => {
  const zero = scheduleActions([action('a', 10)], plan({ dailyMinutes: 0 }));
  assert.equal(zero.totalCapacityMinutes, 0);
  assert.equal(zero.availableMinutes, 0);
  assert.equal(zero.overflow.length, 1);
  assert.equal(zero.finishDate, null);
  for (const invalid of [
    plan({ startDate: '2026-02-30' }), plan({ dailyMinutes: -1 }), plan({ dailyMinutes: Infinity }),
    plan({ startTime: '24:00' }), plan({ startTime: '23:00', dailyMinutes: 90 }),
    plan({ restMinutes: 0.5 }), plan({ days: 0 }),
  ]) assert.throws(() => scheduleActions([], invalid));
  assert.throws(() => scheduleActions([action('same', 10), action('same', 20)], plan()));
  assert.throws(() => scheduleActions([action('a', 0)], plan()));
  assert.throws(() => scheduleActions([action('a', 10, { dependsOn: ['b', 'b'] })], plan()));
});
