import test from 'node:test';
test('imported Studio navigation aliases resolve to a visible canonical panel',()=>{
  for(const view of ['studio','studies','guide']){
    const input=createState();input.view=view;
    assert.equal(validateState(input).view,'lab');
  }
});
import assert from 'node:assert/strict';
import { createState, createExampleState, reviewDue, scheduleActions, sessionElapsed, uid } from '../domain.js';
import { SAVE_KEY, LEGACY_SAVE_KEY, validateState, loadState, saveState } from '../persistence.js';
import { createLabState, evaluateScene, makeExperiment } from '../optics.js';
import {activeStudy,saveAlternative,commitExperiment,runExperiment,finalizeExperiment,chooseAlternative} from '../studies.js';

const TIME = '2026-10-11T11:00:00.000Z';
function memoryStorage() {
  const data = new Map();
  return { getItem(key) { return data.get(key) ?? null; }, setItem(key, value) { data.set(key, value); } };
}
function richState() {
  const state = createExampleState();
  state.projects[0].closing = { note: 'A real note.\n第二行: keep exact text.', nextAction: 'Compare the two selected passages.', updatedAt: TIME };
  state.sources[0].paragraphs[0].page = 1;
  state.ideas[0].origin = 'ai';
  state.attempts.push({ id: uid('attempt'), ideaId: state.ideas[0].id, answer: 'A dependency is work that must finish before another action can start.', rating: 'uncertain', createdAt: TIME, dueAt: reviewDue('uncertain', TIME) });
  state.actions[0].draft = 'Working draft.\n<This is text, not executable markup.>';
  state.actions[0].status = 'done';
  state.actions[0].completedAt = TIME;
  state.session = { actionId: state.actions[1].id, running: true, startedAt: 100000, elapsedMs: 20000, goalMinutes: 25 };
  state.quiet = { running: false, endsAt: null, remainingMs: 600000, durationMinutes: 10 };
  state.settings.night = false;
  return validateState(state);
}
function assertRejected(mutate, base = richState()) {
  mutate(base);
  assert.throws(() => validateState(base));
  const storage = memoryStorage();
  const serialized = JSON.stringify(base);
  storage.setItem(SAVE_KEY, serialized);
  const loaded = loadState(storage);
  assert.match(loaded.notice, /could not be read/i);
  assert.equal(loaded.state.version, 3);
  assert.equal(loaded.state.sources.length, 0);
  assert.equal(loaded.state.projects[0].example, false);
  assert.equal(storage.getItem(SAVE_KEY), serialized);
}

test('fresh and explicit example states validate without adding invented attempts or completed work', () => {
  const fresh = validateState(createState());
  const example = validateState(createExampleState());
  assert.deepEqual(validateState(fresh), fresh);
  assert.deepEqual(validateState(example), example);
  assert.equal(validateState(example).attempts.length, 0);
  assert.ok(validateState(example).actions.every((action) => action.completedAt === null));
});

test('saving and resuming preserves source anchors, self-assessments, dates, drafts, closing notes, and timer state', () => {
  const original = richState();
  const storage = memoryStorage();
  assert.equal(saveState(storage, original), true);
  const loaded = loadState(storage);
  assert.equal(loaded.notice, '');
  assert.deepEqual(loaded.state, original);
  assert.equal(sessionElapsed(loaded.state.session, 160000), 80000);
  assert.deepEqual(scheduleActions(loaded.state.actions, loaded.state.projects[0].plan), scheduleActions(original.actions, original.projects[0].plan));
  loaded.state.projects[0].closing.note = 'Different';
  loaded.state.sources[0].paragraphs[0].text = 'Different';
  loaded.state.actions[0].dependsOn.push('Different');
  assert.equal(original.projects[0].closing.note, 'A real note.\n第二行: keep exact text.');
  assert.notEqual(original.sources[0].paragraphs[0].text, 'Different');
  assert.deepEqual(original.actions[0].dependsOn, []);
});

test('unknown fields are removed while authored prose and exact source content remain unchanged', () => {
  const raw = richState();
  raw.fakeMastery = 100;
  raw.settings.remote = true;
  raw.projects[0].completionScore = 100;
  raw.sources[0].paragraphs[0].fakePageConfidence = 99;
  raw.ideas[0].verified = true;
  raw.actions[0].timerVerified = true;
  const clean = validateState(raw);
  assert.equal(clean.fakeMastery, undefined);
  assert.equal(clean.settings.remote, undefined);
  assert.equal(clean.projects[0].completionScore, undefined);
  assert.equal(clean.sources[0].paragraphs[0].fakePageConfidence, undefined);
  assert.equal(clean.ideas[0].verified, undefined);
  assert.equal(clean.actions[0].timerVerified, undefined);
  assert.equal(clean.actions[0].draft, raw.actions[0].draft);
  assert.equal(clean.sources[0].text, raw.sources[0].text);
  assert.equal(raw.fakeMastery, 100);
});

