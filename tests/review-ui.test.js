import test from 'node:test';
import assert from 'node:assert/strict';
import {createExampleState} from '../domain.js';
import {startReviewSession,writeReviewAnswer,revealReview,validateReviewSession} from '../review-sessions.js';
import {mountReview} from '../review-ui.js';

function initial() {
  const state=createExampleState();state.reviewSession=null;
  state.ideas.forEach((item,index)=>{item.answerCriteria=`Only after reveal: criterion ${index+1}.`;});
  return state;
}
// A narrow DOM boundary double executes the actual installed delegated handlers
// and observes focus/markup/commits. Real responsive rendering is app-level QA.
function mount(t,state,{reject=false}={}) {
  const events=new Map(),notices=[],changed=[],read=[],plans=[],nodes=new Map();
  let writes=0,commits=0,active=null;
  const host={
    get innerHTML(){return this.markup??'';},
    set innerHTML(markup){this.markup=markup;writes++;nodes.clear();
      const scope=/option value="([^"]+)" selected/.exec(markup)?.[1]??state.activeProjectId;
      node('[data-review-scope]').value=scope;
      node('[data-review-budget]').value=/data-review-budget[^>]*value="(\d+)"/.exec(markup)?.[1]??'10';
      node('[data-review-limit]').value=/data-review-limit[^>]*value="(\d+)"/.exec(markup)?.[1]??'5';
    },
    addEventListener(type,handler){events.set(type,handler);},
    removeEventListener(type,handler){if(events.get(type)===handler)events.delete(type);},
    contains(item){return item.owner===host;},
    querySelector(selector){return node(selector);}
  };
  function node(selector){if(!nodes.has(selector))nodes.set(selector,{owner:host,value:'',focus(options){active={selector,options};},matches(check){return check===selector;}});return nodes.get(selector);}
  function dispatch(type,target){let stopped=false,prevented=false;events.get(type)?.({target,stopPropagation(){stopped=true;},preventDefault(){prevented=true;}});return {stopped,prevented};}
  const view=mountReview(host,{getState:()=>state,commitState(next){commits++;if(reject)return false;validateReviewSession(next.reviewSession,next);state=next;return true;},notify:message=>notices.push(message),onReadSource:value=>read.push(value),onPlanSession:value=>plans.push(value),onChanged:value=>changed.push(value)});
  t.after(()=>view.destroy());
  return {view,host,events,notices,changed,read,plans,node,get state(){return state;},get writes(){return writes;},get commits(){return commits;},get active(){return active;},
    click(action,{rate=false,disabled=false}={}){const button={owner:host,disabled,dataset:rate?{reviewRate:action}:{review:action},closest(){return this;}};return dispatch('click',button);},
    answer(value){const target=node('[data-review-answer]');target.value=value;return dispatch('input',target);},
    start(){return dispatch('submit',{dataset:{reviewForm:'start'}});},
    change(selector,value){const target=node(selector);target.value=value;return dispatch('change',target);}
  };
}

test('review mount submits bounded labelled settings through the commit boundary and focuses the current question',t=>{
  const h=mount(t,initial());
  assert.match(h.host.innerHTML,/Minutes to set aside/);assert.match(h.host.innerHTML,/Maximum questions/);
  h.node('[data-review-budget]').value='12';h.node('[data-review-limit]').value='1';
  assert.deepEqual(h.start(),{stopped:true,prevented:true});
  assert.equal(h.state.reviewSession.budgetMinutes,12);assert.equal(h.state.reviewSession.ideaIds.length,1);
  assert.equal(h.state.attempts.length,0);assert.equal(h.active.selector,'[data-review-current]');assert.equal(h.changed.at(-1).type,'start');
});

