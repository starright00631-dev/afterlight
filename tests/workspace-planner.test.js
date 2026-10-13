import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceCalendar, validateWorkspaceCalendar, remainingMinutes, readyActions,
  validatePlannedBlocks, validateBlockPlacement, planWorkspace} from '../workspace-planner.js';

const DATE = '2026-10-13';
const action = (id, minutes, extra = {}) => ({id, projectId: id.startsWith('b') ? 'project-b' : 'project-a', title: id,
  minutes, remainingMinutes: null, spentMs: 0, status: 'todo', dependsOn: [], deadline: null, ...extra});
const calendar = (extra = {}) => ({timeZone: 'Asia/Shanghai', startDate: DATE, days: 7,
  defaultWindows: [{startMinute: 1140, endMinute: 1260}], overrides: [], commitments: [], restMinutes: 5, minBlockMinutes: 15, ...extra});
const oneDay = (extra = {}) => calendar({overrides: Array.from({length: 6}, (_, index) => ({date: `2026-10-${14 + index}`, windows: []})), ...extra});
const block = (id, actionId, startMinute, minutes, extra = {}) => ({id, actionId, date: DATE, startMinute, minutes, pinned: false, status: 'planned', ...extra});
const allocations = (result, id) => result.blocks.filter((item) => item.actionId === id && item.status === 'planned');
const allocated = (result, id) => allocations(result, id).reduce((sum, item) => sum + item.minutes, 0);
const freeze = (value) => {Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return value;};

test('adoption retains one project window without merging other projects or mutating the plan', () => {
  const plan = freeze({startDate: DATE, days: 30, dailyMinutes: 90, startTime: '19:00', restMinutes: 5});
  assert.deepEqual(createWorkspaceCalendar(plan), calendar({defaultWindows: [{startMinute: 1140, endMinute: 1230}]}));
  assert.deepEqual(createWorkspaceCalendar({...plan, dailyMinutes: 0}).defaultWindows, []);
  assert.throws(() => createWorkspaceCalendar({...plan, startTime: '23:30', dailyMinutes: 90}), /midnight/);
});

test('calendar canonicalization validates dates, windows, commitments and interval identity atomically', () => {
  const input = freeze(calendar({defaultWindows: [{startMinute: 1200, endMinute: 1260}, {startMinute: 1140, endMinute: 1200}],
    overrides: [{date: '2026-10-14', windows: []}],
    commitments: [{id: 'dinner', title: 'Dinner', date: DATE, startMinute: 1155, endMinute: 1170}]}));
  const validated = validateWorkspaceCalendar(input);
  assert.equal(validated.defaultWindows[0].startMinute, 1140);
  validated.defaultWindows[0].startMinute = 100;
  assert.equal(input.defaultWindows[1].startMinute, 1140);
  for (const invalid of [
    calendar({startDate: '2026-02-30'}), calendar({timeZone: 'America/New_York'}), calendar({days: 8}),
    calendar({defaultWindows: [{startMinute: 1100, endMinute: 1200}, {startMinute: 1190, endMinute: 1260}]}),
    calendar({overrides: [{date: DATE, windows: []}, {date: DATE, windows: []}]}),
    calendar({restMinutes: .5}), calendar({minBlockMinutes: 0}),
    calendar({commitments: [{id: 'a', title: 'One', date: DATE, startMinute: 1150, endMinute: 1170},
      {id: 'b', title: 'Two', date: DATE, startMinute: 1160, endMinute: 1180}]}),
  ]) assert.throws(() => validateWorkspaceCalendar(invalid));
});

test('two projects consume the same two-hour evening including rest and expose excess work', () => {
  const actions = freeze([action('a-brief', 60), action('b-draft', 60)]), cal = freeze(oneDay());
  const result = planWorkspace(actions, cal);
  assert.equal(result.totalCapacityMinutes, 120);
  assert.equal(result.totalRemainingMinutes, 120);
  assert.equal(result.days[0].used, 110);
  assert.equal(result.days[0].restMinutes, 5);
  assert.deepEqual(result.days[0].blocks.map(({actionId, startMinute, minutes}) => ({actionId, startMinute, minutes})), [
    {actionId: 'a-brief', startMinute: 1140, minutes: 60}, {actionId: 'b-draft', startMinute: 1205, minutes: 45},
  ]);
  assert.equal(result.overflow.length, 1);
  assert.match(result.overflow[0].reason, /15 work minutes unplaced/);
  assert.equal(result.finishDate, null);
  assert.equal(actions[1].minutes, 60);
});

