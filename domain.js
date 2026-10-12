/** Pure rules for a source-linked desk. Scheduling and review intervals are
 * ordinary planning rules, not AI decisions or measurements of mastery. */
import {createLabState} from './optics.js';
export function uid(prefix = 'item') {
  if (typeof prefix !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,30}$/.test(prefix)) {
    throw new TypeError('ID prefix must be a short identifier.');
  }
  return `${prefix}-${crypto.randomUUID()}`;
}

export function todayISO() {
  // The current user's calendar is in Asia/Shanghai, independent of host TZ.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

export function localStudyDate(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid review timestamp.');
  return new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai'}).format(date);
}

export function dueIdeas(ideas, attempts, date = todayISO()) {
  dateValue(date);
  return ideas.filter(idea => {
    const latest = attempts.filter(attempt => attempt.ideaId === idea.id)
      .sort((a,b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
    return !latest || localStudyDate(latest.dueAt) <= date;
  });
}

function dateValue(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError('Use a calendar date in YYYY-MM-DD form.');
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new RangeError('The calendar date does not exist.');
  }
  return parsed;
}

export function addDays(date, count) {
  const value = dateValue(date);
  if (!Number.isSafeInteger(count) || Math.abs(count) > 36600) throw new RangeError('Invalid day offset.');
  value.setUTCDate(value.getUTCDate() + count);
  const result = value.toISOString().slice(0, 10);
  dateValue(result);
  return result;
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function splitSource(text) {
  if (typeof text !== 'string' || text.length > 1_000_000) {
    throw new RangeError('Source text must be a string of at most 1,000,000 characters.');
  }
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/).map((part) => part.trim()).filter(Boolean);
  if (blocks.length > 2000) throw new RangeError('The source has more than 2,000 paragraphs.');
  return blocks.map((block, index) => ({ id: `p-${index}-${hashText(block)}`, text: block, index }));
}

export function createState() {
  const now = new Date().toISOString();
  const project = {
    id: uid('project'), title: 'A question worth working on',
    question: 'What will I be able to explain or do when this is finished?',
    example: false, createdAt: now,
    plan: { startDate: todayISO(), days: 7, dailyMinutes: 90, startTime: '19:00', restMinutes: 5 },
    closing: { note: '', nextAction: '', updatedAt: null },
  };
  return {
    version: 2, projects: [project], activeProjectId: project.id, view: 'desk',
    selectedSourceId: null, selectedIdeaId: null, sources: [], ideas: [], attempts: [],
    actions: [], session: null, quiet: null, settings: { night: true }, lab: createLabState(),
  };
}

export function createExampleState() {
  const state = createState();
  const project = state.projects[0];
  project.title = 'Example · A small research brief';
  project.question = 'How can I turn a vague research task into a plan I can finish?';
  project.example = true;
  const text = [
    'Begin with an output you can inspect. “Research the topic” leaves the finish line unclear. “Write a one-page brief with a claim, evidence, and an unresolved question” gives the session a concrete purpose.',
    'Separate evidence from interpretation. Keep the passage that informed your idea, then write your own explanation beside it. A link back to the passage makes a later disagreement easier to investigate.',
    'Dependencies change the order of work. A draft may need selected evidence first; a review needs an existing draft. A plan that ignores those relationships can look full while putting work in an impossible order.',
    'Time is a constraint, not a promise. Estimates and short breaks must fit the available window. When they do not, reduce the scope or move work to another day. End a session by recording the next specific action.',
  ].join('\n\n');
  const source = {
    id: uid('source'), projectId: project.id, title: 'Example notes · Planning a research brief',
    kind: 'example', text, paragraphs: splitSource(text), createdAt: project.createdAt,
  };
  state.sources.push(source);
  const ideas = [
    { title: 'Define an inspectable output', explanation: 'A concrete deliverable makes the finish line visible.', question: 'Rewrite a vague task as an output someone could inspect.', paragraph: 0 },
    { title: 'Respect dependencies and capacity', explanation: 'Preparation must finish before dependent work; breaks also consume the available window.', question: 'Which part of your next action must exist before you can begin?', paragraph: 2 },
  ].map((idea) => ({
    id: uid('idea'), projectId: project.id, sourceId: source.id,
    paragraphId: source.paragraphs[idea.paragraph].id, title: idea.title,
    explanation: idea.explanation, question: idea.question, createdAt: project.createdAt, origin: 'user',
  }));
  state.ideas.push(...ideas);
  const definitions = [
    ['Define the brief’s question and finish line', 30, ideas[0].id],
    ['Select two passages that support a claim', 45, ideas[0].id],
    ['Write a one-page brief', 60, ideas[1].id],
    ['Review the claim against the source', 30, ideas[1].id],
  ];
  state.actions = definitions.map(([title, minutes, ideaId]) => ({
    id: uid('action'), projectId: project.id, title, minutes, ideaId,
    status: 'todo', dependsOn: [], deadline: null, draft: '', completedAt: null, spentMs: 0,
  }));
  state.actions.forEach((action, index) => {
    if (index > 0) action.dependsOn = [state.actions[index - 1].id];
  });
  state.actions.at(-1).deadline = addDays(project.plan.startDate, 2);
  state.selectedSourceId = source.id;
  state.selectedIdeaId = ideas[0].id;
  return state;
}

function wholeNumber(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
  }
}

export function sessionElapsed(session, now = Date.now()) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) throw new TypeError('Invalid session.');
  wholeNumber(session.elapsedMs, 0, Number.MAX_SAFE_INTEGER, 'Elapsed time');
  wholeNumber(now, 0, Number.MAX_SAFE_INTEGER, 'Current time');
  if (typeof session.running !== 'boolean') throw new TypeError('Session running must be a boolean.');
  if (!session.running) {
    if (session.startedAt !== null) throw new RangeError('A paused session must have no start timestamp.');
    return session.elapsedMs;
  }
  wholeNumber(session.startedAt, 0, Number.MAX_SAFE_INTEGER, 'Session start');
  const elapsed = session.elapsedMs + Math.max(0, now - session.startedAt);
  wholeNumber(elapsed, 0, Number.MAX_SAFE_INTEGER, 'Total elapsed time');
  return elapsed;
}

