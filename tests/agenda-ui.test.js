import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, createExampleState, todayISO } from '../domain.js';
import { validateState } from '../persistence.js';
import { mountAgenda } from '../agenda-ui.js';

function fixture() {
  const state = validateState(createExampleState());
  state.workbench.calendar = {
    timeZone: 'Asia/Shanghai', startDate: todayISO(), days: 7,
    defaultWindows: [{ startMinute: 1140, endMinute: 1260 }],
    overrides: [], commitments: [], restMinutes: 5, minBlockMinutes: 15,
  };
  return validateState(state);
}
function allocation(state, extra = {}) {
  return { id: 'accepted-first', actionId: state.actions[0].id, date: todayISO(),
    startMinute: 1140, minutes: state.actions[0].minutes, pinned: false,
    status: 'planned', ...extra };
}
function recorded(state, extra = {}) {
  return { id: 'recorded-stop', actionId: state.actions[0].id,
    actionTitle: state.actions[0].title, blockId: 'accepted-first',
    startedAt: '2026-10-13T11:00:00.000Z', endedAt: '2026-10-13T11:10:00.000Z',
    durationMs: 600000, outcome: 'stopped', output: '', nextStep: '',
    remainingMinutesAfter: null, ...extra };
}

// This boundary double invokes the installed event handlers and the real save
// validator. Browser QA separately checks layout, forms and actual focus.
function mount(t, state, { reject = false } = {}) {
  const notices = [], work = [], reviews = [], edits = [], errors = [];
  let commits = 0, added = 0;
  function surface() {
    const events = new Map();
    const host = {
      innerHTML: '', events, queries: [], targets: new Map(),
      addEventListener(type, handler) { events.set(type, handler); },
      removeEventListener(type, handler) { if (events.get(type) === handler) events.delete(type); },
      contains(item) { return item.owner === host; },
      querySelector(selector) { host.queries.push(selector); return host.targets.get(selector) || null; },
    };
    return host;
  }
  function formBoundary(callback) {
    const NativeFormData = globalThis.FormData;
    // Preserve native entry/get/has behavior while supplying the DOM boundary.
    // Click-triggered rerenders may capture a retained editor as well as submit.
    globalThis.FormData = class extends NativeFormData {
      constructor(target) {
        if (!target?.agendaTestForm) { super(target); return; }
        super();
        for (const input of target.inputs) {
          if (input.type === 'checkbox') { if (input.checked) this.append(input.name, 'on'); }
          else this.append(input.name, input.value);
        }
      }
    };
    try { return callback(); } finally { globalThis.FormData = NativeFormData; }
  }
  const host = surface(), desk = surface();
  const view = mountAgenda(host, desk, {
    getState: () => state,
    commitState(next) {
      commits++;
      if (reject) return false;
      try { state = validateState(next); return true; }
      catch (error) { errors.push(error.message); return false; }
    },
    notify: message => notices.push(message),
    onWorkAction: (...args) => work.push(args), onReview: () => reviews.push(true),
    onEditAction: id => edits.push(id), onNewAction: () => { added++; },
  });
  view.render();
  t.after(() => view.destroy());
  return {
    host, desk, view, notices, work, reviews, edits, errors,
    get state() { return state; }, get commits() { return commits; },
    get added() { return added; },
    replace(next) { state = validateState(next); },
    click(action, { id, block, date, start, end, disabled = false, desk: atDesk = false } = {}) {
      const owner = atDesk ? desk : host;
      const button = { owner, disabled, dataset: { agenda: action, id, block, date, start, end }, closest() { return this; } };
      let prevented = false, stopped = false;
      formBoundary(() => owner.events.get('click')?.({ target: button, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }));
      return { prevented, stopped };
    },
    submit(kind, values) {
      const entries = Object.entries(values).filter(([, value]) => value !== false && value !== null);
      const inputs = entries.map(([name, value]) => ({ name, type: value === true ? 'checkbox' : 'text', value: String(value), checked: value === true }));
      const form = { owner: host, agendaTestForm: true, inputs, dataset: { agendaForm: kind }, closest() { return this; },
        querySelectorAll(selector) { return selector.includes('checkbox') ? inputs.filter(input => input.type === 'checkbox') : inputs; } };
      host.targets.set('[data-agenda-form]', form);
      let prevented = false, stopped = false;
      formBoundary(() => host.events.get('submit')?.({ target: form, currentTarget: form, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }));
      return { prevented, stopped, inputs };
    },
  };
}

