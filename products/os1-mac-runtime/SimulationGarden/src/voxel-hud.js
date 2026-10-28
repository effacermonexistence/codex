// Entire control deck is procedural pixel/block art. No original screenshot,
// sprite sheet, image loader, font download, progress estimate or provider call.
export const HUD_COMMANDS=Object.freeze([
 {id:'move',meaning:'작업 프롬프트',rect:[505,355,33,36],glyph:'arrow'},
 {id:'stop',meaning:'실제 작업 중단',rect:[548,355,35,36],glyph:'stop'},
 {id:'focus',meaning:'선택 일꾼 찾기',rect:[594,355,38,36],glyph:'focus'},
 {id:'repair',meaning:'같은 세션 재작업',rect:[505,398,33,34],glyph:'wrench'},
 {id:'gather',meaning:'작업 배정',rect:[549,398,35,34],glyph:'crystal'},
 {id:'all',meaning:'전체 전장',rect:[594,397,38,35],glyph:'map'},
 {id:'build',meaning:'새 실제 세션',rect:[505,438,34,36],glyph:'plus'},
 {id:'base',meaning:'선택 세션 대화',rect:[549,438,35,36],glyph:'base'},
 {id:'help',meaning:'상태 검증',rect:[602,439,34,34],glyph:'question'}
]);
export const HUD_REGIONS=Object.freeze({full:[0,316,640,164],minimap:[7,351,126,124],unit:[157,386,73,81],operator:[408,410,78,68],commands:HUD_COMMANDS.map(c=>c.rect)});
const glyphs={A:['010','101','111','101','101'],B:['110','101','110','101','110'],C:['011','100','100','100','011'],D:['110','101','101','101','110'],E:['111','100','110','100','111'],F:['111','100','110','100','100'],G:['011','100','101','101','011'],H:['101','101','111','101','101'],I:['111','010','010','010','111'],J:['001','001','001','101','010'],K:['101','101','110','101','101'],L:['100','100','100','100','111'],M:['101','111','111','101','101'],N:['101','111','111','111','101'],O:['010','101','101','101','010'],P:['110','101','110','100','100'],Q:['010','101','101','111','011'],R:['110','101','110','101','101'],S:['011','100','010','001','110'],T:['111','010','010','010','010'],U:['101','101','101','101','111'],V:['101','101','101','101','010'],W:['101','101','111','111','101'],X:['101','101','010','101','101'],Y:['101','101','010','010','010'],Z:['111','001','010','100','111'],'?':['110','001','010','000','010'],'+':['000','010','111','010','000'],'-':['000','000','111','000','000'],' ':['000','000','000','000','000']};
function pixelText(c,text,x,y,color,scale=1){c.fillStyle=color;for(const ch of text.toUpperCase()){const g=glyphs[ch]||glyphs[' '];g.forEach((line,row)=>{for(let col=0;col<line.length;col++)if(line[col]==='1')c.fillRect(x+col*scale,y+row*scale,scale,scale);});x+=4*scale;}}
function panel(c,x,y,w,h,{fill='#424b43',light='#809083',dark='#1a231e',edge='#101813',depth=3}={}){c.fillStyle=edge;c.fillRect(x,y,w,h);c.fillStyle=fill;c.fillRect(x+1,y+1,w-2,h-2);c.fillStyle=light;c.fillRect(x+1,y+1,w-2,depth);c.fillRect(x+1,y+1,depth,h-2);c.fillStyle=dark;c.fillRect(x+1,y+h-depth-1,w-2,depth);c.fillRect(x+w-depth-1,y+1,depth,h-2);}
function inset(c,x,y,w,h){panel(c,x,y,w,h,{fill:'#18231c',light:'#19251d',dark:'#68796c',edge:'#111a15',depth:2});}
function bolt(c,x,y){c.fillStyle='#111a15';c.fillRect(x,y,4,4);c.fillStyle='#89978c';c.fillRect(x,y,3,2);c.fillStyle='#c3cbbf';c.fillRect(x,y,1,1);}
function block(c,x,y,w,h,{face='#a6b6b8',top='#d3dfdd',side='#637b80',depth=3}={}){c.fillStyle=side;c.fillRect(x,y,w,h);c.fillStyle=top;c.fillRect(x+depth,y-depth,w-depth,depth+1);c.fillStyle=face;c.fillRect(x,y,w-depth,h);c.fillStyle='#243b3e';c.fillRect(x,y+h-1,w,1);}
function mechPortrait(c,x,y,accent){
 block(c,x+12,y+38,8,16,{face:'#60767f',top:'#a1b5b6',side:'#344d58',depth:2});block(c,x+37,y+38,8,16,{face:'#60767f',top:'#a1b5b6',side:'#344d58',depth:2});
 block(c,x+8,y+53,18,6);block(c,x+33,y+53,18,6);block(c,x+13,y+24,34,21);block(c,x+19,y+5,23,23,{face:'#c0ccca',top:'#e0e9e1',side:'#7d969b'});
 c.fillStyle='#263d4b';c.fillRect(x+23,y+10,14,10);c.fillStyle='#73b5c8';c.fillRect(x+24,y+11,11,6);c.fillStyle='#b8e8e9';c.fillRect(x+25,y+11,7,2);
 block(c,x+1,y+29,12,14);c.fillStyle='#b9c9c7';c.fillRect(x+3,y+42,3,8);c.fillRect(x+10,y+42,3,8);
 block(c,x+46,y+29,12,12);c.fillStyle='#809da5';c.fillRect(x+55,y+34,6,5);c.fillStyle='#d1e3df';c.fillRect(x+59,y+35,4,3);
 c.fillStyle=accent;c.fillRect(x+14,y+28,5,10);c.fillRect(x+41,y+28,5,10);c.fillRect(x+22,y+4,15,2);c.fillStyle='#ecd18f';c.fillRect(x+37,y+1,4,3);
 c.fillStyle='#d5e1dc';c.fillRect(x+16,y+40,2,9);c.fillRect(x+42,y+40,2,9);
}
function probePortrait(c,x,y,accent){
 block(c,x+17,y+17,31,15,{face:'#cfa642',top:'#f0d27b',side:'#8b6d28',depth:4});block(c,x+24,y+9,18,13,{face:'#e2bf67',top:'#fae29b',side:'#9f7e33',depth:3});
 block(c,x+2,y+16,11,17,{face:'#cda03e',top:'#f1cd6e',side:'#8b6726',depth:3});block(c,x+51,y+16,11,17,{face:'#cda03e',top:'#f1cd6e',side:'#8b6726',depth:3});
 c.fillStyle='#e3b64c';c.fillRect(x+12,y+29,6,18);c.fillRect(x+45,y+29,6,18);c.fillStyle='#ffe198';c.fillRect(x+13,y+29,2,13);c.fillRect(x+46,y+29,2,13);
 c.fillStyle='#285569';c.fillRect(x+28,y+17,11,8);c.fillStyle='#7fcee9';c.fillRect(x+29,y+18,8,5);c.fillStyle='#d0f4f4';c.fillRect(x+30,y+18,4,2);c.fillStyle=accent;c.fillRect(x+4,y+16,6,2);c.fillRect(x+53,y+16,6,2);
}
function helmetPortrait(c,x,y,accent){
 c.fillStyle='#273d34';c.fillRect(x,y,64,57);for(let row=0;row<8;row++){c.fillStyle=row%2?'#2e453b':'#293e35';c.fillRect(x,y+row*7,64,3);}
 block(c,x+8,y+6,49,19,{face:'#7d9493',top:'#b5c9bd',side:'#425d62',depth:4});c.fillStyle=accent;c.fillRect(x+11,y+9,39,4);
 c.fillStyle='#c49b70';c.fillRect(x+17,y+23,31,26);c.fillStyle='#e0ba8c';c.fillRect(x+20,y+24,24,20);c.fillStyle='#293a3f';c.fillRect(x+16,y+24,33,12);c.fillStyle='#74a7ad';c.fillRect(x+19,y+26,26,5);c.fillStyle='#b9dbd8';c.fillRect(x+20,y+26,8,2);
 block(c,x+8,y+25,7,20,{face:'#778d8b',top:'#a0b4a9',side:'#3c5559',depth:2});block(c,x+49,y+25,7,20,{face:'#778d8b',top:'#a0b4a9',side:'#3c5559',depth:2});
 c.fillStyle='#7f593e';c.fillRect(x+28,y+42,10,2);c.fillStyle='#536e70';c.fillRect(x+8,y+49,49,8);c.fillStyle=accent;c.fillRect(x+28,y+50,11,3);
}
function icon(c,type,x,y,color){
 c.fillStyle=color;
 const p=(a,b,w,h)=>c.fillRect(x+a,y+b,w,h);
 if(type==='arrow'){p(2,10,13,4);p(12,4,4,16);p(16,7,3,10);p(19,10,3,4);}
 else if(type==='stop'){p(4,4,17,17);c.fillStyle='#34443b';p(8,8,9,9);}
 else if(type==='focus'){for(const[a,b]of[[2,2],[16,2],[2,16],[16,16]]){p(a,b,7,2);p(a,b,2,7);}p(10,10,4,4);}
 else if(type==='wrench'){p(4,2,5,8);p(14,2,5,8);p(7,8,9,5);p(10,12,5,9);p(7,19,10,3);}
 else if(type==='crystal'){c.fillStyle='#2f7198';p(5,10,15,11);c.fillStyle='#7ac5e7';p(9,2,6,17);p(3,9,5,10);p(16,6,5,14);c.fillStyle='#c3e7ef';p(10,3,2,11);p(4,10,2,6);}
 else if(type==='map'){for(let row=0;row<3;row++)for(let col=0;col<3;col++){c.fillStyle=(row+col)%2?'#829a72':'#c0cdb8';p(2+col*7,2+row*7,6,6);}c.fillStyle=color;p(11,9,4,4);}
 else if(type==='plus'){p(10,2,5,20);p(3,9,19,5);c.fillStyle='#d0e0d0';p(11,3,2,5);}
 else if(type==='base'){c.fillStyle='#899b9c';p(4,8,17,12);p(1,11,23,6);c.fillStyle='#c0d1cb';p(7,3,11,8);c.fillStyle=color;p(4,16,17,3);c.fillStyle='#334a50';p(9,5,7,3);}
 else if(type==='question'){const grid=['01110','11011','00011','00110','01100','00000','01100'];for(let row=0;row<grid.length;row++)for(let col=0;col<5;col++)if(grid[row][col]==='1')p(col*3+4,row*3+1,3,3);}
}
export function selectedHUDIdentity(session){return /claude|anthropic/i.test(String(session?.engine||''))?'PROBE':session?'SCV':'NONE';}
export class VoxelHUD{
 constructor(canvas){this.canvas=canvas;this.context=canvas.getContext('2d');this.lastKey='';this.drawCount=0;this.identity='NONE';this.portraitIdentity='NONE';this.status='';}
 draw({accent='#EDB3CC',selected=null,mode='native'}={}){const identity=selectedHUDIdentity(selected),status=selected?.status||'idle',key=JSON.stringify([accent,selected?.id,selected?.engine,status,selected?.resultPending,selected?.reviewed,mode]);if(key===this.lastKey)return false;this.lastKey=key;this.identity=identity;this.portraitIdentity=identity==='PROBE'?'PROBE_GOLD_OPTIC':identity==='SCV'?'BLOCK_HELMET_OPERATOR':'NONE';this.status=status;this.drawCount++;
  const c=this.context;c.imageSmoothingEnabled=false;c.clearRect(0,0,640,480);c.fillStyle='#343d35';c.fillRect(...HUD_REGIONS.full);
  // Low-frequency pixel stone, not glossy curves or reused classic chrome.
  for(let row=0;row<21;row++)for(let col=0;col<80;col++){const n=((col*47+row*29)^(row*13))%7;c.fillStyle=n<2?'#39443a':n===3?'#30392f':'#364035';c.fillRect(col*8,316+row*8,8,8);}
  c.fillStyle='#101a14';c.fillRect(0,316,640,4);c.fillStyle='#a0ae99';c.fillRect(0,320,640,2);c.fillStyle=accent;c.fillRect(143,316,2,164);c.fillRect(488,316,2,164);
  panel(c,0,316,142,164);panel(c,144,316,344,55);panel(c,144,373,259,107);panel(c,405,380,83,100);panel(c,491,343,149,137);
  panel(c,4,320,62,25,{fill:'#56634f',light:'#8a9b7f'});panel(c,75,320,61,25,{fill:'#56634f',light:'#8a9b7f'});inset(c,4,348,132,130);
  inset(c,153,382,82,94);inset(c,407,410,78,67);panel(c,412,385,70,24,{fill:'#54634e',light:'#8c9f7e'});
  for(const[x,y]of[[1,317],[135,317],[146,317],[481,317],[493,345],[633,345],[146,473],[396,473]])bolt(c,x+1,y+1);
  // Informational names and state only: there is deliberately no 60/60, HP,
  // progress, completion percentage, or resource counter in either portrait.
  pixelText(c,'SESSION CONTROL',181,331,'#b6c5ac');pixelText(c,'VOXEL',429,331,accent);
  for(let x=155;x<476;x+=12){c.fillStyle=x%24?'#2e3b2f':'#687b60';c.fillRect(x,350,7,3);}c.fillStyle='#111d16';c.fillRect(238,385,160,90);
  if(identity==='SCV'){mechPortrait(c,164,395,accent);helmetPortrait(c,414,416,accent);}else if(identity==='PROBE'){probePortrait(c,164,404,accent);probePortrait(c,414,417,accent);}else{pixelText(c,'SELECT',175,416,'#80947f');pixelText(c,'UNIT',179,426,'#80947f');pixelText(c,'NO LINK',427,440,'#80947f');}
  pixelText(c,identity==='NONE'?'UNIT':identity,identity==='PROBE'?180:186,460,accent);
  const state=mode==='preview'?'DEMO':status==='working'?'RUN':status==='queued'?'WAIT':selected?.resultPending?'CHECK':'IDLE';pixelText(c,state,identity==='PROBE'?181:184,469,accent);
  for(const command of HUD_COMMANDS){const[x,y,w,h]=command.rect;panel(c,x-2,y-2,w+4,h+4,{fill:'#59654f',light:'#99aa8a',dark:'#273325',depth:2});inset(c,x+2,y+2,w-4,h-4);const tint=command.id==='stop'&&status!=='working'?'#65745f':accent;icon(c,command.glyph,x+Math.floor((w-25)/2),y+Math.floor((h-24)/2),tint);}
  return true;
 }
 diagnostics(){return{source:'procedural-canvas-pixel-blocks',drawCount:this.drawCount,selectedIdentity:this.identity,portraitIdentity:this.portraitIdentity,status:this.status,regions:HUD_REGIONS,commands:HUD_COMMANDS.map(c=>({id:c.id,meaning:c.meaning,glyph:c.glyph,rect:c.rect})),resourceOrHealthStatsDrawn:false};}
}