test('commitments subtract actual free intervals while busy-day overrides and unused rest stay honest', () => {
  const cal = calendar({defaultWindows: [{startMinute: 1140, endMinute: 1260}],
    overrides: [{date: '2026-10-14', windows: []}],
    commitments: [{id: 'meal', title: 'Meal', date: DATE, startMinute: 1185, endMinute: 1215}]});
  const result = planWorkspace([action('a', 90)], cal);
  assert.equal(result.days[0].capacity, 90);
  assert.deepEqual(result.days[0].blocks.map(({startMinute, minutes}) => ({startMinute, minutes})), [
    {startMinute: 1140, minutes: 45}, {startMinute: 1215, minutes: 45},
  ]);
  assert.equal(result.days[0].restMinutes, 0, 'commitment provides the gap without charging free work minutes twice');
  assert.equal(result.days[0].used, 90);
  assert.equal(result.days[0].commitments[0].title, 'Meal');
  assert.equal(result.days[1].capacity, 0);
  assert.equal(result.days[1].used, 0);
});

test('rest protects the whole day, including separate free windows and commitment-covered gaps', () => {
  const cal = oneDay({defaultWindows: [{startMinute: 1140, endMinute: 1260}], restMinutes: 10,
    commitments: [{id: 'call', title: 'Call', date: DATE, startMinute: 1170, endMinute: 1172}]});
  const result = planWorkspace([action('a', 30), action('b', 20)], cal);
  assert.equal(allocations(result, 'b')[0].startMinute, 1180);
  assert.equal(result.days[0].capacity, 118);
  assert.equal(result.days[0].restMinutes, 8);
  assert.equal(result.days[0].used, 58);
  const split = planWorkspace([action('a', 30), action('b', 20)], oneDay({restMinutes: 10,
    defaultWindows: [{startMinute: 1140, endMinute: 1170}, {startMinute: 1175, endMinute: 1200}]}));
  assert.equal(allocations(split, 'b')[0].startMinute, 1180);
  assert.equal(split.days[0].restMinutes, 5);
  const singleAction = planWorkspace([action('a', 30)], calendar({restMinutes: 5,
    defaultWindows: [{startMinute: 1140, endMinute: 1155}, {startMinute: 1157, endMinute: 1172}]}));
  assert.deepEqual(allocations(singleAction, 'a').map((item) => [item.date, item.startMinute, item.minutes]),
    [[DATE, 1140, 15], ['2026-10-14', 1140, 15]], 'a split action must also protect rest across neighbouring free windows');
});

test('long actions leave useful pieces and do not create one-minute or tiny final fragments', () => {
  const result = planWorkspace([action('a', 84), action('b', 30)], calendar({defaultWindows: [{startMinute: 1140, endMinute: 1230}]}));
  assert.equal(result.days[0].blocks.length, 1);
  assert.equal(result.days[0].blocks[0].minutes, 84);
  assert.equal(allocations(result, 'b')[0].date, '2026-10-14');
  const adjusted = planWorkspace([action('long', 50)], calendar({defaultWindows: [{startMinute: 1140, endMinute: 1183}]}));
  assert.deepEqual(allocations(adjusted, 'long').map((item) => item.minutes), [35, 15]);
  const unsplittableRemainder = planWorkspace([action('long', 29)], calendar({defaultWindows: [{startMinute: 1140, endMinute: 1155}]}));
  assert.equal(allocated(unsplittableRemainder, 'long'), 0);
  assert.match(unsplittableRemainder.overflow[0].reason, /29 work minutes/);
  const short = planWorkspace([action('short', 1)], oneDay({defaultWindows: [{startMinute: 1140, endMinute: 1141}]}));
  assert.equal(allocated(short, 'short'), 1, 'an entire explicitly short action is suitable');
  assert.equal(allocated(planWorkspace([action('short', 10)], calendar({defaultWindows: [{startMinute: 1140, endMinute: 1145}]})), 'short'), 0,
    'short actions must fit whole, rather than becoming even smaller fragments');
});