function buttonWith(markup, ...attributes) {
  return (markup.match(/<button\b[^>]*>/g) || []).find(tag => attributes.every(attribute => tag.includes(attribute)));
}
function inputWith(markup, name) {
  return (markup.match(/<input\b[^>]*>/g) || []).find(tag => tag.includes(`name="${name}"`));
}

test('a proposal is a read-only preview until an explicit accepted save', t => {
  const h = mount(t, fixture()), before = structuredClone(h.state);
  assert.deepEqual(h.click('propose'), { prevented: true, stopped: true });
  assert.equal(h.commits, 0);
  assert.deepEqual(h.state, before);
  assert.match(h.host.innerHTML, /not yet reserved/);
  assert.match(h.host.innerHTML, /Accept these sessions/);
  h.click('accept');
  assert.equal(h.commits, 1);
  assert.equal(h.errors.length, 0);
  assert.ok(h.state.workbench.blocks.length > 0);
  assert.deepEqual(h.state.actions, before.actions, 'reserving time cannot fabricate progress or change estimates');
  assert.equal(h.state.workbench.sessions.length, 0);
});

test('an empty adopted calendar exposes creating the first action as its primary control', t => {
  const state=fixture();state.actions=[];const h=mount(t,validateState(state));
  const toolbar=h.host.innerHTML.slice(0,h.host.innerHTML.indexOf('<div class="agenda-map-layout"'));
  assert.match(buttonWith(toolbar,'data-agenda="new-action"'),/class="primary"/);
  assert.doesNotMatch(toolbar,/data-agenda="propose"/);
  h.click('new-action');assert.equal(h.added,1);assert.equal(h.commits,0);assert.equal(h.work.length,0);
});

test('a rejected acceptance keeps evidence and reservations intact without reporting success', t => {
  const h = mount(t, fixture(), { reject: true }), before = structuredClone(h.state);
  h.click('propose');
  h.click('accept');
  assert.equal(h.commits, 1);
  assert.deepEqual(h.state, before);
  assert.ok(!h.notices.some(message => /Sessions reserved/.test(message)), 'success needs a successful commit');
});

test('unscheduling retains a block referenced by actual stopped work and Undo restores only the reservation', t => {
  const state = fixture();
  state.workbench.blocks = [allocation(state)];
  state.workbench.sessions = [recorded(state)];
  const h = mount(t, validateState(state)), history = structuredClone(state.workbench.sessions);
  h.click('unschedule', { id: 'accepted-first' });
  assert.equal(h.commits, 1);
  assert.equal(h.state.workbench.blocks[0].status, 'skipped');
  assert.deepEqual(h.state.workbench.sessions, history);
  assert.deepEqual(h.state.workbench.backlogIds, [state.actions[0].id]);
  h.click('undo');
  assert.equal(h.state.workbench.blocks[0].status, 'planned');
  assert.deepEqual(h.state.workbench.sessions, history);
  assert.deepEqual(h.state.workbench.backlogIds, []);
  assert.equal(h.errors.length, 0);
});

for (const change of ['new allocation', 'active focus', 'actual history']) {
  test(`an unschedule Undo refuses to overwrite later ${change}`, t => {
    const state = fixture();
    state.workbench.blocks = [allocation(state)];
    const h = mount(t, validateState(state));
    h.click('unschedule', { id: 'accepted-first' });
    const later = structuredClone(h.state);
    if (change === 'new allocation') {
      later.workbench.blocks.push(allocation(later, { id: 'new-allocation', startMinute: 1200 }));
    } else if (change === 'active focus') {
      later.session = { actionId: later.actions[0].id, running: false,
        startedAt: null, elapsedMs: 1000, goalMinutes: 30, blockId: null,
        sessionStartedAt: '2026-10-13T11:00:00.000Z' };
    } else {
      later.workbench.sessions.push(recorded(later, { blockId: null }));
    }
    h.replace(later);
    const before = structuredClone(h.state), commits = h.commits;
    h.click('undo');
    assert.deepEqual(h.state, before);
    assert.equal(h.commits, commits, 'a stale Undo must be rejected before attempting persistence');
  });
}

