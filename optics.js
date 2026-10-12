/**
 * Ideal point-source photometry on a horizontal plane, in metres / candela / lux.
 * E = I cos(theta) / r^2 = I h / (dx^2 + dy^2 + h^2)^(3/2).
 * Opaque zero-thickness vertical screens stop a direct ray. There is no ambient
 * light, reflection, diffraction, spectral variation, or finite emitter size.
 * This is a learning model, not a lighting-compliance calculation.
 */
export const OPTICS_MODEL_VERSION = 'point-light-1';
export const MODEL_LIMITS = Object.freeze({ width: 6, depth: 4, minimumHeight: 0.2, maximumHeight: 3, maximumIntensity: 200, maximumExperiments: 100 });

const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const clone = (value) => structuredClone(value);
const EPSILON = 1e-10;

/** Original teaching prose; URLs point to the underlying photometric definitions. */
export const LIGHT_SOURCES = freeze([
  { id: 'point-source', title: 'Distance and the point-source model', url: 'https://ies.org/definitions/inverse-square-law/', publisher: 'Illuminating Engineering Society', text: 'An ideal point lamp sends light outward. On a surface facing the lamp directly, illuminance is intensity divided by distance squared: E = I / r². Keeping intensity fixed and halving the distance gives four times the illuminance. Real lamps have size and direction-dependent output, so this idealisation is most useful when the source is small relative to its distance.' },
  { id: 'incidence', title: 'Why position and angle both matter', url: 'https://www.ies.org/definitions/cosine-law/', publisher: 'Illuminating Engineering Society', text: 'A horizontal detector receives less illuminance when light arrives at a slant. The incidence angle is measured from the surface normal. Combining distance and angle gives E = I cos(θ) / r². In this lab cos(θ) = h/r, so a lamp contributes I h / r³. Direct contributions from independent lamps add; blocked contributions are zero.' },
  { id: 'units', title: 'Intensity is not electrical power', url: 'https://www.nist.gov/pml/sensor-science/optical-radiation/realization-candela', publisher: 'National Institute of Standards and Technology', text: 'Candela describes luminous intensity in a direction. Lux describes illuminance arriving at a surface. This lab uses candela for each ideal isotropic point lamp and lux for the horizontal detectors. Adding the lamps’ intensity settings creates a puzzle budget; it does not measure watts, electricity use, perceived comfort, or compliance with a lighting standard.' },
  { id: 'shadow', title: 'Trace the path before increasing the lamp', url: 'https://openstax.org/books/university-physics-volume-3/pages/1-1-the-propagation-of-light', publisher: 'OpenStax, University Physics Volume 3', text: 'Geometric optics traces straight light paths in a uniform medium. Our opaque screen occupies a vertical segment from the desk to its stated height. A direct path is blocked when it meets that segment at or below the screen top. Raising intensity cannot restore a completely blocked direct path. Real scenes can receive scattered or reflected light, which this deliberately simple model excludes.' }
]);

const lamp = (id, x, y, height, intensity) => ({ id, x, y, height, intensity, enabled: true });
const detector = (id, label, x, y) => ({ id, label, x, y });
const scene = (lamps, detectors, screens = []) => ({ width: 6, depth: 4, lamps, detectors, screens });

