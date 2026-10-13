import { uid, todayISO, addDays, dueIdeas } from './domain.js';
import { renderCalendarOverview, calendarOverviewData } from './calendar-overview.js';
import { dayPlacementOptions, actionPlanningContext } from './planning-inspector.js';
import { createWorkspaceCalendar, validateWorkspaceCalendar, planWorkspace, readyActions, remainingMinutes, validateBlockPlacement } from './workspace-planner.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock = value => `${String(Math.floor(value / 60)).padStart(2,'0')}:${String(value % 60).padStart(2,'0')}`;
const minute = value => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw Error('Choose a valid time.'); const [h,m] = value.split(':').map(Number); return h*60+m; };
const label = date => new Date(`${date}T12:00:00+08:00`).toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric',timeZone:'Asia/Shanghai'});
const signature = state => JSON.stringify([state.actions,state.workbench.calendar,state.workbench.blocks,state.workbench.backlogIds]);
const undoSignature = state => JSON.stringify([state.actions,state.workbench,state.session]);

export function mountAgenda(host, deskHost, { getState, commitState, notify, onWorkAction, onReview, onEditAction, onNewAction, onReadSource = () => {} }) {
  let proposal = null, proposalSignature = '', undo = null, editor = null, message = '', disposed = false;
  let selectedDate = null, selectedBlockId = null, inspectedActionId = null, selectedSlot = null, preview = false;
  let inspectFirst = true;
  const projectName = (state, action) => state.projects.find(p=>p.id===action.projectId)?.title || 'Project';
  const project = state => state.projects.find(p=>p.id===state.activeProjectId);
  const blockHasHistory = (state,id) => state.workbench.sessions.some(s=>s.blockId===id) || state.session?.blockId===id;
  function mutate(change, { remember = false } = {}) {
    const state=getState(), next=structuredClone(state);
    const before={blocks:structuredClone(state.workbench.blocks),backlogIds:[...state.workbench.backlogIds]};
    change(next);
    if (!commitState(next)) { message = 'This change could not be saved. Your previous calendar and work are intact.'; render(); return false; }
    if (remember) undo={before,signature:undoSignature(getState())};
    else undo=null;
    proposal=null; preview=false; editor=null; message=''; render(); return true;
  }
  function error(err) { message=err.message || 'This change could not be saved.'; render(); }
  function dayCapacity(calendar,date) {
    const windows=calendar.overrides.find(d=>d.date===date)?.windows ?? calendar.defaultWindows;
    return windows.reduce((sum,w)=>sum+w.endMinute-w.startMinute-calendar.commitments.filter(c=>c.date===date).reduce((busy,c)=>busy+Math.max(0,Math.min(w.endMinute,c.endMinute)-Math.max(w.startMinute,c.startMinute)),0),0);
  }
  function outsideWeek(state) {
    const calendar=state.workbench.calendar,last=addDays(calendar.startDate,6);
    const blocks=state.workbench.blocks.filter(block=>block.status==='planned'&&(block.date<calendar.startDate||block.date>last));
    return blocks.length?`<details class="agenda-recorded"><summary>Reservations outside this week · ${blocks.length}</summary><p class="helper-copy">These times remain reserved until you move or unschedule them.</p>${blocks.map(block=>`<section class="agenda-day"><h3>${label(block.date)}</h3>${blockRow(state,block)}</section>`).join('')}</details>`:'';
  }
  function actionRow(state,action) {
    const excluded=state.workbench.backlogIds.includes(action.id), planned=state.workbench.blocks.some(b=>b.actionId===action.id&&b.status==='planned');
    const context=actionPlanningContext(state,action.id);
    return `<article class="agenda-action"><div><span class="small-label">${esc(projectName(state,action))}</span><button class="agenda-action-title" data-agenda="inspect-action" data-id="${esc(action.id)}">${esc(action.title)}</button><p>${context.unreservedMinutes} min unreserved · ${context.reservedMinutes} min reserved · ${context.remainingMinutes} min remaining${action.deadline?` · by ${esc(action.deadline)}`:''}${action.status==='blocked'?' · blocked':''}${action.reviewMinutes?' · source review':''}</p></div><div class="agenda-inline-actions"><button class="text-button" data-agenda="${context.unreservedMinutes?'place':'show-action'}" data-id="${esc(action.id)}" ${preview?'disabled':''}>${context.unreservedMinutes?'Place in selected day':'View sessions'}</button><button class="text-button" data-agenda="${excluded?'include':'backlog'}" data-id="${esc(action.id)}" ${preview?'disabled':''}>${excluded?'Include in proposal':planned?'Return to inbox':'Keep in inbox'}</button></div></article>`;
  }
  function blockRow(state,block,preview=false) {
    const action=state.actions.find(a=>a.id===block.actionId); if(!action)return '';
    let conflict=''; if(!preview&&block.status==='planned')try{validateBlockPlacement(block,state.actions,state.workbench.calendar,state.workbench.blocks);}catch(e){conflict=e.message;}
    const available=!conflict&&readyActions(state.actions).some(a=>a.id===action.id);
    return `<article class="agenda-block ${block.status!=='planned'?'agenda-history':''}"><span class="agenda-time">${clock(block.startMinute)}<small>${clock(block.startMinute+block.minutes)}</small></span><div><span class="small-label">${esc(projectName(state,action))}${block.pinned?' · pinned':''}${block.status!=='planned'?` · ${block.status==='done'?'session closed':'unreserved'}`:''}</span><strong>${esc(action.title)}</strong><small>${block.minutes} min${preview?' · proposed':''}</small>${conflict?`<p class="form-error">${esc(conflict)}</p>`:''}</div>${!preview&&block.status==='planned'?`<div class="agenda-inline-actions"><button class="secondary" data-agenda="work" data-id="${esc(action.id)}" data-block="${esc(block.id)}" ${available?'':'disabled'}>Start session</button><button class="text-button" data-agenda="move" data-id="${esc(block.id)}">Move</button><button class="text-button" data-agenda="unschedule" data-id="${esc(block.id)}">Unschedule</button></div>`:''}</article>`;
  }
  function forms(state) {
    const calendar=state.workbench.calendar;
    if(!editor)return '';
    const values=editor.values||{};
    const field=(name,fallback)=>esc(Object.hasOwn(values,name)?values[name]:fallback);
    const checked=(name,fallback=false)=>Object.hasOwn(values,name)?values[name]===true:fallback;
    if(editor.kind==='place') {
      const block=editor.block,action=state.actions.find(a=>a.id===editor.actionId);
      if(!action)return '';
      return `<form class="agenda-editor paper-surface" data-agenda-form="place"><h3>${block?'Move a session':'Place a session'}</h3><p>${esc(action.title)} · deadline ${esc(action.deadline||'not set')}</p><div class="agenda-form-grid"><label>Date<input name="date" type="date" required value="${field('date',block?.date||selectedDate)}"></label><label>Start<input name="start" type="time" required value="${field('start',clock(block?.startMinute??calendar.defaultWindows[0]?.startMinute??1140))}"></label><label>Minutes<input name="minutes" type="number" min="1" max="720" required value="${field('minutes',block?.minutes??Math.min(remainingMinutes(action),45))}"></label></div><label class="agenda-check"><input name="pinned" type="checkbox" ${checked('pinned',block?.pinned!==false)?'checked':''}>Keep this time when replanning</label><p class="helper-copy">This reserves a session, not the whole task. Placement checks rest, commitments, prerequisites and deadlines.</p><div class="agenda-inline-actions"><button class="primary">Save placement</button><button type="button" class="text-button" data-agenda="cancel">Cancel</button></div></form>`;
    }
    if(editor.kind==='calendar')return `<form class="agenda-editor paper-surface" data-agenda-form="calendar"><h3>Your shared window</h3><div class="agenda-form-grid"><label>Week beginning<input name="date" type="date" required value="${field('date',calendar.startDate)}"></label><label>Available from<input name="start" type="time" required value="${field('start',clock(calendar.defaultWindows[0]?.startMinute??1140))}"></label><label>Until<input name="end" type="time" required value="${field('end',clock(calendar.defaultWindows[0]?.endMinute??1230))}"></label><label>Rest between sessions<input name="rest" type="number" min="0" max="120" required value="${field('rest',calendar.restMinutes)}"></label><label>Useful block minimum<input name="minimum" type="number" min="1" max="120" required value="${field('minimum',calendar.minBlockMinutes)}"></label></div><p class="helper-copy">Times use Asia/Shanghai. Date exceptions and commitments remain. Existing accepted sessions are retained and report conflicts if the window changes.</p><div class="agenda-inline-actions"><button class="primary">Save window</button><button type="button" class="text-button" data-agenda="cancel">Cancel</button></div></form>`;
    if(editor.kind==='exception')return `<form class="agenda-editor paper-surface" data-agenda-form="exception"><h3>Availability for one day</h3><div class="agenda-form-grid"><label>Date<input name="date" type="date" required value="${field('date',selectedDate)}"></label><label>From<input name="start" type="time" value="${field('start','19:00')}"></label><label>Until<input name="end" type="time" value="${field('end','20:30')}"></label></div><label class="agenda-check"><input name="closed" type="checkbox" ${checked('closed')?'checked':''}>No work time on this date</label><div class="agenda-inline-actions"><button class="primary">Save date exception</button><button type="button" class="text-button" data-agenda="cancel">Cancel</button></div></form>`;
    return `<form class="agenda-editor paper-surface" data-agenda-form="commitment"><h3>A fixed commitment</h3><label>What is already booked?<input name="title" required maxlength="300" value="${field('title','')}" placeholder="Class, meeting or time away"></label><div class="agenda-form-grid"><label>Date<input name="date" type="date" required value="${field('date',selectedDate)}"></label><label>From<input name="start" type="time" required value="${field('start','19:00')}"></label><label>Until<input name="end" type="time" required value="${field('end','19:30')}"></label></div><div class="agenda-inline-actions"><button class="primary">Keep commitment</button><button type="button" class="text-button" data-agenda="cancel">Cancel</button></div></form>`;
  }
  function captureEditor() {
    const form=host.querySelector('[data-agenda-form]');
    if(!editor?.rendered || !form || form.dataset?.agendaForm!==editor.kind)return;
    editor.values=Object.fromEntries(new FormData(form));
    for(const input of form.querySelectorAll('input[type="checkbox"]'))editor.values[input.name]=input.checked;
  }
  function focusInspector() {
    const target=host.querySelector('#agenda-selected-day');
    target?.focus({preventScroll:true});
    target?.scrollIntoView({block:'nearest'});
  }
  function focusEditor() {
    const form=host.querySelector('[data-agenda-form]');
    form?.querySelector?.('input')?.focus({preventScroll:true});
    form?.scrollIntoView?.({block:'nearest'});
  }
  function displayedBlocks(state) { return preview&&proposal ? proposal.blocks : state.workbench.blocks; }
  function sourceContext(state,action) {
    const idea=state.ideas.find(item=>item.id===action.ideaId)||state.ideas.find(item=>action.reviewIdeaIds?.includes(item.id));
    const source=state.sources.find(item=>item.id===idea?.sourceId), paragraph=source?.paragraphs.find(item=>item.id===idea?.paragraphId);
    const study=state.studio?.studies.find(item=>item.id===action.studyId);
    const reading=source&&paragraph?`<button class="text-button" data-agenda="read-source" data-id="${esc(action.id)}">${esc(source.title)} · §${source.paragraphs.indexOf(paragraph)+1} →</button><blockquote>${esc(paragraph.text.slice(0,260))}${paragraph.text.length>260?'…':''}</blockquote>`:study?`<p>Lighting study · ${esc(study.title)}</p>`:'<p>No source passage is attached to this action.</p>';
    return `<details class="agenda-context"><summary>Draft & source</summary>${action.draft?`<p>${esc(action.draft)}</p>`:'<p>No draft yet. Name the output you want to leave.</p>'}${reading}<button class="text-button" data-agenda="edit-action" data-id="${esc(action.id)}" ${preview?'disabled':' '}>Edit action</button></details>`;
  }
  function inspector(state,day,blocks) {
    const reservations=blocks.filter(block=>block.date===day.date&&block.status==='planned').sort((a,b)=>a.startMinute-b.startMinute);
    const chosen=reservations.find(block=>block.id===selectedBlockId);
    const action=state.actions.find(item=>item.id===(inspectedActionId||chosen?.actionId));
    const context=action?actionPlanningContext(state,action.id,{blocks}):null;
    let conflict='';
    if(chosen)try{validateBlockPlacement(chosen,state.actions,state.workbench.calendar,blocks);}catch(error){conflict=error.message;}
    const prerequisite=context?.prerequisites.length?`<p class="agenda-inspector-reason">Before starting, finish ${context.prerequisites.map(item=>state.actions.some(a=>a.id===item.id)?`<button class="text-button" data-agenda="inspect-action" data-id="${esc(item.id)}">${esc(item.title)}</button>`:esc(item.title)).join(', ')}.</p>`:action?.status==='blocked'?'<p class="agenda-inspector-reason">This action is marked blocked. Edit it when the obstacle is resolved.</p>':'';
    const detail=action?`<div class="agenda-inspector-body">${!chosen?`<h3>${esc(action.title)}</h3>`:''}<p>${context.remainingMinutes} min remaining · ${context.reservedMinutes} min ${preview?'proposed':'reserved'}${action.deadline?` · by ${esc(action.deadline)}`:''}</p>${prerequisite}${conflict?`<p class="agenda-inspector-reason" role="status">${esc(conflict)}</p>`:''}${sourceContext(state,action)}<div class="agenda-inspector-actions">${preview?'<span class="small-label">Preview only · accept before starting work</span>':`<button class="primary" data-agenda="work" data-id="${esc(action.id)}" ${chosen?`data-block="${esc(chosen.id)}"`:''} ${context.readyToStart&&!conflict?'':'disabled'}>Start session</button>${chosen?`<button class="text-button" data-agenda="move" data-id="${esc(chosen.id)}">Move</button><button class="text-button" data-agenda="unschedule" data-id="${esc(chosen.id)}">Unschedule</button>`:''}`}</div></div>`:'';
    const slots=day.open.map(slot=>{const minutes=slot.endMinute-slot.startMinute,active=selectedSlot?.startMinute===slot.startMinute&&selectedSlot?.endMinute===slot.endMinute;return `<button type="button" class="agenda-free-slot" data-agenda="select-slot" data-date="${day.date}" data-start="${slot.startMinute}" data-end="${slot.endMinute}" aria-pressed="${active}" ${preview?'disabled':''}><span><strong>${clock(slot.startMinute)}–${clock(slot.endMinute)}</strong><small>${minutes<state.workbench.calendar.minBlockMinutes?'Fits only an entire shorter action':'After protected rest'}</small></span><span>${minutes} min</span></button>`;}).join('');
    const options=preview?[]:dayPlacementOptions(state,day.date,selectedSlot||{}),unfinished=options.filter(option=>option.remainingMinutes>0),pending=unfinished.filter(option=>option.unreservedMinutes>0),unreserved=[...pending.filter(option=>option.placement),...pending.filter(option=>!option.placement)];
    const choices=unreserved.slice(0,5).map(option=>{const item=state.actions.find(a=>a.id===option.actionId),p=option.placement;return `<article class="agenda-placement-choice"><span class="small-label">${esc(projectName(state,item))}</span><strong>${esc(item.title)}</strong><p>${option.unreservedMinutes} min unreserved${p?` · ${p.minutes} min session`:''}</p>${p?`<button class="secondary" data-agenda="place" data-id="${esc(item.id)}" data-date="${p.date}" data-start="${selectedSlot?.startMinute??p.startMinute}" data-end="${selectedSlot?.endMinute??p.startMinute+p.minutes}">Place ${p.minutes} min at ${clock(p.startMinute)}</button>`:`<p class="agenda-inspector-reason">${esc(option.reason)}</p>`}${option.prerequisites.length?`<small>Start after ${option.prerequisites.map(dep=>esc(dep.title)).join(', ')} is finished.</small>`:''}</article>`;}).join('');
    const work=preview?'<p class="agenda-inspector-empty">Compare the proposed sessions here. These times stay unreserved until you accept.</p>':unreserved.length?`${choices}${unreserved.length>5?`<button class="text-button" data-agenda="show-work">See all ${unreserved.length} unreserved actions →</button>`:''}`:unfinished.length?'<p class="agenda-inspector-empty">The remaining work is already fully reserved. Select a session to move it, or add another action.</p>':'<p class="agenda-inspector-empty">Name a concrete output to plan a useful session.</p>';
    return `<section id="agenda-selected-day" class="agenda-inspector paper-surface" tabindex="-1" aria-labelledby="agenda-selected-title"><header class="agenda-pane-heading"><p class="eyebrow">${preview?'Proposed · not reserved':'Selected day · accepted times'}</p><h2 id="agenda-selected-title">${label(day.date)}</h2><p>${day.plannedMinutes} min ${preview?'proposed':'reserved'} · ${day.openMinutes} min open after rest</p></header>${day.commitments.map(item=>`<div class="agenda-commitment"><span>${clock(item.startMinute)}–${clock(item.endMinute)}</span><strong>${esc(item.title)}</strong>${!preview?`<button class="text-button" data-agenda="remove-commitment" data-id="${esc(item.id)}" aria-label="Remove commitment ${esc(item.title)}">Remove</button>`:''}</div>`).join('')}<div class="agenda-reservations">${reservations.length?reservations.map(block=>{const item=state.actions.find(a=>a.id===block.actionId);return `<article class="agenda-inspector-block${selectedBlockId===block.id?' is-selected':''}"><button type="button" data-agenda="inspect-block" data-id="${esc(block.id)}" aria-pressed="${selectedBlockId===block.id}"><span class="agenda-inspector-time">${clock(block.startMinute)}<small>${clock(block.startMinute+block.minutes)}</small></span><span><small>${esc(projectName(state,item))}${block.pinned?' · pinned':''}</small><strong>${esc(item?.title)}</strong><small>${block.minutes} min ${preview?'proposed':'reserved'}</small></span></button></article>`;}).join(''):`<p class="agenda-inspector-empty">${day.windows.length?'No sessions reserved on this day.':'No work window on this day.'}</p>`}</div>${detail}${!preview&&editor?.kind==='place'?`${message?`<p class="form-error" role="alert">${esc(message)}</p>`:''}${forms(state)}`:''}<section class="agenda-free-slots"><h3>Room for work</h3>${slots||`<p class="agenda-inspector-empty">${day.windows.length?'No free interval remains after commitments and rest.':'This date is kept clear of work.'}</p>`}</section><section class="agenda-slot-work"><h3>${preview?'Review before reserving':selectedSlot?`Work for ${clock(selectedSlot.startMinute)}–${clock(selectedSlot.endMinute)}`:'Work for this day'}</h3>${!preview&&unreserved.length?'<p>Choose one action. Each is an alternative session, not another automatic plan.</p>':''}${work}${!preview?'<button class="text-button" data-agenda="new-action">+ Add an action</button>':''}</section></section>`;
  }
  function renderDesk(state) {
    const today=todayISO(),blocks=state.workbench.blocks.filter(b=>b.date===today&&b.status==='planned').sort((a,b)=>a.startMinute-b.startMinute), ready=readyActions(state.actions).filter(a=>remainingMinutes(a)>0), due=dueIdeas(state.ideas,state.attempts).length, unreserved=ready.filter(a=>!blocks.some(b=>b.actionId===a.id));
    deskHost.innerHTML=`<section class="desk-agenda" aria-labelledby="desk-agenda-title"><div class="agenda-topline"><div><p class="eyebrow">One day, across your projects</p><h2 id="desk-agenda-title">${label(today)}</h2></div><button class="text-button" data-agenda="review">${state.reviewSession?'Resume source review':`Review ${due} due question${due===1?'':'s'}`}</button></div><div class="desk-agenda-lines">${blocks.length?blocks.map(b=>{const a=state.actions.find(x=>x.id===b.actionId), available=ready.some(x=>x.id===a?.id);return `<button class="desk-agenda-session" data-agenda="work" data-id="${esc(a?.id)}" data-block="${esc(b.id)}" ${available?'':'disabled'}><span>${clock(b.startMinute)} · ${b.minutes} min</span><strong>${esc(a?.title)}</strong><small>${esc(projectName(state,a))}${available?'':' · prerequisite unfinished'}</small></button>`;}).join(''):ready.slice(0,3).map(a=>`<button class="desk-agenda-session" data-agenda="work" data-id="${esc(a.id)}"><span>Ready · ${remainingMinutes(a)} min remaining</span><strong>${esc(a.title)}</strong><small>${esc(projectName(state,a))}</small></button>`).join('')||'<p>No ready work yet. Keep a source, name an output, or resolve an unfinished prerequisite.</p>'}</div>${blocks.length&&unreserved.length?`<div class="desk-ready-work"><p class="eyebrow">Other ready work</p><div class="desk-agenda-lines">${unreserved.slice(0,3).map(a=>`<button class="desk-agenda-session" data-agenda="work" data-id="${esc(a.id)}"><span>Ready · ${remainingMinutes(a)} min remaining</span><strong>${esc(a.title)}</strong><small>${esc(projectName(state,a))}</small></button>`).join('')}</div></div>`:''}</section>`;
  }
  function render() {
    if(disposed)return;
    captureEditor();
    const state=getState(); renderDesk(state); const calendar=state.workbench.calendar;
    if(!calendar){host.innerHTML=`<section class="agenda-adoption paper-surface"><p class="eyebrow">A shared calendar</p><h2>Give your projects one real window.</h2><p>Choose one availability window for all your projects. Earlier project plans stay intact.</p><button class="primary" data-agenda="adopt">Use ${esc(project(state)?.title)}’s window</button><p class="helper-copy">${esc(project(state)?.plan.startTime)} · ${project(state)?.plan.dailyMinutes} minutes a day</p></section>`;return;}
    const currentSignature=signature(state);
    if(proposal&&proposalSignature!==currentSignature){proposal=null;preview=false;message='Conditions changed. Generate a fresh proposal before accepting.';}
    const days=Array.from({length:calendar.days},(_,i)=>addDays(calendar.startDate,i));
    if(!days.includes(selectedDate)){selectedDate=days.includes(todayISO())?todayISO():days[0];selectedBlockId=null;inspectedActionId=null;selectedSlot=null;}
    const viewBlocks=displayedBlocks(state),model=calendarOverviewData({...state,workbench:{...state.workbench,blocks:viewBlocks}}),day=model.days.find(item=>item.date===selectedDate);
    const reservations=viewBlocks.filter(block=>block.date===selectedDate&&block.status==='planned').sort((a,b)=>a.startMinute-b.startMinute);
    if(inspectFirst&&!inspectedActionId&&!reservations.some(block=>block.id===selectedBlockId))selectedBlockId=reservations[0]?.id||null;
    if(!day.open.some(slot=>slot.startMinute===selectedSlot?.startMinute&&slot.endMinute===selectedSlot?.endMinute))selectedSlot=day.open[0]?{...day.open[0]}:null;
    const actions=state.actions.filter(action=>action.status!=='done'&&remainingMinutes(action)>0),conflicts=proposal?.conflicts||[],attention=[...conflicts,...(proposal?.overflow||[])];
    const totalUnreserved=actions.reduce((sum,action)=>sum+actionPlanningContext(state,action.id).unreservedMinutes,0);
    host.innerHTML=`<div class="agenda-toolbar"><div><strong>${calendar.defaultWindows.map(w=>`${clock(w.startMinute)}–${clock(w.endMinute)}`).join(', ')} · Asia/Shanghai</strong><span>${calendar.restMinutes} min rest · ${calendar.minBlockMinutes} min useful minimum</span></div><div class="agenda-inline-actions"><button class="text-button" data-agenda="calendar" ${preview?'disabled':' '}>Edit window</button><button class="text-button" data-agenda="exception" ${preview?'disabled':' '}>Date exception</button><button class="secondary" data-agenda="commitment" ${preview?'disabled':' '}>+ Commitment</button>${state.actions.length?'<button class="primary" data-agenda="propose">Propose a week</button>':'<button class="primary" data-agenda="new-action">+ Add an action</button>'}</div></div>${message&&editor?.kind!=='place'?`<p class="form-error agenda-message" role="alert">${esc(message)}</p>`:''}${undo?'<button class="text-button agenda-undo" data-agenda="undo">Undo last unscheduling</button>':''}${editor&&editor.kind!=='place'?forms(state):''}${proposal?`<section class="agenda-proposal" aria-label="Plan proposal"><div><strong>Proposed times · not yet reserved</strong><p>${proposal.totalRemainingMinutes} min of remaining work · ${proposal.overflow.length} action${proposal.overflow.length===1?'':'s'} need attention</p></div><div class="agenda-inline-actions"><button class="primary" data-agenda="accept" ${conflicts.length?'disabled':''}>Accept these sessions</button><button class="text-button" data-agenda="discard">Discard proposal</button></div></section>`:''}<div class="agenda-map-layout">${renderCalendarOverview(state,{proposal,preview,selectedDate})}${inspector(state,day,viewBlocks)}</div>${attention.length?`<section class="agenda-conflicts paper-surface" aria-label="Work that needs attention"><h3>What needs adjusting</h3>${attention.map(item=>`<p><strong>${esc(state.actions.find(action=>action.id===item.actionId)?.title||'Session')}</strong> · ${esc(item.reason)}</p>`).join('')}</section>`:''}<details class="agenda-work-list paper-surface" id="agenda-work" tabindex="-1"><summary>Work & inbox <span>${actions.length} unfinished action${actions.length===1?'':'s'} · ${totalUnreserved} min unreserved</span></summary><div class="agenda-work-list-body"><div class="surface-top"><h2>Across your projects</h2><button class="text-button" data-agenda="new-action" ${preview?'disabled':' '}>+ Add</button></div><p class="helper-copy">Place work in the selected day. Returning an action to the inbox removes its reservations and keeps it out of automatic proposals.</p>${actions.length?actions.map(action=>actionRow(state,action)).join(''):'<p>Name a concrete output to start planning.</p>'}</div></details>${state.workbench.blocks.some(block=>block.status!=='planned')?`<details class="agenda-recorded"><summary>Earlier allocations</summary>${state.workbench.blocks.filter(block=>block.status!=='planned').map(block=>blockRow(state,block)).join('')}</details>`:''}<details class="model-details"><summary>How this plan works</summary><p>One calendar covers every project. Estimates, prerequisites, deadlines, commitments and rest determine a proposal. Accepted times are reservations; they are not completed work. Elapsed focus time does not reduce your remaining estimate. Impossible work stays visible.</p></details>`;
    const outside=outsideWeek(state);if(outside)host.innerHTML+=outside;
    if(editor)editor.rendered=true;
  }
  function click(event) {
    const button=event.target.closest('[data-agenda]');if(!button)return;event.preventDefault();event.stopPropagation();
    if(button.disabled)return;
    captureEditor();
    try {
      const state=getState(),id=button.dataset.id;
      switch(button.dataset.agenda) {
        case 'adopt':mutate(next=>{next.workbench.calendar=createWorkspaceCalendar(project(next).plan);});break;
        case 'calendar':case 'exception':case 'commitment':editor={kind:button.dataset.agenda};message='';render();break;
        case 'cancel':editor=null;message='';render();break;
        case 'propose':{
          if(state.session?.blockId)throw Error('Close the current work session in Quiet before replanning its reservation.');
          proposal=planWorkspace(state.actions,state.workbench.calendar,{previousBlocks:state.workbench.blocks,backlogIds:state.workbench.backlogIds});
          for(const block of state.workbench.blocks)if(blockHasHistory(state,block.id)&&!proposal.blocks.some(b=>b.id===block.id))proposal.blocks.push({...block,status:'skipped'});
          proposalSignature=signature(state);preview=true;selectedBlockId=null;inspectedActionId=null;inspectFirst=true;selectedSlot=null;editor=null;message='';render();break;
        }
        case 'discard':proposal=null;preview=false;selectedBlockId=null;inspectedActionId=null;inspectFirst=true;render();break;
        case 'show-accepted':preview=false;selectedBlockId=null;inspectedActionId=null;inspectFirst=true;render();break;
        case 'show-proposed':if(proposal){preview=true;selectedBlockId=null;inspectedActionId=null;inspectFirst=true;render();}break;
        case 'accept':if(!proposal||proposalSignature!==signature(state)||proposal.conflicts?.length)throw Error('Resolve conflicts and generate a current proposal first.');if(state.session?.blockId)throw Error('Close the current work session in Quiet before replanning its reservation.');if(mutate(next=>{next.workbench.blocks=structuredClone(proposal.blocks);}))notify('Sessions reserved. No work has been marked complete.');break;
        case 'place':{
          if(preview)throw Error('Select Accepted before editing reservations.');
          const date=button.dataset.date||selectedDate,bounds=button.dataset.start!==undefined?{startMinute:Number(button.dataset.start),endMinute:Number(button.dataset.end)}:selectedSlot||{};
          const option=dayPlacementOptions(state,date,bounds).find(item=>item.actionId===id);
          if(!option?.placement)throw Error(option?.reason||'This action cannot be placed in the selected interval.');
          const placement=option.placement;selectedDate=placement.date;selectedBlockId=null;inspectedActionId=null;inspectFirst=false;
          editor={kind:'place',actionId:id,values:{date:placement.date,start:clock(placement.startMinute),minutes:placement.minutes,pinned:true}};
          message='';render();focusEditor();break;
        }
        case 'move':{if(preview)throw Error('Select Accepted before moving a reservation.');const block=state.workbench.blocks.find(b=>b.id===id&&b.status==='planned');if(!block)throw Error('This reservation is no longer available.');selectedDate=block.date;selectedBlockId=block.id;inspectedActionId=null;inspectFirst=true;editor={kind:'place',actionId:block.actionId,block};message='';render();focusEditor();break;}
        case 'unschedule':mutate(next=>{const block=next.workbench.blocks.find(b=>b.id===id);if(blockHasHistory(next,id))block.status='skipped';else next.workbench.blocks=next.workbench.blocks.filter(b=>b.id!==id);if(!next.workbench.backlogIds.includes(block.actionId))next.workbench.backlogIds.push(block.actionId);},{remember:true});break;
        case 'backlog':mutate(next=>{if(!next.workbench.backlogIds.includes(id))next.workbench.backlogIds.push(id);next.workbench.blocks=next.workbench.blocks.filter(b=>{if(b.actionId!==id||b.status!=='planned')return true;if(blockHasHistory(next,b.id)){b.status='skipped';return true;}return false;});},{remember:true});break;
        case 'include':mutate(next=>{next.workbench.backlogIds=next.workbench.backlogIds.filter(a=>a!==id);});break;
        case 'undo':{if(!undo)return;if(undo.signature!==undoSignature(state))throw Error('Work or calendar records changed. This undo is no longer available.');const restore=undo.before;for(const b of restore.blocks.filter(b=>b.status==='planned'))validateBlockPlacement(b,state.actions,state.workbench.calendar,restore.blocks);if(mutate(next=>{next.workbench.blocks=restore.blocks;next.workbench.backlogIds=restore.backlogIds;})){undo=null;render();}break;}
        case 'remove-commitment':mutate(next=>{next.workbench.calendar.commitments=next.workbench.calendar.commitments.filter(c=>c.id!==id);});break;
        case 'edit-action':onEditAction(id);break;
        case 'read-source':onReadSource(id);break;
        case 'new-action':onNewAction();break;
        case 'review':onReview();break;
        case 'focus-day':{
          if(!Array.from({length:state.workbench.calendar.days},(_,i)=>addDays(state.workbench.calendar.startDate,i)).includes(button.dataset.date))return;
          selectedDate=button.dataset.date;selectedBlockId=null;inspectedActionId=null;selectedSlot=null;inspectFirst=true;render();focusInspector();break;
        }
        case 'inspect-block':{const block=displayedBlocks(state).find(item=>item.id===id&&item.status==='planned');if(!block)return;selectedDate=block.date;selectedBlockId=block.id;inspectedActionId=null;inspectFirst=true;render();focusInspector();break;}
        case 'inspect-action':case 'show-action':{
          if(!state.actions.some(action=>action.id===id))return;
          const block=displayedBlocks(state).find(item=>item.actionId===id&&item.status==='planned'&&item.date>=state.workbench.calendar.startDate&&item.date<=addDays(state.workbench.calendar.startDate,6));
          if(block)selectedDate=block.date;
          selectedBlockId=block?.id||null;inspectedActionId=id;inspectFirst=false;render();focusInspector();break;
        }
        case 'select-slot':{
          if(preview)return;
          const date=button.dataset.date||selectedDate,startMinute=Number(button.dataset.start),endMinute=Number(button.dataset.end);
          const day=calendarOverviewData(state).days.find(item=>item.date===date);
          if(!day?.open.some(slot=>slot.startMinute===startMinute&&slot.endMinute===endMinute))throw Error('This free interval changed. Select its current times.');
          selectedDate=date;selectedSlot={startMinute,endMinute};selectedBlockId=null;inspectedActionId=null;inspectFirst=false;render();focusInspector();break;
        }
        case 'show-days':focusInspector();break;
        case 'show-work':{const target=host.querySelector('#agenda-work');if(target)target.open=true;target?.scrollIntoView({block:'start'});target?.focus({preventScroll:true});break;}
        case 'work':{
          if(preview&&host.contains?.(button))return;
          if(!readyActions(state.actions).some(action=>action.id===id))return;
          if(button.dataset.block){const block=state.workbench.blocks.find(item=>item.id===button.dataset.block&&item.actionId===id&&item.status==='planned');if(!block)return;validateBlockPlacement(block,state.actions,state.workbench.calendar,state.workbench.blocks);}
          onWorkAction(id,button.dataset.block||null);break;
        }
      }
    }catch(err){error(err);}
  }
  function submit(event) {
    const form=event.target.closest('[data-agenda-form]');if(!form)return;event.preventDefault();event.stopPropagation();
    const data=new FormData(form);
    if(editor){editor.values=Object.fromEntries(data);for(const name of ['pinned','closed'])editor.values[name]=data.has(name);}
    try {
      const kind=form.dataset.agendaForm;
      let savedBlock=null;
      const saved=mutate(next=>{
        const calendar=next.workbench.calendar;
        if(kind==='calendar'){calendar.startDate=String(data.get('date'));calendar.defaultWindows=[{startMinute:minute(String(data.get('start'))),endMinute:minute(String(data.get('end')))}];calendar.restMinutes=Number(data.get('rest'));calendar.minBlockMinutes=Number(data.get('minimum'));validateWorkspaceCalendar(calendar);}
        else if(kind==='exception'){const date=String(data.get('date')),windows=data.has('closed')?[]:[{startMinute:minute(String(data.get('start'))),endMinute:minute(String(data.get('end')))}];calendar.overrides=calendar.overrides.filter(d=>d.date!==date);calendar.overrides.push({date,windows});validateWorkspaceCalendar(calendar);}
        else if(kind==='commitment'){calendar.commitments.push({id:uid('commitment'),title:String(data.get('title')).trim(),date:String(data.get('date')),startMinute:minute(String(data.get('start'))),endMinute:minute(String(data.get('end')))});validateWorkspaceCalendar(calendar);}
        else{const block={id:editor.block?.id||uid('block'),actionId:editor.actionId,date:String(data.get('date')),startMinute:minute(String(data.get('start'))),minutes:Number(data.get('minutes')),pinned:data.has('pinned'),status:'planned'};validateBlockPlacement(block,next.actions,calendar,next.workbench.blocks.filter(b=>b.id!==block.id));next.workbench.blocks=next.workbench.blocks.filter(b=>b.id!==block.id);next.workbench.blocks.push(block);next.workbench.backlogIds=next.workbench.backlogIds.filter(id=>id!==block.actionId);savedBlock=block;}
      });
      if(saved&&savedBlock){selectedDate=savedBlock.date;selectedBlockId=savedBlock.id;inspectedActionId=null;selectedSlot=null;inspectFirst=true;render();focusInspector();}
    }catch(err){message=err.message;render();const retained=host.querySelector('[data-agenda-form]');if(retained)for(const input of retained.querySelectorAll('input')){if(input.type==='checkbox')input.checked=data.has(input.name);else if(data.has(input.name))input.value=String(data.get(input.name));}focusEditor();}
  }
  host.addEventListener('click',click);host.addEventListener('submit',submit);deskHost.addEventListener('click',click);
  return {render,destroy(){disposed=true;host.removeEventListener('click',click);host.removeEventListener('submit',submit);deskHost.removeEventListener('click',click);}};
}
