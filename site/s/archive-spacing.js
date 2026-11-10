/* Archive-only vertical rhythm. No text, media source, scale or crop changes. */
(() => {
  const map = document.getElementById('archive-spacing-map');
  if (!map || !CSS.supports('object-position', '50% 75%')) return;
  const config = JSON.parse(map.textContent);
  const entries = config.entries.map(item => {
    const block = document.getElementById(item.caption);
    const copy = block?.querySelector('.sqs-html-content');
    const label = [...(copy?.querySelectorAll('strong,b') || [])].find(e => e.textContent.trim() === 'Title');
    const media = item.mediaKind === 'gallery'
      ? [...document.querySelectorAll('.gallery-slideshow')].find(e => e.dataset.sectionId === item.media)
      : document.getElementById(item.media);
    return {...item, block, cell:block?.closest('.fe-block'), copy, label, media, margin:0};
  });
  const reference = entries.find(e => e.caption === config.reference);
  if (!reference || entries.some(e => !e.label || !e.cell || !e.media)) return;
  const state = window.__archiveSpacing = {version:config.version, status:'pending', updates:0, entries:entries.length};
  const box = e => e.getBoundingClientRect();
  // Theme fade translations are presentation, not layout spacing.
  function transientY(e, stop) {
    let y=0;
    for (let node=e; node && node!==stop; node=node.parentElement) {
      const t=getComputedStyle(node).transform;
      if (t && t!=='none') { const m=new DOMMatrixReadOnly(t); if(m.m11===1 && m.m22===1 && m.m12===0 && m.m21===0) y+=m.m42; }
    }
    return y;
  }
  function titleTop(entry) {
    const node=[...entry.label.childNodes].find(n=>n.nodeType===Node.TEXT_NODE && n.textContent.trim()==='Title');
    const range=document.createRange(); range.selectNode(node || entry.label);
    const r=[...range.getClientRects()].find(r=>r.width>0);
    return r.top - transientY(entry.label, entry.cell);
  }
  function imageFit(img) {
    const r=box(img),style=getComputedStyle(img);
    const dims=img.dataset.imageDimensions?.split('x') || [];
    const nw=img.naturalWidth || +img.getAttribute('width') || +dims[0];
    const nh=img.naturalHeight || +img.getAttribute('height') || +dims[1];
    if(!nw || !nh || r.width<=0 || r.height<=0 || style.objectFit!=='contain') return null;
    const scale=Math.min(r.width/nw,r.height/nh),height=nh*scale;
    const y=style.objectPosition.split(' ')[1] || '50%';
    const extra=r.height-height,offset=y.endsWith('%')?extra*parseFloat(y)/100:parseFloat(y)||0;
    return {r,height,extra,bottom:r.top+offset+height};
  }
  function activeImage(entry) {
    const active=[...entry.media.querySelectorAll('.gallery-slideshow-item[data-active="true"]')];
    return active.length===1 ? active[0].querySelector('img') : null;
  }
  const positionedImages = new WeakMap();
  const watchedImages = new WeakSet();
  const preparedProperties=['position','top','left','width','height','objectPosition'];
  const imageSignature=img=>preparedProperties.map(key=>img.style[key]).join('|');
  const imageStyles = new MutationObserver(records => {
    // Native lazy-image loading may rewrite style after an image is prepared.
    // Ignore our own canonical CSSOM values; repair native resets before paint.
    if(records.some(record => record.attributeName!=='style' ||
      (positionedImages.has(record.target) && imageSignature(record.target)!==positionedImages.get(record.target)))) refresh();
  });
  function watchImage(img) {
    if(watchedImages.has(img))return;
    watchedImages.add(img);
    imageStyles.observe(img,{attributes:true,attributeFilter:['style','src','data-image-dimensions']});
    resize.observe(img.parentElement);
  }
  function incomingImage(entry) {
    const incoming=entry.media.querySelector('.gallery-slideshow-item[data-active="true"][data-in="true"] img');
    return incoming || activeImage(entry);
  }
  const repaired = new Set();
  function repairGridOrder() {
    for(const cell of repaired){cell.style.removeProperty('grid-row-start');cell.style.removeProperty('grid-row-end');}
    repaired.clear();
    for(const entry of entries.filter(e=>e.mediaKind==='video')) {
      const mediaCell=entry.media.closest('.fe-block');
      if(!mediaCell || mediaCell.parentElement!==entry.cell.parentElement)continue;
      const m=getComputedStyle(mediaCell),c=getComputedStyle(entry.cell);
      const ms=+m.gridRowStart,me=+m.gridRowEnd,cs=+c.gridRowStart,ce=+c.gridRowEnd;
      if(cs<ms && [ms,me,cs,ce].every(Number.isFinite)) {
        const start=Math.min(ms,cs),end=Math.max(me,ce),span=me-ms;
        mediaCell.style.gridRowStart=String(start);mediaCell.style.gridRowEnd=String(start+span);
        entry.cell.style.gridRowStart=String(start+span+1);entry.cell.style.gridRowEnd=String(Math.max(end,start+span+2));
        repaired.add(mediaCell);repaired.add(entry.cell);
      }
    }
    // Shared native grids must not let a preceding caption span the next video.
    for(let i=0;i<entries.length-1;i++) {
      const entry=entries[i],next=entries[i+1];
      if(entry.mediaKind!=='video'||next.mediaKind!=='video')continue;
      const nextCell=next.media.closest('.fe-block');
      if(!nextCell||nextCell.parentElement!==entry.cell.parentElement)continue;
      const c=getComputedStyle(entry.cell),n=getComputedStyle(nextCell);
      if(+c.gridRowEnd>+n.gridRowStart && +n.gridRowStart>+c.gridRowStart) {
        entry.cell.style.gridRowEnd=n.gridRowStart;repaired.add(entry.cell);
      }
    }
  }
  let frame=0,lastWidth=0,passes=0;
  function schedule(){if(state.status==='blocked')return;if(state.status==='ready')passes=0;if(!frame)frame=requestAnimationFrame(normalize);}
  function refresh(){passes=0;state.status='pending';schedule();}
  function normalize(){
    frame=0;
    if(++passes>24){state.status='blocked';state.reason='spacing did not converge';return;}
    if(innerWidth!==lastWidth){lastWidth=innerWidth;repairGridOrder();}
    const referenceImage=activeImage(reference),refFit=referenceImage&&imageFit(referenceImage);
    if(!refFit){state.status='waiting-for-reference';return;}
    const gap=titleTop(reference)-refFit.bottom;
    if(!Number.isFinite(gap)||gap<0)return;
    let writes=0,unresolved=0,maxError=0;
    for(const entry of entries) {
      if(entry===reference)continue;
      if(entry.mediaKind==='gallery') {
        const targetBottom=titleTop(entry)-gap;
        // Prepare every slide, including hidden ones. Waiting for a single
        // active slide lets the incoming image paint centered, then jump later.
        for(const img of entry.media.querySelectorAll('.gallery-slideshow-item img')) {
          watchImage(img);
          const slot=box(img.parentElement),height=targetBottom-slot.top;
          if(slot.width<=0||slot.height<=0)continue;
          if(height<=0||height>slot.height+1){unresolved++;continue;}
          // A fixed bottom-aligned contain box is shared by every slide.
          // Wide photos retain their scale; a taller portrait fits fully
          // inside the available slot instead of overflowing or being cropped.
          const styles={position:'absolute',top:'0px',left:'0px',width:'100%',objectPosition:'50% 100%'};
          for(const[key,value]of Object.entries(styles))if(img.style[key]!==value){img.style[key]=value;writes++;}
          const currentHeight=parseFloat(img.style.height);
          if(!img.style.height.endsWith('px')||!Number.isFinite(currentHeight)||Math.abs(currentHeight-height)>0.05){img.style.height=height+'px';writes++;}
          positionedImages.set(img,imageSignature(img));
        }
        const img=incomingImage(entry),fit=img&&imageFit(img);
        if(!fit){unresolved++;continue;}
        // Keep native side-button hit targets centered on the visible image.
        const placed=imageFit(img),center=placed.bottom-placed.height/2;
        for(const button of entry.media.querySelectorAll('.gallery-slideshow-controls .gallery-slideshow-control-btn')){
          const control=box(button.closest('.gallery-slideshow-control'));
          const offset=center-(control.top+control.height/2);
          const value=`0 ${offset}px`;
          const current=parseFloat(button.style.translate.split(/\s+/).at(-1));
          if(!Number.isFinite(current)||Math.abs(current-offset)>0.25){button.style.translate=value;writes++;}
        }
      } else {
        const media=entry.media.querySelector('.sqs-video-wrapper') || entry.media;
        const error=gap-(titleTop(entry)-box(media).bottom);
        maxError=Math.max(maxError,Math.abs(error));
        if(Math.abs(error)>0.5){entry.margin+=error;entry.cell.style.marginTop=entry.margin+'px';writes++;}
      }
    }
    state.status=unresolved?'pending-images':writes?'settling':'ready';
    state.referenceGap=gap;state.unresolved=unresolved;state.lastWrites=writes;state.maxVideoError=maxError;state.updates++;
    if(writes)schedule();
  }
  const resize=new ResizeObserver(schedule);
  for(const entry of entries){resize.observe(entry.cell);resize.observe(entry.media);if(entry.mediaKind==='gallery'){
    new MutationObserver(refresh).observe(entry.media,{subtree:true,childList:true,attributes:true,attributeFilter:['data-active','data-in']});
  }}
  document.addEventListener('load',refresh,true);
  window.addEventListener('resize',refresh,{passive:true});
  document.fonts?.ready.then(refresh);
  document.fonts?.addEventListener('loadingdone',refresh);
  const referenceImage=activeImage(reference);if(referenceImage)referenceImage.loading='eager';
  schedule();
})();
