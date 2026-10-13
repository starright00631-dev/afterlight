import { createState, splitSource, scheduleActions, sessionElapsed } from './domain.js';
import { createLabState, validateLabState } from './optics.js';
import { createStudio, validateStudio, recoverLegacyStudy, hasLegacyLabWork } from './studies.js';
import { createWorkbench, validateWorkbench } from './workbench-state.js';
import { validateReviewSession } from './review-sessions.js';

export const SAVE_KEY = 'afterlight-v4';
export const PRIOR_SAVE_KEY = 'afterlight-v3';
export const LEGACY_SAVE_KEY = 'afterlight-v2';

function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
  return value;
}
function text(value, limit, name, required = false) {
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw new RangeError(`Invalid ${name}.`);
  return value;
}
function id(value, name = 'ID') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,120}$/.test(value)) throw new RangeError(`Invalid ${name}.`);
  return value;
}
function number(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`Invalid ${name}.`);
  return value;
}
function bool(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(`Invalid ${name}.`);
  return value;
}
function timestamp(value, name, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new RangeError(`Invalid ${name}.`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new RangeError(`Invalid ${name}.`);
  return value;
}
function calendar(value, name, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`Invalid ${name}.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new RangeError(`Invalid ${name}.`);
  return value;
}
function array(value, max, name) {
  if (!Array.isArray(value) || value.length > max) throw new RangeError(`Invalid ${name}.`);
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) throw new RangeError(`Sparse ${name} is invalid.`);
  }
  return value;
}
function oneOf(value, values, name) {
  if (!values.includes(value)) throw new RangeError(`Invalid ${name}.`);
  return value;
}

export function validateState(input) {
  record(input, 'State');
  if (![2,3,4].includes(input.version)) throw new RangeError('Unsupported save version.');
  const upgrading = input.version < 4;
  const identifiers = new Set();
  function unique(value, name) {
    const checked = id(value, name);
    if (identifiers.has(checked)) throw new RangeError(`Duplicate ${name}.`);
    identifiers.add(checked);
    return checked;
  }
  const projects = array(input.projects, 30, 'projects').map((raw) => {
    record(raw, 'Project'); record(raw.plan, 'Plan'); record(raw.closing, 'Closing note');
    const plan = {
      startDate: calendar(raw.plan.startDate, 'plan date'),
      days: oneOf(raw.plan.days, [7], 'planning days'),
      dailyMinutes: number(raw.plan.dailyMinutes, 0, 720, 'daily minutes'),
      startTime: text(raw.plan.startTime, 5, 'start time', true),
      restMinutes: number(raw.plan.restMinutes, 0, 120, 'rest minutes'),
    };
    scheduleActions([], plan);
    return {
      id: unique(raw.id, 'project ID'), title: text(raw.title, 300, 'project title', true),
      question: text(raw.question, 4000, 'project question'), example: bool(raw.example, 'example marker'),
      createdAt: timestamp(raw.createdAt, 'project creation'), plan,
      closing: { note: text(raw.closing.note, 100000, 'closing note'),
        nextAction: text(raw.closing.nextAction, 4000, 'next action'),
        updatedAt: timestamp(raw.closing.updatedAt, 'closing update', true) },
    };
  });
  if (!projects.length) throw new RangeError('At least one project is required.');
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  function projectRef(value) {
    id(value, 'project reference');
    if (!projectMap.has(value)) throw new RangeError('Missing project reference.');
    return value;
  }
  const sources = array(input.sources, 100, 'sources').map((raw) => {
    record(raw, 'Source');
    const sourceText = text(raw.text, 1_000_000, 'source text', true);
    const expected = splitSource(sourceText);
    if (!expected.length) throw new RangeError('A source must have readable text.');
    const paragraphs = array(raw.paragraphs, 2000, 'paragraphs');
    if (paragraphs.length !== expected.length) throw new RangeError('Source paragraphs do not match its text.');
    const checkedParagraphs = paragraphs.map((paragraph, index) => {
      record(paragraph, 'Paragraph');
      if (paragraph.id !== expected[index].id || paragraph.text !== expected[index].text || paragraph.index !== index) {
        throw new RangeError('Source paragraph anchors do not match its immutable text.');
      }
      const checked = { ...expected[index] };
      if (paragraph.page !== undefined) checked.page = number(paragraph.page, 1, 5000, 'source page');
      return checked;
    });
    return { id: unique(raw.id, 'source ID'), projectId: projectRef(raw.projectId),
      title: text(raw.title, 300, 'source title', true), kind: text(raw.kind, 32, 'source kind', true),
      text: sourceText, paragraphs: checkedParagraphs, createdAt: timestamp(raw.createdAt, 'source creation') };
  });
  if (sources.reduce((sum, source) => sum + source.text.length, 0) > 10_000_000) throw new RangeError('Sources exceed the storage size limit.');
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const ideas = array(input.ideas, 500, 'ideas').map((raw) => {
    record(raw, 'Idea');
    const projectId = projectRef(raw.projectId);
    const source = sourceMap.get(id(raw.sourceId, 'source reference'));
    if (!source || source.projectId !== projectId || !source.paragraphs.some((paragraph) => paragraph.id === raw.paragraphId)) {
      throw new RangeError('An idea must cite an existing passage in its project.');
    }
    return { id: unique(raw.id, 'idea ID'), projectId, sourceId: source.id,
      paragraphId: id(raw.paragraphId, 'paragraph reference'), title: text(raw.title, 300, 'idea title', true),
      explanation: text(raw.explanation, 100000, 'idea explanation'), question: text(raw.question, 4000, 'practice question'),
      answerCriteria: text(upgrading ? (raw.answerCriteria ?? '') : raw.answerCriteria, 100000, 'answer criteria'),
      createdAt: timestamp(raw.createdAt, 'idea creation'), origin: oneOf(raw.origin, ['user', 'ai'], 'idea origin') };
  });
  const ideaMap = new Map(ideas.map((idea) => [idea.id, idea]));
  const attempts = array(input.attempts, 2000, 'attempts').map((raw) => {
    record(raw, 'Attempt');
    const ideaId = id(raw.ideaId, 'attempt idea');
    if (!ideaMap.has(ideaId)) throw new RangeError('An attempt cites a missing idea.');
    const createdAt = timestamp(raw.createdAt, 'attempt creation');
    const dueAt = timestamp(raw.dueAt, 'review date');
    if (dueAt < createdAt) throw new RangeError('A review date cannot precede its attempt.');
    const contextKeys = ['promptSnapshot', 'criteriaSnapshot', 'referenceSnapshot', 'sourceId', 'paragraphId'];
    const context = Object.fromEntries(contextKeys.map(key => [key, upgrading ? (raw[key] ?? null) : raw[key]]));
    const missingContext = contextKeys.every(key => context[key] === null);
    if (!missingContext) {
      context.promptSnapshot = text(context.promptSnapshot, 4000, 'original practice question');
      context.criteriaSnapshot = text(context.criteriaSnapshot, 100000, 'original answer criteria');
      context.referenceSnapshot = text(context.referenceSnapshot, 1_000_000, 'original reference passage', true);
      context.sourceId = id(context.sourceId, 'attempt source');
      context.paragraphId = id(context.paragraphId, 'attempt paragraph');
      const idea = ideaMap.get(ideaId);
      const source = sourceMap.get(context.sourceId);
      const paragraph = source?.paragraphs.find(item => item.id === context.paragraphId);
      if (!paragraph || source.projectId !== idea.projectId || context.sourceId !== idea.sourceId || context.paragraphId !== idea.paragraphId || paragraph.text !== context.referenceSnapshot) {
        throw new RangeError('An attempt reference must match its immutable source passage.');
      }
    }
    const sessionId = (upgrading && raw.sessionId == null) || raw.sessionId === null ? null : id(raw.sessionId, 'attempt review session');
    if (missingContext && sessionId !== null) throw new RangeError('A session assessment must retain original question context.');
    const couldNotRecall = bool(upgrading ? (raw.couldNotRecall ?? false) : raw.couldNotRecall, 'recall failure');
    const rating = oneOf(raw.rating, ['again', 'uncertain', 'understood'], 'self-assessment');
    if (couldNotRecall && rating !== 'again') throw new RangeError('A failed recall must use the Again assessment.');
    return { id: unique(raw.id, 'attempt ID'), ideaId, answer: text(raw.answer, 100000, 'attempt answer'),
      rating, createdAt, dueAt, ...context, couldNotRecall, sessionId };
  });
  const actions = array(input.actions, 500, 'actions').map((raw) => {
    record(raw, 'Action');
    const projectId = projectRef(raw.projectId);
    const ideaId = raw.ideaId === null ? null : id(raw.ideaId, 'action idea');
    if (ideaId !== null && ideaMap.get(ideaId)?.projectId !== projectId) throw new RangeError('An action idea must exist in its project.');
    const status = oneOf(raw.status, ['todo', 'done', 'blocked'], 'action status');
    const completedAt = timestamp(raw.completedAt, 'action completion', true);
    if ((status === 'done') !== (completedAt !== null)) throw new RangeError('Completion timestamps must match action status.');
    const dependsOn = array(raw.dependsOn, 500, 'dependencies').map((value) => id(value, 'dependency reference'));
    if (new Set(dependsOn).size !== dependsOn.length) throw new RangeError('Duplicate dependency references.');
    const reviewIdeaIds = raw.reviewIdeaIds == null ? null : array(raw.reviewIdeaIds, 50, 'planned review question IDs').map(value => {
      id(value, 'planned review question');
      if (!ideaMap.has(value)) throw new RangeError('A planned review question is missing.');
      return value;
    });
    if (reviewIdeaIds !== null && (!reviewIdeaIds.length || new Set(reviewIdeaIds).size !== reviewIdeaIds.length)) throw new RangeError('Planned review questions must be nonempty and unique.');
    const reviewMaxItems = raw.reviewMaxItems == null ? null : number(raw.reviewMaxItems, 1, 50, 'planned review item limit');
    if (reviewIdeaIds !== null && reviewMaxItems !== null && reviewIdeaIds.length > reviewMaxItems) throw new RangeError('Planned review questions exceed the retained item limit.');
    return { id: unique(raw.id, 'action ID'), projectId, title: text(raw.title, 300, 'action title', true),
      minutes: number(raw.minutes, 1, 10080, 'action estimate'), ideaId, status, dependsOn,
      deadline: calendar(raw.deadline, 'action deadline', true), draft: text(raw.draft, 1_000_000, 'action draft'), completedAt,
      spentMs: raw.spentMs === undefined ? 0 : number(raw.spentMs, 0, Number.MAX_SAFE_INTEGER, 'accumulated focus time'),
      remainingMinutes: (upgrading && raw.remainingMinutes == null) || raw.remainingMinutes === null ? null : number(raw.remainingMinutes, 0, 10080, 'remaining estimate'),
      reviewMinutes: (upgrading && raw.reviewMinutes == null) || raw.reviewMinutes === null ? null : number(raw.reviewMinutes, 1, 120, 'review budget'),
      reviewIdeaIds, reviewMaxItems,
      studyId: raw.studyId == null ? null : id(raw.studyId, 'action study') };
  });
  const actionMap = new Map(actions.map((action) => [action.id, action]));
  for (const action of actions) {
    if (action.dependsOn.some((dependency) => actionMap.get(dependency)?.projectId !== action.projectId)) {
      throw new RangeError('Dependencies must exist in the same project.');
    }
  }
  // Cycles are valid saved user input. The scheduler explains their infeasibility.
  const activeProjectId = projectRef(input.activeProjectId);
  const selectedSourceId = input.selectedSourceId === null ? null : id(input.selectedSourceId, 'selected source');
  const selectedIdeaId = input.selectedIdeaId === null ? null : id(input.selectedIdeaId, 'selected idea');
  if (selectedSourceId !== null && sourceMap.get(selectedSourceId)?.projectId !== activeProjectId) throw new RangeError('Selected source must belong to the active project.');
  if (selectedIdeaId !== null && ideaMap.get(selectedIdeaId)?.projectId !== activeProjectId) throw new RangeError('Selected idea must belong to the active project.');
  let session = null;
  if (input.session !== null) {
    const raw = record(input.session, 'Session');
    const actionId = id(raw.actionId, 'session action');
    if (!actionMap.has(actionId)) throw new RangeError('Session action is missing.');
    session = { actionId, running: bool(raw.running, 'session running'),
      startedAt: raw.startedAt === null ? null : number(raw.startedAt, 0, Number.MAX_SAFE_INTEGER, 'session start'),
      elapsedMs: number(raw.elapsedMs, 0, Number.MAX_SAFE_INTEGER, 'elapsed session time'),
      goalMinutes: number(raw.goalMinutes, 1, 10080, 'session goal'),
      blockId: (upgrading && raw.blockId == null) || raw.blockId === null ? null : id(raw.blockId, 'session block'),
      sessionStartedAt: timestamp(upgrading ? (raw.sessionStartedAt ?? null) : raw.sessionStartedAt, 'dated session start', true) };
    // Validate relationships without advancing or mutating the saved timer.
    sessionElapsed(session, session.startedAt ?? 0);
  }
  let quiet = null;
  if (input.quiet !== null) {
    const raw = record(input.quiet, 'Quiet timer');
    const durationMinutes = number(raw.durationMinutes, 5, 120, 'quiet duration');
    quiet = { running: bool(raw.running, 'quiet running'),
      endsAt: raw.endsAt === null ? null : number(raw.endsAt, 0, Number.MAX_SAFE_INTEGER, 'quiet end'),
      remainingMs: number(raw.remainingMs, 0, durationMinutes * 60000, 'quiet remaining time'), durationMinutes };
    if (quiet.running !== (quiet.endsAt !== null)) throw new RangeError('Quiet timer timestamp does not match its state.');
  }
  record(input.settings, 'Settings');
  const lab = input.lab === undefined ? createLabState() : validateLabState(input.lab);
  let studio;
  if(input.version>=3)studio=validateStudio(input.studio,{projectIds:[...projectMap.keys()],sources});
  else{
    studio=createStudio(activeProjectId);
    if(hasLegacyLabWork(lab)){
      const recovered=recoverLegacyStudy(lab);
      studio.studies.unshift(recovered);studio.activeStudyId=recovered.id;
    }
    studio=validateStudio(studio,{projectIds:[...projectMap.keys()],sources});
  }
  for(const action of actions){
    if(action.studyId!==null){const study=studio.studies.find(s=>s.id===action.studyId);if(!study||study.projectId!==action.projectId)throw new RangeError('An action study must exist in the same project.');}
  }
  const workbench = validateWorkbench(upgrading ? (input.workbench ?? createWorkbench()) : input.workbench, actions, { unique });
  if (session?.blockId !== null && session?.blockId !== undefined && workbench.blocks.find(block => block.id === session.blockId)?.actionId !== session.actionId) {
    throw new RangeError('The active session block must belong to its action.');
  }
  if (!upgrading && input.reviewSession === undefined) throw new TypeError('A v4 workspace must include its review session field.');
  const reviewSession = validateReviewSession(upgrading ? (input.reviewSession ?? null) : input.reviewSession, { projects, sources, ideas, attempts });
  if (reviewSession !== null) unique(reviewSession.id, 'review session ID');
  return { version: 4, projects, activeProjectId,
    view: ['studio','studies','guide'].includes(input.view) ? 'lab' : oneOf(input.view, ['lab', 'desk', 'library', 'week', 'quiet'], 'view'), selectedSourceId, selectedIdeaId,
    sources, ideas, attempts, actions, session, quiet, settings: { night: bool(input.settings.night, 'night atmosphere') }, lab, studio,
    workbench, reviewSession };
}

function freshState(){const state=validateState(createState());state.view='lab';return state;}

export function loadState(storage) {
  let saved, key=SAVE_KEY;
  try {
    saved=storage.getItem(SAVE_KEY);
    // Even an empty/corrupt newer entry takes precedence over older backups.
    if(saved===null){saved=storage.getItem(PRIOR_SAVE_KEY);key=PRIOR_SAVE_KEY;}
    if(saved===null){saved=storage.getItem(LEGACY_SAVE_KEY);key=LEGACY_SAVE_KEY;}
  }
  catch { return { state: freshState(), notice: 'Saving is unavailable. You can keep working in this session and export your notes.' }; }
  if (saved === null) return { state: freshState(), notice: '' };
  try {
    if (typeof saved !== 'string' || saved.length > 25_000_000) throw new RangeError('Invalid save size.');
    const raw=JSON.parse(saved);
    if(key===SAVE_KEY&&raw.version!==4)throw new RangeError('Unsupported current save version.');
    if(key===PRIOR_SAVE_KEY&&raw.version!==3)throw new RangeError('Unsupported previous save version.');
    if(key===LEGACY_SAVE_KEY&&raw.version!==2)throw new RangeError('Unsupported legacy save version.');
    return { state: validateState(raw), notice: '', migrated:raw.version<4, migrationNotice:raw.version<4?'Previous work recovered. Original project windows and old saves remain untouched; adopt one shared calendar when ready.':'' };
  } catch {
    return { state: freshState(), notice: 'The saved desk could not be read. A fresh project is ready; the invalid record has not been overwritten.', recoveryRaw:saved,recoveryKey:key };
  }
}

export function saveState(storage, state) {
  try {
    const canonical=JSON.stringify(validateState(state));
    if(canonical.length>25_000_000)throw new RangeError('Workspace exceeds the readable save size limit.');
    const previous=storage.getItem(SAVE_KEY);
    if(previous!==null){
      let unreadable=false;
      try{
        if(typeof previous!=='string'||previous.length>25_000_000)throw new RangeError('Invalid previous save size.');
        const parsed=JSON.parse(previous);
        if(parsed.version!==4)throw new RangeError('Unsupported current save version.');
        validateState(parsed);
      }catch{unreadable=true;}
      if(unreadable)storage.setItem(SAVE_KEY+'.unreadable',previous);
    }
    storage.setItem(SAVE_KEY,canonical);return true;
  }
  catch { return false; }
}