test('remaining effort is an explicit estimate and logged wall-clock duration does not reduce it', () => {
  const actions = [action('original', 90, {spentMs: 45 * 60_000}), action('revised', 90, {remainingMinutes: 30, spentMs: 75 * 60_000})];
  assert.equal(remainingMinutes(actions[0]), 90);
  assert.equal(remainingMinutes(actions[1]), 30);
  assert.equal(planWorkspace(actions, calendar()).totalRemainingMinutes, 120);
  assert.equal(allocated(planWorkspace(actions, calendar()), 'original'), 90);
  assert.equal(allocated(planWorkspace(actions, calendar()), 'revised'), 30);
  assert.throws(() => remainingMinutes(action('negative', 30, {remainingMinutes: -1})));
});

test('Desk ready actions require actual completed prerequisites, not list order or planned parents', () => {
  const actions = [action('child', 30, {dependsOn: ['parent']}), action('parent', 30),
    action('done', 20, {status: 'done'}), action('ready', 10, {dependsOn: ['done']}),
    action('missing', 10, {dependsOn: ['absent']}), action('blocked', 10, {status: 'blocked'})];
  assert.deepEqual(readyActions(actions).map((item) => item.id), ['parent', 'ready']);
  const proposal = planWorkspace(actions, calendar());
  assert.equal(allocated(proposal, 'child'), 30);
  assert.deepEqual(readyActions(actions).map((item) => item.id), ['parent', 'ready']);
});

test('inherited deadlines reorder prerequisites and infeasible or cyclic work stays explicit', () => {
  const actions = [action('unrelated', 60), action('child', 30, {dependsOn: ['parent'], deadline: DATE}), action('parent', 30)];
  const result = planWorkspace(actions, calendar());
  assert.deepEqual(result.days[0].blocks.slice(0, 2).map((item) => item.actionId), ['parent', 'child']);
  const late = planWorkspace([action('parent', 100), action('child', 30, {dependsOn: ['parent'], deadline: DATE})], calendar());
  assert.equal(allocated(late, 'parent'), 100);
  assert.equal(allocated(late, 'child'), 15, 'a useful partial block remains visibly incomplete');
  assert.equal(late.finishDate, null);
  assert.match(late.overflow[0].reason, /Deadline/);
  const broken = planWorkspace([action('blocked', 20, {status: 'blocked'}), action('child', 20, {dependsOn: ['blocked']}),
    action('missing', 20, {dependsOn: ['absent']}), action('x', 20, {dependsOn: ['y']}), action('y', 20, {dependsOn: ['x']})], calendar());
  assert.equal(broken.blocks.length, 0);
  assert.equal(broken.overflow.length, 5);
  assert.match(broken.overflow.find((item) => item.actionId === 'x').reason, /cycle/);
});

test('matching proposals reuse allocation identities; replanning replaces only ordinary planned blocks', () => {
  const actions = [action('a', 30), action('b', 30)];
  const first = planWorkspace(actions, calendar());
  const repeated = planWorkspace(freeze(actions), freeze(calendar()), {previousBlocks: freeze(first.blocks)});
  assert.deepEqual(repeated.blocks, first.blocks);
  const moved = planWorkspace(actions, calendar({defaultWindows: [{startMinute: 1200, endMinute: 1320}]}), {previousBlocks: first.blocks});
  assert.ok(moved.blocks.every((item) => !first.blocks.some((before) => before.id === item.id)));
  const retained = block('historic', 'a', 1140, 30, {date: '2026-10-12', status: 'done'});
  const skipped = block('skipped', 'b', 1210, 30, {status: 'skipped'});
  const history = planWorkspace(actions, calendar(), {previousBlocks: [...first.blocks, retained, skipped]});
  assert.deepEqual(history.blocks.find((item) => item.id === 'historic'), retained);
  assert.deepEqual(history.blocks.find((item) => item.id === 'skipped'), skipped);
  assert.equal(history.days[0].used, 65, 'skipped allocations occupy no work capacity');
  const oldWindow = block('old-window', 'a', 600, 30, {status: 'done'});
  const changedAvailability = planWorkspace(actions, calendar(), {previousBlocks: [oldWindow]});
  assert.deepEqual(changedAvailability.blocks.find((item) => item.id === oldWindow.id), oldWindow);
  assert.equal(changedAvailability.days[0].used, 65, 'historical work outside the new availability remains visible without spending its capacity');
});

