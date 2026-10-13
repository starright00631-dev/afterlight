import { CHALLENGES, LIGHT_SOURCES, evaluateScene, validateScene } from './optics.js';
import { uid } from './domain.js';
import { createStudy, activeStudy, validateStudy, updateScene, updateTargets, studyVerdict, saveAlternative, restoreAlternative, chooseAlternative, commitExperiment, runExperiment, finalizeExperiment, discardExperiment, addObservation, studyReportHTML, studyCSV } from './studies.js';
import { createStudioRenderer } from './studio-renderer.js';
import { presentStudyTitle, resolveStudioComparison, resolveStudioView, studioWorkflowState } from './studio-view-state.js';
import { calculateDifferenceField } from './field-difference.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const copy = (value) => structuredClone(value);
const fixed = (value, places = 1) => Number(value).toFixed(places);
const portion = (length, fraction) => Number((length * fraction).toPrecision(12));
const direction = { increase: 'Brighter', decrease: 'Dimmer', same: 'Unchanged' };
const commissions = [ ['distance', 'Distance', 'I', 'A rule of distance'], ['shadow', 'Shadow', 'II', 'Trace an obstruction'], ['balance', 'Balance', 'III', 'Light two places'], ['free', 'Your study', '◇', 'Keep a useful decision'] ];

/** Resize the measured surface without moving equipment or sample points. */
export function resizedSurfaceScene(input, width, depth) {
  for (const [name, value] of [['Width', width], ['Depth', depth]]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.3 || value > 12) throw new RangeError(`${name} must be a number from 0.3 to 12 metres.`);
  }
  const scene = validateScene(input), outside = [];
  const check = (name, x, y) => { if (x > width || y > depth) outside.push(`${name} at (${x}, ${y}) m`); };
  scene.lamps.forEach((lamp, index) => check(`Lamp ${index + 1}`, lamp.x, lamp.y));
  scene.detectors.forEach((point, index) => check(`Point ${String.fromCharCode(65 + index)} · ${point.label}`, point.x, point.y));
  scene.screens.forEach((screen, index) => {
    check(`Screen ${index + 1} start`, screen.x1, screen.y1);
    check(`Screen ${index + 1} end`, screen.x2, screen.y2);
  });
  if (outside.length) throw new RangeError(`${width} × ${depth} m would leave ${outside.join('; ')} outside the table. Move these objects inside the intended bounds first. Their positions have not changed.`);
  return validateScene({ ...scene, width, depth });
}

/** A size draft stays separate from the live model until one explicit apply. */
export function createSurfaceResizeEditor({ readScene, commitScene }) {
  let draft = null, feedback = '', status = '';
  const values = () => draft ? { ...draft } : { width: String(readScene().width), depth: String(readScene().depth) };
  return {
    values,
    get feedback() { return feedback; },
    get status() { return status; },
    edit(property, raw) {
      if (!['width', 'depth'].includes(property)) throw new TypeError('Only width and depth belong to the table size draft.');
      draft = { ...values(), [property]: String(raw) }; feedback = ''; status = 'draft';
    },
    reset() { draft = null; feedback = ''; status = ''; },
    apply() {
      const proposed = values();
      let scene;
      try {
        for (const [property, name] of [['width', 'Width'], ['depth', 'Depth']]) if (!proposed[property].trim()) throw new RangeError(`Enter the table ${name.toLowerCase()} in metres (0.3–12).`);
        scene = resizedSurfaceScene(readScene(), Number(proposed.width), Number(proposed.depth));
      } catch (error) { feedback = error.message; status = 'error'; return false; }
      const original = readScene();
      if (scene.width === original.width && scene.depth === original.depth) { draft = null; feedback = 'Table size is unchanged.'; status = 'saved'; return true; }
      if (commitScene(scene) === false) { feedback = 'The table size could not be saved. Your earlier table and equipment are retained.'; status = 'error'; return false; }
      draft = null; feedback = `Table resized to ${scene.width} × ${scene.depth} m. Equipment and point positions are unchanged.`; status = 'saved'; return true;
    }
  };
}

