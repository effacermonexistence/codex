import './style.css';
import {VoxelScene} from './voxel-scene.js';
import {applyAccent} from './theme.js';
import {battlefieldSessions,canAcknowledge,isAwaitingReview,tokenState,workerRace} from './field-state.js';

const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initial={sessions:[],selectedID:null,selectedOutputID:null,selectedResultRevision:null,selectedOutput:'',notice:'',visible:false};
let nativeData={...initial},data=nativeData,page=0,query='',rosterMode='field',pendingOrder=null,pendingSelectedID=null,stableIDs=[],scene,preview=false,displayedResult=null,inspectionScheduled=false,pendingReview=null;
const drafts=new Map(),deployedIDs=new Set(),inspectedDisplays=new Set();
const panelIDs=['order-panel','transmission','menu-panel','help-panel'];
const icon=(name)=>{
 const paths={
  cube:'M12 2 22 7v10l-10 5-10-5V7Zm0 0v10m10-5-10 5L2 7m10 5v10',
  plus:'M12 4v16M4 12h16',
  pick:'m4 20 9-9m-4-6 5-2 7 7-2 5-5-5-5-5Zm5 5 4-4',
  stop:'M6 6h12v12H6Z',
  result:'M5 3h14v18H5Zm4 5h6m-6 4h6m-6 4h4',
  focus:'M3 8V3h5m8 0h5v5m0 8v5h-5M8 21H3v-5m9-8v8m-4-4h8',
  map:'m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16',
  retry:'M20 10a8 8 0 1 0-2 8m2-14v6h-6',
  chat:'M3 4h18v13H9l-6 4Zm4 5h10m-10 4h6',
  menu:'M4 6h16M4 12h16M4 18h16',
  back:'m14 5-7 7 7 7',
  help:'M12 16v.1M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0-11a10 10 0 1 0 .01 0',
  search:'M10 3a7 7 0 1 0 .01 0m5 12 6 6',
  play:'m8 4 12 8-12 8Z',
  close:'m6 6 12 12M6 18 18 6',
  settings:'M4 7h16M4 17h16M8 4v6m8 4v6',
 };
 return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="${paths[name]||paths.cube}"/></svg>`;
};
const slot=(id,n,name,glyph,key)=>`<button id="${id}" class="inventory-slot" title="${name} (${key})" aria-label="${name} ${key}"><span class="slot-number">${n}</span><span class="slot-icon">${icon(glyph)}</span><span class="slot-label">${name}</span><kbd>${key}</kbd></button>`;

$('#app').innerHTML=`<div id="stage-shell"><main id="game" aria-label="OS1 Voxel Workshop · 실제 세션 3D 작업 월드">
 <div id="world"></div><div class="world-vignette" aria-hidden="true"></div>
 <header id="world-header"><div class="world-brand"><span class="brand-mark">${icon('cube')}</span><div><div class="brand-name">OS1 <b>VOXEL</b></div><span class="brand-subtitle">THE WORKSHOP</span></div></div>
 <div id="resource-bar" class="glass-panel"><span class="resource-gem" aria-hidden="true">◆</span><div class="resource-copy"><span id="token-title">토큰 · 관측 정보</span><b id="token-value">잔여 미측정 ?</b></div><span id="token-source"></span></div>
 <div class="header-actions"><button id="sessions-menu" class="square-button" aria-label="실제 세션 목록 F9" title="세션 목록 (F9)">${icon('menu')}</button><button id="help" class="square-button" aria-label="실행 상태 F12" title="실행 상태 (F12)">${icon('help')}</button><button id="close" class="square-button" aria-label="OS1 채팅으로" title="OS1 채팅으로">${icon('back')}</button></div></header>
 <div id="preview-banner" hidden><div class="preview-heading"><span class="preview-badge">MODEL-FREE</span><b>12 광부 동작 미리보기</b><span class="preview-disclaimer">실제 작업·토큰 아님</span></div><div class="preview-controls"><button id="preview-pause">선택 정지</button><button id="preview-resume">같은 광부 재개</button><button id="preview-finish">종료 보기</button><label class="preview-quota">예시 한도<select id="preview-budget" aria-label="미리보기 예시 한도 비율"><option value="">미측정 ?</option><option value="100">100%</option><option value="25">25%</option><option value="5">5%</option><option value="0">0%</option></select></label><button id="preview-exit">실제 세션으로 ↗</button></div></div>
 <aside id="fleet" class="glass-panel" aria-label="실제 OS1 세션 목록"><div class="fleet-head"><div><span class="eyebrow">YOUR WORKFORCE</span><h2>광부 & 세션</h2></div><span id="total" class="count-pill"></span></div><div class="fleet-tabs"><button id="tab-field" class="active">작업 월드</button><button id="tab-all">전체 세션</button></div><label id="search-label">${icon('search')}<input id="search" aria-label="세션 이름 검색" placeholder="세션 찾기…"></label><div id="units"></div><div class="fleet-nav"><button id="prev" aria-label="이전 세션">←</button><span id="page"></span><button id="next" aria-label="다음 세션">→</button></div><div class="fleet-footnote">광부 하나가 세션 하나.<br>함께 움직이면 병렬 실행 중입니다.</div></aside>
 <div id="field-summary" class="glass-panel"><span class="live-signal" aria-hidden="true"></span><span id="working-count">0 작업 중</span><span id="waiting-count"></span><span id="supply" title="월드에 표시된 실제 세션 수"></span><button id="preview-enter">${icon('play')}<span>동작 미리보기</span></button></div>
 <div id="field-empty" hidden><span class="empty-world-icon">${icon('pick')}</span><span class="eyebrow">A WORLD READY FOR WORK</span><h2>다음 작업을 시작하세요.</h2><p>광부를 만들고 프롬프트를 맡기면<br>이 월드에서 작업이 움직이기 시작합니다.</p><button id="empty-new" class="primary-button">${icon('plus')}새 광부 / 세션</button><button id="empty-preview" class="text-button">먼저 12 광부 동작 보기 →</button></div>
 <section id="selected-info" class="glass-panel" aria-label="선택한 광부 세션"><span class="selected-avatar" aria-hidden="true">${icon('pick')}</span><div class="selected-copy"><span class="eyebrow">SELECTED MINER</span><h1 id="selected-title">광부를 선택하세요</h1><div class="selected-metadata"><p id="status">명령 대기</p><span class="metadata-dot">·</span><p id="provider"></p></div><p id="usage"></p></div><div class="selected-buttons"><button id="move" class="primary-button" title="작업 배정 (Enter)">${icon('pick')}작업 배정</button><button id="view-result">결과 확인</button><button id="open-chat" title="선택 세션 대화 열기">대화 ↗</button></div></section>
 <nav id="hotbar" aria-label="광부 명령 인벤토리"><div class="hotbar-heading"><span>WORKSHOP INVENTORY</span><span>1–9 · 바로가기</span></div><div class="inventory-slots">${slot('build',1,'새 광부','plus','N')}${slot('gather',2,'프롬프트','pick','Enter')}${slot('stop',3,'정지','stop','S')}${slot('messages-menu',4,'결과','result','F11')}${slot('focus',5,'찾기','focus','Space')}${slot('all',6,'전체 맵','map','V')}${slot('repair',7,'재작업','retry','R')}${slot('base',8,'대화','chat','C')}${slot('menu',9,'메뉴','menu','F10')}</div></nav>
 <div id="command-label">휠 확대 · 우클릭 드래그로 이동 · 광부 클릭으로 선택</div>
 <section id="order-panel" class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="order-heading" hidden><div class="panel-heading"><div><span class="eyebrow">GIVE YOUR MINER A JOB</span><h2 id="order-heading">작업 배정</h2></div><button id="close-order" class="square-button" aria-label="프롬프트 닫기">${icon('close')}</button></div><p id="order-name" class="modal-session"></p><form id="order-form"><textarea id="prompt" aria-label="광부 세션 작업 프롬프트" placeholder="이 세션에 맡길 작업을 입력하세요…" maxlength="32000" rows="5"></textarea><div class="order-bottom"><span id="notice"></span><button id="dispatch" class="primary-button" type="submit">작업 보내기 →</button></div><span class="input-hint">⌘ / Ctrl + Enter 전송 · Esc 닫기 · 초안은 그대로 보존</span></form></section>
 <section id="transmission" class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="transmission-title" hidden><div class="panel-heading"><div><span class="eyebrow">RETURNED FROM THE WORKSHOP</span><h2 id="transmission-title">작업 결과</h2></div><button id="close-result" class="square-button" aria-label="응답 닫기">${icon('close')}</button></div><p id="result-name" class="modal-session"></p><pre id="result"></pre><div class="result-actions"><button id="review-result" class="primary-button" disabled>결과 확인 · 광부 귀환</button><button id="result-chat">전체 대화 ↗</button></div><p id="review-note">직접 확인한 뒤 광부만 월드에서 귀환합니다. 세션과 대화는 보존됩니다.</p></section>
 <section id="menu-panel" class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="menu-heading" hidden><div class="menu-cube">${icon('cube')}</div><span class="eyebrow">OS1 VOXEL WORKSHOP</span><h2 id="menu-heading">잠깐 쉬어가기.</h2><button id="resume" class="primary-button">월드로 돌아가기</button><button id="new">${icon('plus')}새 광부 · 실제 OS1 세션</button><button id="preview-menu">${icon('play')}동작 미리보기 · 모델 호출 없음</button><button id="appearance">${icon('settings')}색상 설정 · Appearance</button><button id="native-chat">${icon('chat')}OS1 채팅으로 돌아가기</button></section>
 <section id="help-panel" class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="help-heading" hidden><div class="panel-heading"><div><span class="eyebrow">A LIVE VIEW, NOT A SECOND ENGINE</span><h2 id="help-heading">월드 & 실행 상태</h2></div><button id="close-help" class="square-button" aria-label="상태 닫기">${icon('close')}</button></div><p><b>광부 하나 = 실제 세션 하나.</b> 실행 중인 세션은 모두 월드에서 움직입니다. 목록의 검색·페이지는 월드의 병렬 작업 수를 제한하지 않습니다.</p><p>실행 중엔 광석과 본진을 왕복합니다. 작업이 멈추면 그 위치에서 기다리고, 반환된 결과를 직접 확인한 뒤 귀환합니다. 같은 세션에 다시 작업을 맡길 수도 있습니다.</p><p>광석은 공급자가 제공한 토큰·잔여 한도 관측을 표현합니다. 미측정은 <b>?</b>, 실제 잔여 한도는 <b>%</b>로 구분합니다. 왕복 횟수로 토큰을 만들지 않습니다.</p><pre id="pixel-check"></pre></section>
</main></div>`;

function post(action,payload={}){
 if(preview)return false;
 const channel=window.webkit?.messageHandlers?.os1Simulation;
 if(!channel){$('#notice').textContent='OS1 앱 안에서 실제 세션에 연결됩니다.';return false;}
 channel.postMessage({action,...payload});return true;
}
const currentID=()=>pendingSelectedID??data.selectedID;
const selected=()=>data.sessions.find(s=>s.id===currentID());
const field=()=>battlefieldSessions(data.sessions,deployedIDs);
function ordered(){const base=rosterMode==='field'?field():data.sessions,byID=new Map(base.map(s=>[s.id,s]));return stableIDs.map(id=>byID.get(id)).filter(Boolean).filter(s=>s.name.toLowerCase().includes(query.toLowerCase()));}
function visibleRoster(){return ordered().slice(page*6,page*6+6);}
function semanticKey(d){return JSON.stringify([d.selectedID,d.selectedOutputID,d.selectedResultRevision,d.selectedOutput,d.notice,d.visible,d.accentHex,d.tokenPool,d.tokenPools,d.sessions.map(s=>[s.id,s.name,s.engine,s.status,s.activity,s.tokensUsed,s.usageLabel,s.resultRevision,s.reviewed,s.hasResult,s.featured,s.resultPending])]);}
function closePanels(){for(const id of panelIDs)$('#'+id).hidden=true;displayedResult=null;}
function openPanel(id){for(const panel of panelIDs)$('#'+panel).hidden=panel!==id;if(id!=='transmission')displayedResult=null;}
function select(id,inspect=true){
 drafts.set(currentID(),$('#prompt').value);pendingSelectedID=id;displayedResult=null;$('#prompt').value=drafts.get(id)||'';deployedIDs.add(id);
 if(preview){data.selectedID=id;data.selectedOutputID=id;data.selectedResultRevision=selected()?.resultRevision??null;data.selectedOutput=selected()?.hasResult?'미리보기 작업이 종료되었습니다. 실제 모델 응답이 아닙니다.':'';pendingSelectedID=null;}else post('select',{id});
 if(inspect&&selected()?.hasResult)openPanel('transmission');render();
}
function openOrder(){
 if(!selected())return;
 if(preview){$('#preview-banner').classList.add('attention');setTimeout(()=>$('#preview-banner').classList.remove('attention'),500);return;}
 deployedIDs.add(currentID());openPanel('order-panel');$('#prompt').focus();render();
}
function outputBinding(){const s=selected(),id=currentID(),matched=data.selectedID===id&&(data.selectedOutputID??data.selectedID)===id&&(!data.selectedResultRevision||data.selectedResultRevision===s?.resultRevision);return{matched,output:matched?data.selectedOutput||'':'',revision:matched?s?.resultRevision:null};}
function showResult(){if(!selected())return;openPanel('transmission');displayedResult=null;render();}
function inspectDisplayedResult(){
 if(inspectionScheduled||$('#transmission').hidden||!data.visible||document.visibilityState==='hidden')return;
 inspectionScheduled=true;
 requestAnimationFrame(()=>requestAnimationFrame(()=>{
  inspectionScheduled=false;const s=selected(),bound=outputBinding();
  if($('#transmission').hidden||!data.visible||document.visibilityState==='hidden'||!s||!bound.matched||!bound.output||!bound.revision)return;
  displayedResult={id:s.id,revision:bound.revision,hasOutput:true};const key=s.id+':'+bound.revision;
  if(!inspectedDisplays.has(key)){if(preview||post('inspect',{id:s.id,text:bound.revision}))inspectedDisplays.add(key);}
  $('#review-result').disabled=!canAcknowledge(s,displayedResult)||!!pendingReview;
 }));
}
// Readable display only. Tiny positive balances must not round to an
// exhausted 0%, nor almost-full observations to an asserted full 100%.
const formatPercent=value=>value>0&&value<.1?'<0.1':value>99.9&&value<100?'>99.9':new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(value);
function resourceText(){
 const pool=tokenState(data.tokenPool),format=n=>n.toLocaleString('en-US');
 $('#token-title').textContent=preview?'PREVIEW · 예시 한도':'TOKENS & QUOTA';
 $('#token-value').textContent=preview?(pool.remainingPercent!==null?`예시 ${formatPercent(pool.remainingPercent)}%`:'예시 미측정 ?'):pool.remaining!==null?`${format(pool.remaining)} 남음`:pool.remainingPercent!==null?`${formatPercent(pool.remainingPercent)}% 남음`:pool.used!==null?`${format(pool.used)} 사용`:'잔여 미측정 ?';
 $('#token-source').textContent=preview?'실제 토큰 아님':pool.remainingPercent!==null?(data.tokenPool?.quota?.basis==='retained_estimate'?'보관 추정':'한도 관측'):pool.used!==null?'실측':'UNKNOWN';
 $('#resource-bar').title=preview?'모델 호출 없는 미리보기 · 실제 작업/토큰 아님':[pool.label,pool.source,data.tokenPool?.quota?.basis,data.tokenPool?.quota?.observedAt].filter(Boolean).join('\n');
}
function engineLabel(session){const race=workerRace(session);return race==='terran'?'CODEX':race==='protoss'?'CLAUDE':session?.engine||'엔진 경로 대기';}
function render(){
 const accent=applyAccent(data.accentHex);scene?.setAccent(accent);
 const list=ordered(),pages=Math.max(1,Math.ceil(list.length/6));page=Math.min(Math.max(0,page),pages-1);
 const s=selected(),workers=field(),running=workers.filter(s=>s.status==='working').length,waiting=workers.filter(isAwaitingReview).length;
 $('#total').textContent=`${workers.length} / ${data.sessions.length}`;$('#page').textContent=`${page+1} / ${pages}`;$('#prev').disabled=page===0;$('#next').disabled=page+1>=pages;
 $('#supply').textContent=`${workers.length} 광부`;
 $('#working-count').textContent=preview?`${running} PREVIEW`:`${running} 작업 중`;
 $('#waiting-count').textContent=waiting?`${waiting} 결과 대기`:workers.length?'WORLD IS LIVE':'대기 중';
 $('#field-empty').hidden=workers.length>0;$('#preview-banner').hidden=!preview;$('#preview-enter').hidden=preview;
 $('#game').classList.toggle('preview-mode',preview);$('#game').classList.toggle('has-selection',!!s);
 $('#tab-field').classList.toggle('active',rosterMode==='field');$('#tab-all').classList.toggle('active',rosterMode==='all');resourceText();
 $('#units').innerHTML=visibleRoster().map((s,i)=>`<button data-id="${esc(s.id)}" class="session ${s.id===currentID()?'selected':''}" aria-pressed="${s.id===currentID()}" title="${esc(s.name)}"><span class="unit-number">${String(page*6+i+1).padStart(2,'0')}</span><span class="session-copy"><span class="session-name">${esc(s.name)}</span><span class="session-engine">${esc(engineLabel(s))}</span></span><i class="${isAwaitingReview(s)?'result':esc(s.status)}" aria-hidden="true"></i></button>`).join('')||'<p class="empty">해당 세션이 없습니다.</p>';
 $('#selected-title').textContent=s?.name||'광부를 선택하세요';$('#selected-title').title=s?.name||'';$('#order-name').textContent=s?.name||'';
 $('#provider').textContent=s?engineLabel(s):'실제 세션을 선택하거나 새로 만드세요';
 $('#status').textContent=s?.status==='working'?(preview?'미리보기 · 채광 중':'실제 작업 실행 중'):s?.status==='queued'?(preview?'미리보기 · 대기':'실제 작업 대기'):isAwaitingReview(s)?(preview?'미리보기 · 종료 / 결과 확인':s.status==='failed'?'작업 오류 · 결과 확인 필요':'작업 종료 · 결과 확인 필요'):s?.reviewed?(preview?'미리보기 · 보관됨':'보관됨 · 다시 배정 가능'):s?(preview?'미리보기 · 정지':'명령 대기'):'선택된 광부 없음';
 $('#status').className=s?.status||'';$('#usage').textContent=s?.tokensUsed!=null?`이 작업 ${s.tokensUsed.toLocaleString('en-US')} tokens`:s?.usageLabel||'토큰 계측은 실제 관측이 있을 때 표시됩니다.';
 const bound=outputBinding();$('#result-name').textContent=s?.name||'';$('#result').textContent=bound.matched?bound.output||'아직 수신된 결과가 없습니다.':'선택한 세션의 결과를 수신 중…';
 $('#transmission-title').textContent=preview?'미리보기 결과 · 실제 응답 아님':s?.status==='failed'?'작업 오류 / 반환 결과':'작업 결과';
 $('#review-result').disabled=!canAcknowledge(s,displayedResult)||!bound.matched||!!pendingReview;
 $('#review-result').textContent=pendingReview?'확인 반영 중…':s?.reviewed?'확인됨 · 대화 보존':'결과 확인 · 광부 귀환';
 $('#view-result').disabled=!s?.hasResult;$('#messages-menu').disabled=!s?.hasResult;
 $('#notice').textContent=data.notice||s?.activity||'같은 실제 OS1 세션에 이어서 실행됩니다.';
 $('#dispatch').disabled=!s||s.status==='working'||preview||pendingOrder?.id===currentID();
 $('#stop').disabled=s?.status!=='working';$('#stop').setAttribute('aria-label',preview?'미리보기 광부 정지':'선택한 실제 세션 중단');$('#stop').title=preview?'미리보기 광부 정지 · 모델 호출 없음':'실제 작업 중단 (S)';
 for(const id of['open-chat','result-chat','base','new','build','appearance','native-chat','close','empty-new'])$('#'+id).disabled=preview;
 for(const id of['move','gather','repair'])$('#'+id).disabled=!s||preview||s.status==='working';
 $('#command-label').textContent=preview?'미리보기 전용 · 실제 작업/토큰 아님 · 상단에서 정지 / 재개 / 종료':'휠 확대 · 우클릭 드래그로 이동 · 광부 클릭으로 선택';
 scene?.sync(workers,currentID(),data.visible,data.tokenPool,data.tokenPools);inspectDisplayedResult();
}

scene=new VoxelScene($('#world'),id=>select(id,true));
scene.ready.then(()=>render()).catch(e=>{$('#notice').textContent=e.message;openPanel('order-panel');});
let lastSemantic='';
window.os1SimulationUpdate=snapshot=>{
 const key=semanticKey(snapshot);if(key===lastSemantic)return;lastSemantic=key;nativeData=snapshot;
 if(preview){data.visible=snapshot.visible;render();return;}
 const oldID=currentID(),incoming=snapshot.sessions.map(s=>s.id),added=incoming.filter(id=>!stableIDs.includes(id));
 if(stableIDs.length)for(const id of added)deployedIDs.add(id);
 stableIDs=stableIDs.length?[...added,...stableIDs.filter(id=>incoming.includes(id))]:incoming;data=snapshot;
 if(pendingSelectedID===snapshot.selectedID)pendingSelectedID=null;
 if(pendingReview){const s=data.sessions.find(s=>s.id===pendingReview.id);if(s?.reviewed===true&&s.resultRevision===pendingReview.revision){deployedIDs.delete(s.id);pendingReview=null;displayedResult=null;$('#transmission').hidden=true;}else if(!s||s.resultRevision!==pendingReview.revision||s.status==='working'){pendingReview=null;displayedResult=null;}}
 if(pendingOrder){const s=data.sessions.find(s=>s.id===pendingOrder.id);if(s&&['working','queued'].includes(s.status)){if(currentID()===pendingOrder.id&&$('#prompt').value===pendingOrder.text)$('#prompt').value='';drafts.set(pendingOrder.id,'');pendingOrder=null;$('#order-panel').hidden=true;}else if(data.notice)pendingOrder=null;}
 if(oldID!==currentID()){drafts.set(oldID,$('#prompt').value);$('#prompt').value=drafts.get(currentID())||'';displayedResult=null;}
 render();
};
$('#units').onclick=e=>{const b=e.target.closest('[data-id]');if(b)select(b.dataset.id);};
$('#search').oninput=e=>{query=e.target.value;page=0;render();};
$('#prev').onclick=()=>{page--;render();};$('#next').onclick=()=>{page++;render();};
$('#tab-field').onclick=()=>{rosterMode='field';page=0;render();};$('#tab-all').onclick=()=>{rosterMode='all';page=0;render();};
$('#order-form').onsubmit=e=>{
 e.preventDefault();const text=$('#prompt').value.trim();
 if(preview||!text||!selected()||selected().status==='working'||pendingOrder)return;
 pendingOrder={id:currentID(),text};deployedIDs.add(currentID());post('order',{id:currentID(),text});render();
};
$('#prompt').oninput=()=>drafts.set(currentID(),$('#prompt').value);
$('#prompt').onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();$('#order-form').requestSubmit();}};
$('#open-chat').onclick=$('#result-chat').onclick=$('#base').onclick=()=>currentID()&&post('open',{id:currentID()});
$('#close').onclick=$('#native-chat').onclick=()=>post('close');
$('#new').onclick=$('#build').onclick=$('#empty-new').onclick=()=>post('new');
$('#stop').onclick=()=>{if(preview){previewPause();return;}if(currentID())post('stop',{id:currentID()});};
$('#move').onclick=$('#gather').onclick=$('#repair').onclick=openOrder;
$('#focus').onclick=()=>scene.focus(currentID());$('#all').onclick=()=>scene.fit();
$('#menu').onclick=()=>{const wasHidden=$('#menu-panel').hidden;closePanels();if(wasHidden)openPanel('menu-panel');};
$('#resume').onclick=closePanels;$('#messages-menu').onclick=$('#view-result').onclick=showResult;
$('#close-result').onclick=()=>{displayedResult=null;$('#transmission').hidden=true;};
$('#close-order').onclick=()=>$('#order-panel').hidden=true;
$('#sessions-menu').onclick=()=>$('#fleet').classList.toggle('hidden-fleet');$('#appearance').onclick=()=>post('settings');
$('#review-result').onclick=()=>{
 const s=selected();if(!canAcknowledge(s,displayedResult))return;
 if(preview){s.reviewed=true;s.resultPending=false;s.featured=false;deployedIDs.delete(s.id);$('#transmission').hidden=true;displayedResult=null;render();return;}
 pendingReview={id:s.id,revision:s.resultRevision};if(!post('review',{id:s.id,text:s.resultRevision}))pendingReview=null;render();
};
function showHelp(){
 const d=scene.diagnostics();
 $('#pixel-check').textContent=`MODE: ${preview?'MODEL-FREE PREVIEW':'NATIVE SESSIONS'}\nRENDERER: ${d.renderer||'Voxel 3D'}\nFPS: ${Number.isFinite(d.fps)?Math.round(d.fps):'—'}\nDRAW CALLS: ${Number.isFinite(d.drawCalls)?d.drawCalls:'—'}\nWORLD MINERS: ${d.workers.length} · MOVING: ${d.moving} · MINING: ${d.mining}\nTOKEN SOURCE: ${d.tokenPool?.source||'unavailable'}\nQUOTA BASIS: ${data.tokenPool?.quota?.basis||'미제공'}\nOBSERVED AT: ${data.tokenPool?.quota?.observedAt||'미제공'}\n\n토큰 계측과 화면 동작은 별개입니다. 미리보기는 모델을 호출하지 않습니다.`;
}
$('#help').onclick=()=>{const wasHidden=$('#help-panel').hidden;closePanels();if(wasHidden){openPanel('help-panel');showHelp();}};
$('#close-help').onclick=()=>$('#help-panel').hidden=true;

// Synthetic cohort stays isolated from native snapshots and the native bridge.
function enterPreview(){
 if(preview)return;drafts.set(currentID(),$('#prompt').value);preview=true;pendingSelectedID=null;pendingReview=null;displayedResult=null;deployedIDs.clear();
 data={...initial,visible:true,accentHex:nativeData.accentHex,selectedID:'preview-worker-01',selectedOutputID:'preview-worker-01',sessions:Array.from({length:12},(_,i)=>({id:`preview-worker-${String(i+1).padStart(2,'0')}`,name:`미리보기 광부 ${String(i+1).padStart(2,'0')}`,engine:i<8?'Codex · 미리보기':'Claude · 미리보기',status:'working',featured:true,hasResult:false,resultPending:false,reviewed:false})),tokenPool:{label:'PREVIEW',source:'모델 호출 없음 · 실제 토큰 아님'}};
 stableIDs=data.sessions.map(s=>s.id);query='';$('#search').value='';page=0;rosterMode='field';closePanels();$('#preview-budget').value='';scene.setMode('preview');render();
}
function exitPreview(){
 if(!preview)return;preview=false;data=nativeData;stableIDs=data.sessions.map(s=>s.id);pendingSelectedID=null;displayedResult=null;deployedIDs.clear();rosterMode='field';page=0;$('#prompt').value=drafts.get(data.selectedID)||'';closePanels();scene.setMode('native');render();
}
$('#preview-budget').onchange=e=>{if(!preview)return;data.tokenPool={label:'미리보기 예시 한도',remainingPercent:e.target.value===''?null:Number(e.target.value),source:'미리보기용 예시 비율 · 실제 토큰 아님'};render();};
function previewPause(){const s=selected();if(!preview||!s)return;s.status='idle';s.featured=true;s.resultPending=false;render();}
$('#preview-enter').onclick=$('#empty-preview').onclick=$('#preview-menu').onclick=enterPreview;
$('#preview-exit').onclick=exitPreview;$('#preview-pause').onclick=previewPause;
$('#preview-resume').onclick=()=>{const s=selected();if(!preview||!s)return;s.status='working';s.reviewed=false;s.resultPending=false;s.hasResult=false;s.featured=true;data.selectedOutput='';data.selectedResultRevision=null;deployedIDs.add(s.id);$('#transmission').hidden=true;render();};
$('#preview-finish').onclick=()=>{const s=selected();if(!preview||!s)return;s.status='idle';s.hasResult=true;s.resultPending=true;s.reviewed=false;s.resultRevision=`${s.id}:preview-result`;data.selectedOutputID=s.id;data.selectedResultRevision=s.resultRevision;data.selectedOutput='미리보기 작업이 종료되었습니다. 실제 모델 응답이 아닙니다.\n\n광부는 현 위치에 멈춥니다. 결과를 직접 확인하면 월드에서 귀환하고, 같은 세션에 다시 배정할 수 있습니다.';showResult();};
document.addEventListener('keydown',e=>{
 if(e.metaKey||e.ctrlKey||e.altKey)return;
 if(e.key==='Escape'){e.preventDefault();closePanels();return;}
 if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable)return;
 const hotbar=['build','gather','stop','messages-menu','focus','all','repair','base','menu'];
 const n=Number(e.key);if(Number.isInteger(n)&&n>=1&&n<=9){e.preventDefault();$('#'+hotbar[n-1]).click();return;}
 const key=e.key.length===1?e.key.toLowerCase():e.key;
 const action={Enter:openOrder,g:openOrder,m:openOrder,r:openOrder,s:()=>$('#stop').click(),n:()=>$('#build').click(),v:()=>scene.fit(),c:()=>$('#base').click(),' ':()=>scene.focus(currentID()),F9:()=>$('#sessions-menu').click(),F10:()=>$('#menu').click(),F11:showResult,F12:()=>$('#help').click()}[key];
 if(action){e.preventDefault();action();}
});
// Read-only diagnostics; never an alternate session/execution control API.
window.os1SimulationDiagnostics=()=>({...scene.diagnostics(),uiVersion:'voxel-workshop-v1',nativeSessionCount:nativeData.sessions.length,selectedID:currentID(),selectedOutputID:data.selectedOutputID,selectedResultRevision:data.selectedResultRevision,displayedResult,canAcknowledge:canAcknowledge(selected(),displayedResult),rosterMode,rosterPage:page});
new ResizeObserver(()=>scene?.resize?.()).observe($('#world'));
render();post('ready');