export const CHALLENGES = freeze([
  {
    id: 'distance', title: 'Bring the light closer', subtitle: 'Distance',
    instruction: 'Keep the 32 cd lamp directly above the centre detector. Change its height to reach 180–220 lx.',
    knowledge: 'Directly underneath a point lamp, E = I / h². Predict the effect of a height change before measuring.',
    sourceIds: ['point-source', 'units'],
    editable: { lamps: ['height'], screens: [] },
    scene: scene([lamp('lamp-a', 3, 2, 0.8, 32)], [detector('detector-a', 'Centre', 3, 2)])
  },
  {
    id: 'shadow', title: 'Recover the hidden reading', subtitle: 'Shadow',
    instruction: 'Keep the 120 cd lamp at its original position and height. Adjust the screen until the far detector receives at least 30 lx.',
    knowledge: 'A screen blocks the direct path only where that path crosses below its top. Increasing intensity does not fix a blocked path.',
    sourceIds: ['shadow', 'incidence'],
    editable: { lamps: [], screens: ['height', 'x1', 'y1', 'x2', 'y2'] },
    scene: scene([lamp('lamp-a', 2.4, 2, 0.75, 120)], [detector('detector-a', 'Far side', 3.6, 2)], [{ id: 'screen-a', x1: 3, y1: 1.4, x2: 3, y2: 2.6, height: 0.7, enabled: true }])
  },
  {
    id: 'balance', title: 'Make both places useful', subtitle: 'Balance',
    instruction: 'Light both fixed work areas to 150–200 lx, with at least 90% minimum-to-maximum uniformity and no more than 90 cd total enabled intensity.',
    knowledge: 'Contributions add. Placement and redistribution can improve a dim area without simply increasing every lamp.',
    sourceIds: ['incidence', 'units'],
    editable: { lamps: ['x', 'y', 'height', 'intensity', 'enabled'], screens: [] },
    scene: scene([lamp('lamp-a', 2.5, 2, 0.5, 60), lamp('lamp-b', 3.5, 2, 0.5, 10)], [detector('detector-a', 'Left workspace', 2.5, 2), detector('detector-b', 'Right workspace', 3.5, 2)])
  },
  {
    id: 'free', title: 'Your light study', subtitle: 'Open lab',
    instruction: 'Move lamps, change their intensity and height, and trace shadows. Predict a detector’s change before running an experiment.',
    knowledge: 'Use a matched comparison to test one explanation. Moving a lamp changes both distance and incidence angle; closer is not always brighter on a horizontal surface.',
    sourceIds: ['point-source', 'incidence', 'shadow', 'units'],
    editable: { lamps: ['x', 'y', 'height', 'intensity', 'enabled'], screens: ['height', 'x1', 'y1', 'x2', 'y2', 'enabled'] },
    scene: scene([lamp('lamp-a', 2.5, 2, 0.8, 80), lamp('lamp-b', 4, 2.5, 1.2, 60)], [detector('detector-a', 'Workspace A', 2.5, 2), detector('detector-b', 'Workspace B', 3.5, 2)], [{ id: 'screen-a', x1: 3.1, y1: 1.3, x2: 3.1, y2: 2.8, height: 0.4, enabled: true }])
  }
]);

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
  return value;
}
function number(value, min, max, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new RangeError(`${name} must be a finite number from ${min} to ${max}.`);
  return value;
}
function text(value, max, name, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new TypeError(`${name} is invalid.`);
  return value;
}
function identity(value, name) {
  text(value, 100, name);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError(`${name} must be a simple identifier.`);
  return value;
}
function boolean(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
  return value;
}
function list(value, min, max, name) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new RangeError(`${name} must contain ${min} to ${max} items.`);
  return value;
}
function iso(value) {
  text(value, 30, 'createdAt');
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new TypeError('createdAt must be a canonical ISO timestamp.');
  return value;
}

export function getChallenge(id) {
  const challenge = CHALLENGES.find((item) => item.id === id);
  if (!challenge) throw new RangeError('Unknown light challenge.');
  return clone(challenge);
}

