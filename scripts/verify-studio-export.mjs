import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {validateState} from '../persistence.js';
import {validateStudy, studyCSV, studyReportHTML} from '../studies.js';

// Reconcile the actual browser-produced release fixture, rather than constructing a replacement.
const directory = new URL('../qa/', import.meta.url);
const read = name => readFile(new URL(name, directory), 'utf8');
const workspace = JSON.parse(await read('workspace-export.json'));
const state = validateState(workspace.state);
const envelope = JSON.parse(await read('studio-study.json'));
assert.equal(envelope.format, 'afterlight-study');
assert.equal(envelope.version, 1);
const study = validateStudy(envelope.study);
assert.deepEqual(state.studio.studies.find(item => item.id === study.id), study);
assert.equal(await read('studio-readings.csv'), studyCSV(study));
assert.equal(await read('studio-report.html'), studyReportHTML(study, {sources: state.sources}));
const chosen = study.alternatives.find(item => item.id === study.decision.chosenId);
assert.equal(chosen.name, 'Option C · equal lamps');
for (const point of chosen.readings.detectors) assert.ok(Math.abs(point.lux - 183.82017707879461) < 1e-9);
const copy = study.alternatives.find(item => item.name === 'Option D · edited copy');
assert.equal(copy.parentId, chosen.id);
assert.equal(chosen.scene.lamps[0].height, 0.5);
assert.equal(copy.scene.lamps[0].height, 0.55);
assert.equal(study.experiments.length, 2);
assert.equal(study.decision.experimentIds.length, 2);
assert.equal(study.decision.sourceRefs.length, 1);
assert.equal(study.observations.length, 1);
assert.match(study.observations[0].context, /not a measured room reading/);
const action = state.actions.find(item => item.studyId === study.id);
assert.equal(action.minutes, 20);
assert.equal(action.projectId, study.projectId);
assert.ok(!/"(?:apiKey|password|accessToken|authorization)"\s*:/i.test(JSON.stringify(workspace)));
console.log(JSON.stringify({release: JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version, fixture: fileURLToPath(directory),
  comparison: chosen.readings.detectors.map(point => ({point: point.id, calculatedLux: point.lux})),
  branchParent: copy.parentId, retainedExperiments: study.experiments.length,
  explicitlyEstimatedCheckMinutes: action.minutes, syntheticObservations: study.observations.length,
  reportAndCSV: 'byte-for-byte matched', workspaceAndStudy: 'all fields matched'}, null, 2));
