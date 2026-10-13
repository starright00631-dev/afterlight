/** Durable planning and actual-work records. Feasibility belongs to the planner;
 * older accepted allocations stay readable when availability later changes. */
import { validateWorkspaceCalendar, validatePlannedBlocks } from './workspace-planner.js';

export function createWorkbench() {
  return { version: 1, calendar: null, backlogIds: [], blocks: [], sessions: [] };
}

function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
  return value;
}
function identifier(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,120}$/.test(value)) throw new RangeError(`Invalid ${name}.`);
  return value;
}
function text(value, max, name, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new RangeError(`Invalid ${name}.`);
  return value;
}
function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`Invalid ${name}.`);
  return value;
}
function array(value, max, name) {
  if (!Array.isArray(value) || value.length > max) throw new RangeError(`Invalid ${name}.`);
  for (let index = 0; index < value.length; index += 1) if (!(index in value)) throw new RangeError(`Sparse ${name} is invalid.`);
  return value;
}
function timestamp(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new RangeError(`Invalid ${name}.`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new RangeError(`Invalid ${name}.`);
  return value;
}

export function validateWorkbench(input, actions, { unique: outerUnique } = {}) {
  record(input, 'Workbench');
  if (input.version !== 1) throw new RangeError('Unsupported workbench version.');
  const recordIds = new Set();
  const unique = (value, name) => {
    const checked = outerUnique ? outerUnique(value, name) : identifier(value, name);
    if (recordIds.has(checked)) throw new RangeError(`Duplicate ${name}.`);
    recordIds.add(checked);
    return checked;
  };
  const calendar = input.calendar === null ? null : validateWorkspaceCalendar(input.calendar);
  const actionMap = new Map(actions.map(action => [action.id, action]));
  const backlogIds = array(input.backlogIds, 500, 'backlog IDs').map(value => {
    identifier(value, 'backlog action');
    if (!actionMap.has(value)) throw new RangeError('A backlog action is missing.');
    return value;
  });
  if (new Set(backlogIds).size !== backlogIds.length) throw new RangeError('Duplicate backlog action.');
  const blocks = validatePlannedBlocks(array(input.blocks, 5000, 'planned blocks'), actions, calendar);
  for (const commitment of calendar?.commitments ?? []) unique(commitment.id, 'commitment ID');
  for (const block of blocks) unique(block.id, 'planned block ID');
  const blockMap = new Map(blocks.map(block => [block.id, block]));
  const sessionIds = new Set();
  const sessions = array(input.sessions, 5000, 'work sessions').map(raw => {
    record(raw, 'Work session');
    const actionId = identifier(raw.actionId, 'work session action');
    if (!actionMap.has(actionId)) throw new RangeError('A work session action is missing.');
    const blockId = raw.blockId === null ? null : identifier(raw.blockId, 'work session block');
    if (blockId !== null && blockMap.get(blockId)?.actionId !== actionId) throw new RangeError('A work session block must belong to its action.');
    const startedAt = timestamp(raw.startedAt, 'work session start');
    const endedAt = timestamp(raw.endedAt, 'work session end');
    if (endedAt < startedAt) throw new RangeError('A work session cannot end before it starts.');
    if (!['finished', 'continue', 'blocked', 'stopped'].includes(raw.outcome)) throw new RangeError('Invalid work session outcome.');
    const checkedId = unique(raw.id, 'work session ID');
    if (sessionIds.has(checkedId)) throw new RangeError('Duplicate work session ID.');
    sessionIds.add(checkedId);
    return {
      id: checkedId, actionId, actionTitle: text(raw.actionTitle, 300, 'work session action title', true), blockId,
      startedAt, endedAt, durationMs: integer(raw.durationMs, 0, Number.MAX_SAFE_INTEGER, 'work session duration'),
      outcome: raw.outcome, output: text(raw.output, 1_000_000, 'work session output'),
      nextStep: text(raw.nextStep, 100000, 'work session next step'),
      remainingMinutesAfter: raw.remainingMinutesAfter === null ? null : integer(raw.remainingMinutesAfter, 0, 10080, 'reported remaining effort'),
    };
  });
  return { version: 1, calendar, backlogIds, blocks, sessions };
}