test('hidden recall does not render the passage, criteria or retained answer references before explicit reveal',t=>{
  let state=initial(),idea=state.ideas[0],paragraph=state.sources[0].paragraphs.find(item=>item.id===idea.paragraphId);
  state.attempts=[{id:'legacy',ideaId:idea.id,answer:'Earlier answer.',rating:'again',createdAt:'2026-01-01T00:00:00.000Z',dueAt:'2026-01-02T00:00:00.000Z',promptSnapshot:idea.question,criteriaSnapshot:'Historical criteria hidden too',referenceSnapshot:paragraph.text,sourceId:idea.sourceId,paragraphId:idea.paragraphId,sessionId:null,couldNotRecall:false}];
  state=startReviewSession(state,{maxItems:1});
  const h=mount(t,state);
  assert.ok(!h.host.innerHTML.includes(paragraph.text));assert.ok(!h.host.innerHTML.includes(idea.answerCriteria));assert.ok(!h.host.innerHTML.includes('Historical criteria hidden too'));
  h.click('reveal');assert.equal(h.state.reviewSession.revealed,false);assert.match(h.notices.at(-1),/couldn’t recall/);
  const writes=h.writes,changes=h.changed.length;
  assert.deepEqual(h.answer('My own answer.'),{stopped:true,prevented:false});
  assert.equal(h.state.reviewSession.answer,'My own answer.');assert.equal(h.writes,writes,'typing retains the DOM and caret');assert.equal(h.changed.length,changes,'typing does not invoke a shell rerender');
  h.click('reveal');assert.equal(h.state.reviewSession.revealed,true);assert.ok(h.host.innerHTML.includes(paragraph.text));assert.ok(h.host.innerHTML.includes(idea.answerCriteria));
  assert.equal(h.active.selector,'[data-review-comparison]');assert.equal(h.state.attempts.length,1,'reveal creates no review');
});

test('failure path, assessment, automatic advance and Undo retain actual context and expose fixed interval labels',t=>{
  const state=startReviewSession(initial(),{maxItems:2}),first=state.ideas[0];
  const h=mount(t,state);
  h.click('failure');assert.equal(h.state.reviewSession.couldNotRecall,true);assert.equal(h.state.reviewSession.answer,'');
  assert.match(h.host.innerHTML,/data-review-rate="uncertain" disabled/);assert.match(h.host.innerHTML,/In 1 day/);assert.match(h.host.innerHTML,/Fixed revisit rules/);
  const attempts=h.state.attempts.length;
  h.click('uncertain',{rate:true,disabled:true});assert.equal(h.state.attempts.length,attempts);
  h.click('again',{rate:true});assert.equal(h.state.attempts[0].answer,'');assert.equal(h.state.attempts[0].rating,'again');assert.equal(h.state.attempts[0].promptSnapshot,first.question);
  assert.equal(h.state.reviewSession.index,1);assert.equal(h.state.selectedIdeaId,state.ideas[1].id);assert.match(h.host.innerHTML,/Question 2 of 2/);
  h.click('undo');assert.equal(h.state.attempts.length,0);assert.equal(h.state.reviewSession.index,0);assert.equal(h.state.reviewSession.couldNotRecall,true);assert.equal(h.state.reviewSession.revealed,true);
});

test('source and Week navigation preserve a resumed draft and create neither assessment nor planned work',t=>{
  const state=writeReviewAnswer(startReviewSession(initial(),{projectId:null,maxItems:2}),'Keep this answer while reading.');
  const before=structuredClone(state),h=mount(t,state);
  h.click('source');assert.deepEqual(h.read,[{ideaId:state.ideas[0].id,sourceId:state.ideas[0].sourceId,paragraphId:state.ideas[0].paragraphId}]);
  h.click('plan');assert.equal(h.plans[0].projectId,null,'all-project session stays global rather than becoming the mounted project');assert.deepEqual(h.plans[0].ideaIds,state.reviewSession.ideaIds);
  assert.equal(h.commits,0);assert.deepEqual(h.state,before);
  h.view.render();assert.ok(h.host.innerHTML.includes('Keep this answer while reading.'));
});

test('Skip creates no due change, completion has honest counts, and ending retains history',t=>{
  const h=mount(t,startReviewSession(initial(),{maxItems:2}));
  h.click('skip');assert.equal(h.state.attempts.length,0);assert.deepEqual(h.state.reviewSession.skippedIds,[h.state.ideas[0].id]);
  h.answer('An inspectable output.');h.click('reveal');h.click('understood',{rate:true});
  assert.match(h.host.innerHTML,/This queue is finished/);assert.match(h.host.innerHTML,/1 checked · 1 skipped · 0 remaining/);
  assert.match(h.host.innerHTML,/Skipped questions keep their previous due dates/);
  const attempt=structuredClone(h.state.attempts[0]);h.click('end');assert.equal(h.state.reviewSession,null);assert.deepEqual(h.state.attempts,[attempt]);
});

