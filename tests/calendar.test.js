import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleActions } from '../domain.js';
import { calendarExport } from '../calendar.js';

const NOW = new Date('2026-10-11T12:34:56.789Z');
const plan = (overrides = {}) => ({ startDate: '2026-10-11', days: 7, dailyMinutes: 90, startTime: '19:00', restMinutes: 5, ...overrides });
const action = (id, minutes, title = 'Write the brief') => ({ id, minutes, title, status: 'todo', dependsOn: [], deadline: null });
const unfold = (text) => text.replace(/\r\n[ \t]/g, '');
const events = (text) => unfold(text).split('BEGIN:VEVENT\r\n').slice(1).map((part) => part.split('END:VEVENT')[0]);
const field = (event, key) => event.split('\r\n').find((line) => line.startsWith(`${key}:`))?.slice(key.length + 1);

test('calendar exports a valid envelope and escapes source-derived punctuation and every newline form', () => {
  const items = [action('action-a', 20, 'Review, compare; keep \\ notes\nSecond\r\nThird\rFourth')];
  const result = calendarExport(scheduleActions(items, plan()), items, 'Project, one; \\two\nNext', NOW);
  const plain = unfold(result);
  assert.ok(result.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(result.endsWith('END:VCALENDAR\r\n'));
  assert.ok(plain.includes('X-WR-CALNAME:Project\\, one\\; \\\\two\\nNext\r\n'));
  const event = events(result)[0];
  assert.equal(field(event, 'SUMMARY'), 'Review\\, compare\\; keep \\\\ notes\\nSecond\\nThird\\nFourth');
  assert.equal(field(event, 'DTSTAMP'), '20261011T123456Z');
  assert.match(field(event, 'DESCRIPTION'), /Estimated work: 20 minutes/);
  assert.match(field(event, 'DESCRIPTION'), /no background reminder/);
  assert.equal(result.replaceAll('\r\n', '').includes('\r'), false);
  assert.equal(result.replaceAll('\r\n', '').includes('\n'), false);
});

test('UTF-8 folding stays within75 octets and unfolding preserves multibyte characters and complete content', () => {
  const title = '研究🙂 '.repeat(45) + 'Final phrase';
  const items = [action('unicode-action', 20, title)];
  const result = calendarExport(scheduleActions(items, plan()), items, '夜间项目 '.repeat(30), NOW);
  const physical = result.split('\r\n').filter(Boolean);
  assert.ok(physical.some((line) => line.startsWith(' ')));
  for (const line of physical) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `${Buffer.byteLength(line, 'utf8')} bytes: ${line}`);
    assert.equal(Buffer.from(line, 'utf8').toString('utf8'), line);
    assert.equal(line.includes('\uFFFD'), false);
  }
  assert.equal(field(events(result)[0], 'SUMMARY'), title);
  assert.ok(unfold(result).includes('X-WR-CALNAME:' + '夜间项目 '.repeat(30)));
});

test('a long split action produces distinct events on the actual scheduled dates with exact block minutes', () => {
  const items = [action('long-action', 190)];
  const schedule = scheduleActions(items, plan());
  const exported = events(calendarExport(schedule, items, 'A real plan', NOW));
  assert.equal(exported.length, 3);
  assert.deepEqual(exported.map((event) => field(event, 'DTSTART')), [
    '20261011T190000', '20261012T190000', '20261013T190000',
  ]);
  assert.deepEqual(exported.map((event) => field(event, 'DTEND')), [
    '20261011T203000', '20261012T203000', '20261013T191000',
  ]);
  assert.equal(new Set(exported.map((event) => field(event, 'UID'))).size, 3);
  assert.deepEqual(exported.map((event) => field(event, 'DESCRIPTION').match(/Estimated work: (\d+) minutes/)[1]), ['90', '90', '10']);
});

test('rest is represented by a real gap between work events, rather than added to work duration', () => {
  const items = [action('first', 30), action('second', 40)];
  const exported = events(calendarExport(scheduleActions(items, plan()), items, 'Two outputs', NOW));
  assert.equal(exported.length, 2);
  assert.equal(field(exported[0], 'DTEND'), '20261011T193000');
  assert.equal(field(exported[1], 'DTSTART'), '20261011T193500');
  assert.equal(field(exported[1], 'DTEND'), '20261011T201500');
  assert.match(field(exported[1], 'DESCRIPTION'), /40 minutes/);
});

test('an allowed midnight boundary rolls to the following calendar date instead of emitting hour24', () => {
  const items = [action('midnight', 60)];
  const schedule = scheduleActions(items, plan({ startTime: '23:00', dailyMinutes: 60 }));
  assert.equal(schedule.days[0].blocks[0].endMinute, 1440);
  const exported = events(calendarExport(schedule, items, 'Late work', NOW));
  assert.equal(field(exported[0], 'DTSTART'), '20261011T230000');
  assert.equal(field(exported[0], 'DTEND'), '20261012T000000');
  assert.equal(unfold(calendarExport(schedule, items, 'Late work', NOW)).includes('T240000'), false);
});

test('exports include only scheduled blocks and do not invent events for blocked or overflow work', () => {
  const items = [action('large', 100), { ...action('blocked', 20), status: 'blocked' }];
  const schedule = scheduleActions(items, plan({ days: 1 }));
  assert.equal(schedule.overflow.length, 2);
  const exported = events(calendarExport(schedule, items, 'Over budget', NOW));
  assert.equal(exported.length, 1);
  assert.match(field(exported[0], 'DESCRIPTION'), /90 minutes/);
  assert.match(field(exported[0], 'UID'), /^large-/);
  const empty = calendarExport(scheduleActions([], plan()), [], 'Nothing scheduled', NOW);
  assert.equal(events(empty).length, 0);
  assert.ok(empty.endsWith('END:VCALENDAR\r\n'));
});
