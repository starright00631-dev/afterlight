import test from 'node:test';
import assert from 'node:assert/strict';
import {createSurfaceResizeEditor, resizedSurfaceScene} from '../studio-ui.js';
import {createStudy, updateScene, saveAlternative, validateStudy, commitExperiment} from '../studies.js';
import {evaluateScene} from '../optics.js';

function editorFor(study, commit = null) {
  const committed = [];
  const editor = createSurfaceResizeEditor({
    readScene: () => study.scene,
    commitScene(scene) {
      committed.push(structuredClone(scene));
      if (commit) return commit(scene);
      updateScene(study, scene); return true;
    }
  });
  return {editor, committed};
}

test('typing a table width through the out-of-bounds prefix 1 to 12 never interrupts the draft or changes the live model', () => {
  const study = createStudy({projectId: 'resize-project'}), original = structuredClone(study);
  const {editor, committed} = editorFor(study);
  editor.edit('width', ''); editor.edit('width', '1');
  assert.equal(editor.values().width, '1');
  assert.equal(editor.feedback, '');
  assert.deepEqual(study, original, 'an intermediate prefix is not a resize transaction');
  editor.edit('width', '12');
  assert.equal(editor.values().width, '12');
  assert.equal(committed.length, 0);
  assert.equal(editor.apply(), true);
  assert.equal(committed.length, 1);
  assert.equal(study.scene.width, 12);
  assert.equal(study.geometryRevision, original.geometryRevision + 1);
  assert.deepEqual(study.scene.lamps, original.scene.lamps);
  assert.deepEqual(study.scene.detectors, original.scene.detectors);
});

test('both dimensions apply atomically with exact fractional metres while retained evidence and point readings stay intact', () => {
  const study = createStudy({projectId: 'resize-project'}), original = structuredClone(study.scene);
  const before = evaluateScene(original), retained = structuredClone(saveAlternative(study, 'Original size'));
  const {editor, committed} = editorFor(study);
  editor.edit('width', '2.345'); editor.edit('depth', '1.235');
  assert.deepEqual(study.scene, original);
  assert.equal(editor.apply(), true);
  assert.equal(committed.length, 1);
  assert.deepEqual([study.scene.width, study.scene.depth], [2.345, 1.235]);
  assert.deepEqual(evaluateScene(study.scene), before, 'dimensions do not secretly move lamps or sample points');
  assert.deepEqual(study.alternatives[0], retained);
  assert.deepEqual(validateStudy(JSON.parse(JSON.stringify(study))).scene, study.scene);
});

test('a shrink outside a measurement point is rejected with a named location and preserves the draft for correction', () => {
  const study = createStudy({projectId: 'resize-project'}), original = structuredClone(study);
  const {editor, committed} = editorFor(study);
  editor.edit('width', '1.5'); editor.edit('depth', '1');
  assert.equal(editor.apply(), false);
  assert.match(editor.feedback, /Point B · Workspace B at \(1.6, 0.6\) m/);
  assert.match(editor.feedback, /positions have not changed/);
  assert.deepEqual(editor.values(), {width: '1.5', depth: '1'});
  assert.deepEqual(study, original);
  assert.equal(committed.length, 0);
  editor.edit('width', '1.6');
  assert.equal(editor.apply(), true, 'a point exactly on the new edge is permitted');
  assert.equal(study.scene.width, 1.6);
});

test('disabled lamps and both screen endpoints remain explicit geometry, with no hidden clamping or removal during a shrink', () => {
  const study = createStudy({projectId: 'resize-project'});
  const scene = structuredClone(study.scene);
  scene.lamps.push({id: 'lamp-b', x: 2.2, y: 1.1, height: .5, intensity: 0, enabled: false});
  scene.screens.push({id: 'screen-a', x1: .2, y1: 1, x2: 2.1, y2: 1.1, height: .4, enabled: false});
  updateScene(study, scene);
  const original = structuredClone(study), {editor, committed} = editorFor(study);
  editor.edit('width', '2'); editor.edit('depth', '.9');
  assert.equal(editor.apply(), false);
  for (const name of ['Lamp 2', 'Screen 1 start', 'Screen 1 end']) assert.ok(editor.feedback.includes(name));
  assert.equal(committed.length, 0); assert.deepEqual(study, original);
  editor.edit('width', '2.2'); editor.edit('depth', '1.1');
  assert.equal(editor.apply(), true);
  assert.deepEqual(study.scene.lamps, original.scene.lamps);
  assert.deepEqual(study.scene.screens, original.scene.screens);
});

test('empty, malformed and out-of-range size drafts never persist and cancel restores the saved dimensions', () => {
  const study = createStudy({projectId: 'resize-project'}), original = structuredClone(study);
  const {editor, committed} = editorFor(study);
  for (const raw of ['', ' ', '1e', 'Infinity', '0.29', '12.01']) {
    editor.edit('width', raw);
    assert.equal(editor.apply(), false, `${raw} is not a valid physical width`);
    assert.equal(editor.status, 'error'); assert.ok(editor.feedback);
    assert.deepEqual(study, original);
  }
  assert.equal(committed.length, 0);
  editor.reset();
  assert.deepEqual(editor.values(), {width: '2.4', depth: '1.2'});
  assert.equal(editor.feedback, '');
  assert.equal(editor.apply(), true); assert.equal(committed.length, 0, 'applying unchanged dimensions does not create a revision');
});

test('a failed save keeps the previous scene and editable resize draft available', () => {
  const study = createStudy({projectId: 'resize-project'}), original = structuredClone(study);
  const {editor} = editorFor(study, () => false);
  editor.edit('width', '3'); editor.edit('depth', '1.5');
  assert.equal(editor.apply(), false);
  assert.deepEqual(study, original);
  assert.deepEqual(editor.values(), {width: '3', depth: '1.5'});
  assert.match(editor.feedback, /could not be saved/);
});

test('the study model rejects a resized measurement setup during a committed prediction without altering its baseline', () => {
  const study = createStudy({projectId: 'resize-project'});
  commitExperiment(study, {detectorId: 'point-a', prediction: 'same', hypothesis: 'The original point and lamp stay fixed.'});
  const original = structuredClone(study);
  assert.throws(() => updateScene(study, resizedSurfaceScene(study.scene, 3, 2)), /Cancel the committed prediction/);
  assert.deepEqual(study, original);
});