test('legacy history says context is unavailable and source-derived markup is safely escaped',t=>{
  let state=initial(),idea=state.ideas[0];
  state.attempts=[{id:'legacy',ideaId:idea.id,answer:'<script>legacy</script>',rating:'again',createdAt:'2026-01-01T00:00:00.000Z',dueAt:'2026-01-02T00:00:00.000Z'}];
  state=revealReview(writeReviewAnswer(startReviewSession(state,{maxItems:1}),'<img src=x onerror=alert(1)>'));
  const h=mount(t,state);
  assert.match(h.host.innerHTML,/original question context was not saved/);assert.ok(h.host.innerHTML.includes('&lt;script&gt;legacy&lt;/script&gt;'));assert.ok(!h.host.innerHTML.includes('<script>'));
  assert.ok(h.host.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('a refused commit leaves local UI/evidence intact and disposed handlers cannot navigate or save',t=>{
  const state=startReviewSession(initial()),h=mount(t,state,{reject:true}),before=structuredClone(state),writes=h.writes;
  h.click('failure');assert.deepEqual(h.state,before);assert.equal(h.writes,writes);assert.equal(h.changed.length,0);
  h.view.destroy();assert.equal(h.events.size,0);h.click('source');h.answer('Never saved.');assert.equal(h.read.length,0);assert.equal(h.commits,1);
});

test('planning settings validate before a reservation callback and an idle proposal creates no assessment',t=>{
  const h=mount(t,initial());h.change('[data-review-budget]','0');h.click('plan');assert.equal(h.plans.length,0);assert.match(h.notices.at(-1),/1–120/);
  h.change('[data-review-budget]','15');h.change('[data-review-limit]','2');h.click('plan');assert.equal(h.plans.length,1);assert.equal(h.plans[0].budgetMinutes,15);assert.equal(h.plans[0].ideaIds.length,2);assert.equal(h.state.attempts.length,0);assert.equal(h.state.reviewSession,null);assert.equal(h.commits,0);
});

test('ending an externally started scoped review returns to that project rather than the project mounted earlier',t=>{
  const state=initial(),other=initial(),originalProject=state.activeProjectId;
  state.projects[0].title='Initial table project';other.projects[0].title='Queued study project';
  state.projects.push(...other.projects);state.sources.push(...other.sources);state.ideas.push(...other.ideas);
  const h=mount(t,state);
  assert.equal(h.node('[data-review-scope]').value,originalProject);
  // The app changes projects in Ideas, then starts a retained queue without
  // mounting the review setup in between (the actual phone regression).
  h.state.activeProjectId=other.activeProjectId;
  Object.assign(h.state,startReviewSession(h.state,{projectId:other.activeProjectId,maxItems:1}));
  h.view.render();h.click('end');
  assert.equal(h.state.reviewSession,null);
  assert.equal(h.node('[data-review-scope]').value,other.activeProjectId);
  assert.match(h.host.innerHTML,/due in Queued study project/);
  h.start();
  assert.equal(h.state.reviewSession.projectId,other.activeProjectId);
  assert.ok(h.state.reviewSession.ideaIds.every(id=>other.ideas.some(item=>item.id===id)));
});

test('ending a global queue retains All projects after advancement has selected another project',t=>{
  const state=initial(),other=initial();state.projects.push(...other.projects);state.sources.push(...other.sources);state.ideas.push(...other.ideas);
  const h=mount(t,state);
  Object.assign(h.state,startReviewSession(h.state,{projectId:null,maxItems:1,ideaIds:[other.ideas[0].id]}));
  h.view.render();h.click('end');
  assert.equal(h.node('[data-review-scope]').value,'all');
  assert.match(h.host.innerHTML,/due in All projects/);
});
