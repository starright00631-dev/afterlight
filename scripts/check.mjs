import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
const folders=['.','services'];
for(const folder of folders){
  for(const name of readdirSync(folder)){if(!/\.(m?js)$/.test(name))continue; const result=spawnSync(process.execPath,['--check',path.join(folder,name)],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
}
console.log('Application module syntax passed.');
