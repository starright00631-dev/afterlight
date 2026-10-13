/** Source-linked recall sessions. Ratings are the user's assessment; the fixed
 * 1/3/7-day dates are revisit rules, not an adaptive memory model or a grade. */
import {uid, todayISO, localStudyDate, reviewDue, addDays} from './domain.js';

const ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const LIMITS = {items:50, answer:100000};
function identifier(value, name) {
  if (typeof value !== 'string' || !ID.test(value)) throw new RangeError(`Invalid ${name}.`);
  return value;
}
function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`Invalid ${name}.`);
  return value;
}
function text(value, limit, name) {
  if (typeof value !== 'string' || value.length > limit) throw new RangeError(`Invalid ${name}.`);
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new RangeError('Invalid review timestamp.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new RangeError('Invalid review timestamp.');
  return value;
}
function uniqueIds(value, name) {
  if (!Array.isArray(value) || value.length > LIMITS.items) throw new RangeError(`Invalid ${name}.`);
  const result = Array.from(value, item => identifier(item, name));
  if (new Set(result).size !== result.length) throw new RangeError(`Duplicate ${name}.`);
  return result;
}
function latestFor(attempts, ideaId) {
  return attempts.filter(item => item.ideaId === ideaId).reduce((latest, item) => !latest || item.createdAt >= latest.createdAt ? item : latest, null);
}
function referenceFor(state, idea) {
  const source = state.sources.find(item => item.id === idea.sourceId);
  const paragraph = source?.paragraphs.find(item => item.id === idea.paragraphId);
  if (!source || !paragraph || source.projectId !== idea.projectId) throw new RangeError('The review question needs its original source passage.');
  return {source, paragraph};
}

/** Due assessments precede new questions; overdue assessments are oldest first.
 * Stable idea order breaks ties. Merely reading this queue creates no evidence. */
export function dueReviewQueue(state, {projectId = null, date = todayISO()} = {}) {
  addDays(date, 0);
  if (projectId !== null && !state.projects.some(item => item.id === projectId)) throw new RangeError('The review project is missing.');
  return state.ideas.map((idea, order) => {
    const latest = latestFor(state.attempts, idea.id);
    const due = latest ? localStudyDate(latest.dueAt) : null;
    return {idea, order, due};
  }).filter(item => (projectId === null || item.idea.projectId === projectId) && (item.due === null || item.due <= date))
    .sort((a,b) => (a.due === null ? 1 : 0) - (b.due === null ? 1 : 0) || (a.due ?? '').localeCompare(b.due ?? '') || a.order - b.order)
    .map(item => item.idea);
}

/** Return the actual retained idea. The source stays private to the caller until
 * it deliberately reveals or navigates there; this helper never changes state. */
export function currentReviewItem(state) {
  const session = state.reviewSession;
  if (!session || session.index >= session.ideaIds.length) return null;
  return state.ideas.find(item => item.id === session.ideaIds[session.index]) ?? null;
}

export function validateReviewSession(raw, state) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Review session must be an object.');
  const id = identifier(raw.id, 'review session ID');
  const projectId = raw.projectId === null ? null : identifier(raw.projectId, 'review project');
  if (projectId !== null && !state.projects.some(item => item.id === projectId)) throw new RangeError('The review project is missing.');
  const ideaIds = uniqueIds(raw.ideaIds, 'review question IDs');
  const maxItems = integer(raw.maxItems, 1, LIMITS.items, 'review item limit');
  if (!ideaIds.length || ideaIds.length > maxItems) throw new RangeError('A review session must have a bounded question queue.');
  for (const ideaId of ideaIds) {
    const idea = state.ideas.find(item => item.id === ideaId);
    if (!idea || (projectId !== null && idea.projectId !== projectId)) throw new RangeError('A review question is missing or belongs to another project.');
    referenceFor(state, idea);
  }
  const index = integer(raw.index, 0, ideaIds.length, 'review position');
  const checkedIds = uniqueIds(raw.checkedIds, 'checked review IDs');
  const skippedIds = uniqueIds(raw.skippedIds, 'skipped review IDs');
  const passed = new Set([...checkedIds, ...skippedIds]);
  if (passed.size !== checkedIds.length + skippedIds.length || passed.size !== index || ideaIds.slice(0,index).some(item => !passed.has(item)) || [...passed].some(item => !ideaIds.slice(0,index).includes(item))) {
    throw new RangeError('Review progress must match the queue position.');
  }
  const answer = text(raw.answer, LIMITS.answer, 'review answer');
  if (typeof raw.revealed !== 'boolean' || typeof raw.couldNotRecall !== 'boolean') throw new TypeError('Review reveal and failure states must be boolean.');
  if (raw.couldNotRecall && !raw.revealed) throw new RangeError('A failed recall must have reached comparison.');
  if (index === ideaIds.length && (answer || raw.revealed || raw.couldNotRecall)) throw new RangeError('A finished queue cannot have a current answer.');
  const startedAt = timestamp(raw.startedAt);
  const ownAttempts = state.attempts.filter(item => item.sessionId === id);
  if (ownAttempts.length !== checkedIds.length || ownAttempts.some(item => !checkedIds.includes(item.ideaId) || item.createdAt < startedAt) || checkedIds.some(ideaId => ownAttempts.filter(item => item.ideaId === ideaId).length !== 1)) {
    throw new RangeError('Checked progress needs its retained session assessments.');
  }
  let lastUndo = null;
  if (raw.lastUndo !== null) {
    if (!raw.lastUndo || typeof raw.lastUndo !== 'object' || Array.isArray(raw.lastUndo)) throw new TypeError('Invalid review Undo.');
    const attemptId = identifier(raw.lastUndo.attemptId, 'review Undo attempt');
    const previousIndex = integer(raw.lastUndo.previousIndex, 0, ideaIds.length - 1, 'review Undo position');
    const attempt = state.attempts.find(item => item.id === attemptId);
    if (previousIndex !== index - 1 || !checkedIds.includes(ideaIds[previousIndex]) || !attempt || attempt.ideaId !== ideaIds[previousIndex] || attempt.sessionId !== id || attempt.createdAt < startedAt || latestFor(state.attempts, attempt.ideaId)?.id !== attemptId || state.attempts.filter(item => item.sessionId === id).at(-1)?.id !== attemptId) {
      throw new RangeError('Review Undo must refer to its latest assessment.');
    }
    if (typeof raw.lastUndo.couldNotRecall !== 'boolean') throw new TypeError('Invalid review Undo failure state.');
    const undoAnswer = text(raw.lastUndo.answer, LIMITS.answer, 'review Undo answer');
    if (undoAnswer !== attempt.answer || raw.lastUndo.couldNotRecall !== attempt.couldNotRecall) throw new RangeError('Review Undo must retain its original answer.');
    lastUndo = {attemptId, previousIndex, answer:undoAnswer, couldNotRecall:raw.lastUndo.couldNotRecall};
  }
  return {id, projectId, ideaIds, index, startedAt, budgetMinutes:integer(raw.budgetMinutes,1,120,'review budget'), maxItems,
    checkedIds, skippedIds, answer, revealed:raw.revealed, couldNotRecall:raw.couldNotRecall, lastUndo};
}

