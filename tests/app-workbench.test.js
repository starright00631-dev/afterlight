import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createExampleState, reviewDue, sessionElapsed, uid } from '../domain.js';
import { validateState } from '../persistence.js';
import { closeWorkSession } from '../work-sessions.js';
import { readyActions, remainingMinutes, validateBlockPlacement, createWorkspaceCalendar } from '../workspace-planner.js';
import { startReviewSession } from '../review-sessions.js';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = appSource.indexOf(start), to = appSource.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `App function boundary ${start}`);
  return appSource.slice(from, to);
}
function fixture() {
  const state = validateState(createExampleState()), now = new Date();
  state.session = { actionId: state.actions[0].id, running: true,
    startedAt: now.getTime() - 60000, elapsedMs: 0, goalMinutes: 30,
    blockId: null, sessionStartedAt: new Date(now.getTime() - 60000).toISOString() };
  return validateState(state);
}

function crossProjectReview() {
  let state=fixture();const other=validateState(createExampleState());
  state.projects.push(...other.projects);state.sources.push(...other.sources);
  state.ideas.push(...other.ideas);state.actions.push(...other.actions);
  state.actions[0].reviewMinutes=10;state.actions[0].reviewIdeaIds=[other.ideas[0].id];state.actions[0].reviewMaxItems=1;
  state.session.goalMinutes=10;
  state=startReviewSession(state,{projectId:null,maxItems:1,budgetMinutes:10,ideaIds:[other.ideas[0].id]});
  return validateState(state);
}

// Exercise the actual app functions with only browser side effects replaced.
// This catches reference/transaction regressions across the app's pure modules.
function harness(state, { reject = false } = {}) {
  const nodes = new Map(), notices = [], saved = [], events = new Map();
  let commits = 0;
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      events: new Map(), focus() {}, scrollIntoView() {},
      addEventListener(type, handler) { this.events.set(type, handler); },
    });
    return nodes.get(selector);
  };
  const scope = {
    state, structuredClone, Date, Number, String, Error, Boolean,
    closeWorkSession, readyActions, remainingMinutes, validateBlockPlacement, startReviewSession, validateState, sessionElapsed, uid,
    $: node, esc: value => String(value ?? ''), nowISO: () => new Date().toISOString(),
    dialog: { close() {} }, showDialog() {}, confirmAction() {}, render() {},
    renderWork() {}, tick() {}, draftActionId: null, workMode: 'draft',
    document: { addEventListener(type, handler) { events.set(type, handler); } },
    notify: value => notices.push(value), matchMedia: () => ({ matches: true }),
    FormData: class { constructor(target) { this.values = target.values; } get(key) { return this.values[key] ?? ''; } getAll(key) { return this.values[key] ?? []; } },
  };
  scope.persist = () => { saved.push(validateState(scope.state)); return true; };
  scope.commitStudio = candidate => { commits++; if (reject) return false; scope.state = validateState(candidate); saved.push(structuredClone(scope.state)); return true; };
  runInNewContext(`
    const project=()=>state.projects.find(item=>item.id===state.activeProjectId)||state.projects[0];
    const projectIdeas=()=>state.ideas.filter(item=>item.projectId===project().id);
    const projectActions=()=>state.actions.filter(item=>item.projectId===project().id);
    ${section('const draftAction=', 'const lightLab=')}
    function inspectDraftAction(){return draftAction()?.id;}
    ${section('function endSession(', 'function openReview(')}
    ${section('function toggleReviewFocus(', 'function planReview(')}
    ${section('function openAgendaAction(', 'function renderQuietRecord(')}
    ${section('function toggleFocus(', 'function setDone(')}
    ${section('function setDone(', 'function openProject(')}
    ${section('function openAction(', 'async function askAssistant(')}
    ${section("document.addEventListener('click'", "document.addEventListener('submit'")}
  `, scope);
  return { scope, nodes, notices, saved, get commits() { return commits; },
    get state() { return scope.state; },
    complete(id) { scope.setDone(scope.state.actions.find(item => item.id === id)); },
    open(id,blockId=null) { scope.openAgendaAction(id, blockId); },
    focus(id) { scope.draftActionId = id; scope.toggleFocus(); },
    reviewFocus() { scope.toggleReviewFocus(); },
    get draftId() { return scope.inspectDraftAction(); },
    async clickWork(id) {
      const button = { dataset: { act: 'work-action', actionId: id }, disabled: false,
        closest() { return this; }, hasAttribute() { return false; } };
      await events.get('click')({ target: button });
    },
    edit(id, values) {
      scope.openAction(id);
      const target = { values };
      node('#action-form').events.get('submit')({ currentTarget: target, preventDefault() {} });
    },
  };
}

