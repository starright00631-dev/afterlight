import test from 'node:test';
import assert from 'node:assert/strict';
import {createExampleState, splitSource} from '../domain.js';
import {dueReviewQueue,currentReviewItem,startReviewSession,writeReviewAnswer,revealReview,skipReview,rateReview,undoReview,endReview,validateReviewSession} from '../review-sessions.js';

const NOW='2026-10-13T12:00:00.000Z';
function workspace() {
  const state=createExampleState();
  state.reviewSession=null;
  state.ideas.forEach((item,index)=>{item.answerCriteria=`Criterion ${index+1}: explain a concrete output.`;});
  const project={...structuredClone(state.projects[0]),id:'other-project',title:'Another question',example:false};
  const paragraphs=splitSource('The second source has an inspectable claim.');
  state.projects.push(project);
  state.sources.push({id:'other-source',projectId:project.id,title:'Second source',kind:'text',text:paragraphs[0].text,paragraphs,createdAt:NOW});
  state.ideas.push({id:'other-idea',projectId:project.id,sourceId:'other-source',paragraphId:paragraphs[0].id,title:'Another claim',question:'What is inspectable?',answerCriteria:'Name the actual evidence.',explanation:'',origin:'user',createdAt:NOW});
  return state;
}
function freeze(value) {if(value && typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}
function answered(state,answer='An actual output can be read and checked.') {return revealReview(writeReviewAnswer(state,answer));}
function session(state,options={}) {return startReviewSession(state,{now:NOW,...options});}
function legacyAttempt(ideaId,overrides={}) {return {id:'old-attempt',ideaId,answer:'A retained earlier answer.',rating:'again',createdAt:'2026-10-01T12:00:00.000Z',dueAt:'2026-10-02T12:00:00.000Z',...overrides};}

test('due queue orders overdue checks before new questions, uses latest history and Shanghai dates without writing',()=>{
  const state=workspace(),[first,second,third]=state.ideas;
  state.attempts=[legacyAttempt(second.id),legacyAttempt(first.id,{id:'future',createdAt:'2026-10-12T12:00:00.000Z',dueAt:'2026-10-14T17:00:00.000Z'}),legacyAttempt(third.id,{id:'latest',createdAt:'2026-10-10T12:00:00.000Z',dueAt:'2026-10-12T17:00:00.000Z'})];
  const before=structuredClone(state);freeze(state);
  assert.deepEqual(dueReviewQueue(state,{date:'2026-10-13'}).map(item=>item.id),[second.id,third.id]);
  assert.deepEqual(dueReviewQueue(state,{projectId:state.projects[0].id,date:'2026-10-13'}).map(item=>item.id),[second.id]);
  assert.deepEqual(dueReviewQueue(state,{date:'2026-10-12'}).map(item=>item.id),[second.id]);
  assert.deepEqual(state,before);
  assert.throws(()=>dueReviewQueue(state,{date:'2026-02-30'}));
  assert.throws(()=>dueReviewQueue(state,{projectId:'missing'}));
});

test('starting a bounded queue atomically opens its project, source and idea without inventing attempts or work',()=>{
  const state=workspace(),before=structuredClone(state);freeze(state);
  const next=session(state,{projectId:'other-project',budgetMinutes:12,maxItems:2});
  assert.deepEqual(next.reviewSession.ideaIds,['other-idea']);
  assert.equal(next.reviewSession.maxItems,2);assert.equal(next.reviewSession.budgetMinutes,12);
  assert.equal(next.activeProjectId,'other-project');assert.equal(next.selectedSourceId,'other-source');assert.equal(next.selectedIdeaId,'other-idea');
  assert.equal(currentReviewItem(next).id,'other-idea');
  assert.deepEqual(next.attempts,[]);assert.strictEqual(next.actions,state.actions);assert.strictEqual(next.session,state.session);
  assert.deepEqual(state,before);
  assert.throws(()=>session(next),/Resume or end/);
  assert.throws(()=>session(workspace(),{budgetMinutes:0}));
  assert.throws(()=>session(workspace(),{maxItems:51}));
  assert.throws(()=>session(workspace(),{now:'2026-02-30T12:00:00.000Z'}));
});

test('answer and reveal persist through JSON navigation/reload and source/project changes without an assessment',()=>{
  let state=session(workspace());
  const original=structuredClone(state);
  state=writeReviewAnswer(state,'My partial answer.');
  assert.equal(state.reviewSession.revealed,false);assert.equal(state.reviewSession.answer,'My partial answer.');
  state={...state,view:'library',activeProjectId:'other-project',selectedSourceId:'other-source',selectedIdeaId:'other-idea'};
  const restored=JSON.parse(JSON.stringify(state));
  assert.deepEqual(validateReviewSession(restored.reviewSession,restored),restored.reviewSession);
  state=revealReview(restored);
  assert.equal(state.activeProjectId,original.activeProjectId);assert.equal(state.selectedSourceId,original.selectedSourceId);assert.equal(state.selectedIdeaId,original.selectedIdeaId);
  assert.equal(state.reviewSession.answer,'My partial answer.');assert.equal(state.reviewSession.revealed,true);
  assert.equal(state.attempts.length,0);
  assert.throws(()=>rateReview({...state,reviewSession:{...state.reviewSession,revealed:false}},'understood',{now:NOW}),/Reveal/);
});

test('couldn’t recall honestly permits blank or own partial text and forces Again without inventing an answer',()=>{
  const started=session(workspace(),{maxItems:1});
  assert.throws(()=>revealReview(started),/couldn’t recall/);
  let next=revealReview(started,{couldNotRecall:true});
  next=rateReview(next,'understood',{now:NOW});
  assert.equal(next.attempts[0].answer,'');assert.equal(next.attempts[0].couldNotRecall,true);
  assert.equal(next.attempts[0].rating,'again');assert.equal(next.attempts[0].dueAt,'2026-10-14T12:00:00.000Z');
  const partial=rateReview(revealReview(writeReviewAnswer(started,'I remember only the finish line.'),{couldNotRecall:true}),'uncertain',{now:NOW});
  assert.equal(partial.attempts[0].answer,'I remember only the finish line.');assert.equal(partial.attempts[0].rating,'again');
  assert.throws(()=>revealReview(started,{couldNotRecall:'yes'}));
});

test('rating captures exact immutable question, criteria and untruncated original source, then advances selection',()=>{
  let state=workspace();
  const [first,second]=state.ideas;
  const source=state.sources.find(item=>item.id===first.sourceId),paragraph=source.paragraphs.find(item=>item.id===first.paragraphId);
  state=answered(session(state));
  const before=structuredClone(state);freeze(state);
  let next=rateReview(state,'uncertain',{now:NOW});
  const attempt=next.attempts[0];
  assert.equal(attempt.promptSnapshot,first.question);assert.equal(attempt.criteriaSnapshot,first.answerCriteria);assert.equal(attempt.referenceSnapshot,paragraph.text);
  assert.equal(attempt.sourceId,source.id);assert.equal(attempt.paragraphId,paragraph.id);assert.equal(attempt.sessionId,next.reviewSession.id);assert.equal(attempt.couldNotRecall,false);
  assert.equal(attempt.dueAt,'2026-10-16T12:00:00.000Z');
  assert.equal(next.reviewSession.index,1);assert.deepEqual(next.reviewSession.checkedIds,[first.id]);assert.equal(next.reviewSession.answer,'');assert.equal(next.reviewSession.revealed,false);
  assert.equal(next.selectedIdeaId,second.id);assert.equal(next.selectedSourceId,second.sourceId);assert.equal(next.activeProjectId,second.projectId);
  assert.deepEqual(state,before);
  next={...next,ideas:next.ideas.map(item=>item.id===first.id?{...item,question:'A changed question',answerCriteria:'New criteria'}:item)};
  assert.equal(next.attempts[0].promptSnapshot,first.question);assert.equal(next.attempts[0].criteriaSnapshot,first.answerCriteria);
  assert.deepEqual(validateReviewSession(next.reviewSession,next),next.reviewSession);
});

test('a skipped item creates no attempt or due change and finite progress resumes unchanged',()=>{
  let state=workspace();
  const first=state.ideas[0];state.attempts=[legacyAttempt(first.id)];
  state=session(state,{maxItems:2});
  const attempts=state.attempts;
  const next=skipReview(writeReviewAnswer(state,'A draft I chose not to assess.'));
  assert.strictEqual(next.attempts,attempts);assert.equal(next.reviewSession.index,1);assert.deepEqual(next.reviewSession.skippedIds,[first.id]);assert.deepEqual(next.reviewSession.checkedIds,[]);
  assert.equal(next.reviewSession.answer,'');assert.equal(next.reviewSession.lastUndo,null);
  const restored=JSON.parse(JSON.stringify(next));assert.deepEqual(validateReviewSession(restored.reviewSession,restored),restored.reviewSession);
  assert.ok(dueReviewQueue(restored,{date:'2026-10-13'}).some(item=>item.id===first.id));
  const complete=skipReview(restored);assert.equal(currentReviewItem(complete),null);assert.equal(complete.reviewSession.index,2);
  assert.throws(()=>skipReview(complete),/finished/);
  const ended=endReview(complete);assert.equal(ended.reviewSession,null);assert.deepEqual(ended.attempts,attempts);
});

test('Undo removes only the latest own assessment and restores original item, answer and failure state',()=>{
  let state=workspace(),first=state.ideas[0];
  const legacy=legacyAttempt(first.id);state.attempts=[legacy];
  state=revealReview(writeReviewAnswer(session(state),'My partial memory.'),{couldNotRecall:true});
  const rated=rateReview(state,'again',{now:NOW});
  const unrelated=legacyAttempt('other-idea',{id:'unrelated',sessionId:null,createdAt:NOW,dueAt:'2026-10-14T12:00:00.000Z'});
  const next=undoReview({...rated,attempts:[...rated.attempts,unrelated]});
  assert.deepEqual(next.attempts,[legacy,unrelated]);assert.equal(next.reviewSession.index,0);assert.equal(next.reviewSession.answer,'My partial memory.');assert.equal(next.reviewSession.revealed,true);assert.equal(next.reviewSession.couldNotRecall,true);
  assert.equal(next.selectedIdeaId,first.id);assert.deepEqual(next.reviewSession.checkedIds,[]);assert.equal(next.reviewSession.lastUndo,null);
  assert.throws(()=>undoReview(next),/no assessment/);
  const completed=rateReview(answered(session(workspace(),{maxItems:1})),'understood',{now:NOW});
  assert.equal(completed.reviewSession.index,1);assert.equal(undoReview(completed).reviewSession.index,0,'completion still offers Undo');
});

test('strict validation rejects fabricated progress, missing context, mismatched Undo and out-of-bounds drafts',()=>{
  const started=session(workspace());
  assert.equal(validateReviewSession(null,started),null);
  const invalidSession=changes=>({...started.reviewSession,...changes});
  assert.throws(()=>validateReviewSession(invalidSession({ideaIds:[started.reviewSession.ideaIds[0],started.reviewSession.ideaIds[0]]}),started),/Duplicate/);
  assert.throws(()=>validateReviewSession(invalidSession({index:1,checkedIds:[started.reviewSession.ideaIds[0]]}),started),/retained session assessments/);
  assert.throws(()=>validateReviewSession(invalidSession({index:1,skippedIds:['other-idea']}),started),/queue position/);
  assert.throws(()=>validateReviewSession(invalidSession({couldNotRecall:true}),started),/comparison/);
  assert.throws(()=>validateReviewSession(invalidSession({answer:'x'.repeat(100001)}),started),/answer/);
  assert.throws(()=>validateReviewSession(started.reviewSession,{...started,sources:[]}),/original source/);
  const rated=rateReview(answered(started),'again',{now:NOW});
  assert.throws(()=>validateReviewSession({...rated.reviewSession,lastUndo:{...rated.reviewSession.lastUndo,answer:'Invented'}},rated),/original answer/);
  const injected={...started,attempts:[{...rated.attempts[0],sessionId:started.reviewSession.id}]};
  assert.throws(()=>validateReviewSession(started.reviewSession,injected),/retained session assessments/);
  const skip=skipReview(rated);assert.equal(skip.reviewSession.lastUndo,null,'skipping clears a stale assessment Undo');
});

test('empty due scopes and malformed assessments fail before history changes',()=>{
  const state=workspace();
  state.attempts=state.ideas.map((item,index)=>legacyAttempt(item.id,{id:`future-${index}`,dueAt:'2027-01-01T12:00:00.000Z'}));
  const before=structuredClone(state);assert.throws(()=>session(state),/No questions/);assert.deepEqual(state,before);
  const started=answered(session(workspace()));
  assert.throws(()=>rateReview(started,'automatic-grade',{now:NOW}),/Unknown/);
  assert.throws(()=>rateReview(started,'again',{now:'2026-10-12T12:00:00.000Z'}),/precede/);
  assert.equal(started.attempts.length,0);
});

test('a planned queue retains membership and order but omits questions already assessed before the reservation',()=>{
  const state=workspace(),[first,second,third]=state.ideas;
  const membership=[third.id,first.id,second.id];
  const before=structuredClone(state);
  assert.deepEqual(session(state,{ideaIds:membership,maxItems:2}).reviewSession.ideaIds,[third.id,first.id]);
  assert.deepEqual(state,before,'opening a planned queue does not mutate the reservation or create evidence');
  const changed={...state,attempts:[legacyAttempt(first.id,{createdAt:'2026-10-12T12:00:00.000Z',dueAt:'2026-10-19T12:00:00.000Z'})]};
  assert.deepEqual(session(changed,{ideaIds:membership,maxItems:3}).reviewSession.ideaIds,[third.id,second.id]);
  assert.throws(()=>session(changed,{ideaIds:[first.id]}),/No questions/);
  assert.throws(()=>session(state,{ideaIds:['missing']}),/missing/);
  assert.throws(()=>session(state,{ideaIds:[first.id,first.id]}),/Duplicate/);
  assert.throws(()=>session(state,{ideaIds:[third.id],projectId:state.projects[0].id}),/outside/);
});
