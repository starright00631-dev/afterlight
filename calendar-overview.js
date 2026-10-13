/** Read-only civil-time overview of accepted calendar records. */
import { addDays, todayISO } from './domain.js';
import { validateWorkspaceCalendar, validatePlannedBlocks } from './workspace-planner.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const clock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const size = intervals => intervals.reduce((sum, interval) => sum + interval.endMinute - interval.startMinute, 0);
const overlaps = (first, second) => first.startMinute < second.endMinute && second.startMinute < first.endMinute;
const blockInterval = block => ({ startMinute: block.startMinute, endMinute: block.startMinute + block.minutes });

function merge(intervals) {
  const merged = [];
  for (const interval of intervals.map(value => ({ ...value })).sort((a, b) => a.startMinute - b.startMinute)) {
    const last = merged.at(-1);
    if (last && interval.startMinute <= last.endMinute) last.endMinute = Math.max(last.endMinute, interval.endMinute);
    else merged.push(interval);
  }
  return merged;
}
function subtract(intervals, cuts) {
  let result = intervals.map(interval => ({ ...interval }));
  for (const cut of cuts) result = result.flatMap(interval => {
    if (!overlaps(interval, cut)) return [interval];
    const pieces = [];
    if (interval.startMinute < cut.startMinute) pieces.push({ startMinute: interval.startMinute, endMinute: Math.min(interval.endMinute, cut.startMinute) });
    if (interval.endMinute > cut.endMinute) pieces.push({ startMinute: Math.max(interval.startMinute, cut.endMinute), endMinute: interval.endMinute });
    return pieces;
  });
  return result;
}
function intersections(first, second) {
  return merge(first.flatMap(left => second.filter(right => overlaps(left, right)).map(right => ({
    startMinute: Math.max(left.startMinute, right.startMinute), endMinute: Math.min(left.endMinute, right.endMinute),
  }))));
}
const weekday = date => new Date(`${date}T12:00:00+08:00`).toLocaleDateString('en', { weekday: 'short', timeZone: 'Asia/Shanghai' });
const dayLabel = date => new Date(`${date}T12:00:00+08:00`).toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'Asia/Shanghai' });

/** Exact proportional placement, clipped only to the displayed clock range. */
export function timelineGeometry(interval, axis) {
  if (!axis || !Number.isFinite(axis.startMinute) || !Number.isFinite(axis.endMinute) || axis.endMinute <= axis.startMinute) throw new RangeError('The clock range must end after it starts.');
  if (!interval || !Number.isFinite(interval.startMinute) || !Number.isFinite(interval.endMinute) || interval.endMinute <= interval.startMinute) throw new RangeError('A displayed interval must end after it starts.');
  const start = Math.max(axis.startMinute, interval.startMinute), end = Math.min(axis.endMinute, interval.endMinute);
  if (end <= start) return null;
  const scale = axis.endMinute - axis.startMinute;
  return { left: (start - axis.startMinute) * 100 / scale, width: (end - start) * 100 / scale, startMinute: start, endMinute: end };
}

/** Capacity uses interval unions, so stale overlapping records cannot inflate it.
 * Open time follows the planner's before/after-block rest buffers; neither rest
 * nor a closed reservation is reported as measured focus time. */
