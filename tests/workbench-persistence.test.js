import test from 'node:test';
import assert from 'node:assert/strict';
import { createExampleState, reviewDue, splitSource } from '../domain.js';
import { SAVE_KEY, PRIOR_SAVE_KEY, LEGACY_SAVE_KEY, validateState, loadState, saveState } from '../persistence.js';
import { activeStudy, saveAlternative, commitExperiment } from '../studies.js';

const START = '2026-10-13T11:00:00.000Z';
const END = '2026-10-13T11:30:00.000Z';
function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
function previousState() {
  const canonical = validateState(createExampleState());
  canonical.version = 3;
  delete canonical.workbench;
  delete canonical.reviewSession;
  canonical.ideas.forEach(idea => delete idea.answerCriteria);
  canonical.actions.forEach(action => { delete action.remainingMinutes; delete action.reviewMinutes; delete action.reviewIdeaIds; delete action.reviewMaxItems; });
  canonical.attempts.push({ id: 'attempt-history', ideaId: canonical.ideas[0].id,
    answer: 'The prior authored answer.\n原始答案', rating: 'uncertain', createdAt: START, dueAt: reviewDue('uncertain', START) });
  canonical.actions[0].spentMs = 1_800_000;
  canonical.actions[0].draft = 'Retained original draft.\n<literal prose>';
  canonical.session = { actionId: canonical.actions[0].id, running: false, startedAt: null, elapsedMs: 60000, goalMinutes: 25 };
  const study = activeStudy(canonical.studio);
  saveAlternative(study, 'Retained arrangement');
  commitExperiment(study, { detectorId: 'point-a', prediction: 'increase', hypothesis: 'Retain this pending prediction.' });
  return canonical;
}
function modernState() {
  const state = validateState(previousState());
  const action = state.actions[0], idea = state.ideas[0], source = state.sources[0];
  state.workbench.calendar = { timeZone: 'Asia/Shanghai', startDate: '2026-10-13', days: 7,
    defaultWindows: [{ startMinute: 1140, endMinute: 1230 }],
    overrides: [{ date: '2026-10-14', windows: [] }],
    commitments: [{ id: 'commitment-dinner', title: 'Dinner', date: '2026-10-13', startMinute: 1170, endMinute: 1200 }],
    restMinutes: 5, minBlockMinutes: 20 };
  state.workbench.blocks = [{ id: 'block-first', actionId: action.id, date: '2026-10-13', startMinute: 1140,
    minutes: 25, pinned: true, status: 'done' }];
  state.workbench.backlogIds = [state.actions[1].id];
  state.workbench.sessions = [{ id: 'session-work', actionId: action.id, actionTitle: 'The title used during this session',
    blockId: 'block-first', startedAt: START, endedAt: END, durationMs: 900_000, outcome: 'continue',
    output: 'A retained paragraph.\n第二段', nextStep: 'Check one original claim.', remainingMinutesAfter: 15 }];
  action.remainingMinutes = 15;
  action.reviewMinutes = 10;
  action.reviewIdeaIds = [idea.id];
  action.reviewMaxItems = 5;
  idea.answerCriteria = 'Name a claim and its original supporting passage.';
  state.attempts.push({ id: 'attempt-context', ideaId: idea.id, answer: '', rating: 'again', createdAt: END,
    dueAt: reviewDue('again', END), promptSnapshot: idea.question, criteriaSnapshot: idea.answerCriteria,
    referenceSnapshot: source.paragraphs[0].text, sourceId: source.id, paragraphId: source.paragraphs[0].id,
    couldNotRecall: true, sessionId: 'review-history' });
  state.reviewSession = { id: 'review-active', projectId: state.activeProjectId, ideaIds: [idea.id], index: 0,
    startedAt: START, budgetMinutes: 10, maxItems: 5, checkedIds: [], skippedIds: [], answer: 'A retained draft',
    revealed: true, couldNotRecall: false, lastUndo: null };
  state.session = { ...state.session, blockId: 'block-first', sessionStartedAt: START };
  return validateState(state);
}

