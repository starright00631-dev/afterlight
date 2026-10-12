import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,createExampleState,reviewDue} from '../domain.js';
import {SAVE_KEY,LEGACY_SAVE_KEY,validateState,loadState,saveState} from '../persistence.js';
import {createLabState,makeExperiment} from '../optics.js';
import {activeStudy,saveAlternative,commitExperiment,runExperiment,finalizeExperiment,chooseAlternative,recoverLegacyStudy} from '../studies.js';
const TIME='2026-10-11T11:00:00.000Z';
function memoryStorage(){const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};}
function legacyState(){const state=createExampleState();state.projects[0].closing={note:'Saved handoff.\n原始内容',nextAction:'Check the source.',updatedAt:TIME};state.attempts.push({id:'attempt-legacy',ideaId:state.ideas[0].id,answer:'Original answer.',rating:'uncertain',createdAt:TIME,dueAt:reviewDue('uncertain',TIME)});state.actions[0].draft='Original draft.\nDo not replace.';state.actions.forEach(a=>a.studyId=null);state.session={actionId:state.actions[1].id,running:true,startedAt:100000,elapsedMs:20000,goalMinutes:25};state.quiet={running:false,endsAt:null,remainingMs:600000,durationMinutes:10};state.settings.night=false;return state;}
test('v2 migration preserves every original desk field and leaves its storage untouched',()=>{
  const legacy=legacyState();legacy.lab=createLabState('distance');const before=structuredClone(legacy.lab.scene);legacy.lab.scene.lamps[0].height=0.4;
  legacy.lab.experiments.push(makeExperiment(before,legacy.lab.scene,{id:'legacy-retained',createdAt:TIME,challengeId:'distance',detectorId:'detector-a',prediction:'increase',hypothesis:'Original hypothesis.',note:'Original conclusion.'}));
  const storage=memoryStorage(),raw=JSON.stringify(legacy);storage.setItem(LEGACY_SAVE_KEY,raw);
  const loaded=loadState(storage);assert.equal(loaded.migrated,true);assert.equal(loaded.state.version,3);assert.equal(storage.getItem(LEGACY_SAVE_KEY),raw);assert.equal(storage.getItem(SAVE_KEY),null);
  for(const key of ['projects','sources','ideas','attempts','actions','session','quiet','settings','lab','activeProjectId','selectedSourceId','selectedIdeaId','view'])assert.deepEqual(loaded.state[key],legacy[key],key);
  const recovered=activeStudy(loaded.state.studio);assert.equal(recovered.projectId,null);assert.equal(recovered.kind,'recovered');assert.equal(recovered.experiments[0].id,'legacy-retained');assert.equal(recovered.scene.detectors.length,1);
  assert.equal(saveState(storage,loaded.state),true);assert.equal(storage.getItem(LEGACY_SAVE_KEY),raw);assert.deepEqual(loadState(storage).state,loaded.state);
});
test('valid v3 has priority and invalid or empty v3 cannot be hidden by valid v2',()=>{
  const storage=memoryStorage(),legacy=createExampleState();storage.setItem(LEGACY_SAVE_KEY,JSON.stringify(legacy));const upgraded=validateState(legacy);upgraded.projects[0].title='My upgraded project';saveState(storage,upgraded);assert.equal(loadState(storage).state.projects[0].title,'My upgraded project');
  for(const raw of ['{broken','',JSON.stringify({...upgraded,studio:{version:1,activeStudyId:'missing',studies:[]}})]){storage.setItem(SAVE_KEY,raw);const recovered=loadState(storage);assert.match(recovered.notice,/could not be read/);assert.equal(recovered.recoveryRaw,raw);assert.equal(recovered.recoveryKey,SAVE_KEY);assert.equal(recovered.state.sources.length,0);assert.equal(storage.getItem(SAVE_KEY),raw);assert.equal(storage.getItem(LEGACY_SAVE_KEY),JSON.stringify(legacy));}
});
test('invalid legacy raw data is identified and preserved without writing either workspace',()=>{
  const storage=memoryStorage();storage.setItem(LEGACY_SAVE_KEY,'bad legacy');const loaded=loadState(storage);assert.match(loaded.notice,/could not be read/);assert.equal(loaded.recoveryRaw,'bad legacy');assert.equal(loaded.recoveryKey,LEGACY_SAVE_KEY);assert.equal(storage.getItem(SAVE_KEY),null);assert.equal(storage.getItem(LEGACY_SAVE_KEY),'bad legacy');
});
test('staged conclusions round-trip and failed finalization saves preserve the saved stage',()=>{
  const original=validateState(legacyState()),s=activeStudy(original.studio);commitExperiment(s,{detectorId:'point-a',prediction:'increase',hypothesis:'Halving height increases direct light.'});s.scene.lamps[0].height=0.25;runExperiment(s);s.staged.conclusion='Partial conclusion to recover.';const storage=memoryStorage();assert.equal(saveState(storage,original),true);assert.deepEqual(loadState(storage).state,original);
  const next=structuredClone(original),stageId=activeStudy(next.studio).staged.id;finalizeExperiment(activeStudy(next.studio),'My retained conclusion.',stageId);
  const failing={getItem:key=>storage.getItem(key),setItem(){throw Error('quota');}};assert.equal(saveState(failing,next),false);const recovered=loadState(storage).state;assert.equal(activeStudy(recovered.studio).staged.id,stageId);assert.equal(activeStudy(recovered.studio).staged.conclusion,'Partial conclusion to recover.');assert.equal(activeStudy(recovered.studio).experiments.length,0);
  assert.equal(saveState(storage,next),true);assert.equal(activeStudy(loadState(storage).state.studio).experiments.length,1);
});
test('action/study links and source evidence belong to the same explicit project',()=>{
  const state=validateState(legacyState()),s=activeStudy(state.studio);state.actions[1].studyId=s.id;const a=saveAlternative(s,'A');s.scene.lamps[0].intensity=40;s.scene.lamps.push({id:'lamp-b',x:1.6,y:0.6,height:0.5,intensity:40,enabled:true});const b=saveAlternative(s,'B');chooseAlternative(s,a.id,b.id,b.id,'Even selected points.','',{sourceRefs:[{sourceId:state.sources[0].id,paragraphId:state.sources[0].paragraphs[0].id}]});assert.equal(validateState(state).actions[1].studyId,s.id);
  for(const mutate of [raw=>raw.actions[1].studyId='missing-study',raw=>{const other=createState().projects[0];raw.projects.push(other);raw.studio.studies[0].projectId=other.id;},raw=>raw.studio.studies[0].decision.sourceRefs[0].paragraphId='missing']){const bad=structuredClone(state);mutate(bad);assert.throws(()=>validateState(bad));}
});
test('fresh v3 starts in Studio and preserves unreadable v3 before a subsequent valid save',()=>{
  const storage=memoryStorage(),fresh=loadState(storage);assert.equal(fresh.state.version,3);assert.equal(fresh.state.view,'lab');assert.equal(fresh.state.studio.studies[0].projectId,fresh.state.projects[0].id);assert.equal(fresh.state.studio.studies[0].example,true);
  storage.setItem(SAVE_KEY,'{broken');assert.equal(saveState(storage,fresh.state),true);assert.equal(storage.getItem(SAVE_KEY+'.unreadable'),'{broken');assert.equal(loadState(storage).notice,'');
});
test('recovered pending legacy predictions preserve empty original hypotheses and unique identity',()=>{
  const lab=createLabState('distance');lab.pending={beforeScene:structuredClone(lab.scene),challengeId:'distance',detectorId:'detector-a',prediction:'increase',hypothesis:'',committedAt:TIME};lab.scene.lamps[0].height=0.4;
  const recovered=recoverLegacyStudy(lab);assert.equal(recovered.projectId,null);assert.equal(recovered.pending.hypothesis,'');assert.equal(recovered.pending.committedAt,TIME);assert.equal(recovered.pending.beforeScene.lamps[0].height,0.8);assert.doesNotThrow(()=>validateState({...legacyState(),lab}));
});
