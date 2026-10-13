/** Shared, civil-time work planning. Allocations are proposals, not evidence of work. */
import {addDays, uid} from './domain.js';

const MAX_ACTIONS = 500;
const MAX_BLOCKS = 5000;
const statuses = ['planned', 'done', 'skipped'];
const object = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid ${label}.`);
};
const integer = (value, min, max, label) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${label} must be an integer between ${min} and ${max}.`);
};
const date = (value) => { addDays(value, 0); return value; };
const identifier = (value, label) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,120}$/.test(value)) throw new RangeError(`Invalid ${label}.`);
  return value;
};
const length = (value, maximum, label) => {
  if (!Array.isArray(value) || value.length > maximum) throw new RangeError(`Invalid ${label}.`);
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) throw new RangeError(`${label} must not be sparse.`);
};
const end = (block) => block.startMinute + block.minutes;
const compareBlocks = (a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute || a.id.localeCompare(b.id);
const instant = (civilDate, minute) => Date.parse(`${civilDate}T00:00:00.000Z`) / 60000 + minute;
const overlap = (a, b) => a.startMinute < b.endMinute && b.startMinute < a.endMinute;

function windows(value, label) {
  length(value, 24, label);
  const result = value.map((window) => {
    object(window, label);
    integer(window.startMinute, 0, 1439, 'Window start');
    integer(window.endMinute, 1, 1440, 'Window end');
    if (window.endMinute <= window.startMinute) throw new RangeError('An availability window must end after it starts.');
    return {startMinute: window.startMinute, endMinute: window.endMinute};
  }).sort((a, b) => a.startMinute - b.startMinute);
  for (let index = 1; index < result.length; index += 1) {
    if (overlap(result[index - 1], result[index])) throw new RangeError('Availability windows must not overlap.');
  }
  return result;
}

export function validateWorkspaceCalendar(calendar) {
  object(calendar, 'workspace calendar');
  if (calendar.timeZone !== 'Asia/Shanghai') throw new RangeError('The workspace calendar uses Asia/Shanghai civil time.');
  date(calendar.startDate);
  if (calendar.days !== 7) throw new RangeError('The workspace calendar has seven planning days.');
  integer(calendar.restMinutes, 0, 120, 'Rest minutes');
  integer(calendar.minBlockMinutes, 1, 120, 'Minimum block minutes');
  const defaultWindows = windows(calendar.defaultWindows, 'Default windows');
  length(calendar.overrides, 366, 'Date overrides');
  const overrideDates = new Set();
  const overrides = calendar.overrides.map((override) => {
    object(override, 'date override'); date(override.date);
    if (overrideDates.has(override.date)) throw new RangeError('Date overrides must be unique.');
    overrideDates.add(override.date);
    return {date: override.date, windows: windows(override.windows, 'Override windows')};
  }).sort((a, b) => a.date.localeCompare(b.date));
  length(calendar.commitments, 1000, 'Commitments');
  const ids = new Set();
  const commitments = calendar.commitments.map((commitment) => {
    object(commitment, 'commitment'); identifier(commitment.id, 'commitment ID'); date(commitment.date);
    if (ids.has(commitment.id)) throw new RangeError('Commitment IDs must be unique.');
    ids.add(commitment.id);
    if (typeof commitment.title !== 'string' || !commitment.title.trim() || commitment.title.length > 500) throw new RangeError('A commitment needs a title of at most 500 characters.');
    integer(commitment.startMinute, 0, 1439, 'Commitment start');
    integer(commitment.endMinute, 1, 1440, 'Commitment end');
    if (commitment.endMinute <= commitment.startMinute) throw new RangeError('A commitment must end after it starts.');
    return {id: commitment.id, title: commitment.title, date: commitment.date, startMinute: commitment.startMinute, endMinute: commitment.endMinute};
  }).sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute);
  for (let index = 1; index < commitments.length; index += 1) {
    if (commitments[index - 1].date === commitments[index].date && overlap(commitments[index - 1], commitments[index])) throw new RangeError('Commitments on the same date must not overlap.');
  }
  return {timeZone: 'Asia/Shanghai', startDate: calendar.startDate, days: 7, defaultWindows, overrides, commitments,
    restMinutes: calendar.restMinutes, minBlockMinutes: calendar.minBlockMinutes};
}

