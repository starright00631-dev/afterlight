import {validateWorkspaceCalendar, validatePlannedBlocks} from './workspace-planner.js';

const escapeIcs=(value)=>String(value).replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const stamp=(date,minute)=>{const value=new Date(date+'T00:00:00.000Z');value.setUTCMinutes(minute);return value.toISOString().replace(/[-:]/g,'').slice(0,15);};
export function calendarExport(schedule,actions,projectTitle,now=new Date()){
  const created=now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const rows=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Afterlight//Personal work plan//EN','CALSCALE:GREGORIAN','X-WR-CALNAME:'+escapeIcs(projectTitle)];
  for(const day of schedule.days){for(const [index,block] of day.blocks.entries()){
    const action=actions.find(item=>item.id===block.actionId);if(!action)continue;
    rows.push('BEGIN:VEVENT',`UID:${action.id}-${day.date}-${index}@afterlight.local`,`DTSTAMP:${created}`,`DTSTART:${stamp(day.date,block.startMinute)}`,`DTEND:${stamp(day.date,block.endMinute)}`,`SUMMARY:${escapeIcs(action.title)}`,`DESCRIPTION:${escapeIcs(`${projectTitle}\nEstimated work: ${block.minutes} minutes. Planned locally in Afterlight; no background reminder is configured.`)}`,'END:VEVENT');
  }}
  rows.push('END:VCALENDAR');
  // RFC5545 lines fold at 75 UTF-8 octets, without splitting a code point.
  const encoder=new TextEncoder();
  return rows.map(row=>{let line='',bytes=0,result='';for(const char of row){const size=encoder.encode(char).length;if(bytes+size>75){result+=line+'\r\n';line=' ';bytes=1;}line+=char;bytes+=size;}return result+line;}).join('\r\n')+'\r\n';
}

/** Accepted workspace allocations use stable identities and explicit UTC instants.
 * Shanghai civil time has a fixed UTC+08:00 offset; this is not a DST-zone adapter. */
export function workspaceCalendarExport(blocks, actions, calendar, title = 'Afterlight work plan', now = new Date()) {
  calendar = validateWorkspaceCalendar(calendar);
  blocks = validatePlannedBlocks(blocks, actions, calendar);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new RangeError('Invalid calendar creation time.');
  if (typeof title !== 'string' || !title.trim() || title.length > 1000) throw new RangeError('Invalid workspace calendar title.');
  const created = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const utcStamp = (date, minute) => `${stamp(date, minute - 480)}Z`;
  const rows = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Afterlight//Accepted workspace plan//EN',
    'CALSCALE:GREGORIAN', `X-WR-CALNAME:${escapeIcs(title)}`, 'X-WR-TIMEZONE:Asia/Shanghai'];
  const map = new Map(actions.map((action) => [action.id, action]));
  for (const block of blocks.filter((item) => item.status !== 'skipped')) {
    const action = map.get(block.actionId);
    if (typeof action.title !== 'string' || !action.title.trim() || action.title.length > 1000) throw new RangeError('An exported allocation needs a valid action title.');
    rows.push('BEGIN:VEVENT', `UID:${encodeURIComponent(block.id)}@afterlight.local`, `DTSTAMP:${created}`,
      `DTSTART:${utcStamp(block.date, block.startMinute)}`, `DTEND:${utcStamp(block.date, block.startMinute + block.minutes)}`,
      `SUMMARY:${escapeIcs(action.title)}`, 'STATUS:CONFIRMED',
      `DESCRIPTION:${escapeIcs(`${title}\nAccepted allocation: ${block.minutes} minutes. Asia/Shanghai civil time, exported as UTC. Allocation status: ${block.status}; this is not an actual work-session record. No background reminder or calendar synchronization is configured.`)}`,
      'END:VEVENT');
  }
  rows.push('END:VCALENDAR');
  const encoder = new TextEncoder();
  return rows.map((row) => {
    let line = '', bytes = 0, result = '';
    for (const char of row) {
      const size = encoder.encode(char).length;
      if (bytes + size > 75) {result += `${line}\r\n`; line = ' '; bytes = 1;}
      line += char; bytes += size;
    }
    return result + line;
  }).join('\r\n') + '\r\n';
}