export function mountStudio(root, { getState, commitState, onReadSource, onUseDecision, onPlanCheck, notify }) {
  let selected = null, renderMode = 'layout', pendingView = 'proposed', optionView = null;
  let compareA = '', compareB = '', predictionOpen = false, draftScene = null, inspectorKey = '', activeStep = 'arrange';
  let currentStudyId = '', lastPersonalStudyId = '', evidenceStudyId = '', disposed = false, reportURL = null, differenceFieldCache = null;
  const evidenceDrafts = new Map();
  const eventRemovers = [];
  const $ = (selector) => root.querySelector(selector);
  const current = () => activeStudy(getState().studio);
  const owner = (study) => getState().projects.find((project) => project.id === study.projectId);
  const message = (text) => notify?.(text);
  const listen = (element, event, callback) => { element.addEventListener(event, callback); eventRemovers.push(() => element.removeEventListener(event, callback)); };
  const surfaceEditor = createSurfaceResizeEditor({
    readScene: () => current().scene,
    commitScene: (scene) => transact((state, study) => {
      if (view().readOnly || study.pending || isCommission(study)) throw Error('Return to the editable personal layout and resolve its prediction before resizing the table.');
      updateScene(study, scene);
    })
  });

  function focusIdentity(element) {
    if (element.id) return `id:${element.id}`;
    const container = element.closest('[data-form], [data-section], [id]');
    const scope = container?.dataset.form || container?.dataset.section || container?.id || '';
    const data = Object.entries(element.dataset).sort();
    return JSON.stringify([scope, element.tagName, element.getAttribute('name'), element.getAttribute('type'), element.getAttribute('aria-label'), data, !data.length && (element.tagName === 'BUTTON' || element.tagName === 'SUMMARY') ? element.textContent.trim() : '']);
  }
  function captureFocus() {
    const element = document.activeElement;
    if (!element || !root.contains(element)) return null;
    let selection = null;
    try { if (element.selectionStart !== null && element.selectionStart !== undefined) selection = [element.selectionStart, element.selectionEnd, element.selectionDirection]; } catch {}
    return { element, identity: focusIdentity(element), selection };
  }
  function restoreFocus(saved) {
    if (!saved || saved.element.isConnected && root.contains(saved.element)) return;
    const replacement = [...root.querySelectorAll('button, input, select, textarea, a, summary, canvas')].find((element) => !element.disabled && focusIdentity(element) === saved.identity);
    if (!replacement) return;
    replacement.focus({ preventScroll: true });
    if (saved.selection) { try { replacement.setSelectionRange(...saved.selection); } catch {} }
  }

  root.innerHTML = `<div class="studio-shell">
    <header class="studio-header"><div><p class="eyebrow">Afterlight · Hall of Illumination</p><h1 id="studio-title"></h1><p id="studio-task"></p><span class="studio-owner" id="studio-owner"></span></div><div class="studio-header-actions"><button type="button" class="secondary" data-studio="studies">Studies</button><button type="button" class="text-button" data-studio="new">+ New study</button><button type="button" class="text-button" data-studio="guide">Field guide</button></div></header>
    <div class="studio-workspace"><nav class="studio-rail" id="studio-rail" aria-label="Practice studies"></nav>
      <section class="studio-main"><div class="studio-stage"><div class="studio-stage-toolbar"><div id="studio-options" class="studio-option-tabs" aria-label="Arrangement"></div><div class="studio-render-modes" aria-label="Stage view"><button data-render-mode="layout" aria-pressed="true">Room</button><button data-render-mode="field" aria-pressed="false">Light field</button><button data-render-mode="paths" aria-pressed="false">Paths</button><button data-render-mode="difference" aria-pressed="false" disabled>Difference</button></div></div><div id="studio-view-status" class="studio-view-status"></div><p class="sr-only" id="studio-canvas-help">Drag editable handles or use the labelled numeric controls. In Room view, the book opens the Field guide and the notebook opens the Study record. Their labelled buttons provide the same actions. Press Enter on the table to reach exact controls.</p><canvas class="studio-canvas" id="studio-canvas" role="img" aria-label="Reading room with an interactive calculated task surface."></canvas><div class="studio-metrics" id="studio-metrics" aria-live="polite"></div></div>
      <div class="studio-actionbar" id="studio-actionbar"></div><nav class="studio-flow" id="studio-flow" aria-label="Study workflow"></nav><p class="studio-flow-help" id="studio-flow-help"></p><section class="studio-prediction" id="studio-prediction" hidden></section><section class="studio-result" id="studio-result" hidden aria-live="polite"></section>
      <p class="studio-boundary">Calculated direct light · ideal point lamps. Paper and furniture are decorative; only configured opaque screens block direct light.</p></section>
      <aside class="studio-inspector" id="studio-inspector" aria-label="Study controls"></aside></div>
    <section class="studio-evidence" id="studio-record" aria-labelledby="studio-record-title" tabindex="-1"><div class="studio-section-heading"><div><p class="eyebrow">Study record</p><h2 id="studio-record-title">Arrangements &amp; evidence</h2></div><div class="studio-record-actions"><button type="button" class="text-button" data-studio="return-table" aria-controls="studio-canvas">Return to table ↑</button><button class="secondary" data-studio="export">Export study</button></div></div><div class="studio-evidence-grid"><section id="studio-arrangements"></section><section id="studio-decision"></section></div><details class="studio-control-section" id="studio-notebook"><summary>Experiment notebook <span id="studio-experiment-count"></span></summary><div id="studio-trials"></div></details><details class="studio-control-section" id="studio-observations"><summary>Check with a real reading</summary><p class="helper-copy">Optional readings belong to an immutable saved arrangement. They do not replace the calculation.</p><div id="studio-observation-form"></div><div id="studio-observation-list"></div></details></section>
    <dialog class="studio-dialog" id="studio-dialog"><div class="dialog-shell"><div class="dialog-header"><h2 id="studio-dialog-title"></h2><button class="dialog-close" data-studio="close-dialog" aria-label="Close">×</button></div><div id="studio-dialog-body"></div></div></dialog>
  </div>`;
  const canvas = $('#studio-canvas'), dialog = $('#studio-dialog');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-describedby', 'studio-view-status studio-flow-help studio-canvas-help');
  canvas.title = 'Drag editable handles. Book: Field guide. Notebook: Study record. Enter: exact controls.';
  const renderer = createStudioRenderer(canvas, {
    onActivate(item) { if (item?.kind === 'prop') activateRoomShortcut(item.id); },
    onSelect(selection) { selected = selection; inspectorKey = ''; renderInspector(true); drawStage(); },
    onMove(change) {
      const study = current(); if (!canMove(change) || study.pending && change.kind === 'point') return;
      const proposed = copy(draftScene || study.scene);
      const collection = change.kind === 'lamp' ? proposed.lamps : change.kind === 'point' ? proposed.detectors : proposed.screens;
      const item = collection.find((entry) => entry.id === change.id); if (!item) return;
      if (change.kind === 'screen-start') { item.x1 = change.x; item.y1 = change.y; }
      else if (change.kind === 'screen-end') { item.x2 = change.x; item.y2 = change.y; }
      else { item.x = change.x; item.y = change.y; }
      try { validateScene(proposed); } catch { return; }
      draftScene = proposed; renderMetrics(); drawStage();
      for (const input of root.querySelectorAll('[data-geometry]')) {
        if (input.dataset.entity === change.id) {
          const target = change.kind === 'lamp' ? item : change.kind === 'point' ? item : item;
          if (input.dataset.geometry in target) input.value = target[input.dataset.geometry];
        }
      }
    },
    onCommitMove({ cancelled }) {
      if (cancelled) { draftScene = null; render(); return; }
      const proposed = draftScene; draftScene = null;
      if (proposed) transact((state, study) => updateScene(study, proposed));
      else render();
    }
  });

  function transact(operation, { rebuild = false } = {}) {
    try {
      const next = copy(getState()), study = activeStudy(next.studio);
      operation(next, study);
      if (commitState(next) === false) { message('The change could not be saved. Your earlier stage and evidence are still retained.'); render(); return false; }
      if (rebuild) inspectorKey = '';
      render(); return true;
    } catch (error) { message(error.message); render(); return false; }
  }
  function showDialog(title, html) {
    $('#studio-dialog-title').textContent = title; $('#studio-dialog-body').innerHTML = html;
    if (!dialog.open) dialog.showModal();
    (dialog.querySelector('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') || dialog.querySelector('.dialog-close')).focus({ preventScroll: true });
  }
  function download(filename, content, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function sameSelection(scene) {
    if (!selected || selected.kind === 'lamp' && !scene.lamps.some((item) => item.id === selected.id) || selected.kind === 'point' && !scene.detectors.some((item) => item.id === selected.id) || selected.kind.startsWith('screen') && !scene.screens.some((item) => item.id === selected.id)) selected = { kind: 'lamp', id: scene.lamps[0].id };
  }
  function isCommission(study = current()) { return study.kind === 'commission'; }
  function allowed(kind, property, study = current()) {
    if (!isCommission(study)) return true;
    const definition = CHALLENGES.find((item) => item.id === study.challengeId);
    return kind === 'lamp' ? definition.editable.lamps.includes(property) : kind === 'screen' ? definition.editable.screens.includes(property) : false;
  }
  function canMove(selection) {
    if (view().readOnly) return false;
    if (selection.kind === 'point') return !isCommission() && !current().pending;
    if (selection.kind === 'lamp') return allowed('lamp', 'x');
    return allowed('screen', selection.kind === 'screen-start' ? 'x1' : 'x2');
  }
  function comparisonState() {
    const compared = resolveStudioComparison(current(), compareA, compareB);
    compareA = compared.aId; compareB = compared.bId;
    return compared;
  }
  function view() { return resolveStudioView(current(), { mode: renderMode, optionId: optionView, pendingView, draftScene, aId: compareA, bId: compareB }); }
  function displayScene() { return view().scene; }
  function proposedCovered() { return view().proposed; }
  function drawStage() {
    const displayed = view();
    renderer.render({ scene: displayed.scene, day: !getState().settings.night, mode: renderMode, comparison: displayed.comparison, proposed: displayed.proposed, selected, readOnly: displayed.readOnly, canMove });
  }
  function verdict(study) {
    const result = studyVerdict(study);
    const goals = result.commission.targetSatisfied;
    const evidence = result.commission.evidenceComplete;
    return { ...result, goals, evidence, complete: result.commission.completed };
  }
  function renderRail() {
    const study = current();
    $('#studio-rail').innerHTML = commissions.map(([id, name, mark, subtitle]) => {
      const target = id === 'free' ? getState().studio.studies.find((item) => item.kind === 'personal') : getState().studio.studies.find((item) => item.kind === 'commission' && item.challengeId === id);
      const complete = target && id !== 'free' && verdict(target).complete;
      const active = id === 'free' ? study.kind !== 'commission' : study.kind === 'commission' && study.challengeId === id;
      return `<button type="button" data-commission="${id}" class="studio-chapter ${active ? 'active' : ''}" aria-pressed="${active}"><span class="studio-chapter-mark" aria-hidden="true">${complete ? '✓' : mark}</span><strong>${name}</strong><small>${complete ? 'Evidence retained' : subtitle}</small></button>`;
    }).join('');
  }
  function renderOptions() {
    const focused = captureFocus(), study = current(), compared = comparisonState();
    if (renderMode === 'difference' && !compared.available) renderMode = 'layout';
    const difference = renderMode === 'difference';
    $('#studio-options').innerHTML = `<button data-option-view="" aria-pressed="${!optionView && !difference}">Working layout</button>${study.alternatives.slice(-2).map((option) => `<button data-option-view="${esc(option.id)}" aria-pressed="${optionView === option.id && !difference}">${esc(option.name)}</button>`).join('')}`;
    const currentOption = study.alternatives.find((item) => item.id === optionView);
    $('#studio-view-status').innerHTML = difference ? `<span>Calculated difference · Option B minus Option A<small>A: ${esc(compared.result.a.name)} · B: ${esc(compared.result.b.name)}</small></span><button class="text-button" data-option-view="">Return to working layout</button>` : currentOption ? `<span>Saved arrangement · ${esc(currentOption.name)}<small class="studio-drag-hint">Read-only · edit a copy to move equipment</small></span><button class="text-button" data-restore="${esc(currentOption.id)}">Edit a copy</button>` : study.pending ? `<span>${pendingView === 'baseline' ? 'Frozen baseline · original equipment and readings' : 'Proposed geometry · future calculations covered'}<small class="studio-drag-hint">${pendingView === 'baseline' ? 'Read-only · the prediction keeps this baseline' : 'Drag a lamp or screen · measurement points stay fixed'}</small></span><div><button data-pending-view="proposed" aria-pressed="${pendingView === 'proposed'}">Proposal</button><button data-pending-view="baseline" aria-pressed="${pendingView === 'baseline'}">Baseline</button></div>` : `<span>Editable arrangement · ${isCommission() ? 'commission equipment' : 'your task surface'}<small class="studio-drag-hint">Drag a lamp · exact values in controls</small></span><button class="text-button" data-studio="inspect">Edit conditions ↓</button>`;
    const status = $('#studio-view-status');
    let statusActions = status.querySelector(':scope > div');
    if (!statusActions) {
      statusActions = document.createElement('div');
      for (const button of status.querySelectorAll(':scope > button')) statusActions.append(button);
      status.append(statusActions);
    }
    const recordAction = document.createElement('button');
    recordAction.type = 'button'; recordAction.className = 'text-button'; recordAction.dataset.studio = 'record';
    recordAction.textContent = 'Study record'; recordAction.title = 'Open this study’s saved arrangements, experiments and decision';
    recordAction.setAttribute('aria-controls', 'studio-record'); statusActions.append(recordAction);
    if (difference) {
      const key = `${study.id}|${compareA}|${compareB}`;
      if (differenceFieldCache?.key !== key) differenceFieldCache = { key, field: calculateDifferenceField(compared.result.a.scene, compared.result.b.scene) };
      const magnitude = differenceFieldCache.field.maxMagnitude;
      const range = magnitude > 0 && magnitude < 0.01 ? magnitude.toPrecision(2) : fixed(magnitude, magnitude > 0 && magnitude < 1 ? 3 : 1);
      $('#studio-view-status > span').insertAdjacentHTML('beforeend', `<small class="studio-difference-legend">${magnitude ? `<span class="studio-difference-less">Blue less −${range} lx</span> · neutral 0 · <span class="studio-difference-more">Amber more +${range} lx</span>` : 'No calculated difference · neutral 0 lx'}</small>`);
    }
    for (const button of root.querySelectorAll('[data-render-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.renderMode === renderMode));
      if (button.dataset.renderMode === 'difference') { button.disabled = !compared.available; button.title = compared.available ? 'Compare the calculated field of retained Option B minus Option A.' : compared.reason; }
    }
    restoreFocus(focused);
  }
  function renderMetrics() {
    const compared = comparisonState().result;
    if (renderMode === 'difference' && compared?.matched && !current().pending) {
      const signed = (value, places = 1) => `${value > 0 ? '+' : ''}${fixed(value, places)}`;
      $('#studio-metrics').innerHTML = compared.points.map((point, index) => `<button class="studio-metric" data-select-point="${esc(point.id)}"><span>${String.fromCharCode(65 + index)} · ${esc(point.label)}</span><strong>${signed(point.deltaLux)}<small> lx</small></strong><small class="studio-point-status">A ${fixed(point.aLux)} → B ${fixed(point.bLux)} lx</small></button>`).join('') + `<div class="studio-metric"><span>Point uniformity Δ</span><strong>${signed((compared.bSummary.uniformity - compared.aSummary.uniformity) * 100, 0)}<small> pp</small></strong></div><div class="studio-metric"><span>Enabled intensity Δ</span><strong>${signed(compared.bSummary.totalIntensity - compared.aSummary.totalIntensity, 0)}<small> cd</small></strong></div>`;
      return;
    }
    const scene = displayScene(), readings = evaluateScene(scene), covered = proposedCovered(), targets = current().targets;
    const pointStatus = (lux) => lux < targets.minLux ? `Below ${targets.minLux} lx` : lux > targets.maxLux ? `Above ${targets.maxLux} lx` : `Within ${targets.minLux}–${targets.maxLux} lx`;
    $('#studio-metrics').innerHTML = readings.detectors.map((point, index) => `<button class="studio-metric" data-select-point="${esc(point.id)}"><span>${String.fromCharCode(65 + index)} · ${esc(point.label)}</span><strong>${covered ? 'Covered' : fixed(point.lux)}${covered ? '' : '<small> lx</small>'}</strong>${covered ? '' : `<small class="studio-point-status ${point.lux >= targets.minLux && point.lux <= targets.maxLux ? 'within' : ''}">${pointStatus(point.lux)}</small>`}</button>`).join('') + `<div class="studio-metric"><span>Point uniformity</span><strong>${covered ? '—' : fixed(readings.uniformity * 100, 0) + '<small>%</small>'}</strong></div><div class="studio-metric"><span>Enabled intensity</span><strong>${fixed(readings.totalIntensity, 0)}<small> cd</small></strong></div>`;
  }
  function renderActionbar() {
    const study = current(), status = verdict(study);
    if (study.staged) {
      $('#studio-actionbar').innerHTML = '<span><strong>An unfinished result is retained.</strong> Explain it before running another experiment.</span><button class="primary" data-studio="show-result">Return to conclusion</button>';
    } else if (study.pending) {
      $('#studio-actionbar').innerHTML = `<span><strong>Prediction committed.</strong> Change equipment, then reveal the readings.</span><div><button class="primary" data-studio="run">Run experiment</button><button class="text-button" data-studio="cancel">Cancel prediction</button></div>`;
    } else if (renderMode === 'difference') {
      $('#studio-actionbar').innerHTML = `<span>Only retained arrangements are compared. Positive values mean more light in B.</span><button class="primary" data-studio="choose">Choose an arrangement</button>`;
    } else if (optionView) {
      $('#studio-actionbar').innerHTML = `<span>The saved arrangement stays intact. Edit a copy to try another change.</span><button class="primary" data-restore="${esc(optionView)}">Edit a copy</button>`;
    } else {
      const statusText = isCommission(study) ? status.complete ? 'Commission complete · evidence and target retained.' : status.goals ? 'Target met · retain an explained experiment to finish.' : 'Discover the rule, then meet the target.' : 'Compare arrangements. Keep a reason you can check.';
      $('#studio-actionbar').innerHTML = `<span>${statusText}</span><div><button class="primary" data-studio="predict">Predict a change</button>${isCommission(study) && status.complete ? '<button class="secondary" data-commission="free">Use it in your study →</button>' : !isCommission(study) ? '<button class="text-button" data-studio="save-option-focus">Save this arrangement ↓</button>' : ''}</div>`;
    }
    renderPrediction(); renderResult();
  }
  function renderWorkflow() {
    const focused = captureFocus();
    const study = current(), compared = comparisonState(), flow = studioWorkflowState(study, { predictionOpen, mode: renderMode, activeStep, aId: compareA, bId: compareB });
    const steps = [['arrange', 'Arrange'], ['predict', 'Predict'], ['compare', 'Compare'], ['choose', 'Choose']];
    $('#studio-flow').innerHTML = steps.map(([id, title], index) => `<button type="button" class="studio-flow-step" data-flow="${id}" ${flow.current === id ? 'aria-current="step"' : ''} ${id === 'compare' && !flow.canCompare || id === 'choose' && !flow.canChoose ? 'disabled' : ''} title="${esc(id === 'compare' && !flow.canCompare ? study.pending ? 'Run or cancel the prediction first.' : 'Save two arrangements to compare.' : id === 'choose' && !compared.available ? compared.reason : title)}"><span class="studio-flow-number" aria-hidden="true">${index + 1}</span><span><strong>${title}</strong><small>${esc(flow[id])}</small></span></button>`).join('');
    $('#studio-flow-help').textContent = study.staged ? 'Your result is retained. Explain it to finish the experiment.' : study.pending ? 'The prediction is retained. Change equipment, then run to reveal the readings.' : renderMode === 'difference' ? 'B minus A at the same points. Choose a layout with a reason and a next check.' : optionView ? 'This saved arrangement is read-only. Edit a copy to try another change.' : activeStep === 'compare' && !compared.result?.matched ? compared.reason : study.decision && activeStep === 'choose' ? 'Your decision retains its comparison and targets. Use it in Desk or plan the next check.' : study.alternatives.length === 0 ? 'Arrange the lamps, predict a change, then save two layouts to compare.' : study.alternatives.length === 1 ? 'One arrangement retained. Change the working layout and save a second option.' : 'Compare your retained arrangements, then choose one with a reason and a next check.';
    restoreFocus(focused);
  }
  function renderPrediction() {
    const box = $('#studio-prediction'), study = current();
    box.hidden = !predictionOpen || Boolean(study.pending || study.staged);
    if (box.hidden || box.contains(document.activeElement)) return;
    const existing = box.querySelector('form'); if (existing && existing.dataset.study === study.id) return;
    box.innerHTML = `<form data-form="prediction" data-study="${esc(study.id)}"><h3>Let an explanation make a prediction.</h3><div class="studio-form-row"><label>Measurement point<select name="detectorId">${study.scene.detectors.map((point) => `<option value="${esc(point.id)}">${esc(point.label)}</option>`).join('')}</select></label><label>Expected change<select name="prediction"><option value="increase">Brighter</option><option value="decrease">Dimmer</option><option value="same">Unchanged</option></select></label></div><label>What will you change, and why?<textarea name="hypothesis" maxlength="4000" rows="2" required placeholder="If I move the lamp closer to the right place, I expect…"></textarea></label><div class="studio-inline-actions"><button class="primary">Commit prediction</button><button class="text-button" type="button" data-studio="close-prediction">Close</button></div></form>`;
  }
  function renderResult() {
    const box = $('#studio-result'), stage = current().staged;
    box.hidden = !stage;
    if (!stage) { box.innerHTML = ''; return; }
    if (box.dataset.stage === stage.id && box.contains(document.activeElement)) return;
    const record = stage.experiment, before = record.before.readings.detectors.find((point) => point.id === record.detectorId), after = record.after.readings.detectors.find((point) => point.id === record.detectorId);
    const rebuild = box.dataset.stage !== stage.id;
    if (!rebuild && box.querySelector('[name="conclusion"]')) { box.querySelector('[name="conclusion"]').value = stage.conclusion; return; }
    box.dataset.stage = stage.id;
    box.innerHTML = `<p class="eyebrow">Retained result · awaiting your conclusion</p><h2>${esc(before.label)}: ${fixed(before.lux)} → ${fixed(after.lux)} lx</h2><p>You predicted ${direction[record.prediction].toLowerCase()}; the calculated change was ${direction[record.actual].toLowerCase()}.</p><blockquote>${esc(record.hypothesis)}</blockquote><p class="helper-copy">${esc(record.explanation)}</p><label>What does this result explain? What would you check next?<textarea name="conclusion" data-conclusion rows="3" maxlength="4000">${esc(stage.conclusion)}</textarea></label><div class="studio-inline-actions"><button class="primary" data-studio="finalize">Finalize experiment</button><button class="text-button" data-studio="discard">Discard this unfinished result</button></div><p class="helper-copy">Your unfinished conclusion is saved as you type. A direction match alone does not validate the explanation.</p>`;
  }

  function numeric(label, value, { key, entity = '', kind = '', min = 0, max = 12, step = 'any', disabled = false, unit = '' }) {
    return `<label>${label}${unit ? ` <small>(${unit})</small>` : ''}<input type="number" value="${value}" min="${min}" max="${max}" step="${step}" data-geometry="${key}" data-entity="${esc(entity)}" data-kind="${kind}" ${disabled ? 'disabled' : ''}></label>`;
  }
  function renderInspector(force = false) {
    const focused = captureFocus();
    const study = current(), scene = displayScene(); sameSelection(scene);
    const key = `${study.id}|${selected.kind}|${selected.id}|${scene.lamps.length}|${scene.detectors.length}|${scene.screens.length}|${!!study.pending}|${optionView || ''}|${pendingView}|${renderMode === 'difference'}`;
    const panel = $('#studio-inspector');
    if (!force && inspectorKey === key) { updateInspectorValues(); renderComparison(); return; }
    const opened = new Map([...panel.querySelectorAll('details')].map((item) => [item.dataset.section, item.open]));
    const lamp = scene.lamps.find((item) => item.id === selected.id) || scene.lamps[0];
    const point = scene.detectors.find((item) => item.id === selected.id) || scene.detectors[0];
    const screen = scene.screens.find((item) => item.id === selected.id) || scene.screens[0];
    const equipmentLocked = view().readOnly;
    const geometryLocked = equipmentLocked || isCommission(study) || Boolean(study.pending);
    panel.innerHTML = `<div class="studio-inspector-heading"><h2>Study brief</h2><button class="text-button" data-studio="guide">Read the rules</button></div><p class="studio-target-summary">${scene.width} × ${scene.depth} m · ${study.targets.minLux}–${study.targets.maxLux} lx</p>
      <details class="studio-control-section" data-section="brief"><summary>Task & ownership</summary><label>Study title<input data-study-field="title" value="${esc(study.title)}" maxlength="200"></label><label>What are you lighting?<textarea data-study-field="task" rows="2" maxlength="2000">${esc(study.task)}</textarea></label><label>Question<input data-study-field="question" value="${esc(study.question)}" maxlength="1000"></label><p class="helper-copy">Owner: ${esc(owner(study)?.title || 'Unassigned recovered work')}</p><button class="text-button" data-studio="associate">Associate a project</button>${study.example ? '<p class="helper-copy">Original example setup. Your results and decisions begin empty.</p>' : ''}</details>
      <section class="studio-control-section studio-selected-control"><div class="studio-object-tabs"><button data-select-kind="lamp" aria-pressed="${selected.kind === 'lamp'}">Lamp</button><button data-select-kind="point" aria-pressed="${selected.kind === 'point'}">Point</button>${scene.screens.length ? `<button data-select-kind="screen-start" aria-pressed="${selected.kind.startsWith('screen')}">Screen</button>` : ''}</div>
      ${selected.kind === 'lamp' ? `<label class="studio-selection-label">Lamp<select data-object-select="lamp">${scene.lamps.map((item, index) => `<option value="${esc(item.id)}" ${item.id === lamp.id ? 'selected' : ''}>Lamp ${index + 1}</option>`).join('')}</select></label><label>Intensity <output id="studio-intensity-output">${fixed(lamp.intensity, 0)} cd</output><span class="studio-range-pair"><input type="number" min="0" max="200" step="1" value="${lamp.intensity}" aria-label="Lamp intensity exact value (cd)" data-geometry="intensity" data-kind="lamp" data-entity="${esc(lamp.id)}" ${equipmentLocked || !allowed('lamp', 'intensity') ? 'disabled' : ''}><input type="range" min="0" max="200" step="1" value="${lamp.intensity}" aria-label="Lamp intensity (cd)" data-geometry="intensity" data-kind="lamp" data-entity="${esc(lamp.id)}" ${equipmentLocked || !allowed('lamp', 'intensity') ? 'disabled' : ''}></span></label><label>Height <output id="studio-height-output">${fixed(lamp.height, 2)} m</output><span class="studio-range-pair"><input type="number" min="0.2" max="3" step="0.01" value="${lamp.height}" aria-label="Lamp height exact value (m)" data-geometry="height" data-kind="lamp" data-entity="${esc(lamp.id)}" ${equipmentLocked || !allowed('lamp', 'height') ? 'disabled' : ''}><input type="range" min="0.2" max="3" step="0.01" value="${lamp.height}" aria-label="Lamp height (m)" data-geometry="height" data-kind="lamp" data-entity="${esc(lamp.id)}" ${equipmentLocked || !allowed('lamp', 'height') ? 'disabled' : ''}></span></label><div class="studio-form-row">${numeric('Across', lamp.x, { key: 'x', entity: lamp.id, kind: 'lamp', max: scene.width, disabled: equipmentLocked || !allowed('lamp', 'x'), unit: 'm' })}${numeric('Along', lamp.y, { key: 'y', entity: lamp.id, kind: 'lamp', max: scene.depth, disabled: equipmentLocked || !allowed('lamp', 'y'), unit: 'm' })}</div><label class="studio-check"><input type="checkbox" data-geometry="enabled" data-kind="lamp" data-entity="${esc(lamp.id)}" ${lamp.enabled ? 'checked' : ''} ${equipmentLocked || !allowed('lamp', 'enabled') ? 'disabled' : ''}>Lamp enabled</label>` : selected.kind === 'point' ? `<label>Point<select data-object-select="point">${scene.detectors.map((item, index) => `<option value="${esc(item.id)}" ${item.id === point.id ? 'selected' : ''}>${String.fromCharCode(65 + index)} · ${esc(item.label)}</option>`).join('')}</select></label><label>Point name<input value="${esc(point.label)}" maxlength="80" data-point-label="${esc(point.id)}" ${geometryLocked ? 'disabled' : ''}></label><div class="studio-form-row">${numeric('Across', point.x, { key: 'x', entity: point.id, kind: 'point', max: scene.width, disabled: geometryLocked, unit: 'm' })}${numeric('Along', point.y, { key: 'y', entity: point.id, kind: 'point', max: scene.depth, disabled: geometryLocked, unit: 'm' })}</div><p class="helper-copy">A horizontal sample point, not a whole-surface average.</p>` : screen ? `<label>Screen<select data-object-select="screen-start">${scene.screens.map((item, index) => `<option value="${esc(item.id)}" ${item.id === screen.id ? 'selected' : ''}>Screen ${index + 1}</option>`).join('')}</select></label><label>Height <output id="studio-screen-height-output">${fixed(screen.height, 2)} m</output><span class="studio-range-pair"><input type="number" min="0" max="3" step="0.01" value="${screen.height}" aria-label="Screen height exact value (m)" data-geometry="height" data-kind="screen" data-entity="${esc(screen.id)}" ${equipmentLocked || !allowed('screen', 'height') ? 'disabled' : ''}><input type="range" min="0" max="3" step="0.01" value="${screen.height}" aria-label="Screen height (m)" data-geometry="height" data-kind="screen" data-entity="${esc(screen.id)}" ${equipmentLocked || !allowed('screen', 'height') ? 'disabled' : ''}></span></label><div class="studio-form-row">${numeric('Start x', screen.x1, { key: 'x1', entity: screen.id, kind: 'screen', max: scene.width, disabled: equipmentLocked || !allowed('screen', 'x1'), unit: 'm' })}${numeric('Start y', screen.y1, { key: 'y1', entity: screen.id, kind: 'screen', max: scene.depth, disabled: equipmentLocked || !allowed('screen', 'y1'), unit: 'm' })}${numeric('End x', screen.x2, { key: 'x2', entity: screen.id, kind: 'screen', max: scene.width, disabled: equipmentLocked || !allowed('screen', 'x2'), unit: 'm' })}${numeric('End y', screen.y2, { key: 'y2', entity: screen.id, kind: 'screen', max: scene.depth, disabled: equipmentLocked || !allowed('screen', 'y2'), unit: 'm' })}</div><label class="studio-check"><input type="checkbox" data-geometry="enabled" data-kind="screen" data-entity="${esc(screen.id)}" ${screen.enabled ? 'checked' : ''} ${equipmentLocked || !allowed('screen', 'enabled') ? 'disabled' : ''}>Opaque screen in place</label>` : ''}</section>
      <details class="studio-control-section" data-section="surface"><summary>Surface & equipment</summary><form data-form="surface" novalidate><div class="studio-form-row">${numeric('Width', scene.width, { key: 'width', kind: 'surface', min: 0.3, step: 'any', disabled: geometryLocked, unit: 'm' })}${numeric('Depth', scene.depth, { key: 'depth', kind: 'surface', min: 0.3, step: 'any', disabled: geometryLocked, unit: 'm' })}</div><p class="helper-copy" id="studio-surface-help">0.3–12 metres per side. Apply both dimensions together; lamp, point and screen coordinates stay in metres. Move any objects inside the new bounds before shrinking.</p><div class="studio-inline-actions"><button type="submit" class="secondary" ${geometryLocked ? 'disabled' : ''}>Apply table size</button><button type="button" data-studio="cancel-surface" class="text-button" ${geometryLocked ? 'disabled' : ''}>Cancel size edit</button></div><p class="helper-copy" id="studio-surface-feedback" role="status" aria-live="polite" hidden></p></form><div class="studio-inline-actions"><button data-studio="add-lamp" class="text-button" ${equipmentLocked || isCommission(study) || scene.lamps.length >= 2 ? 'disabled' : ''}>+ Lamp</button><button data-studio="remove-lamp" class="text-button" ${equipmentLocked || isCommission(study) || scene.lamps.length <= 1 ? 'disabled' : ''}>− Selected lamp</button><button data-studio="add-point" class="text-button" ${geometryLocked || scene.detectors.length >= 4 ? 'disabled' : ''}>+ Point</button><button data-studio="remove-point" class="text-button" ${geometryLocked || scene.detectors.length <= 2 ? 'disabled' : ''}>− Selected point</button><button data-studio="add-screen" class="text-button" ${equipmentLocked || isCommission(study) || scene.screens.length >= 1 ? 'disabled' : ''}>+ Screen</button><button data-studio="remove-screen" class="text-button" ${equipmentLocked || isCommission(study) || !scene.screens.length ? 'disabled' : ''}>− Screen</button></div></details>
      <details class="studio-control-section" data-section="targets"><summary>Personal targets</summary><form data-form="targets"><div class="studio-form-row"><label>Minimum (lx)<input type="number" name="minLux" value="${study.targets.minLux}" min="0" max="100000" step="1" required ${isCommission(study) ? 'disabled' : ''}></label><label>Maximum (lx)<input type="number" name="maxLux" value="${study.targets.maxLux}" min="0" max="100000" step="1" required ${isCommission(study) ? 'disabled' : ''}></label><label>Point uniformity (%)<input type="number" name="minUniformity" value="${study.targets.minUniformity * 100}" min="0" max="100" step="1" required ${isCommission(study) ? 'disabled' : ''}></label><label>Intensity ceiling (cd)<input type="number" name="intensityBudget" value="${study.targets.intensityBudget ?? ''}" min="0" max="400" step="1" placeholder="Optional" ${isCommission(study) ? 'disabled' : ''}></label></div><p class="helper-copy">Your chosen study goals, not lighting standards. Uniformity covers selected points only.</p><button class="secondary" ${isCommission(study) ? 'disabled' : ''}>Update targets</button></form></details>
      <section class="studio-control-section"><h3>Same points, same targets</h3><div id="studio-comparison"></div></section><details class="studio-control-section" data-section="paths"><summary>Inspect calculated paths</summary><div id="studio-paths"></div></details><button class="text-button" data-studio="reset">Reset working equipment</button>`;
    for (const detail of panel.querySelectorAll('details')) detail.open = opened.get(detail.dataset.section) || false;
    if (renderMode === 'difference') for (const control of panel.querySelectorAll('input, textarea, select, button')) if (control.dataset.studio !== 'guide') control.disabled = true;
    const resetButton = panel.querySelector('[data-studio="reset"]'); if (resetButton) resetButton.disabled = equipmentLocked || Boolean(study.pending);
    inspectorKey = key; renderComparison(); updateInspectorValues(); restoreFocus(focused);
  }
  function updateInspectorValues() {
    const study = current(), scene = displayScene();
    const surfaceLocked = view().readOnly || isCommission(study) || Boolean(study.pending);
    if (surfaceLocked) surfaceEditor.reset();
    const surfaceValues = surfaceLocked ? { width: String(scene.width), depth: String(scene.depth) } : surfaceEditor.values();
    const summary = $('.studio-target-summary');
    if (summary) summary.textContent = `${scene.width} × ${scene.depth} m · ${study.targets.minLux}–${study.targets.maxLux} lx`;
    for (const input of $('#studio-inspector').querySelectorAll('[data-geometry]')) {
      const kind = input.dataset.kind;
      const item = kind === 'surface' ? scene : (kind === 'lamp' ? scene.lamps : kind === 'point' ? scene.detectors : scene.screens).find((entry) => entry.id === input.dataset.entity);
      if (!item) continue;
      if (kind === 'surface') {
        input.setAttribute('aria-describedby', 'studio-surface-help studio-surface-feedback');
        if (input.value !== surfaceValues[input.dataset.geometry]) input.value = surfaceValues[input.dataset.geometry];
        continue;
      }
      if (['x', 'x1', 'x2'].includes(input.dataset.geometry)) input.max = scene.width;
      if (['y', 'y1', 'y2'].includes(input.dataset.geometry)) input.max = scene.depth;
      if (input !== document.activeElement) {
        if (input.type === 'checkbox') input.checked = item[input.dataset.geometry];
        else input.value = item[input.dataset.geometry];
      }
    }
    for (const output of [['#studio-intensity-output', 'intensity', 'cd', 0], ['#studio-height-output', 'height', 'm', 2]]) {
      const lamp = scene.lamps.find((item) => item.id === selected?.id) || scene.lamps[0]; const node = $(output[0]); if (node) node.textContent = `${fixed(lamp[output[1]], output[3])} ${output[2]}`;
    }
    const screen = scene.screens.find((item) => item.id === selected?.id) || scene.screens[0]; if (screen && $('#studio-screen-height-output')) $('#studio-screen-height-output').textContent = `${fixed(screen.height, 2)} m`;
    renderSurfaceFeedback();
    const pathBox = $('#studio-paths'); if (pathBox) pathBox.innerHTML = proposedCovered() ? '<p>Run to inspect the proposed calculated paths.</p>' : evaluateScene(displayScene()).detectors.map((point) => `<p><strong>${esc(point.label)}</strong><br>${point.contributions.map((item) => `${esc(item.lampId)} · ${fixed(item.distance, 2)} m · ${fixed(Math.acos(Math.min(1, item.cosine)) * 180 / Math.PI, 1)}° from normal · ${item.blockedBy.length ? 'screened' : 'clear'} · ${fixed(item.lux)} lx`).join('<br>')}</p>`).join('');
  }
  function renderSurfaceFeedback() {
    const feedback = $('#studio-surface-feedback');
    if (feedback) { feedback.textContent = surfaceEditor.feedback; feedback.hidden = !surfaceEditor.feedback; }
    for (const input of root.querySelectorAll('[data-kind="surface"]')) input.setAttribute('aria-invalid', String(surfaceEditor.status === 'error'));
  }
  function comparison() {
    return comparisonState().result;
  }
  function renderComparison() {
    const box = $('#studio-comparison'); if (!box) return;
    const focused = captureFocus(), study = current(), compared = comparisonState(), result = compared.result;
    if (!result) { box.innerHTML = `<p class="helper-copy">${esc(compared.reason)}</p>`; return; }
    const select = (value, name) => `<label>${name}<select data-compare="${name === 'Option A' ? 'a' : 'b'}">${study.alternatives.map((item) => `<option value="${esc(item.id)}" ${item.id === value ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>`;
    const contributions = (items) => items.map((item) => `${esc(item.lampId)}: ${fixed(item.lux, 3)} lx (${item.blockedBy.length ? `screened by ${esc(item.blockedBy.join(', '))}` : 'clear path'})`).join('; ');
    const margins = result.matched ? `<details class="studio-comparison-detail"><summary>Check margins & lamp contributions</summary>${result.points.map((point) => `<p><strong>${esc(point.label)}</strong><br>A: ${point.aStatus.passed ? 'in range' : 'outside range'} · lower margin ${fixed(point.aStatus.belowMinimum)} lx · upper margin ${fixed(point.aStatus.belowMaximum)} lx<br>${contributions(point.aContributions)}<br>B: ${point.bStatus.passed ? 'in range' : 'outside range'} · lower margin ${fixed(point.bStatus.belowMinimum)} lx · upper margin ${fixed(point.bStatus.belowMaximum)} lx<br>${contributions(point.bContributions)}</p>`).join('')}<p class="helper-copy">A negative margin falls outside that bound. Point uniformity: A ${fixed(result.aSummary.uniformity * 100, 1)}%, B ${fixed(result.bSummary.uniformity * 100, 1)}%. Enabled intensity: A ${fixed(result.aSummary.totalIntensity, 1)} cd, B ${fixed(result.bSummary.totalIntensity, 1)} cd.</p></details>` : '';
    const detailsOpen = box.querySelector('.studio-comparison-detail')?.open;
    box.innerHTML = `<div class="studio-form-row">${select(compareA, 'Option A')}${select(compareB, 'Option B')}</div>${result.matched ? `<table class="studio-comparison-table"><caption>Target version ${study.targets.revision} · calculated lux</caption><thead><tr><th>Point</th><th>A</th><th>B</th><th>B − A</th></tr></thead><tbody>${result.points.map((point) => `<tr><th>${esc(point.label)}</th><td>${fixed(point.aLux)}</td><td>${fixed(point.bLux)}</td><td>${point.deltaLux > 0 ? '+' : ''}${fixed(point.deltaLux)}</td></tr>`).join('')}</tbody></table><p class="helper-copy">Matched surface and point coordinates. Other conditions may differ.</p>${margins}<div class="studio-inline-actions"><button class="secondary" data-render-mode="difference" ${compared.available ? '' : 'disabled'} title="${esc(compared.reason || 'View calculated Option B minus Option A')}">View difference</button><button class="secondary" data-studio="choose" ${study.pending || study.staged ? 'disabled' : ''}>Keep an arrangement</button></div>` : `<p class="form-error" role="status">${esc(result.reason)}</p>`}`;
    if (detailsOpen && box.querySelector('.studio-comparison-detail')) box.querySelector('.studio-comparison-detail').open = true;
    restoreFocus(focused);
  }
  function rememberEvidenceDrafts() {
    if (evidenceStudyId) {
      const fields = { ...evidenceDrafts.get(evidenceStudyId) };
      for (const form of $('.studio-evidence').querySelectorAll('form[data-form]')) if (!form.querySelector('[name]:disabled')) fields[form.dataset.form] = Object.fromEntries(new FormData(form));
      evidenceDrafts.set(evidenceStudyId, fields);
    }
  }
  function syncEvidenceControls() {
    const locked = Boolean(view().readOnly || current().pending), form = $('[data-form="option"]');
    for (const control of form?.querySelectorAll('input, button') || []) control.disabled = locked;
    const status = $('#studio-save-status');
    if (status) { status.hidden = !locked; status.textContent = current().pending ? 'Run or cancel the prediction before saving.' : 'Return to the working layout or edit a saved copy before saving.'; }
  }
  function renderEvidence() {
    const focused = captureFocus();
    const study = current();
    rememberEvidenceDrafts();
    evidenceStudyId = study.id;
    const saveLocked = Boolean(view().readOnly || study.pending);
    $('#studio-arrangements').innerHTML = `<h3>Saved arrangements</h3><form class="studio-save-option" data-form="option"><label class="sr-only" for="studio-option-name">Arrangement name</label><input id="studio-option-name" name="name" maxlength="100" ${saveLocked ? 'disabled' : ''} placeholder="Name this arrangement" required><button class="secondary" ${saveLocked ? 'disabled' : ''}>Save working layout</button></form>${saveLocked ? `<p class="helper-copy">${study.pending ? 'Run or cancel the prediction before saving.' : 'Return to the working layout or edit a saved copy before saving.'}</p>` : ''}${study.alternatives.length ? `<div class="studio-option-cards">${study.alternatives.map((item) => `<article><strong>${esc(item.name)}</strong><span>${item.scene.lamps.filter((lamp) => lamp.enabled).length} enabled lamp(s) · ${fixed(item.readings.totalIntensity, 0)} cd</span><small>${item.scene.width} × ${item.scene.depth} m · ${new Date(item.createdAt).toLocaleDateString()}${item.parentId ? ` · Copy of ${esc(study.alternatives.find((parent) => parent.id === item.parentId)?.name || item.parentId)}` : ''}</small><div><button class="text-button" data-option-view="${esc(item.id)}">Inspect</button><button class="text-button" data-restore="${esc(item.id)}">Edit a copy</button></div></article>`).join('')}</div>` : '<p class="helper-copy">Your first option freezes this scene. Further edits cannot change it.</p>'}`;
    const decision = study.decision, chosen = decision && study.alternatives.find((item) => item.id === decision.chosenId);
    $('#studio-decision').innerHTML = `<h3>${decision ? 'Your retained decision' : 'A choice you can explain'}</h3>${decision ? `<p><strong>${esc(chosen?.name || 'Saved arrangement')}</strong></p><p>${esc(decision.reason)}</p><p class="helper-copy">Next check: ${esc(decision.nextCheck)}</p><p class="helper-copy">Retained target version ${decision.targets.revision}. Later target edits do not rewrite this decision.</p><div class="studio-inline-actions"><button class="text-button" data-studio="use-decision">Use in my work</button><button class="text-button" data-studio="plan-check">Plan the check</button><button class="text-button" data-studio="export">Export evidence</button></div>` : '<p class="helper-copy">Keep two arrangements, compare them, and explain which you would try. A saved decision retains the targets and evidence used at that time.</p>'}`;
    $('#studio-experiment-count').textContent = `(${study.experiments.length})`;
    $('#studio-trials').innerHTML = study.experiments.length ? study.experiments.slice().reverse().map((record) => `<article class="studio-trial"><h3>${esc(record.after.readings.detectors.find((point) => point.id === record.detectorId).label)} · ${direction[record.actual]}</h3><span>Predicted ${direction[record.prediction].toLowerCase()} · ${new Date(record.createdAt).toLocaleString()}</span><blockquote>${esc(record.hypothesis || 'Older record: hypothesis was not retained.')}</blockquote><p>${esc(record.note)}</p><details><summary>Measured in the model</summary><p>${esc(record.explanation)}</p>${record.after.readings.detectors.map((point) => `<p>${esc(point.label)}: ${fixed(record.before.readings.detectors.find((entry) => entry.id === point.id)?.lux || 0)} → ${fixed(point.lux)} lx</p>`).join('')}</details></article>`).join('') : '<p class="helper-copy">No experiments yet. Commit a prediction, run a change, and explain the result to begin.</p>';
    renderObservations();
    const drafts = evidenceDrafts.get(study.id);
    if (drafts) {
      for (const [type, values] of Object.entries(drafts)) {
        const form = $(`.studio-evidence form[data-form="${type}"]`); if (!form) continue;
        for (const [name, value] of Object.entries(values)) { const input = form.elements.namedItem(name); if (input && name !== 'pointId') input.value = value; }
        if (type === 'observation') { updateObservationPoints(); if (values.pointId) form.elements.namedItem('pointId').value = values.pointId; }
      }
    }
    const form = $('[data-form="option"]');
    if (saveLocked && form?.nextElementSibling?.classList.contains('helper-copy')) form.nextElementSibling.id = 'studio-save-status';
    else form?.insertAdjacentHTML('afterend', '<p class="helper-copy" id="studio-save-status" hidden></p>');
    syncEvidenceControls();
    restoreFocus(focused);
  }
  function renderObservations() {
    const study = current();
    $('#studio-observation-form').innerHTML = study.alternatives.length ? `<form data-form="observation"><div class="studio-form-row"><label>Saved arrangement<select name="alternativeId" data-observation-option>${study.alternatives.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></label><label>Point<select name="pointId" id="studio-observation-point"></select></label><label>Observed illuminance (lx)<input name="lux" type="number" min="0" max="1000000" step="0.01" required placeholder="Your actual reading"></label><label>Instrument or method<input name="instrument" maxlength="200" required placeholder="Meter / measurement method"></label><label>Measured at<input name="observedAt" type="datetime-local" required></label><label>Context<input name="context" maxlength="2000" required placeholder="Other lamps, ambient light, surface…"></label></div><button class="secondary">Record real reading</button></form>` : '<p class="helper-copy">Save an arrangement first so an observation has a fixed configuration.</p>';
    updateObservationPoints();
    $('#studio-observation-list').innerHTML = study.observations.length ? `<table class="studio-comparison-table"><caption>Separate observations · observed minus calculated</caption><thead><tr><th>Point / arrangement</th><th>Observed lx</th><th>Calculated lx</th><th>Difference lx</th></tr></thead><tbody>${study.observations.map((record) => { const option = study.alternatives.find((item) => item.id === record.alternativeId); const point = option.scene.detectors.find((item) => item.id === record.pointId); return `<tr><th>${esc(point.label)}<small>${esc(option.name)} · ${esc(record.instrument)} · ${esc(record.context)}</small></th><td>${fixed(record.lux)}</td><td>${fixed(record.calculatedLux)}</td><td>${fixed(record.differenceLux)}</td></tr>`; }).join('')}</tbody></table>` : '<p class="helper-copy">No real readings recorded. Calculated values are never inserted here.</p>';
  }
  function updateObservationPoints() {
    const select = $('[data-observation-option]'), pointSelect = $('#studio-observation-point'); if (!select || !pointSelect) return;
    const option = current().alternatives.find((item) => item.id === select.value); pointSelect.innerHTML = option.scene.detectors.map((point) => `<option value="${esc(point.id)}">${esc(point.label)}</option>`).join('');
  }

  function render() {
    if (disposed || !getState().studio) return;
    const study = current(); if (!study) return;
    const focused = captureFocus();
    const switched = currentStudyId !== study.id;
    if (switched) { currentStudyId = study.id; optionView = null; compareA = ''; compareB = ''; selected = null; draftScene = null; surfaceEditor.reset(); predictionOpen = false; activeStep = 'arrange'; if (renderMode === 'difference') renderMode = 'layout'; inspectorKey = ''; $('#studio-prediction').innerHTML = ''; }
    if (study.kind === 'personal') lastPersonalStudyId = study.id;
    if (renderMode === 'difference' && !comparisonState().available) renderMode = 'layout';
    sameSelection(displayScene());
    $('#studio-title').textContent = presentStudyTitle(study);
    $('#studio-task').textContent = study.kind === 'commission' ? CHALLENGES.find((item) => item.id === study.challengeId).instruction : study.task || 'Compare arrangements. Keep the evidence behind your choice.';
    $('#studio-owner').textContent = `${study.example ? 'Example study · ' : ''}${owner(study)?.title || 'Recovered work · associate a project'}`;
    renderRail(); renderOptions(); renderMetrics(); renderActionbar(); renderWorkflow(); renderInspector();
    if (switched || !$('.studio-evidence').contains(document.activeElement)) renderEvidence();
    else { rememberEvidenceDrafts(); syncEvidenceControls(); }
    drawStage(); restoreFocus(focused);
  }
  function showStudies() {
    const state = getState();
    showDialog('Your lighting studies', `<p class="helper-copy">Studies retain their own project, scenes, decisions and unfinished experiments.</p><div class="studio-study-list">${state.studio.studies.map((study) => `<button class="studio-study-card" data-study-id="${esc(study.id)}"><strong>${esc(presentStudyTitle(study))}</strong><span>${esc(owner(study)?.title || 'Unassigned recovered work')} · ${esc(study.kind)}</span><small>${study.alternatives.length} arrangement(s) · ${study.experiments.length} experiment(s)${study.staged ? ' · unfinished conclusion' : study.pending ? ' · prediction committed' : ''}</small></button>`).join('')}</div><div class="studio-inline-actions"><button class="primary" data-studio="new">New personal study</button><label class="secondary studio-file-label">Import study JSON<input type="file" accept="application/json,.json" id="studio-import-file" hidden></label></div>`);
  }
  function showNewStudy() {
    showDialog('Give the light a purpose', `<form data-form="new-study"><p class="helper-copy">Start with the shared table, then change its dimensions, points and personal targets. No results or real readings are invented.</p><label>Study name<input name="title" maxlength="200" required placeholder="Light for our shared table"></label><label>What is the task?<textarea name="task" maxlength="2000" required rows="2" placeholder="A reading place and a drawing place should both be useful."></textarea></label><label>Question<input name="question" maxlength="1000" required placeholder="Which arrangement reaches both places without increasing every lamp?"></label><label>Project owner<select name="projectId" required><option value="">Choose explicitly…</option>${getState().projects.map((project) => `<option value="${esc(project.id)}">${esc(project.title)}</option>`).join('')}</select></label><button class="primary">Create study</button></form>`);
  }
  function showAssociate() {
    showDialog('Associate this study', `<form data-form="associate"><p class="helper-copy">The study and its evidence remain intact. This association controls where source-linked work and check plans belong.</p><label>Project owner<select name="projectId" required><option value="">Choose explicitly…</option>${getState().projects.map((project) => `<option value="${esc(project.id)}" ${current().projectId === project.id ? 'selected' : ''}>${esc(project.title)}</option>`).join('')}</select></label><button class="primary">Keep association</button></form>`);
  }
  function showChoose() {
    const study = current(), result = comparison();
    if (study.pending || study.staged) { message('Finish the current prediction or conclusion before retaining a decision.'); return; }
    if (!result?.matched) { message('Save two arrangements with common point geometry before choosing.'); return; }
    const state = getState(), sourceRefs = new Map();
    for (const reference of [...state.ideas.filter((idea) => idea.projectId === study.projectId), ...(study.decision?.sourceRefs || [])]) {
      const source = state.sources.find((item) => item.id === reference.sourceId && item.projectId === study.projectId);
      const paragraph = source?.paragraphs.find((item) => item.id === reference.paragraphId);
      if (source && paragraph) sourceRefs.set(`${source.id}/${paragraph.id}`, { source, paragraph, reference: { sourceId: source.id, paragraphId: paragraph.id } });
    }
    const options = [compareA, compareB].map((id) => `<option value="${esc(id)}" ${study.decision?.chosenId === id ? 'selected' : ''}>${esc(study.alternatives.find((item) => item.id === id).name)}</option>`).join('');
    const experiments = study.experiments.length ? study.experiments.map((item) => `<label class="studio-check"><input type="checkbox" name="experimentIds" value="${esc(item.id)}" ${study.decision?.experimentIds.includes(item.id) ? 'checked' : ''}>${esc(item.after.readings.detectors.find((point) => point.id === item.detectorId).label)} · ${direction[item.actual]}</label>`).join('') : '<p class="helper-copy">No finalized experiment exists yet.</p>';
    const passages = sourceRefs.size ? [...sourceRefs.values()].map(({ source, paragraph, reference }) => `<label class="studio-check"><input type="checkbox" name="sourceRefs" value="${esc(JSON.stringify(reference))}" ${study.decision?.sourceRefs.some((item) => item.sourceId === reference.sourceId && item.paragraphId === reference.paragraphId) ? 'checked' : ''}><span>${esc(source.title)}<small>${esc(paragraph.text.slice(0, 180))}${paragraph.text.length > 180 ? '…' : ''}</small></span></label>`).join('') : '<p class="helper-copy">Keep an idea from this project’s Library to link its exact source passage. The scientific field guide is included in every report.</p>';
    showDialog('Keep a decision you can check', `<form data-form="decision"><label>Arrangement to try<select name="chosenId">${options}</select></label><label>Why this arrangement?<textarea name="reason" maxlength="4000" rows="3" required>${esc(study.decision?.reason || '')}</textarea></label><label>What would you measure or check next?<textarea name="nextCheck" maxlength="4000" rows="2" required>${esc(study.decision?.nextCheck || '')}</textarea></label><fieldset class="studio-evidence-links"><legend>Link retained experimental evidence (optional)</legend>${experiments}</fieldset><fieldset class="studio-evidence-links"><legend>Link project source passages (optional)</legend>${passages}</fieldset><button class="primary">Keep this arrangement</button></form>`);
  }
  function showGuide() {
    showDialog('A field guide to useful light', `<p class="about-lead">A useful arrangement begins with a prediction you can check.</p>${LIGHT_SOURCES.map((source) => `<section class="studio-guide-section"><h3>${esc(source.title)}</h3><p>${esc(source.text)}</p><a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.publisher)} ↗</a></section>`).join('')}<p class="helper-copy">Warm field colours compress lux for visibility. The difference view uses a symmetric signed B-minus-A scale: amber means more light, blue means less, and zero is neutral. Day/night appearance does not add ambient light or change the calculations.</p><button class="primary" data-studio="read-source">Read and discuss the model in Desk</button>`);
  }
  function showExport() {
    const study = current();
    if (reportURL) URL.revokeObjectURL(reportURL);
    reportURL = URL.createObjectURL(new Blob([studyReportHTML(study, { sources: getState().sources })], { type: 'text/html;charset=utf-8' }));
    showDialog('Download this lighting study', `<p>Export ${esc(study.title)} with its scenes, personal targets, calculations, observations and retained evidence.</p><div class="studio-export-links"><a class="primary" href="${reportURL}" target="_blank" rel="noopener">Open printable study ↗</a><a class="secondary" href="${reportURL}" download="afterlight-study.html">Download report (.html)</a><button class="secondary" data-studio="csv" ${study.alternatives.length?'':'disabled'}>Readings for Excel (.csv)</button><button class="secondary" data-studio="json">Save study (.json)</button></div><p class="helper-copy"><strong>Report:</strong> scenes, results and evidence in a readable document; print it to PDF in your browser.</p><p class="helper-copy"><strong>Excel readings:</strong> calculated lux, targets and any meter observations at the reading places in your saved arrangements. ${study.alternatives.length?'Use it for your own charts or comparisons.':'Save an arrangement first to include its readings.'} CSV does not restore a study.</p><p class="helper-copy"><strong>Study JSON:</strong> a restorable copy of this lighting study. For all your readings, planner and projects, use Save backup in Backups and examples.</p>`);
  }

  listen(root, 'input', (event) => {
    const input = event.target;
    if (input.hasAttribute('data-conclusion')) {
      transact((state, study) => { if (!study.staged) throw Error('This result is no longer staged.'); study.staged.conclusion = input.value; }); return;
    }
    if (input.dataset.studyField) {
      if (renderMode === 'difference') return;
      if (!input.value.trim() && input.dataset.studyField === 'title') return;
      transact((state, study) => { study[input.dataset.studyField] = input.value; study.updatedAt = new Date().toISOString(); }); return;
    }
    if (input.dataset.pointLabel) {
      if (view().readOnly) return;
      if (!input.value.trim()) return;
      transact((state, study) => { if (study.pending || isCommission(study)) throw Error('Cancel the prediction before changing measurement geometry.'); const scene = copy(study.scene); scene.detectors.find((item) => item.id === input.dataset.pointLabel).label = input.value; updateScene(study, scene); }); return;
    }
    if (!input.dataset.geometry || input.disabled) return;
    if (input.dataset.kind === 'surface') {
      if (view().readOnly || current().pending || isCommission()) return;
      surfaceEditor.edit(input.dataset.geometry, input.value); renderSurfaceFeedback(); return;
    }
    if (input.type === 'number' && (!input.value || !input.validity.valid)) return;
    if (!['range','checkbox','number'].includes(input.type)) return;
    applyGeometry(input);
  });
  function applyGeometry(input) {
    if (input.disabled || input.dataset.kind === 'surface') return;
    const property = input.dataset.geometry, kind = input.dataset.kind;
    const value = input.type === 'checkbox' ? input.checked : Number(input.value);
    if (input.type !== 'checkbox' && (!input.value || !Number.isFinite(value) || value < Number(input.min) || value > Number(input.max))) { message('Enter a value within the labelled bounds.'); return; }
    const succeeded = transact((state, study) => {
      if (view().readOnly) throw Error('Return to the working proposal before editing equipment.');
      const scene = copy(study.scene);
      if (kind === 'point' && (study.pending || isCommission(study))) throw Error('Measurement points are fixed for this experiment.');
      if (kind !== 'point' && !allowed(kind, property, study)) throw Error('This condition is fixed for the commission.');
      const items = kind === 'lamp' ? scene.lamps : kind === 'point' ? scene.detectors : scene.screens;
      items.find((item) => item.id === input.dataset.entity)[property] = value;
      updateScene(study, scene);
    });
    if (!succeeded) {
      const scene = current().scene;
      const original = kind === 'surface' ? scene : (kind === 'lamp' ? scene.lamps : kind === 'point' ? scene.detectors : scene.screens).find((item) => item.id === input.dataset.entity);
      if (original) { if (input.type === 'checkbox') input.checked = original[property]; else input.value = original[property]; }
    }
  }
  listen(root, 'change', (event) => {
    const input = event.target;
    if (input.dataset.geometry && input.type === 'number') { if (input.dataset.kind !== 'surface') applyGeometry(input); return; }
    if (input.dataset.objectSelect) { selected = { kind: input.dataset.objectSelect, id: input.value }; renderInspector(true); drawStage(); return; }
    if (input.dataset.compare) {
      if (input.dataset.compare === 'a') { if (input.value === compareB) compareB = compareA; compareA = input.value; }
      else { if (input.value === compareA) compareA = compareB; compareB = input.value; }
      activeStep = 'compare'; render(); return;
    }
    if (input.hasAttribute('data-observation-option')) { updateObservationPoints(); return; }
    if (input.id === 'studio-import-file' && input.files?.[0]) importStudy(input.files[0]);
  });
  listen(root, 'submit', (event) => {
    const form = event.target.closest('[data-form]'); if (!form) return;
    event.preventDefault(); const values = new FormData(form), type = form.dataset.form;
    if (type === 'surface') {
      if (view().readOnly || current().pending || isCommission()) { message('Return to the editable personal layout and resolve its prediction before resizing the table.'); return; }
      for (const property of ['width', 'depth']) surfaceEditor.edit(property, form.querySelector(`[data-geometry="${property}"]`).value);
      surfaceEditor.apply(); render(); return;
    } else if (type === 'prediction') {
      if (transact((state, study) => { commitExperiment(study, { detectorId: values.get('detectorId'), prediction: values.get('prediction'), hypothesis: values.get('hypothesis').trim() }); })) { predictionOpen = false; pendingView = 'proposed'; optionView = null; inspectorKey = ''; render(); $('#studio-actionbar [data-studio="run"]')?.focus(); }
    } else if (type === 'option') {
      if (view().readOnly || current().pending) { message('Return to an editable working layout before saving an arrangement.'); return; }
      if (transact((state, study) => { saveAlternative(study, values.get('name').trim()); })) {
        const drafts = evidenceDrafts.get(current().id) || {}; drafts.option = { name: '' }; evidenceDrafts.set(current().id, drafts);
        const liveForm = $('[data-form="option"]'); liveForm?.reset(); renderEvidence(); renderComparison(); renderWorkflow(); message('Arrangement saved independently of the editable layout.');
      }
    } else if (type === 'targets') {
      if (renderMode === 'difference') { message('Return to the working layout before editing study targets.'); return; }
      transact((state, study) => updateTargets(study, { minLux: Number(values.get('minLux')), maxLux: Number(values.get('maxLux')), minUniformity: Number(values.get('minUniformity')) / 100, intensityBudget: values.get('intensityBudget') === '' ? null : Number(values.get('intensityBudget')) }));
    } else if (type === 'new-study') {
      if (transact((state) => { const study = createStudy({ projectId: values.get('projectId'), title: values.get('title').trim(), task: values.get('task').trim(), question: values.get('question').trim(), template: 'shared-table', example: false }); state.studio.studies.push(study); state.studio.activeStudyId = study.id; })) dialog.close();
    } else if (type === 'associate') {
      if (transact((state, study) => { study.projectId = values.get('projectId'); study.updatedAt = new Date().toISOString(); })) dialog.close();
    } else if (type === 'decision') {
      if (transact((state, study) => chooseAlternative(study, compareA, compareB, values.get('chosenId'), values.get('reason').trim(), values.get('nextCheck').trim(), { experimentIds: values.getAll('experimentIds'), sourceRefs: values.getAll('sourceRefs').map((value) => JSON.parse(value)) }))) { dialog.close(); message('Decision retained with the comparison, target version and linked evidence used.'); }
    } else if (type === 'observation') {
      const timestamp = new Date(values.get('observedAt'));
      if (!Number.isFinite(timestamp.getTime())) { message('Enter the actual measurement date and time.'); return; }
      const observedAt = timestamp.toISOString();
      if (transact((state, study) => addObservation(study, { alternativeId: values.get('alternativeId'), pointId: values.get('pointId'), lux: Number(values.get('lux')), instrument: values.get('instrument').trim(), observedAt, context: values.get('context').trim() }))) { form.reset(); renderObservations(); message('Observed and calculated readings remain separate.'); }
    }
  });
  async function importStudy(file) {
    try {
      if (file.size > 4000000) throw Error('Study JSON must be below 4 MB.');
      const envelope = JSON.parse(await file.text());
      if (envelope.format !== 'afterlight-study' || envelope.version !== 1) throw Error('Choose an Afterlight study export.');
      const imported = validateStudy(envelope.study, { projectIds: getState().projects.map((project) => project.id), sources: getState().sources });
      showDialog('Import this study', `<p><strong>${esc(imported.title)}</strong></p><p class="helper-copy">${esc(imported.task)}. The original file is preserved. Imported source links must exist in this workspace; use full workspace import to restore sources from another workspace.</p><form data-form="import-study"><label>Explicit project association<select name="projectId" required><option value="">Choose explicitly…</option>${getState().projects.map((project) => `<option value="${esc(project.id)}" ${project.id === imported.projectId ? 'selected' : ''}>${esc(project.title)}</option>`).join('')}</select></label><button class="primary">Keep imported study</button></form>`);
      const form = $('[data-form="import-study"]');
      form.addEventListener('submit', (event) => { event.preventDefault(); const projectId = new FormData(form).get('projectId'); if (transact((state) => { if (state.studio.studies.some((item) => item.id === imported.id)) throw Error('A study with this identity already exists. Your existing study is retained.'); const study = copy(imported); study.projectId = projectId; state.studio.studies.push(study); state.studio.activeStudyId = study.id; })) dialog.close(); });
    } catch (error) { message(error.message); }
  }

  function focusControls() {
    const panel = $('#studio-inspector');
    const input = panel.querySelector('[data-geometry]:not(:disabled)') || panel.querySelector('[data-compare]');
    (input || panel.querySelector('[data-studio="guide"]'))?.focus({ preventScroll: true });
    panel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  }
  function activateRoomShortcut(id) {
    if (disposed) return;
    if (id === 'book') { showGuide(); return; }
    if (id === 'table') {
      canvas.focus({ preventScroll: true });
      $('.studio-stage').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    if (id === 'notebook') {
      const record = $('#studio-record');
      record.focus({ preventScroll: true });
      record.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }
  }
  function returnToWorking() {
    optionView = null; pendingView = 'proposed';
    if (renderMode === 'difference') renderMode = 'layout';
    inspectorKey = '';
  }
  listen(root, 'keydown', (event) => {
    if (event.target === canvas && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); focusControls(); }
    if (event.key === 'Escape' && event.target.closest('[data-form="surface"]')) { event.preventDefault(); surfaceEditor.reset(); updateInspectorValues(); return; }
    if (event.key === 'Escape' && predictionOpen && !dialog.open) {
      event.preventDefault(); predictionOpen = false; render(); $('[data-flow="predict"]')?.focus({ preventScroll: true });
    }
  });

  listen(root, 'click', (event) => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    const action = button.dataset.studio;
    if (action === 'cancel-surface') { surfaceEditor.reset(); updateInspectorValues(); return; }
    if (button.dataset.commission) {
      const id = button.dataset.commission;
      transact((state) => {
        let study = id === 'free' ? state.studio.studies.find((item) => item.id === lastPersonalStudyId && item.kind === 'personal') || state.studio.studies.find((item) => item.kind === 'personal') : state.studio.studies.find((item) => item.kind === 'commission' && item.challengeId === id);
        if (!study) { if (id === 'free') { showNewStudy(); return; } study = createStudy({ projectId: current().projectId, template: id }); state.studio.studies.push(study); }
        state.studio.activeStudyId = study.id;
      }); return;
    }
    if (button.dataset.studyId) { if (transact((state) => { state.studio.activeStudyId = button.dataset.studyId; })) dialog.close(); return; }
    if (button.dataset.flow) {
      activeStep = button.dataset.flow;
      if (activeStep === 'arrange') { returnToWorking(); render(); focusControls(); }
      if (activeStep === 'predict') {
        returnToWorking();
        if (!current().pending && !current().staged) predictionOpen = true;
        render();
        if (current().staged) { $('#studio-result textarea')?.focus({ preventScroll: true }); $('#studio-result').scrollIntoView({ block: 'nearest', behavior: 'auto' }); }
        else if (current().pending) { $('#studio-actionbar [data-studio="run"]')?.focus({ preventScroll: true }); }
        else $('#studio-prediction textarea')?.focus({ preventScroll: true });
      }
      if (activeStep === 'compare') {
        const compared = comparisonState();
        if (compared.available) renderMode = 'difference';
        render(); $('#studio-comparison').scrollIntoView({ block: 'nearest', behavior: 'auto' }); $('#studio-comparison [data-compare]')?.focus({ preventScroll: true });
      }
      if (activeStep === 'choose') { renderWorkflow(); showChoose(); }
      return;
    }
    if (button.dataset.renderMode) {
      if (button.dataset.renderMode === 'difference' && !comparisonState().available) { message(comparisonState().reason); renderComparison(); return; }
      renderMode = button.dataset.renderMode; activeStep = renderMode === 'difference' ? 'compare' : 'arrange'; render(); return;
    }
    if (button.hasAttribute('data-option-view')) { optionView = button.dataset.optionView || null; if (renderMode === 'difference') renderMode = 'layout'; draftScene = null; inspectorKey = ''; activeStep = 'arrange'; render(); return; }
    if (button.dataset.pendingView) { pendingView = button.dataset.pendingView; inspectorKey = ''; render(); return; }
    if (button.dataset.selectPoint) { selected = { kind: 'point', id: button.dataset.selectPoint }; renderInspector(true); drawStage(); return; }
    if (button.dataset.selectKind) { const kind = button.dataset.selectKind, scene = displayScene(); selected = { kind, id: kind === 'lamp' ? scene.lamps[0].id : kind === 'point' ? scene.detectors[0].id : scene.screens[0]?.id }; renderInspector(true); drawStage(); return; }
    if (button.dataset.restore) { if (transact((state, study) => restoreAlternative(study, button.dataset.restore))) { returnToWorking(); activeStep = 'arrange'; render(); focusControls(); } return; }
    if (action === 'studies') showStudies();
    if (action === 'new') showNewStudy();
    if (action === 'associate') showAssociate();
    if (action === 'close-dialog') dialog.close();
    if (action === 'guide') activateRoomShortcut('book');
    if (action === 'record') activateRoomShortcut('notebook');
    if (action === 'return-table') activateRoomShortcut('table');
    if (action === 'read-source') { dialog.close(); onReadSource?.(copy(current())); }
    if (action === 'export') showExport();
    if (action === 'csv') download('afterlight-calculated-readings.csv', studyCSV(current()), 'text/csv;charset=utf-8');
    if (action === 'json') download('afterlight-study.json', JSON.stringify({ format: 'afterlight-study', version: 1, exportedAt: new Date().toISOString(), study: validateStudy(current()) }, null, 2));
    if (action === 'choose') { activeStep = 'choose'; renderWorkflow(); showChoose(); }
    if (action === 'use-decision') { if (!current().projectId) { showAssociate(); return; } onUseDecision?.(copy(current())); }
    if (action === 'plan-check') { if (!current().projectId) { showAssociate(); return; } onPlanCheck?.(copy(current())); }
    if (action === 'inspect') focusControls();
    if (action === 'predict') { if (view().readOnly) { message('Return to the working layout or edit a saved copy before experimenting.'); return; } activeStep = 'predict'; predictionOpen = !predictionOpen; renderPrediction(); renderWorkflow(); if (predictionOpen) $('#studio-prediction textarea')?.focus({ preventScroll: true }); }
    if (action === 'close-prediction') { predictionOpen = false; renderPrediction(); renderWorkflow(); $('[data-flow="predict"]')?.focus({ preventScroll: true }); }
    if (action === 'run') {
      if (transact((state, study) => runExperiment(study))) { pendingView = 'proposed'; optionView = null; render(); $('#studio-result textarea')?.focus({ preventScroll: true }); $('#studio-result').scrollIntoView({ block: 'nearest', behavior: 'auto' }); }
    }
    if (action === 'cancel') { if (transact((state, study) => { study.pending = null; })) { pendingView = 'proposed'; render(); } }
    if (action === 'show-result') { $('#studio-result').hidden = false; $('#studio-result textarea')?.focus({ preventScroll: true }); $('#studio-result').scrollIntoView({ block: 'nearest', behavior: 'auto' }); }
    if (action === 'finalize') {
      const conclusion = $('#studio-result textarea')?.value ?? current().staged?.conclusion ?? '';
      if (transact((state, study) => finalizeExperiment(study, conclusion, study.staged.id))) { message('Hypothesis, exact scenes and conclusion retained once.'); renderEvidence(); }
    }
    if (action === 'discard') { showDialog('Discard this unfinished result?', '<p>The finalized notebook entries remain. This unfinished result and its conclusion will be removed.</p><div class="studio-inline-actions"><button class="secondary danger" data-studio="confirm-discard">Discard result</button><button class="secondary" data-studio="close-dialog">Keep working</button></div>'); }
    if (action === 'confirm-discard') { if (transact((state, study) => discardExperiment(study))) dialog.close(); }
    if (action === 'save-option-focus') { $('#studio-option-name')?.focus(); $('#studio-arrangements').scrollIntoView({ behavior: 'auto', block: 'nearest' }); }
    if (action === 'reset') {
      if (view().readOnly || current().pending) { message('Return to the working layout and resolve the prediction before resetting equipment.'); return; }
      surfaceEditor.reset();
      transact((state, study) => { const reset = isCommission(study) ? copy(CHALLENGES.find((item) => item.id === study.challengeId).scene) : createStudy({ projectId: study.projectId, template: 'shared-table' }).scene; updateScene(study, reset); study.workingParentId = null; }, { rebuild: true });
    }
    if (['add-lamp', 'remove-lamp', 'add-point', 'remove-point', 'add-screen', 'remove-screen'].includes(action)) {
      transact((state, study) => {
        if (isCommission(study) || view().readOnly) throw Error('This equipment is fixed for the commission or saved arrangement.');
        const scene = copy(study.scene);
        if (action === 'add-lamp') { if (scene.lamps.length >= 2) throw Error('The studio supports two lamps.'); scene.lamps.push({ id: uid('lamp'), x: portion(scene.width, 2 / 3), y: portion(scene.depth, .5), height: 0.5, intensity: 40, enabled: true }); }
        if (action === 'remove-lamp') { if (scene.lamps.length <= 1) throw Error('Keep at least one lamp.'); scene.lamps = scene.lamps.filter((item) => item.id !== (selected.kind === 'lamp' ? selected.id : scene.lamps.at(-1).id)); }
        if (action === 'add-point') { if (study.pending) throw Error('Cancel the prediction before changing points.'); scene.detectors.push({ id: uid('point'), label: `Place ${scene.detectors.length + 1}`, x: portion(scene.width, .5), y: portion(scene.depth, .75) }); }
        if (action === 'remove-point') { if (study.pending || scene.detectors.length <= 2) throw Error('Keep at least two points and cancel committed predictions first.'); scene.detectors = scene.detectors.filter((item) => item.id !== (selected.kind === 'point' ? selected.id : scene.detectors.at(-1).id)); }
        if (action === 'add-screen') { scene.screens.push({ id: uid('screen'), x1: portion(scene.width, .5), y1: portion(scene.depth, .25), x2: portion(scene.width, .5), y2: portion(scene.depth, .75), height: 0.4, enabled: true }); }
        if (action === 'remove-screen') scene.screens = scene.screens.filter((item) => item.id !== (selected.kind.startsWith('screen') ? selected.id : scene.screens.at(-1).id));
        updateScene(study, scene);
      }, { rebuild: true });
    }
  });

  return {
    render,
    sourceText() { return `# Afterlight · Light you can predict and use\n\nFor an ideal point lamp above a horizontal detector, E = I*h/(dx²+dy²+h²)^(3/2). Directly below the lamp, E = I/h². Contributions from independent clear lamps add. Opaque vertical screens block a ray that intersects at or below their top.\n\nCalculated lux and separately recorded real readings are different evidence. Comparing arrangements requires the same surface and labelled point coordinates. A personal target is a chosen design goal, not a lighting standard. Candela is intensity, not electrical watts.\n\nThe model excludes ambient light, reflection, diffraction, finite fixture size and spectral changes. Point uniformity only covers the selected points. Multiple changed conditions do not isolate one cause.\n\n${LIGHT_SOURCES.map((source) => `${source.title}\n${source.text}\n${source.publisher}: ${source.url}`).join('\n\n')}`; },
    openStudies: showStudies,
    openGuide: showGuide,
    destroy() { disposed = true; renderer.destroy(); eventRemovers.forEach((remove) => remove()); if (reportURL) URL.revokeObjectURL(reportURL); }
  };
}
