import {sampleField, evaluateScene, OPTICS_MODEL_VERSION} from './optics.js';
import {geometryMatches} from './studies.js';

/** Signed B minus A at the same horizontal sample locations; artwork is never an input.
 * minDelta/maxDelta retain the grid extrema and neutral zero anchor. The symmetric
 * maxMagnitude also covers exact named-point readings, which can fall between cells. */
export function calculateDifferenceField(aScene, bScene, columns = 112, rows = 64) {
  if (!geometryMatches(aScene, bScene)) throw new RangeError('Difference fields need the same surface and measurement points.');
  const a = sampleField(aScene, columns, rows), b = sampleField(bScene, columns, rows);
  const values = a.values.map((value, index) => b.values[index] - value);
  let minDelta = 0, maxDelta = 0;
  for (const delta of values) { minDelta = Math.min(minDelta, delta); maxDelta = Math.max(maxDelta, delta); }
  const aPoints = evaluateScene(aScene).detectors;
  const bPoints = new Map(evaluateScene(bScene).detectors.map(point => [point.id, point.lux]));
  let maxMagnitude = Math.max(-minDelta, maxDelta);
  for (const point of aPoints) maxMagnitude = Math.max(maxMagnitude, Math.abs(bPoints.get(point.id) - point.lux));
  return {modelVersion: OPTICS_MODEL_VERSION, unit: 'lx', columns: a.columns, rows: a.rows,
    width: bScene.width, depth: bScene.depth, values, minDelta, maxDelta,
    maxMagnitude};
}
