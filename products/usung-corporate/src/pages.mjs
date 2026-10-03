export const nav = (active = '') => `<header class="corp-header">
  <div class="corp-nav-inner">
    <a class="corp-brand" href="/" aria-label="유성 메인"><svg viewBox="0 0 24 25" aria-hidden="true"><path d="M2 3v12c0 5 4 8 10 8s10-3 10-8V3h-4v12c0 3-2 4-6 4s-6-1-6-4V3z"/><path d="M10 2h4v13h-4z"/></svg><span>U-SUNG</span></a>
    <button class="corp-menu-toggle" aria-expanded="false" aria-controls="corp-navigation" aria-label="사업 메뉴 열기"><span></span><span></span></button>
    <nav class="corp-nav" id="corp-navigation" aria-label="유성 사업 메뉴">
      <a href="/#company">유성 소개</a>
      <a href="/ai/" ${active === 'ai' ? 'aria-current="page"' : ''}>AI</a>
      <a href="/smart-construction/" ${active === 'construction' ? 'aria-current="page"' : ''}>스마트 건설</a>
      <a href="/physical-ai/" ${active === 'physical' ? 'aria-current="page"' : ''}>Physical AI</a>
      <a class="corp-nav-contact" href="/#contact">문의하기 <span aria-hidden="true">↗</span></a>
    </nav>
  </div>
</header>`;

export const footer = `<footer class="corp-footer">
  <div class="corp-footer-top"><a class="corp-wordmark" href="/">U-SUNG</a><p>현실을 짓고. 가능성을 넓히다.</p></div>
  <div class="corp-footer-bottom"><div><strong>유성건설 주식회사</strong><span>부산광역시 동구 중앙대로 373, 3층</span></div><div><a href="tel:+82514699700">051-469-9700</a><span>© ${new Date().getUTCFullYear()} U-SUNG. All rights reserved.</span></div></div>
</footer>`;

export const contact = `<section class="corp-contact" id="contact"><p class="corp-eyebrow">LET’S MOVE FORWARD</p><h2>당신의 다음을,<br>유성과 함께.</h2><p class="corp-contact-copy">AI 도입부터 새로운 현장의 구상까지.<br>함께 풀어갈 과제를 이야기해 주세요.</p><a class="corp-button" href="mailto:qoengks12@hanmail.net">프로젝트 문의 <span aria-hidden="true">↗</span></a><a class="corp-contact-email" href="mailto:qoengks12@hanmail.net">qoengks12@hanmail.net</a></section>`;

export const systemVisual = `<div class="corp-system-visual" aria-hidden="true">
  <div class="corp-orbit corp-orbit-one"></div><div class="corp-orbit corp-orbit-two"></div><div class="corp-visual-ground"></div>
  <div class="corp-layer corp-layer-back"><div class="corp-layer-top"><span>03</span><span>PHYSICAL AI</span></div><div class="corp-robot-shape"><i></i><b></b><em></em><span></span></div><span class="corp-layer-caption">Intelligence in motion.</span></div>
  <div class="corp-layer corp-layer-mid"><div class="corp-layer-top"><span>02</span><span>SMART CONSTRUCTION</span></div><div class="corp-building-shape"><i></i><i></i><i></i></div><span class="corp-layer-caption">A new way to build.</span></div>
  <div class="corp-layer corp-layer-front"><div class="corp-layer-top"><span>01</span><span>AI & AX</span></div><div class="corp-intelligence"><span></span><span></span><span></span><span></span><i></i></div><span class="corp-layer-caption">From insight to action.</span></div>
  <span class="corp-visual-label"><i></i> CONNECTED POSSIBILITIES</span>
</div>`;