export function createWorkspaceCalendar(plan) {
  object(plan, 'project plan'); date(plan.startDate);
  integer(plan.dailyMinutes, 0, 720, 'Daily minutes');
  integer(plan.restMinutes, 0, 120, 'Rest minutes');
  if (typeof plan.startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.startTime)) throw new RangeError('Start time must be HH:MM.');
  const [hour, minute] = plan.startTime.split(':').map(Number);
  const startMinute = hour * 60 + minute;
  if (startMinute + plan.dailyMinutes > 1440) throw new RangeError('Availability must finish by midnight.');
  return validateWorkspaceCalendar({timeZone: 'Asia/Shanghai', startDate: plan.startDate, days: 7,
    defaultWindows: plan.dailyMinutes ? [{startMinute, endMinute: startMinute + plan.dailyMinutes}] : [],
    overrides: [], commitments: [], restMinutes: plan.restMinutes, minBlockMinutes: 15});
}

export function remainingMinutes(action) {
  object(action, 'action');
  integer(action.minutes, 1, 10080, 'Original estimate');
  const remaining = action.remainingMinutes ?? action.minutes;
  integer(remaining, 0, 10080, 'Remaining estimate');
  return remaining;
}

function actionMap(actions) {
  length(actions, MAX_ACTIONS, 'Actions');
  const map = new Map();
  actions.forEach((action, index) => {
    object(action, 'action'); identifier(action.id, 'action ID'); remainingMinutes(action);
    if (map.has(action.id)) throw new RangeError('Action IDs must be unique.');
    if (!['todo', 'done', 'blocked'].includes(action.status)) throw new RangeError('Unknown action status.');
    length(action.dependsOn, MAX_ACTIONS, 'Dependencies');
    action.dependsOn.forEach((id) => identifier(id, 'dependency ID'));
    if (new Set(action.dependsOn).size !== action.dependsOn.length) throw new RangeError('Dependencies must be unique.');
    if (action.deadline !== null) date(action.deadline);
    map.set(action.id, {...action, dependsOn: [...action.dependsOn], index});
  });
  return map;
}

export function readyActions(actions) {
  const map = actionMap(actions);
  return actions.filter((action) => action.status === 'todo' && action.dependsOn.every((id) => map.get(id)?.status === 'done'));
}

/** Shape/reference validation deliberately keeps stale accepted geometry recoverable. */
export function validatePlannedBlocks(blocks, actions, calendar = null) {
  const map = actionMap(actions); length(blocks, MAX_BLOCKS, 'Planned blocks');
  if (calendar === null && blocks.length) throw new RangeError('Accepted allocations require a workspace calendar.');
  if (calendar !== null) validateWorkspaceCalendar(calendar);
  const ids = new Set();
  return blocks.map((block) => {
    object(block, 'planned block'); identifier(block.id, 'block ID'); identifier(block.actionId, 'block action ID'); date(block.date);
    if (ids.has(block.id)) throw new RangeError('Block IDs must be unique.'); ids.add(block.id);
    if (!map.has(block.actionId)) throw new RangeError('A block refers to a missing action.');
    integer(block.startMinute, 0, 1439, 'Block start'); integer(block.minutes, 1, 1440, 'Block duration');
    if (end(block) > 1440) throw new RangeError('A block must finish by midnight.');
    if (typeof block.pinned !== 'boolean' || !statuses.includes(block.status)) throw new RangeError('Invalid block pin or status.');
    return {id: block.id, actionId: block.actionId, date: block.date, startMinute: block.startMinute,
      minutes: block.minutes, pinned: block.pinned, status: block.status};
  });
}