test('damaged paragraphs and broken or cross-project references cannot silently detach evidence', () => {
  const mutations = [
    (state) => { state.sources[0].paragraphs[0].text += ' invented'; },
    (state) => { state.sources[0].paragraphs[0].id = 'wrong-passage'; },
    (state) => { state.sources[0].paragraphs[0].index = 1; },
    (state) => { state.sources[0].paragraphs.pop(); },
    (state) => { state.sources[0].paragraphs[0].page = 0; },
    (state) => { state.ideas[0].sourceId = 'missing-source'; },
    (state) => { state.ideas[0].paragraphId = 'missing-passage'; },
    (state) => { state.attempts[0].ideaId = 'missing-idea'; },
    (state) => { state.actions[0].ideaId = 'missing-idea'; },
    (state) => { state.actions[1].dependsOn = ['missing-action']; },
    (state) => { state.session.actionId = 'missing-action'; },
    (state) => { state.selectedSourceId = 'missing-source'; },
    (state) => { state.selectedIdeaId = 'missing-idea'; },
    (state) => { state.activeProjectId = 'missing-project'; },
  ];
  mutations.forEach((mutate) => assertRejected(mutate));
  assertRejected((state) => {
    const other = createState().projects[0];
    state.projects.push(other);
    state.actions[1].projectId = other.id;
    state.actions[1].ideaId = null;
  });
  assertRejected((state) => {
    const other = createState().projects[0];
    state.projects.push(other);
    state.activeProjectId = other.id;
  });
});

test('duplicate IDs, invalid dates, status mismatches, malformed controls, and collection limits are rejected', () => {
  const mutations = [
    (state) => { state.version = 1; },
    (state) => { state.view = 'unknown-view'; },
    (state) => { state.actions[0].id = state.ideas[0].id; },
    (state) => { state.sources.push(structuredClone(state.sources[0])); },
    (state) => { state.projects[0].createdAt = '2026-02-30T11:00:00.000Z'; },
    (state) => { state.projects[0].plan.startDate = '2026-02-29'; },
    (state) => { state.projects[0].plan.days = 8; },
    (state) => { state.projects[0].plan.startTime = '23:50'; },
    (state) => { state.projects[0].plan.dailyMinutes = -1; },
    (state) => { state.projects[0].plan.restMinutes = 0.5; },
    (state) => { state.attempts[0].rating = 'mastered'; },
    (state) => { state.attempts[0].dueAt = '2026-10-10T00:00:00.000Z'; },
    (state) => { state.actions[0].completedAt = null; },
    (state) => { state.actions[1].completedAt = TIME; },
    (state) => { state.actions[1].minutes = Infinity; },
    (state) => { state.actions[1].deadline = '2026-11-31'; },
    (state) => { state.actions[1].dependsOn.push(state.actions[1].dependsOn[0]); },
    (state) => { state.settings.night = 'yes'; },
    (state) => { state.sources = Array(101).fill(state.sources[0]); },
    (state) => { state.projects = []; },
  ];
  mutations.forEach((mutate) => assertRejected(mutate));
  const sparse = richState();
  sparse.ideas = Array(2);
  assert.throws(() => validateState(sparse));
});

test('dependency cycles survive save as editable input, while scheduling reports the infeasibility', () => {
  const state = validateState(createExampleState());
  state.actions[0].dependsOn = [state.actions.at(-1).id];
  const storage = memoryStorage();
  assert.equal(saveState(storage, state), true);
  const loaded = loadState(storage);
  assert.equal(loaded.notice, '');
  assert.deepEqual(loaded.state, state);
  const result = scheduleActions(loaded.state.actions, loaded.state.projects[0].plan);
  assert.equal(result.overflow.length, 4);
  assert.equal(result.finishDate, null);
  assert.equal(result.days.flatMap((day) => day.blocks).length, 0);
});

test('paused focus and running quiet timers preserve their distinct wall-clock models', () => {
  const state = richState();
  state.session = { ...state.session, running: false, startedAt: null, elapsedMs: 80000 };
  state.quiet = { running: true, endsAt: 700000, remainingMs: 600000, durationMinutes: 10 };
  const storage = memoryStorage();
  assert.equal(saveState(storage, state), true);
  assert.deepEqual(loadState(storage).state, state);
  assert.equal(sessionElapsed(loadState(storage).state.session, 999999), 80000);
  assertRejected((raw) => { raw.session.running = false; });
  assertRejected((raw) => { raw.session.startedAt = null; });
  assertRejected((raw) => { raw.session.elapsedMs = -1; });
  assertRejected((raw) => { raw.quiet.durationMinutes = 1; });
  assertRejected((raw) => { raw.quiet.remainingMs = 600001; });
  assertRejected((raw) => { raw.quiet.running = true; });
});

test('accumulated action time defaults safely and persists separately from a newly started session', () => {
  const state = richState();
  const current = state.actions.find((action) => action.id === state.session.actionId);
  delete current.spentMs;
  assert.equal(validateState(state).actions.find((action) => action.id === current.id).spentMs, 0);
  current.spentMs = 60000;
  current.spentMs += sessionElapsed(state.session, 160000);
  state.session = { actionId: state.actions[2].id, running: false, startedAt: null, elapsedMs: 0, goalMinutes: 30 };
  const storage = memoryStorage();
  assert.equal(saveState(storage, state), true);
  const loaded = loadState(storage);
  assert.equal(loaded.notice, '');
  assert.equal(loaded.state.actions.find((action) => action.id === current.id).spentMs, 140000);
  assert.equal(sessionElapsed(loaded.state.session, 999999), 0);
  for (const invalid of [-1, NaN, Infinity, 1.5, '60000']) {
    assert.throws(() => validateState({ ...state, actions: state.actions.map((action) => ({ ...action, spentMs: invalid })) }));
  }
});