export const home = `<main id="main-content">
  <section class="corp-home-hero">
    <p class="corp-eyebrow">U-SUNG · BEYOND CONSTRUCTION</p>
    <h1>현실을 짓고.<br><span>가능성을 넓히다.</span></h1>
    <p class="corp-hero-copy">건설의 경험에 AI의 지능을 더합니다.<br>사람, 기술, 현장이 연결되는 새로운 유성.</p>
    <a class="corp-text-link" href="#business">유성의 사업 살펴보기 <span aria-hidden="true">↓</span></a>
    ${systemVisual}
  </section>
  <section class="corp-business" id="business">
    <div class="corp-section-heading"><p class="corp-eyebrow">OUR BUSINESSES</p><h2>하나의 유성.<br>더 넓은 가능성.</h2><p>디지털에서 실제 현장까지.<br>각 분야의 전문성을 하나의 실행력으로 연결합니다.</p></div>
    <div class="corp-business-grid">
      <a class="corp-business-card corp-ai-card" href="/ai/"><span class="corp-card-number">01 / INTELLIGENCE</span><h3>AI</h3><p>신뢰할 수 있는 AI.<br>업무를 바꾸는 AX.</p><div class="corp-card-ai-art" aria-hidden="true"><i></i><i></i><i></i><b></b></div><span class="corp-card-link">AI 사업 알아보기 <b aria-hidden="true">↗</b></span></a>
      <a class="corp-business-card corp-build-card" href="/smart-construction/"><span class="corp-card-number">02 / CONSTRUCTION</span><h3>스마트 건설</h3><p>현장을 이해하는 경험.<br>기술로 넓어지는 건설.</p><div class="corp-card-build-art" aria-hidden="true"><i></i><i></i><i></i><i></i></div><span class="corp-card-link">스마트 건설 알아보기 <b aria-hidden="true">↗</b></span></a>
      <a class="corp-business-card corp-physical-card" href="/physical-ai/"><span class="corp-card-number">03 / REAL-WORLD AI</span><h3>Physical AI</h3><p>디지털의 판단에서<br>현실의 움직임으로.</p><div class="corp-card-physical-art" aria-hidden="true"><div><i></i><i></i><i></i></div><span></span></div><span class="corp-card-link">Physical AI 알아보기 <b aria-hidden="true">↗</b></span></a>
    </div>
  </section>
  <section class="corp-company" id="company"><div><p class="corp-eyebrow">BUILT ON EXPERIENCE. OPEN TO WHAT’S NEXT.</p><h2>현장을 아는 기업.<br>다음을 만드는 기업.</h2></div><div class="corp-company-copy"><p>2007년 설립된 유성건설은 건설 현장에서 쌓아온 경험을 바탕으로 새로운 기술의 가능성을 연결합니다.</p><p>AI와 AX, 스마트 건설, Physical AI. 유성의 현장 역량과 OmarAGI의 AI 신뢰·실행 기술이 만나, 판단을 실제 업무와 현장의 실행으로 이어갑니다.</p><div class="corp-company-facts"><span><b>2007</b>설립</span><span><b>BUSAN</b>부산, 대한민국</span></div></div></section>
  <section class="corp-bridge"><p class="corp-eyebrow">U-SUNG × OmarAGI</p><h2>좋은 기술은,<br><span>실제로 작동할 때.</span></h2><p>AI의 답을 확인하고, 실행을 연결하고, 결과를 다시 검증합니다.<br>신뢰를 바탕으로 기술이 쓰이는 곳을 넓혀갑니다.</p><a class="corp-text-link" href="/ai/">AI 신뢰·실행 인프라 보기 <span aria-hidden="true">↗</span></a><div class="corp-bridge-flow"><span>인식</span><i aria-hidden="true">→</i><span>검증</span><i aria-hidden="true">→</i><span>실행</span><i aria-hidden="true">→</i><span>학습</span></div></section>
  ${contact}
</main>`;

