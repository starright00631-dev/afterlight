import {uid,todayISO,localStudyDate,dueIdeas,addDays,splitSource,createState,createExampleState,scheduleActions,sessionElapsed,reviewDue} from './domain.js';
import {SAVE_KEY,PRIOR_SAVE_KEY,LEGACY_SAVE_KEY,validateState,loadState,saveState} from './persistence.js';
import {calendarExport,workspaceCalendarExport} from './calendar.js';
import {mountAgenda} from './agenda-ui.js';
import {mountReadingIntake} from './source-intake.js';
import {mountReview} from './review-ui.js';
import {currentReviewItem,startReviewSession} from './review-sessions.js';
import {readyActions,remainingMinutes,validateBlockPlacement} from './workspace-planner.js';
import {closeWorkSession} from './work-sessions.js';
import {createLabState} from './optics.js';
import {mountStudio} from './studio-ui.js';
import {activeStudy,studyReportText} from './studies.js';
import {createClientServices,HOSTED_ASSISTANT_MESSAGE} from './client-services.js';

const clientServices=createClientServices();

const $=(selector)=>document.querySelector(selector);
const esc=(value)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const nowISO=()=>new Date().toISOString();
const clock=(minutes)=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
const duration=(ms)=>`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
const dateLabel=(date,options={weekday:'short',day:'numeric'})=>new Date(date+'T12:00:00').toLocaleDateString(undefined,options);
let storage;try{storage=localStorage;}catch{storage={getItem(){throw Error();},setItem(){throw Error();}};}
const loaded=loadState(storage);
let state=loaded.state;
let recoveryRaw=loaded.recoveryRaw||'';if(loaded.notice&&!recoveryRaw){try{recoveryRaw=storage.getItem(SAVE_KEY)||storage.getItem(SAVE_KEY+'.unreadable')||storage.getItem(PRIOR_SAVE_KEY)||storage.getItem(LEGACY_SAVE_KEY)||'';}catch{}}
try{if(!storage.getItem(SAVE_KEY)&&!storage.getItem(PRIOR_SAVE_KEY)&&!storage.getItem(LEGACY_SAVE_KEY)&&!loaded.notice){state.projects[0].title='Light for a shared table';state.projects[0].question='How can both reading places meet the light levels I choose?';state.view='lab';}}catch{}
state.lab=state.lab||createLabState();
let workMode=state.reviewSession?'practice':'ideas',readerMode='read',selectedParagraph=null,practiceRevealed=false,practiceAnswer='',practiceIdeaId=null,draftActionId=state.session?.actionId||null;
let providerId='codex',providers=[],provider={id:'codex',name:'Codex',available:false,message:'Checking installed assistants…'},aiResult=null,aiBusy=false,aiAbort=null;
let toastTimeout,audioContext,audioNode,audioGain,sourceImportAbort=null;
const dialog=$('#dialog');
dialog.addEventListener('close',()=>sourceImportAbort?.abort());
const project=()=>state.projects.find(item=>item.id===state.activeProjectId)||state.projects[0];
const projectSources=()=>state.sources.filter(item=>item.projectId===project().id);
const projectIdeas=()=>state.ideas.filter(item=>item.projectId===project().id);
const projectActions=()=>state.actions.filter(item=>item.projectId===project().id);
const source=()=>projectSources().find(item=>item.id===state.selectedSourceId)||projectSources()[0];
const idea=()=>projectIdeas().find(item=>item.id===state.selectedIdeaId)||projectIdeas()[0];
const draftAction=()=>projectActions().find(item=>item.id===draftActionId)||projectActions().find(item=>item.status==='todo')||projectActions()[0];
const lightLab=mountStudio($('#lab-view'),{getState:()=>state,commitState:commitStudio,onReadSource:readStudySource,onUseDecision:useStudyDecision,onPlanCheck:planStudyCheck,notify});
const agenda=mountAgenda($('#workspace-agenda'),$('#desk-agenda'),{getState:()=>state,commitState:commitStudio,notify,onWorkAction:openAgendaAction,onReview:openReview,onEditAction:id=>{const action=state.actions.find(a=>a.id===id);if(action)state.activeProjectId=action.projectId;openAction(id);},onNewAction:()=>openAction(),onReadSource:id=>{const action=state.actions.find(a=>a.id===id),note=state.ideas.find(i=>i.id===action?.ideaId)||state.ideas.find(i=>action?.reviewIdeaIds?.includes(i.id));if(note){state.activeProjectId=note.projectId;workMode='ideas';goEvidence(note.id);}}});
const reviewView=mountReview($('#work-content'),{getState:()=>state,commitState:commitStudio,notify,onReadSource:reference=>{workMode='ideas';goEvidence(reference.ideaId);},onPlanSession:planReview,onChanged:change=>{practiceRevealed=Boolean(state.reviewSession?.revealed);if(change.type==='end'&&state.actions.find(a=>a.id===state.session?.actionId)?.reviewMinutes){state.view='quiet';persist();}render();}});
function commitStudio(candidate){try{const checked=validateState(candidate);if(recoveryRaw){storage.setItem(SAVE_KEY+'.unreadable',recoveryRaw);}if(!saveState(storage,checked)){notify('The change could not be saved. Your previous study and unfinished result are intact.');return false;}state=checked;$('#save-status').textContent='Saved in this browser';$('#save-status').classList.remove('save-warning');return true;}catch(error){notify(error.message);return false;}}
function persist(){if(recoveryRaw){try{storage.setItem(SAVE_KEY+'.unreadable',recoveryRaw);}catch{$('#save-status').textContent='Export the unreadable record before saving';return false;}}const ok=saveState(storage,state);$('#save-status').textContent=ok?'Saved in this browser':'Saving unavailable · session only';$('#save-status').classList.toggle('save-warning',!ok);return ok;}
function notify(text){clearTimeout(toastTimeout);$('#toast').textContent=text;$('#toast').classList.add('visible');toastTimeout=setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
function showDialog(title,body,actions=''){ sourceImportAbort?.abort();sourceImportAbort=null;$('#dialog-body').innerHTML=`<div class="dialog-shell"><div class="dialog-header"><h2 id="dialog-title">${esc(title)}</h2><button data-act="close-dialog" class="dialog-close" aria-label="Close dialog">×</button></div>${body}${actions?`<div class="dialog-actions">${actions}</div>`:''}</div>`;if(!dialog.open)dialog.showModal();$('#dialog .dialog-close').focus({preventScroll:true});}
function confirmAction(title,detail,callback,label='Confirm'){showDialog(title,`<p class="helper-copy">${esc(detail)}</p>`,`<button id="confirm-action" class="primary danger">${esc(label)}</button><button data-act="close-dialog" class="secondary">Cancel</button>`);$('#confirm-action').addEventListener('click',()=>{dialog.close();callback();});}
function download(name,data,type='application/json'){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function selectSource(id){state.selectedSourceId=id;selectedParagraph=null;aiResult=null;readerMode='read';render();persist();}
function ensureStudySource(candidate,study){
  if(!study.projectId)throw Error('Associate this recovered study with a project before using its sources in Desk.');
  const text=lightLab.sourceText(),existing=candidate.sources.find(s=>s.projectId===study.projectId&&s.kind==='model'&&s.text===text);if(existing)return existing;
  if(candidate.sources.length>=100||candidate.sources.reduce((sum,s)=>sum+s.text.length,0)+text.length>10000000)throw Error('Export or remove an older source before adding the model reference.');
  const src={id:uid('source'),projectId:study.projectId,title:'Light · model and scientific references',kind:'model',text,paragraphs:splitSource(text),createdAt:nowISO()};candidate.sources.push(src);return src;
}
function readStudySource(study){try{const candidate=state.session?closeWorkSession(state):structuredClone(state),src=ensureStudySource(candidate,study);candidate.activeProjectId=study.projectId;candidate.selectedSourceId=src.id;candidate.selectedIdeaId=null;candidate.view='desk';if(!commitStudio(candidate))return;workMode='ideas';readerMode='read';selectedParagraph=null;aiResult=null;render();}catch(error){notify(error.message);}}
function useStudyDecision(study){try{
  if(!study.decision)throw Error('Keep an arrangement and its reason first.');const candidate=state.session?closeWorkSession(state):structuredClone(state),current=candidate.studio.studies.find(s=>s.id===study.id),modelSource=ensureStudySource(candidate,current),modelParagraph=modelSource.paragraphs.find(p=>p.text.includes('For an ideal point lamp'))||modelSource.paragraphs[0];
  if(!current.decision.sourceRefs.some(ref=>ref.sourceId===modelSource.id&&ref.paragraphId===modelParagraph.id))current.decision.sourceRefs.push({sourceId:modelSource.id,paragraphId:modelParagraph.id});
  const text=studyReportText(current,{sources:candidate.sources});let report=candidate.sources.find(s=>s.projectId===current.projectId&&s.kind==='study'&&s.text===text);
  if(!report){if(candidate.sources.length>=100||candidate.sources.reduce((sum,s)=>sum+s.text.length,0)+text.length>10000000)throw Error('Export or remove an older source before keeping this report.');report={id:uid('source'),projectId:current.projectId,title:`Study · ${current.title}`.slice(0,300),kind:'study',text,paragraphs:splitSource(text),createdAt:nowISO()};candidate.sources.push(report);}
  let note=candidate.ideas.find(i=>i.sourceId===report.id);if(!note){if(candidate.ideas.length>=500)throw Error('Export or remove an older idea before keeping this decision.');const paragraph=report.paragraphs.find(p=>p.text.includes(current.decision.reason))||report.paragraphs[0];note={id:uid('idea'),projectId:current.projectId,sourceId:report.id,paragraphId:paragraph.id,title:`Decision · ${current.title}`.slice(0,300),explanation:current.decision.reason,question:'Which assumption would a real measurement test?',answerCriteria:'',createdAt:nowISO(),origin:'user'};candidate.ideas.push(note);}
  candidate.activeProjectId=current.projectId;candidate.selectedSourceId=report.id;candidate.selectedIdeaId=note.id;candidate.view='desk';if(!commitStudio(candidate))return;workMode='ideas';readerMode='read';selectedParagraph=note.paragraphId;aiResult=null;render();notify('Your study report and reason are kept together in Desk.');
}catch(error){notify(error.message);}}
function measurementDraft(study){const chosen=study.decision&&study.alternatives.find(a=>a.id===study.decision.chosenId);return [`Study: ${study.title}`,`Study ID: ${study.id}`,`Arrangement: ${chosen?.name||'Choose a saved arrangement before measuring'}`,`Reason: ${study.decision?.reason||''}`,`Next check: ${study.decision?.nextCheck||''}`,'',...(chosen?.readings.detectors||[]).map(point=>`${point.label} · calculated ${point.lux.toFixed(2)} lx · observed: ___ lx`),'','Instrument / method:','Date and time:','Ambient conditions and arrangement changes:','What differs from the ideal model?'].join('\n');}
function planStudyCheck(study){
  if(!study.projectId){notify('Associate this recovered study with a project before planning its check.');return;}
  const suggestion=study.decision?.nextCheck||`Measure the reading places in ${study.title}`;
  showDialog('Plan a real check',`<form id="study-check-form" class="dialog-form"><p class="helper-copy">A concrete next step for ${esc(study.title)}. Choose an estimate; Week uses it to show what fits.</p><label>What will you check?<input name="title" required maxlength="300" value="${esc(suggestion.slice(0,300))}"></label><label>Estimated minutes<input name="minutes" type="number" min="1" max="720" value="15" required></label><label>Deadline, if any<input name="deadline" type="date"></label><button class="primary">Add to Week</button></form>`);
  $('#study-check-form').addEventListener('submit',event=>{event.preventDefault();try{const values=new FormData(event.currentTarget),candidate=state.session?closeWorkSession(state):structuredClone(state),current=candidate.studio.studies.find(s=>s.id===study.id),title=String(values.get('title')).trim();if(candidate.actions.length>=500)throw Error('Export or remove an older action before adding another.');const existing=candidate.actions.find(a=>a.studyId===study.id&&a.title===title&&a.status!=='done');if(!existing)candidate.actions.push({id:uid('action'),projectId:study.projectId,studyId:study.id,title,minutes:Number(values.get('minutes')),ideaId:null,status:'todo',dependsOn:[],deadline:String(values.get('deadline'))||null,draft:measurementDraft(current),spentMs:0,completedAt:null,remainingMinutes:null,reviewMinutes:null,reviewIdeaIds:null,reviewMaxItems:null});candidate.activeProjectId=study.projectId;candidate.selectedSourceId=null;candidate.selectedIdeaId=null;candidate.view='week';if(!commitStudio(candidate))return;dialog.close();render();notify('Your measurement check is in Week, linked to this study.');}catch(error){notify(error.message);}});
}
function resumeStudy(id){const study=state.studio.studies.find(s=>s.id===id);if(!study)return;state.studio.activeStudyId=id;goView('lab');}
function projectStudy(){const active=activeStudy(state.studio);return active?.projectId===project().id?active:state.studio.studies.find(study=>study.projectId===project().id&&study.kind==='personal')||state.studio.studies.find(study=>study.projectId===project().id);}
function renderStudyLinks(){const study=projectStudy();for(const id of ['desk-study-link','quiet-study-link']){const node=$('#'+id);node.hidden=!study;if(study)node.innerHTML=`<div><strong>${esc(study.title)}</strong><span>${study.staged?'An unfinished conclusion is retained.':study.pending?'A prediction is committed.':study.decision?'A decision and its evidence are retained.':'Your lighting study is ready to continue.'}</span></div><button class="text-button" data-act="return-study" data-study-id="${esc(study.id)}">Return to Studio →</button>`;}}
function goView(view){state.view=view;render();persist();$('#main').focus({preventScroll:true});}
function goEvidence(ideaId){const item=state.ideas.find(entry=>entry.id===ideaId);if(!item)return;state.selectedSourceId=item.sourceId;state.selectedIdeaId=item.id;selectedParagraph=item.paragraphId;readerMode='read';state.view='desk';render();persist();requestAnimationFrame(()=>document.querySelector(`[data-paragraph="${item.paragraphId}"]`)?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));}
function render(){
  if(!project()){state=validateState(createState());}
  document.body.classList.toggle('day-theme',!state.settings.night);
  document.body.classList.toggle('lab-active',state.view==='lab');
  $('#appearance-button').setAttribute('aria-label',state.settings.night?'Use day appearance':'Use night appearance');
  $('#project-select').innerHTML=state.projects.map(item=>`<option value="${esc(item.id)}" ${item.id===project().id?'selected':''}>${esc(item.title)}</option>`).join('');
  $('#example-label').hidden=!project().example;
  for(const node of document.querySelectorAll('[data-view]')){node.classList.toggle('active',node.dataset.view===state.view);node.setAttribute('aria-current',node.dataset.view===state.view?'page':'false');}
  for(const view of ['lab','desk','library','week','quiet'])$(`#${view}-view`).hidden=state.view!==view;
  $('#project-title').textContent=project().title;$('#project-question').textContent=project().question||'A question, a source, and a place to work through it.';
  $('#handoff-banner').hidden=!project().closing?.nextAction;
  $('#handoff-banner').innerHTML=`<span class="small-label">You left a starting point</span><p>${esc(project().closing?.nextAction)}</p><button data-view="quiet" class="text-button">Read your handoff →</button>`;
  renderReader();renderWork();renderLibrary();renderWeek();renderQuiet();renderStudyLinks();renderAssistant();tick();if(state.view==='lab')lightLab.render();
  const next=readyActions(state.actions).find(item=>remainingMinutes(item)>0);
  $('#desk-next').textContent=next?`Ready to work on: ${next.title} · ${remainingMinutes(next)} min remaining`:'No ready action. Resolve a prerequisite or name a concrete output.';
  $('#footer-context').textContent=state.view==='lab'?'Calculated on this computer · saved in this browser.':project().example?'Example material · replace it with your own.':'Your own material · saved in this browser.';
}
function renderReader(){
  const current=source();if(current)state.selectedSourceId=current.id;
  const referenceHidden=workMode==='practice'&&Boolean(currentReviewItem(state))&&!state.reviewSession?.revealed;
  for(const button of document.querySelectorAll('[data-reader]'))button.disabled=referenceHidden;
  $('#source-select').disabled=!current;$('#source-details-button').disabled=!current;
  $('#source-select').innerHTML=current?projectSources().map(item=>`<option value="${esc(item.id)}" ${item.id===current.id?'selected':''}>${esc(item.title)}</option>`).join(''):'<option>No sources yet</option>';
  for(const button of document.querySelectorAll('[data-reader]'))button.setAttribute('aria-pressed',String(button.dataset.reader===readerMode));
  $('#reader-content').hidden=readerMode==='map';$('#source-map').hidden=readerMode!=='map';
  if(!current){$('#reader-content').innerHTML='<div class="empty-state"><div class="empty-illustration" aria-hidden="true">↗</div><h3>Start with something real.</h3><p>Add a reading, project notes, or an unfinished thought. Keep its words beside the work you make.</p><button data-open-source class="primary">Add a reading</button><button data-act="open-example" class="text-button">Open the example desk</button></div>';$('#source-map').innerHTML='';$('#source-meta').textContent='Text, Markdown or digital PDF';return;}
  if(referenceHidden){$('#reader-content').hidden=false;$('#source-map').hidden=true;$('#source-map').innerHTML='';$('#reader-content').innerHTML='<div class="empty-state"><span class="small-label">Reference put aside</span><h3>Start with what you remember.</h3><p>Write your answer in the practice pane, then reveal the original passage to compare. Switch to Ideas or Draft whenever you want to read again.</p></div>';$('#source-meta').textContent='The source is intact. It returns when you reveal the reference.';return;}
  $('#reader-content').innerHTML=`<div class="source-document"><div class="source-document-title"><span class="small-label">${current.kind==='example'?'Original example note':esc(current.kind.toUpperCase())}</span><h3>${esc(current.title)}</h3></div>${current.paragraphs.map((paragraph,index)=>{
    const kept=projectIdeas().filter(item=>item.sourceId===current.id&&item.paragraphId===paragraph.id).length;
    const heading=/^#{1,6}\s/.test(paragraph.text);
    return `<section class="source-paragraph ${kept?'kept':''} ${selectedParagraph===paragraph.id?'selected':''} ${heading?'source-heading':''}" data-paragraph="${esc(paragraph.id)}"><span class="paragraph-number">${String(index+1).padStart(2,'0')}</span><div class="paragraph-text">${heading?`<h4>${esc(paragraph.text.replace(/^#{1,6}\s+/,''))}</h4>`:esc(paragraph.text)}</div><button data-act="keep" data-paragraph-id="${esc(paragraph.id)}" class="keep-passage" aria-label="Keep passage ${index+1}" title="Keep this passage">${kept?'✓':'+'}</button></section>`;
  }).join('')}</div>`;
  const linked=projectIdeas().filter(item=>item.sourceId===current.id);
  $('#source-map').innerHTML=`<div class="map-intro"><h3>From this source to your work</h3><p>These connections come from the passages you kept and the actions you attached.</p></div><div class="map-source">${esc(current.title)}</div>${linked.length?linked.map(item=>{const actions=projectActions().filter(action=>action.ideaId===item.id);return `<div class="map-branch"><button class="source-map-node" data-act="evidence" data-idea-id="${esc(item.id)}"><span class="small-label">Kept idea · passage ${current.paragraphs.findIndex(p=>p.id===item.paragraphId)+1}</span><strong>${esc(item.title)}</strong></button><div class="map-actions">${actions.length?actions.map(action=>`<button data-act="work-action" data-action-id="${esc(action.id)}"><span>${action.status==='done'?'✓':'↳'}</span>${esc(action.title)}<small>${action.minutes} min</small></button>`).join(''):'<span class="small-label">No action attached yet</span>'}</div></div>`;}).join(''):'<div class="empty-state"><p>Keep a passage, then attach a next action. Its connections will appear here.</p></div>'}`;
  $('#source-meta').textContent=`${current.paragraphs.length} passage${current.paragraphs.length===1?'':'s'} · ${current.text.length.toLocaleString()} characters`;
}
function renderWork(){
  document.querySelector('.desk-layout').classList.toggle('reviewing',workMode==='practice');
  if(workMode==='practice'&&practiceIdeaId!==idea()?.id){practiceAnswer='';practiceRevealed=false;practiceIdeaId=idea()?.id||null;}
  renderReader();
  renderAssistant();
  for(const button of document.querySelectorAll('[data-work]')){button.classList.toggle('active',button.dataset.work===workMode);button.setAttribute('aria-pressed',String(button.dataset.work===workMode));}
  $('#idea-count').textContent=projectIdeas().length||'';
  if(workMode==='practice'){renderPractice();return;}if(workMode==='draft'){renderDraft();return;}
  $('#work-content').innerHTML=`<div class="work-intro"><p>Keep a passage. Say what it means. Decide what you can do with it.</p></div>${projectIdeas().length?projectIdeas().map(item=>{
    const src=state.sources.find(entry=>entry.id===item.sourceId),paragraph=src?.paragraphs.find(entry=>entry.id===item.paragraphId);
    const selected=state.selectedIdeaId===item.id;
    return `<article class="note-card ${selected?'selected':''}" data-idea="${esc(item.id)}"><div class="note-top"><button data-act="select-idea" data-idea-id="${esc(item.id)}" class="note-title">${esc(item.title)}</button><button class="icon-button" data-act="delete-idea" data-idea-id="${esc(item.id)}" aria-label="Delete idea ${esc(item.title)}">×</button></div><button class="citation-button" data-act="evidence" data-idea-id="${esc(item.id)}">${esc(src?.title)} · §${src?.paragraphs.findIndex(p=>p.id===item.paragraphId)+1} ↗</button><blockquote class="note-quote">${esc(paragraph?.text?.slice(0,260))}${(paragraph?.text.length||0)>260?'…':''}</blockquote>${selected?`<form class="note-form" data-edit-idea="${esc(item.id)}"><label>Idea title<input name="title" value="${esc(item.title)}" maxlength="160" required></label><label>In your words<textarea name="explanation" rows="3" maxlength="6000" placeholder="What does this mean for your question?">${esc(item.explanation)}</textarea></label><label>A question to check later<input name="question" value="${esc(item.question)}" maxlength="1000" placeholder="Can you explain or apply this without the source?"></label><label>What should an answer include?<textarea name="answerCriteria" rows="2" maxlength="6000" placeholder="Key points to compare after recall">${esc(item.answerCriteria)}</textarea></label><button class="secondary" type="submit">Save idea</button></form>`:`<p class="note-explanation">${esc(item.explanation||'Write what this passage means to you.')}</p>`}<div class="note-actions"><button data-act="practice-idea" data-idea-id="${esc(item.id)}" class="text-button">Check understanding</button><button data-act="plan-idea" data-idea-id="${esc(item.id)}" class="text-button">+ Put it to work</button></div><span class="note-meta">${item.origin==='ai'?'Assistant suggestion · review against the source':'Your note'}</span></article>`;
  }).join(''):'<div class="empty-state"><h3>A place for your thinking.</h3><p>Use + beside a source passage. Then write an explanation or question in your own words.</p></div>'}`;
}
function renderPractice(){
  reviewView.render();const action=state.actions.find(a=>a.id===state.session?.actionId);
  if(action?.reviewMinutes){const controls=document.createElement('div');controls.className='review-work-focus';controls.innerHTML=`<span>Work session · <strong id="review-work-clock">${duration(sessionElapsed(state.session,Date.now()))}</strong> elapsed</span><button class="text-button" data-act="review-focus-toggle">${state.session.running?'Pause timer':'Resume timer'}</button><button class="text-button" data-view="quiet">Finish this work session →</button>`;$('#work-content').prepend(controls);}
}
function renderDraft(){
  const action=draftAction();if(!action){$('#work-content').innerHTML='<div class="empty-state"><h3>Give the work an endpoint.</h3><p>Add an action with a tangible output: an argument, a worked example, a decision or a first draft.</p><button id="draft-add-action" data-act="new-action" class="primary">Add an action</button></div>';return;}
  draftActionId=action.id;
  const linked=state.ideas.find(item=>item.id===action.ideaId),running=state.session?.actionId===action.id&&state.session.running;
  $('#work-content').innerHTML=`<label class="small-label" for="draft-action">Current piece of work</label><select id="draft-action" class="draft-selector">${projectActions().map(item=>`<option value="${esc(item.id)}" ${item.id===action.id?'selected':''}>${esc(item.title)}</option>`).join('')}</select><div class="focus-strip"><div><span class="small-label">Elapsed time · ${action.minutes} min original · ${remainingMinutes(action)} min remaining</span><strong class="focus-clock" id="focus-clock">00:00</strong></div><div class="focus-actions"><button data-act="focus-toggle" class="secondary" ${running||readyActions(state.actions).some(a=>a.id===action.id)?'':'disabled'}>${running?'Pause':state.session?.actionId===action.id?'Resume focus':'Start focus'}</button><button data-act="complete-action" class="text-button" ${action.status==='done'?'disabled':''}>${action.status==='done'?'Completed':'Mark complete'}</button></div></div>${linked?`<div class="draft-evidence"><span class="small-label">The idea behind this action</span><button data-act="evidence" data-idea-id="${esc(linked.id)}" class="citation-button">${esc(linked.title)} ↗</button><p>${esc(linked.explanation)}</p></div>`:''}${action.studyId?`<button class="text-button" data-act="return-study" data-study-id="${esc(action.studyId)}">Open the lighting study behind this check →</button>`:''}<label class="small-label" for="draft-editor">Your output</label><textarea id="draft-editor" class="draft-editor" rows="10" maxlength="60000" placeholder="Write the argument, work through the example, or record your decision. This draft saves as you type.">${esc(action.draft)}</textarea><div class="draft-status"><span id="draft-save-status">Saved with your project</span><span>${action.status==='done'?'Completion reported by you':action.status==='blocked'?'Marked blocked':'Work in progress'}</span></div><button data-view="quiet" class="text-button">Finish this session →</button>`;
}
function renderLibrary(){
  const query=$('#library-search').value.trim().toLowerCase();const items=projectSources().filter(item=>(item.title+' '+item.text).toLowerCase().includes(query));
  $('#library-summary').textContent=`${projectSources().length} sources in this project`;
  $('#library-list').innerHTML=items.length?items.map(item=>{const ideas=projectIdeas().filter(entry=>entry.sourceId===item.id);return `<article class="source-card"><div class="source-card-index" aria-hidden="true">${item.kind==='pdf'?'PDF':item.kind==='markdown'?'MD':'TXT'}</div><div class="source-card-main"><button data-act="read-source" data-source-id="${esc(item.id)}" class="source-card-title">${esc(item.title)}</button><p>${esc(item.paragraphs.find(p=>!p.text.startsWith('#'))?.text.slice(0,200)||item.text.slice(0,200))}${item.text.length>200?'…':''}</p><div class="source-card-meta">${item.paragraphs.length} passages · ${ideas.length} kept ideas${item.kind==='example'?' · Example material':''}</div></div><div class="source-card-actions"><button data-act="read-source" data-source-id="${esc(item.id)}" class="text-button">Open →</button><button data-act="delete-source" data-source-id="${esc(item.id)}" class="icon-button" aria-label="Delete source ${esc(item.title)}">×</button></div></article>`;}).join(''):`<div class="empty-state"><h2>${query?'No matching source.':'Bring your material.'}</h2><p>${query?'Try a phrase from its title or text.':'Add a PDF, text or Markdown reading. Keep passages from it beside your notes, questions and tasks.'}</p><button data-open-source class="primary">Add a reading</button></div>`;
}
function renderWeek(){agenda.render();}
function renderQuiet(){
  renderQuietRecord();
  $('#closing-form').hidden=Boolean(state.session);
  $('#closing-note').value=project().closing?.note||'';$('#closing-next').value=project().closing?.nextAction||'';
  $('#closing-status').textContent=project().closing?.updatedAt?'Handoff saved. Your draft and starting point will be here.':'';
  $('#quiet-duration').value=state.quiet?.durationMinutes||10;
  $('#quiet-toggle').textContent=state.quiet?.running?'Pause quiet':state.quiet?.remainingMs?'Resume quiet':'Begin quiet';
}
function renderAssistant(){
  const hosted=!clientServices.capabilities.assistants;
  document.querySelector('.provider-controls').hidden=hosted;
  $('#assistant-form').hidden=hosted;
  document.querySelector('.assistant-shortcuts').hidden=hosted;
  $('#assistant-question').disabled=hosted;
  if(hosted){$('#provider-select').disabled=true;$('#provider-connect').disabled=true;$('#ask-button').disabled=true;for(const button of document.querySelectorAll('[data-assist]'))button.disabled=true;$('#provider-status').textContent='Local app required';$('#provider-status').title=HOSTED_ASSISTANT_MESSAGE;$('#assistant-privacy').textContent='Sources, notes and PDF extraction stay in this browser. This edition sends no source to an assistant.';$('#assistant-result').innerHTML=`<p class="helper-copy">${esc(HOSTED_ASSISTANT_MESSAGE)}</p>`;return;}
  const practicing=workMode==='practice'&&Boolean(currentReviewItem(state))&&!state.reviewSession?.revealed;
  const checking=provider.message.startsWith('Checking');
  $('#provider-status').textContent=aiBusy?'Working…':provider.available?`${provider.name||'Codex'} ready`:checking?'Checking providers…':`${provider.name||'Codex'} unavailable`;
  $('#provider-select').innerHTML=(providers.length?providers:[provider]).map(p=>`<option value="${esc(p.id)}" ${p.id===providerId?'selected':''}>${esc(p.name||'Codex')}${p.available?'':' · unavailable'}</option>`).join('');$('#provider-select').disabled=aiBusy;
  $('#assistant-privacy').textContent=`On request, this source goes to ${provider.name||'Codex'}. Provider credentials stay in the local server; notes stay in this browser.`;
  document.querySelector('[data-assist="explain"]').textContent=selectedParagraph||(idea()&&idea().sourceId===source()?.id)?'Explain the kept passage':'Explain this source';
  $('#provider-status').title=provider.message;$('#ask-button').disabled=practicing||aiBusy||!provider.available||!source();
  $('#provider-connect').disabled=aiBusy;
  for(const button of document.querySelectorAll('[data-assist]'))button.disabled=practicing||aiBusy||!provider.available||!source();
  if(practicing){$('#assistant-result').innerHTML='<p class="helper-copy">The second perspective returns after you reveal the reference.</p>';return;}
  if(aiBusy){$('#assistant-result').innerHTML='<div class="busy-indicator"><span></span><p>Reading the selected source. Your work is still saved.</p><button data-act="cancel-ai" class="text-button">Cancel request</button></div>';return;}
  if(!aiResult){$('#assistant-result').innerHTML=provider.available?'':`<p class="helper-copy">${esc(provider.message)}</p>`;return;}
  if(aiResult.sourceId&&aiResult.sourceId!==source()?.id){$('#assistant-result').innerHTML='';return;}
  if(aiResult.error){$('#assistant-result').innerHTML=`<p class="form-error">${esc(aiResult.error)}</p>`;return;}
  $('#assistant-result').innerHTML=`<div class="ai-answer"><span class="small-label">${esc(aiResult.provider)} · check against the source</span><p>${esc(aiResult.answer)}</p>${aiResult.citations.map((cite,index)=>`<button class="citation-button" data-act="ai-citation" data-citation="${index}">Source §${source().paragraphs.findIndex(p=>p.id===cite.paragraphId)+1} ↗</button>`).join('')}${aiResult.ideas.map((item,index)=>`<div class="ai-idea"><strong>${esc(item.title)}</strong><p>${esc(item.explanation)}</p><button class="text-button" data-act="keep-ai" data-ai-index="${index}">+ Keep this idea</button></div>`).join('')}</div>`;
}
async function refreshProviders(){
  try{const inventory=await clientServices.providerInventory();providers=inventory.providers||[{id:'codex',name:'Codex',...inventory.ai}];provider=providers.find(p=>p.id===providerId)||providers[0];providerId=provider.id;renderAssistant();}
  catch{provider={id:providerId,name:provider.name||'Assistant',available:false,message:'The local service is unavailable. Start the app with npm start.'};renderAssistant();}
}
function openProviderConnection(){
  if(!clientServices.capabilities.assistants){notify(HOSTED_ASSISTANT_MESSAGE);return;}
  showDialog('Choose your assistant',`<p class="helper-copy">Codex and Claude use their installed command-line accounts. Compatible APIs work with Ollama, DeepSeek and other providers. MCP connects tools and resources; this panel connects a language model.</p><div class="provider-inventory">${providers.map(p=>`<p><strong>${esc(p.name)}</strong> — ${esc(p.message)}</p>`).join('')}</div><form id="provider-form" class="dialog-form"><label>API provider<select name="id"><option value="compatible">OpenAI-compatible API</option><option value="ollama">Ollama on this computer</option><option value="deepseek">DeepSeek API</option></select></label><label>API endpoint<input name="baseUrl" type="url" required placeholder="https://your-provider.example/v1"></label><label>Model name<input name="model" required maxlength="200" placeholder="The exact model installed or offered by your provider"></label><label>API key (when required)<input name="apiKey" type="password" autocomplete="off" maxlength="4000"></label><label>Structured response support<select name="responseFormat"><option value="json">JSON mode</option><option value="schema">JSON schema</option><option value="none">Prompted JSON only</option></select></label><p class="helper-copy">The key stays in server memory for this run. It is not saved with your desk. The connection check lists models; it does not send your source.</p><p class="form-error" id="provider-error" role="alert"></p><div class="dialog-actions"><button class="primary" id="provider-submit">Check connection</button><button type="button" class="secondary" id="provider-disconnect">Disconnect this API</button></div></form>`);
  const form=$('#provider-form');form.elements.id.addEventListener('change',()=>{form.elements.baseUrl.value=({ollama:'http://127.0.0.1:11434/v1',deepseek:'https://api.deepseek.com/v1'})[form.elements.id.value]||'';});
  form.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(form),button=$('#provider-submit'),error=$('#provider-error');button.disabled=true;button.textContent='Checking models…';error.textContent='';
    try{await clientServices.connectProvider(Object.fromEntries(data));form.elements.apiKey.value='';providerId=String(data.get('id'));await refreshProviders();if(provider.available){dialog.close();notify(`${provider.name} is ready. Its first response will verify inference access.`);}else error.textContent=provider.message;}
    catch(errorCaught){form.elements.apiKey.value='';error.textContent=errorCaught.message;}finally{button.disabled=false;button.textContent='Check connection';}
  });
  $('#provider-disconnect').addEventListener('click',async()=>{try{await clientServices.disconnectProvider({id:form.elements.id.value});form.elements.apiKey.value='';await refreshProviders();dialog.close();notify('API connection removed from this run.');}catch(error){$('#provider-error').textContent=error.message;}});
}
function tick(){
  const session=state.session,action=draftAction();if($('#review-work-clock')&&session)$('#review-work-clock').textContent=duration(sessionElapsed(session,Date.now()));if($('#focus-clock'))$('#focus-clock').textContent=duration((action?.spentMs||0)+(session?.actionId===action?.id?sessionElapsed(session,Date.now()):0));
  if(session?.running&&sessionElapsed(session,Date.now())>=session.goalMinutes*60000)$('#draft-save-status')&&($('#draft-save-status').textContent='Your estimated focus time has passed. Pause or continue when you choose.');
  const quiet=state.quiet;const remaining=quiet?.running?Math.max(0,quiet.endsAt-Date.now()):quiet?.remainingMs??Number($('#quiet-duration').value||10)*60000;
  $('#quiet-clock').textContent=duration(remaining);$('#quiet-view').classList.toggle('quiet-running',Boolean(quiet?.running));
  if(quiet?.running&&remaining===0){quiet.running=false;quiet.endsAt=null;quiet.remainingMs=0;persist();$('#quiet-caption').textContent='The timer has finished. Stay here if you like.';$('#quiet-toggle').textContent='Begin quiet';stopSound();}
}
function endSession(){if(state.session)state=closeWorkSession(state);}
function openReview(){workMode='practice';state.view='desk';render();persist();$('#work-title').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}
function checkIdea(ideaId){
  if(state.reviewSession){openReview();notify('Your unfinished queue is retained. End it before starting another question.');return;}
  try{const item=state.ideas.find(i=>i.id===ideaId);const candidate=startReviewSession(state,{projectId:item?.projectId??null,maxItems:1,budgetMinutes:5,ideaIds:[ideaId]});candidate.view='desk';if(commitStudio(candidate)){workMode='practice';render();$('#work-title').scrollIntoView({block:'start'});}}catch(error){notify(error.message);}
}
function toggleReviewFocus(){
  if(!state.session)return;
  try{const candidate=structuredClone(state);if(candidate.session.running){candidate.session.elapsedMs=sessionElapsed(candidate.session,Date.now());candidate.session.startedAt=null;candidate.session.running=false;}else{if(!readyActions(candidate.actions).some(a=>a.id===candidate.session.actionId))throw Error('Resolve the blocked action or its prerequisite before resuming.');candidate.session.startedAt=Date.now();candidate.session.running=true;}if(commitStudio(candidate)){render();tick();}}catch(error){notify(error.message);}
}
function planReview(options){
  try{
    if(!options.ideaIds?.length){openAction(null,state.selectedIdeaId,{title:'Apply the idea in a worked example',minutes:30});return;}
    const candidate=structuredClone(state),projectId=options.projectId||candidate.activeProjectId;
    if(candidate.actions.length>=500)throw Error('Export an older action before adding another.');
    candidate.actions.push({id:uid('action'),projectId,title:`Review ${options.ideaIds.length} source question${options.ideaIds.length===1?'':'s'}`,minutes:options.budgetMinutes,remainingMinutes:null,reviewMinutes:options.budgetMinutes,reviewMaxItems:options.maxItems,reviewIdeaIds:[...options.ideaIds],ideaId:null,studyId:null,status:'todo',dependsOn:[],deadline:null,draft:'Compare recalled answers with the original source and your answer criteria. Record what remains unclear.',spentMs:0,completedAt:null});
    candidate.view='week';if(commitStudio(candidate)){render();notify('A review action is ready to plan. No review was performed or given a new due date.');}
  }catch(error){notify(error.message);}
}
function openAgendaAction(actionId,blockId=null){
  try{
    const action=state.actions.find(a=>a.id===actionId);if(!action)return;
    if(!readyActions(state.actions).some(a=>a.id===actionId)){notify('Finish the prerequisite or resolve the blocked action before starting.');return;}
    const allocation=blockId?state.workbench.blocks.find(block=>block.id===blockId&&block.actionId===actionId&&block.status==='planned'):null;
    if(blockId){if(!allocation)throw Error('This reservation is no longer available.');validateBlockPlacement(allocation,state.actions,state.workbench.calendar,state.workbench.blocks);}
    const sessionBudget=allocation?.minutes||action.reviewMinutes||remainingMinutes(action)||action.minutes;
    if(action.reviewMinutes&&state.reviewSession){notify('A source-review session is retained. Resume or end it before starting another planned review.');openReview();return;}
    let candidate=(state.session&&(state.session.actionId!==actionId||state.session.blockId!==blockId))?closeWorkSession(state):structuredClone(state);candidate.activeProjectId=action.projectId;candidate.view='desk';
    if(action.reviewMinutes){candidate=startReviewSession(candidate,{projectId:null,budgetMinutes:sessionBudget,maxItems:action.reviewMaxItems||5,ideaIds:action.reviewIdeaIds});}
    else{const linked=candidate.ideas.find(i=>i.id===action.ideaId);candidate.selectedIdeaId=linked?.id||null;candidate.selectedSourceId=linked?.sourceId||null;}
    if(!candidate.session)candidate.session={actionId:action.id,running:true,startedAt:Date.now(),elapsedMs:0,goalMinutes:sessionBudget,blockId,sessionStartedAt:nowISO()};
    if(commitStudio(candidate)){draftActionId=action.id;workMode=action.reviewMinutes?'practice':'draft';render();$('#work-title').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}
  }catch(error){notify(error.message);}
}
function renderQuietRecord(){
  const session=state.session,action=state.actions.find(a=>a.id===session?.actionId),history=state.workbench.sessions.slice(-5).reverse(),sessionProject=state.projects.find(p=>p.id===action?.projectId);
  $('#quiet-session-record').innerHTML=`${action?`<section class="quiet-outcome paper-surface"><p class="small-label">Close this work session</p><h2>${esc(action.title)}</h2><p>${duration(sessionElapsed(session,Date.now()))} elapsed · ${action.minutes} min original estimate · ${remainingMinutes(action)} min remaining</p>${!session.sessionStartedAt?'<p class="helper-copy">This earlier timer has no retained start date. Its elapsed aggregate will be kept; a historical session will not be invented.</p>':''}<form id="work-session-close"><label>What happened?<select name="outcome"><option value="continue">Needs another session</option><option value="finished">The action is finished</option><option value="blocked">Blocked</option></select></label><label>Your output or result<textarea id="work-session-output" name="output" rows="4" maxlength="60000">${esc(action.draft)}</textarea></label><div class="form-pair"><label>Remaining minutes (optional)<input name="remaining" type="number" min="0" max="10080" value="${action.remainingMinutes??''}" placeholder="Your estimate"></label><label>A concrete next step<input id="work-session-next" name="next" maxlength="500" value="${esc(sessionProject?.closing?.nextAction||'')}"></label></div><p class="helper-copy">Your outcome is a report. Elapsed time does not automatically reduce work, establish attention, or prove learning.</p><button class="primary">Keep outcome & close session</button></form></section>`:''}${history.length?`<details class="quiet-session-history"><summary>Recent work sessions · ${state.workbench.sessions.length} retained</summary>${history.map(s=>`<article><span class="small-label">${esc(new Date(s.endedAt).toLocaleString())} · ${duration(s.durationMs)} elapsed · ${esc(s.outcome)}</span><h3>${esc(s.actionTitle)}</h3><p>${esc(s.output||'No output was recorded.')}</p>${s.nextStep?`<p>Next: ${esc(s.nextStep)}</p>`:''}<button class="text-button" data-act="work-action" data-action-id="${esc(s.actionId)}">Open the action →</button></article>`).join('')}</details>`:''}`;
  $('#work-session-close')?.addEventListener('submit',event=>{event.preventDefault();try{const data=new FormData(event.currentTarget),raw=String(data.get('remaining'));const next=closeWorkSession(state,{outcome:String(data.get('outcome')),output:String(data.get('output')),nextStep:String(data.get('next')),remainingMinutesAfter:raw===''?null:Number(raw)});if(commitStudio(next)){render();notify('Session outcome retained. Estimates and review history remain distinct from elapsed time.');}}catch(error){notify(error.message);}});
}
function toggleFocus(){
  const action=draftAction();if(!action||action.status==='done')return;
  if(!(state.session?.actionId===action.id&&state.session.running)&&!readyActions(state.actions).some(a=>a.id===action.id)){notify('Finish the prerequisite or resolve the blocked action before starting focus.');return;}
  try{
    const candidate=state.session&&state.session.actionId!==action.id?closeWorkSession(state):structuredClone(state);
    if(candidate.session?.actionId===action.id){
      if(candidate.session.running){candidate.session.elapsedMs=sessionElapsed(candidate.session,Date.now());candidate.session.startedAt=null;candidate.session.running=false;}
      else{candidate.session.startedAt=Date.now();candidate.session.running=true;}
    }else candidate.session={actionId:action.id,running:true,startedAt:Date.now(),elapsedMs:0,goalMinutes:remainingMinutes(action)||action.minutes,blockId:null,sessionStartedAt:nowISO()};
    if(commitStudio(candidate)){render();tick();}
  }catch(error){notify(error.message);}
}
function setDone(action){
  try{
    const finished=action.status!=='done';
    const candidate=state.session?.actionId===action.id?closeWorkSession(state,{outcome:finished?'finished':'stopped'}):structuredClone(state);
    const current=candidate.actions.find(a=>a.id===action.id);current.status=finished?'done':'todo';current.completedAt=finished?nowISO():null;
    if(finished){current.remainingMinutes=0;for(const block of candidate.workbench.blocks)if(block.actionId===action.id&&block.status==='planned')block.status='skipped';}
    else if(current.remainingMinutes===0)current.remainingMinutes=null;
    if(commitStudio(candidate)){render();notify(finished?'Marked complete by you. Its draft is still here.':'Action reopened.');}
  }catch(error){notify(error.message);}
}
function openProject(edit=false){
  const current=edit?project():null;
  showDialog(edit?'Edit your project':'Start a project',`<form id="project-form" class="dialog-form"><label>Name<input name="title" maxlength="300" required value="${esc(current?.title||'')}" placeholder="A question, decision or piece of work"></label><label>What do you want to understand or finish?<textarea name="question" rows="3" maxlength="4000" placeholder="Give the work a purpose.">${esc(current?.question||'')}</textarea></label><button class="primary" type="submit">${edit?'Save project':'Create project'}</button></form>`);
  $('#project-form').addEventListener('submit',event=>{
    event.preventDefault();const data=new FormData(event.currentTarget),title=String(data.get('title')).trim(),question=String(data.get('question')).trim();if(!title)return;
    if(edit){current.title=title;current.question=question;}
    else{if(state.projects.length>=30){notify('The desk supports up to 30 projects. Export or remove an older project first.');return;}endSession();const fresh=createState().projects[0];fresh.title=title;fresh.question=question;state.projects.push(fresh);state.activeProjectId=fresh.id;state.selectedSourceId=null;state.selectedIdeaId=null;state.view='desk';draftActionId=null;workMode='ideas';aiResult=null;}
    dialog.close();persist();render();
  });$('#project-form input').focus();
}
function openSource(){
  showDialog('Add a reading','<div id="reading-intake-host"></div>');
  sourceImportAbort=mountReadingIntake($('#reading-intake-host'),{
    getState:()=>state,commitState:commitStudio,projectId:project().id,
    readPdf:(file,options)=>clientServices.readPdf(file,options),
    browserPdf:clientServices.capabilities.pdf==='browser',
    onSaved:item=>{dialog.close();readerMode='read';workMode='ideas';aiResult=null;selectedParagraph=null;render();notify('Reading added. Keep a passage to make a note, review question or task.');}
  });
}
function keepPassage(paragraphId,suggestion=null){
  const src=source(),paragraph=src?.paragraphs.find(item=>item.id===paragraphId);if(!paragraph)return;
  if(state.ideas.length>=500){notify('The desk supports up to 500 kept ideas.');return;}
  const item={id:uid('idea'),projectId:project().id,sourceId:src.id,paragraphId,title:suggestion?.title||paragraph.text.replace(/^#+\s*/,'').slice(0,100),explanation:suggestion?.explanation||'',question:suggestion?.question||'',answerCriteria:'',createdAt:nowISO(),origin:suggestion?'ai':'user'};
  state.ideas.push(item);state.selectedIdeaId=item.id;workMode='ideas';selectedParagraph=paragraphId;persist();renderReader();renderWork();notify(suggestion?'Kept with its source. Check and edit the explanation.':'Passage kept. Add your own explanation.');
}
function openAction(actionId=null,ideaId=null,prefill=null){
  const current=state.actions.find(item=>item.id===actionId);if(current)state.activeProjectId=current.projectId;const ideas=projectIdeas(),actions=projectActions();
  showDialog(current?'Edit action':'Put it to work',`<form id="action-form" class="dialog-form"><label>A concrete output<input name="title" required maxlength="300" value="${esc(current?.title||prefill?.title||'')}" placeholder="Write an argument, solve an example, make a decision…"></label><div class="form-pair"><label>Estimate in minutes<input name="minutes" type="number" min="1" max="10080" required value="${current?.minutes||prefill?.minutes||30}"></label><label>Finish by (optional)<input name="deadline" type="date" value="${esc(current?.deadline||'')}"></label></div><label>Remaining effort (optional minutes)<input name="remainingMinutes" type="number" min="0" max="10080" value="${current?.remainingMinutes??''}" placeholder="Your revised estimate; elapsed time does not subtract it"></label><label>Attached idea<select name="ideaId"><option value="">No attached idea</option>${ideas.map(item=>`<option value="${esc(item.id)}" ${(current?.ideaId||ideaId)===item.id?'selected':''}>${esc(item.title)}</option>`).join('')}</select></label><label>Status<select name="status">${['todo','blocked','done'].map(status=>`<option value="${status}" ${current?.status===status?'selected':''}>${{todo:'To do',blocked:'Blocked',done:'Done'}[status]}</option>`).join('')}</select></label>${actions.filter(item=>item.id!==actionId).length?`<fieldset class="dependency-list"><legend>Needs these actions first</legend>${actions.filter(item=>item.id!==actionId).map(item=>`<label class="check-label"><input name="dependencies" type="checkbox" value="${esc(item.id)}" ${current?.dependsOn.includes(item.id)?'checked':''}><span>${esc(item.title)}</span></label>`).join('')}</fieldset>`:''}<p class="helper-copy">The week splits longer work across days and counts rest between blocks. Blocked actions and impossible deadlines stay visible.</p><p id="action-error" class="form-error" role="alert"></p><div class="dialog-actions"><button type="submit" class="primary">Save action</button>${current?'<button type="button" id="delete-action" class="text-button danger">Delete action</button>':''}</div></form>`);
  $('#action-form').addEventListener('submit',event=>{
    event.preventDefault();const data=new FormData(event.currentTarget),title=String(data.get('title')).trim(),minutes=Number(data.get('minutes')),status=String(data.get('status'));
    if(!title||!Number.isInteger(minutes)||minutes<1||minutes>10080)return;
    const revised=String(data.get('remainingMinutes')||'');const patch={title,minutes,status,remainingMinutes:revised===''?null:Number(revised),ideaId:String(data.get('ideaId'))||null,deadline:String(data.get('deadline'))||null,dependsOn:data.getAll('dependencies').map(String),completedAt:status==='done'?(current?.completedAt||nowISO()):null};
    try{
      const candidate=current&&state.session?.actionId===current.id&&status==='done'?closeWorkSession(state,{outcome:'finished'}):structuredClone(state);
      if(current){if(candidate.session?.actionId===current.id)candidate.session.goalMinutes=minutes;Object.assign(candidate.actions.find(a=>a.id===current.id),patch);}else{if(candidate.actions.length>=500){$('#action-error').textContent='The desk supports up to 500 actions.';return;}candidate.actions.push({id:uid('action'),projectId:project().id,...patch,studyId:prefill?.studyId||null,draft:'',spentMs:0,reviewMinutes:null,reviewIdeaIds:null,reviewMaxItems:null});}
      if(status==='done'){const changed=candidate.actions.find(a=>a.id===current?.id)||candidate.actions.at(-1);changed.remainingMinutes=0;for(const block of candidate.workbench.blocks)if(block.actionId===changed.id&&block.status==='planned')block.status='skipped';}
      if(commitStudio(candidate)){dialog.close();render();notify('Action saved. Accepted reservations remain; propose again to use changed estimates.');}
    }catch(error){$('#action-error').textContent=error.message;}
  });
  if(current)$('#delete-action').addEventListener('click',()=>{if(state.workbench.blocks.some(b=>b.actionId===current.id)||state.workbench.sessions.some(w=>w.actionId===current.id)){notify('This action has retained allocations or session evidence. Keep it so those records remain inspectable.');return;}confirmAction('Delete this action?',`Its draft and focus time will be removed. Other actions will no longer require “${current.title}”.`,()=>{if(state.session?.actionId===current.id)state.session=null;state.actions=state.actions.filter(item=>item.id!==current.id);state.workbench.backlogIds=state.workbench.backlogIds.filter(id=>id!==current.id);for(const action of state.actions)action.dependsOn=action.dependsOn.filter(id=>id!==current.id);if(draftActionId===current.id)draftActionId=null;persist();render();},'Delete action');});
  $('#action-form input').focus();
}
async function askAssistant(mode,question=''){
  if(!clientServices.capabilities.assistants||aiBusy||!provider.available||!source())return;
  const src=source(),requestSourceId=src.id,requestState=state;aiBusy=true;aiResult=null;aiAbort=new AbortController();renderAssistant();
  try{
    const paragraphId=selectedParagraph||(idea()?.sourceId===src.id?idea().paragraphId:undefined);
    const result=await clientServices.assist({providerId,mode,source:{title:src.title,paragraphs:src.paragraphs.map(({id,text})=>({id,text}))},question,paragraphId},{signal:aiAbort.signal});
    if(state===requestState&&source()?.id===requestSourceId)aiResult={...result,sourceId:requestSourceId};else notify('The request finished for a different source. Select it and ask again to keep its context together.');
  }catch(error){if(source()?.id===requestSourceId)aiResult={error:error.name==='AbortError'?'Request cancelled. Your work is intact.':error.message};}finally{aiBusy=false;aiAbort=null;renderAssistant();}
}
function openData(){
  const rawRecovery=recoveryRaw||(()=>{try{return storage.getItem(SAVE_KEY+'.unreadable')||'';}catch{return '';}})();
  showDialog('Back up or restore your workspace',`<p class="helper-copy">A backup keeps your projects, reading text, notes, answers, drafts, calendar and lighting studies together. Save one before clearing browser storage or moving to another computer.</p>${loaded.notice?`<p class="form-error">${esc(loaded.notice)}</p>`:''}<div class="backup-options"><section><h3>Save a copy</h3><p>Download the whole workspace as a JSON file. Keep it somewhere you trust; it contains your text.</p><button id="export-data" class="primary">Save backup (.json)</button></section><section><h3>Restore a saved copy</h3><p>Choose a previous Afterlight workspace backup. Its links are checked before you confirm replacing this browser’s workspace.</p><button id="import-data" class="secondary">Restore backup (.json)</button></section></div><p id="backup-error" class="form-error" role="alert"></p>${rawRecovery?'<button id="export-recovery" class="secondary">Download unreadable record</button>':''}<div class="backup-reading"><h3>Want to bring in a PDF?</h3><p>Use Add a reading. It extracts text for reading, notes and questions; it does not replace your workspace.</p><button data-open-source class="text-button">Add a reading →</button></div><p class="helper-copy">Week downloads a calendar (.ics) for a calendar app. Studio downloads calculated lighting readings (.csv) for Excel. Neither is a workspace backup.</p><hr><button data-act="open-example" class="text-button">Add an example project</button>`);
  $('#export-data').addEventListener('click',()=>download(`afterlight-${todayISO()}.json`,JSON.stringify({format:'afterlight',exportedAt:nowISO(),state:validateState(state)},null,2)));
  $('#import-data').addEventListener('click',()=>$('#import-state-file').click());
  if(rawRecovery)$('#export-recovery').addEventListener('click',()=>download('afterlight-unreadable-record.json',rawRecovery));
}
function stopSound(){
  try{audioNode?.stop();}catch{}audioNode=null;audioGain?.disconnect();audioGain=null;
  $('#sound-button').setAttribute('aria-pressed','false');$('#sound-button').textContent='Rain sound · off';
}
async function toggleSound(){
  if(audioNode){stopSound();return;}
  const Context=window.AudioContext||window.webkitAudioContext;if(!Context){notify('This browser does not support the rain sound.');return;}
  audioContext=audioContext||new Context();await audioContext.resume();
  const buffer=audioContext.createBuffer(1,audioContext.sampleRate*4,audioContext.sampleRate),channel=buffer.getChannelData(0);let previous=0;
  for(let i=0;i<channel.length;i++){previous=(previous+0.02*(Math.random()*2-1))/1.02;channel[i]=previous*3.5;}
  audioNode=audioContext.createBufferSource();audioNode.buffer=buffer;audioNode.loop=true;audioGain=audioContext.createGain();audioGain.gain.value=0.16;audioNode.connect(audioGain);audioGain.connect(audioContext.destination);audioNode.start();$('#sound-button').setAttribute('aria-pressed','true');$('#sound-button').textContent='Rain sound · on';
}
function changePlan(){
  const plan={...project().plan,dailyMinutes:Number($('#daily-budget').value),startDate:$('#plan-date').value,startTime:$('#plan-time').value,restMinutes:Number($('#plan-rest').value)};
  try{scheduleActions(projectActions(),plan);project().plan=plan;persist();renderWeek();}catch(error){notify(error.message);renderWeek();}
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  try{
    if(button.dataset.view){if(button.dataset.view!=='quiet')stopSound();goView(button.dataset.view);return;}
    if(button.hasAttribute('data-open-source')){openSource();return;}
    if(button.dataset.work){workMode=button.dataset.work;renderWork();tick();return;}
    if(button.dataset.reader){readerMode=button.dataset.reader;renderReader();return;}
    if(button.dataset.assist){await askAssistant(button.dataset.assist);return;}
    if(button.dataset.rate){
      const current=idea();if(!practiceRevealed||!practiceAnswer.trim()||!current)return;
      if(state.attempts.length>=2000){notify('The desk supports up to 2,000 practice attempts.');return;}
      const createdAt=nowISO();state.attempts.push({id:uid('attempt'),ideaId:current.id,answer:practiceAnswer,rating:button.dataset.rate,createdAt,dueAt:reviewDue(button.dataset.rate,createdAt)});practiceAnswer='';practiceRevealed=false;persist();renderWork();notify('Answer saved with your assessment and revisit date.');return;
    }
    const action=state.actions.find(item=>item.id===button.dataset.actionId),note=state.ideas.find(item=>item.id===button.dataset.ideaId);
    switch(button.dataset.act){
      case 'close-dialog':dialog.close();break;
      case 'return-study':resumeStudy(button.dataset.studyId);break;
      case 'due-idea':state.selectedIdeaId=note.id;state.selectedSourceId=note.sourceId;practiceAnswer='';practiceRevealed=false;workMode='practice';persist();renderWork();break;
      case 'keep':keepPassage(button.dataset.paragraphId);break;
      case 'select-idea':state.selectedIdeaId=note.id;state.selectedSourceId=note.sourceId;selectedParagraph=note.paragraphId;persist();renderWork();break;
      case 'evidence':goEvidence(note.id);break;
      case 'practice-idea':checkIdea(note.id);break;
      case 'plan-idea':openAction(null,note.id);break;
      case 'new-action':openAction();break;
      case 'edit-action':openAction(action.id);break;
      case 'toggle-done':case 'complete-action':if(action)setDone(action);else if(draftAction())setDone(draftAction());break;
      case 'work-action':{const candidate=state.session&&state.session.actionId!==action.id?closeWorkSession(state):structuredClone(state);candidate.activeProjectId=action.projectId;const linked=candidate.ideas.find(i=>i.id===action.ideaId);candidate.selectedIdeaId=linked?.id||null;candidate.selectedSourceId=linked?.sourceId||null;candidate.view='desk';if(commitStudio(candidate)){draftActionId=action.id;workMode='draft';render();$('#draft-editor')?.focus({preventScroll:true});}break;}
      case 'focus-toggle':toggleFocus();break;
      case 'review-focus-toggle':toggleReviewFocus();break;
      case 'move-action':{const items=projectActions(),index=items.indexOf(action),next=index+(button.dataset.direction==='up'?-1:1);if(next<0||next>=items.length)break;const left=state.actions.indexOf(action),right=state.actions.indexOf(items[next]);[state.actions[left],state.actions[right]]=[state.actions[right],state.actions[left]];persist();renderWeek();break;}
      case 'reveal':if(!practiceAnswer.trim()){notify('Write an answer before revealing the reference.');$('#practice-answer').focus();}else{practiceRevealed=true;renderWork();}break;
      case 'delete-idea':if(state.reviewSession?.ideaIds.includes(note.id)||state.actions.some(a=>a.reviewIdeaIds?.includes(note.id))){notify('This question belongs to a retained review session or plan. End that session or keep its source link.');break;}confirmAction('Delete this idea?', 'Its practice attempts will be removed. Attached actions and drafts will remain, without this idea link.',()=>{state.ideas=state.ideas.filter(item=>item.id!==note.id);state.attempts=state.attempts.filter(item=>item.ideaId!==note.id);for(const item of state.actions)if(item.ideaId===note.id)item.ideaId=null;if(state.selectedIdeaId===note.id)state.selectedIdeaId=null;persist();render();},'Delete idea');break;
      case 'read-source':state.view='desk';selectSource(button.dataset.sourceId);break;
      case 'delete-source':{const src=state.sources.find(item=>item.id===button.dataset.sourceId);const sourceIdeas=state.ideas.filter(i=>i.sourceId===src.id).map(i=>i.id);if(state.reviewSession?.ideaIds.some(id=>sourceIdeas.includes(id))||state.actions.some(a=>a.reviewIdeaIds?.some(id=>sourceIdeas.includes(id)))){notify('This source belongs to a retained review session or plan. Keep it so its questions remain inspectable.');break;}if(state.studio.studies.some(study=>study.decision?.sourceRefs.some(ref=>ref.sourceId===src.id))){notify('This source is retained as decision evidence. Keep it so the study can be checked later.');break;}confirmAction('Delete this source?',`“${src.title}”, its kept ideas and practice attempts will be removed. Action drafts will remain without those idea links.`,()=>{const removed=new Set(state.ideas.filter(item=>item.sourceId===src.id).map(item=>item.id));state.sources=state.sources.filter(item=>item.id!==src.id);state.ideas=state.ideas.filter(item=>!removed.has(item.id));state.attempts=state.attempts.filter(item=>!removed.has(item.ideaId));for(const item of state.actions)if(removed.has(item.ideaId))item.ideaId=null;if(state.selectedSourceId===src.id)state.selectedSourceId=null;if(removed.has(state.selectedIdeaId))state.selectedIdeaId=null;aiResult=null;persist();render();},'Delete source');break;}
      case 'cancel-ai':aiAbort?.abort();break;
      case 'keep-ai':if(aiResult?.sourceId===source()?.id){const item=aiResult.ideas[Number(button.dataset.aiIndex)];keepPassage(item.paragraphId,item);}break;
      case 'ai-citation':{const cite=aiResult?.citations[Number(button.dataset.citation)];if(cite){selectedParagraph=cite.paragraphId;readerMode='read';renderReader();document.querySelector(`[data-paragraph="${cite.paragraphId}"]`)?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}break;}
      case 'open-example':{if(state.projects.length>=30||state.sources.length>=100||state.ideas.length>498||state.actions.length>496){notify('There is not enough room for an example. Export or remove older records first.');break;}const candidate=state.session?closeWorkSession(state):structuredClone(state),sample=validateState(createExampleState());candidate.projects.push(...sample.projects);candidate.sources.push(...sample.sources);candidate.ideas.push(...sample.ideas);candidate.actions.push(...sample.actions);candidate.activeProjectId=sample.activeProjectId;candidate.selectedSourceId=sample.selectedSourceId;candidate.selectedIdeaId=sample.selectedIdeaId;candidate.view='desk';if(commitStudio(candidate)){workMode='ideas';aiResult=null;dialog.close();render();}break;}
    }
  }catch(error){notify(error.message||'This action could not be completed.');}
});
document.addEventListener('submit',event=>{
  const id=event.target.dataset.editIdea;if(!id)return;event.preventDefault();const item=state.ideas.find(entry=>entry.id===id),data=new FormData(event.target);item.title=String(data.get('title')).trim();item.explanation=String(data.get('explanation'));item.question=String(data.get('question'));item.answerCriteria=String(data.get('answerCriteria')||'');persist();renderWork();notify('Idea saved with the original passage.');
});
document.addEventListener('input',event=>{
  const ideaForm=event.target.closest('[data-edit-idea]');if(ideaForm){const item=state.ideas.find(entry=>entry.id===ideaForm.dataset.editIdea);if(item){const data=new FormData(ideaForm),title=String(data.get('title')).trim();if(title)item.title=title;item.explanation=String(data.get('explanation'));item.question=String(data.get('question'));item.answerCriteria=String(data.get('answerCriteria')||'');persist();}}
  if(['closing-note','closing-next'].includes(event.target.id)){project().closing={note:$('#closing-note').value,nextAction:$('#closing-next').value,updatedAt:nowISO()};const saved=persist();$('#closing-status').textContent=saved?'Handoff saved as you write.':'Handoff is in this session. Export a copy.';}
  if(event.target.id==='practice-answer')practiceAnswer=event.target.value;
  if(event.target.id==='work-session-output'){const action=state.actions.find(a=>a.id===state.session?.actionId);if(action){action.draft=event.target.value;persist();}}
  if(event.target.id==='work-session-next'){const action=state.actions.find(a=>a.id===state.session?.actionId),owner=state.projects.find(p=>p.id===action?.projectId);if(owner){owner.closing={...owner.closing,nextAction:event.target.value,updatedAt:nowISO()};persist();}}
  if(event.target.id==='draft-editor'){const action=draftAction();if(action){action.draft=event.target.value;const saved=persist();$('#draft-save-status').textContent=saved?'Draft saved as you write.':'Draft is in this session. Export a copy.';}}
  if(event.target.id==='library-search')renderLibrary();
  if(event.target.id==='daily-budget')$('#budget-value').textContent=`${event.target.value} min`;
});
$('#project-select').addEventListener('change',event=>{endSession();state.activeProjectId=event.target.value;state.selectedSourceId=null;state.selectedIdeaId=null;draftActionId=null;aiResult=null;practiceAnswer='';practiceRevealed=false;persist();render();});
$('#source-select').addEventListener('change',event=>selectSource(event.target.value));
document.addEventListener('change',event=>{
  if(event.target.id==='practice-idea'){state.selectedIdeaId=event.target.value;practiceAnswer='';practiceRevealed=false;persist();renderWork();}
  if(event.target.id==='draft-action'){if(state.session?.actionId!==event.target.value)endSession();draftActionId=event.target.value;persist();renderWork();tick();}
  if(['daily-budget','plan-date','plan-time','plan-rest'].includes(event.target.id))changePlan();
});
$('#new-project-button').addEventListener('click',()=>openProject());$('#edit-project-button').addEventListener('click',()=>openProject(true));$('#new-action-button').addEventListener('click',()=>openAction());
$('#appearance-button').addEventListener('click',()=>{state.settings.night=!state.settings.night;persist();render();});$('#data-button').addEventListener('click',openData);
$('#source-details-button').addEventListener('click',()=>{const src=source();if(src)showDialog('Reading details',`<dl class="detail-list"><dt>Title</dt><dd>${esc(src.title)}</dd><dt>Kind</dt><dd>${esc(src.kind)}</dd><dt>Added</dt><dd>${esc(new Date(src.createdAt).toLocaleString())}</dd><dt>Passages</dt><dd>${src.paragraphs.length}</dd></dl><p class="helper-copy">This reading text is kept as added. Ideas cite its exact passage. ${src.kind==='pdf'?'For a PDF, this is the extracted text; the PDF file and page layout are not retained.':''} To change it, add a revised copy.</p>`,`<button id="download-source" class="primary">Download reading text</button>`);$('#download-source')?.addEventListener('click',()=>download('afterlight-source.txt',src.text,'text/plain'));});
$('#assistant-form').addEventListener('submit',event=>{event.preventDefault();const question=$('#assistant-question').value.trim();if(question)askAssistant('question',question);});
$('#provider-select').addEventListener('change',event=>{providerId=event.target.value;provider=providers.find(p=>p.id===providerId)||provider;aiResult=null;renderAssistant();});$('#provider-connect').addEventListener('click',openProviderConnection);
$('#replan-button').addEventListener('click',()=>{if(state.workbench.calendar){const next=structuredClone(state);next.workbench.calendar.startDate=todayISO();if(commitStudio(next))render();notify('The planning window now starts today. Accepted session history is retained; propose new times when ready.');}else{notify('Adopt a shared window first. Earlier project plans remain unchanged.');}});
$('#calendar-button').addEventListener('click',()=>{try{const calendar=state.workbench.calendar,blocks=state.workbench.blocks.filter(b=>b.status==='planned');if(!calendar||!blocks.length){notify('Accept or place a session before exporting the shared calendar.');return;}download('afterlight-week.ics',workspaceCalendarExport(blocks,state.actions,calendar,'Afterlight shared week'),'text/calendar;charset=utf-8');notify('Exported accepted sessions with stable identities. No calendar sync or reminder was configured.');}catch(error){notify(error.message);}});
$('#closing-form').addEventListener('submit',event=>{event.preventDefault();project().closing={note:$('#closing-note').value,nextAction:$('#closing-next').value,updatedAt:nowISO()};persist();$('#closing-status').textContent='Handoff saved. Your draft and starting point will be here.';$('#handoff-banner').hidden=!project().closing.nextAction;notify('Handoff saved.');});
$('#closing-plan-button').addEventListener('click',()=>{const next=$('#closing-next').value.trim();if(!next){notify('Write a next step first.');$('#closing-next').focus();return;}project().closing={note:$('#closing-note').value,nextAction:next,updatedAt:nowISO()};persist();const title=next.slice(0,300),existing=projectActions().find(item=>item.title===title&&item.status!=='done');if(existing)openAction(existing.id);else openAction(null,null,{title,minutes:30,studyId:null});});
$('#quiet-duration').addEventListener('change',event=>{const durationMinutes=Number(event.target.value);state.quiet={durationMinutes,remainingMs:durationMinutes*60000,running:false,endsAt:null};stopSound();persist();renderQuiet();tick();});
$('#quiet-toggle').addEventListener('click',()=>{let quiet=state.quiet;if(quiet?.running){quiet.remainingMs=Math.max(0,quiet.endsAt-Date.now());quiet.running=false;quiet.endsAt=null;stopSound();}else{const durationMinutes=quiet?.durationMinutes||Number($('#quiet-duration').value);quiet=state.quiet={durationMinutes,remainingMs:quiet?.remainingMs||durationMinutes*60000,running:true,endsAt:Date.now()+(quiet?.remainingMs||durationMinutes*60000)};}$('#quiet-caption').textContent=quiet.running?'You can leave the desk for a while.':'The quiet timer is paused.';persist();renderQuiet();tick();});
$('#sound-button').addEventListener('click',()=>toggleSound().catch(error=>notify(error.message)));
$('#about-button').addEventListener('click',()=>showDialog('Afterlight',`<p class="about-lead">Knowledge you can predict, test, explain and use.</p><p class="helper-copy">Start with light for a shared table. Save two arrangements, compare their calculated readings at the same points, then keep a choice, its reason and a next check. Use distance, shadow and balance commissions to investigate the rules. Desk retains your evidence and explanation, Library keeps sources, Week schedules a real check, and Quiet keeps a starting point for later.</p><p class="helper-copy">The shared agenda distinguishes free time, commitments, proposed sessions and actual work. Your remaining estimate stays separate from elapsed time. Practice dates are a simple 1/3/7-day self-assessment rule. Neither proves mastery or predicts your productivity.</p><p class="helper-copy">Inspired by the connected reading workflow in <a href="https://github.com/beltromatti/get-it" target="_blank" rel="noreferrer">Get It</a>. Afterlight is one product; Midnight Academy is the competition setting. The lab uses ideal point lamps and direct rays, with no ambient light or reflections. Targets are authored exercises, not lighting standards. Night appearance and quiet time are optional.</p><p class="helper-copy">${clientServices.capabilities.assistants?'Sources and drafts are stored in this browser. Assistance uses your selected CLI or API provider only after an explicit request. Provider keys remain in local server memory.':'This hosted edition stores sources and drafts in this browser and extracts PDFs here. It has no assistant or provider connection. Export a backup before clearing browser storage.'} Rain is synthesized locally; no background notification or sleep tracking is performed.</p>`));
$('#import-state-file').addEventListener('change',async event=>{const file=event.target.files[0];event.target.value='';if(!file)return;const backupError=$('#backup-error');if(backupError)backupError.textContent='';try{if(/\.pdf$/i.test(file.name)||file.type==='application/pdf')throw Error('To load a PDF, choose Add a reading in Desk or Library. Restore accepts an Afterlight workspace backup (.json).');if(file.size>25_000_000)throw Error('This workspace backup exceeds 25 MB.');const raw=JSON.parse(await file.text()),candidate=validateState(raw.format==='afterlight'?raw.state:raw);confirmAction('Restore and replace this workspace?',`Restore ${candidate.projects.length} project${candidate.projects.length===1?'':'s'}, ${candidate.studio.studies.length} studies, ${candidate.sources.length} readings and ${candidate.actions.length} actions from “${file.name}”. Save a backup of your current workspace first if you want to keep both.`,()=>{if(!commitStudio(candidate))return;aiAbort?.abort();stopSound();workMode='ideas';readerMode='read';draftActionId=state.session?.actionId||null;practiceAnswer='';practiceRevealed=false;selectedParagraph=null;aiResult=null;persist();render();notify('Workspace restored. All reading and study links were checked.');},'Restore workspace');}catch(error){const message=`Restore refused: ${error.message} Your current workspace is intact.`,field=$('#backup-error');if(field&&dialog.open){field.textContent=message;field.scrollIntoView({block:'nearest'});}else notify(message);}});
window.addEventListener('pagehide',stopSound);
render();
if(loaded.notice){$('#save-status').textContent='Saved record needs attention';$('#save-status').classList.add('save-warning');notify(loaded.notice);}
else persist();
setInterval(tick,1000);
refreshProviders();


