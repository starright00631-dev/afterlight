import {todayISO, localStudyDate} from './domain.js';
import {dueReviewQueue, currentReviewItem, startReviewSession, writeReviewAnswer, revealReview, skipReview, rateReview, undoReview, endReview} from './review-sessions.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const dateLabel = value => new Intl.DateTimeFormat('en',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${value}T00:00:00.000Z`));
const ratingLabel = {again:'Again',uncertain:'Uncertain',understood:'Understood'};
const scopeTitle = (state,id) => id === null ? 'All projects' : state.projects.find(item => item.id === id)?.title ?? 'Project';

function history(state, ideaIds) {
  const entries = state.attempts.filter(item => ideaIds.includes(item.ideaId));
  if (!entries.length) return '';
  const visible = entries.slice(-10).reverse();
  return `<div class="attempt-list review-history"><h4>Retained attempts${entries.length>10?' · latest 10':''}</h4><p class="helper-copy">${entries.length} self-assessment${entries.length===1?'':'s'} retained. A revisit date is a planning rule, not a grade.</p>${visible.map(entry => {
    const context = entry.promptSnapshot !== null && entry.promptSnapshot !== undefined;
    return `<details><summary>${esc(dateLabel(localStudyDate(entry.createdAt)))} · ${esc(ratingLabel[entry.rating] ?? entry.rating)} · revisit ${esc(dateLabel(localStudyDate(entry.dueAt)))}</summary>${context?`<p class="small-label">Question at this attempt</p><p class="review-history-prompt">${esc(entry.promptSnapshot)}</p>`:'<p class="helper-copy">Legacy attempt · original question context was not saved.</p>'}<p class="small-label">Your answer${entry.couldNotRecall?' · couldn’t recall':''}</p>${entry.answer?`<p class="review-history-answer">${esc(entry.answer)}</p>`:'<p class="helper-copy">No answer entered.</p>'}${context?`${entry.criteriaSnapshot?`<p class="small-label">Your comparison notes at this attempt</p><p class="review-criteria">${esc(entry.criteriaSnapshot)}</p>`:''}<details class="review-history-reference"><summary>Original passage kept with this attempt</summary><blockquote>${esc(entry.referenceSnapshot)}</blockquote></details>`:''}</details>`;
  }).join('')}</div>`;
}

/** An isolated mount: the app supplies its validated commit boundary and source
 * navigation. It does not create calendar work or judge an answer itself. */
