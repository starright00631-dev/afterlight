import { compareAlternatives } from './studies.js';

// Presentation only: the original title remains in the stored study and exports.
export function presentStudyTitle(study) {
  return study.example && study.kind === 'personal' && study.title === 'Example · A shared table'
    ? 'The Reading Room' : study.title;
}

export function resolveStudioComparison(study, aId = '', bId = '') {
  const alternatives = study.alternatives;
  if (alternatives.length < 2) return { aId: '', bId: '', result: null, available: false, reason: 'Save two arrangements with the same surface and measurement points.' };
  const valid = (id) => alternatives.some((option) => option.id === id);
  if (valid(aId) && valid(bId) && aId === bId) return { aId, bId, result: null, available: false, reason: 'Choose two different retained arrangements for Option A and Option B.' };
  const selectedA = valid(aId) ? aId : valid(study.decision?.aId) ? study.decision.aId : alternatives[0].id;
  const selectedB = valid(bId) && bId !== selectedA ? bId : valid(study.decision?.bId) && study.decision.bId !== selectedA ? study.decision.bId : alternatives.findLast((option) => option.id !== selectedA).id;
  const result = compareAlternatives(study, selectedA, selectedB);
  return { aId: selectedA, bId: selectedB, result, available: result.matched && !study.pending, reason: study.pending ? 'Run or cancel the committed prediction before viewing a difference.' : result.matched ? '' : result.reason };
}

export function resolveStudioView(study, { mode = 'layout', optionId = null, pendingView = 'proposed', draftScene = null, aId = '', bId = '' } = {}) {
  const compared = resolveStudioComparison(study, aId, bId);
  if (mode === 'difference' && compared.available) {
    const aScene = study.alternatives.find((option) => option.id === compared.aId).scene;
    const bScene = study.alternatives.find((option) => option.id === compared.bId).scene;
    return { scene: bScene, readOnly: true, proposed: false, comparison: { aScene, bScene }, compared };
  }
  const option = study.alternatives.find((item) => item.id === optionId);
  const baseline = Boolean(study.pending && pendingView === 'baseline' && !option);
  return {
    scene: option?.scene || (baseline ? study.pending.beforeScene : draftScene || study.scene),
    readOnly: Boolean(option || baseline),
    proposed: Boolean(study.pending && !baseline && !option),
    comparison: undefined,
    compared
  };
}

export function studioWorkflowState(study, { predictionOpen = false, mode = 'layout', activeStep = 'arrange', aId = '', bId = '' } = {}) {
  const compared = resolveStudioComparison(study, aId, bId);
  const busy = Boolean(study.pending || study.staged);
  const current = busy || predictionOpen ? 'predict' : mode === 'difference' ? 'compare' : activeStep;
  return {
    current,
    canCompare: study.alternatives.length >= 2 && !study.pending,
    canChoose: compared.available && !busy,
    arrange: study.pending ? 'Change equipment' : 'Edit the working layout',
    predict: study.staged ? 'Explain the result' : study.pending ? 'Prediction retained' : study.experiments.length ? `${study.experiments.length} explained result${study.experiments.length === 1 ? '' : 's'}` : 'Test one change',
    compare: study.alternatives.length >= 2 ? `${study.alternatives.length} saved arrangements` : `${study.alternatives.length} of 2 arrangements`,
    choose: study.decision ? 'Decision retained' : 'Keep a reason & next check'
  };
}