/** Clean clone with bounded, finite geometry. Lamp height is strictly positive. */
export function validateScene(input) {
  object(input, 'scene');
  const width = number(input.width, 0.3, 12, 'width');
  const depth = number(input.depth, 0.3, 12, 'depth');
  const ids = new Set();
  const id = (value, name) => {
    identity(value, name);
    if (ids.has(value)) throw new TypeError('Scene identifiers must be unique.');
    ids.add(value);
    return value;
  };
  const coordinate = (value, axis, name) => number(value, 0, axis === 'x' ? width : depth, name);
  const lamps = list(input.lamps, 1, 2, 'lamps').map((item) => {
    object(item, 'lamp');
    return { id: id(item.id, 'lamp id'), x: coordinate(item.x, 'x', 'lamp x'), y: coordinate(item.y, 'y', 'lamp y'), height: number(item.height, 0.2, 3, 'lamp height'), intensity: number(item.intensity, 0, 200, 'lamp intensity'), enabled: boolean(item.enabled, 'lamp enabled') };
  });
  const detectors = list(input.detectors, 1, 4, 'detectors').map((item) => {
    object(item, 'detector');
    return { id: id(item.id, 'detector id'), label: text(item.label, 80, 'detector label'), x: coordinate(item.x, 'x', 'detector x'), y: coordinate(item.y, 'y', 'detector y') };
  });
  const screens = list(input.screens ?? [], 0, 3, 'screens').map((item) => {
    object(item, 'screen');
    const result = { id: id(item.id, 'screen id'), x1: coordinate(item.x1, 'x', 'screen x1'), y1: coordinate(item.y1, 'y', 'screen y1'), x2: coordinate(item.x2, 'x', 'screen x2'), y2: coordinate(item.y2, 'y', 'screen y2'), height: number(item.height, 0, 3, 'screen height'), enabled: boolean(item.enabled, 'screen enabled') };
    if (Math.hypot(result.x2 - result.x1, result.y2 - result.y1) < 0.01) throw new RangeError('A screen must have at least 0.01 metres of length.');
    return result;
  });
  return { width, depth, lamps, detectors, screens };
}

const cross = (ax, ay, bx, by) => ax * by - ay * bx;

/**
 * Closed screen edges count as opaque, including detector/source contact.
 * In the collinear case the lowest point on the overlapping ray is decisive.
 */
function screenBlocks(source, target, screen) {
  if (!screen.enabled || screen.height === 0) return false;
  const rx = target.x - source.x;
  const ry = target.y - source.y;
  const sx = screen.x2 - screen.x1;
  const sy = screen.y2 - screen.y1;
  const qx = screen.x1 - source.x;
  const qy = screen.y1 - source.y;
  const rayLengthSquared = rx * rx + ry * ry;
  const denominator = cross(rx, ry, sx, sy);
  let t;
  if (rayLengthSquared < EPSILON * EPSILON) {
    // The ray is vertical. A screen through this point contains its foot.
    const screenLengthSquared = sx * sx + sy * sy;
    const u = ((source.x - screen.x1) * sx + (source.y - screen.y1) * sy) / screenLengthSquared;
    return u >= -EPSILON && u <= 1 + EPSILON && Math.abs(cross(source.x - screen.x1, source.y - screen.y1, sx, sy)) <= EPSILON;
  }
  if (Math.abs(denominator) <= EPSILON) {
    if (Math.abs(cross(qx, qy, rx, ry)) > EPSILON) return false;
    const t1 = (qx * rx + qy * ry) / rayLengthSquared;
    const t2 = ((screen.x2 - source.x) * rx + (screen.y2 - source.y) * ry) / rayLengthSquared;
    const lower = Math.max(0, Math.min(t1, t2));
    const upper = Math.min(1, Math.max(t1, t2));
    if (lower > upper + EPSILON) return false;
    t = upper;
  } else {
    t = cross(qx, qy, sx, sy) / denominator;
    const u = cross(qx, qy, rx, ry) / denominator;
    if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return false;
  }
  const rayHeight = source.height * (1 - Math.max(0, Math.min(1, t)));
  return rayHeight <= screen.height + EPSILON;
}

/** Evaluation never rounds; presentation may format the returned values. */
export function evaluateScene(input) {
  const scene = validateScene(input);
  const detectors = scene.detectors.map((detector) => {
    const contributions = scene.lamps.map((lamp) => {
      const distance = Math.hypot(detector.x - lamp.x, detector.y - lamp.y, lamp.height);
      const cosine = lamp.height / distance;
      const unblockedLux = lamp.enabled ? lamp.intensity * cosine / (distance * distance) : 0;
      const blockedBy = lamp.enabled && lamp.intensity > 0 ? scene.screens.filter((screen) => screenBlocks(lamp, detector, screen)).map((screen) => screen.id) : [];
      return { lampId: lamp.id, lux: blockedBy.length ? 0 : unblockedLux, unblockedLux, distance, cosine, blockedBy };
    });
    return { id: detector.id, label: detector.label, lux: contributions.reduce((sum, item) => sum + item.lux, 0), contributions };
  });
  const values = detectors.map((detector) => detector.lux);
  const minimumLux = Math.min(...values);
  const maximumLux = Math.max(...values);
  return { detectors, minimumLux, maximumLux, averageLux: values.reduce((sum, value) => sum + value, 0) / values.length, uniformity: maximumLux > 0 ? minimumLux / maximumLux : 0, totalIntensity: scene.lamps.reduce((sum, lamp) => sum + (lamp.enabled ? lamp.intensity : 0), 0) };
}

