import test from 'node:test';
import assert from 'node:assert/strict';
import { actionPlanningContext, dayPlacementOptions } from '../planning-inspector.js';
import { validateBlockPlacement } from '../workspace-planner.js';

const DATE = '2026-10-13';
const action = (id, minutes = 60, extra = {}) => ({ id, title: id, projectId: id.startsWith('b') ? 'project-b' : 'project-a',
  status: 'todo', minutes, remainingMinutes: null, spentMs: 0, dependsOn: [], deadline: null, ...extra });
const calendar = (extra = {}) => ({ timeZone: 'Asia/Shanghai', startDate: DATE, days: 7,
  defaultWindows: [{ startMinute: 1140, endMinute: 1260 }], overrides: [], commitments: [], restMinutes: 5, minBlockMinutes: 15, ...extra });
const block = (id, actionId, startMinute = 1140, minutes = 30, extra = {}) => ({ id, actionId, date: DATE,
  startMinute, minutes, pinned: false, status: 'planned', ...extra });
const state = (actions, extra = {}) => ({ actions, workbench: { calendar: calendar(), blocks: [], sessions: [], ...extra } });
const option = (input, id, date = DATE, settings) => dayPlacementOptions(input, date, settings).find(item => item.actionId === id);
const freeze = value => { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return value; };

test('cross-project reservation counts use every retained planned day, not elapsed time or completed/skipped allocations', () => {
  const input = state([action('a', 120, { remainingMinutes: 80, spentMs: 3600000 }), action('b', 30)], { blocks: [
    block('today', 'a'), block('tomorrow', 'a', 1140, 20, { date: '2026-10-14' }),
    block('closed', 'a', 1200, 15, { status: 'done' }), block('skipped', 'a', 1230, 15, { status: 'skipped' }),
    block('other-project', 'b', 1175, 20), block('old-horizon', 'a', 1140, 15, { date: '2026-10-12' }),
  ] });
  assert.deepEqual(actionPlanningContext(input, 'a'), { actionId: 'a', remainingMinutes: 80, reservedMinutes: 65,
    unreservedMinutes: 15, readyToStart: true, prerequisites: [] });
  assert.equal(actionPlanningContext(input, 'b').reservedMinutes, 20);
  const alternate = [block('only', 'a', 1200, 80)];
  assert.equal(actionPlanningContext(input, 'a', { blocks: alternate }).unreservedMinutes, 0);
  assert.equal(input.workbench.blocks.length, 6);
});

test('fully reserved work stays inspectable without a duplicate placement or changed completion', () => {
  const input = state([action('a', 30), action('b', 30)], { blocks: [block('already', 'a', 1140, 30)] });
  const first = option(input, 'a'), second = option(input, 'b');
  assert.equal(first.placement, null); assert.equal(first.unreservedMinutes, 0); assert.match(first.reason, /fully reserved/);
  assert.deepEqual(second.placement, { date: DATE, startMinute: 1175, minutes: 30 });
  assert.equal(input.actions[0].status, 'todo');
});

test('preferred sessions cap at 45 minutes and leave useful remainders across accepted splits', () => {
  const input = state([action('long', 120), action('fifty', 50), action('split', 80)], { blocks: [
    block('earlier-split', 'split', 1140, 40, { date: '2026-10-14' }),
  ] });
  assert.equal(option(input, 'long').placement.minutes, 45);
  assert.equal(option(input, 'fifty').placement.minutes, 35, '35 now leaves a useful 15-minute session');
  assert.equal(option(input, 'split').placement.minutes, 40, 'reservations on another day reduce the unreserved effort');
  const tight = state([action('fifty', 50)], { calendar: calendar({ defaultWindows: [{ startMinute: 1140, endMinute: 1183 }] }) });
  assert.equal(option(tight, 'fifty').placement.minutes, 35);
});