export function calendarOverviewData(state) {
  const input = state?.workbench?.calendar;
  if (input === null || input === undefined) return { calendar: null, axis: null, days: [], totals: { capacityMinutes: 0, plannedMinutes: 0, openMinutes: 0, restMinutes: 0 }, warnings: [] };
  const calendar = validateWorkspaceCalendar(input);
  const blocks = validatePlannedBlocks(state.workbench.blocks, state.actions, calendar);
  const titles = new Map(state.actions.map(action => [action.id, action.title]));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(calendar.startDate, index);
    const windows = (calendar.overrides.find(override => override.date === date)?.windows ?? calendar.defaultWindows).map(window => ({ ...window }));
    const commitments = calendar.commitments.filter(commitment => commitment.date === date).map(commitment => ({ ...commitment }));
    const records = blocks.filter(block => block.date === date).map(block => ({ ...block, title: titles.get(block.actionId) || 'Untitled action' }));
    const allocations = records.filter(block => block.status !== 'skipped');
    const occupied = merge(allocations.map(blockInterval));
    const free = subtract(windows, commitments);
    const unoccupied = subtract(free, occupied);
    const buffers = allocations.map(block => ({ startMinute: Math.max(0, block.startMinute - calendar.restMinutes), endMinute: Math.min(1440, block.startMinute + block.minutes + calendar.restMinutes) }));
    const open = subtract(free, buffers);
    const rest = subtract(unoccupied, open);
    const warnings = [];
    for (const block of records.filter(record => record.status === 'planned')) {
      if (!free.some(window => block.startMinute >= window.startMinute && block.startMinute + block.minutes <= window.endMinute)) warnings.push(`${block.title}: reserved time is outside current free availability.`);
      if (allocations.some(other => other.id !== block.id && overlaps(blockInterval(block), blockInterval(other)))) warnings.push(`${block.title}: reserved time overlaps another allocation.`);
      else if (allocations.some(other => other.id !== block.id && Math.max(other.startMinute - block.startMinute - block.minutes, block.startMinute - other.startMinute - other.minutes) < calendar.restMinutes)) warnings.push(`${block.title}: the gap to another allocation is shorter than the required rest.`);
    }
    return { date, windows, commitments, allocations, skippedCount: records.filter(block => block.status === 'skipped').length,
      open, rest, warnings, windowMinutes: size(windows), capacityMinutes: size(free),
      occupiedMinutes: size(intersections(free, occupied)), openMinutes: size(open), restMinutes: size(rest),
      plannedMinutes: records.filter(block => block.status === 'planned').reduce((sum, block) => sum + block.minutes, 0),
      closedMinutes: records.filter(block => block.status === 'done').reduce((sum, block) => sum + block.minutes, 0) };
  });
  const extents = days.flatMap(day => [...day.windows, ...day.commitments, ...day.allocations.map(blockInterval)]);
  let axis = null;
  if (extents.length) {
    const startMinute = Math.floor(Math.min(...extents.map(interval => interval.startMinute)) / 60) * 60;
    const endMinute = Math.min(1440, Math.ceil(Math.max(...extents.map(interval => interval.endMinute)) / 60) * 60);
    const step = Math.max(60, Math.ceil((endMinute - startMinute) / 240) * 60);
    const ticks = [startMinute];
    for (let minute = startMinute + step; minute < endMinute; minute += step) ticks.push(minute);
    ticks.push(endMinute);
    axis = { startMinute, endMinute, ticks };
  }
  const totals = days.reduce((sum, day) => ({ capacityMinutes: sum.capacityMinutes + day.capacityMinutes, plannedMinutes: sum.plannedMinutes + day.plannedMinutes,
    openMinutes: sum.openMinutes + day.openMinutes, restMinutes: sum.restMinutes + day.restMinutes }), { capacityMinutes: 0, plannedMinutes: 0, openMinutes: 0, restMinutes: 0 });
  return { calendar, axis, days, totals, warnings: days.flatMap(day => day.warnings) };
}

function segments(intervals, kind, axis, date) {
  return intervals.map(interval => {
    const geometry = timelineGeometry(interval, axis);
    if (!geometry) return '';
    const patterned = kind === 'commitment' || kind === 'rest';
    return `<rect class="calendar-map-segment calendar-map-${kind}" x="${geometry.left}%" width="${geometry.width}%" y="${kind === 'window' ? 2 : 5}" height="${kind === 'window' ? 23 : 17}" rx="2"${patterned ? ` fill="url(#calendar-map-${kind}-${date})"` : ''}></rect>`;
  }).join('');
}
function patterns(date) {
  return `<defs><pattern id="calendar-map-commitment-${date}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="6" height="6" class="calendar-map-commitment-base"></rect><rect width="3" height="6" class="calendar-map-commitment-stripe"></rect></pattern><pattern id="calendar-map-rest-${date}" patternUnits="userSpaceOnUse" width="4" height="17"><rect x="3" width="1" height="17" class="calendar-map-rest-stripe"></rect></pattern></defs>`;
}
function dayDescription(day, preview = false) {
  const content = [`${dayLabel(day.date)}. ${day.capacityMinutes} minutes available after commitments. ${day.plannedMinutes} minutes ${preview ? 'proposed, not reserved' : 'planned'}. ${day.openMinutes} minutes open after rest buffers.`];
  if (day.windows.length) content.push(`Availability: ${day.windows.map(window => `${clock(window.startMinute)}–${clock(window.endMinute)}`).join(', ')}.`);
  else content.push('No available work window.');
  for (const commitment of day.commitments) content.push(`Commitment: ${commitment.title}, ${clock(commitment.startMinute)}–${clock(commitment.endMinute)}.`);
  for (const allocation of day.allocations) content.push(`${allocation.status === 'done' ? 'Closed earlier allocation' : preview ? 'Proposed' : 'Reserved'}: ${allocation.title}, ${clock(allocation.startMinute)}–${clock(allocation.startMinute + allocation.minutes)}${allocation.pinned ? ', pinned' : ''}.`);
  if (day.skippedCount) content.push(`${day.skippedCount} earlier allocation${day.skippedCount === 1 ? '' : 's'} unreserved; no time occupied.`);
  content.push(...day.warnings);
  return content.join(' ');
}

