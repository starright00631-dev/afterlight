import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarOverviewData, renderCalendarOverview, timelineGeometry } from '../calendar-overview.js';

const DATE = '2026-10-13';
const action = (id, extra = {}) => ({ id, title: id, projectId: 'project', status: 'todo', minutes: 120, remainingMinutes: null, dependsOn: [], deadline: null, ...extra });
const block = (id, actionId, startMinute, minutes, extra = {}) => ({ id, actionId, date: DATE, startMinute, minutes, pinned: false, status: 'planned', ...extra });
const calendar = (extra = {}) => ({ timeZone: 'Asia/Shanghai', startDate: DATE, days: 7,
  defaultWindows: [{ startMinute: 1140, endMinute: 1260 }], overrides: [], commitments: [], restMinutes: 5, minBlockMinutes: 15, ...extra });
const state = (extra = {}) => ({ actions: [action('first'), action('second')], workbench: { calendar: calendar(), blocks: [], sessions: [], ...extra } });
const freeze = value => { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return value; };

test('clock geometry preserves minute proportions and clips both edges without widening small gaps', () => {
  const axis = { startMinute: 1140, endMinute: 1260 };
  assert.deepEqual(timelineGeometry({ startMinute: 1170, endMinute: 1200 }, axis), { left: 25, width: 25, startMinute: 1170, endMinute: 1200 });
  assert.deepEqual(timelineGeometry({ startMinute: 1100, endMinute: 1170 }, axis), { left: 0, width: 25, startMinute: 1140, endMinute: 1170 });
  assert.deepEqual(timelineGeometry({ startMinute: 1230, endMinute: 1300 }, axis), { left: 75, width: 25, startMinute: 1230, endMinute: 1260 });
  assert.equal(timelineGeometry({ startMinute: 100, endMinute: 200 }, axis), null);
  assert.equal(timelineGeometry({ startMinute: 1260, endMinute: 1270 }, axis), null);
  assert.equal(timelineGeometry({ startMinute: 1199, endMinute: 1200 }, axis).width, 100 / 120);
  assert.throws(() => timelineGeometry({ startMinute: 20, endMinute: 20 }, axis), /interval/);
  assert.throws(() => timelineGeometry({ startMinute: 20, endMinute: 30 }, { startMinute: 10, endMinute: 10 }), /clock/);
});

test('capacity, accepted work, closed geometry, and rest remain separate and use actual intersections', () => {
  const input = state({ calendar: calendar({ commitments: [{ id: 'class', title: 'Class', date: DATE, startMinute: 1170, endMinute: 1180 }] }),
    blocks: [block('planned', 'first', 1140, 30), block('closed', 'second', 1200, 20, { status: 'done' })] });
  const model = calendarOverviewData(input), day = model.days[0];
  assert.equal(day.windowMinutes, 120);
  assert.equal(day.capacityMinutes, 110);
  assert.equal(day.plannedMinutes, 30);
  assert.equal(day.closedMinutes, 20);
  assert.equal(day.occupiedMinutes, 50);
  assert.equal(day.restMinutes, 10);
  assert.equal(day.openMinutes, 50);
  assert.deepEqual(day.open, [{ startMinute: 1180, endMinute: 1195 }, { startMinute: 1225, endMinute: 1260 }]);
  assert.equal(day.capacityMinutes, day.occupiedMinutes + day.restMinutes + day.openMinutes);
  assert.deepEqual(model.totals, { capacityMinutes: 830, plannedMinutes: 30, openMinutes: 770, restMinutes: 10 });
});

test('a commitment outside availability is drawn at its true time without subtracting unrelated capacity', () => {
  const model = calendarOverviewData(state({ calendar: calendar({ commitments: [{ id: 'class', title: 'Class', date: DATE, startMinute: 600, endMinute: 660 }] }) }));
  assert.equal(model.days[0].capacityMinutes, 120);
  assert.equal(model.days[0].openMinutes, 120);
  assert.equal(model.axis.startMinute, 600);
  assert.equal(model.axis.endMinute, 1260);
  assert.deepEqual(model.days[0].commitments[0], { id: 'class', title: 'Class', date: DATE, startMinute: 600, endMinute: 660 });
});