export function reviewDue(rating, nowISO = new Date().toISOString()) {
  const intervals = { again: 1, uncertain: 3, understood: 7 };
  if (!Object.hasOwn(intervals, rating)) throw new RangeError('Unknown self-assessment rating.');
  if (typeof nowISO !== 'string') throw new TypeError('Review time must be an ISO timestamp.');
  const value = new Date(nowISO);
  if (!Number.isFinite(value.getTime()) || value.toISOString() !== nowISO) throw new RangeError('Invalid review time.');
  value.setUTCDate(value.getUTCDate() + intervals[rating]);
  return value.toISOString();
}

export function scheduleActions(actions, plan) {
  if (!Array.isArray(actions) || actions.length > 500) throw new RangeError('Invalid action list.');
  if (!plan || typeof plan !== 'object') throw new TypeError('Invalid plan.');
  dateValue(plan.startDate);
  wholeNumber(plan.days, 1, 366, 'Planning days');
  wholeNumber(plan.dailyMinutes, 0, 720, 'Daily minutes');
  wholeNumber(plan.restMinutes, 0, 120, 'Rest minutes');
  if (typeof plan.startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.startTime)) {
    throw new RangeError('Start time must be HH:MM.');
  }
  const [hour, minute] = plan.startTime.split(':').map(Number);
  const startMinute = hour * 60 + minute;
  if (startMinute + plan.dailyMinutes > 1440) throw new RangeError('The daily window must finish before midnight.');
  const map = new Map();
  actions.forEach((action, index) => {
    if (!action || typeof action.id !== 'string' || !action.id || map.has(action.id)) throw new RangeError('Action IDs must be unique.');
    wholeNumber(action.minutes, 1, 10080, 'Action minutes');
    if (!['todo', 'done', 'blocked'].includes(action.status) || !Array.isArray(action.dependsOn)
      || action.dependsOn.some((id) => typeof id !== 'string') || new Set(action.dependsOn).size !== action.dependsOn.length) {
      throw new RangeError('Invalid action status or dependencies.');
    }
    if (action.deadline !== null) dateValue(action.deadline);
    map.set(action.id, { ...action, dependsOn: [...action.dependsOn], index });
  });
  const todo = [...map.values()].filter((action) => action.status !== 'done');
  const invalid = new Map();
  for (const action of todo) {
    if (action.status === 'blocked') invalid.set(action.id, 'This action is marked blocked.');
    else if (action.dependsOn.some((id) => !map.has(id))) invalid.set(action.id, 'A dependency is missing.');
  }
  const visited = new Set();
  const visiting = new Set();
  const stack = [];
  function detectCycles(id) {
    if (visited.has(id) || map.get(id)?.status === 'done') return;
    if (visiting.has(id)) {
      for (const cycleId of stack.slice(stack.indexOf(id))) invalid.set(cycleId, 'A dependency cycle prevents scheduling.');
      return;
    }
    visiting.add(id); stack.push(id);
    for (const dependency of map.get(id)?.dependsOn ?? []) {
      if (map.has(dependency)) detectCycles(dependency);
    }
    stack.pop(); visiting.delete(id); visited.add(id);
  }
  todo.forEach((action) => detectCycles(action.id));
  let propagated;
  do {
    propagated = false;
    for (const action of todo) {
      if (!invalid.has(action.id) && action.dependsOn.some((id) => invalid.has(id))) {
        invalid.set(action.id, 'A blocked or invalid dependency must be resolved first.');
        propagated = true;
      }
    }
  } while (propagated);
  const eligible = todo.filter((action) => !invalid.has(action.id));
  const effectiveDeadline = new Map(eligible.map((action) => [action.id, action.deadline]));
  // A prerequisite inherits an earlier dependent deadline for prioritization.
  for (let pass = 0; pass < eligible.length; pass += 1) {
    let changed = false;
    for (const action of eligible) {
      const due = effectiveDeadline.get(action.id);
      if (!due) continue;
      for (const dependency of action.dependsOn) {
        if (!effectiveDeadline.has(dependency)) continue;
        const current = effectiveDeadline.get(dependency);
        if (!current || due < current) { effectiveDeadline.set(dependency, due); changed = true; }
      }
    }
    if (!changed) break;
  }
  const ordered = [];
  const orderedIds = new Set();
  while (ordered.length < eligible.length) {
    const ready = eligible.filter((action) => !orderedIds.has(action.id)
      && action.dependsOn.every((id) => map.get(id).status === 'done' || orderedIds.has(id)));
    ready.sort((a, b) => (effectiveDeadline.get(a.id) ?? '9999-12-31').localeCompare(effectiveDeadline.get(b.id) ?? '9999-12-31') || a.index - b.index);
    if (!ready.length) throw new Error('An unresolved dependency cycle reached the scheduler.');
    ordered.push(ready[0]); orderedIds.add(ready[0].id);
  }
  const days = Array.from({ length: plan.days }, (_, index) => ({
    date: addDays(plan.startDate, index), capacity: plan.dailyMinutes,
    used: 0, blocks: [], restMinutes: 0,
  }));
  const overflow = [...invalid].map(([actionId, reason]) => ({ actionId, reason }));
  const incomplete = new Set(invalid.keys());
  let dayIndex = 0;
  for (const action of ordered) {
    if (action.dependsOn.some((id) => incomplete.has(id))) {
      incomplete.add(action.id);
      overflow.push({ actionId: action.id, reason: 'A dependency could not finish within its available window.' });
      continue;
    }
    let remaining = action.minutes;
    const deadline = effectiveDeadline.get(action.id);
    while (remaining > 0 && dayIndex < days.length) {
      const day = days[dayIndex];
      if (deadline && day.date > deadline) break;
      const rest = day.blocks.length ? plan.restMinutes : 0;
      const capacity = day.capacity - day.used - rest;
      if (capacity <= 0) { dayIndex += 1; continue; }
      const minutes = Math.min(remaining, capacity);
      const begins = startMinute + day.used + rest;
      day.blocks.push({ actionId: action.id, startMinute: begins, endMinute: begins + minutes, minutes });
      day.used += rest + minutes;
      day.restMinutes += rest;
      remaining -= minutes;
      if (remaining > 0) dayIndex += 1;
    }
    if (remaining > 0) {
      incomplete.add(action.id);
      const dueHit = deadline && (dayIndex >= days.length || days[dayIndex].date > deadline);
      overflow.push({ actionId: action.id, reason: dueHit
        ? `Deadline ${deadline} leaves ${remaining} work minutes unplaced.`
        : `The available days leave ${remaining} work minutes unplaced.` });
    }
  }
  const totalWorkMinutes = todo.reduce((sum, action) => sum + action.minutes, 0);
  const totalCapacityMinutes = days.reduce((sum, day) => sum + day.capacity, 0);
  const used = days.reduce((sum, day) => sum + day.used, 0);
  const lastDay = days.filter((day) => day.blocks.length).at(-1);
  return { days, overflow, totalWorkMinutes, totalCapacityMinutes,
    availableMinutes: totalCapacityMinutes - used, finishDate: overflow.length ? null : lastDay?.date ?? null };
}