/** Dense visual field: one geometry validation, row-major cell-centre lux. */
export function sampleField(input, columns = 92, rows = 58) {
  const scene = validateScene(input);
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 2 || rows < 2 || columns > 256 || rows > 256) throw new RangeError('Field dimensions must be integers from 2 to 256.');
  const values = new Float64Array(columns * rows);
  const point = { x: 0, y: 0 };
  for (let row = 0; row < rows; row += 1) {
    point.y = (row + 0.5) / rows * scene.depth;
    for (let column = 0; column < columns; column += 1) {
      point.x = (column + 0.5) / columns * scene.width;
      let illuminance = 0;
      for (const lamp of scene.lamps) {
        if (!lamp.enabled || lamp.intensity === 0 || scene.screens.some((screen) => screenBlocks(lamp, point, screen))) continue;
        const distance = Math.hypot(point.x - lamp.x, point.y - lamp.y, lamp.height);
        illuminance += lamp.intensity * lamp.height / (distance ** 3);
      }
      values[row * columns + column] = illuminance;
    }
  }
  return { columns, rows, values };
}

function same(value, expected) {
  return typeof value === 'number' && typeof expected === 'number' ? Math.abs(value - expected) <= EPSILON * Math.max(1, Math.abs(expected)) : value === expected;
}
function fixedSceneCheck(scene, challenge) {
  return scene.width === challenge.scene.width && scene.depth === challenge.scene.depth && scene.detectors.length === challenge.scene.detectors.length && challenge.scene.detectors.every((expected) => scene.detectors.some((actual) => actual.id === expected.id && same(actual.x, expected.x) && same(actual.y, expected.y))) && scene.lamps.length === challenge.scene.lamps.length && challenge.scene.lamps.every((expected) => scene.lamps.some((actual) => actual.id === expected.id)) && scene.screens.length === challenge.scene.screens.length && challenge.scene.screens.every((expected) => scene.screens.some((actual) => actual.id === expected.id));
}

export function challengeVerdict(id, input) {
  const challenge = getChallenge(id);
  const scene = validateScene(input);
  const result = evaluateScene(scene);
  const check = (label, value, target, passed) => ({ label, value, target, passed });
  const checks = [];
  if (id !== 'free') checks.push(check('Keep the authored work areas and equipment', fixedSceneCheck(scene, challenge), 'original detectors and equipment', fixedSceneCheck(scene, challenge)));
  if (id === 'distance') {
    const lamp = scene.lamps.find((item) => item.id === 'lamp-a');
    const fixed = !!lamp && same(lamp.x, 3) && same(lamp.y, 2) && same(lamp.intensity, 32) && lamp.enabled;
    checks.push(check('Only change lamp height', fixed, '32 cd directly above the centre', fixed));
    checks.push(check('Centre illuminance', result.detectors.find((item) => item.id === 'detector-a')?.lux ?? 0, '180–220 lx', result.minimumLux >= 180 - EPSILON && result.maximumLux <= 220 + EPSILON));
  }
  if (id === 'shadow') {
    const lamp = scene.lamps.find((item) => item.id === 'lamp-a');
    const fixed = !!lamp && same(lamp.x, 2.4) && same(lamp.y, 2) && same(lamp.height, 0.75) && same(lamp.intensity, 120) && lamp.enabled;
    checks.push(check('Keep the original lamp', fixed, '120 cd, height 0.75 m, original position', fixed));
    checks.push(check('Far-side illuminance', result.detectors.find((item) => item.id === 'detector-a')?.lux ?? 0, 'at least 30 lx', result.minimumLux >= 30 - EPSILON));
  }
  if (id === 'balance') {
    checks.push(check('Both work areas', `${result.minimumLux.toFixed(2)}–${result.maximumLux.toFixed(2)} lx`, '150–200 lx each', result.minimumLux >= 150 - EPSILON && result.maximumLux <= 200 + EPSILON));
    checks.push(check('Uniformity', result.uniformity, 'at least 0.90 (minimum / maximum)', result.uniformity >= 0.9 - EPSILON));
    checks.push(check('Enabled intensity budget', result.totalIntensity, 'at most 90 cd', result.totalIntensity <= 90 + EPSILON));
  }
  const passed = id !== 'free' && checks.every((item) => item.passed);
  return { passed, checks, explanation: id === 'free' ? 'Open exploration has no pass target. Compare your prediction with a measured change.' : passed ? 'The authored target is met in the ideal model. Try explaining which physical change made it possible.' : 'Use the detector readings and direct-ray paths to revise the setup. These targets are puzzle goals, not lighting standards.' };
}

