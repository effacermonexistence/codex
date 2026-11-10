import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const ROUTES = new Set(['/','/exist','/exist-fr']);
const MARK = '<!--home-ambient-audio:';
const END = '<!--home-ambient-audio-end-->';
export function homeAmbientAssets(root) {
  const dir=path.join(root,'content/home-ambient-audio');
  const config=JSON.parse(fs.readFileSync(dir+'/config.json','utf8'));
  if(config.version!==1||config.defaultVolume!==1||config.maximumGain!==1||config.defaultEnabled!==false||config.routes.join(',')!=='/,/exist,/exist-fr')throw Error('AmbientAudio: scope/defaults');
  const f=config.audio.file;
  if(!/^home-subpulse-[a-f0-9]{16}\.m4a$/.test(f)||config.audio.url!=='/s/'+f)throw Error('AmbientAudio: source name');
  const audio=fs.readFileSync(dir+'/'+f);
  if(audio.length!==config.audio.bytes||hash(audio)!==config.audio.sha256)throw Error('AmbientAudio: original source identity');
  if(!Number.isFinite(config.audio.playbackStartSeconds)||config.audio.playbackStartSeconds<=0||config.audio.playbackStartSeconds>=config.audio.durationSeconds-1)throw Error('AmbientAudio: playback start');
  const runtime=fs.readFileSync(dir+'/runtime.js'),css=fs.readFileSync(dir+'/style.css');
  return{dir,config,audio,runtime,css,runtimeAsset:'/s/home-ambient-'+hash(runtime).slice(0,16)+'.js',cssAsset:'/s/home-ambient-'+hash(css).slice(0,16)+'.css'};
}
function controls() {
  return '<div id="home-ambient-audio" role="group" aria-label="Background sound" data-i18n-ignore="true" data-state="off" data-enabled="false" data-cycle="off" data-expanded="false">'
    +'<button type="button" data-audio-toggle aria-label="Enable sound" aria-pressed="false" aria-expanded="false" aria-controls="home-sound-panel" title="Enable sound"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z"/><g data-sound-waves><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></g><path data-sound-slash d="m16 9 5 6m0-6-5 6"/></svg><span class="home-sound-label" data-audio-label>Enable sound</span></button>'
    +'<div id="home-sound-panel" class="home-sound-inline" data-audio-panel hidden><label class="home-sound-sr-only" for="home-sound-volume">Volume</label><input id="home-sound-volume" type="range" min="0" max="100" step="1" value="100" aria-label="Volume" aria-valuetext="100%"><output for="home-sound-volume">100%</output></div></div>';
}
export function addHomeAmbientAudio(html,root,route) {
  if(!ROUTES.has(route))return html;
  if(html.includes(MARK)||html.includes('id="home-ambient-audio"'))throw Error('AmbientAudio: duplicate');
  const a=homeAmbientAssets(root),head='<link id="home-ambient-audio-style" rel="stylesheet" href="'+a.cssAsset+'">\n';
  const body=controls()+'\n<script id="home-ambient-audio-config" type="application/json" data-i18n-ignore="true">'+JSON.stringify(a.config).replaceAll('<','\\u003c')+'</script>\n<script id="home-ambient-audio-runtime" src="'+a.runtimeAsset+'" defer></script>\n';
  const receipt={version:1,route,priorHtmlSha256:hash(html),headSha256:hash(head),bodySha256:hash(body)};
  if(html.split('</head>').length!==2||html.split('</body>').length!==2)throw Error('AmbientAudio: one document');
  return html.replace('</head>',MARK+Buffer.from(JSON.stringify(receipt)).toString('base64')+'-->'+head+END+'\n</head>').replace('</body>','<!--home-ambient-audio-surface-->'+body+'<!--home-ambient-audio-surface-end-->\n</body>');
}
export function removeHomeAmbientAudio(html) {
  if(!html.includes(MARK)){if(html.includes('id="home-ambient-audio"'))throw Error('AmbientAudio: orphan surface');return html;}
  const h=[...html.matchAll(/<!--home-ambient-audio:([A-Za-z0-9+/=]+)-->([\s\S]*?)<!--home-ambient-audio-end-->\n/g)];
  const b=[...html.matchAll(/<!--home-ambient-audio-surface-->([\s\S]*?)<!--home-ambient-audio-surface-end-->\n/g)];
  if(h.length!==1||b.length!==1)throw Error('AmbientAudio: receipt count');
  const r=JSON.parse(Buffer.from(h[0][1],'base64').toString());
  if(r.version!==1||!ROUTES.has(r.route)||hash(h[0][2])!==r.headSha256||hash(b[0][1])!==r.bodySha256)throw Error('AmbientAudio: changed adopted surface');
  const original=html.replace(h[0][0],'').replace(b[0][0],'');
  if(hash(original)!==r.priorHtmlSha256)throw Error('AmbientAudio: original content changed');return original;
}
export function copyHomeAmbientAudio(root,out) {
  const a=homeAmbientAssets(root);fs.mkdirSync(out+'/s',{recursive:true});
  for(const[asset,data]of[[a.config.audio.url,a.audio],[a.runtimeAsset,a.runtime],[a.cssAsset,a.css]])fs.writeFileSync(path.join(out,asset.slice(1)),data);
  return a;
}
