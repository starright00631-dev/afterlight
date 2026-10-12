import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudy} from '../studies.js';
import {calculateDifferenceField} from '../field-difference.js';

const scene = () => createStudy({projectId: 'project-field'}).scene;
test('field differences retain signed lux, reverse symmetrically and expose neutral zeros', () => {
  const a = scene(), b = structuredClone(a); b.lamps[0].intensity = 40;
  const forward = calculateDifferenceField(a,b,9,5), reverse = calculateDifferenceField(b,a,9,5);
  assert.equal(forward.unit, 'lx'); assert.equal(forward.values.length, 45);
  assert.ok(forward.values.every(delta => delta < 0));
  forward.values.forEach((value,index) => assert.ok(Math.abs(value+reverse.values[index]) < 1e-10));
  assert.equal(forward.maxMagnitude, reverse.maxMagnitude);
  const zero = calculateDifferenceField(a,a,9,5);assert.equal(zero.maxMagnitude,0);
  assert.ok(zero.values.every(value => value===0 && Number.isFinite(value)));
});
test('an overhead sample obeys the inverse-square delta and unmatched setups are refused', () => {
  const a = scene();a.width=2;a.depth=2;a.detectors=[{id:'a',label:'A',x:.5,y:1},{id:'b',label:'B',x:1.5,y:1}];
  a.lamps[0]={...a.lamps[0],x:1,y:1,height:.5,intensity:40};
  const b=structuredClone(a);b.lamps[0].height=1;
  // The middle cell is directly under the lamp: 40/1² - 40/0.5² = -120 lx.
  const field=calculateDifferenceField(a,b,3,3);assert.ok(Math.abs(field.values[4]+120)<1e-9);
  assert.throws(()=>calculateDifferenceField(a,b,1,1),/Field dimensions/);
  const moved=structuredClone(b);moved.detectors[0].x=.6;
  assert.throws(()=>calculateDifferenceField(a,moved),/same surface/);
  moved.detectors[0].x=.5;moved.detectors[0].id='different-point';
  assert.throws(()=>calculateDifferenceField(a,moved),/same surface/);
});