export function createLabState(challengeId = 'distance') {
  return { version: 1, challengeId, scene: getChallenge(challengeId).scene, experiments: [], pending: null };
}

function experimentExplanation(before, after, actual, changedControls) {
  const blockedBefore = before.contributions.filter((item) => item.blockedBy.length).length;
  const blockedAfter = after.contributions.filter((item) => item.blockedBy.length).length;
  const measurement = `${before.label}: ${before.lux.toFixed(2)} → ${after.lux.toFixed(2)} lx (${actual}).`;
  const changes = changedControls === 0 ? ' No lamp or screen control changed.' : changedControls === 1 ? ' One control changed, giving a matched comparison.' : ` ${changedControls} controls changed, so this comparison alone does not isolate a single cause.`;
  const path = blockedBefore !== blockedAfter ? ` Blocked direct contributions changed from ${blockedBefore} to ${blockedAfter}.` : ' Each clear lamp contributes I h / r³; blocked direct contributions are zero.';
  return measurement + changes + path;
}

function countChanges(before, after) {
  let count = before.width === after.width && before.depth === after.depth ? 0 : 1;
  for (const collection of ['lamps', 'screens', 'detectors']) {
    const ids = new Set([...before[collection].map((item) => item.id), ...after[collection].map((item) => item.id)]);
    for (const id of ids) {
      const a = before[collection].find((item) => item.id === id);
      const b = after[collection].find((item) => item.id === id);
      if (!a || !b) { count += 1; continue; }
      if (collection === 'screens' && same(a.x2 - a.x1, b.x2 - b.x1) && same(a.y2 - a.y1, b.y2 - b.y1)) {
        // Translating a rigid screen is one position control per axis, even
        // though two endpoint coordinates are stored for that one movement.
        for (const field of ['x1', 'y1', 'height', 'enabled']) if (!same(a[field], b[field])) count += 1;
      } else {
        for (const field of Object.keys(a)) if (field !== 'id' && field !== 'label' && !same(a[field], b[field])) count += 1;
      }
    }
  }
  return count;
}

/** User-action metadata defaults only; all scientific results derive from inputs. */
export function makeExperiment(beforeInput, afterInput, options) {
  object(options, 'experiment options');
  const challengeId = getChallenge(options.challengeId ?? 'free').id;
  const detectorId = identity(options.detectorId, 'experiment detector');
  const prediction = options.prediction;
  if (!['increase', 'decrease', 'same'].includes(prediction)) throw new TypeError('Prediction must be increase, decrease, or same.');
  const beforeScene = validateScene(beforeInput);
  const afterScene = validateScene(afterInput);
  const before = { scene: beforeScene, readings: evaluateScene(beforeScene) };
  const after = { scene: afterScene, readings: evaluateScene(afterScene) };
  const a = before.readings.detectors.find((item) => item.id === detectorId);
  const b = after.readings.detectors.find((item) => item.id === detectorId);
  const aGeometry = beforeScene.detectors.find((item) => item.id === detectorId);
  const bGeometry = afterScene.detectors.find((item) => item.id === detectorId);
  if (!a || !b || !same(aGeometry.x, bGeometry.x) || !same(aGeometry.y, bGeometry.y)) throw new TypeError('An experiment must compare the same fixed detector.');
  const deltaLux = b.lux - a.lux;
  const tolerance = EPSILON * Math.max(1, Math.abs(a.lux), Math.abs(b.lux));
  const actual = Math.abs(deltaLux) <= tolerance ? 'same' : deltaLux > 0 ? 'increase' : 'decrease';
  const changedControls = countChanges(beforeScene, afterScene);
  return { id: identity(options.id ?? `experiment-${crypto.randomUUID()}`, 'experiment id'), createdAt: iso(options.createdAt ?? new Date().toISOString()), challengeId, detectorId, prediction, hypothesis: text(options.hypothesis ?? '', 4000, 'experiment hypothesis', true), note: text(options.note ?? '', 4000, 'experiment note', true), before, after, deltaLux, actual, predictionCorrect: prediction === actual, changedControls, explanation: experimentExplanation(a, b, actual, changedControls) };
}