function sessionFor(state, {allowFinished = false} = {}) {
  const session = validateReviewSession(state.reviewSession, state);
  if (!session) throw new RangeError('Start a review session first.');
  if (!allowFinished && session.index === session.ideaIds.length) throw new RangeError('This review queue is finished.');
  return session;
}
function withSelection(state, session) {
  const next = {...state, reviewSession:session};
  const idea = session && state.ideas.find(item => item.id === session.ideaIds[session.index]);
  if (idea) {
    next.activeProjectId = idea.projectId;
    next.selectedIdeaId = idea.id;
    next.selectedSourceId = idea.sourceId;
  }
  return next;
}

export function startReviewSession(state, {projectId = null, budgetMinutes = 10, maxItems = 5, ideaIds = null, now = new Date().toISOString()} = {}) {
  if (state.reviewSession) throw new RangeError('Resume or end the current review session before starting another.');
  integer(budgetMinutes,1,120,'review budget'); integer(maxItems,1,LIMITS.items,'review item limit'); timestamp(now);
  const due = dueReviewQueue(state, {projectId, date:localStudyDate(now)});
  let queue = due;
  if (ideaIds !== null) {
    const planned = uniqueIds(ideaIds,'planned review question IDs');
    if (!planned.length) throw new RangeError('A planned review needs at least one retained question.');
    for (const ideaId of planned) {
      const idea = state.ideas.find(item => item.id === ideaId);
      if (!idea || (projectId !== null && idea.projectId !== projectId)) throw new RangeError('A planned review question is missing or outside this project.');
      referenceFor(state,idea);
    }
    // The booking retains membership, not a promise that every item will still
    // be due. Earlier real assessment can make an item unnecessary by start.
    queue = planned.map(id => due.find(item => item.id === id)).filter(Boolean);
  }
  queue = queue.slice(0,maxItems);
  if (!queue.length) throw new RangeError('No questions are due in this scope.');
  const session = {id:uid('review'), projectId, ideaIds:queue.map(item => item.id), index:0, startedAt:now, budgetMinutes, maxItems,
    checkedIds:[], skippedIds:[], answer:'', revealed:false, couldNotRecall:false, lastUndo:null};
  validateReviewSession(session,state);
  return withSelection(state,session);
}

