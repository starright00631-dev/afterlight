import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudy,createStudio,activeStudy,validateStudy,validateStudio,validateTargets,updateScene,updateTargets,geometryMatches,studyVerdict,saveAlternative,restoreAlternative,compareAlternatives,chooseAlternative,commitExperiment,runExperiment,finalizeExperiment,discardExperiment,addObservation,recoverLegacyStudy,studyReportHTML,studyReportText,studyCSV,STUDY_LIMITS} from '../studies.js';
import {createLabState,evaluateScene,makeExperiment} from '../optics.js';

const TIME='2026-10-11T11:00:00.000Z';
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} ≠ ${expected}`);
const study=()=>createStudy({projectId:'project-test',title:'A real shared table',example:false,createdAt:TIME});
function alternatives(s=study()){
  const a=saveAlternative(s,'Option A');
  const scene=structuredClone(s.scene);scene.lamps[0].intensity=40;scene.lamps.push({id:'lamp-b',x:1.6,y:0.6,height:0.5,intensity:40,enabled:true});updateScene(s,scene);
  const b=saveAlternative(s,'Option B',{parentId:a.id});return {s,a,b};
}
function finished(){const {s,a,b}=alternatives();commitExperiment(s,{detectorId:'point-a',prediction:'increase',hypothesis:'Halving height increases the overhead contribution fourfold.'});const scene=structuredClone(s.scene);scene.lamps[0].height=0.25;updateScene(s,scene);runExperiment(s);const e=finalizeExperiment(s,'The direct overhead contribution increased fourfold; the other lamp contribution stayed fixed.');chooseAlternative(s,a.id,b.id,b.id,'Both selected points are within my chosen range.','Measure additional locations and record ambient light.',{experimentIds:[e.id]});return {s,a,b,e};}

test('fresh studio has a labelled template and three commissions, without invented work',()=>{
  const studio=createStudio('project-test');assert.equal(studio.studies.length,4);assert.equal(activeStudy(studio).kind,'personal');assert.equal(activeStudy(studio).example,true);
  assert.deepEqual(validateStudio(studio,{projectIds:['project-test']}),studio);
  for(const s of studio.studies){assert.equal(s.projectId,'project-test');assert.equal(s.alternatives.length,0);assert.equal(s.experiments.length,0);assert.equal(s.observations.length,0);assert.equal(s.decision,null);}
  assert.equal(study().example,false);assert.throws(()=>createStudy({projectId:null}));
});
test('personal geometry admits ordinary desks and rejects invalid resizing without moving objects',()=>{
  const s=study(),small={width:0.3,depth:0.3,lamps:[{id:'lamp-a',x:0.1,y:0.1,height:0.2,intensity:20,enabled:true}],detectors:[{id:'point-a',label:'A',x:0.1,y:0.1},{id:'point-b',label:'B',x:0.2,y:0.2}],screens:[]};
  updateScene(s,small);assert.equal(s.scene.width,0.3);const original=structuredClone(s.scene);assert.throws(()=>updateScene(s,{...small,width:0.15}));assert.deepEqual(s.scene,original);
  assert.throws(()=>updateScene(s,{...small,detectors:[small.detectors[0]]}));assert.throws(()=>updateScene(s,{...small,width:12.1}));
  const large=structuredClone(small);large.width=12;large.depth=12;updateScene(s,large);assert.equal(s.scene.width,12);
});
test('saved arrangements retain independent exact scene evidence and branch ancestry',()=>{
  const {s,a,b}=alternatives();near(a.readings.detectors[0].lux,240);near(a.readings.detectors[1].lux,35.730265618191916);near(b.readings.detectors[0].lux,183.82017707879461);near(b.readings.detectors[1].lux,183.82017707879461);
  s.scene.lamps[0].intensity=1;assert.equal(b.scene.lamps[0].intensity,40);assert.equal(a.scene.lamps[0].intensity,60);assert.equal(b.parentId,a.id);
  restoreAlternative(s,a.id);s.scene.lamps[0].height=1;assert.equal(a.scene.lamps[0].height,0.5);assert.deepEqual(validateStudy(s).alternatives,s.alternatives);
  const cyclic=structuredClone(s);cyclic.alternatives[0].parentId=b.id;assert.throws(()=>validateStudy(cyclic),/cycle/);
});
test('an edited copy retains its parent through reload without changing retained evidence',()=>{
  const {s,a,b}=alternatives();restoreAlternative(s,a.id);
  const restored=validateStudy(JSON.parse(JSON.stringify(s)));assert.equal(restored.workingParentId,a.id);
  const scene=structuredClone(restored.scene);scene.lamps[0].height=0.7;updateScene(restored,scene);
  const branched=saveAlternative(restored,'Edited copy');assert.equal(branched.parentId,a.id);
  assert.equal(restored.workingParentId,branched.id);assert.equal(a.scene.lamps[0].height,0.5);
  assert.deepEqual(validateStudy(JSON.parse(JSON.stringify(restored))).alternatives[1],b);
  const broken=structuredClone(restored);broken.workingParentId='absent-option';assert.throws(()=>validateStudy(broken),/missing/);
});
test('A/B comparisons use stable point geometry, exact contributions and current personal targets',()=>{
  const {s,a,b}=alternatives(),comparison=compareAlternatives(s,a.id,b.id);assert.equal(comparison.matched,true);near(comparison.points[0].deltaLux,-56.17982292120539);near(comparison.points[1].deltaLux,148.0899114606027);assert.equal(comparison.points[0].bContributions.length,2);assert.equal(comparison.bSummary.rangePassed,true);assert.equal(comparison.aSummary.rangePassed,false);near(comparison.bSummary.uniformity,1);
  a.geometryRevision=99;assert.equal(compareAlternatives(s,a.id,b.id).matched,true);
  const changed=structuredClone(s.scene);changed.detectors[1].x=1.7;updateScene(s,changed);const c=saveAlternative(s,'Different points');assert.equal(compareAlternatives(s,a.id,c.id).matched,false);assert.throws(()=>chooseAlternative(s,a.id,c.id,c.id,'A different layout'),/Different/);
  restoreAlternative(s,a.id);const restored=saveAlternative(s,'Restored points',{parentId:c.id});assert.equal(geometryMatches(restored.scene,a.scene),true);assert.equal(compareAlternatives(s,a.id,restored.id).matched,true);
});
test('targets are bounded and all-zero light remains finite with honest point status',()=>{
  const s=study();s.scene.lamps[0].enabled=false;const result=studyVerdict(s);assert.equal(result.passed,false);assert.equal(result.summary.uniformity,0);assert.equal(result.summary.averageLux,0);assert.equal(result.points[0].passed,false);
  updateTargets(s,{minLux:0,maxLux:0,minUniformity:0});assert.equal(studyVerdict(s).passed,true,'an explicit zero-light goal is not silently changed');assert.equal(s.targets.revision,2);
  for(const patch of [{minLux:300,maxLux:200},{minUniformity:1.1},{intensityBudget:-1},{maxLux:Infinity}])assert.throws(()=>validateTargets({...s.targets,...patch}));
});
test('decision freezes its exact comparison and targets independently of later editing',()=>{
  const {s,a,b}=alternatives();chooseAlternative(s,a.id,b.id,b.id,'Two selected points are balanced.','Measure the corners.');const original=structuredClone(s.decision);
  updateTargets(s,{minLux:300,maxLux:400});s.scene.lamps[0].intensity=0;assert.deepEqual(s.decision,original);assert.deepEqual(validateStudy(s).decision,original);assert.equal(s.decision.targets.revision,1);assert.equal(s.targets.revision,2);
  assert.match(studyReportText(s),/Historical decision uses targets revision 1/);assert.match(studyCSV(s),/,150,200,/);
});
test('committed predictions survive serialization and freeze every measurement point',()=>{
  const s=study(),pending=commitExperiment(s,{detectorId:'point-a',prediction:'increase',hypothesis:'The height will be halved.'});s.scene.lamps[0].height=0.25;const loaded=validateStudy(JSON.parse(JSON.stringify(s)));assert.deepEqual(loaded.pending,pending);assert.equal(loaded.pending.beforeScene.lamps[0].height,0.5);
  const moved=structuredClone(loaded.scene);moved.detectors[1].x=1.7;assert.throws(()=>updateScene(loaded,moved),/Cancel/);assert.equal(loaded.scene.detectors[1].x,1.6);assert.throws(()=>saveAlternative(loaded,'Proposed'),/Run or cancel/);
  assert.throws(()=>commitExperiment(loaded,{detectorId:'point-a',prediction:'same',hypothesis:'Another'}),/already/);
});
test('staged results and partial conclusions survive reset, restoration and reload',()=>{
  const {s,a}=alternatives();commitExperiment(s,{detectorId:'point-a',prediction:'increase',hypothesis:'Halve one height.'});const finalScene=structuredClone(s.scene);finalScene.lamps[0].height=0.25;updateScene(s,finalScene);const staged=runExperiment(s);s.staged.conclusion='Partial conclusion.';
  restoreAlternative(s,a.id);assert.equal(s.staged.id,staged.id);const loaded=validateStudy(JSON.parse(JSON.stringify(s)));assert.equal(loaded.staged.conclusion,'Partial conclusion.');assert.equal(loaded.staged.experiment.after.scene.lamps[0].height,0.25);assert.equal(loaded.scene.lamps[0].height,0.5);
  assert.throws(()=>commitExperiment(loaded,{detectorId:'point-a',prediction:'increase',hypothesis:'New'}),/unfinished/);assert.throws(()=>runExperiment(loaded),/unfinished/);
  discardExperiment(loaded);assert.equal(loaded.staged,null);assert.equal(loaded.experiments.length,0);
});
test('finalization retains one stable experiment identity and separates hypothesis from conclusion',()=>{
  const s=study();const p=commitExperiment(s,{detectorId:'point-a',prediction:'increase',hypothesis:'Half-height should quadruple overhead lux.'});s.scene.lamps[0].height=0.25;runExperiment(s);assert.throws(()=>finalizeExperiment(s,''));assert.ok(s.staged);
  const record=finalizeExperiment(s,'The result supports the overhead prediction.',p.id);const repeated=finalizeExperiment(s,'A second click should not rewrite this.',p.id);assert.equal(record.id,p.id);assert.deepEqual(repeated,record);assert.equal(s.experiments.length,1);assert.equal(s.staged,null);assert.equal(record.hypothesis,'Half-height should quadruple overhead lux.');assert.equal(record.note,'The result supports the overhead prediction.');assert.equal(validateStudy(s).experiments.length,1);
});
test('numerical commission success is distinguished from retained explained evidence',()=>{
  const s=createStudy({projectId:'project-test',template:'distance'});s.scene.lamps[0].height=0.4;assert.equal(studyVerdict(s).commission.targetSatisfied,true);assert.equal(studyVerdict(s).commission.completed,false);
  s.scene.lamps[0].height=0.8;commitExperiment(s,{detectorId:'detector-a',prediction:'increase',hypothesis:'Halving distance should quadruple light.'});s.scene.lamps[0].height=0.4;runExperiment(s);finalizeExperiment(s,'At fixed intensity, overhead illuminance changed from50 to200lx.');assert.equal(studyVerdict(s).commission.completed,true);
});
test('observations bind to immutable arrangements and cannot replace calculated light',()=>{
  const {s,b}=alternatives(),o=addObservation(s,{alternativeId:b.id,pointId:'point-a',lux:170,instrument:'Handheld lux meter',observedAt:TIME,context:'Curtains closed, lamp positions recorded.'});near(o.calculatedLux,183.82017707879461);near(o.differenceLux,-13.82017707879461);s.scene.lamps[0].intensity=0;const clean=validateStudy(s);near(clean.observations[0].calculatedLux,183.82017707879461);near(clean.alternatives[1].readings.detectors[0].lux,183.82017707879461);
  assert.throws(()=>addObservation(s,{alternativeId:b.id,pointId:'missing',lux:1,instrument:'Meter'}));assert.throws(()=>addObservation(s,{alternativeId:b.id,pointId:'point-a',lux:-1,instrument:'Meter'}));
});
test('reference validation rejects absent or cross-project source, experiment and arrangement evidence',()=>{
  const {s,a,b}=alternatives();chooseAlternative(s,a.id,b.id,b.id,'Useful at the named points.','',{sourceRefs:[{sourceId:'source-a',paragraphId:'p-0-a'}]});
  const source={id:'source-a',projectId:'project-test',title:'Source',paragraphs:[{id:'p-0-a',text:'Original evidence.'}]};assert.doesNotThrow(()=>validateStudy(s,{projectIds:['project-test'],sources:[source]}));
  const exported=JSON.parse(JSON.stringify({format:'afterlight-study',version:1,study:validateStudy(s)}));assert.deepEqual(exported.study.decision.sourceRefs,s.decision.sourceRefs);
  assert.doesNotThrow(()=>studyCSV(s));assert.doesNotThrow(()=>studyReportHTML(s));assert.match(studyReportHTML(s,{sources:[source]}),/Original evidence\./);
  assert.throws(()=>validateStudy(s,{projectIds:['other']}),/project/);assert.throws(()=>validateStudy(s,{sources:[]}),/missing/);assert.throws(()=>validateStudy(s,{sources:[{...source,projectId:'other'}]}),/project/);
  const bad=structuredClone(s);bad.decision.experimentIds=['missing'];assert.throws(()=>validateStudy(bad),/experiment/);bad.decision.experimentIds=[];bad.decision.chosenId='missing';assert.throws(()=>validateStudy(bad),/chosen/);
});
test('forged arrangements, comparisons, observations and unsupported model versions are rejected',()=>{
  const {s,a,b}=finished();addObservation(s,{alternativeId:b.id,pointId:'point-a',lux:170,instrument:'Meter',observedAt:TIME});
  for(const mutate of [raw=>raw.modelVersion='future',raw=>raw.alternatives[0].readings.detectors[0].lux=999,raw=>raw.alternatives[0].modelVersion='future',raw=>raw.decision.comparison.points[0].deltaLux=999,raw=>raw.decision.targets.minLux=1,raw=>raw.observations[0].calculatedLux=99,raw=>raw.observations[0].modelVersion='future',raw=>raw.experiments[0].modelVersion='future']){const bad=structuredClone(s);mutate(bad);assert.throws(()=>validateStudy(bad));}
  const clean=validateStudy(s);assert.equal(clean.alternatives[0].id,a.id);assert.equal(clean.observations[0].lux,170);
});
test('legacy one-point evidence and three-screen scenes recover without invented ownership',()=>{
  const lab=createLabState('distance'),before=structuredClone(lab.scene);lab.scene.lamps[0].height=0.4;lab.experiments.push(makeExperiment(before,lab.scene,{id:'legacy-experiment',createdAt:TIME,challengeId:'distance',detectorId:'detector-a',prediction:'increase',note:'Legacy conclusion.'}));const recovered=recoverLegacyStudy(lab);assert.equal(recovered.projectId,null);assert.equal(recovered.kind,'recovered');assert.equal(recovered.scene.detectors.length,1);assert.equal(recovered.experiments[0].hypothesis,'');assert.equal(recovered.experiments[0].note,'Legacy conclusion.');
  const three=createLabState('free');three.scene.screens.push({...three.scene.screens[0],id:'screen-b',x1:2,x2:2},{...three.scene.screens[0],id:'screen-c',x1:4,x2:4});assert.equal(recoverLegacyStudy(three).scene.screens.length,3);
});
test('HTML/text/CSV reconcile retained numeric evidence, escape prose and distinguish observations',()=>{
  const {s,a,b}=finished();s.title='<script>alert(1)</script>';s.alternatives[0].name='=HYPERLINK("https://example.com")';addObservation(s,{alternativeId:b.id,pointId:'point-a',lux:170,instrument:'Meter',observedAt:TIME,context:'A real observation.'});
  chooseAlternative(s,a.id,b.id,b.id,'Both selected points are useful.','Measure more points.',{experimentIds:s.experiments.map(e=>e.id)});
  const html=studyReportHTML(s),text=studyReportText(s),csv=studyCSV(s);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/<svg/);assert.match(html,/Model limits/);assert.match(text,/183\.8201770787946/);assert.match(text,/observed − calculated -13\.820177/);assert.match(csv,/"'=HYPERLINK/);assert.match(csv,/,183\.82017707879461,/);assert.match(csv,/,-56\.1798229212053\d+,/);assert.match(csv,/,170,-13\.8201770787946\d+,/);assert.match(html,/https:\/\/ies\.org/);
  const empty=studyCSV(study());assert.doesNotMatch(empty,/,170,/);assert.match(studyReportText(study()),/No real observations/);assert.ok(a.id);
});
test('CSV neutralizes formula triggers after whitespace without changing literal HTML or numeric deltas',()=>{
  for(const name of ['=SUM(1,2)','+cmd','-cmd','@cmd','\t=cmd','  =cmd','\r\n@cmd']){const s=study();s.scene.detectors[0].label=name;const a=saveAlternative(s,'Text');assert.match(studyCSV(s),/"'/);assert.ok(studyReportHTML(s).includes(name.replace(/&/g,'&amp;').replace(/</g,'&lt;')));assert.equal(a.scene.detectors[0].label,name);}
});
test('bounds, duplicate identities and exported secret fields do not bypass study validation',()=>{
  const s=study();s.apiKey='do-not-export';s.provider={key:'do-not-export'};assert.equal(validateStudy(s).apiKey,undefined);assert.doesNotMatch(studyReportHTML(s),/do-not-export/);assert.doesNotMatch(studyCSV(s),/do-not-export/);
  const raw=structuredClone(s);raw.alternatives=Array(STUDY_LIMITS.alternatives+1).fill({});assert.throws(()=>validateStudy(raw));const studio=createStudio('project-test');studio.studies[1].id=studio.studies[0].id;assert.throws(()=>validateStudio(studio),/unique/);
});