test('accepting a changed-window proposal preserves a stopped session’s original block identity', t => {
  const state = fixture();
  state.workbench.blocks = [allocation(state)];
  state.workbench.sessions = [recorded(state)];
  state.workbench.calendar.defaultWindows = [{ startMinute: 1200, endMinute: 1320 }];
  const h = mount(t, validateState(state)), history = structuredClone(state.workbench.sessions);
  h.click('propose');
  h.click('accept');
  assert.equal(h.commits, 1);
  assert.equal(h.errors.length, 0, 'the proposal cannot make the recorded block link invalid');
  assert.deepEqual(h.state.workbench.sessions, history);
  assert.ok(h.state.workbench.blocks.some(block => block.id === 'accepted-first'));
  assert.ok(h.state.workbench.blocks.some(block => block.status === 'planned' && block.startMinute >= 1200));
});

test('work controls require actual completed prerequisites rather than a proposed predecessor', t => {
  const state = fixture(), parent = state.actions[0], child = state.actions[1];
  state.workbench.blocks = [allocation(state), allocation(state, {
    id: 'dependent-session', actionId: child.id, startMinute: 1175, minutes: child.minutes,
  })];
  const h = mount(t, validateState(state));
  h.click('inspect-block', { id: 'dependent-session' });
  const childControl = new RegExp(`<button[^>]*data-agenda="work"[^>]*data-id="${child.id}"[^>]*disabled`);
  assert.match(h.host.innerHTML, childControl, 'Week must show that a reserved child is not ready yet');
  assert.match(h.host.innerHTML, /Before starting, finish/);
  assert.ok(buttonWith(h.host.innerHTML, 'data-agenda="inspect-action"', `data-id="${parent.id}"`),
    'the prerequisite behind a disabled start must be reachable by name');
  assert.match(h.desk.innerHTML, childControl, 'Desk must show the same readiness');
  h.click('work', { id: child.id, block: 'dependent-session', disabled: true });
  h.click('work', { id: child.id, block: 'dependent-session', desk: true });
  assert.equal(h.work.length, 0, 'delegated handlers also enforce readiness');
  h.click('work', { id: parent.id, block: 'accepted-first' });
  assert.deepEqual(h.work, [[parent.id, 'accepted-first']]);
  assert.equal(h.commits, 0);
});

test('Desk offers a ready unreserved prerequisite beside a dependency-locked accepted session', t => {
  const state = fixture(), parent = state.actions[0], child = state.actions[1];
  state.workbench.blocks = [allocation(state, {
    id: 'dependent-only', actionId: child.id, minutes: child.minutes,
  })];
  const h = mount(t, validateState(state));
  assert.match(h.desk.innerHTML, new RegExp(`<button[^>]*data-agenda="work"[^>]*data-id="${child.id}"[^>]*disabled`));
  const parentControl = new RegExp(`<button[^>]*data-agenda="work"[^>]*data-id="${parent.id}"[^>]*>`).exec(h.desk.innerHTML)?.[0];
  assert.ok(parentControl, 'unfinished ready work must remain reachable even when today contains accepted sessions');
  assert.ok(!parentControl.includes('disabled'));
  h.click('work', { id: child.id, block: 'dependent-only', disabled: true, desk: true });
  h.click('work', { id: parent.id, desk: true });
  assert.deepEqual(h.work, [[parent.id, null]]);
  assert.equal(h.commits, 0, 'opening work is delegated without changing its reservation or history');
});

test('changing accepted conditions invalidates a preview and disposed agenda handlers cannot navigate or save', t => {
  const h = mount(t, fixture());
  h.click('propose');
  const later = structuredClone(h.state);
  later.actions[0].remainingMinutes = 20;
  h.replace(later);
  h.click('accept');
  assert.equal(h.commits, 0);
  assert.equal(h.state.workbench.blocks.length, 0);
  assert.match(h.host.innerHTML, /fresh proposal|current proposal/);
  h.view.destroy();
  assert.equal(h.host.events.size, 0);
  assert.equal(h.desk.events.size, 0);
  h.click('new-action'); h.click('review', { desk: true });
  assert.equal(h.added, 0);
  assert.equal(h.reviews.length, 0);
});

