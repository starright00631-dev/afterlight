import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudy, saveAlternative, updateScene, commitExperiment, runExperiment, finalizeExperiment, chooseAlternative, validateStudy, studyReportText } from '../studies.js';
import { presentStudyTitle, resolveStudioComparison, resolveStudioView, studioWorkflowState } from '../studio-view-state.js';

function retainedPair() {
  const study = createStudy({ projectId: 'project-ui', example: false });
  const a = saveAlternative(study, 'Desk by the window');
  const next = structuredClone(study.scene); next.lamps[0].intensity = 40;
  updateScene(study, next);
  const b = saveAlternative(study, 'Lower intensity');
  return { study, a, b };
}

test('Reading Room is only a presentation of the exact default example title', () => {
  const study = createStudy({ projectId: 'project-ui' });
  assert.equal(presentStudyTitle(study), 'The Reading Room');
  assert.equal(study.title, 'Example · A shared table');
  assert.match(studyReportText(study), /Example · A shared table/);
  study.title = 'Example · My own room';
  assert.equal(presentStudyTitle(study), 'Example · My own room');
  study.title = 'A shared table';
  assert.equal(presentStudyTitle(study), 'A shared table');
  assert.equal(presentStudyTitle(createStudy({ projectId: 'project-ui', template: 'distance' })), createStudy({ projectId: 'project-ui', template: 'distance' }).title);
});

test('difference uses retained B scene and remains separate from the working layout', () => {
  const { study, a, b } = retainedPair();
  const changed = structuredClone(study.scene); changed.lamps[0].height = 0.7;
  updateScene(study, changed);
  const before = structuredClone(study);
  const view = resolveStudioView(study, { mode: 'difference', aId: a.id, bId: b.id });
  assert.strictEqual(view.scene, b.scene);
  assert.strictEqual(view.comparison.aScene, a.scene);
  assert.strictEqual(view.comparison.bScene, b.scene);
  assert.equal(view.readOnly, true);
  assert.equal(view.proposed, false);
  assert.deepEqual(study, before);
  assert.strictEqual(resolveStudioView(study).scene, study.scene);
  assert.equal(study.scene.lamps[0].height, 0.7);
});

test('difference requires two distinct retained alternatives', () => {
  const { study, a } = retainedPair();
  const same = resolveStudioComparison(study, a.id, a.id);
  assert.equal(same.available, false);
  assert.equal(same.result, null);
  assert.match(same.reason, /two different/);
  assert.equal(resolveStudioView(study, { mode: 'difference', aId: a.id, bId: a.id }).comparison, undefined);
  assert.equal(resolveStudioComparison(createStudy({ projectId: 'project-ui' })).available, false);
});

test('difference rejects changed measurement geometry with a visible reason', () => {
  const { study, a } = retainedPair();
  const changed = structuredClone(study.scene); changed.detectors[1].x = 1.7;
  updateScene(study, changed); const c = saveAlternative(study, 'Different sample point');
  const compared = resolveStudioComparison(study, a.id, c.id);
  assert.equal(compared.available, false);
  assert.equal(compared.result.matched, false);
  assert.match(compared.reason, /Different measurement setups/);
  assert.equal(resolveStudioView(study, { mode: 'difference', aId: a.id, bId: c.id }).comparison, undefined);
});

test('pending predictions disable differences and cover only proposed working readings', () => {
  const { study, a, b } = retainedPair();
  commitExperiment(study, { detectorId: 'point-a', prediction: 'decrease', hypothesis: 'A taller lamp should lower the direct overhead reading.' });
  const changed = structuredClone(study.scene); changed.lamps[0].height = 0.7; updateScene(study, changed);
  assert.equal(resolveStudioComparison(study, a.id, b.id).available, false);
  const proposed = resolveStudioView(study, { mode: 'difference', aId: a.id, bId: b.id });
  assert.equal(proposed.comparison, undefined);
  assert.equal(proposed.proposed, true);
  const baseline = resolveStudioView(study, { pendingView: 'baseline' });
  assert.strictEqual(baseline.scene, study.pending.beforeScene);
  assert.equal(baseline.readOnly, true);
  assert.equal(baseline.proposed, false);
  const saved = resolveStudioView(study, { optionId: a.id });
  assert.strictEqual(saved.scene, a.scene);
  assert.equal(saved.proposed, false);
  assert.equal(studioWorkflowState(study).canCompare, false);
  assert.equal(studioWorkflowState(study).canChoose, false);
});

test('workflow derives retained progress without inventing experiments or decisions', () => {
  const study = createStudy({ projectId: 'project-ui' });
  const before = structuredClone(study);
  const empty = studioWorkflowState(study);
  assert.equal(empty.current, 'arrange');
  assert.equal(empty.compare, '0 of 2 arrangements');
  assert.equal(empty.canChoose, false);
  assert.deepEqual(study, before);
  const { study: saved, a, b } = retainedPair();
  assert.equal(studioWorkflowState(saved, { mode: 'difference' }).current, 'compare');
  assert.equal(studioWorkflowState(saved).canChoose, true);
  chooseAlternative(saved, a.id, b.id, b.id, 'The calculated reading is lower.', 'Check with a real meter.');
  assert.equal(studioWorkflowState(saved, { activeStep: 'choose' }).choose, 'Decision retained');
});

test('workflow choice availability follows the selected pair among three retained arrangements', () => {
  const { study, a, b } = retainedPair();
  const changed = structuredClone(study.scene); changed.detectors[1].x = 1.7;
  updateScene(study, changed); const c = saveAlternative(study, 'Changed measurement geometry');
  const before = structuredClone(study);
  assert.equal(studioWorkflowState(study).canChoose, false);
  assert.equal(studioWorkflowState(study, { aId: a.id, bId: b.id }).canChoose, true);
  assert.equal(studioWorkflowState(study, { aId: a.id, bId: c.id }).canChoose, false);
  assert.equal(studioWorkflowState(study, { aId: b.id, bId: b.id }).canChoose, false);
  assert.deepEqual(study, before);
  commitExperiment(study, { detectorId: 'point-a', prediction: 'decrease', hypothesis: 'A taller lamp should lower its overhead reading.' });
  const pending = structuredClone(study.pending);
  assert.equal(studioWorkflowState(study, { aId: a.id, bId: b.id }).canChoose, false);
  assert.deepEqual(study.pending, pending);
});

test('staged conclusion stays retained through view switches and reload until finalized', () => {
  const { study, a, b } = retainedPair();
  commitExperiment(study, { detectorId: 'point-a', prediction: 'decrease', hypothesis: 'Raising the lamp should lower its overhead reading.' });
  const next = structuredClone(study.scene); next.lamps[0].height = 0.7; updateScene(study, next); runExperiment(study);
  study.staged.conclusion = 'The reading decreased. I would check ambient light next.';
  const loaded = validateStudy(JSON.parse(JSON.stringify(study)));
  const stageId = loaded.staged.id;
  resolveStudioView(loaded, { mode: 'difference', aId: a.id, bId: b.id });
  assert.equal(loaded.staged.id, stageId);
  assert.equal(loaded.staged.conclusion, study.staged.conclusion);
  assert.equal(loaded.experiments.length, 0);
  assert.equal(studioWorkflowState(loaded).current, 'predict');
  assert.equal(studioWorkflowState(loaded).canChoose, false);
  finalizeExperiment(loaded, loaded.staged.conclusion, stageId);
  assert.equal(loaded.experiments.length, 1);
  assert.equal(loaded.staged, null);
});
