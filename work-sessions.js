import { uid, sessionElapsed } from './domain.js';

/** Closing work is a report, never a deduction from a timer or a changed plan. */
export function closeWorkSession(state, {outcome='stopped',output=null,nextStep='',remainingMinutesAfter=null,now=new Date().toISOString()}={}) {
  if(!['finished','continue','blocked','stopped'].includes(outcome))throw Error('Choose a session outcome.');
  if(typeof output!=='string'&&output!==null)throw Error('The session output must be text.');
  if(typeof nextStep!=='string')throw Error('The next step must be text.');
  if(remainingMinutesAfter!==null&&(!Number.isInteger(remainingMinutesAfter)||remainingMinutesAfter<0||remainingMinutesAfter>10080))throw Error('Remaining effort must be 0–10080 minutes.');
  const nowMs=Date.parse(now); if(!Number.isFinite(nowMs))throw Error('The closing time is invalid.');
  const next=structuredClone(state),session=next.session;if(!session)return next;
  const action=next.actions.find(a=>a.id===session.actionId);if(!action)throw Error('The session action is missing.');
  const durationMs=sessionElapsed(session,nowMs);action.spentMs+=durationMs;
  // Old timers retain their aggregate. Their original start and outcome were
  // never saved; do not invent a dated historical work session during upgrade.
  if(session.sessionStartedAt){
    if(Date.parse(session.sessionStartedAt)>nowMs)throw Error('The session cannot end before it starts.');
    if(next.workbench.sessions.length>=5000)throw Error('Export older session records before adding another.');
    next.workbench.sessions.push({id:uid('work-session'),actionId:action.id,actionTitle:action.title,blockId:session.blockId??null,startedAt:session.sessionStartedAt,endedAt:now,durationMs,outcome,output:output??action.draft,nextStep,remainingMinutesAfter:outcome==='finished'?0:remainingMinutesAfter});
  }
  if(output!==null)action.draft=output;
  if(outcome==='finished'){action.status='done';action.completedAt=now;action.remainingMinutes=0;}
  else if(outcome==='blocked'){action.status='blocked';action.completedAt=null;}
  if(outcome!=='finished'&&remainingMinutesAfter!==null)action.remainingMinutes=remainingMinutesAfter;
  if(outcome!=='stopped'){
    const block=next.workbench.blocks.find(b=>b.id===session.blockId);if(block)block.status='done';
    if(outcome==='finished')for(const other of next.workbench.blocks)if(other.actionId===action.id&&other.status==='planned')other.status='skipped';
    const project=next.projects.find(p=>p.id===action.projectId);if(project)project.closing={note:output??action.draft,nextAction:nextStep,updatedAt:now};
  }
  next.session=null;return next;
}
