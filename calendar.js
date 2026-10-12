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