function evidenceEqual(actual, expected) {
  if (typeof expected === 'number') return typeof actual === 'number' && Number.isFinite(actual) && same(actual, expected);
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => evidenceEqual(actual[index], value));
  if (expected && typeof expected === 'object') return actual && typeof actual === 'object' && !Array.isArray(actual) && Object.entries(expected).every(([key, value]) => evidenceEqual(actual[key], value));
  return actual === expected;
}

/** Recompute archived results so saved predictions cannot forge measurements. */
export function validateLabState(input) {
  object(input, 'lab');
  if (input.version !== 1) throw new TypeError('Unsupported light lab version.');
  const challengeId = getChallenge(input.challengeId).id;
  const scene = validateScene(input.scene);
  const ids = new Set();
  const experiments = list(input.experiments ?? [], 0, 100, 'experiments').map((item) => {
    object(item, 'experiment');
    object(item.before, 'experiment before');
    object(item.after, 'experiment after');
    identity(item.id, 'saved experiment id');
    iso(item.createdAt);
    getChallenge(item.challengeId);
    const checked = makeExperiment(item.before.scene, item.after.scene, { id: item.id, createdAt: item.createdAt, challengeId: item.challengeId, detectorId: item.detectorId, prediction: item.prediction, hypothesis: item.hypothesis, note: item.note });
    if (ids.has(checked.id)) throw new TypeError('Experiment identifiers must be unique.');
    ids.add(checked.id);
    if (!evidenceEqual(item.before.readings, checked.before.readings) || !evidenceEqual(item.after.readings, checked.after.readings) || !evidenceEqual(item.deltaLux, checked.deltaLux) || item.actual !== checked.actual || item.predictionCorrect !== checked.predictionCorrect || item.changedControls !== checked.changedControls || item.explanation !== checked.explanation) throw new TypeError('Saved light experiment does not match its scene evidence.');
    return checked;
  });
  let pending = null;
  if (input.pending !== undefined && input.pending !== null) {
    const raw = object(input.pending, 'pending experiment');
    const pendingChallengeId = getChallenge(raw.challengeId).id;
    if (pendingChallengeId !== challengeId) throw new TypeError('Pending experiment must belong to the active challenge.');
    const beforeScene = validateScene(raw.beforeScene);
    const detectorId = identity(raw.detectorId, 'pending detector');
    const beforeDetector = beforeScene.detectors.find((item) => item.id === detectorId);
    const currentDetector = scene.detectors.find((item) => item.id === detectorId);
    if (!beforeDetector || !currentDetector || !same(beforeDetector.x, currentDetector.x) || !same(beforeDetector.y, currentDetector.y)) throw new TypeError('Pending experiment must compare the same fixed detector.');
    if (!['increase', 'decrease', 'same'].includes(raw.prediction)) throw new TypeError('Pending prediction must be increase, decrease, or same.');
    pending = { beforeScene, challengeId: pendingChallengeId, detectorId, prediction: raw.prediction, hypothesis: text(raw.hypothesis, 4000, 'pending hypothesis', true), committedAt: iso(raw.committedAt) };
  }
  return { version: 1, challengeId, scene, experiments, pending };
}