test('explicit completion of active work updates the retained action after closing its cloned session', () => {
  const state = fixture(), id = state.actions[0].id, h = harness(state);
  h.complete(id);
  const action = h.state.actions.find(item => item.id === id);
  assert.equal(action.status, 'done');
  assert.ok(action.completedAt);
  assert.equal(h.state.session, null);
  assert.equal(h.state.workbench.sessions.length, 1);
  assert.ok(action.spentMs >= 60000);
  assert.equal(h.saved.at(-1).actions.find(item => item.id === id).status, 'done');
});

test('starting a split reservation uses its session length without reducing the task estimate', () => {
  const state=fixture(),action=state.actions[0];state.session=null;
  state.workbench.calendar=createWorkspaceCalendar(state.projects[0].plan);
  const block={id:'split-session',actionId:action.id,date:state.workbench.calendar.startDate,startMinute:1140,minutes:15,pinned:true,status:'planned'};
  state.workbench.blocks=[block];const h=harness(validateState(state));
  h.open(action.id,block.id);
  assert.equal(h.state.session.goalMinutes,15);
  assert.equal(h.state.session.blockId,block.id);
  assert.equal(h.state.actions[0].minutes,action.minutes);
  assert.equal(h.state.actions[0].remainingMinutes,action.remainingMinutes);
  assert.deepEqual(h.state.workbench.blocks,[block]);
  assert.equal(h.state.workbench.sessions.length,0);
});

test('a stale reservation cannot close the current timer before its placement is checked', () => {
  const state=fixture(),action=state.actions[0];
  state.workbench.calendar=createWorkspaceCalendar(state.projects[0].plan);
  const block={id:'stale-session',actionId:action.id,date:state.workbench.calendar.startDate,startMinute:1080,minutes:15,pinned:true,status:'planned'};
  state.workbench.blocks=[block];const h=harness(validateState(state)),before=structuredClone(h.state);
  h.open(action.id,block.id);
  assert.equal(h.commits,0);
  assert.deepEqual(h.state,before);
  assert.match(h.notices.at(-1),/outside free availability/);
});

test('saving active work as done retains the form edits rather than modifying a detached action reference', () => {
  const state = fixture(), id = state.actions[0].id, h = harness(state);
  h.edit(id, { title: 'A revised inspectable output', minutes: '45', status: 'done',
    remainingMinutes: '0', ideaId: '', deadline: '', dependencies: [] });
  const action = h.state.actions.find(item => item.id === id);
  assert.equal(action.title, 'A revised inspectable output');
  assert.equal(action.minutes, 45);
  assert.equal(action.remainingMinutes, 0);
  assert.equal(action.status, 'done');
  assert.equal(h.state.session, null);
  assert.equal(h.saved.at(-1).actions.find(item => item.id === id).title, action.title);
});

