/** Original study rules. The same optics evaluator supplies every screen and export.
 * Mutators operate on the caller's draft; the UI commits that whole draft atomically. */
import {OPTICS_MODEL_VERSION, LIGHT_SOURCES, getChallenge, validateScene, evaluateScene, sampleField, challengeVerdict, makeExperiment, validateLabState} from './optics.js';

export const STUDY_LIMITS = Object.freeze({studies:30, alternatives:30, experiments:100, observations:200, text:6000});
export const STUDY_MODEL_LIMITS = 'Ideal isotropic point lamps and direct light on horizontal points; opaque vertical screens. No ambient light, reflections, diffraction, spectrum or extended fixtures. Candela is not electrical watts. Targets are personal goals, not lighting standards. Statistics concern selected points, not the whole surface.';
const copy = value => structuredClone(value);
const now = () => new Date().toISOString();
const uid = prefix => `${prefix}-${crypto.randomUUID()}`;
function object(value,name){if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${name} must be an object.`);return value;}
function text(value,max,name,empty=false){if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw new TypeError(`Invalid ${name}.`);return value;}
function id(value,name='identity'){text(value,120,name);if(!/^[A-Za-z0-9_.:-]+$/.test(value))throw new TypeError(`Invalid ${name}.`);return value;}
function number(value,min,max,name){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new RangeError(`Invalid ${name}.`);return value;}
function integer(value,min,max,name){number(value,min,max,name);if(!Number.isSafeInteger(value))throw new RangeError(`Invalid ${name}.`);return value;}
function bool(value,name){if(typeof value!=='boolean')throw new TypeError(`Invalid ${name}.`);return value;}
function time(value){text(value,30,'timestamp');if(!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new TypeError('Use a canonical ISO timestamp.');return value;}
function list(value,max,name){if(!Array.isArray(value)||value.length>max)throw new RangeError(`${name} supports at most ${max} records.`);for(let i=0;i<value.length;i++)if(!(i in value))throw new TypeError(`Sparse ${name}.`);return value;}
function version(value){if(value!==OPTICS_MODEL_VERSION)throw new TypeError(`Unsupported optical model version: ${String(value)}.`);return value;}
function same(a,b){return a===b||(typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(a),Math.abs(b)));}
function equal(actual,expected){if(typeof expected==='number')return same(actual,expected);if(Array.isArray(expected))return Array.isArray(actual)&&actual.length===expected.length&&expected.every((v,i)=>equal(actual[i],v));if(expected&&typeof expected==='object')return !!actual&&typeof actual==='object'&&!Array.isArray(actual)&&Object.entries(expected).every(([k,v])=>equal(actual[k],v));return actual===expected;}
const nullableId=(value,name)=>value===null?null:id(value,name);
const touch=study=>{study.updatedAt=now();};
const targetDefaults=()=>({revision:1,minLux:150,maxLux:200,minUniformity:0.9,intensityBudget:null});

export function validateTargets(input){
  object(input,'targets');const minLux=number(input.minLux,0,1e7,'minimum lux'),maxLux=number(input.maxLux,0,1e7,'maximum lux');
  if(minLux>maxLux)throw new RangeError('The minimum lux cannot exceed the maximum.');
  return {revision:integer(input.revision,1,1000000,'target revision'),minLux,maxLux,minUniformity:number(input.minUniformity,0,1,'point uniformity'),intensityBudget:input.intensityBudget===null?null:number(input.intensityBudget,0,400,'intensity budget')};
}
function defaultScene(){return {width:2.4,depth:1.2,lamps:[{id:'lamp-a',x:0.8,y:0.6,height:0.5,intensity:60,enabled:true}],detectors:[{id:'point-a',label:'Workspace A',x:0.8,y:0.6},{id:'point-b',label:'Workspace B',x:1.6,y:0.6}],screens:[]};}
function personalScene(input){const scene=validateScene(input);if(scene.detectors.length<2||scene.screens.length>1)throw new RangeError('Personal studies require two to four points and at most one screen.');return scene;}
export function createStudy({projectId,title,task='',question='',template='shared-table',example=true,id:studyId=uid('study'),createdAt=now()}={}){
  id(projectId,'project');const commission=['distance','shadow','balance'].includes(template);
  if(!commission&&!['shared-table','free'].includes(template))throw new RangeError('Unknown study template.');
  const challenge=commission?getChallenge(template):null;
  const targets=targetDefaults();if(template==='distance')Object.assign(targets,{minLux:180,maxLux:220,minUniformity:0});
  if(template==='shadow')Object.assign(targets,{minLux:30,maxLux:1e7,minUniformity:0});
  if(template==='balance')targets.intensityBudget=90;
  return validateStudy({version:1,id:studyId,projectId,kind:commission?'commission':'personal',challengeId:commission?template:'free',title:title||(commission?challenge.title:example?'Example · A shared table':'My light study'),task:task||(commission?challenge.instruction:'Compare light at two work points on a shared table.'),question:question||'Which arrangement meets the point targets, and what should I check in reality?',example,createdAt,updatedAt:createdAt,modelVersion:OPTICS_MODEL_VERSION,geometryRevision:1,targets,scene:commission?challenge.scene:defaultScene(),alternatives:[],experiments:[],pending:null,staged:null,decision:null,observations:[],lastFinalizedId:null});
}
export function createStudio(projectId){const studies=[createStudy({projectId}),...['distance','shadow','balance'].map(template=>createStudy({projectId,template}))];return {version:1,activeStudyId:studies[0].id,studies};}
export function activeStudy(studio){return studio.studies.find(study=>study.id===studio.activeStudyId)||null;}
export function geometryMatches(a,b){
  return same(a.width,b.width)&&same(a.depth,b.depth)&&a.detectors.length===b.detectors.length&&a.detectors.every(p=>{const q=b.detectors.find(x=>x.id===p.id);return !!q&&same(p.x,q.x)&&same(p.y,q.y);});
}
export function updateScene(study,input){
  const scene=study.kind==='personal'?personalScene(input):validateScene(input);
  if(study.pending&&!geometryMatches(study.pending.beforeScene,scene))throw new RangeError('Cancel the committed prediction before changing measurement geometry.');
  if(!geometryMatches(study.scene,scene))study.geometryRevision+=1;
  study.scene=scene;touch(study);return study;
}
export function updateTargets(study,input){study.targets=validateTargets({...study.targets,...input,revision:study.targets.revision+1});touch(study);return study.targets;}
function pointStatus(value,targets){return {passed:value>=targets.minLux-1e-10&&value<=targets.maxLux+1e-10,belowMinimum:value-targets.minLux,belowMaximum:targets.maxLux-value};}
function summarize(readings,targets){return {...copy(readings),rangePassed:readings.detectors.every(p=>pointStatus(p.lux,targets).passed),uniformityPassed:readings.uniformity>=targets.minUniformity-1e-10,intensityPassed:targets.intensityBudget===null||readings.totalIntensity<=targets.intensityBudget+1e-10};}
export function studyVerdict(study){
  const readings=evaluateScene(study.scene),summary=summarize(readings,study.targets),points=readings.detectors.map(p=>({...p,...pointStatus(p.lux,study.targets)}));
  const authored=study.kind==='commission'?challengeVerdict(study.challengeId,study.scene):null;
  const checks=authored?.checks||[{label:'Every selected point is in your range',passed:summary.rangePassed},{label:'Selected-point uniformity meets your goal',passed:summary.uniformityPassed},{label:'Enabled intensity meets your budget',passed:summary.intensityPassed}];
  const targetSatisfied=authored?authored.passed:checks.every(c=>c.passed);
  const evidenceComplete=study.experiments.some(e=>e.challengeId===study.challengeId&&e.hypothesis.trim()&&e.note.trim()&&(study.kind!=='commission'||challengeVerdict(study.challengeId,e.after.scene).passed));
  return {passed:targetSatisfied,checks,readings,points,summary,explanation:authored?.explanation||'Personal goals apply only to these selected horizontal points in the ideal model.',commission:{targetSatisfied,evidenceComplete,completed:targetSatisfied&&evidenceComplete}};
}
function option(study,alternativeId){const found=study.alternatives.find(a=>a.id===alternativeId);if(!found)throw new RangeError('The saved arrangement is missing.');return found;}
export function saveAlternative(study,name,{parentId=study.workingParentId??null}={}){
  if(study.pending)throw new RangeError('Run or cancel the committed prediction before saving its proposed arrangement.');
  if(study.alternatives.length>=STUDY_LIMITS.alternatives)throw new RangeError('This study has reached its saved-arrangement limit.');
  if(parentId!==null)option(study,parentId);
  const scene=validateScene(study.scene),record={id:uid('alternative'),name:text(name,160,'arrangement name'),parentId,createdAt:now(),modelVersion:OPTICS_MODEL_VERSION,geometryRevision:study.geometryRevision,scene,readings:evaluateScene(scene)};
  study.alternatives.push(record);study.workingParentId=record.id;touch(study);return record;
}
export function restoreAlternative(study,alternativeId){updateScene(study,option(study,alternativeId).scene);study.workingParentId=alternativeId;return study;}
function comparison(study,aId,bId,targets){
  const a=copy(option(study,aId)),b=copy(option(study,bId));a.readings=evaluateScene(a.scene);b.readings=evaluateScene(b.scene);
  const matched=geometryMatches(a.scene,b.scene),aSummary=summarize(a.readings,targets),bSummary=summarize(b.readings,targets);
  const points=matched?a.scene.detectors.map(point=>{const ar=a.readings.detectors.find(p=>p.id===point.id),br=b.readings.detectors.find(p=>p.id===point.id);return {id:point.id,label:point.label,x:point.x,y:point.y,aLux:ar.lux,bLux:br.lux,deltaLux:br.lux-ar.lux,aContributions:copy(ar.contributions),bContributions:copy(br.contributions),aStatus:pointStatus(ar.lux,targets),bStatus:pointStatus(br.lux,targets)};}):[];
  return {matched,reason:matched?'Same surface and measurement points.':'Different measurement setups: branch an arrangement with common surface dimensions and stable point coordinates before making a matched comparison.',modelVersion:OPTICS_MODEL_VERSION,a,b,targets:copy(targets),points,aSummary,bSummary};
}
export function compareAlternatives(study,aId,bId){return comparison(study,aId,bId,validateTargets(study.targets));}
export function chooseAlternative(study,aId,bId,chosenId,reason,nextCheck='',{experimentIds=[],sourceRefs=[]}={}){
  if(aId===bId)throw new RangeError('Choose two distinct arrangements for a decision.');
  const compared=compareAlternatives(study,aId,bId);if(!compared.matched)throw new RangeError(compared.reason);
  if(![aId,bId].includes(chosenId))throw new RangeError('The choice must be one of the compared arrangements.');
  for(const experimentId of experimentIds)if(!study.experiments.some(e=>e.id===experimentId))throw new RangeError('Decision experiment evidence is missing.');
  const decision={aId,bId,chosenId,reason:text(reason,6000,'decision reason'),nextCheck:text(nextCheck,4000,'next check',true),createdAt:now(),modelVersion:OPTICS_MODEL_VERSION,targets:copy(study.targets),comparison:compared,experimentIds:copy(experimentIds),sourceRefs:copy(sourceRefs)};
  // Internal references and snapshots are checked now; workspace validation checks source ownership.
  validateDecision(decision,study);study.decision=decision;touch(study);return decision;
}
export function commitExperiment(study,{detectorId,prediction,hypothesis}){
  if(study.pending)throw new RangeError('A prediction is already committed.');
  if(study.staged)throw new RangeError('Finalize or explicitly discard the unfinished result before another experiment.');
  if(!study.scene.detectors.some(p=>p.id===detectorId))throw new RangeError('Choose an existing measurement point.');
  if(!['increase','decrease','same'].includes(prediction))throw new RangeError('Choose brighter, dimmer or unchanged.');
  const pending={id:uid('experiment'),beforeScene:validateScene(study.scene),challengeId:study.challengeId,detectorId,prediction,hypothesis:text(hypothesis,4000,'hypothesis'),committedAt:now()};
  study.pending=pending;touch(study);return pending;
}
export function runExperiment(study){
  if(study.staged)throw new RangeError('Resolve the unfinished result before another Run.');
  const pending=study.pending;if(!pending)throw new RangeError('Commit a prediction first.');
  if(!geometryMatches(pending.beforeScene,study.scene))throw new RangeError('The measurement setup changed; cancel and begin a new setup.');
  const result=makeExperiment(pending.beforeScene,study.scene,{id:pending.id,createdAt:pending.committedAt,challengeId:pending.challengeId,detectorId:pending.detectorId,prediction:pending.prediction,hypothesis:pending.hypothesis,note:''});
  if(result.changedControls===0)throw new RangeError('Change a lamp or screen before Run.');
  result.modelVersion=OPTICS_MODEL_VERSION;study.staged={id:pending.id,experiment:result,conclusion:''};study.pending=null;touch(study);return study.staged;
}
export function finalizeExperiment(study,conclusion,stageId=study.staged?.id||study.lastFinalizedId){
  if(!study.staged){const prior=study.experiments.find(e=>e.id===stageId);if(prior)return prior;throw new RangeError('There is no unfinished result to finalize.');}
  if(stageId!==study.staged.id)throw new RangeError('This finalization refers to a different result.');
  if(study.experiments.length>=STUDY_LIMITS.experiments)throw new RangeError('This study has reached its experiment limit.');
  const record=copy(study.staged.experiment);record.note=text(conclusion??study.staged.conclusion,4000,'conclusion');
  if(!study.experiments.some(e=>e.id===record.id))study.experiments.push(record);
  study.lastFinalizedId=record.id;study.staged=null;touch(study);return record;
}
export function discardExperiment(study){study.pending=null;study.staged=null;touch(study);return study;}
export function addObservation(study,{alternativeId,pointId,lux,instrument,observedAt=now(),context=''}){
  if(study.observations.length>=STUDY_LIMITS.observations)throw new RangeError('This study has reached its observation limit.');
  const a=option(study,alternativeId),point=evaluateScene(a.scene).detectors.find(p=>p.id===pointId);if(!point)throw new RangeError('The observed point is absent from this saved arrangement.');
  const observed=number(lux,0,1e9,'observed lux'),record={id:uid('observation'),alternativeId,pointId,lux:observed,instrument:text(instrument,500,'instrument or method'),observedAt:time(observedAt),context:text(context,4000,'observation context',true),modelVersion:OPTICS_MODEL_VERSION,calculatedLux:point.lux,differenceLux:observed-point.lux};
  study.observations.push(record);touch(study);return record;
}

function experimentRecord(raw){
  object(raw,'experiment');version(raw.modelVersion);
  const checked=makeExperiment(raw.before.scene,raw.after.scene,{id:raw.id,createdAt:raw.createdAt,challengeId:raw.challengeId,detectorId:raw.detectorId,prediction:raw.prediction,hypothesis:raw.hypothesis,note:raw.note});
  if(!equal(raw.before.readings,checked.before.readings)||!equal(raw.after.readings,checked.after.readings)||!same(raw.deltaLux,checked.deltaLux)||raw.actual!==checked.actual||raw.predictionCorrect!==checked.predictionCorrect||raw.changedControls!==checked.changedControls||raw.explanation!==checked.explanation)throw new TypeError('Study experiment does not match its scene evidence.');
  return {...checked,modelVersion:OPTICS_MODEL_VERSION};
}
function referenceContext(context){
  const projects=context.projectIds===undefined?null:new Set(context.projectIds);
  const sources=context.sources?new Map(context.sources.map(s=>[s.id,s])):null;
  const sourceIds=context.sourceIds===undefined?(sources?new Set(sources.keys()):null):new Set(context.sourceIds);
  return {projects,sources,sourceIds};
}
function validateSourceRefs(raw,study,context={}){
  const refs=list(raw,30,'source references').map(ref=>{object(ref,'source reference');return {sourceId:id(ref.sourceId,'source reference'),paragraphId:id(ref.paragraphId,'paragraph reference')};});
  if(new Set(refs.map(r=>`${r.sourceId}\0${r.paragraphId}`)).size!==refs.length)throw new RangeError('Duplicate source evidence.');
  const {sources,sourceIds}=referenceContext(context);
  for(const ref of refs){
    if(study.projectId===null)throw new RangeError('Associate recovered work with a project before linking source evidence.');
    if(sourceIds&&!sourceIds.has(ref.sourceId))throw new RangeError('Decision source evidence is missing.');
    if(sources){const source=sources.get(ref.sourceId);if(!source||source.projectId!==study.projectId||!source.paragraphs.some(p=>p.id===ref.paragraphId))throw new RangeError('Decision source passage must exist in this study’s project.');}
  }
  return refs;
}
function validateDecision(raw,study,context={}){
  object(raw,'decision');const aId=id(raw.aId),bId=id(raw.bId),chosenId=id(raw.chosenId);if(aId===bId||![aId,bId].includes(chosenId))throw new RangeError('Invalid chosen comparison.');
  version(raw.modelVersion);const targets=validateTargets(raw.targets),compared=comparison(study,aId,bId,targets);
  if(!compared.matched||!equal(raw.comparison,compared))throw new TypeError('The decision comparison does not match its retained evidence.');
  const experimentIds=list(raw.experimentIds,100,'experiment evidence').map(x=>id(x));if(new Set(experimentIds).size!==experimentIds.length||experimentIds.some(x=>!study.experiments.some(e=>e.id===x)))throw new RangeError('Decision experiment evidence is missing or duplicated.');
  return {aId,bId,chosenId,reason:text(raw.reason,6000,'decision reason'),nextCheck:text(raw.nextCheck,4000,'next check',true),createdAt:time(raw.createdAt),modelVersion:OPTICS_MODEL_VERSION,targets,comparison:compared,experimentIds,sourceRefs:validateSourceRefs(raw.sourceRefs,study,context)};
}
export function validateStudy(input,context={}){
  object(input,'study');if(input.version!==1)throw new TypeError('Unsupported study version.');
  const kind=input.kind;if(!['personal','commission','recovered'].includes(kind))throw new TypeError('Unknown study kind.');
  const projectId=nullableId(input.projectId,'project');if(projectId===null&&kind!=='recovered')throw new RangeError('New studies need an explicit project association.');
  const {projects}=referenceContext(context);if(projectId!==null&&projects&&!projects.has(projectId))throw new RangeError('Study project is missing.');
  const challengeId=getChallenge(input.challengeId).id;if(kind==='personal'&&challengeId!=='free')throw new RangeError('Personal studies use the open model.');if(kind==='commission'&&challengeId==='free')throw new RangeError('A commission needs an authored challenge.');
  const study={version:1,id:id(input.id,'study ID'),projectId,kind,challengeId,title:text(input.title,300,'study title'),task:text(input.task,4000,'task',true),question:text(input.question,4000,'question',true),example:bool(input.example,'example marker'),createdAt:time(input.createdAt),updatedAt:time(input.updatedAt),modelVersion:version(input.modelVersion),geometryRevision:integer(input.geometryRevision,1,1000000,'geometry revision'),targets:validateTargets(input.targets),scene:kind==='personal'?personalScene(input.scene):validateScene(input.scene),alternatives:[],experiments:[],pending:null,staged:null,decision:null,observations:[],lastFinalizedId:nullableId(input.lastFinalizedId,'finalized experiment')};
  const identities=new Set([study.id]);const unique=(value,name)=>{id(value,name);if(identities.has(value))throw new RangeError(`Duplicate ${name}.`);identities.add(value);return value;};
  study.alternatives=list(input.alternatives,STUDY_LIMITS.alternatives,'alternatives').map(raw=>{
    object(raw,'arrangement');const scene=validateScene(raw.scene),readings=evaluateScene(scene);version(raw.modelVersion);
    if(!equal(raw.readings,readings))throw new TypeError('Saved arrangement readings do not match its scene evidence.');
    return {id:unique(raw.id,'arrangement ID'),name:text(raw.name,160,'arrangement name'),parentId:nullableId(raw.parentId,'parent arrangement'),createdAt:time(raw.createdAt),modelVersion:OPTICS_MODEL_VERSION,geometryRevision:integer(raw.geometryRevision,1,1000000,'arrangement geometry revision'),scene,readings};
  });
  for(const alternative of study.alternatives){if(alternative.parentId!==null&&!study.alternatives.some(a=>a.id===alternative.parentId))throw new RangeError('Parent arrangement is missing.');let cursor=alternative,seen=new Set();while(cursor.parentId!==null){if(seen.has(cursor.id))throw new RangeError('Arrangement branch ancestry contains a cycle.');seen.add(cursor.id);cursor=study.alternatives.find(a=>a.id===cursor.parentId);}}
  study.workingParentId=nullableId(input.workingParentId??null,'working parent arrangement');
  if(study.workingParentId!==null)option(study,study.workingParentId);
  study.experiments=list(input.experiments,STUDY_LIMITS.experiments,'experiments').map(raw=>{const e=experimentRecord(raw);unique(e.id,'experiment ID');return e;});
  if(study.lastFinalizedId!==null&&!study.experiments.some(e=>e.id===study.lastFinalizedId))throw new RangeError('Finalized experiment is missing.');
  if(input.pending!==null){const raw=object(input.pending,'committed prediction'),beforeScene=validateScene(raw.beforeScene);unique(raw.id,'prediction ID');const pendingChallenge=getChallenge(raw.challengeId).id;if(pendingChallenge!==challengeId||!geometryMatches(beforeScene,study.scene)||!beforeScene.detectors.some(p=>p.id===raw.detectorId))throw new RangeError('Committed prediction requires its original measurement setup.');if(!['increase','decrease','same'].includes(raw.prediction))throw new RangeError('Invalid prediction.');study.pending={id:raw.id,beforeScene,challengeId:pendingChallenge,detectorId:id(raw.detectorId),prediction:raw.prediction,hypothesis:text(raw.hypothesis,4000,'hypothesis',kind==='recovered'),committedAt:time(raw.committedAt)};}
  if(input.staged!==null){const raw=object(input.staged,'unfinished result'),experiment=experimentRecord(raw.experiment);unique(raw.id,'staged result ID');if(raw.id!==experiment.id)throw new RangeError('The result identity must match its experiment.');study.staged={id:raw.id,experiment,conclusion:text(raw.conclusion,4000,'unfinished conclusion',true)};}
  if(study.pending&&study.staged)throw new RangeError('Resolve the unfinished result before committing another prediction.');
  study.observations=list(input.observations,STUDY_LIMITS.observations,'observations').map(raw=>{object(raw,'observation');version(raw.modelVersion);const a=option(study,id(raw.alternativeId)),point=a.readings.detectors.find(p=>p.id===raw.pointId);if(!point)throw new RangeError('Observed point is missing from its retained arrangement.');const lux=number(raw.lux,0,1e9,'observed lux');if(!same(raw.calculatedLux,point.lux)||!same(raw.differenceLux,lux-point.lux))throw new TypeError('Observation comparison does not match its saved arrangement.');return {id:unique(raw.id,'observation ID'),alternativeId:a.id,pointId:point.id,lux,instrument:text(raw.instrument,500,'instrument or method'),observedAt:time(raw.observedAt),context:text(raw.context,4000,'observation context',true),modelVersion:OPTICS_MODEL_VERSION,calculatedLux:point.lux,differenceLux:lux-point.lux};});
  if(input.decision!==null)study.decision=validateDecision(input.decision,study,context);
  return study;
}
export function validateStudio(input,context={}){
  object(input,'studio');if(input.version!==1)throw new TypeError('Unsupported studio version.');
  const stableContext={...context,projectIds:context.projectIds===undefined?undefined:[...context.projectIds],sourceIds:context.sourceIds===undefined?undefined:[...context.sourceIds]};
  const studies=list(input.studies,STUDY_LIMITS.studies,'studies').map(study=>validateStudy(study,stableContext));if(!studies.length)throw new RangeError('At least one lighting study is required.');
  if(new Set(studies.map(s=>s.id)).size!==studies.length)throw new RangeError('Study IDs must be unique.');
  const activeStudyId=id(input.activeStudyId);if(!studies.some(s=>s.id===activeStudyId))throw new RangeError('The active lighting study is missing.');return {version:1,activeStudyId,studies};
}
export function recoverLegacyStudy(input){
  const lab=validateLabState(input),createdAt=lab.pending?.committedAt||lab.experiments[0]?.createdAt||now();
  const study=createStudy({projectId:'temporary-owner',template:'shared-table',id:'study-recovered-legacy',createdAt});
  Object.assign(study,{projectId:null,kind:'recovered',challengeId:lab.challengeId,title:'Recovered · Previous light notebook',task:'Unassigned legacy work. Associate it explicitly before linking project sources.',question:'What did the original experiment establish?',example:false,scene:copy(lab.scene),experiments:lab.experiments.map(e=>({...copy(e),modelVersion:OPTICS_MODEL_VERSION}))});
  if(lab.pending){let pendingId='experiment-recovered-pending';while(study.experiments.some(e=>e.id===pendingId))pendingId+='-next';study.pending={id:pendingId,...copy(lab.pending)};}
  return validateStudy(study);
}
export function hasLegacyLabWork(lab){return !!lab&&(lab.experiments.length>0||lab.pending!==null||lab.challengeId!=='distance'||!equal(lab.scene,getChallenge('distance').scene));}

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fixed=value=>Number(value).toFixed(3);
function reportData(input,{sources=[]}={}){
  const study=validateStudy(input),decision=study.decision,targets=decision?.targets||study.targets;
  const alternatives=decision?[option(study,decision.aId),option(study,decision.bId)]:study.alternatives.length?study.alternatives:[{id:'current',name:study.pending?'Committed baseline · unfinished study':'Current layout · unfinished study',scene:study.pending?.beforeScene||study.scene,readings:evaluateScene(study.pending?.beforeScene||study.scene)}];
  const experiments=decision?study.experiments.filter(e=>decision.experimentIds.includes(e.id)):study.experiments;
  const linkedSources=(decision?.sourceRefs||[]).map(ref=>{const src=sources.find(s=>s.id===ref.sourceId);return {...ref,title:src?.title||ref.sourceId,quote:src?.paragraphs.find(p=>p.id===ref.paragraphId)?.text||''};});
  return {study,decision,targets,alternatives,experiments,linkedSources};
}
function sceneSVG(scene){
  const w=580,h=300,pad=25,sx=(w-2*pad)/scene.width,sy=(h-2*pad)/scene.depth,x=p=>pad+p*sx,y=p=>pad+p*sy;
  const field=sampleField(scene,36,22);let content='';for(let row=0;row<field.rows;row++)for(let col=0;col<field.columns;col++){const t=1-Math.exp(-field.values[row*field.columns+col]/105),color=`rgb(${19+Math.round(217*t)},${41+Math.round(149*t)},${35+Math.round(77*t)})`;content+=`<rect x="${pad+col*(w-2*pad)/36}" y="${pad+row*(h-2*pad)/22}" width="${(w-2*pad)/36+0.2}" height="${(h-2*pad)/22+0.2}" fill="${color}"/>`;}
  for(const screen of scene.screens.filter(s=>s.enabled))content+=`<line x1="${x(screen.x1)}" y1="${y(screen.y1)}" x2="${x(screen.x2)}" y2="${y(screen.y2)}" stroke="#f4ecd6" stroke-width="4"/>`;
  for(const [i,lamp]of scene.lamps.entries())content+=`<circle cx="${x(lamp.x)}" cy="${y(lamp.y)}" r="7" fill="${lamp.enabled?'#fff2b1':'#87928a'}"/><text x="${x(lamp.x)+10}" y="${y(lamp.y)-10}" fill="white" font-size="12">L${i+1}</text>`;
  for(const point of scene.detectors)content+=`<rect x="${x(point.x)-5}" y="${y(point.y)-5}" width="10" height="10" fill="#152c24" stroke="white"/><text x="${x(point.x)}" y="${y(point.y)+20}" text-anchor="middle" fill="white" font-size="12">${escape(point.label)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Calculated top view; ${scene.width} by ${scene.depth} metres"><rect width="580" height="300" fill="#132923"/>${content}</svg>`;
}
export function studyReportText(input,options={}){
  const {study,decision,targets,alternatives,experiments,linkedSources}=reportData(input,options);
  const lines=[`Afterlight · ${study.title}`,study.example?'Explicit example/template study':'Personal or recovered study',`Task: ${study.task}`,`Question: ${study.question}`,`Owner: ${study.projectId||'Unassigned recovered work'}`,`Model: ${OPTICS_MODEL_VERSION}`,`Targets revision ${targets.revision}: ${targets.minLux}–${targets.maxLux} lx; selected-point uniformity ≥ ${targets.minUniformity}; enabled intensity ceiling ${targets.intensityBudget===null?'not set':targets.intensityBudget+' cd'}`];
  if(decision)lines.push(`Chosen arrangement: ${option(study,decision.chosenId).name}`,`Reason: ${decision.reason}`,`Next check: ${decision.nextCheck||'Sample other locations and compare real observations with model boundaries.'}`);else lines.push('No arrangement has been chosen. This is an unfinished study.');
  if(decision&&decision.targets.revision!==study.targets.revision)lines.push(`Historical decision uses targets revision ${decision.targets.revision}; current targets revision ${study.targets.revision} is a separate reevaluation.`);
  for(const a of alternatives){lines.push(`\n${a.name} (${a.id})`,`Surface: ${a.scene.width} × ${a.scene.depth} m`);for(const l of a.scene.lamps)lines.push(`Lamp ${l.id}: (${l.x}, ${l.y}) m; height ${l.height} m; ${l.intensity} cd; ${l.enabled?'enabled':'off'}`);for(const s of a.scene.screens)lines.push(`Screen ${s.id}: (${s.x1}, ${s.y1}) → (${s.x2}, ${s.y2}) m; height ${s.height} m; ${s.enabled?'enabled':'off'}`);for(const p of a.scene.detectors){const reading=a.readings.detectors.find(d=>d.id===p.id);lines.push(`${p.label} [${p.id}] (${p.x}, ${p.y}) m: ${reading.lux} lx; ${pointStatus(reading.lux,targets).passed?'in range':'outside range'}; lower margin ${reading.lux-targets.minLux} lx; upper margin ${targets.maxLux-reading.lux} lx`);for(const c of reading.contributions)lines.push(`  ${c.lampId}: ${c.lux} lx; path ${c.distance} m; cosine ${c.cosine}; blocked by ${c.blockedBy.join(', ')||'none'}`);}lines.push(`Selected-point minimum/maximum/average: ${a.readings.minimumLux}/${a.readings.maximumLux}/${a.readings.averageLux} lx; uniformity ${a.readings.uniformity}; enabled intensity ${a.readings.totalIntensity} cd`);}
  if(decision)for(const p of decision.comparison.points)lines.push(`B − A at ${p.label}: ${p.deltaLux} lx`);
  for(const e of experiments)lines.push(`\nExperiment ${e.id} (${e.createdAt})`,`Prediction: ${e.prediction}`,`Original hypothesis: ${e.hypothesis}`,`Conclusion: ${e.note}`,e.explanation,`Baseline scene: ${JSON.stringify(e.before.scene)}`,`Final scene: ${JSON.stringify(e.after.scene)}`);
  if(study.staged)lines.push(`\nUnfinished result ${study.staged.id}`,`Hypothesis: ${study.staged.experiment.hypothesis}`,`Draft conclusion: ${study.staged.conclusion}`,study.staged.experiment.explanation);
  for(const o of study.observations)lines.push(`\nUser-reported observation ${o.id}: ${o.lux} lx; calculated ${o.calculatedLux} lx; observed − calculated ${o.differenceLux} lx; arrangement ${o.alternativeId}, point ${o.pointId}; ${o.instrument}; ${o.observedAt}; ${o.context}`);
  if(!study.observations.length)lines.push('\nNo real observations have been entered.');
  lines.push('\nSource evidence',...linkedSources.map(s=>`${s.title} [${s.sourceId}, ${s.paragraphId}]\n${s.quote}`),...LIGHT_SOURCES.map(s=>`${s.publisher} · ${s.title}: ${s.url}`),'\nModel limits',STUDY_MODEL_LIMITS,'\nNext-measurement checklist','Record the actual arrangement, instrument/method and time. Sample additional surface points. Account for ambient/reflected light and real lamp directionality. Preserve observations separately from calculations.');return lines.join('\n');
}
export function studyReportHTML(input,options={}){
  const data=reportData(input,options),{study,alternatives}=data;
  const chosen=data.decision&&alternatives.find(a=>a.id===data.decision.chosenId);
  const summary=chosen?`<section class="decision"><p class="eyebrow">Selected arrangement</p><h2>${escape(chosen.name)}</h2><p>${escape(data.decision.reason)}</p><p><strong>Next check:</strong> ${escape(data.decision.nextCheck)}</p><p class="target-note">Decision targets: ${data.targets.minLux}–${data.targets.maxLux} lx at the selected points; uniformity ${(data.targets.minUniformity*100).toFixed(0)}% or higher. These are personal study goals.</p></section>`:'<section class="decision"><h2>Study in progress</h2><p>No arrangement has been chosen yet.</p></section>';
  const panels=alternatives.map(a=>`<section class="arrangement"><h2>${escape(a.name)}</h2>${sceneSVG(a.scene)}<p>Surface ${a.scene.width} × ${a.scene.depth} metres. Field colours compress calculated lux.</p><table><thead><tr><th>Selected point</th><th>Position (m)</th><th>Calculated lux</th><th>Target margins (lx)</th></tr></thead><tbody>${a.scene.detectors.map(p=>{const r=a.readings.detectors.find(d=>d.id===p.id);return `<tr><th>${escape(p.label)}</th><td>${p.x}, ${p.y}</td><td>${fixed(r.lux)}</td><td>Above minimum ${fixed(r.lux-data.targets.minLux)}; below maximum ${fixed(data.targets.maxLux-r.lux)}</td></tr>`;}).join('')}</tbody></table></section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${escape(study.title)} · Afterlight study</title><style>body{font:15px/1.65 system-ui,sans-serif;color:#20392f;background:#f8f6ee;margin:0}main{max-width:960px;margin:auto;padding:44px}h1,h2{font-family:Georgia,serif;font-weight:normal}h1{font-size:38px;line-height:1.2}.eyebrow{letter-spacing:.12em;text-transform:uppercase;font-size:12px}.decision{margin:28px 0 36px;border-left:3px solid #b39855;padding:6px 0 6px 22px}.decision h2{margin:8px 0;font-size:28px}.decision p{max-width:760px}.target-note{font-size:12px;color:#596b5f}.arrangement{break-inside:avoid;margin:32px 0}svg{width:100%;max-height:360px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:9px;border-bottom:1px solid #ccd3c8}pre{font:13px/1.7 system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere}.limits{border-top:2px solid #b39855;margin-top:30px;padding-top:15px}@media print{body{background:white}main{padding:0}h1{font-size:28px}svg{max-height:250px}a{color:inherit}.arrangement{break-inside:avoid}}</style></head><body><main><p class="eyebrow">Afterlight · evidence study · ${escape(OPTICS_MODEL_VERSION)}</p><h1>${escape(study.title)}</h1><p>${escape(study.task)}</p>${summary}${panels}<section><h2>Decision, configuration and retained evidence</h2><pre>${escape(studyReportText(study,options))}</pre></section><section class="limits"><h2>Scientific references</h2><ul>${LIGHT_SOURCES.map(s=>`<li><a href="${escape(s.url)}">${escape(s.publisher+' · '+s.title)}</a><br>${escape(s.url)}</li>`).join('')}</ul></section></main></body></html>`;
}
function csvCell(value){if(typeof value==='number'){if(!Number.isFinite(value))throw new RangeError('CSV numbers must be finite.');return String(value);}let string=String(value??'');if(/^[\s\u0000-\u001f]*[=+\-@]/u.test(string)||/^[\t\r\n]/u.test(string))string="'"+string;return '"'+string.replace(/"/g,'""')+'"';}
export function studyCSV(input,options={}){
  const {study,targets,alternatives,decision}=reportData(input,options),rows=[['study_id','study_title','alternative_id','alternative_name','model_version','target_revision','point_id','point_label','x_m','y_m','calculated_lux','target_min_lux','target_max_lux','above_minimum_lux','below_maximum_lux','point_uniformity','total_enabled_intensity_cd','B_minus_A_lux','observation_id','observed_lux','observed_minus_calculated_lux','instrument_or_method','observed_at','context']];
  for(const a of alternatives)for(const p of a.scene.detectors){const reading=a.readings.detectors.find(d=>d.id===p.id),observations=study.observations.filter(o=>o.alternativeId===a.id&&o.pointId===p.id),delta=decision?.comparison.points.find(point=>point.id===p.id)?.deltaLux??'';for(const o of observations.length?observations:[null])rows.push([study.id,study.title,a.id,a.name,OPTICS_MODEL_VERSION,targets.revision,p.id,p.label,p.x,p.y,reading.lux,targets.minLux,targets.maxLux,reading.lux-targets.minLux,targets.maxLux-reading.lux,a.readings.uniformity,a.readings.totalIntensity,delta,o?.id||'',o?.lux??'',o?.differenceLux??'',o?.instrument||'',o?.observedAt||'',o?.context||'']);}
  return rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