test('v3 migration preserves all original records and adds no fabricated calendar or dated work/review history', () => {
  const old = previousState(), untouched = structuredClone(old), upgraded = validateState(old);
  assert.equal(upgraded.version, 4);
  for (const key of ['projects', 'sources', 'studio', 'lab', 'quiet', 'settings', 'activeProjectId', 'selectedSourceId', 'selectedIdeaId', 'view']) {
    assert.deepEqual(upgraded[key], old[key], key);
  }
  assert.deepEqual(upgraded.actions, old.actions.map(action => ({ ...action, remainingMinutes: null, reviewMinutes: null, reviewIdeaIds: null, reviewMaxItems: null })));
  assert.deepEqual(upgraded.ideas, old.ideas.map(idea => ({ ...idea, answerCriteria: '' })));
  assert.deepEqual(upgraded.attempts, old.attempts.map(attempt => ({ ...attempt,
    promptSnapshot: null, criteriaSnapshot: null, referenceSnapshot: null, sourceId: null, paragraphId: null,
    couldNotRecall: false, sessionId: null })));
  assert.deepEqual(upgraded.session, { ...old.session, blockId: null, sessionStartedAt: null });
  assert.deepEqual(upgraded.workbench, { version: 1, calendar: null, backlogIds: [], blocks: [], sessions: [] });
  assert.equal(upgraded.reviewSession, null);
  assert.deepEqual(old, untouched);
});

test('v4 takes precedence over v3 then v2; reading and saving never rewrites either old key', () => {
  const saved = storage(), v3 = previousState(), v2 = createExampleState();
  v2.projects[0].title = 'Older v2'; v3.projects[0].title = 'Prior v3';
  const priorRaw = JSON.stringify(v3), legacyRaw = JSON.stringify(v2);
  saved.setItem(PRIOR_SAVE_KEY, priorRaw); saved.setItem(LEGACY_SAVE_KEY, legacyRaw);
  const migrated = loadState(saved);
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.state.projects[0].title, 'Prior v3');
  assert.equal(saved.getItem(SAVE_KEY), null);
  migrated.state.projects[0].title = 'Current v4';
  assert.equal(saveState(saved, migrated.state), true);
  assert.equal(loadState(saved).state.projects[0].title, 'Current v4');
  assert.equal(saved.getItem(PRIOR_SAVE_KEY), priorRaw);
  assert.equal(saved.getItem(LEGACY_SAVE_KEY), legacyRaw);
});

test('corrupt or empty newer saves remain identified and cannot silently fall through to valid old work', () => {
  for (const key of [SAVE_KEY, PRIOR_SAVE_KEY]) for (const invalid of ['', '{broken', JSON.stringify({ version: 9 })]) {
    const saved = storage(), prior = JSON.stringify(previousState()), legacy = JSON.stringify(createExampleState());
    saved.setItem(LEGACY_SAVE_KEY, legacy);
    if (key === SAVE_KEY) saved.setItem(PRIOR_SAVE_KEY, prior);
    saved.setItem(key, invalid);
    const recovered = loadState(saved);
    assert.match(recovered.notice, /could not be read/);
    assert.equal(recovered.recoveryKey, key);
    assert.equal(recovered.recoveryRaw, invalid);
    assert.equal(recovered.state.sources.length, 0);
    assert.equal(saved.getItem(key), invalid);
    assert.equal(saved.getItem(LEGACY_SAVE_KEY), legacy);
    if (key === SAVE_KEY) assert.equal(saved.getItem(PRIOR_SAVE_KEY), prior);
  }
});