export function writeReviewAnswer(state, answer) {
  const session = sessionFor(state);
  return withSelection(state,{...session, answer:text(answer,LIMITS.answer,'review answer')});
}

export function revealReview(state, {couldNotRecall = false} = {}) {
  const session = sessionFor(state);
  if (typeof couldNotRecall !== 'boolean') throw new TypeError('Recall failure must be explicit.');
  if (!session.answer.trim() && !couldNotRecall && !session.couldNotRecall) throw new RangeError('Write your own answer, or choose “I couldn’t recall”.');
  return withSelection(state,{...session, revealed:true, couldNotRecall:couldNotRecall || session.couldNotRecall});
}

function advance(session, changes) {
  return {...session, ...changes, index:session.index+1, answer:'', revealed:false, couldNotRecall:false};
}
export function skipReview(state) {
  const session = sessionFor(state);
  return withSelection(state,advance(session,{skippedIds:[...session.skippedIds,session.ideaIds[session.index]],lastUndo:null}));
}

export function rateReview(state, rating, {now = new Date().toISOString()} = {}) {
  const session = sessionFor(state);
  if (!session.revealed) throw new RangeError('Reveal the comparison before assessing your answer.');
  if (!session.answer.trim() && !session.couldNotRecall) throw new RangeError('An assessment needs an answer or an explicit recall failure.');
  if (state.attempts.length >= 2000) throw new RangeError('The desk supports up to 2,000 review attempts.');
  timestamp(now);
  if (now < session.startedAt) throw new RangeError('A review cannot precede its session.');
  reviewDue(rating,now);
  const effectiveRating = session.couldNotRecall ? 'again' : rating;
  const idea = currentReviewItem(state);
  const {paragraph} = referenceFor(state,idea);
  if (latestFor(state.attempts,idea.id)?.createdAt > now) throw new RangeError('A new assessment cannot precede the previous one.');
  const attempt = {id:uid('attempt'), ideaId:idea.id, answer:session.answer, rating:effectiveRating, createdAt:now, dueAt:reviewDue(effectiveRating,now),
    promptSnapshot:text(idea.question || `Explain “${idea.title}” and give an example relevant to your project.`,4000,'review question'),
    criteriaSnapshot:text(idea.answerCriteria ?? '',100000,'answer criteria'), referenceSnapshot:text(paragraph.text,1000000,'source passage'), sourceId:idea.sourceId, paragraphId:idea.paragraphId,
    couldNotRecall:session.couldNotRecall, sessionId:session.id};
  const nextSession = advance(session,{checkedIds:[...session.checkedIds,idea.id],lastUndo:{attemptId:attempt.id,previousIndex:session.index,answer:session.answer,couldNotRecall:session.couldNotRecall}});
  return withSelection({...state,attempts:[...state.attempts,attempt]},nextSession);
}

export function undoReview(state) {
  const session = sessionFor(state,{allowFinished:true});
  if (!session.lastUndo) throw new RangeError('There is no assessment to undo in this session.');
  const {attemptId,previousIndex,answer,couldNotRecall} = session.lastUndo;
  const nextSession = {...session,index:previousIndex,checkedIds:session.checkedIds.filter(item => item !== session.ideaIds[previousIndex]),
    answer,revealed:true,couldNotRecall,lastUndo:null};
  return withSelection({...state,attempts:state.attempts.filter(item => item.id !== attemptId)},nextSession);
}

export function endReview(state) {
  // Explicitly ending a queue keeps every assessment and every skipped item's
  // unchanged due date. It creates neither a work session nor a completion.
  return {...state,reviewSession:null};
}
