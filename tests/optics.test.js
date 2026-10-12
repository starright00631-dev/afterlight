import test from 'node:test';
import assert from 'node:assert/strict';
import { CHALLENGES, LIGHT_SOURCES, createLabState, getChallenge, validateScene, evaluateScene, sampleField, challengeVerdict, makeExperiment, validateLabState } from '../optics.js';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const lux = (scene, id = 'detector-a') => evaluateScene(scene).detectors.find((item) => item.id === id).lux;
const metadata = (overrides = {}) => ({ id: 'experiment-test', createdAt: '2026-10-11T12:00:00.000Z', challengeId: 'distance', detectorId: 'detector-a', prediction: 'increase', ...overrides });
const screen = (overrides = {}) => ({ id: 'screen-test', x1: 3, y1: 1, x2: 3, y2: 3, height: 0.5, enabled: true, ...overrides });

test('overhead inverse square law gives four times the illuminance at half height', () => {
  const state = createLabState();
  close(lux(state.scene), 50);
  state.scene.lamps[0].height = 0.4;
  close(lux(state.scene), 200);
  const contribution = evaluateScene(state.scene).detectors[0].contributions[0];
  close(contribution.cosine, 1);
  close(contribution.distance, 0.4);
  assert.equal(challengeVerdict('distance', state.scene).passed, true);
});

test('off-axis illuminance includes cosine response and is not just intensity over squared distance', () => {
  const scene = createLabState().scene;
  scene.lamps[0] = { ...scene.lamps[0], x: 2, height: 1, intensity: 100 };
  close(lux(scene), 100 / (2 ** 1.5));
  assert.ok(lux(scene) < 100 / 2);
  scene.lamps[0].height = 0.2;
  const low = lux(scene);
  scene.lamps[0].height = Math.SQRT1_2;
  assert.ok(lux(scene) > low, 'raising an off-axis lamp can increase illumination');
});

test('independent lamp contributions add, while disabled and zero-intensity lamps contribute nothing', () => {
  const scene = createLabState('balance').scene;
  const both = lux(scene);
  scene.lamps[1].enabled = false;
  const first = lux(scene);
  scene.lamps[1].enabled = true;
  scene.lamps[0].enabled = false;
  const second = lux(scene);
  close(both, first + second);
  close(evaluateScene(scene).totalIntensity, 10);
  scene.lamps[1].intensity = 0;
  close(lux(scene), 0);
  assert.equal(evaluateScene(scene).uniformity, 0, 'darkness is not perfect uniformity');
});

test('opaque screen blocks at ray intersection height, and clearing its top restores direct light', () => {
  const scene = createLabState('shadow').scene;
  assert.equal(lux(scene), 0);
  const contribution = evaluateScene(scene).detectors[0].contributions[0];
  assert.deepEqual(contribution.blockedBy, ['screen-a']);
  assert.ok(contribution.unblockedLux > 30);
  scene.screens[0].height = 0.375;
  assert.equal(lux(scene), 0, 'the exact upper edge is opaque');
  scene.screens[0].height = 0.374;
  close(lux(scene), 120 * 0.75 / ((1.2 ** 2 + 0.75 ** 2) ** 1.5));
  assert.equal(challengeVerdict('shadow', scene).passed, true);
  scene.screens[0].height = 0.7;
  scene.lamps[0].intensity = 200;
  assert.equal(lux(scene), 0, 'more intensity cannot restore a blocked direct ray');
});

test('screens outside the ray, zero-height screens, and disabled screens do not cast this shadow', () => {
  const scene = createLabState('shadow').scene;
  const clear = evaluateScene(scene).detectors[0].contributions[0].unblockedLux;
  scene.screens[0].y1 = 2.1;
  scene.screens[0].y2 = 2.8;
  close(lux(scene), clear);
  scene.screens[0] = { ...getChallenge('shadow').scene.screens[0], enabled: false };
  close(lux(scene), clear);
  scene.screens[0].enabled = true;
  scene.screens[0].height = 0;
  close(lux(scene), clear);
});

test('screen endpoint grazing, collinear overlap and a vertical ray have defined geometric behavior', () => {
  const scene = createLabState('shadow').scene;
  scene.screens = [screen({ x1: 3, y1: 2, x2: 3, y2: 3 })];
  assert.equal(lux(scene), 0, 'screen endpoints are opaque');
  scene.screens = [screen({ x1: 2.9, y1: 2, x2: 3.3, y2: 2, height: 0.2 })];
  assert.equal(lux(scene), 0, 'collinear overlap reaches below screen height');
  scene.screens[0].height = 0.1;
  assert.ok(lux(scene) > 0);
  const overhead = createLabState().scene;
  overhead.screens = [screen()];
  assert.equal(lux(overhead), 0, 'a screen through the detector includes its foot');
  overhead.screens[0].x1 = 3.01;
  overhead.screens[0].x2 = 3.01;
  assert.ok(lux(overhead) > 0);
});