test('a wrong-version record under the current key is preserved before a subsequent explicit valid save', () => {
  const saved = storage(), wrongKeyRaw = JSON.stringify(previousState());
  saved.setItem(SAVE_KEY, wrongKeyRaw);
  const loaded = loadState(saved);
  assert.equal(loaded.recoveryRaw, wrongKeyRaw);
  assert.equal(loaded.recoveryKey, SAVE_KEY);
  assert.equal(saveState(saved, loaded.state), true);
  assert.equal(saved.getItem(SAVE_KEY + '.unreadable'), wrongKeyRaw);
  assert.equal(loadState(saved).notice, '');
});

test('every new planning, work, timer, question and review field survives canonical JSON/storage round trips', () => {
  const state = modernState(), original = structuredClone(state), saved = storage();
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))), original);
  assert.equal(saveState(saved, state), true);
  assert.deepEqual(loadState(saved).state, original);
  state.ideas[0].question = 'An edited present question';
  state.ideas[0].answerCriteria = 'Edited present criteria';
  state.actions[0].title = 'An edited current action title';
  const edited = validateState(state);
  assert.equal(edited.attempts[1].promptSnapshot, original.attempts[1].promptSnapshot);
  assert.equal(edited.attempts[1].criteriaSnapshot, original.attempts[1].criteriaSnapshot);
  assert.equal(edited.workbench.sessions[0].actionTitle, original.workbench.sessions[0].actionTitle);
  edited.workbench.calendar.defaultWindows[0].startMinute = 0;
  assert.equal(original.workbench.calendar.defaultWindows[0].startMinute, 1140);
});

test('a planned review retains its selected questions across projects without creating assessment history', () => {
  const state = modernState(), other = validateState(createExampleState()), before = structuredClone(state.attempts);
  state.projects.push(other.projects[0]);
  state.sources.push(other.sources[0]);
  state.ideas.push(other.ideas[0]);
  state.actions[0].reviewIdeaIds = [state.ideas[0].id, other.ideas[0].id];
  state.actions[0].reviewMaxItems = 2;
  const canonical = validateState(state);
  assert.deepEqual(canonical.actions[0].reviewIdeaIds, state.actions[0].reviewIdeaIds);
  assert.deepEqual(canonical.attempts, before);
  assert.equal(canonical.reviewSession.id, state.reviewSession.id);
  delete state.actions[1].reviewIdeaIds;
  delete state.actions[1].reviewMaxItems;
  assert.equal(validateState(state).actions[1].reviewIdeaIds, null);
  assert.equal(validateState(state).actions[1].reviewMaxItems, null);
});

