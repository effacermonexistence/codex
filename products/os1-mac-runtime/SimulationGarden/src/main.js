import './style.css';
import { CommandScene } from './scene.js';
const $ = q => document.querySelector(q);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const glyph = (type) => ({worker:'♙',new:'＋',chat:'↗',focus:'⌖',close:'×',arrow:'→',stop:'■'}[type]);
let data = { sessions: [], selectedID: null, selectedOutput: '', notice: '', total: 0 }, page = 0, query = '', filter = 'all', scene;
const drafts = new Map();
$('#app').innerHTML = `<section class="garden"><div id="scene"></div><div class="vignette"></div><header><div class="garden-brand"><span class="brand-mark">⬡</span><div><span class="eyebrow">OS1 · YOUR SESSIONS, ALIVE</span><h1>시뮬레이션<span>.</span></h1></div></div><div class="metrics"><div><b id="total">0</b><span>SESSIONS</span></div><div><i></i><b id="working">0</b><span>WORKING</span></div><button id="close" title="채팅으로 돌아가기">채팅으로 <span>↗</span></button></div></header>
<aside class="roster"><div class="roster-head"><span>SESSION FLEET</span><span id="shown"></span></div><label class="search"><span>⌕</span><input id="search" placeholder="세션 이름 검색…" aria-label="세션 이름 검색"></label><div class="filters"><button data-filter="all" class="active">전체</button><button data-filter="working">작업 중</button><button data-filter="idle">대기</button></div><div id="units" role="list" aria-label="실제 OS1 세션"></div><div class="pager"><button id="prev" aria-label="이전 세션">←</button><span id="page"></span><button id="next" aria-label="다음 세션">→</button></div><button id="new">＋ 새 SCV <span>새 OS1 세션</span></button></aside>
<div class="field-title"><span class="eyebrow">SECTOR 01 / THE MEADOW</span><h2>A little space<br>for big ideas.</h2><p>잔디 위의 모든 SCV가<br>실제 OS1 세션입니다.</p></div><div class="field-controls"><button id="zoom-out" aria-label="축소">−</button><button id="zoom-in" aria-label="확대">＋</button><button id="focus" title="선택한 SCV 보기">⌖</button></div><div class="field-bottom"><span><i></i> OS1 LIVE STATE · NO SEPARATE ENGINE</span><span>클릭 선택 · 휠 확대 · 우클릭 이동</span></div>
<footer><div class="unit-summary"><div class="unit-icon">♙</div><div class="unit-copy"><span class="eyebrow">SELECTED SESSION</span><h3 id="selected-title">세션을 선택하세요</h3><p><i id="status-dot"></i><span id="status">연결 중</span><span id="provider"></span></p><button id="open-chat">이 SCV의 채팅 열기 ↗</button></div></div><form id="order-form"><label for="prompt">이 SCV에 작업 지시 <small>⌘↵</small></label><textarea id="prompt" rows="2" maxlength="32000" placeholder="프롬프트를 입력하세요. 같은 세션에 이어서 실행됩니다." aria-label="SCV 작업 프롬프트"></textarea><div class="dispatch-row"><span id="notice">기존 세션·대화·큐는 그대로 보존됩니다.</span><button id="stop" type="button" title="선택한 작업 중단">■</button><button id="dispatch" type="submit">작업 보내기 →</button></div></form><div class="result"><span class="eyebrow">LATEST TRANSMISSION</span><p id="result">SCV를 선택하면 최근 응답이 표시됩니다.</p><button id="result-chat">전체 대화 보기 ↗</button></div></footer></section>`;
function post(action, payload = {}) {
  const channel = window.webkit?.messageHandlers?.os1Simulation;
  if (!channel) { $('#notice').textContent = 'OS1 앱 안에서 열어 주세요. 외부 브라우저는 세션을 실행하지 않습니다.'; return; }
  channel.postMessage({ action, ...payload });
}
function matches() { return data.sessions.filter(s => s.name.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || (filter === 'working' ? s.status === 'working' : s.status !== 'working'))); }
function selected() { return data.sessions.find(s => s.id === data.selectedID); }
function select(id) { drafts.set(data.selectedID, $('#prompt').value); data.selectedID = id; $('#prompt').value = drafts.get(id) || ''; post('select', { id }); render(); }
function render() {
  const all = matches(), pages = Math.max(1, Math.ceil(all.length / 24)); page = Math.min(page, pages - 1);
  const visible = all.slice(page * 24, (page + 1) * 24), s = selected();
  $('#total').textContent = data.sessions.length; $('#working').textContent = data.sessions.filter(x => x.status === 'working').length;
  $('#shown').textContent = `${all.length} SCVs`; $('#page').textContent = `${page + 1} / ${pages}`;
  $('#prev').disabled = page === 0; $('#next').disabled = page + 1 >= pages;
  $('#units').innerHTML = visible.map(x => `<button class="unit ${x.id === data.selectedID ? 'selected' : ''}" data-id="${esc(x.id)}" aria-pressed="${x.id === data.selectedID}" title="${esc(x.name)}"><span class="robot">♙</span><span class="title">${esc(x.name)}<small>${esc(x.engine)} · ${x.status === 'working' ? '작업 중' : x.status === 'queued' ? '큐 대기' : x.status === 'completed' ? '작업 종료 · 대기' : x.status === 'failed' ? '확인 필요' : '대기 중'}</small></span><i class="${x.status}"></i></button>`).join('') || '<div class="empty">이 조건에 맞는 세션이 없습니다.</div>';
  $('#selected-title').textContent = s?.name || '세션을 선택하세요'; $('#selected-title').title = s?.name || '';
  $('#status').textContent = s?.status === 'working' ? '작업 중' : s?.status === 'queued' ? '기존 큐 대기' : s?.status === 'completed' ? '작업 종료 · 다시 지시할 수 있어요' : s?.status === 'failed' ? '기존 작업 확인 필요' : s ? '명령 대기 중' : '선택된 SCV 없음';
  $('#status-dot').className = s?.status || ''; $('#provider').textContent = s?.engine || '';
  $('#dispatch').disabled = !s || s.status === 'working'; $('#stop').disabled = s?.status !== 'working';
  $('#result').textContent = data.selectedOutput || '아직 응답이 없습니다. 작업을 보내거나 전체 대화를 열어 보세요.';
  $('#notice').textContent = data.notice || s?.activity || '기존 세션·대화·큐는 그대로 보존됩니다.';
  const visual = visible.map((x, i) => ({ ...x, number: i + 1, slot: i % 8 }));
  scene?.sync(visual, [data.selectedID]);
}
try { scene = new CommandScene($('#scene'), { select: id => select(id), move: (x, z) => { scene.moveSelected(x, z); scene.ping(x, z); } }); }
catch { $('#scene').innerHTML = '<div class="render-error">3D 화면을 열 수 없습니다. 왼쪽 세션 목록과 작업 지시는 사용할 수 있습니다.</div>'; }
window.os1SimulationUpdate = snapshot => {
  const changed = data.selectedID !== snapshot.selectedID;
  if (changed) drafts.set(data.selectedID, $('#prompt').value);
  data = snapshot; if (scene) scene.enabled = snapshot.visible;
  if (changed) { $('#prompt').value = drafts.get(data.selectedID) || ''; const index = matches().findIndex(s => s.id === data.selectedID); if (index >= 0) page = Math.floor(index / 24); }
  render();
};
$('#units').onclick = e => { const b = e.target.closest('[data-id]'); if (b) select(b.dataset.id); };
$('#search').oninput = e => { query = e.target.value; page = 0; render(); };
$('.filters').onclick = e => { const b = e.target.closest('[data-filter]'); if (!b) return; filter = b.dataset.filter; page = 0; document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === b)); render(); };
$('#prev').onclick = () => { page--; render(); }; $('#next').onclick = () => { page++; render(); };
$('#new').onclick = () => post('new'); $('#close').onclick = () => post('close');
$('#open-chat').onclick = $('#result-chat').onclick = () => data.selectedID && post('open', { id: data.selectedID });
$('#zoom-in').onclick = () => scene?.setZoom(scene.zoom * 1.15); $('#zoom-out').onclick = () => scene?.setZoom(scene.zoom / 1.15); $('#focus').onclick = () => scene?.focus(data.selectedID);
$('#order-form').onsubmit = e => { e.preventDefault(); const text = $('#prompt').value.trim(); if (!text || !selected() || selected().status === 'working') return; post('order', { id: data.selectedID, text }); drafts.set(data.selectedID, ''); $('#prompt').value = ''; };
$('#stop').onclick = () => data.selectedID && post('stop', { id: data.selectedID });
$('#prompt').oninput = () => drafts.set(data.selectedID, $('#prompt').value);
$('#prompt').onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#order-form').requestSubmit(); } };
render(); post('ready');
