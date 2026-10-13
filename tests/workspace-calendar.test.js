import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceCalendarExport} from '../calendar.js';
import {planWorkspace} from '../workspace-planner.js';

const DATE = '2026-10-13', NOW = new Date('2026-10-13T12:34:56.789Z');
const action = (id, title = 'Write, compare; preserve \\ context') => ({id, title, minutes: 30, remainingMinutes: null,
  status: 'todo', dependsOn: [], deadline: null});
const calendar = {timeZone: 'Asia/Shanghai', startDate: DATE, days: 7, defaultWindows: [{startMinute: 1140, endMinute: 1260}],
  overrides: [], commitments: [], restMinutes: 5, minBlockMinutes: 15};
const block = (id, actionId, date, startMinute, minutes, status = 'planned') => ({id, actionId, date, startMinute, minutes, pinned: false, status});
const unfold = (text) => text.replace(/\r\n[ \t]/g, '');
const events = (text) => unfold(text).split('BEGIN:VEVENT\r\n').slice(1).map((part) => part.split('END:VEVENT')[0]);
const field = (event, key) => event.split('\r\n').find((line) => line.startsWith(`${key}:`))?.slice(key.length + 1);

test('accepted workspace allocations export exact Shanghai instants as UTC with stable block identities', () => {
  const actions = [action('a'), action('b')];
  const first = planWorkspace(actions, calendar);
  const again = planWorkspace(actions, calendar, {previousBlocks: first.blocks});
  const earlier = events(workspaceCalendarExport(first.blocks, actions, calendar, 'Workspace', NOW));
  const later = events(workspaceCalendarExport(again.blocks.toReversed(), actions, calendar, 'Workspace', new Date('2026-10-14T03:00:00.000Z')));
  assert.deepEqual(earlier.map((event) => field(event, 'DTSTART')), ['20261013T110000Z', '20261013T113500Z']);
  assert.deepEqual(earlier.map((event) => field(event, 'DTEND')), ['20261013T113000Z', '20261013T120500Z']);
  assert.equal(field(earlier[0], 'DTSTAMP'), '20261013T123456Z');
  assert.deepEqual(earlier.map((event) => field(event, 'UID')).sort(), later.map((event) => field(event, 'UID')).sort());
  assert.equal(field(earlier[0], 'UID'), `${first.blocks[0].id}@afterlight.local`);
  assert.match(field(earlier[0], 'DESCRIPTION'), /not an actual work-session record/);
  assert.ok(unfold(workspaceCalendarExport(first.blocks, actions, calendar, 'Workspace', NOW)).includes('X-WR-TIMEZONE:Asia/Shanghai'));
});

test('UTC conversion correctly crosses both local midnight and prior UTC date boundaries', () => {
  const actions = [action('a'), action('b')];
  const blocks = [block('early', 'a', DATE, 0, 30), block('late', 'b', DATE, 1410, 30)];
  const exported = events(workspaceCalendarExport(blocks, actions, calendar, 'Civil dates', NOW));
  assert.equal(field(exported[0], 'DTSTART'), '20261012T160000Z');
  assert.equal(field(exported[0], 'DTEND'), '20261012T163000Z');
  assert.equal(field(exported[1], 'DTSTART'), '20261013T153000Z');
  assert.equal(field(exported[1], 'DTEND'), '20261013T160000Z');
  assert.equal(exported.some((event) => event.includes('T240000')), false);
});

test('calendar export preserves UTF-8 source titles, escapes punctuation and omits skipped allocations', () => {
  const title = '研究🙂 '.repeat(45) + 'Review, compare; \\ keep\r\nnotes';
  const actions = [action('a', title), action('b')];
  const blocks = [block('kept:with.dot', 'a', DATE, 1140, 30), block('skip', 'b', DATE, 1200, 30, 'skipped')];
  const result = workspaceCalendarExport(blocks, actions, calendar, 'Two; projects\nShared', NOW);
  assert.ok(result.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(result.endsWith('END:VCALENDAR\r\n'));
  for (const line of result.split('\r\n').filter(Boolean)) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  const exported = events(result);
  assert.equal(exported.length, 1);
  assert.equal(field(exported[0], 'UID'), 'kept%3Awith.dot@afterlight.local');
  assert.equal(field(exported[0], 'SUMMARY'), '研究🙂 '.repeat(45) + 'Review\\, compare\\; \\\\ keep\\nnotes');
  assert.match(unfold(result), /X-WR-CALNAME:Two\\; projects\\nShared/);
  assert.throws(() => workspaceCalendarExport(blocks, actions, calendar, 'Invalid', new Date('bad')));
});