test('valid pins remain fixed, constrain prerequisites and share remaining capacity with other projects', () => {
  const actions = [action('other', 30), action('child', 30, {dependsOn: ['parent']}), action('parent', 40)];
  const pin = block('kept-pin', 'child', 1200, 30, {pinned: true});
  const result = planWorkspace(actions, calendar(), {previousBlocks: [pin]});
  assert.deepEqual(result.blocks.find((item) => item.id === pin.id), pin);
  assert.equal(allocated(result, 'child'), 30);
  assert.ok(allocations(result, 'parent').every((item) => item.startMinute + item.minutes <= 1195));
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.days[0].used, 95);
  assert.deepEqual(allocations(result, 'other').map((item) => [item.date, item.minutes]), [['2026-10-13', 15], ['2026-10-14', 15]]);
});

test('conflicting pins are retained unchanged and visibly prevent a feasible finish claim', () => {
  const actions = [action('a', 30), action('b', 30)];
  const pins = [block('one', 'a', 1140, 30, {pinned: true}), block('two', 'b', 1150, 30, {pinned: true})];
  const result = planWorkspace(actions, oneDay(), {previousBlocks: pins});
  assert.deepEqual(result.blocks, pins);
  assert.equal(result.conflicts.length, 2);
  assert.match(result.conflicts[0].reason, /overlaps/);
  assert.equal(result.finishDate, null);
  const stale = {...pins[0], date: '2026-10-12'};
  assert.deepEqual(validatePlannedBlocks([stale], actions, calendar()), [stale]);
  const staleResult = planWorkspace(actions, calendar(), {previousBlocks: [stale]});
  assert.deepEqual(staleResult.blocks.find((item) => item.id === stale.id), stale);
  assert.match(staleResult.conflicts[0].reason, /outside/);
});

test('inbox membership prevents automatic allocation and propagates to dependent work without deleting either action', () => {
  const actions = freeze([action('parent', 30), action('child', 20, {dependsOn: ['parent']}), action('ready', 20)]);
  const result = planWorkspace(actions, calendar(), {backlogIds: ['parent']});
  assert.equal(allocated(result, 'parent'), 0);
  assert.equal(allocated(result, 'child'), 0);
  assert.equal(allocated(result, 'ready'), 20);
  assert.equal(result.overflow.length, 2);
  assert.match(result.overflow[0].reason, /inbox/);
  assert.equal(actions.length, 3);
  assert.throws(() => planWorkspace(actions, calendar(), {backlogIds: ['absent']}), /existing/);
});