test('corrupted records remain untouched and unavailable storage leaves session work exportable', () => {
  const storage = memoryStorage();
  storage.setItem(SAVE_KEY, '{not valid JSON');
  const recovered = loadState(storage);
  assert.match(recovered.notice, /could not be read/);
  assert.equal(storage.getItem(SAVE_KEY), '{not valid JSON');
  assert.equal(recovered.state.projects[0].example, false);
  const noSave = loadState(memoryStorage());
  assert.equal(noSave.notice, '');
  assert.equal(noSave.state.sources.length, 0);
  const unavailable = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  const loaded = loadState(unavailable);
  assert.match(loaded.notice, /unavailable.*export/i);
  const state = richState();
  const original = structuredClone(state);
  assert.equal(saveState(unavailable, state), false);
  assert.deepEqual(state, original);
  assert.equal(JSON.parse(JSON.stringify(validateState(state))).actions[0].draft, original.actions[0].draft);
  assert.equal(saveState(undefined, state), false);
  assert.match(loadState(undefined).notice, /unavailable/);
});

test('legacy desks without a lab get an empty deterministic lab while preserving all authored work', () => {
  const legacy = richState();
  legacy.version=2;
  delete legacy.studio;
  delete legacy.lab;
  const storage = memoryStorage();
  storage.setItem(SAVE_KEY, JSON.stringify(legacy));
  const loaded = loadState(storage);
  assert.equal(loaded.notice, '');
  assert.deepEqual(loaded.state.lab, createLabState());
  assert.equal(loaded.state.lab.experiments.length, 0);
  const { lab, studio, version, ...desk } = loaded.state;
  const {version:legacyVersion,...legacyDesk}=legacy;
  assert.equal(version,3);
  assert.deepEqual(desk, legacyDesk);
  assert.equal(storage.getItem(SAVE_KEY), JSON.stringify(legacy), 'loading does not rewrite the original backup');
});

test('a complete light experiment survives save and reload with independent scenes and derived evidence', () => {
  const state = richState();
  state.lab = createLabState('shadow');
  const before = structuredClone(state.lab.scene);
  state.lab.scene.screens[0].height = 0.2;
  const record = makeExperiment(before, state.lab.scene, { id: 'experiment-persist', createdAt: TIME, challengeId: 'shadow', detectorId: 'detector-a', prediction: 'increase', note: 'The screen was lower than the direct path. I should check reflected light in a real room.' });
  state.lab.experiments.push(record);
  const storage = memoryStorage();
  assert.equal(saveState(storage, state), true);
  const loaded = loadState(storage);
  assert.equal(loaded.notice, '');
  assert.deepEqual(loaded.state, state);
  assert.deepEqual(loaded.state.lab.experiments[0].before.readings, evaluateScene(before));
  assert.deepEqual(loaded.state.lab.experiments[0].after.readings, evaluateScene(state.lab.scene));
  loaded.state.lab.scene.lamps[0].intensity = 1;
  loaded.state.lab.experiments[0].before.scene.screens[0].height = 0;
  assert.equal(state.lab.scene.lamps[0].intensity, 120);
  assert.equal(state.lab.experiments[0].before.scene.screens[0].height, 0.7);
});

test('forged light evidence or invalid controls cannot overwrite a recoverable saved desk', () => {
  const state = richState();
  const before = structuredClone(state.lab.scene);
  state.lab.scene.lamps[0].height = 0.4;
  state.lab.experiments.push(makeExperiment(before, state.lab.scene, { id: 'experiment-persist', createdAt: TIME, challengeId: 'distance', detectorId: 'detector-a', prediction: 'increase', note: 'Half height gave four times the measured illuminance.' }));
  const storage = memoryStorage();
  assert.equal(saveState(storage, state), true);
  const originalRaw = storage.getItem(SAVE_KEY);
  const forged = structuredClone(state);
  forged.lab.experiments[0].after.readings.detectors[0].lux = 999;
  assert.throws(() => validateState(forged), /scene evidence/);
  assert.equal(saveState(storage, forged), false);
  assert.equal(storage.getItem(SAVE_KEY), originalRaw);
  for (const value of [0, NaN, Infinity, -1]) {
    const invalid = structuredClone(state);
    invalid.lab.scene.lamps[0].height = value;
    assert.throws(() => validateState(invalid));
  }
  storage.setItem(SAVE_KEY, JSON.stringify(forged));
  const recovered = loadState(storage);
  assert.match(recovered.notice, /could not be read/);
  assert.equal(recovered.state.lab.experiments.length, 0);
  assert.equal(storage.getItem(SAVE_KEY), JSON.stringify(forged));
});