test('short work must fit whole while fragmented long work cannot turn into tiny or orphan sessions', () => {
  const fragmented = state([action('short', 10), action('long', 29)], { calendar: calendar({
    defaultWindows: [{ startMinute: 1140, endMinute: 1155 }, { startMinute: 1200, endMinute: 1210 }],
  }) });
  assert.deepEqual(option(fragmented, 'short').placement, { date: DATE, startMinute: 1140, minutes: 10 });
  assert.equal(option(fragmented, 'long').placement, null); assert.match(option(fragmented, 'long').reason, /useful|remainder/);
  const smaller = state([action('short', 10), action('long', 60)], { calendar: calendar({
    defaultWindows: [{ startMinute: 1140, endMinute: 1149 }, { startMinute: 1200, endMinute: 1209 }],
  }) });
  assert.equal(option(smaller, 'short').placement, null); assert.equal(option(smaller, 'long').placement, null);
  const largeMinimum = state([action('long', 120)], { calendar: calendar({ minBlockMinutes: 60 }) });
  assert.equal(option(largeMinimum, 'long').placement.minutes, 60, 'a chosen minimum takes precedence over the preferred duration');
  const indivisible = state([action('indivisible', 50)], { calendar: calendar({ minBlockMinutes: 30 }) });
  assert.equal(option(indivisible, 'indivisible').placement.minutes, 50, 'the entire action may exceed the preferred length when no two useful pieces fit');
});

test('the first valid interval accounts for commitments, recorded geometry and before/after rest', () => {
  const input = state([action('a', 60), action('b', 30)], { calendar: calendar({ commitments: [
    { id: 'class', title: 'Class', date: DATE, startMinute: 1140, endMinute: 1160 },
  ] }), blocks: [block('closed', 'b', 1170, 30, { status: 'done' })] });
  const choice = option(input, 'a');
  assert.deepEqual(choice.placement, { date: DATE, startMinute: 1205, minutes: 45 });
  assert.doesNotThrow(() => validateBlockPlacement({ id: 'chosen', actionId: 'a', ...choice.placement, pinned: true, status: 'planned' }, input.actions, input.workbench.calendar, input.workbench.blocks));
});

test('selected bounds fix the exact start and reject busy, rest-protected, malformed or too-small intervals', () => {
  const input = state([action('a', 60), action('b', 30)], { blocks: [block('busy', 'b', 1140, 30)] });
  assert.deepEqual(option(input, 'a', DATE, { startMinute: 1200, endMinute: 1240 }).placement, { date: DATE, startMinute: 1200, minutes: 40 });
  for (const bounds of [{ startMinute: 1160, endMinute: 1190 }, { startMinute: 1170, endMinute: 1200 },
    { startMinute: 1200, endMinute: null }, { startMinute: 1200.5, endMinute: 1230 }, { startMinute: 1200, endMinute: 1190 }]) {
    const choice = option(input, 'a', DATE, bounds); assert.equal(choice.placement, null); assert.match(choice.reason, /interval/);
  }
  assert.equal(option(input, 'a', DATE, { startMinute: 1200, endMinute: 1210 }).placement, null);
});

test('scheduled prerequisites can permit future placement while actual readiness remains false', () => {
  const input = state([action('parent', 30), action('child', 20, { dependsOn: ['parent'] })], { blocks: [block('parent-slot', 'parent', 1140, 30)] });
  const child = option(input, 'child');
  assert.equal(child.readyToStart, false); assert.deepEqual(child.prerequisites, [{ id: 'parent', title: 'parent' }]);
  assert.deepEqual(child.placement, { date: DATE, startMinute: 1175, minutes: 20 });
  const unplanned = state(input.actions);
  assert.equal(option(unplanned, 'child').placement, null); assert.match(option(unplanned, 'child').reason, /prerequisite/);
  input.actions[0].status = 'done';
  assert.equal(option(input, 'child').readyToStart, true); assert.deepEqual(option(input, 'child').prerequisites, []);
});