test('manual placement checks overlap, rest, commitments, horizon, deadlines, prerequisites and remaining totals', () => {
  const actions = [action('parent', 30), action('child', 20, {dependsOn: ['parent'], deadline: DATE}), action('ready', 30)];
  const parent = block('parent-block', 'parent', 1140, 30);
  const child = block('child-block', 'child', 1175, 20, {pinned: true});
  assert.deepEqual(validateBlockPlacement(child, actions, calendar(), [parent]), child);
  assert.throws(() => validateBlockPlacement(child, actions, calendar(), []), /prerequisite/);
  assert.throws(() => validateBlockPlacement(child, actions, calendar(), [{...parent, startMinute: 10}]), /prerequisite/,
    'a stale prerequisite allocation outside availability cannot establish a feasible order');
  assert.throws(() => validateBlockPlacement({...child, startMinute: 1160}, actions, calendar(), [parent]), /overlaps/);
  assert.throws(() => validateBlockPlacement({...child, startMinute: 1172}, actions, calendar(), [parent]), /rest/);
  assert.throws(() => validateBlockPlacement({...child, date: '2026-10-14'}, actions, calendar(), [parent]), /deadline/);
  assert.throws(() => validateBlockPlacement({...child, date: '2026-10-20'}, actions, calendar(), [parent]), /seven-day/);
  assert.throws(() => validateBlockPlacement({...child, startMinute: 1130}, actions, calendar(), [parent]), /availability/);
  assert.throws(() => validateBlockPlacement(child, actions, calendar({commitments: [{id: 'fixed', title: 'Fixed', date: DATE, startMinute: 1180, endMinute: 1190}]}), [parent]), /commitment/);
  assert.throws(() => validateBlockPlacement(block('extra', 'parent', 1200, 15), actions, calendar(), [parent]), /exceed/);
  assert.throws(() => validateBlockPlacement({...child, minutes: 1}, actions, calendar(), [parent]), /minimum/);
});

test('structural validation preserves stale accepted records but rejects unsafe references, duplicate IDs and malformed geometry', () => {
  const actions = [action('a', 20)];
  const stale = block('stale', 'a', 10, 20, {date: '2026-01-01', status: 'done'});
  assert.deepEqual(validatePlannedBlocks([stale], actions, calendar()), [stale]);
  assert.deepEqual(validatePlannedBlocks([], actions, null), []);
  assert.throws(() => validatePlannedBlocks([stale], actions, null), /require/);
  assert.throws(() => validatePlannedBlocks([stale, stale], actions, calendar()), /unique/);
  assert.throws(() => validatePlannedBlocks([{...stale, actionId: 'missing'}], actions, calendar()), /missing/);
  for (const invalid of [{...stale, minutes: 0}, {...stale, startMinute: 1439, minutes: 20}, {...stale, pinned: 'yes'}, {...stale, status: 'performed'}, {...stale, date: '2026-02-30'}]) {
    assert.throws(() => validatePlannedBlocks([invalid], actions, calendar()));
  }
  assert.throws(() => validateWorkspaceCalendar(calendar({defaultWindows: new Array(1)})), /sparse/);
  assert.throws(() => validateWorkspaceCalendar(calendar({overrides: new Array(1)})), /sparse/);
  assert.throws(() => validateWorkspaceCalendar(calendar({commitments: new Array(1)})), /sparse/);
});

test('varied interval and dependency proposals satisfy independent placement and capacity checks', () => {
  let seed = 8139;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const start = 900 + Math.floor(random() * 240), capacity = 30 + Math.floor(random() * 240);
    const breakStart = start + Math.floor(capacity * .4), breakEnd = breakStart + Math.floor(random() * 20);
    const cal = freeze(calendar({defaultWindows: [{startMinute: start, endMinute: start + capacity}],
      restMinutes: Math.floor(random() * 16), commitments: breakEnd > breakStart
        ? [{id: 'fixed', title: 'Fixed', date: DATE, startMinute: breakStart, endMinute: breakEnd}] : []}));
    const actions = freeze(Array.from({length: 8}, (_, index) => action(`action-${index}`, 1 + Math.floor(random() * 300), {
      dependsOn: index && random() > .6 ? [`action-${index - 1}`] : [], deadline: random() > .7 ? '2026-10-15' : null,
    })));
    const result = planWorkspace(actions, cal);
    for (const allocation of result.blocks) assert.doesNotThrow(() => validateBlockPlacement(allocation, actions, cal, result.blocks));
    for (const day of result.days) assert.ok(day.used <= day.capacity, `capacity iteration ${iteration} on ${day.date}`);
    for (const item of actions) assert.ok(allocated(result, item.id) <= remainingMinutes(item));
    assert.equal(result.conflicts.length, 0);
  }
});