test('selecting a calendar band focuses its inline day inspector without saving or opening work', t => {
  const h = mount(t, fixture()), date = addDays(h.state.workbench.calendar.startDate, 1);
  const calls = [], target = {
    scrollIntoView(options) { calls.push(['scroll', options]); },
    focus(options) { calls.push(['focus', options]); },
  };
  h.host.targets.set('#agenda-selected-day', target);
  const before = structuredClone(h.state);
  assert.deepEqual(h.click('focus-day', { date }), { prevented: true, stopped: true });
  assert.ok(h.host.queries.includes('#agenda-selected-day'));
  assert.ok(!h.host.queries.some(selector => selector.startsWith('.agenda-day')),
    'selection must not jump to a detached dated agenda below the overview');
  assert.ok(calls.some(([method]) => method === 'focus'));
  assert.match(h.host.innerHTML, /id="agenda-selected-day"/);
  assert.match(buttonWith(h.host.innerHTML, 'data-agenda="focus-day"', `data-date="${date}"`), /aria-pressed="true"/);
  assert.equal(h.commits, 0);
  assert.deepEqual(h.state, before);
  assert.equal(h.work.length, 0);
  assert.equal(h.reviews.length, 0);
});

test('a calendar band whose detailed day is absent makes no save and does not alter evidence', t => {
  const h = mount(t, fixture()), before = structuredClone(h.state);
  h.click('focus-day', { date: addDays(before.workbench.calendar.startDate, 10) });
  assert.equal(h.commits, 0);
  assert.deepEqual(h.state, before);
  assert.equal(h.errors.length, 0);
});

test('accepted and proposed overview toggles are local previews until an explicit acceptance', t => {
  const state = fixture();
  state.workbench.blocks = [allocation(state)];
  const h = mount(t, validateState(state)), before = structuredClone(h.state);
  const overview = () => h.host.innerHTML.match(/<section class="calendar-map(?: [^"]*)?"[\s\S]*?<\/section>/)?.[0];
  const acceptedMinutes = before.workbench.blocks[0].minutes;
  const proposedMinutes = before.actions.reduce((sum, action) => sum + (action.remainingMinutes ?? action.minutes), 0);
  const acceptedClock = overview().match(/<svg width="100%" height="18"[\s\S]*?<\/svg>/)?.[0];
  assert.match(overview(), new RegExp(`<dt>Planned<\\/dt><dd>${acceptedMinutes}<small>min<\\/small>`));
  h.click('propose');
  assert.match(h.host.innerHTML, /Proposed times · not yet reserved/);
  assert.match(overview(), new RegExp(`<dt>Proposed<\\/dt><dd>${proposedMinutes}<small>min<\\/small>`));
  assert.match(buttonWith(overview(), 'data-agenda="show-proposed"'), /aria-pressed="true"/);
  for(const action of ['calendar','exception','commitment','edit-action'])assert.match(buttonWith(h.host.innerHTML,`data-agenda="${action}"`),/disabled/,'proposal inspection must keep editing explicit');
  const inspector=h.host.innerHTML.slice(h.host.innerHTML.indexOf('<section id="agenda-selected-day"'),h.host.innerHTML.indexOf('<details class="agenda-work-list'));
  assert.doesNotMatch(inspector,/min reserved/,'proposed effort cannot be presented as a reservation');
  assert.equal(overview().match(/<svg width="100%" height="18"[\s\S]*?<\/svg>/)?.[0], acceptedClock,
    'a proposal and accepted times must remain comparable on one clock scale');
  h.click('work', { id: before.actions[0].id, block: 'accepted-first' });
  h.click('place', { id: before.actions[0].id });
  assert.doesNotMatch(h.host.innerHTML, /data-agenda-form="place"/,
    'a proposed session is not an accepted work or placement context');
  h.click('show-accepted');
  assert.match(overview(), new RegExp(`<dt>Planned<\\/dt><dd>${acceptedMinutes}<small>min<\\/small>`));
  assert.match(buttonWith(overview(), 'data-agenda="show-accepted"'), /aria-pressed="true"/);
  h.click('show-proposed');
  assert.match(overview(), new RegExp(`<dt>Proposed<\\/dt><dd>${proposedMinutes}<small>min<\\/small>`));
  assert.equal(h.commits, 0);
  assert.deepEqual(h.state, before);
  assert.equal(h.work.length, 0);
  h.click('accept');
  assert.equal(h.commits, 1);
  assert.equal(h.errors.length, 0);
  const reservedMinutes = h.state.workbench.blocks.filter(block => block.status === 'planned').reduce((sum, block) => sum + block.minutes, 0);
  assert.match(overview(), new RegExp(`<dt>Planned<\\/dt><dd>${reservedMinutes}<small>min<\\/small>`));
  assert.doesNotMatch(overview(), /[Pp]roposed/);
});