test('multiple blockers are traceable and source height is evaluated at each crossing', () => {
  const scene = createLabState('shadow').scene;
  scene.screens.push(screen({ x1: 3.3, x2: 3.3, height: 0.2 }));
  assert.deepEqual(evaluateScene(scene).detectors[0].contributions[0].blockedBy, ['screen-a', 'screen-test']);
  scene.screens[0].height = 0.2;
  assert.deepEqual(evaluateScene(scene).detectors[0].contributions[0].blockedBy, ['screen-test']);
});

test('all three challenges have witnesses and require all of their targets simultaneously', () => {
  for (const id of ['distance', 'shadow', 'balance']) assert.equal(challengeVerdict(id, createLabState(id).scene).passed, false);
  const distance = createLabState('distance').scene;
  distance.lamps[0].height = 0.4;
  assert.equal(challengeVerdict('distance', distance).passed, true);
  distance.lamps[0].intensity = 40;
  assert.equal(challengeVerdict('distance', distance).passed, false, 'distance challenge fixes intensity');
  const shadow = createLabState('shadow').scene;
  shadow.screens[0].height = 0.2;
  assert.equal(challengeVerdict('shadow', shadow).passed, true);
  const balanced = createLabState('balance').scene;
  balanced.lamps.forEach((lamp) => { lamp.intensity = 40; });
  const result = evaluateScene(balanced);
  close(result.minimumLux, 160 + 40 * 0.5 / (1.25 ** 1.5));
  close(result.uniformity, 1);
  assert.equal(challengeVerdict('balance', balanced).passed, true);
  balanced.lamps.forEach((lamp) => { lamp.intensity = 46; });
  assert.equal(challengeVerdict('balance', balanced).passed, false, 'uniform useful light still fails an exceeded budget');
  balanced.lamps.forEach((lamp) => { lamp.intensity = 1; });
  assert.equal(challengeVerdict('balance', balanced).passed, false, 'uniform darkness is not useful light');
  assert.equal(challengeVerdict('free', createLabState('free').scene).passed, false);
});

test('authored detectors cannot be moved to forge a challenge pass', () => {
  const scene = createLabState('balance').scene;
  scene.lamps.forEach((lamp) => { lamp.intensity = 40; });
  scene.detectors[0].x += 0.01;
  assert.equal(challengeVerdict('balance', scene).passed, false);
});

test('model evaluations and configurations are deterministic, immutable, and independent', () => {
  const scene = createLabState('free').scene;
  const original = structuredClone(scene);
  assert.deepEqual(evaluateScene(scene), evaluateScene(scene));
  assert.deepEqual(scene, original);
  const result = evaluateScene(scene);
  result.detectors[0].lux = 999;
  assert.notEqual(evaluateScene(scene).detectors[0].lux, 999);
  const challenge = getChallenge('free');
  challenge.scene.lamps[0].height = 3;
  assert.equal(getChallenge('free').scene.lamps[0].height, 0.8);
  assert.equal(Object.isFrozen(CHALLENGES[0].scene.lamps[0]), true);
  assert.equal(LIGHT_SOURCES.length, 4);
  assert.ok(LIGHT_SOURCES.every((source) => source.url.startsWith('https://') && source.text.length > 100));
});

test('bulk field sampling agrees with individual detector evaluations and is bounded', () => {
  const scene = createLabState('free').scene;
  const original = structuredClone(scene);
  const field = sampleField(scene, 9, 6);
  assert.equal(field.values.length, 54);
  for (let y = 0; y < field.rows; y += 1) for (let x = 0; x < field.columns; x += 1) {
    const probe = { ...scene, detectors: [{ id: 'probe', label: 'Probe', x: (x + 0.5) / field.columns * scene.width, y: (y + 0.5) / field.rows * scene.depth }] };
    close(field.values[y * field.columns + x], evaluateScene(probe).detectors[0].lux);
  }
  assert.deepEqual(scene, original);
  assert.deepEqual(sampleField(scene, 9, 6), field);
  assert.throws(() => sampleField(scene, 1, 9));
  assert.throws(() => sampleField(scene, 300, 9));
  assert.throws(() => sampleField(scene, 9.5, 9));
});