test('stale overlapping reservations remain visible with warnings without double-counting occupied capacity', () => {
  const model = calendarOverviewData(state({ blocks: [block('one', 'first', 1140, 30), block('two', 'second', 1155, 30)] }));
  const day = model.days[0];
  assert.equal(day.plannedMinutes, 60, 'retained reservation durations are preserved, not silently corrected');
  assert.equal(day.occupiedMinutes, 45);
  assert.equal(day.restMinutes, 5);
  assert.equal(day.openMinutes, 70);
  assert.equal(day.capacityMinutes, day.occupiedMinutes + day.restMinutes + day.openMinutes);
  assert.equal(day.warnings.length, 2);
  assert.match(renderCalendarOverview(state({ blocks: [block('one', 'first', 1130, 30)] })), /Check times/);
  assert.match(calendarOverviewData(state({ blocks: [block('one', 'first', 1130, 30)] })).warnings[0], /outside current free/);
});

test('an accepted gap shorter than protected rest is visibly flagged rather than silently accepted', () => {
  const input = state({ blocks: [block('one', 'first', 1140, 30), block('two', 'second', 1172, 30)] });
  const model = calendarOverviewData(input);
  assert.equal(model.days[0].warnings.length, 2);
  assert.ok(model.days[0].warnings.every(warning => warning.includes('shorter than the required rest')));
  assert.match(renderCalendarOverview(input), /Check times/);
  assert.equal(model.days[0].capacityMinutes, model.days[0].occupiedMinutes + model.days[0].restMinutes + model.days[0].openMinutes);
});

test('date closures and unreserved history occupy no time and do not create a clock axis', () => {
  const model = calendarOverviewData(state({ calendar: calendar({ defaultWindows: [] }),
    blocks: [block('skipped', 'first', 360, 120, { status: 'skipped' })] }));
  assert.equal(model.axis, null);
  assert.equal(model.days.length, 7);
  assert.equal(model.days[0].skippedCount, 1);
  assert.equal(model.days[0].occupiedMinutes, 0);
  assert.equal(model.days[0].openMinutes, 0);
  assert.equal(model.totals.capacityMinutes, 0);
  assert.match(renderCalendarOverview(state({ calendar: calendar({ defaultWindows: [] }) })), /No work window/);
  const closed = calendarOverviewData(state({ calendar: calendar({ overrides: [{ date: DATE, windows: [] }] }) }));
  assert.equal(closed.days[0].capacityMinutes, 0);
  assert.equal(closed.days[1].capacityMinutes, 120);
});

test('the overview is read-only and returned arrays do not alias saved calendar records', () => {
  const input = freeze(state({ blocks: [block('one', 'first', 1140, 30)] })), before = JSON.stringify(input);
  const model = calendarOverviewData(input);
  renderCalendarOverview(input, { today: DATE });
  model.days[0].windows[0].startMinute = 0;
  model.days[0].allocations[0].title = 'changed';
  model.calendar.defaultWindows[0].startMinute = 0;
  assert.equal(JSON.stringify(input), before);
});

test('accepted records alone drive the map while a proposal is clearly disclosed and remains unreserved', () => {
  const input = state();
  const html = renderCalendarOverview(input, { today: DATE, proposal: { blocks: [block('proposed', 'first', 1140, 30)] } });
  assert.match(html, /Accepted times are shown\. Select Proposed to compare the new plan\./);
  assert.match(html, /data-agenda="show-accepted" aria-pressed="true"/);
  assert.match(html, /data-agenda="show-proposed" aria-pressed="false"/);
  assert.match(html, /<dt>Planned<\/dt><dd>0<small>min<\/small>/);
  assert.doesNotMatch(html, /class="calendar-map-segment calendar-map-planned"/);
  assert.equal(input.workbench.blocks.length, 0);
});

test('native day controls, detailed textual equivalents, safe titles and state-specific patterns support usable reading', () => {
  const input = state({ blocks: [block('one', 'first', 1140, 30), block('two', 'second', 1200, 20, { status: 'done' })],
    calendar: calendar({ commitments: [{ id: 'call', title: '<script>call</script>', date: DATE, startMinute: 1180, endMinute: 1190 }] }) });
  input.actions[0].title = 'Read "A&B"';
  const html = renderCalendarOverview(input, { today: DATE });
  assert.equal((html.match(/data-agenda="focus-day"/g) || []).length, 7);
  assert.match(html, /data-date="2026-10-13"/);
  assert.match(html, /calendar-map-today/);
  assert.match(html, /class="calendar-map-segment calendar-map-planned"/);
  assert.match(html, /class="calendar-map-segment calendar-map-closed"/);
  assert.match(html, /class="calendar-map-segment calendar-map-commitment"/);
  assert.match(html, /class="calendar-map-segment calendar-map-rest"/);
  assert.match(html, /Read &quot;A&amp;B&quot;/);
  assert.match(html, /&lt;script&gt;call&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Closed earlier allocation: second, 20:00–20:20/);
  assert.match(html, /rather than reporting measured work/);
  assert.match(html, /<summary>Times and how to read them<\/summary>/);
});

