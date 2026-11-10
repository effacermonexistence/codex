'use strict';
// The collection cover is a composition, never a thirteenth catalogue work.
function validatedTattooCover(manifest) {
  const c=manifest.cover;
  if(c===undefined)return null;
  if(c.id!=='cover'||c.version!=='tattoo-cover-four-source-v1'||!Array.isArray(c.sourceIds)||c.sourceIds.length!==4||new Set(c.sourceIds).size!==4||!Array.isArray(c.sourceHashes)||c.sourceHashes.length!==4)throw Error('Tattoo cover exact four-source contract');
  c.sourceIds.forEach((id,i)=>{const w=manifest.works.find(w=>w.id===id);if(!w||w.sourceSha256!==c.sourceHashes[i])throw Error('Tattoo cover original source identity');});
  for(const [format,width,height] of [['desktop',1280,800],['mobile',720,1280]]){
    const a=c[format];
    if(!a||!/^[a-f0-9]{64}$/.test(a.sha256)||!/^[a-f0-9]{64}$/.test(a.posterSha256)||a.file!==`tattoo-cover-${format}-${a.sha256.slice(0,16)}.mp4`||a.url!=='/s/'+a.file||a.posterFile!==`tattoo-cover-${format}-${a.posterSha256.slice(0,16)}.jpg`||a.posterUrl!=='/s/'+a.posterFile||!Number.isSafeInteger(a.bytes)||a.bytes<=0||a.bytes>15000000||!Number.isSafeInteger(a.posterBytes)||a.posterBytes<=0||a.posterBytes>1000000||a.width!==width||a.height!==height||a.duration!==18||a.fps!==24||a.delivery!=='embedded_verified_source'||a.parts!==undefined)throw Error('Tattoo cover bounded '+format+' asset contract');
  }
  return c;
}
module.exports={validatedTattooCover};
