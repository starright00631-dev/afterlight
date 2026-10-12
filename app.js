import {uid,todayISO,localStudyDate,dueIdeas,addDays,splitSource,createState,createExampleState,scheduleActions,sessionElapsed,reviewDue} from './domain.js';
import {SAVE_KEY,LEGACY_SAVE_KEY,validateState,loadState,saveState} from './persistence.js';
import {calendarExport} from './calendar.js';
import {createLabState} from './optics.js';
import {mountStudio} from './studio-ui.js';
import {activeStudy,studyReportText} from './studies.js';
import {createClientServices,HOSTED_ASSISTANT_MESSAGE,checkCancelled} from './client-services.js';

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
let recoveryRaw=loaded.recoveryRaw||'';if(loaded.notice&&!recoveryRaw){try{recoveryRaw=storage.getItem(SAVE_KEY)||storage.getItem(SAVE_KEY+'.unreadable')||storage.getItem(LEGACY_SAVE_KEY)||'';}catch{}}
try{if(!storage.getItem(SAVE_KEY)&&!storage.getItem(LEGACY_SAVE_KEY)&&!loaded.notice){state.projects[0].title='Light for a shared table';state.projects[0].question='How can both reading places meet the light levels I choose?';state.view='lab';}}catch{}
state.lab=state.lab||createLabState();
let workMode='ideas',readerMode='read',selectedParagraph=null,practiceRevealed=false,practiceAnswer='',practiceIdeaId=null,draftActionId=state.session?.actionId||null;
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
function readStudySource(study){try{endSession();const candidate=structuredClone(state),src=ensureStudySource(candidate,study);candidate.activeProjectId=study.projectId;candidate.selectedSourceId=src.id;candidate.selectedIdeaId=null;candidate.view='desk';if(!commitStudio(candidate))return;workMode='ideas';readerMode='read';selectedParagraph=null;aiResult=null;render();}catch(error){notify(error.message);}}
function useStudyDecision(study){try{
  if(!study.decision)throw Error('Keep an arrangement and its reason first.');endSession();const candidate=structuredClone(state),current=candidate.studio.studies.find(s=>s.id===study.id),modelSource=ensureStudySource(candidate,current),modelParagraph=modelSource.paragraphs.find(p=>p.text.includes('For an ideal point lamp'))||modelSource.paragraphs[0];
  if(!current.decision.sourceRefs.some(ref=>ref.sourceId===modelSource.id&&ref.paragraphId===modelParagraph.id))current.decision.sourceRefs.push({sourceId:modelSource.id,paragraphId:modelParagraph.id});
  const text=studyReportText(current,{sources:candidate.sources});let report=candidate.sources.find(s=>s.projectId===current.projectId&&s.kind==='study'&&s.text===text);
  if(!report){if(candidate.sources.length>=100||candidate.sources.reduce((sum,s)=>sum+s.text.length,0)+text.length>10000000)throw Error('Export or remove an older source before keeping this report.');report={id:uid('source'),projectId:current.projectId,title:`Study · ${current.title}`.slice(0,300),kind:'study',text,paragraphs:splitSource(text),createdAt:nowISO()};candidate.sources.push(report);}
  let note=candidate.ideas.find(i=>i.sourceId===report.id);if(!note){if(candidate.ideas.length>=500)throw Error('Export or remove an older idea before keeping this decision.');const paragraph=report.paragraphs.find(p=>p.text.includes(current.decision.reason))||report.paragraphs[0];note={id:uid('idea'),projectId:current.projectId,sourceId:report.id,paragraphId:paragraph.id,title:`Decision · ${current.title}`.slice(0,300),explanation:current.decision.reason,question:'Which assumption would a real measurement test?',createdAt:nowISO(),origin:'user'};candidate.ideas.push(note);}
  candidate.activeProjectId=current.projectId;candidate.selectedSourceId=report.id;candidate.selectedIdeaId=note.id;candidate.view='desk';if(!commitStudio(candidate))return;workMode='ideas';readerMode='read';selectedParagraph=note.paragraphId;aiResult=null;render();notify('Your study report and reason are kept together in Desk.');
}catch(error){notify(error.message);}}
function measurementDraft(study){const chosen=study.decision&&study.alternatives.find(a=>a.id===study.decision.chosenId);return [`Study: ${study.title}`,`Study ID: ${study.id}`,`Arrangement: ${chosen?.name||'Choose a saved arrangement before measuring'}`,`Reason: ${study.decision?.reason||''}`,`Next check: ${study.decision?.nextCheck||''}`,'',...(chosen?.readings.detectors||[]).map(point=>`${point.label} · calculated ${point.lux.toFixed(2)} lx · observed: ___ lx`),'','Instrument / method:','Date and time:','Ambient conditions and arrangement changes:','What differs from the ideal model?'].join('\n');}
function planStudyCheck(study){
  if(!study.projectId){notify('Associate this recovered study with a project before planning its check.');return;}
  const suggestion=study.decision?.nextCheck||`Measure the reading places in ${study.title}`;
  showDialog('Plan a real check',`<form id="study-check-form" class="dialog-form"><p class="helper-copy">A concrete next step for ${esc(study.title)}. Choose an estimate; Week uses it to show what fits.</p><label>What will you check?<input name="title" required maxlength="300" value="${esc(suggestion.slice(0,300))}"></label><label>Estimated minutes<input name="minutes" type="number" min="1" max="720" value="15" required></label><label>Deadline, if any<input name="deadline" type="date"></label><button class="primary">Add to Week</button></form>`);
  $('#study-check-form').addEventListener('submit',event=>{event.preventDefault();try{endSession();const values=new FormData(event.currentTarget),candidate=structuredClone(state),current=candidate.studio.studies.find(s=>s.id===study.id),title=String(values.get('title')).trim();if(candidate.actions.length>=500)throw Error('Export or remove an older action before adding another.');const existing=candidate.actions.find(a=>a.studyId===study.id&&a.title===title&&a.status!=='done');if(!existing)candidate.actions.push({id:uid('action'),projectId:study.projectId,studyId:study.id,title,minutes:Number(values.get('minutes')),ideaId:null,status:'todo',dependsOn:[],deadline:String(values.get('deadline'))||null,draft:measurementDraft(current),spentMs:0,completedAt:null});candidate.activeProjectId=study.projectId;candidate.selectedSourceId=null;candidate.selectedIdeaId=null;candidate.view='week';if(!commitStudio(candidate))return;dialog.close();render();notify('Your measurement check is in Week, linked to this study.');}catch(error){notify(error.message);}});
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
  const next=projectActions().find(item=>item.status==='todo');
  $('#desk-next').textContent=next?`Next in the plan: ${next.title} · ${next.minutes} min`:'Turn a kept idea into a concrete action when you are ready.';
  $('#footer-context').textContent=state.view==='lab'?'Calculated on this computer · saved in this browser.':project().example?'Example material · replace it with your own.':'Your own material · saved in this browser.';
}
function renderReader(){
  const current=source();if(current)state.selectedSourceId=current.id;
  const referenceHidden=workMode==='practice'&&!practiceRevealed&&Boolean(idea());
  for(const button of document.querySelectorAll('[data-reader]'))button.disabled=referenceHidden;
  $('#source-select').disabled=!current;$('#source-details-button').disabled=!current;
  $('#source-select').innerHTML=current?projectSources().map(item=>`<option value="${esc(item.id)}" ${item.id===current.id?'selected':''}>${esc(item.title)}</option>`).join(''):'<option>No sources yet</option>';
  for(const button of document.querySelectorAll('[data-reader]'))button.setAttribute('aria-pressed',String(button.dataset.reader===readerMode));
  $('#reader-content').hidden=readerMode==='map';$('#source-map').hidden=readerMode!=='map';
  if(!current){$('#reader-content').innerHTML='<div class="empty-state"><div class="empty-illustration" aria-hidden="true">↗</div><h3>Start with something real.</h3><p>Add a reading, project notes, or an unfinished thought. Keep its words beside the work you make.</p><button data-open-source class="primary">Add a source</button><button data-act="open-example" class="text-button">Open the example desk</button></div>';$('#source-map').innerHTML='';$('#source-meta').textContent='Text, Markdown or digital PDF';return;}
  if(referenceHidden){$('#reader-content').hidden=false;$('#source-map').hidden=true;$('#reader-content').innerHTML='<div class="empty-state"><span class="small-label">Reference put aside</span><h3>Start with what you remember.</h3><p>Write your answer in the practice pane, then reveal the original passage to compare. Switch to Ideas or Draft whenever you want to read again.</p></div>';$('#source-meta').textContent='The source is intact. It returns when you reveal the reference.';return;}
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
  if(workMode==='practice'&&practiceIdeaId!==idea()?.id){practiceAnswer='';practiceRevealed=false;practiceIdeaId=idea()?.id||null;}
  renderReader();
  renderAssistant();
  for(const button of document.querySelectorAll('[data-work]')){button.classList.toggle('active',button.dataset.work===workMode);button.setAttribute('aria-pressed',String(button.dataset.work===workMode));}
  $('#idea-count').textContent=projectIdeas().length||'';
  if(workMode==='practice'){renderPractice();return;}if(workMode==='draft'){renderDraft();return;}
  $('#work-content').innerHTML=`<div class="work-intro"><p>Keep a passage. Say what it means. Decide what you can do with it.</p></div>${projectIdeas().length?projectIdeas().map(item=>{
    const src=state.sources.find(entry=>entry.id===item.sourceId),paragraph=src?.paragraphs.find(entry=>entry.id===item.paragraphId);
    const selected=state.selectedIdeaId===item.id;
    return `<article class="note-card ${selected?'selected':''}" data-idea="${esc(item.id)}"><div class="note-top"><button data-act="select-idea" data-idea-id="${esc(item.id)}" class="note-title">${esc(item.title)}</button><button class="icon-button" data-act="delete-idea" data-idea-id="${esc(item.id)}" aria-label="Delete idea ${esc(item.title)}">×</button></div><button class="citation-button" data-act="evidence" data-idea-id="${esc(item.id)}">${esc(src?.title)} · §${src?.paragraphs.findIndex(p=>p.id===item.paragraphId)+1} ↗</button><blockquote class="note-quote">${esc(paragraph?.text?.slice(0,260))}${(paragraph?.text.length||0)>260?'…':''}</blockquote>${selected?`<form class="note-form" data-edit-idea="${esc(item.id)}"><label>Idea title<input name="title" value="${esc(item.title)}" maxlength="160" required></label><label>In your words<textarea name="explanation" rows="3" maxlength="6000" placeholder="What does this mean for your question?">${esc(item.explanation)}</textarea></label><label>A question to check later<input name="question" value="${esc(item.question)}" maxlength="1000" placeholder="Can you explain or apply this without the source?"></label><button class="secondary" type="submit">Save idea</button></form>`:`<p class="note-explanation">${esc(item.explanation||'Write what this passage means to you.')}</p>`}<div class="note-actions"><button data-act="practice-idea" data-idea-id="${esc(item.id)}" class="text-button">Check understanding</button><button data-act="plan-idea" data-idea-id="${esc(item.id)}" class="text-button">+ Put it to work</button></div><span class="note-meta">${item.origin==='ai'?'Assistant suggestion · review against the source':'Your note'}</span></article>`;
  }).join(''):'<div class="empty-state"><h3>A place for your thinking.</h3><p>Use + beside a source passage. Then write an explanation or question in your own words.</p></div>'}`;
}
function renderPractice(){
  const queue=dueIdeas(projectIdeas(),state.attempts),queueHTML=queue.length?`<div class="review-queue" aria-label="Ideas to revisit">${queue.map(item=>`<button data-act="due-idea" data-idea-id="${esc(item.id)}">${esc(item.title)}<small>${state.attempts.some(attempt=>attempt.ideaId===item.id)?'Due for your own check':'First attempt'}</small></button>`).join('')}</div>`:'<p class="helper-copy">No ideas are due today. You can still choose any idea to practise.</p>';
  const current=idea();if(!current){$('#work-content').innerHTML='<div class="empty-state"><h3>Keep an idea first.</h3><p>A practice attempt starts with a real passage. You write an answer, compare it with the source, and choose when to revisit it.</p></div>';return;}
  if(practiceIdeaId!==current.id){practiceAnswer='';practiceRevealed=false;practiceIdeaId=current.id;}
  state.selectedIdeaId=current.id;
  const src=state.sources.find(item=>item.id===current.sourceId),paragraph=src.paragraphs.find(item=>item.id===current.paragraphId);
  const attempts=state.attempts.filter(item=>item.ideaId===current.id).slice(-3).reverse();
  $('#work-content').innerHTML=`${queueHTML}<div class="practice-header"><label for="practice-idea">Work on</label><select id="practice-idea">${projectIdeas().map(item=>`<option value="${esc(item.id)}" ${item.id===current.id?'selected':''}>${esc(item.title)}</option>`).join('')}</select></div><div class="practice-prompt"><span class="small-label">Explain without looking</span><h3>${esc(current.question||`Explain “${current.title}” and give an example relevant to your project.`)}</h3><p>The reference stays hidden until you have written an answer.</p></div><label class="sr-only" for="practice-answer">Your answer</label><textarea id="practice-answer" class="practice-answer" rows="5" placeholder="Use your own words. What would you do with this idea?" maxlength="12000">${esc(practiceAnswer)}</textarea>${practiceRevealed?`<div class="practice-reference"><span class="small-label">Compare with the source</span><blockquote>${esc(paragraph.text)}</blockquote><button class="citation-button" data-act="evidence" data-idea-id="${esc(current.id)}">${esc(src.title)} · §${paragraph.index+1} ↗</button></div><p class="helper-copy">Your assessment, not an automatic grade. The answer and reference are kept together.</p><div class="practice-ratings"><button data-rate="again">Again<small>Tomorrow</small></button><button data-rate="uncertain">Uncertain<small>In 3 days</small></button><button data-rate="understood">Understood<small>In 7 days</small></button></div>`:'<button data-act="reveal" class="primary" id="reveal-button">Reveal reference</button>'}${attempts.length?`<div class="attempt-list"><h4>Earlier attempts</h4>${attempts.map(entry=>`<details><summary>${dateLabel(localStudyDate(entry.createdAt))} · ${esc(entry.rating)} · revisit ${dateLabel(localStudyDate(entry.dueAt))}</summary><p>${esc(entry.answer)}</p></details>`).join('')}</div>`:''}`;
}
function renderDraft(){
  const action=draftAction();if(!action){$('#work-content').innerHTML='<div class="empty-state"><h3>Give the work an endpoint.</h3><p>Add an action with a tangible output: an argument, a worked example, a decision or a first draft.</p><button id="draft-add-action" data-act="new-action" class="primary">Add an action</button></div>';return;}
  draftActionId=action.id;
  const linked=state.ideas.find(item=>item.id===action.ideaId),running=state.session?.actionId===action.id&&state.session.running;
  $('#work-content').innerHTML=`<label class="small-label" for="draft-action">Current piece of work</label><select id="draft-action" class="draft-selector">${projectActions().map(item=>`<option value="${esc(item.id)}" ${item.id===action.id?'selected':''}>${esc(item.title)}</option>`).join('')}</select><div class="focus-strip"><div><span class="small-label">Time spent · ${action.minutes} min estimated</span><strong class="focus-clock" id="focus-clock">00:00</strong></div><div class="focus-actions"><button data-act="focus-toggle" class="secondary" ${action.status==='done'?'disabled':''}>${running?'Pause':state.session?.actionId===action.id?'Resume focus':'Start focus'}</button><button data-act="complete-action" class="text-button" ${action.status==='done'?'disabled':''}>${action.status==='done'?'Completed':'Mark complete'}</button></div></div>${linked?`<div class="draft-evidence"><span class="small-label">The idea behind this action</span><button data-act="evidence" data-idea-id="${esc(linked.id)}" class="citation-button">${esc(linked.title)} ↗</button><p>${esc(linked.explanation)}</p></div>`:''}${action.studyId?`<button class="text-button" data-act="return-study" data-study-id="${esc(action.studyId)}">Open the lighting study behind this check →</button>`:''}<label class="small-label" for="draft-editor">Your output</label><textarea id="draft-editor" class="draft-editor" rows="10" maxlength="60000" placeholder="Write the argument, work through the example, or record your decision. This draft saves as you type.">${esc(action.draft)}</textarea><div class="draft-status"><span id="draft-save-status">Saved with your project</span><span>${action.status==='done'?'Completion reported by you':action.status==='blocked'?'Marked blocked':'Work in progress'}</span></div><button data-view="quiet" class="text-button">Leave a note for next time →</button>`;
}
function renderLibrary(){
  const query=$('#library-search').value.trim().toLowerCase();const items=projectSources().filter(item=>(item.title+' '+item.text).toLowerCase().includes(query));
  $('#library-summary').textContent=`${projectSources().length} sources in this project`;
  $('#library-list').innerHTML=items.length?items.map(item=>{const ideas=projectIdeas().filter(entry=>entry.sourceId===item.id);return `<article class="source-card"><div class="source-card-index" aria-hidden="true">${item.kind==='pdf'?'PDF':item.kind==='markdown'?'MD':'TXT'}</div><div class="source-card-main"><button data-act="read-source" data-source-id="${esc(item.id)}" class="source-card-title">${esc(item.title)}</button><p>${esc(item.paragraphs.find(p=>!p.text.startsWith('#'))?.text.slice(0,200)||item.text.slice(0,200))}${item.text.length>200?'…':''}</p><div class="source-card-meta">${item.paragraphs.length} passages · ${ideas.length} kept ideas${item.kind==='example'?' · Example material':''}</div></div><div class="source-card-actions"><button data-act="read-source" data-source-id="${esc(item.id)}" class="text-button">Open →</button><button data-act="delete-source" data-source-id="${esc(item.id)}" class="icon-button" aria-label="Delete source ${esc(item.title)}">×</button></div></article>`;}).join(''):`<div class="empty-state"><h2>${query?'No matching source.':'Bring your material.'}</h2><p>${query?'Try a phrase from its title or text.':'Import text, Markdown or a digital PDF. Sources stay intact beside your notes and work.'}</p><button data-open-source class="primary">Add a source</button></div>`;
}
function renderWeek(){
  const plan=project().plan;$('#daily-budget').value=plan.dailyMinutes;$('#budget-value').textContent=`${plan.dailyMinutes} min`;$('#plan-date').value=plan.startDate;$('#plan-time').value=plan.startTime;$('#plan-rest').value=plan.restMinutes;
  const actions=projectActions();const schedule=scheduleActions(actions,plan);
  $('#action-list').innerHTML=actions.length?actions.map((item,index)=>{
    const linked=state.ideas.find(entry=>entry.id===item.ideaId);return `<article class="action-row ${item.status==='done'?'done':''}"><button data-act="toggle-done" data-action-id="${esc(item.id)}" class="action-status" aria-label="${item.status==='done'?'Reopen':'Complete'} ${esc(item.title)}" aria-pressed="${item.status==='done'}">${item.status==='done'?'✓':item.status==='blocked'?'!':''}</button><div class="action-main"><button data-act="work-action" data-action-id="${esc(item.id)}" class="action-title">${esc(item.title)}</button><div class="action-meta"><span>${item.minutes} min</span>${item.studyId?`<button data-act="return-study" data-study-id="${esc(item.studyId)}">Lighting study ↗</button>`:''}${linked?`<button data-act="evidence" data-idea-id="${esc(linked.id)}">${esc(linked.title)} ↗</button>`:''}${item.dependsOn.length?`<span>${item.dependsOn.length} prerequisite${item.dependsOn.length>1?'s':''}</span>`:''}${item.deadline?`<span>By ${dateLabel(item.deadline)}</span>`:''}</div></div><div class="action-tools"><button data-act="edit-action" data-action-id="${esc(item.id)}" aria-label="Edit ${esc(item.title)}">⋯</button><button data-act="move-action" data-direction="up" data-action-id="${esc(item.id)}" aria-label="Move ${esc(item.title)} earlier" ${index===0?'disabled':''}>↑</button><button data-act="move-action" data-direction="down" data-action-id="${esc(item.id)}" aria-label="Move ${esc(item.title)} later" ${index===actions.length-1?'disabled':''}>↓</button></div></article>`;
  }).join(''):'<div class="empty-state"><p>Name the output and estimate the time. The week will take shape from those constraints.</p><button data-act="new-action" class="primary">Add first action</button></div>';
  $('#schedule-summary').innerHTML=`<div class="schedule-stat"><strong>${schedule.totalWorkMinutes}</strong><span>min of unfinished work</span></div><div class="schedule-stat"><strong>${schedule.totalCapacityMinutes}</strong><span>min available this week</span></div><p>${schedule.overflow.length?`${schedule.overflow.length} action${schedule.overflow.length>1?'s':''} need attention`:`${schedule.totalWorkMinutes?`Fits by ${schedule.finishDate?dateLabel(schedule.finishDate):'the end of the week'}`:'Your week is open'}`}</p>`;
  $('#week-grid').innerHTML=schedule.days.map((day,index)=>`<div class="day-column"><div class="day-heading"><span>${dateLabel(day.date,{weekday:'short'})}</span><strong>${dateLabel(day.date,{day:'numeric'})}</strong><small>${day.used} / ${day.capacity} min</small></div><div class="day-meter" aria-label="${day.used} of ${day.capacity} minutes used"><meter value="${day.used}" min="0" max="${Math.max(1,day.capacity)}">${day.used}</meter></div>${day.blocks.length?day.blocks.map((block,blockIndex)=>{const action=actions.find(item=>item.id===block.actionId);const color=Math.max(0,actions.indexOf(action))%4;return `${blockIndex&&plan.restMinutes?`<div class="day-rest">${plan.restMinutes} min rest</div>`:''}<button class="day-block tone-${color}" data-act="work-action" data-action-id="${esc(block.actionId)}"><span>${clock(block.startMinute)}–${clock(block.endMinute)}</span><strong>${esc(action?.title)}</strong><small>${block.minutes} min${block.minutes<action?.minutes?' · part of action':''}</small></button>`;}).join(''):'<div class="day-empty">Open</div>'}</div>`).join('');
  $('#schedule-conflicts').innerHTML=schedule.overflow.map(entry=>`<div class="conflict-row"><span aria-hidden="true">!</span><div><strong>${esc(actions.find(item=>item.id===entry.actionId)?.title)}</strong><p>${esc(entry.reason)}</p></div><button data-act="edit-action" data-action-id="${esc(entry.actionId)}" class="text-button">Adjust</button></div>`).join('');
}
function renderQuiet(){
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
  const practicing=workMode==='practice'&&!practiceRevealed;
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
  const session=state.session,action=draftAction();if($('#focus-clock'))$('#focus-clock').textContent=duration((action?.spentMs||0)+(session?.actionId===action?.id?sessionElapsed(session,Date.now()):0));
  if(session?.running&&sessionElapsed(session,Date.now())>=session.goalMinutes*60000)$('#draft-save-status')&&($('#draft-save-status').textContent='Your estimated focus time has passed. Pause or continue when you choose.');
  const quiet=state.quiet;const remaining=quiet?.running?Math.max(0,quiet.endsAt-Date.now()):quiet?.remainingMs??Number($('#quiet-duration').value||10)*60000;
  $('#quiet-clock').textContent=duration(remaining);$('#quiet-view').classList.toggle('quiet-running',Boolean(quiet?.running));
  if(quiet?.running&&remaining===0){quiet.running=false;quiet.endsAt=null;quiet.remainingMs=0;persist();$('#quiet-caption').textContent='The timer has finished. Stay here if you like.';$('#quiet-toggle').textContent='Begin quiet';stopSound();}
}
function endSession(){
  if(!state.session)return;
  const action=state.actions.find(item=>item.id===state.session.actionId);
  if(action)action.spentMs=(action.spentMs||0)+sessionElapsed(state.session,Date.now());
  state.session=null;
}
function toggleFocus(){
  const action=draftAction();if(!action||action.status==='done')return;
  if(state.session?.actionId===action.id){
    if(state.session.running){state.session.elapsedMs=sessionElapsed(state.session,Date.now());state.session.startedAt=null;state.session.running=false;}
    else{state.session.startedAt=Date.now();state.session.running=true;}
  }else{endSession();state.session={actionId:action.id,running:true,startedAt:Date.now(),elapsedMs:0,goalMinutes:action.minutes};}
  persist();renderWork();tick();
}
function setDone(action){
  if(state.session?.actionId===action.id)endSession();
  action.status=action.status==='done'?'todo':'done';action.completedAt=action.status==='done'?nowISO():null;
  persist();render();notify(action.status==='done'?'Marked complete by you. Its draft is still here.':'Action reopened.');
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
  showDialog('Bring your material',`<form id="source-form" class="dialog-form"><label>Source title<input name="title" maxlength="300" placeholder="Reading, notes or a working question"></label><label>Choose a file<input name="file" type="file" accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf"></label><p class="helper-copy">Text or Markdown up to 120,000 characters. Digital PDFs up to 20 MB and 80 pages. Scanned pages need OCR first.</p><div class="form-divider"><span>or paste text</span></div><label>Original text<textarea name="text" rows="7" maxlength="120000" placeholder="Separate passages with a blank line. The original text stays attached to your ideas."></textarea></label><p id="source-error" class="form-error" role="alert"></p><button id="source-submit" class="primary" type="submit">Add to this project</button><p class="helper-copy">PDF text is extracted on this computer. A source is sent to your selected provider only when you ask for assistance.</p></form>`);
  const projectId=project().id,intakeState=state;
  const sourceForm=$('#source-form');
  sourceForm.querySelector('.helper-copy:last-child').textContent=clientServices.capabilities.pdf==='browser'?'PDF text is extracted in this browser using the bundled reader. This hosted edition does not send your source to a server or assistant.':'PDF text is extracted on this computer. A source is sent to your selected provider only when you ask for assistance.';
  $('#source-submit').insertAdjacentHTML('afterend','<button id="source-cancel" class="secondary" type="button" hidden>Cancel import</button>');
  $('#source-cancel').addEventListener('click',()=>sourceImportAbort?.abort());
  $('#source-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,data=new FormData(form),file=data.get('file');let text=String(data.get('text')).trim(),kind='text',title=String(data.get('title')).trim();const button=$('#source-submit'),error=$('#source-error');button.disabled=true;error.textContent='';
    const controller=new AbortController();sourceImportAbort?.abort();sourceImportAbort=controller;const cancel=$('#source-cancel');cancel.hidden=false;
    try{
      if(file instanceof File&&file.size){
        if(text)throw Error('Choose a file or paste text for this source.');
        if(file.size>20*1024*1024)throw Error('Choose a file under 20 MB.');
        title=title||file.name.replace(/\.(pdf|txt|md|markdown)$/i,'');
        if(/\.pdf$/i.test(file.name)||file.type==='application/pdf'){
          button.textContent='Reading the PDF…';const result=await clientServices.readPdf(file,{signal:controller.signal});text=result.text;kind='pdf';
        }else{if(!/\.(txt|md|markdown)$/i.test(file.name)&&!['text/plain','text/markdown'].includes(file.type))throw Error('Choose a text, Markdown or PDF file.');text=await file.text();kind=/\.(md|markdown)$/i.test(file.name)?'markdown':'text';}
      }
      checkCancelled(controller.signal);
      if(!text.trim())throw Error('Add some readable text first.');if(text.length>120000)throw Error('Use a shorter source, up to 120,000 characters.');
      if(state.sources.length>=100)throw Error('The desk supports up to 100 sources. Export or remove an older source first.');
      if(state.sources.reduce((sum,item)=>sum+item.text.length,0)+text.length>10000000)throw Error('The desk has reached its text storage limit. Export or remove older sources first.');
      const paragraphs=splitSource(text);if(paragraphs.length>160)throw Error('Use a shorter excerpt with up to 160 passages.');
      if(state!==intakeState||!dialog.open||$('#source-form')!==form||!state.projects.some(item=>item.id===projectId))return;
      const item={id:uid('source'),projectId,title:title||'Untitled source',kind,text,paragraphs,createdAt:nowISO()};state.sources.push(item);state.activeProjectId=projectId;state.selectedSourceId=item.id;state.selectedIdeaId=null;state.view='desk';readerMode='read';workMode='ideas';aiResult=null;selectedParagraph=null;dialog.close();persist();render();notify(`Added ${paragraphs.length} passages. The source is ready to read.`);
    }catch(caught){error.textContent=caught.name==='AbortError'?'Import cancelled. Your existing sources are unchanged.':caught.message;}finally{if(sourceImportAbort===controller)sourceImportAbort=null;button.disabled=false;button.textContent='Add to this project';cancel.hidden=true;}
  });$('#source-form input').focus();
}
function keepPassage(paragraphId,suggestion=null){
  const src=source(),paragraph=src?.paragraphs.find(item=>item.id===paragraphId);if(!paragraph)return;
  if(state.ideas.length>=500){notify('The desk supports up to 500 kept ideas.');return;}
  const item={id:uid('idea'),projectId:project().id,sourceId:src.id,paragraphId,title:suggestion?.title||paragraph.text.replace(/^#+\s*/,'').slice(0,100),explanation:suggestion?.explanation||'',question:suggestion?.question||'',createdAt:nowISO(),origin:suggestion?'ai':'user'};
  state.ideas.push(item);state.selectedIdeaId=item.id;workMode='ideas';selectedParagraph=paragraphId;persist();renderReader();renderWork();notify(suggestion?'Kept with its source. Check and edit the explanation.':'Passage kept. Add your own explanation.');
}
function openAction(actionId=null,ideaId=null,prefill=null){
  const current=state.actions.find(item=>item.id===actionId),ideas=projectIdeas(),actions=projectActions();
  showDialog(current?'Edit action':'Put it to work',`<form id="action-form" class="dialog-form"><label>A concrete output<input name="title" required maxlength="300" value="${esc(current?.title||prefill?.title||'')}" placeholder="Write an argument, solve an example, make a decision…"></label><div class="form-pair"><label>Estimate in minutes<input name="minutes" type="number" min="1" max="10080" required value="${current?.minutes||prefill?.minutes||30}"></label><label>Finish by (optional)<input name="deadline" type="date" value="${esc(current?.deadline||'')}"></label></div><label>Attached idea<select name="ideaId"><option value="">No attached idea</option>${ideas.map(item=>`<option value="${esc(item.id)}" ${(current?.ideaId||ideaId)===item.id?'selected':''}>${esc(item.title)}</option>`).join('')}</select></label><label>Status<select name="status">${['todo','blocked','done'].map(status=>`<option value="${status}" ${current?.status===status?'selected':''}>${{todo:'To do',blocked:'Blocked',done:'Done'}[status]}</option>`).join('')}</select></label>${actions.filter(item=>item.id!==actionId).length?`<fieldset class="dependency-list"><legend>Needs these actions first</legend>${actions.filter(item=>item.id!==actionId).map(item=>`<label class="check-label"><input name="dependencies" type="checkbox" value="${esc(item.id)}" ${current?.dependsOn.includes(item.id)?'checked':''}><span>${esc(item.title)}</span></label>`).join('')}</fieldset>`:''}<p class="helper-copy">The week splits longer work across days and counts rest between blocks. Blocked actions and impossible deadlines stay visible.</p><p id="action-error" class="form-error" role="alert"></p><div class="dialog-actions"><button type="submit" class="primary">Save action</button>${current?'<button type="button" id="delete-action" class="text-button danger">Delete action</button>':''}</div></form>`);
  $('#action-form').addEventListener('submit',event=>{
    event.preventDefault();const data=new FormData(event.currentTarget),title=String(data.get('title')).trim(),minutes=Number(data.get('minutes')),status=String(data.get('status'));
    if(!title||!Number.isInteger(minutes)||minutes<1||minutes>10080)return;
    const patch={title,minutes,status,ideaId:String(data.get('ideaId'))||null,deadline:String(data.get('deadline'))||null,dependsOn:data.getAll('dependencies').map(String),completedAt:status==='done'?(current?.completedAt||nowISO()):null};
    if(current){if(state.session?.actionId===current.id&&status==='done')endSession();else if(state.session?.actionId===current.id)state.session.goalMinutes=minutes;Object.assign(current,patch);}else{if(state.actions.length>=500){$('#action-error').textContent='The desk supports up to 500 actions.';return;}state.actions.push({id:uid('action'),projectId:project().id,...patch,studyId:prefill?.studyId||null,draft:'',spentMs:0});}
    dialog.close();persist();render();notify('Action saved. The week has been recalculated.');
  });
  if(current)$('#delete-action').addEventListener('click',()=>confirmAction('Delete this action?',`Its draft and focus time will be removed. Other actions will no longer require “${current.title}”.`,()=>{if(state.session?.actionId===current.id)state.session=null;state.actions=state.actions.filter(item=>item.id!==current.id);for(const action of state.actions)action.dependsOn=action.dependsOn.filter(id=>id!==current.id);if(draftActionId===current.id)draftActionId=null;persist();render();},'Delete action'));
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
  showDialog('Your desk, your records',`<p class="helper-copy">Export a complete copy of your projects, original sources, ideas, answers, drafts, plans, timers, studies, arrangements, decisions, observations and recorded experiments. Import checks every source and study link before replacing this browser’s desk.</p>${loaded.notice?`<p class="form-error">${esc(loaded.notice)}</p>`:''}<div class="data-actions"><button id="export-data" class="primary">Export desk</button><button id="import-data" class="secondary">Import a desk</button>${rawRecovery?'<button id="export-recovery" class="secondary">Download unreadable record</button>':''}</div><p class="helper-copy">The JSON file contains your text. Keep it somewhere you trust. Browser storage can be cleared; a downloaded copy survives that.</p><hr><button data-act="open-example" class="text-button">Add an example project</button>`);
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
      case 'practice-idea':state.selectedIdeaId=note.id;practiceAnswer='';practiceRevealed=false;workMode='practice';renderWork();persist();break;
      case 'plan-idea':openAction(null,note.id);break;
      case 'new-action':openAction();break;
      case 'edit-action':openAction(action.id);break;
      case 'toggle-done':case 'complete-action':if(action)setDone(action);else if(draftAction())setDone(draftAction());break;
      case 'work-action':if(state.session?.actionId!==action.id)endSession();draftActionId=action.id;state.view='desk';workMode='draft';persist();render();$('#draft-editor')?.focus({preventScroll:true});break;
      case 'focus-toggle':toggleFocus();break;
      case 'move-action':{const items=projectActions(),index=items.indexOf(action),next=index+(button.dataset.direction==='up'?-1:1);if(next<0||next>=items.length)break;const left=state.actions.indexOf(action),right=state.actions.indexOf(items[next]);[state.actions[left],state.actions[right]]=[state.actions[right],state.actions[left]];persist();renderWeek();break;}
      case 'reveal':if(!practiceAnswer.trim()){notify('Write an answer before revealing the reference.');$('#practice-answer').focus();}else{practiceRevealed=true;renderWork();}break;
      case 'delete-idea':confirmAction('Delete this idea?', 'Its practice attempts will be removed. Attached actions and drafts will remain, without this idea link.',()=>{state.ideas=state.ideas.filter(item=>item.id!==note.id);state.attempts=state.attempts.filter(item=>item.ideaId!==note.id);for(const item of state.actions)if(item.ideaId===note.id)item.ideaId=null;if(state.selectedIdeaId===note.id)state.selectedIdeaId=null;persist();render();},'Delete idea');break;
      case 'read-source':state.view='desk';selectSource(button.dataset.sourceId);break;
      case 'delete-source':{const src=state.sources.find(item=>item.id===button.dataset.sourceId);if(state.studio.studies.some(study=>study.decision?.sourceRefs.some(ref=>ref.sourceId===src.id))){notify('This source is retained as decision evidence. Keep it so the study can be checked later.');break;}confirmAction('Delete this source?',`“${src.title}”, its kept ideas and practice attempts will be removed. Action drafts will remain without those idea links.`,()=>{const removed=new Set(state.ideas.filter(item=>item.sourceId===src.id).map(item=>item.id));state.sources=state.sources.filter(item=>item.id!==src.id);state.ideas=state.ideas.filter(item=>!removed.has(item.id));state.attempts=state.attempts.filter(item=>!removed.has(item.ideaId));for(const item of state.actions)if(removed.has(item.ideaId))item.ideaId=null;if(state.selectedSourceId===src.id)state.selectedSourceId=null;if(removed.has(state.selectedIdeaId))state.selectedIdeaId=null;aiResult=null;persist();render();},'Delete source');break;}
      case 'cancel-ai':aiAbort?.abort();break;
      case 'keep-ai':if(aiResult?.sourceId===source()?.id){const item=aiResult.ideas[Number(button.dataset.aiIndex)];keepPassage(item.paragraphId,item);}break;
      case 'ai-citation':{const cite=aiResult?.citations[Number(button.dataset.citation)];if(cite){selectedParagraph=cite.paragraphId;readerMode='read';renderReader();document.querySelector(`[data-paragraph="${cite.paragraphId}"]`)?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}break;}
      case 'open-example':{if(state.projects.length>=30||state.sources.length>=100||state.ideas.length>498||state.actions.length>496){notify('There is not enough room for an example. Export or remove older records first.');break;}endSession();const sample=createExampleState();state.projects.push(...sample.projects);state.sources.push(...sample.sources);state.ideas.push(...sample.ideas);state.actions.push(...sample.actions);state.activeProjectId=sample.activeProjectId;state.selectedSourceId=sample.selectedSourceId;state.selectedIdeaId=sample.selectedIdeaId;state.view='desk';workMode='ideas';aiResult=null;dialog.close();persist();render();break;}
    }
  }catch(error){notify(error.message||'This action could not be completed.');}
});
document.addEventListener('submit',event=>{
  const id=event.target.dataset.editIdea;if(!id)return;event.preventDefault();const item=state.ideas.find(entry=>entry.id===id),data=new FormData(event.target);item.title=String(data.get('title')).trim();item.explanation=String(data.get('explanation'));item.question=String(data.get('question'));persist();renderWork();notify('Idea saved with the original passage.');
});
document.addEventListener('input',event=>{
  const ideaForm=event.target.closest('[data-edit-idea]');if(ideaForm){const item=state.ideas.find(entry=>entry.id===ideaForm.dataset.editIdea);if(item){const data=new FormData(ideaForm),title=String(data.get('title')).trim();if(title)item.title=title;item.explanation=String(data.get('explanation'));item.question=String(data.get('question'));persist();}}
  if(['closing-note','closing-next'].includes(event.target.id)){project().closing={note:$('#closing-note').value,nextAction:$('#closing-next').value,updatedAt:nowISO()};const saved=persist();$('#closing-status').textContent=saved?'Handoff saved as you write.':'Handoff is in this session. Export a copy.';}
  if(event.target.id==='practice-answer')practiceAnswer=event.target.value;
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
$('#source-details-button').addEventListener('click',()=>{const src=source();if(src)showDialog('Source details',`<dl class="detail-list"><dt>Title</dt><dd>${esc(src.title)}</dd><dt>Kind</dt><dd>${esc(src.kind)}</dd><dt>Added</dt><dd>${esc(new Date(src.createdAt).toLocaleString())}</dd><dt>Passages</dt><dd>${src.paragraphs.length}</dd></dl><p class="helper-copy">This source is kept as imported. Ideas cite the exact original passage. To change the source, import a revised copy.</p>`,`<button id="download-source" class="primary">Download original text</button>`);$('#download-source')?.addEventListener('click',()=>download('afterlight-source.txt',src.text,'text/plain'));});
$('#assistant-form').addEventListener('submit',event=>{event.preventDefault();const question=$('#assistant-question').value.trim();if(question)askAssistant('question',question);});
$('#provider-select').addEventListener('change',event=>{providerId=event.target.value;provider=providers.find(p=>p.id===providerId)||provider;aiResult=null;renderAssistant();});$('#provider-connect').addEventListener('click',openProviderConnection);
$('#replan-button').addEventListener('click',()=>{project().plan.startDate=todayISO();persist();renderWeek();notify('The seven-day plan now starts today. Estimates and prerequisites are retained.');});
$('#calendar-button').addEventListener('click',()=>{const schedule=scheduleActions(projectActions(),project().plan);if(!schedule.days.some(day=>day.blocks.length)){notify('Add a feasible action before exporting the calendar.');return;}download('afterlight-week.ics',calendarExport(schedule,projectActions(),project().title),'text/calendar;charset=utf-8');notify('Exported scheduled blocks. Unscheduled work stays in the plan.');});
$('#closing-form').addEventListener('submit',event=>{event.preventDefault();project().closing={note:$('#closing-note').value,nextAction:$('#closing-next').value,updatedAt:nowISO()};persist();$('#closing-status').textContent='Handoff saved. Your draft and starting point will be here.';$('#handoff-banner').hidden=!project().closing.nextAction;notify('Handoff saved.');});
$('#closing-plan-button').addEventListener('click',()=>{const next=$('#closing-next').value.trim();if(!next){notify('Write a next step first.');$('#closing-next').focus();return;}project().closing={note:$('#closing-note').value,nextAction:next,updatedAt:nowISO()};persist();const title=next.slice(0,300),existing=projectActions().find(item=>item.title===title&&item.status!=='done');if(existing)openAction(existing.id);else openAction(null,null,{title,minutes:30,studyId:null});});
$('#quiet-duration').addEventListener('change',event=>{const durationMinutes=Number(event.target.value);state.quiet={durationMinutes,remainingMs:durationMinutes*60000,running:false,endsAt:null};stopSound();persist();renderQuiet();tick();});
$('#quiet-toggle').addEventListener('click',()=>{let quiet=state.quiet;if(quiet?.running){quiet.remainingMs=Math.max(0,quiet.endsAt-Date.now());quiet.running=false;quiet.endsAt=null;stopSound();}else{const durationMinutes=quiet?.durationMinutes||Number($('#quiet-duration').value);quiet=state.quiet={durationMinutes,remainingMs:quiet?.remainingMs||durationMinutes*60000,running:true,endsAt:Date.now()+(quiet?.remainingMs||durationMinutes*60000)};}$('#quiet-caption').textContent=quiet.running?'You can leave the desk for a while.':'The quiet timer is paused.';persist();renderQuiet();tick();});
$('#sound-button').addEventListener('click',()=>toggleSound().catch(error=>notify(error.message)));
$('#about-button').addEventListener('click',()=>showDialog('Afterlight',`<p class="about-lead">Knowledge you can predict, test, explain and use.</p><p class="helper-copy">Start with light for a shared table. Save two arrangements, compare their calculated readings at the same points, then keep a choice, its reason and a next check. Use distance, shadow and balance commissions to investigate the rules. Desk retains your evidence and explanation, Library keeps sources, Week schedules a real check, and Quiet keeps a starting point for later.</p><p class="helper-copy">The plan uses your estimates, prerequisites, deadlines and rest gaps. Practice dates are a simple 1/3/7-day self-assessment rule. Neither proves mastery or predicts your productivity.</p><p class="helper-copy">Inspired by the connected reading workflow in <a href="https://github.com/beltromatti/get-it" target="_blank" rel="noreferrer">Get It</a>. Afterlight is one product; Midnight Academy is the competition setting. The lab uses ideal point lamps and direct rays, with no ambient light or reflections. Targets are authored exercises, not lighting standards. Night appearance and quiet time are optional.</p><p class="helper-copy">${clientServices.capabilities.assistants?'Sources and drafts are stored in this browser. Assistance uses your selected CLI or API provider only after an explicit request. Provider keys remain in local server memory.':'This hosted edition stores sources and drafts in this browser and extracts PDFs here. It has no assistant or provider connection. Export a backup before clearing browser storage.'} Rain is synthesized locally; no background notification or sleep tracking is performed.</p>`));
$('#import-state-file').addEventListener('change',async event=>{const file=event.target.files[0];event.target.value='';if(!file)return;try{if(file.size>25_000_000)throw Error('This desk file exceeds 25 MB.');const raw=JSON.parse(await file.text()),candidate=validateState(raw.format==='afterlight'?raw.state:raw);confirmAction('Replace this browser’s desk?',`Import ${candidate.projects.length} projects, ${candidate.studio.studies.length} studies, ${candidate.sources.length} sources and ${candidate.actions.length} actions from “${file.name}”. Export the current desk first if you want to keep both.`,()=>{if(!commitStudio(candidate))return;aiAbort?.abort();stopSound();workMode='ideas';readerMode='read';draftActionId=state.session?.actionId||null;practiceAnswer='';practiceRevealed=false;selectedParagraph=null;aiResult=null;persist();render();notify('Desk imported. All source links were checked.');},'Replace desk');}catch(error){notify(`Import refused: ${error.message} Your current desk is intact.`);}});
window.addEventListener('pagehide',stopSound);
render();
if(loaded.notice){$('#save-status').textContent='Saved record needs attention';$('#save-status').classList.add('save-warning');notify(loaded.notice);}
else persist();
setInterval(tick,1000);
refreshProviders();


