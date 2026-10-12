import {sampleField, OPTICS_MODEL_VERSION} from './optics.js';
import {geometryMatches} from './studies.js';

/** Signed B minus A at the same horizontal sample locations; artwork is never an input. */
export function calculateDifferenceField(aScene, bScene, columns = 112, rows = 64) {
  if (!geometryMatches(aScene, bScene)) throw new RangeError('Difference fields need the same surface and measurement points.');
  const a = sampleField(aScene, columns, rows), b = sampleField(bScene, columns, rows);
  const values = a.values.map((value, index) => b.values[index] - value);
  let minDelta = 0, maxDelta = 0;
  for (const delta of values) { minDelta = Math.min(minDelta, delta); maxDelta = Math.max(maxDelta, delta); }
  return {modelVersion: OPTICS_MODEL_VERSION, unit: 'lx', columns: a.columns, rows: a.rows,
    width: bScene.width, depth: bScene.depth, values, minDelta, maxDelta,
    maxMagnitude: Math.max(-minDelta, maxDelta)};
}