test('an invalid earlier free interval does not hide a later valid prerequisite-aware choice', () => {
  const input = state([action('parent', 30), action('child', 20, { dependsOn: ['parent'] })], { blocks: [
    block('later-parent', 'parent', 1200, 30),
  ] });
  assert.deepEqual(option(input, 'child').placement, { date: DATE, startMinute: 1235, minutes: 20 });
  const selected = option(input, 'child', DATE, { startMinute: 1140, endMinute: 1170 });
  assert.equal(selected.placement, null); assert.match(selected.reason, /prerequisite/);
});

test('inherited deadlines and retained outside-week reservations still pass through the shared validator', () => {
  const inherited = state([action('parent', 30), action('child', 20, { dependsOn: ['parent'], deadline: DATE })]);
  assert.equal(option(inherited, 'parent', '2026-10-14').placement, null);
  assert.match(option(inherited, 'parent', '2026-10-14').reason, /deadline/);
  const stale = state([action('a', 60)], { blocks: [block('old-reservation', 'a', 1140, 30, { date: '2026-10-12' })] });
  const choice = option(stale, 'a');
  assert.equal(choice.reservedMinutes, 30, 'moving the calendar window never silently frees an accepted reservation');
  assert.equal(choice.unreservedMinutes, 30);
  assert.deepEqual(choice.placement, { date: DATE, startMinute: 1140, minutes: 30 });
  assert.equal(stale.workbench.blocks[0].id, 'old-reservation');
  stale.workbench.blocks[0].minutes = 60;
  assert.equal(option(stale, 'a').placement, null);
  assert.match(option(stale, 'a').reason, /fully reserved/);
});

test('missing, cyclic, blocked and expired work surfaces validator reasons rather than a feasible promise', () => {
  const input = state([action('missing', 30, { dependsOn: ['absent'] }), action('x', 30, { dependsOn: ['y'] }),
    action('y', 30, { dependsOn: ['x'] }), action('blocked', 30, { status: 'blocked' }),
    action('expired', 30, { deadline: '2026-10-12' }), action('done', 30, { status: 'done' })]);
  const choices = dayPlacementOptions(input, DATE);
  assert.equal(choices.length, 5);
  assert.deepEqual(option(input, 'missing').prerequisites, [{ id: 'absent', title: 'Missing prerequisite' }]);
  assert.match(option(input, 'missing').reason, /missing/); assert.match(option(input, 'x').reason, /cycle/);
  assert.match(option(input, 'blocked').reason, /blocked/); assert.match(option(input, 'expired').reason, /deadline/);
  assert.ok(choices.every(choice => choice.placement === null));
  assert.throws(() => actionPlanningContext(input, 'absent'), /missing/);
});

test('closed dates, outside horizon, fully occupied dates and missing adoption have explicit reasons', () => {
  const input = state([action('a')], { calendar: calendar({ overrides: [{ date: DATE, windows: [] }] }) });
  assert.match(option(input, 'a').reason, /No work window/);
  assert.match(option(input, 'a', '2026-10-20').reason, /outside/);
  const occupied = state([action('a'), action('busy', 120)], { blocks: [block('full', 'busy', 1140, 120)] });
  assert.match(option(occupied, 'a').reason, /No free interval/);
  assert.match(option(state([action('a')], { calendar: null }), 'a').reason, /Adopt/);
  assert.throws(() => dayPlacementOptions(input, '2026-02-30'), /date/i);
});

test('frozen inputs, history and block IDs remain unchanged and outputs are deterministic detached values', () => {
  const input = freeze(state([action('a', 50), action('b', 30)], { blocks: [
    block('inspector-candidate', 'b', 1200, 30, { status: 'skipped' }),
  ], sessions: [{ id: 'history', output: 'Retain this exact record.' }] }));
  const before = JSON.stringify(input), first = dayPlacementOptions(input, DATE), second = dayPlacementOptions(input, DATE);
  assert.deepEqual(first, second); first[0].placement.startMinute = 0;
  assert.equal(second[0].placement.startMinute, 1140); assert.equal(JSON.stringify(input), before);
});