test('finite bounds, valid identity, screen length, and source counts reject invalid geometry', () => {
  const mutate = (fn) => { const scene = createLabState().scene; fn(scene); assert.throws(() => validateScene(scene)); };
  mutate((scene) => { scene.lamps[0].height = 0; });
  mutate((scene) => { scene.lamps[0].height = NaN; });
  mutate((scene) => { scene.lamps[0].intensity = Infinity; });
  mutate((scene) => { scene.lamps[0].intensity = -1; });
  mutate((scene) => { scene.lamps[0].x = 6.001; });
  mutate((scene) => { scene.lamps[0].enabled = 1; });
  mutate((scene) => { scene.detectors[0].id = scene.lamps[0].id; });
  mutate((scene) => { scene.screens = [screen({ x2: 3, y2: 1 })]; });
  mutate((scene) => { scene.lamps = []; });
  mutate((scene) => { scene.detectors = []; });
  mutate((scene) => { scene.width = 0; });
  const scene = createLabState().scene;
  scene.unknown = 'discard';
  assert.equal(validateScene(scene).unknown, undefined);
});

test('an experiment records a prediction and derived comparison with independent exact snapshots', () => {
  const before = createLabState().scene;
  const after = structuredClone(before);
  after.lamps[0].height = 0.4;
  const record = makeExperiment(before, after, metadata());
  close(record.deltaLux, 150);
  assert.equal(record.actual, 'increase');
  assert.equal(record.predictionCorrect, true);
  assert.equal(record.changedControls, 1);
  assert.match(record.explanation, /matched comparison/);
  after.lamps[0].height = 2;
  close(record.after.readings.detectors[0].lux, 200);
  assert.equal(record.after.scene.lamps[0].height, 0.4);
  assert.deepEqual(record, makeExperiment(before, record.after.scene, metadata()));
});

test('incorrect predictions, zero-effect edits, and multiple changed controls remain honest records', () => {
  const before = createLabState().scene;
  const after = structuredClone(before);
  after.lamps[0].height = 1.6;
  const incorrect = makeExperiment(before, after, metadata());
  assert.equal(incorrect.actual, 'decrease');
  assert.equal(incorrect.predictionCorrect, false);
  const noChange = makeExperiment(before, before, metadata({ prediction: 'same' }));
  assert.equal(noChange.actual, 'same');
  assert.equal(noChange.changedControls, 0);
  after.lamps[0].intensity = 100;
  const many = makeExperiment(before, after, metadata());
  assert.equal(many.changedControls, 2);
  assert.match(many.explanation, /does not isolate a single cause/);
  after.detectors[0].x += 0.1;
  assert.throws(() => makeExperiment(before, after, metadata()), /same fixed detector/);
  assert.throws(() => makeExperiment(before, before, metadata({ prediction: 'correct' })));
});

test('a rigid screen translation records one control instead of treating its two endpoint fields as two interventions', () => {
  const before = createLabState('shadow').scene;
  const after = structuredClone(before);
  after.screens[0].x1 = 4;
  after.screens[0].x2 = 4;
  const record = makeExperiment(before, after, metadata({ challengeId: 'shadow' }));
  assert.equal(record.changedControls, 1);
  assert.equal(record.actual, 'increase');
  assert.match(record.explanation, /matched comparison/);
});

test('saved experiments are re-evaluated, forged metrics and duplicate IDs are rejected', () => {
  const state = createLabState();
  const before = structuredClone(state.scene);
  state.scene.lamps[0].height = 0.4;
  state.experiments.push(makeExperiment(before, state.scene, metadata()));
  const validated = validateLabState(state);
  assert.deepEqual(validated, state);
  state.scene.lamps[0].height = 0.8;
  assert.equal(validated.scene.lamps[0].height, 0.4);
  const forged = structuredClone(validated);
  forged.experiments[0].after.readings.detectors[0].lux = 900;
  assert.throws(() => validateLabState(forged), /scene evidence/);
  const wrongActual = structuredClone(validated);
  wrongActual.experiments[0].actual = 'same';
  assert.throws(() => validateLabState(wrongActual), /scene evidence/);
  const duplicate = structuredClone(validated);
  duplicate.experiments.push(structuredClone(duplicate.experiments[0]));
  assert.throws(() => validateLabState(duplicate), /unique/);
  const missingId = structuredClone(validated);
  delete missingId.experiments[0].id;
  assert.throws(() => validateLabState(missingId), /id/);
  const missingDate = structuredClone(validated);
  delete missingDate.experiments[0].createdAt;
  assert.throws(() => validateLabState(missingDate), /createdAt/);
  const missingChallenge = structuredClone(validated);
  delete missingChallenge.experiments[0].challengeId;
  assert.throws(() => validateLabState(missingChallenge), /challenge/);
});