function graph(map, backlogIds = []) {
  const invalid = new Map();
  for (const action of map.values()) {
    if (action.status === 'done') continue;
    if (action.status === 'blocked') invalid.set(action.id, 'This action is marked blocked.');
    else if (action.dependsOn.some((id) => !map.has(id))) invalid.set(action.id, 'A prerequisite is missing.');
  }
  const visited = new Set(), visiting = new Set(), stack = [];
  const visit = (id) => {
    if (visited.has(id) || map.get(id)?.status === 'done') return;
    if (visiting.has(id)) {
      stack.slice(stack.indexOf(id)).forEach((cycleId) => invalid.set(cycleId, 'A prerequisite cycle prevents planning.'));
      return;
    }
    visiting.add(id); stack.push(id);
    for (const dependency of map.get(id)?.dependsOn ?? []) if (map.has(dependency)) visit(dependency);
    stack.pop(); visiting.delete(id); visited.add(id);
  };
  for (const id of map.keys()) visit(id);
  for (const id of backlogIds) if (map.get(id)?.status !== 'done') invalid.set(id, 'Kept in the unscheduled inbox.');
  for (let pass = 0; pass < map.size; pass += 1) {
    let changed = false;
    for (const action of map.values()) if (action.status !== 'done' && !invalid.has(action.id) && action.dependsOn.some((id) => invalid.has(id))) {
      invalid.set(action.id, 'A blocked, unscheduled or invalid prerequisite must be resolved first.'); changed = true;
    }
    if (!changed) break;
  }
  const eligible = [...map.values()].filter((action) => action.status === 'todo' && !invalid.has(action.id));
  const due = new Map(eligible.map((action) => [action.id, action.deadline]));
  for (let pass = 0; pass < eligible.length; pass += 1) {
    let changed = false;
    for (const action of eligible) for (const dependency of action.dependsOn) {
      if (!due.has(dependency) || !due.get(action.id)) continue;
      if (!due.get(dependency) || due.get(action.id) < due.get(dependency)) {due.set(dependency, due.get(action.id)); changed = true;}
    }
    if (!changed) break;
  }
  const ordered = [], done = new Set();
  while (ordered.length < eligible.length) {
    const ready = eligible.filter((action) => !done.has(action.id) && action.dependsOn.every((id) => map.get(id)?.status === 'done' || done.has(id)));
    ready.sort((a, b) => (due.get(a.id) ?? '9999-12-31').localeCompare(due.get(b.id) ?? '9999-12-31') || a.index - b.index);
    if (!ready.length) throw new Error('An unresolved prerequisite cycle reached the planner.');
    ordered.push(ready[0]); done.add(ready[0].id);
  }
  return {invalid, due, ordered};
}

function subtract(intervals, removed) {
  let result = intervals.map((interval) => ({...interval}));
  for (const cut of removed) result = result.flatMap((interval) => {
    if (!overlap(interval, cut)) return [interval];
    const pieces = [];
    if (cut.startMinute > interval.startMinute) pieces.push({startMinute: interval.startMinute, endMinute: Math.min(cut.startMinute, interval.endMinute)});
    if (cut.endMinute < interval.endMinute) pieces.push({startMinute: Math.max(cut.endMinute, interval.startMinute), endMinute: interval.endMinute});
    return pieces;
  });
  return result;
}
function freeOn(calendar, civilDate) {
  const availability = calendar.overrides.find((override) => override.date === civilDate)?.windows ?? calendar.defaultWindows;
  return subtract(availability, calendar.commitments.filter((commitment) => commitment.date === civilDate));
}
function occupies(block) {return block.status !== 'skipped';}
function availableOn(calendar, civilDate, blocks) {
  const busy = blocks.filter((block) => block.date === civilDate && occupies(block));
  return subtract(freeOn(calendar, civilDate), busy.map((block) => ({
    startMinute: Math.max(0, block.startMinute - calendar.restMinutes), endMinute: Math.min(1440, end(block) + calendar.restMinutes),
  })));
}
function onHorizon(calendar, civilDate) {return civilDate >= calendar.startDate && civilDate <= addDays(calendar.startDate, 6);}
function allocationsFor(blocks, actionId) {return blocks.filter((block) => block.actionId === actionId && block.status === 'planned');}