export function mountReview(host,{getState,commitState,notify=()=>{},onReadSource=()=>{},onPlanSession=()=>{},onChanged=()=>{}}) {
  let disposed = false;
  let scope = getState().activeProjectId;
  let observedProject = scope;
  let budgetMinutes = 10;
  let maxItems = 5;
  function focus(selector) { host.querySelector(selector)?.focus({preventScroll:true}); }
  function update(transform,type,{redraw=true,announce=true,focusTo=null}={}) {
    if (disposed) return false;
    try {
      const candidate = transform(getState());
      if (commitState(candidate) === false) return false;
      if (redraw) render();
      if (announce) onChanged({type,current:currentReviewItem(getState()),revealed:getState().reviewSession?.revealed ?? false});
      if (focusTo) focus(focusTo);
      return true;
    } catch (error) { notify(error.message); return false; }
  }
  function render() {
    if (disposed) return;
    const state = getState();
    if (!state.reviewSession && observedProject !== state.activeProjectId) scope = state.activeProjectId;
    if (state.reviewSession) scope = state.reviewSession.projectId;
    observedProject = state.activeProjectId;
    if (scope !== null && !state.projects.some(item => item.id === scope)) scope = state.activeProjectId;
    const session = state.reviewSession;
    const due = dueReviewQueue(state,{projectId:scope,date:todayISO()});
    if (!session) {
      const latest = state.ideas.find(item => item.id === state.selectedIdeaId);
      host.innerHTML = `<section class="review-session" aria-label="Source review"><div class="review-session-intro"><span class="small-label">Source-linked recall</span><h3>A few questions, then a useful next step.</h3><p>Answer from memory, compare with the original passage and your own criteria, then decide when to revisit it.</p></div>${state.ideas.length?`<form data-review-form="start" class="review-session-settings"><label>Questions from<select data-review-scope name="projectId"><option value="all" ${scope===null?'selected':''}>All projects</option>${state.projects.map(project=>`<option value="${esc(project.id)}" ${scope===project.id?'selected':''}>${esc(project.title)}</option>`).join('')}</select></label><label>Minutes to set aside<input data-review-budget name="budgetMinutes" type="number" min="1" max="120" step="1" value="${budgetMinutes}" required></label><label>Maximum questions<input data-review-limit name="maxItems" type="number" min="1" max="50" step="1" value="${maxItems}" required></label><div class="review-session-start"><button type="submit" class="primary" ${due.length?'':'disabled'}>Start ${Math.min(due.length,maxItems)}-question review</button><button type="button" data-review="plan" class="text-button" ${due.length?'':'disabled'}>Set aside time in Week →</button></div></form><p class="helper-copy">${due.length} question${due.length===1?'':'s'} due in ${esc(scopeTitle(state,scope))}. Overdue checks come first, then new questions. The time budget is yours to manage; it does not measure attention.</p>${due.length?`<ol class="review-due-list" aria-label="Next due questions">${due.slice(0,5).map(item=>`<li><span>${esc(item.title)}</span><small>${state.attempts.some(attempt=>attempt.ideaId===item.id)?'Due to revisit':'First check'}</small></li>`).join('')}</ol>`:'<p class="helper-copy">Nothing is due in this scope. Keep a question from a source, or choose another project.</p>'}${latest?history(state,[latest.id]):''}`:'<div class="empty-state"><p>Keep a passage in Ideas and write a question to check. A review starts with your actual material.</p></div>'}</section>`;
      return;
    }
    const current = currentReviewItem(state);
    const completed = session.index >= session.ideaIds.length;
    const progress = `${session.checkedIds.length} checked · ${session.skippedIds.length} skipped · ${session.ideaIds.length-session.index} remaining`;
    const controls = `<div class="review-session-tools">${session.lastUndo?'<button data-review="undo" class="text-button">Undo last assessment</button>':''}<button data-review="end" class="text-button">${completed?'Close session':'End session'}</button></div>`;
    if (completed) {
      host.innerHTML = `<section class="review-session" aria-label="Source review"><div class="review-session-header"><span class="small-label">${esc(scopeTitle(state,session.projectId))} · ${session.budgetMinutes}-minute budget</span>${controls}</div><div class="review-session-complete" tabindex="-1" data-review-current><h3>This queue is finished.</h3><p role="status">${esc(progress)}</p><p>Skipped questions keep their previous due dates. Your answers and assessments remain in the record.</p><button data-review="plan" class="secondary">Put a next step in Week →</button></div>${history(state,session.checkedIds)}</section>`;
      return;
    }
    if (!current) { host.innerHTML='<p class="form-error">This review question is unavailable. End the session before changing its source.</p><button class="secondary" data-review="end">End session</button>'; return; }
    const source = state.sources.find(item=>item.id===current.sourceId);
    const paragraph = source?.paragraphs.find(item=>item.id===current.paragraphId);
    host.innerHTML = `<section class="review-session" aria-label="Source review"><div class="review-session-header"><div><span class="small-label">Question ${session.index+1} of ${session.ideaIds.length} · ${session.budgetMinutes}-minute budget</span><p class="review-progress" role="status">${esc(progress)}</p></div>${controls}</div><div class="practice-prompt" tabindex="-1" data-review-current><span class="small-label">${esc(current.title)} · ${esc(scopeTitle(state,current.projectId))}</span><h3>${esc(current.question||`Explain “${current.title}” and give an example relevant to your project.`)}</h3><p>${session.revealed?'Compare your answer, then make your own assessment.':'The source and your comparison notes stay hidden until you answer or report that you couldn’t recall.'}</p></div><label for="review-session-answer" class="small-label">Your answer</label><textarea id="review-session-answer" data-review-answer class="practice-answer" rows="5" maxlength="100000" placeholder="Use your own words. A partial answer is useful too.">${esc(session.answer)}</textarea>${session.revealed?`<div class="practice-reference" data-review-comparison tabindex="-1"><span class="small-label">Compare with the original passage</span><blockquote>${esc(paragraph?.text ?? '')}</blockquote><button data-review="source" class="citation-button">${esc(source?.title)} · §${(paragraph?.index??0)+1} ↗</button>${current.answerCriteria?`<div class="review-criteria"><span class="small-label">Your answer criteria</span><p>${esc(current.answerCriteria)}</p></div>`:'<p class="helper-copy">No answer criteria yet. You can add your own comparison notes in Ideas.</p>'}</div>${session.couldNotRecall?'<p class="review-failure">You reported that you couldn’t recall. This check will use Again; your actual answer is retained.</p>':''}<p class="helper-copy">Your assessment, not an automatic grade. Fixed revisit rules: 1, 3 or 7 days.</p><div class="practice-ratings"><button data-review-rate="again">Again<small>In 1 day</small></button><button data-review-rate="uncertain" ${session.couldNotRecall?'disabled':''}>Uncertain<small>In 3 days</small></button><button data-review-rate="understood" ${session.couldNotRecall?'disabled':''}>Understood<small>In 7 days</small></button></div>`:`<div class="review-recall-actions"><button data-review="reveal" class="primary">Reveal comparison</button><button data-review="failure" class="secondary">I couldn’t recall</button></div>`}<div class="review-session-navigation"><button data-review="skip" class="text-button">Skip without assessment</button>${!session.revealed?'<button data-review="source" class="text-button">Pause and read the source ↗</button>':''}<button data-review="plan" class="text-button">Set aside time in Week →</button></div>${session.revealed?history(state,[current.id]):''}</section>`;
  }
  function plan() {
    const state=getState(), session=state.reviewSession;
    if (!session && (!Number.isSafeInteger(budgetMinutes) || budgetMinutes<1 || budgetMinutes>120 || !Number.isSafeInteger(maxItems) || maxItems<1 || maxItems>50)) {notify('Choose 1–120 minutes and 1–50 questions before reserving time.');return;}
    const ideaIds=session ? session.ideaIds.slice(session.index) : dueReviewQueue(state,{projectId:scope}).slice(0,maxItems).map(item=>item.id);
    onPlanSession({projectId:session?session.projectId:scope,budgetMinutes:session?.budgetMinutes??budgetMinutes,maxItems:session?.maxItems??maxItems,ideaIds,currentIdeaId:currentReviewItem(state)?.id??null});
  }
  function click(event) {
    const button=event.target.closest?.('[data-review], [data-review-rate]');
    if(!button || button.disabled || !host.contains(button) || disposed)return;
    event.stopPropagation();
    const action=button.dataset.review;
    if(button.dataset.reviewRate){if(update(state=>rateReview(state,button.dataset.reviewRate),'assess',{focusTo:'[data-review-current]'}))notify('Your answer and original context were retained. The queue has advanced.');return;}
    if(action==='reveal')update(state=>revealReview(state),'reveal',{focusTo:'[data-review-comparison]'});
    else if(action==='failure')update(state=>revealReview(state,{couldNotRecall:true}),'reveal',{focusTo:'[data-review-comparison]'});
    else if(action==='skip'){if(update(skipReview,'skip',{focusTo:'[data-review-current]'}))notify('Skipped. No assessment or new due date was created.');}
    else if(action==='undo'){if(update(undoReview,'undo',{focusTo:'[data-review-current]'}))notify('The last assessment was removed; its question and answer are restored.');}
    else if(action==='end'){if(update(endReview,'end'))notify('Session closed. Review history and due dates are retained.');}
    else if(action==='source'){
      const item=currentReviewItem(getState());
      if(item)onReadSource({ideaId:item.id,sourceId:item.sourceId,paragraphId:item.paragraphId});
    } else if(action==='plan')plan();
  }
  function input(event) {
    if(!event.target.matches?.('[data-review-answer]') || disposed)return;
    event.stopPropagation();
    update(state=>writeReviewAnswer(state,event.target.value),'answer',{redraw:false,announce:false});
  }
  function change(event) {
    if(disposed)return;
    if(event.target.matches?.('[data-review-scope]')){event.stopPropagation();scope=event.target.value==='all'?null:event.target.value;render();}
    else if(event.target.matches?.('[data-review-budget]')){event.stopPropagation();budgetMinutes=Number(event.target.value);}
    else if(event.target.matches?.('[data-review-limit]')){event.stopPropagation();maxItems=Number(event.target.value);render();}
  }
  function submit(event) {
    if(event.target.dataset?.reviewForm!=='start' || disposed)return;
    event.preventDefault();event.stopPropagation();
    const selected=host.querySelector('[data-review-scope]')?.value;
    scope=selected==='all'?null:selected??scope;
    budgetMinutes=Number(host.querySelector('[data-review-budget]')?.value??budgetMinutes);
    maxItems=Number(host.querySelector('[data-review-limit]')?.value??maxItems);
    update(state=>startReviewSession(state,{projectId:scope,budgetMinutes,maxItems}),'start',{focusTo:'[data-review-current]'});
  }
  host.addEventListener('click',click);host.addEventListener('input',input);host.addEventListener('change',change);host.addEventListener('submit',submit);
  render();
  return {render,destroy(){if(disposed)return;disposed=true;host.removeEventListener('click',click);host.removeEventListener('input',input);host.removeEventListener('change',change);host.removeEventListener('submit',submit);}};
}