test('a selected free interval seeds the real placement form without reserving or starting work', t => {
  const state = fixture(), date = addDays(state.workbench.calendar.startDate, 1), action = state.actions[0];
  state.workbench.calendar.overrides = [{ date, windows: [{ startMinute: 1170, endMinute: 1230 }] }];
  state.workbench.calendar.commitments = [{ id: 'late-class', title: 'A class runs late', date, startMinute: 1160, endMinute: 1180 }];
  const h = mount(t, validateState(state)), before = structuredClone(h.state);
  h.click('select-slot', { date, start: '1180', end: '1230' });
  h.click('place', { id: action.id, date, start: '1180', end: '1230' });
  assert.match(inputWith(h.host.innerHTML, 'date'), new RegExp(`value="${date}"`));
  assert.match(inputWith(h.host.innerHTML, 'start'), /value="19:40"/);
  assert.match(inputWith(h.host.innerHTML, 'minutes'), /value="30"/);
  assert.equal(h.commits, 0);
  assert.deepEqual(h.state, before);
  assert.equal(h.work.length, 0);
});

test('placing from the inbox uses the selected day’s first valid free interval', t => {
  const state = fixture(), date = addDays(state.workbench.calendar.startDate, 1), action = state.actions[0];
  state.workbench.calendar.overrides = [{ date, windows: [{ startMinute: 1200, endMinute: 1260 }] }];
  const h = mount(t, validateState(state)), before = structuredClone(h.state);
  h.click('focus-day', { date });
  h.click('place', { id: action.id });
  assert.match(inputWith(h.host.innerHTML, 'date'), new RegExp(`value="${date}"`));
  assert.match(inputWith(h.host.innerHTML, 'start'), /value="20:00"/);
  assert.equal(h.commits, 0);
  assert.deepEqual(h.state, before);
  assert.equal(h.work.length, 0);
});

test('a free day offers no extra placement for work already fully reserved on another date', t => {
  const state = fixture(), action = state.actions[0], date = addDays(state.workbench.calendar.startDate, 1);
  state.workbench.blocks = [allocation(state)];
  const h = mount(t, validateState(state)), before = structuredClone(h.state);
  h.click('focus-day', { date });
  const placementButtons = (h.host.innerHTML.match(/<button\b[^>]*>/g) || [])
    .filter(tag => tag.includes('data-agenda="place"') && tag.includes(`data-id="${action.id}"`));
  assert.ok(placementButtons.every(tag => tag.includes('disabled')),
    'an empty calendar gap cannot make the same estimated work available twice');
  assert.equal(h.commits, 0);
  assert.deepEqual(h.state, before);
  assert.equal(h.work.length, 0);
});

test('moving the shared week keeps outlying reservations visible and movable without freeing their estimated effort', t => {
  const state=fixture(),action=state.actions[0],date=addDays(todayISO(),1);
  state.workbench.blocks=[allocation(state)];state.workbench.calendar.startDate=date;
  const h=mount(t,validateState(state));
  assert.match(h.host.innerHTML,/Reservations outside this week · 1/);
  assert.match(h.host.innerHTML,/0 min unreserved · 30 min reserved/);
  h.click('move',{id:'accepted-first'});
  h.submit('place',{date,start:'19:00',minutes:'30',pinned:true});
  assert.equal(h.commits,1);assert.equal(h.errors.length,0);
  assert.equal(h.state.workbench.blocks[0].id,'accepted-first');
  assert.equal(h.state.workbench.blocks[0].date,date);
  assert.doesNotMatch(h.host.innerHTML,/Reservations outside this week/);
});

