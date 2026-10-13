/** Deterministic placement choices. Reading a choice reserves no work time. */
import { addDays } from './domain.js';
import { calendarOverviewData } from './calendar-overview.js';
import { validateWorkspaceCalendar, validatePlannedBlocks, validateBlockPlacement, remainingMinutes, readyActions } from './workspace-planner.js';

const PREFERRED_MINUTES = 45;

function inspect(state, blocks) {
  const calendar = state.workbench.calendar === null ? null : validateWorkspaceCalendar(state.workbench.calendar);
  const checkedBlocks = validatePlannedBlocks(blocks, state.actions, calendar);
  return { calendar, blocks: checkedBlocks, actions: new Map(state.actions.map(action => [action.id, action])),
    ready: new Set(readyActions(state.actions).map(action => action.id)) };
}

function context(action, model) {
  const estimate = remainingMinutes(action);
  const reserved = model.blocks.filter(block => block.actionId === action.id && block.status === 'planned')
    .reduce((sum, block) => sum + block.minutes, 0);
  const prerequisites = action.dependsOn.filter(id => model.actions.get(id)?.status !== 'done')
    .map(id => ({ id, title: model.actions.get(id)?.title ?? 'Missing prerequisite' }));
  return { actionId: action.id, remainingMinutes: estimate, reservedMinutes: reserved,
    unreservedMinutes: Math.max(0, estimate - reserved), readyToStart: model.ready.has(action.id), prerequisites };
}

/** Original remaining effort and reservations are different quantities. Closed
 * or skipped allocations never stand in for a revised remaining estimate. */
export function actionPlanningContext(state, actionId, { blocks = state.workbench.blocks } = {}) {
  const model = inspect(state, blocks), action = model.actions.get(actionId);
  if (!action) throw new RangeError('The planning action is missing.');
  return context(action, model);
}

function durationFor(action, unreserved, room, minimum) {
  const entireShort = remainingMinutes(action) < minimum;
  if (entireShort) return room >= unreserved ? unreserved : null;
  let minutes = Math.min(unreserved, room, Math.max(PREFERRED_MINUTES, minimum));
  if (minutes < minimum) return null;
  const leftover = unreserved - minutes;
  if (leftover > 0 && leftover < minimum) minutes -= minimum - leftover;
  if (minutes >= minimum) return minutes;
  // When fewer than two useful blocks remain, exceeding the preferred length
  // can be the only feasible alternative to an unusable final fragment.
  return room >= unreserved && unreserved >= minimum ? unreserved : null;
}

function selectedIntervals(day, startMinute, endMinute) {
  if (startMinute === null && endMinute === null) return { intervals: day.open };
  if (!Number.isSafeInteger(startMinute) || !Number.isSafeInteger(endMinute)
    || startMinute < 0 || endMinute > 1440 || endMinute <= startMinute) {
    return { intervals: [], reason: 'Choose a valid free interval with an integer start and end time.' };
  }
  if (!day.open.some(interval => startMinute >= interval.startMinute && endMinute <= interval.endMinute)) {
    return { intervals: [], reason: 'The selected interval is not free after commitments, accepted allocations and protected rest.' };
  }
  return { intervals: [{ startMinute, endMinute }] };
}

/** Options are independent alternatives for this date, not a combined plan.
 * A selected interval fixes the candidate start and bounds its duration. */
export function dayPlacementOptions(state, date, { blocks = state.workbench.blocks, startMinute = null, endMinute = null } = {}) {
  addDays(date, 0);
  const model = inspect(state, blocks);
  const overview = calendarOverviewData({ ...state, workbench: { ...state.workbench, blocks: model.blocks } });
  const day = overview.days.find(item => item.date === date);
  const chosen = day ? selectedIntervals(day, startMinute, endMinute) : { intervals: [] };
  const ids = new Set(model.blocks.map(block => block.id));
  let candidateId = 'inspector-candidate';
  for (let suffix = 1; ids.has(candidateId); suffix++) candidateId = `inspector-candidate:${suffix}`;
  return state.actions.filter(action => action.status !== 'done').map(action => {
    const info = context(action, model);
    const result = { ...info, placement: null, reason: null };
    if (action.status === 'blocked') return { ...result, reason: 'This action is marked blocked.' };
    if (!info.remainingMinutes) return { ...result, reason: 'No remaining effort is estimated; revise the estimate before reserving time.' };
    if (!info.unreservedMinutes) return { ...result, reason: 'The remaining effort is already fully reserved in this calendar.' };
    if (!model.calendar) return { ...result, reason: 'Adopt a shared calendar before placing a session.' };
    if (!day) return { ...result, reason: 'This date is outside the seven-day shared calendar.' };
    if (!day.windows.length) return { ...result, reason: 'No work window is available on this date.' };
    if (chosen.reason) return { ...result, reason: chosen.reason };
    if (!chosen.intervals.length) return { ...result, reason: 'No free interval remains after commitments, accepted allocations and protected rest.' };
    let failure = null, useful = false;
    for (const interval of chosen.intervals) {
      const minutes = durationFor(action, info.unreservedMinutes, interval.endMinute - interval.startMinute, model.calendar.minBlockMinutes);
      if (minutes === null) continue;
      useful = true;
      const placement = { date, startMinute: interval.startMinute, minutes };
      try {
        validateBlockPlacement({ id: candidateId, actionId: action.id, ...placement, pinned: true, status: 'planned' }, state.actions, model.calendar, model.blocks);
        return { ...result, placement };
      } catch (error) { failure ??= error.message; }
    }
    return { ...result, reason: useful ? failure : `Free intervals cannot fit a useful ${model.calendar.minBlockMinutes}-minute session or an entire short action without leaving an unusable remainder.` };
  });
}