export const ai = `<main id="main-content">
  <div class="corp-subnav"><span>AI</span><a href="#capabilities">핵심 역량</a><a href="#approach">적용 방식</a><a href="/#contact">도입 문의 ↗</a></div>
  <section class="corp-division-hero corp-ai-hero"><p class="corp-eyebrow">U-SUNG AI & AX</p><h1>AI의 가능성을.<br><span>실제 업무의 힘으로.</span></h1><p class="corp-hero-copy">모델을 넘어, 실행까지.<br>유성과 OmarAGI가 신뢰할 수 있는 AI 적용을 함께 만듭니다.</p><div class="corp-ai-engine" aria-hidden="true"><div class="corp-engine-models"><span>LLM</span><span>AGENT</span><span>DATA</span></div><div class="corp-engine-line"></div><div class="corp-engine-core"><span>VERIFY · ROUTE · CONTROL</span><b>Reliability<br>Infrastructure</b><i></i></div><div class="corp-engine-line"></div><div class="corp-engine-output"><span>WORKFLOW</span><span>REAL-WORLD ACTION</span></div></div></section>
  <section class="corp-capabilities" id="capabilities"><div class="corp-section-heading"><p class="corp-eyebrow">CORE CAPABILITIES</p><h2>답을 넘어.<br>믿고 쓰는 AI.</h2></div><div class="corp-capability-grid"><article><span>01 / VERIFY</span><h3>답변과 결과 검증</h3><p>출처와 근거를 연결하고, 데이터의 일관성을 확인합니다. RAG와 AI 결과의 신뢰도를 높이는 검증 과정을 설계합니다.</p><small>Source grounding · Provenance · Evaluation</small></article><article><span>02 / EXECUTE</span><h3>에이전트 실행 제어</h3><p>업무에 맞는 모델과 경로를 선택하고, 에이전트의 실행 순서와 승인 조건을 관리합니다. 판단에서 업무 실행까지 연결합니다.</p><small>Routing · Workflow control · Adoption gate</small></article><article><span>03 / OBSERVE</span><h3>운영과 거버넌스</h3><p>AI의 응답과 실행 기록을 남기고, 이상 징후와 실패를 추적합니다. 운영 과정의 관찰, 감사, 개선을 지원합니다.</p><small>Observability · Audit logging · Governance</small></article></div></section>
  <section class="corp-approach" id="approach"><p class="corp-eyebrow">HOW WE CONNECT</p><h2>기술과 현장.<br>같은 방향으로.</h2><div class="corp-approach-grid"><article><span>U-SUNG</span><h3>업무와 현장의 적용</h3><p>기업의 업무, 데이터, 현장 요구를 정의하고 AI를 실제 운영 과정에 연결합니다.</p></article><article><span>OmarAGI</span><h3>AI 신뢰·실행 인프라</h3><p>특정 모델에 종속되지 않는 검증, 라우팅, 에이전트 제어 기술로 AI의 실행을 뒷받침합니다.</p></article></div></section>
  ${contact}
</main>`;

export const physical = `<main id="main-content">
  <div class="corp-subnav"><span>Physical AI</span><a href="#capabilities">기술 방향</a><a href="/smart-construction/">스마트 건설</a><a href="/#contact">협력 문의 ↗</a></div>
  <section class="corp-division-hero corp-physical-hero"><p class="corp-eyebrow">U-SUNG PHYSICAL AI</p><h1>지능이 현실을<br><span>움직이는 순간.</span></h1><p class="corp-hero-copy">인식하고, 검증하고, 실행하는 기술.<br>AI와 물리적 현장의 연결을 만들어갑니다.</p><div class="corp-physical-system" aria-hidden="true"><div class="corp-field-grid"></div><div class="corp-field-ring"></div><div class="corp-field-arm"><i></i><b></b><em></em><span></span></div><span class="corp-field-label corp-field-label-one">PERCEPTION</span><span class="corp-field-label corp-field-label-two">VERIFIED ACTION</span><span class="corp-field-caption"><i></i> FROM DIGITAL TO PHYSICAL</span></div></section>
  <section class="corp-capabilities" id="capabilities"><div class="corp-section-heading"><p class="corp-eyebrow">SEE. DECIDE. ACT.</p><h2>현장을 읽는 지능.<br>실행을 잇는 신뢰.</h2><p>유성의 현장 경험과 AI 기술을 연결하는 사업 방향입니다.</p></div><div class="corp-capability-grid"><article><span>01 / SEE</span><h3>현장 인식</h3><p>센서, 비전, 현장 데이터를 통해 작업 환경과 변화를 읽습니다. 데이터의 일관성과 이상 징후를 함께 살핍니다.</p></article><article><span>02 / DECIDE</span><h3>판단과 실행 검증</h3><p>AI의 판단 근거, 실행 조건, 승인 절차를 연결합니다. 행동에 앞서 결과를 확인하는 신뢰 레이어를 설계합니다.</p></article><article><span>03 / ACT</span><h3>실제 현장과의 연결</h3><p>에이전트 워크플로와 현장 시스템을 연결하고, 실행 기록과 결과를 다시 검증합니다. PoC와 실증을 통해 적용 범위를 구체화합니다.</p></article></div></section>
  <section class="corp-division-bridge"><p class="corp-eyebrow">INTELLIGENCE MEETS THE FIELD</p><h2>첫 번째 연결.<br>스마트 건설.</h2><p>건설 현장에서 출발하는 유성의 기술 방향을 만나보세요.</p><a class="corp-button" href="/smart-construction/">스마트 건설 살펴보기 <span aria-hidden="true">↗</span></a></section>
  ${contact}
</main>`;