test('a partial reservation elsewhere reduces the amount offered and the saved placement', t => {
  const state = fixture(), action = state.actions[0], date = addDays(state.workbench.calendar.startDate, 1);
  action.minutes = 60;
  state.workbench.blocks = [allocation(state, { minutes: 30 })];
  const h = mount(t, validateState(state));
  h.click('focus-day', { date });
  h.click('place', { id: action.id });
  assert.match(inputWith(h.host.innerHTML, 'minutes'), /value="30"/);
  h.submit('place', { date, start: '19:00', minutes: '30', pinned: true });
  assert.equal(h.commits, 1);
  assert.equal(h.errors.length, 0);
  const own = h.state.workbench.blocks.filter(block => block.actionId === action.id && block.status === 'planned');
  assert.equal(own.length, 2);
  assert.equal(own.reduce((sum, block) => sum + block.minutes, 0), 60);
  assert.ok(own.some(block => block.id === 'accepted-first'), 'an added placement keeps the earlier reservation');
  assert.equal(h.state.workbench.sessions.length, 0);
  assert.equal(h.state.session, null);
  assert.equal(h.work.length, 0);
});

test('inspecting an accepted reservation does not start work; the separate start action does', t => {
  const state = fixture(), action = state.actions[0];
  state.workbench.blocks = [allocation(state)];
  const h = mount(t, validateState(state)), before = structuredClone(h.state);
  h.click('inspect-block', { id: 'accepted-first' });
  assert.equal(h.commits, 0);
  assert.equal(h.work.length, 0);
  assert.deepEqual(h.state, before);
  assert.match(h.host.innerHTML, /Start session/);
  h.click('work', { id: action.id, block: 'accepted-first' });
  assert.deepEqual(h.work, [[action.id, 'accepted-first']]);
  assert.equal(h.commits, 0, 'the actual-work transition stays with the existing callback');
});

test('a failed calendar edit keeps its typed draft when the selected day changes', t => {
  const h = mount(t, fixture()), before = structuredClone(h.state), date = addDays(before.workbench.calendar.startDate, 1);
  h.click('calendar');
  h.submit('calendar', { date: before.workbench.calendar.startDate, start: '21:30', end: '20:00', rest: '10', minimum: '20' });
  assert.equal(h.commits, 0, 'an invalid interval is refused before persistence');
  assert.deepEqual(h.state, before);
  h.click('focus-day', { date });
  assert.match(inputWith(h.host.innerHTML, 'start'), /value="21:30"/);
  assert.match(inputWith(h.host.innerHTML, 'end'), /value="20:00"/);
  assert.match(inputWith(h.host.innerHTML, 'rest'), /value="10"/);
  assert.match(inputWith(h.host.innerHTML, 'minimum'), /value="20"/);
  assert.equal(h.commits, 0);
  assert.deepEqual(h.state, before);
  assert.equal(h.work.length, 0);
});

test('a calendar save rejected by persistence retains the draft without reporting a saved window', t => {
  const h = mount(t, fixture(), { reject: true }), before = structuredClone(h.state);
  const date = addDays(before.workbench.calendar.startDate, 1);
  h.click('calendar');
  h.submit('calendar', { date: before.workbench.calendar.startDate, start: '20:15', end: '21:45', rest: '10', minimum: '20' });
  assert.equal(h.commits, 1);
  assert.deepEqual(h.state, before);
  assert.ok(!h.notices.some(notice => /saved|window updated/i.test(notice)));
  h.click('focus-day', { date });
  assert.match(inputWith(h.host.innerHTML, 'start'), /value="20:15"/);
  assert.match(inputWith(h.host.innerHTML, 'end'), /value="21:45"/);
  assert.match(inputWith(h.host.innerHTML, 'rest'), /value="10"/);
  assert.match(inputWith(h.host.innerHTML, 'minimum'), /value="20"/);
  assert.deepEqual(h.state, before);
  assert.equal(h.work.length, 0);
});