function validateGeometry(candidate, calendar, others) {
  if (!onHorizon(calendar, candidate.date)) throw new RangeError('The allocation is outside the seven-day calendar.');
  if (!freeOn(calendar, candidate.date).some((window) => candidate.startMinute >= window.startMinute && end(candidate) <= window.endMinute)) throw new RangeError('The allocation is outside free availability or overlaps a commitment.');
  if (candidate.status === 'skipped') return;
  for (const other of others.filter((item) => item.id !== candidate.id && item.date === candidate.date && occupies(item))) {
    if (candidate.startMinute < end(other) && other.startMinute < end(candidate)) throw new RangeError('The allocation overlaps another work block.');
    const gap = candidate.startMinute >= end(other) ? candidate.startMinute - end(other) : other.startMinute - end(candidate);
    if (gap < calendar.restMinutes) throw new RangeError('The allocation leaves too little protected rest between work blocks.');
  }
}

function feasiblePrerequisiteCompletions(action, map, calendar, blocks, analysis) {
  const required = new Set();
  const visit = (id) => {
    if (required.has(id)) return;
    required.add(id);
    for (const dependency of map.get(id)?.dependsOn ?? []) visit(dependency);
  };
  action.dependsOn.forEach(visit);
  const complete = new Map([...map.values()].filter((item) => item.status === 'done').map((item) => [item.id, -Infinity]));
  for (const item of analysis.ordered.filter((item) => required.has(item.id))) {
    const own = allocationsFor(blocks, item.id), estimate = remainingMinutes(item);
    if (own.reduce((sum, allocation) => sum + allocation.minutes, 0) !== estimate) continue;
    const earliest = Math.max(-Infinity, ...item.dependsOn.map((id) => complete.get(id) ?? Infinity));
    if (earliest === Infinity) continue;
    let valid = true;
    for (const allocation of own) {
      try {validateGeometry(allocation, calendar, blocks);}
      catch {valid = false; break;}
      if ((analysis.due.get(item.id) && allocation.date > analysis.due.get(item.id))
        || (allocation.minutes < calendar.minBlockMinutes && !(estimate < calendar.minBlockMinutes && allocation.minutes === estimate))
        || instant(allocation.date, allocation.startMinute) < earliest) {valid = false; break;}
    }
    if (valid) complete.set(item.id, Math.max(-Infinity, ...own.map((allocation) => instant(allocation.date, end(allocation)))));
  }
  return complete;
}

export function validateBlockPlacement(block, actions, calendar, blocks = []) {
  calendar = validateWorkspaceCalendar(calendar);
  const map = actionMap(actions), action = map.get(block.actionId);
  const others = validatePlannedBlocks(blocks.filter((item) => item.id !== block.id), actions, calendar);
  const candidate = validatePlannedBlocks([block], actions, calendar)[0];
  validateGeometry(candidate, calendar, others);
  if (candidate.status === 'skipped') return candidate;
  if (candidate.status !== 'planned') return candidate;
  const analysis = graph(map), {invalid, due} = analysis;
  if (action.status !== 'todo' || invalid.has(action.id)) throw new RangeError(invalid.get(action.id) ?? 'Only unfinished ready-to-plan work can be allocated.');
  if (due.get(action.id) && candidate.date > due.get(action.id)) throw new RangeError(`The allocation is after deadline ${due.get(action.id)}.`);
  const estimate = remainingMinutes(action);
  if (candidate.minutes < calendar.minBlockMinutes && !(estimate < calendar.minBlockMinutes && candidate.minutes === estimate)) throw new RangeError('Use a useful minimum block, or allocate an entire short action.');
  const own = allocationsFor([...others, candidate], action.id);
  if (own.reduce((sum, item) => sum + item.minutes, 0) > estimate) throw new RangeError('Accepted allocations exceed the explicit remaining estimate.');
  const starts = instant(candidate.date, candidate.startMinute);
  const completions = feasiblePrerequisiteCompletions(action, map, calendar, [...others, candidate], analysis);
  for (const dependency of action.dependsOn) {
    const prerequisite = map.get(dependency);
    if (prerequisite.status === 'done') continue;
    if (!completions.has(dependency) || completions.get(dependency) > starts) throw new RangeError('A prerequisite must finish in earlier valid allocations before this block.');
  }
  return candidate;
}