test('optional experiments default empty and archived experiment count and timestamps are bounded', () => {
  const state = createLabState();
  delete state.experiments;
  assert.deepEqual(validateLabState(state).experiments, []);
  state.experiments = Array(101).fill({});
  assert.throws(() => validateLabState(state));
  assert.throws(() => makeExperiment(state.scene, state.scene, metadata({ createdAt: 'yesterday' })));
  assert.throws(() => validateLabState({ ...createLabState(), version: 2 }));
  assert.throws(() => createLabState('made-up'));
  const longNote = makeExperiment(state.scene, state.scene, metadata({ note: 'x'.repeat(4000) }));
  assert.equal(longNote.note.length, 4000);
  assert.throws(() => makeExperiment(state.scene, state.scene, metadata({ note: 'x'.repeat(4001) })));
});

test('hypotheses and conclusions stay separate, while legacy records default to an empty hypothesis and no pending prediction', () => {
  const state = createLabState();
  const before = structuredClone(state.scene);
  state.scene.lamps[0].height = 0.4;
  const hypothesis = 'At half height I predict four times the reading.\nI will keep intensity fixed.';
  const note = 'The measured ratio was four. Next I will test an off-axis detector.';
  state.experiments.push(makeExperiment(before, state.scene, metadata({ hypothesis, note })));
  const clean = validateLabState(state);
  assert.equal(clean.experiments[0].hypothesis, hypothesis);
  assert.equal(clean.experiments[0].note, note);
  assert.equal(clean.pending, null);
  const legacy = structuredClone(state);
  delete legacy.pending;
  delete legacy.experiments[0].hypothesis;
  const migrated = validateLabState(legacy);
  assert.equal(migrated.pending, null);
  assert.equal(migrated.experiments[0].hypothesis, '');
  assert.equal(migrated.experiments[0].note, note);
  assert.throws(() => makeExperiment(before, state.scene, metadata({ hypothesis: 'x'.repeat(4001) })));
});

test('a committed prediction retains its original scene and hypothesis across serialisation and validates without invented measurements', () => {
  const state = createLabState('shadow');
  state.pending = { beforeScene: structuredClone(state.scene), challengeId: 'shadow', detectorId: 'detector-a', prediction: 'increase', hypothesis: 'Lower the screen so the ray clears its top.', committedAt: '2026-10-11T12:00:00.000Z' };
  state.scene.screens[0].height = 0.2;
  const resumed = validateLabState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(resumed, state);
  assert.equal(resumed.pending.beforeScene.screens[0].height, 0.7);
  assert.equal(resumed.scene.screens[0].height, 0.2);
  assert.deepEqual(resumed.experiments, []);
  assert.equal(resumed.pending.readings, undefined);
  const record = makeExperiment(resumed.pending.beforeScene, resumed.scene, { ...metadata({ challengeId: 'shadow' }), hypothesis: resumed.pending.hypothesis, prediction: resumed.pending.prediction, detectorId: resumed.pending.detectorId });
  assert.equal(record.actual, 'increase');
  assert.equal(record.hypothesis, state.pending.hypothesis);
  resumed.pending.beforeScene.screens[0].height = 0;
  assert.equal(state.pending.beforeScene.screens[0].height, 0.7);
});

test('pending predictions reject invalid identities, detectors, geometry, predictions, dates and oversized text', () => {
  const state = createLabState();
  state.pending = { beforeScene: structuredClone(state.scene), challengeId: 'distance', detectorId: 'detector-a', prediction: 'increase', hypothesis: 'Lower height.', committedAt: '2026-10-11T12:00:00.000Z' };
  for (const mutate of [
    (pending) => { pending.challengeId = 'shadow'; },
    (pending) => { pending.detectorId = 'missing'; },
    (pending) => { pending.prediction = 'correct'; },
    (pending) => { pending.committedAt = '2026-02-30T12:00:00.000Z'; },
    (pending) => { pending.hypothesis = 'x'.repeat(4001); },
    (pending) => { pending.hypothesis = 1; },
    (pending) => { pending.beforeScene.lamps[0].height = 0; },
    (pending) => { pending.beforeScene.detectors[0].x = 2.9; },
  ]) {
    const invalid = structuredClone(state);
    mutate(invalid.pending);
    assert.throws(() => validateLabState(invalid));
  }
  const invalid = structuredClone(state);
  invalid.pending = [];
  assert.throws(() => validateLabState(invalid));
  state.pending.fakeReadings = { lux: 999 };
  assert.equal(validateLabState(state).pending.fakeReadings, undefined);
});
