const t = (...args) => window.UsungI18n.t(...args);
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const futureSteps = $$('[data-future-step]');
const futureImages = $$('[data-future-image]');
let scheduled=false;
const updateScrollUI = () => {
  scheduled=false;
  const max=document.documentElement.scrollHeight-innerHeight;
  $('.page-progress span').style.transform=`scaleX(${max>0?Math.min(1,Math.max(0,scrollY/max)):0})`;
  // All steps participate on every update: reverse scrolling cannot reuse a stale observer entry.
  let nearest=0,distance=Infinity;
  futureSteps.forEach((step,index)=>{
    const r=step.getBoundingClientRect();const d=Math.abs(r.top+r.height/2-innerHeight*.6);
    if(d<distance){distance=d;nearest=index;}
  });
  futureImages.forEach((img,index)=>img.classList.toggle('is-active',index===nearest));
};
const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(updateScrollUI)}};
addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);updateScrollUI();
if('IntersectionObserver' in window){
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target)}}),{threshold:.06});
  $$('.reveal').forEach(el=>observer.observe(el));
  document.documentElement.classList.add('motion-ready');
}

let userPaused=false;
const videos=$$('video');
const visibleVideos=new Set();
const updateVideos=()=>{
  const blocked=userPaused||reduced.matches||document.hidden||!!$('dialog[open]');
  videos.forEach(video=>{
    if(!blocked&&visibleVideos.has(video)) video.play().catch(()=>{});
    else video.pause();
  });
  const paused=userPaused||reduced.matches;
  $('.motion-toggle').setAttribute('aria-pressed',String(paused));
  $('.motion-toggle').innerHTML=t(paused ? '영상 재생' : '영상 일시정지') + (paused ? ' <span aria-hidden="true">▷</span>' : ' <span aria-hidden="true">Ⅱ</span>');
};
if('IntersectionObserver' in window){
 const observer=new IntersectionObserver(entries=>{entries.forEach(e=>e.isIntersecting?visibleVideos.add(e.target):visibleVideos.delete(e.target));updateVideos();},{threshold:.1});videos.forEach(v=>observer.observe(v));
}
$('.motion-toggle').addEventListener('click',()=>{if(reduced.matches) {userPaused=true;$('.motion-toggle').textContent=t('동작 줄이기 설정 적용 중');return;}userPaused=!userPaused;updateVideos()});
reduced.addEventListener('change',updateVideos);document.addEventListener('visibilitychange',updateVideos);updateVideos();

$$('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
  const filter=button.dataset.filter;
  $$('[data-filter]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));
  let count=0;$$('[data-category]').forEach(card=>{card.hidden=filter!=='all'&&card.dataset.category!==filter;if(!card.hidden){count++;card.classList.add('is-visible')}});
  $('.cards-grid').classList.toggle('is-filtered',filter!=='all');
  $('.project-count').textContent=t('{count}개의 레퍼런스 프로젝트', { count });schedule();
}));
const projects=[
 {title:'COASTAL ARCHITECTURE',image:'usung-field-team-v26.webp',source:'USUNG · VISUAL REFERENCE',description:'대형 해안 건축의 수평적 스케일과 재료감을 보여주는 레퍼런스입니다. U-SUNG의 실제 시공 실적이 아닌, 이번 데모의 프로젝트 표현 방향입니다.',url:'https://suffolk.com/project/naples-beach-club-a-four-seasons-resort/'},
 {title:'SPACES FOR PEOPLE',image:'turner-project.jpg',source:'USUNG · VISUAL REFERENCE',description:'자연광, 색채, 사용자의 동선이 만나는 실내 공간. 건물의 규모뿐 아니라 공간 안에서의 경험을 보여주는 Turner 이미지 레퍼런스입니다.',url:'https://www.turnerconstruction.com/projects'},
 {title:'CONNECTED CONSTRUCTION',image:'turner-innovation.jpg',source:'USUNG · VISUAL REFERENCE',description:'디지털 도구와 실제 현장의 연결을 표현합니다. 기술 단독의 이미지가 아니라 사람과 협업, 현장 계획이 함께 보이는 방향을 선택했습니다.',url:'https://www.turnerconstruction.com/commitments/innovation'}
];
let dialogTrigger=null;
const openDialog=(dialog,trigger)=>{dialogTrigger=trigger;dialog.showModal();document.body.classList.add('overlay-open');updateVideos()};
$$('dialog:not(.corp-language-dialog)').forEach(dialog=>{
 dialog.querySelector('.dialog-close').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()}});
 dialog.addEventListener('close',()=>{document.body.classList.remove('overlay-open');dialogTrigger?.focus();updateVideos()});
});
$$('[data-project]').forEach(button=>button.addEventListener('click',()=>{
 const p=projects[Number(button.dataset.project)];
 $('#project-dialog-title').textContent=t(p.title);$('#project-dialog-image').src=`/assets/media/${p.image}`;$('#project-dialog-image').alt=t(p.title);
 $('#project-dialog-source').textContent=t(p.source);$('#project-dialog-description').textContent=t(p.description).replace(/\bTurner\s*/gi, "");$('#project-dialog-link').href=p.url;
 openDialog($('#project-dialog'),button);
}));
$('.contact-open').addEventListener('click',event=>openDialog($('#contact-dialog'),event.currentTarget));
$('#brief-form').addEventListener('submit',event=>{
 event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));
 const text=`${t('U-SUNG — PROJECT BRIEF')}\n\n${t('이름 / 회사')}: ${values.name}\n${t('이메일')}: ${values.email}\n${t('관심 분야')}: ${values.sector}\n\n${values.message}\n\n${t('로컬 데모에서 작성한 브리프입니다. 전송되지 않았습니다.')}\n`;
 const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
 const link=document.createElement('a');link.href=url;link.download='U-SUNG-project-brief.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 $('#brief-status').textContent=t('브리프 파일을 만들었습니다. 외부로 전송하거나 이 브라우저에 저장하지 않았습니다.');
});
const review=new URLSearchParams(location.search).get('review');
if(review) addEventListener('load',()=>{document.getElementById(review)?.scrollIntoView();schedule()},{once:true});
