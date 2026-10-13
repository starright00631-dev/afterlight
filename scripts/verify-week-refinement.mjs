import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateState } from '../persistence.js';
import { calendarOverviewData } from '../calendar-overview.js';
import { validateBlockPlacement } from '../workspace-planner.js';

// Browser-produced, explicitly synthetic acceptance fixtures. The preview is
// local view state and must never leak into a workspace backup.
const read=name=>validateState(JSON.parse(readFileSync(new URL(`../qa/${name}`,import.meta.url),'utf8')).state);
const before=read('week-refinement-before.json'),preview=read('week-refinement-preview.json'),after=read('week-refinement-workspace.json');
assert.deepEqual(preview,before,'generating and inspecting a proposal must not save it');
for(const key of ['projects','sources','ideas','actions','attempts','studio'])assert.deepEqual(after[key],before[key],`${key} changed during calendar acceptance`);
assert.deepEqual(after.workbench.sessions,before.workbench.sessions);
assert.equal(after.workbench.sessions.length,0);
assert.equal(after.session,null);
assert.equal(after.attempts.length,0);
assert.equal(after.version,4);
for(const block of before.workbench.blocks)assert.deepEqual(after.workbench.blocks.find(item=>item.id===block.id),block,'an existing reservation lost its identity or geometry');
const planned=after.workbench.blocks.filter(block=>block.status==='planned');
for(const block of planned)validateBlockPlacement(block,after.actions,after.workbench.calendar,after.workbench.blocks);
assert.equal(before.workbench.blocks.length,6);
assert.equal(planned.length,8);
assert.equal(planned.filter(block=>block.pinned).length,1);
assert.equal(planned.reduce((sum,block)=>sum+block.minutes,0),225);
const model=calendarOverviewData(after);
assert.deepEqual(model.totals,{capacityMinutes:510,plannedMinutes:225,openMinutes:250,restMinutes:35});
assert.equal(model.warnings.length,0);

const ics=readFileSync(new URL('../qa/week-refinement-calendar.ics',import.meta.url),'utf8').replace(/\r\n /g,'');
const events=[...ics.matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)END:VEVENT/g)].map(match=>Object.fromEntries(match[1].trim().split('\r\n').map(line=>{const split=line.indexOf(':');return [line.slice(0,split),line.slice(split+1)];})));
assert.equal(events.length,planned.length);
const stamp=(date,minute)=>new Date(new Date(`${date}T00:00:00+08:00`).getTime()+minute*60000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
for(const block of planned){
  const event=events.find(item=>item.UID===`${encodeURIComponent(block.id)}@afterlight.local`);
  assert.ok(event,`missing event ${block.id}`);
  assert.equal(event.DTSTART,stamp(block.date,block.startMinute));
  assert.equal(event.DTEND,stamp(block.date,block.startMinute+block.minutes));
  assert.equal(event.STATUS,'CONFIRMED');
}
console.log('Week refinement verified: preview unchanged; 8 accepted allocations, 225 planned / 250 open / 35 rest minutes; original IDs, sources, optical evidence and UTC events match; no actual work or assessment invented.');
