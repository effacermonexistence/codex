// Diagnostics only: never allow or print a suspected secret. Recognized Swift
// compiler type encodings may be demangled to public declaration names.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const fingerprints = new Set([
  '93a96d32223dd3bf727190674fb37acdaeea59e58957d33fdc02180714858eb1',
  '3e3dbe24f9812025ab9c44171f2eb3fbfeb7d5693ddec1bdc97f235944a6fb75',
  'f49c6a7490cb5306045ca3a947c53bdf20d3730ccce063a39e4f601ea3d511fe',
  'cc2bb401e7897d11049267c8563d58cba8c90e11769bb4f342a375b72a67f677',
  'a9c2c295255a763e6d4b2684f491b36e699954692f852e970cdbbc6b7aabc124',
]);
const found = new Set();
for(const text of fs.readFileSync(process.argv[2]).toString('latin1').match(/[\x20-\x7e]{48,}/g)??[]) {
  for(const token of text.match(/[A-Za-z0-9_+/=-]{48,}/g)??[]) {
    const hash=createHash('sha256').update(token).digest('hex');
    if(!fingerprints.has(hash)||found.has(hash))continue; found.add(hash);
    const result=spawnSync('xcrun',['swift-demangle','--compact',token],{encoding:'utf8',timeout:10000});
    const decoded=result.stdout?.trim();
    const recognized=result.status===0&&decoded&&decoded!==token&&decoded.includes('SwiftUI.');
    console.log(JSON.stringify({fingerprint:hash,length:token.length,
      publicSwiftUIType:recognized?decoded:null}));
  }
}