test('a planned review with no still-due questions cannot end unrelated active work', () => {
  const state = fixture(), idea = state.ideas[0], source = state.sources.find(item => item.id === idea.sourceId);
  const paragraph = source.paragraphs.find(item => item.id === idea.paragraphId), createdAt = new Date().toISOString();
  state.attempts.push({ id: 'recent-assessment', ideaId: idea.id, answer: 'My retained answer.',
    rating: 'understood', createdAt, dueAt: reviewDue('understood', createdAt),
    promptSnapshot: idea.question, criteriaSnapshot: idea.answerCriteria,
    referenceSnapshot: paragraph.text, sourceId: source.id, paragraphId: paragraph.id,
    couldNotRecall: false, sessionId: null });
  state.actions.push({ ...structuredClone(state.actions[0]), id: 'planned-review', title: 'A source review',
    minutes: 10, dependsOn: [], reviewMinutes: 10, reviewMaxItems: 1, reviewIdeaIds: [idea.id] });
  const h = harness(validateState(state)), before = structuredClone(h.state);
  h.open('planned-review');
  assert.deepEqual(h.state, before);
  assert.equal(h.commits, 0);
  assert.ok(h.notices.some(message => /No questions are due/.test(message)));
});

test('a rejected new session commit retains the existing focus timer and actual work records', () => {
  const state = fixture();
  state.actions.push({ ...structuredClone(state.actions[0]), id: 'other-ready-work', title: 'Another ready output', dependsOn: [] });
  const h = harness(validateState(state), { reject: true }), before = structuredClone(h.state);
  h.open('other-ready-work');
  assert.equal(h.commits, 1);
  assert.deepEqual(h.state, before);
  assert.equal(h.saved.length, 0);
});

test('a focus timer cannot bypass unfinished prerequisites through the Draft pane', () => {
  const state = fixture(), child = state.actions[1], h = harness(state), before = structuredClone(state);
  h.focus(child.id);
  assert.deepEqual(h.state, before);
  assert.equal(h.commits, 0);
  assert.ok(h.notices.some(message => /prerequisite/.test(message)));
});

test('currently running focus can still be paused after its action becomes blocked', () => {
  const state = fixture(), action = state.actions[0]; action.status = 'blocked';
  const h = harness(validateState(state));
  h.focus(action.id);
  assert.equal(h.state.session.running, false);
  assert.equal(h.state.session.startedAt, null);
  assert.ok(h.state.session.elapsedMs >= 60000);
  assert.equal(h.state.workbench.sessions.length, 0, 'pausing retains the open session rather than inventing an outcome');
});

test('opening a retained work record selects its own project and output', async () => {
  const state = fixture(), another = validateState(createExampleState());
  state.projects.push(...another.projects); state.sources.push(...another.sources);
  state.ideas.push(...another.ideas); state.actions.push(...another.actions);
  const otherAction = another.actions[0], h = harness(validateState(state));
  await h.clickWork(otherAction.id);
  assert.equal(h.state.activeProjectId, otherAction.projectId);
  assert.equal(h.draftId, otherAction.id);
  assert.equal(h.scope.workMode, 'draft');
});

test('planned review pause and resume preserve a global queue and the foreign selected source context',()=>{
  const state=crossProjectReview(),h=harness(state),selection={projectId:state.activeProjectId,sourceId:state.selectedSourceId,ideaId:state.selectedIdeaId},queue=structuredClone(state.reviewSession);
  assert.notEqual(state.activeProjectId,state.actions.find(a=>a.id===state.session.actionId).projectId);
  h.reviewFocus();assert.equal(h.state.session.running,false);assert.ok(h.state.session.elapsedMs>=60000);
  h.reviewFocus();assert.equal(h.state.session.running,true);assert.ok(h.state.session.startedAt);
  assert.deepEqual({projectId:h.state.activeProjectId,sourceId:h.state.selectedSourceId,ideaId:h.state.selectedIdeaId},selection);
  assert.deepEqual(h.state.reviewSession,queue);assert.equal(h.state.reviewSession.projectId,null);
  assert.equal(h.state.workbench.sessions.length,0);assert.equal(h.commits,2);
});

for(const running of [true,false]){
  test(`a refused planned review ${running?'pause':'resume'} retains its timer and cross-project queue`,()=>{
    const state=crossProjectReview();
    if(!running){state.session.running=false;state.session.startedAt=null;state.session.elapsedMs=60000;}
    const h=harness(validateState(state),{reject:true}),before=structuredClone(h.state);
    h.reviewFocus();assert.equal(h.commits,1);assert.deepEqual(h.state,before);assert.equal(h.saved.length,0);
  });
}