test('midnight endpoints and missing or invalid calendars are represented honestly', () => {
  assert.equal(renderCalendarOverview({ workbench: { calendar: null } }), '');
  assert.deepEqual(calendarOverviewData({ workbench: { calendar: null } }).days, []);
  const late = state({ calendar: calendar({ defaultWindows: [{ startMinute: 1380, endMinute: 1440 }] }) });
  assert.equal(calendarOverviewData(late).axis.endMinute, 1440);
  assert.match(renderCalendarOverview(late), /24:00/);
  const invalid = state({ calendar: calendar({ timeZone: 'UTC' }) });
  assert.throws(() => calendarOverviewData(invalid), /Asia\/Shanghai/);
  assert.match(renderCalendarOverview(invalid), /This calendar cannot be drawn/);
  assert.doesNotMatch(renderCalendarOverview(invalid), /data-agenda="focus-day"/);
});

test('timeline and clock positions use native SVG geometry compatible with the strict self-only style policy', () => {
  const input = state({ blocks: [block('one', 'first', 1170, 30)], calendar: calendar({
    commitments: [{ id: 'call', title: 'Call', date: DATE, startMinute: 1210, endMinute: 1220 }],
  }) });
  const html = renderCalendarOverview(input, { today: DATE });
  assert.doesNotMatch(html, /\sstyle\s*=/i, 'the server disallows inline style attributes');
  assert.doesNotMatch(html, /<style\b/i, 'rendering must not inject a stylesheet');
  assert.match(html, /<rect class="calendar-map-segment calendar-map-planned" x="25%" width="25%" y="5" height="17"/);
  assert.match(html, /<rect class="calendar-map-segment calendar-map-window" x="0%" width="100%" y="2" height="23"/);
  assert.match(html, /<text x="0%" y="12" text-anchor="start">19:00<\/text>/);
  assert.match(html, /<text x="50%" y="12" text-anchor="middle">20:00<\/text>/);
  assert.match(html, /<text x="100%" y="12" text-anchor="end">21:00<\/text>/);
  assert.match(html, /fill="url\(#calendar-map-commitment-2026-10-13\)"/);
  assert.match(html, /fill="url\(#calendar-map-rest-2026-10-13\)"/);
  const patternIds = [...html.matchAll(/<pattern id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(patternIds.length, 14);
  assert.equal(new Set(patternIds).size, 14, 'patterns must retain unique references across all seven native SVGs');
  assert.doesNotMatch(html, /viewBox=/, 'SVG text stays in viewport pixel units rather than stretching with a scaled viewBox');
});

test('a proposal preview shows proposed geometry and estimates while preserving both accepted state and the proposal', () => {
  const input = freeze(state({ blocks: [block('accepted', 'first', 1140, 30)] }));
  const proposal = freeze({ blocks: [block('candidate', 'second', 1200, 45)] });
  const before = JSON.stringify({ input, proposal });
  const html = renderCalendarOverview(input, { proposal, preview: true, selectedDate: DATE, today: DATE });
  assert.match(html, /Proposed · not reserved · Asia\/Shanghai/);
  assert.match(html, /Preview only\. These times are not reserved until you accept the proposal\./);
  assert.match(html, /data-agenda="show-accepted" aria-pressed="false"/);
  assert.match(html, /data-agenda="show-proposed" aria-pressed="true"/);
  assert.match(html, /<dt>Proposed<\/dt><dd>45<small>min<\/small>/);
  assert.match(html, /<rect class="calendar-map-segment calendar-map-planned" x="50%" width="37.5%"/);
  assert.match(html, /<span class="calendar-map-row-work">second<\/span>/);
  assert.doesNotMatch(html, /<span class="calendar-map-row-work">first<\/span>/);
  assert.match(html, /Proposed: second, 20:00–20:45/);
  assert.doesNotMatch(html, /Reserved: second/);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.equal(JSON.stringify({ input, proposal }), before);
  assert.match(renderCalendarOverview(input, { proposal, preview: false }), /<dt>Planned<\/dt><dd>30<small>min<\/small>/);
});

test('selected days expose one pressed native control connected to the adjacent details panel', () => {
  const html = renderCalendarOverview(state(), { selectedDate: '2026-10-15', today: DATE });
  const dayControls = [...html.matchAll(/<button[^>]*class="calendar-map-day[^>]*>/g)].map(match => match[0]);
  assert.equal(dayControls.length, 7);
  assert.equal(dayControls.filter(control => control.includes('aria-pressed="true"')).length, 1);
  assert.ok(dayControls.find(control => control.includes('data-date="2026-10-15"')).includes('aria-pressed="true"'));
  assert.ok(dayControls.every(control => control.includes('aria-controls="agenda-selected-day"')));
  assert.match(html, /<small>min planned<\/small>/);
  assert.match(html, /<small>min open<\/small>/);
  const fallback = renderCalendarOverview(state(), { selectedDate: '2026-12-25', today: DATE });
  assert.match(fallback, /data-date="2026-10-13" aria-pressed="true"/);
  const outsideToday = renderCalendarOverview(state(), { today: '2026-12-25' });
  assert.match(outsideToday, /data-date="2026-10-13" aria-pressed="true"/);
});

test('visible session subtitles retain escaped task identity without relying on anonymous bars or tooltip content', () => {
  const input = state({ blocks: [block('one', 'first', 1140, 30), block('two', 'second', 1200, 20)] });
  input.actions[0].title = '<Compare> A&B';
  const html = renderCalendarOverview(input, { today: DATE });
  assert.match(html, /<span class="calendar-map-row-work">&lt;Compare&gt; A&amp;B · second<\/span>/);
  assert.doesNotMatch(html, /<Compare>/);
  assert.match(html, /<span class="calendar-map-row-work">No sessions placed<\/span>/);
  const closed = renderCalendarOverview(state({ blocks: [block('one', 'first', 1140, 30, { status: 'done' })] }));
  assert.match(closed, /<span class="calendar-map-row-work">Closed · first<\/span>/);
});

test('preview without a proposal stays accepted and malformed preview data cannot fabricate a calendar', () => {
  const input = state({ blocks: [block('one', 'first', 1140, 30)] });
  const noProposal = renderCalendarOverview(input, { preview: true });
  assert.match(noProposal, /Accepted calendar · Asia\/Shanghai/);
  assert.doesNotMatch(noProposal, /data-agenda="show-proposed"/);
  assert.match(noProposal, /<dt>Planned<\/dt><dd>30<small>min<\/small>/);
  const before = JSON.stringify(input);
  const invalid = renderCalendarOverview(input, { preview: true, proposal: { blocks: [block('unknown', 'missing', 1140, 30)] } });
  assert.match(invalid, /This calendar cannot be drawn/);
  assert.doesNotMatch(invalid, /data-agenda="focus-day"/);
  assert.equal(JSON.stringify(input), before);
});

test('legends describe only categories present in the chosen view', () => {
  const empty = renderCalendarOverview(state());
  const legend = empty.match(/<div class="calendar-map-legend"[\s\S]*?<\/div>/)?.[0];
  assert.match(legend, /Available window/);
  assert.doesNotMatch(legend, /Planned session|Commitment|Rest buffer|Closed allocation/);
  const proposed = renderCalendarOverview(state(), { preview: true, proposal: { blocks: [block('one', 'first', 1140, 30)] } });
  const proposedLegend = proposed.match(/<div class="calendar-map-legend"[\s\S]*?<\/div>/)?.[0];
  assert.match(proposedLegend, /Proposed session/);
  assert.doesNotMatch(proposedLegend, /Planned session/);
});

test('accepted and proposed views retain a common clock scale when replanning moves an outlying reservation', () => {
  const input=state({blocks:[block('old','first',1320,30)]});
  const proposal={blocks:[block('new','first',1140,30)]};
  const accepted=renderCalendarOverview(input,{proposal}),proposed=renderCalendarOverview(input,{proposal,preview:true});
  const axis=html=>html.match(/<div class="calendar-map-axis"[\s\S]*?<\/svg>/)?.[0].replace(/Planned|Proposed/g,'View');
  assert.equal(axis(accepted),axis(proposed));
  assert.match(axis(proposed),/23:00/);
  assert.match(accepted,/outside current free availability/);
  assert.equal(input.workbench.blocks[0].startMinute,1320);
});