function workSubtitle(day) {
  const planned = day.allocations.filter(allocation => allocation.status === 'planned');
  if (planned.length) return planned.map(allocation => allocation.title).join(' · ');
  const closed = day.allocations.filter(allocation => allocation.status === 'done');
  if (closed.length) return `Closed · ${closed.map(allocation => allocation.title).join(' · ')}`;
  if (day.commitments.length) return `Commitment · ${day.commitments.map(commitment => commitment.title).join(' · ')}`;
  return day.windows.length ? 'No sessions placed' : 'No available work window';
}

/** View selection never accepts a proposal or changes durable calendar records. */
export function renderCalendarOverview(state, { proposal = null, preview = false, selectedDate = null, today = todayISO() } = {}) {
  let model, comparisonAxis;
  const proposed = Boolean(preview && proposal);
  try {
    const acceptedModel=calendarOverviewData(state);
    const proposedModel=proposal?calendarOverviewData({...state,workbench:{...state.workbench,blocks:proposal.blocks}}):null;
    model=proposed?proposedModel:acceptedModel;
    const axes=[acceptedModel.axis,proposedModel?.axis].filter(Boolean);
    if(axes.length){
      const startMinute=Math.min(...axes.map(axis=>axis.startMinute)),endMinute=Math.max(...axes.map(axis=>axis.endMinute));
      const step=Math.max(60,Math.ceil((endMinute-startMinute)/240)*60),ticks=[startMinute];
      for(let minute=startMinute+step;minute<endMinute;minute+=step)ticks.push(minute);
      ticks.push(endMinute);comparisonAxis={startMinute,endMinute,ticks};
    }
  }
  catch (error) { return `<section class="calendar-map calendar-map-error" aria-label="Calendar overview"><h2>Calendar overview</h2><p role="status">This calendar cannot be drawn: ${escape(error.message)}</p></section>`; }
  if (!model.calendar) return '';
  const { days, totals } = model,axis=comparisonAxis||model.axis;
  const selected = days.some(day => day.date === selectedDate) ? selectedDate : days.some(day => day.date === today) ? today : days[0].date;
  const ticks = axis ? axis.ticks.map((minute, index) => `<text x="${(minute - axis.startMinute) * 100 / (axis.endMinute - axis.startMinute)}%" y="12" text-anchor="${index === 0 ? 'start' : index === axis.ticks.length - 1 ? 'end' : 'middle'}">${clock(minute)}</text>`).join('') : '';
  const legend = [
    days.some(day => day.windows.length) && '<span><i class="calendar-map-window"></i>Available window</span>',
    days.some(day => day.plannedMinutes) && `<span><i class="calendar-map-planned"></i>${proposed ? 'Proposed session' : 'Planned session'}</span>`,
    days.some(day => day.commitments.length) && '<span><i class="calendar-map-commitment"></i>Commitment</span>',
    days.some(day => day.restMinutes) && '<span><i class="calendar-map-rest"></i>Rest buffer</span>',
    days.some(day => day.closedMinutes) && '<span><i class="calendar-map-closed"></i>Closed allocation</span>',
  ].filter(Boolean).join('');
  return `<section class="calendar-map${proposed ? ' calendar-map-preview' : ''}" aria-labelledby="calendar-map-title"><header class="calendar-map-heading"><div><p class="eyebrow">${proposed ? 'Proposed · not reserved' : 'Accepted calendar'} · Asia/Shanghai</p><h2 id="calendar-map-title">Your week at a glance</h2><p>Select a day to see its work and open times.</p></div>${proposal ? `<div class="calendar-map-switch" role="group" aria-label="Calendar view"><button type="button" data-agenda="show-accepted" aria-pressed="${!proposed}">Accepted</button><button type="button" data-agenda="show-proposed" aria-pressed="${proposed}">Proposed</button></div>` : ''}<dl class="calendar-map-metrics"><div><dt>Available</dt><dd>${totals.capacityMinutes}<small>min</small></dd></div><div><dt>${proposed ? 'Proposed' : 'Planned'}</dt><dd>${totals.plannedMinutes}<small>min</small></dd></div><div><dt>Open after rest</dt><dd>${totals.openMinutes}<small>min</small></dd></div></dl></header>${proposal ? `<p class="calendar-map-notice">${proposed ? 'Preview only. These times are not reserved until you accept the proposal.' : 'Accepted times are shown. Select Proposed to compare the new plan.'}</p>` : ''}<div class="calendar-map-chart">${axis ? `<div class="calendar-map-axis" aria-hidden="true"><span>Day</span><div><svg width="100%" height="18" aria-hidden="true">${ticks}</svg></div><span>${proposed ? 'Proposed / open' : 'Planned / open'}</span></div>` : ''}${days.map(day => {
    const description = dayDescription(day, proposed);
    return `<button type="button" class="calendar-map-day${day.date === today ? ' calendar-map-today' : ''}${day.warnings.length ? ' calendar-map-conflict' : ''}" data-agenda="focus-day" data-date="${day.date}" aria-pressed="${day.date === selected}" aria-controls="agenda-selected-day" aria-label="${escape(description)} Show day details." title="${escape(description)}"><span class="calendar-map-date"><strong>${weekday(day.date)}</strong><small>${day.date.slice(5).replace('-', ' / ')}${day.date === today ? ' · today' : ''}</small></span><span class="calendar-map-track" aria-hidden="true"><svg width="100%" height="28" aria-hidden="true">${patterns(day.date)}${axis ? segments(day.windows, 'window', axis, day.date) + segments(day.rest, 'rest', axis, day.date) + segments(day.commitments, 'commitment', axis, day.date) + segments(day.allocations.filter(block => block.status === 'done').map(blockInterval), 'closed', axis, day.date) + segments(day.allocations.filter(block => block.status === 'planned').map(blockInterval), 'planned', axis, day.date) : ''}${!day.windows.length && !day.commitments.length && !day.allocations.length ? '<text x="8" y="18" class="calendar-map-no-window">No work window</text>' : ''}</svg></span><span class="calendar-map-day-minutes"><strong>${day.plannedMinutes}<small>min ${proposed ? 'proposed' : 'planned'}</small></strong><span>${day.openMinutes}<small>min open</small></span>${day.warnings.length ? '<em>Check times</em>' : ''}</span><span class="calendar-map-row-work">${escape(workSubtitle(day))}</span></button>`;
  }).join('')}</div>${legend ? `<div class="calendar-map-legend" aria-label="Calendar colour and pattern key">${legend}</div>` : ''}<details class="calendar-map-details"><summary>Times and how to read them</summary><p>Every band uses the same clock scale. Available time excludes fixed commitments; open time also excludes ${proposed ? 'the proposed allocations' : 'accepted allocations'} and the planner’s rest buffers. Small gaps may not fit your minimum session length. Closed allocations retain their reserved times, rather than reporting measured work. Unreserved earlier allocations do not occupy time.</p>${days.map(day => `<p><strong>${dayLabel(day.date)}</strong> · ${escape(dayDescription(day, proposed).replace(`${dayLabel(day.date)}. `, ''))}</p>`).join('')}</details>${model.warnings.length ? `<p class="calendar-map-notice" role="status">Some ${proposed ? 'proposed' : 'reserved'} times conflict with the current calendar. Select the marked day to review them.</p>` : ''}</section>`;
}