test('invalid linked workbench/review state fails before overwriting an intact canonical workspace', () => {
  const state = modernState(), saved = storage();
  assert.equal(saveState(saved, state), true);
  const original = saved.getItem(SAVE_KEY);
  const mutations = [
    value => { value.workbench.backlogIds.push('missing-action'); },
    value => { value.workbench.backlogIds.push(value.workbench.backlogIds[0]); },
    value => { value.workbench.blocks[0].actionId = 'missing-action'; },
    value => { value.workbench.blocks[0].minutes = 0; },
    value => { value.workbench.blocks[0].status = 'performed'; },
    value => { value.workbench.blocks[0].id = value.ideas[0].id; },
    value => { value.workbench.calendar.commitments.push({ ...value.workbench.calendar.commitments[0], id: 'commitment-overlap' }); },
    value => { value.workbench.sessions[0].blockId = 'missing-block'; },
    value => { value.workbench.sessions[0].actionId = value.actions[1].id; },
    value => { value.workbench.sessions[0].endedAt = '2026-10-12T11:30:00.000Z'; },
    value => { value.workbench.sessions[0].durationMs = -1; },
    value => { value.workbench.sessions[0].remainingMinutesAfter = 0.5; },
    value => { value.session.blockId = 'missing-block'; },
    value => { value.reviewSession.ideaIds[0] = 'missing-idea'; },
    value => { value.reviewSession.checkedIds.push(value.ideas[0].id); },
    value => { value.attempts[1].referenceSnapshot += 'invented'; },
    value => { value.attempts[1].sourceId = 'missing-source'; },
    value => { value.attempts[1].criteriaSnapshot = null; },
    value => { value.attempts[1].rating = 'understood'; },
    value => { delete value.workbench; },
    value => { delete value.reviewSession; },
    value => { delete value.ideas[0].answerCriteria; },
    value => { delete value.actions[0].remainingMinutes; },
    value => { delete value.session.blockId; },
    value => { value.actions[0].reviewIdeaIds = ['missing-idea']; },
    value => { value.actions[0].reviewIdeaIds = [value.ideas[0].id, value.ideas[0].id]; },
    value => { value.actions[0].reviewMaxItems = 0; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const invalid = structuredClone(state); mutate(invalid);
    assert.throws(() => validateState(invalid), undefined, `invalid mutation ${index}`);
    assert.equal(saveState(saved, invalid), false);
    assert.equal(saved.getItem(SAVE_KEY), original);
  }
});

test('changed availability retains stale accepted and historical allocations for explicit conflict handling', () => {
  const state = modernState();
  state.workbench.calendar.startDate = '2026-11-01';
  state.workbench.calendar.overrides = [];
  state.workbench.calendar.commitments = [];
  state.workbench.calendar.defaultWindows = [{ startMinute: 600, endMinute: 660 }];
  assert.deepEqual(validateState(state).workbench.blocks, state.workbench.blocks);
  assert.deepEqual(validateState(state).workbench.sessions, state.workbench.sessions);
});

test('write denial preserves all prior keys, the prior v4 and the caller candidate', () => {
  const saved = storage(), state = modernState();
  saved.setItem(PRIOR_SAVE_KEY, JSON.stringify(previousState()));
  assert.equal(saveState(saved, state), true);
  const prior = saved.getItem(PRIOR_SAVE_KEY), current = saved.getItem(SAVE_KEY), untouched = structuredClone(state);
  const denied = { getItem: key => saved.getItem(key), setItem() { throw new Error('quota denied'); } };
  assert.equal(saveState(denied, state), false);
  assert.equal(saved.getItem(PRIOR_SAVE_KEY), prior);
  assert.equal(saved.getItem(SAVE_KEY), current);
  assert.deepEqual(state, untouched);
  saved.setItem(SAVE_KEY, '{corrupt current');
  assert.equal(saveState(denied, state), false);
  assert.equal(saved.getItem(SAVE_KEY), '{corrupt current');
  assert.equal(saved.getItem(SAVE_KEY + '.unreadable'), null);
});

test('an oversized otherwise valid candidate cannot replace a save with data that reload would reject', () => {
  const saved = storage(), state = modernState();
  assert.equal(saveState(saved, state), true);
  const prior = saved.getItem(SAVE_KEY);
  const draft = 'x'.repeat(1_000_000);
  for (let index = 0; index < 26; index += 1) {
    state.actions.push({ ...state.actions[0], id: `large-action-${index}`, draft, dependsOn: [], ideaId: null, studyId: null });
  }
  assert.doesNotThrow(() => validateState(state));
  assert.equal(saveState(saved, state), false);
  assert.equal(saved.getItem(SAVE_KEY), prior);
});

test('missing snapshots are legacy nulls, while a new long reference is preserved without truncation', () => {
  const state = modernState();
  assert.equal(state.attempts[0].promptSnapshot, null);
  const source = { id: 'source-long', projectId: state.activeProjectId, title: 'Long source', kind: 'text',
    text: 'An exact original clause. '.repeat(8000), createdAt: START };
  source.paragraphs = splitSource(source.text);
  state.sources.push(source);
  state.ideas[0].sourceId = source.id;
  state.ideas[0].paragraphId = source.paragraphs[0].id;
  state.attempts[1].sourceId = source.id;
  state.attempts[1].paragraphId = source.paragraphs[0].id;
  state.attempts[1].referenceSnapshot = source.paragraphs[0].text;
  assert.ok(source.paragraphs[0].text.length > 100000);
  assert.equal(validateState(state).attempts[1].referenceSnapshot, source.paragraphs[0].text);
});