function restUsed(calendar, civilDate, blocks) {
  const work = blocks.filter((block) => block.date === civilDate && occupies(block)).sort(compareBlocks);
  const free = subtract(freeOn(calendar, civilDate), work.map((block) => ({startMinute: block.startMinute, endMinute: end(block)})));
  let rest = 0;
  for (let index = 1; index < work.length; index += 1) {
    const startMinute = end(work[index - 1]);
    const endMinute = Math.min(work[index].startMinute, startMinute + calendar.restMinutes);
    if (endMinute <= startMinute) continue;
    rest += free.reduce((sum, interval) => sum + Math.max(0, Math.min(interval.endMinute, endMinute) - Math.max(interval.startMinute, startMinute)), 0);
  }
  return rest;
}
const signature = (block) => `${block.actionId}|${block.date}|${block.startMinute}|${block.minutes}`;

export function planWorkspace(actions, calendar, {previousBlocks = [], backlogIds = []} = {}) {
  calendar = validateWorkspaceCalendar(calendar);
  const map = actionMap(actions);
  const previous = validatePlannedBlocks(previousBlocks, actions, calendar);
  length(backlogIds, MAX_ACTIONS, 'Backlog');
  if (new Set(backlogIds).size !== backlogIds.length || backlogIds.some((id) => !map.has(id))) throw new RangeError('Backlog IDs must be unique existing actions.');
  const retained = previous.filter((block) => block.pinned || block.status !== 'planned');
  const pins = retained.filter((block) => block.pinned && block.status === 'planned');
  // A retained pin is an explicit placement even when its action was also put in the inbox.
  const pinnedIds = new Set(pins.map((block) => block.actionId));
  const {invalid, due, ordered} = graph(map, backlogIds.filter((id) => !pinnedIds.has(id)));
  const blocks = retained.map((block) => ({...block}));
  const overflow = [...invalid].map(([actionId, reason]) => ({actionId, reason}));
  const incomplete = new Set(invalid.keys());
  const completion = new Map([...map.values()].filter((action) => action.status === 'done').map((action) => [action.id, -Infinity]));
  const oldIds = new Map(previous.filter((block) => block.status === 'planned' && !block.pinned).map((block) => [signature(block), block.id]));
  const usedIds = new Set(retained.map((block) => block.id));
  // Ancestors of a fixed dependent placement must fit before that placement, not just its civil deadline.
  const limits = new Map(ordered.map((action) => [action.id, due.get(action.id) ? instant(due.get(action.id), 1440) : Infinity]));
  for (const pin of pins) for (const dependency of map.get(pin.actionId)?.dependsOn ?? []) {
    if (limits.has(dependency)) limits.set(dependency, Math.min(limits.get(dependency), instant(pin.date, pin.startMinute)));
  }
  for (let pass = 0; pass < ordered.length; pass += 1) for (const action of ordered) for (const dependency of action.dependsOn) {
    if (limits.has(dependency)) limits.set(dependency, Math.min(limits.get(dependency), limits.get(action.id)));
  }
  // Fixed placement constraints have finer priority than day-only deadlines.
  const priorityOrder = [], priorityIds = new Set();
  while (priorityOrder.length < ordered.length) {
    const ready = ordered.filter((action) => !priorityIds.has(action.id)
      && action.dependsOn.every((id) => map.get(id)?.status === 'done' || priorityIds.has(id)));
    ready.sort((a, b) => {
      const first = limits.get(a.id), second = limits.get(b.id);
      return (first === second ? 0 : first < second ? -1 : 1) || a.index - b.index;
    });
    priorityOrder.push(ready[0]); priorityIds.add(ready[0].id);
  }
  for (const action of priorityOrder) {
    if (action.dependsOn.some((id) => incomplete.has(id))) {
      incomplete.add(action.id); overflow.push({actionId: action.id, reason: 'A prerequisite could not finish in the available calendar.'}); continue;
    }
    const ownPins = pins.filter((block) => block.actionId === action.id);
    const pinnedMinutes = ownPins.reduce((sum, block) => sum + block.minutes, 0);
    let remaining = Math.max(0, remainingMinutes(action) - pinnedMinutes);
    const earliest = Math.max(-Infinity, ...action.dependsOn.map((id) => completion.get(id) ?? Infinity));
    const limit = limits.get(action.id);
    for (let dayIndex = 0; remaining > 0 && dayIndex < 7; dayIndex += 1) {
      const civilDate = addDays(calendar.startDate, dayIndex), midnight = instant(civilDate, 0);
      if (midnight >= limit) break;
      while (remaining > 0) {
        let next = null;
        for (const interval of availableOn(calendar, civilDate, blocks)) {
          const startMinute = Math.max(interval.startMinute, Math.ceil(earliest - midnight));
          const ends = Math.min(interval.endMinute, Math.floor(limit - midnight));
          const room = ends - startMinute;
          if (room <= 0) continue;
          let minutes = Math.min(room, remaining);
          const entireShort = remainingMinutes(action) < calendar.minBlockMinutes && !ownPins.length;
          if (entireShort && room < remaining) continue;
          if (!entireShort) {
            if (minutes < calendar.minBlockMinutes) continue;
            const leftover = remaining - minutes;
            if (leftover > 0 && leftover < calendar.minBlockMinutes) minutes -= calendar.minBlockMinutes - leftover;
            if (minutes < calendar.minBlockMinutes) continue;
          }
          next = {actionId: action.id, date: civilDate, startMinute, minutes, pinned: false, status: 'planned'};
          break;
        }
        if (!next) break;
        const block = next;
        const reused = oldIds.get(signature(block));
        block.id = reused && !usedIds.has(reused) ? reused : uid('block'); usedIds.add(block.id);
        blocks.push(block); remaining -= block.minutes;
      }
    }
    if (remaining > 0) {
      incomplete.add(action.id);
      const deadline = due.get(action.id);
      overflow.push({actionId: action.id, reason: `${deadline ? `Deadline ${deadline} and available intervals` : 'Available intervals and minimum useful blocks'} leave ${remaining} work minutes unplaced.`});
    } else {
      const own = allocationsFor(blocks, action.id);
      completion.set(action.id, Math.max(-Infinity, ...own.map((block) => instant(block.date, end(block)))));
    }
  }
  const conflicts = [];
  for (const pin of pins) {
    try {validateBlockPlacement(pin, actions, calendar, blocks);}
    catch (error) {conflicts.push({blockId: pin.id, actionId: pin.actionId, reason: error.message});}
  }
  blocks.sort(compareBlocks);
  const days = Array.from({length: 7}, (_, index) => {
    const civilDate = addDays(calendar.startDate, index);
    const dayBlocks = blocks.filter((block) => block.date === civilDate);
    const free = freeOn(calendar, civilDate);
    const capacity = free.reduce((sum, interval) => sum + interval.endMinute - interval.startMinute, 0);
    const unoccupied = subtract(free, dayBlocks.filter(occupies).map((block) => ({startMinute: block.startMinute, endMinute: end(block)})));
    const occupiedMinutes = capacity - unoccupied.reduce((sum, interval) => sum + interval.endMinute - interval.startMinute, 0);
    const restMinutes = restUsed(calendar, civilDate, dayBlocks);
    return {date: civilDate, capacity, used: occupiedMinutes + restMinutes,
      restMinutes, blocks: dayBlocks, commitments: calendar.commitments.filter((commitment) => commitment.date === civilDate).map((commitment) => ({...commitment}))};
  });
  const active = blocks.filter((block) => block.status === 'planned');
  return {days, blocks, overflow, conflicts, retainedPins: pins.map((block) => ({...block})),
    totalRemainingMinutes: [...map.values()].filter((action) => action.status !== 'done').reduce((sum, action) => sum + remainingMinutes(action), 0),
    totalCapacityMinutes: days.reduce((sum, day) => sum + day.capacity, 0),
    finishDate: overflow.length || conflicts.length ? null : active.at(-1)?.date ?? null};
}
