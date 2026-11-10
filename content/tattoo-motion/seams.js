function createTattooSeams(states, info, config) {
  if (!config || states.length < 2) return null;
  const root=document.querySelector('.cr-motion-seam-page');
  if(!root)return null;
  const report=info.seams={version:'continuous-field-seams-v1',halfHeight:0,frames:0,joins:[],errors:[]};
  const frame=document.createElement('canvas'),layer=document.createElement('canvas');
  const out=frame.getContext('2d',{alpha:false}),blend=layer.getContext('2d');
  const joins=states.slice(0,-1).map((a,i)=>{
    const b=states[i+1],top=document.createElement('canvas'),bottom=document.createElement('canvas');
    top.className='cr-motion-seam cr-motion-seam-bottom';bottom.className='cr-motion-seam cr-motion-seam-top';
    for(const c of[top,bottom]){c.setAttribute('aria-hidden','true');c.width=c.height=1;}
    a.el.appendChild(top);b.el.appendChild(bottom);
    const record={index:i,from:a.record.id,to:b.record.id,ready:false,frames:0,visible:false,gap:0};report.joins.push(record);
    return{a,b,top,bottom,record,visible:0,band:null};
  });
  let half=0,raf=0,last=0,moving=false,pairKey=null;
  function geometry(){
    const next=Math.max(150,Math.min(260,innerHeight*.22));
    if(next!==half){half=next;root.style.setProperty('--cr-seam-half',half+'px');report.halfHeight=half;}
    for(const j of joins){const a=j.a.el.getBoundingClientRect(),b=j.b.el.getBoundingClientRect();
      const y=(a.bottom+b.top)/2;j.record.gap=b.top-a.bottom;
      j.band={x:a.left,y:y-half,width:a.width,height:half*2};
      j.visible=Math.max(0,Math.min(y+half,innerHeight)-Math.max(y-half,0));j.record.visible=j.visible>0;
      if(!j.visible&&j.record.ready){for(const c of[j.top,j.bottom]){c.style.opacity='0';c.width=c.height=1;}j.record.ready=false;}
    }
  }
  function source(s){
    const v=s.video;if(!s.record.failed&&v.readyState>=2&&v.videoWidth)return v;
    const image=s.el.querySelector('.cr-motion-media picture img');return image?.complete&&image.naturalWidth?image:null;
  }
  function cover(ctx,media,s,band,dpr){
    const r=s.el.querySelector('.cr-motion-media').getBoundingClientRect(),sw=media.videoWidth||media.naturalWidth,sh=media.videoHeight||media.naturalHeight;
    const scale=Math.max(r.width/sw,r.height/sh),w=sw*scale,h=sh*scale;
    ctx.drawImage(media,(r.left-band.x+(r.width-w)/2)*dpr,(r.top-band.y+(r.height-h)/2)*dpr,w*dpr,h*dpr);
  }
  function draw(){
    const dpr=Math.min(devicePixelRatio||1,1.5);
    for(const j of joins){if(!j.visible)continue;const a=source(j.a),b=source(j.b);if(!a||!b)continue;
      if(Math.abs(j.record.gap)>2){j.record.ready=false;continue;}
      const w=Math.max(1,Math.round(j.band.width*dpr)),h=Math.max(2,Math.round(half*dpr)),full=h*2;
      if(frame.width!==w||frame.height!==full){frame.width=layer.width=w;frame.height=layer.height=full;}
      out.setTransform(1,0,0,1,0,0);out.globalCompositeOperation='source-over';out.globalAlpha=1;
      cover(out,a,j.a,j.band,dpr);
      blend.clearRect(0,0,w,full);blend.globalCompositeOperation='source-over';cover(blend,b,j.b,j.band,dpr);
      const gradient=blend.createLinearGradient(0,0,0,full);gradient.addColorStop(0,'rgba(255,255,255,0)');gradient.addColorStop(1,'rgba(255,255,255,1)');
      blend.globalCompositeOperation='destination-in';blend.fillStyle=gradient;blend.fillRect(0,0,w,full);blend.globalCompositeOperation='source-over';out.drawImage(layer,0,0);
      for(const [canvas,y]of[[j.top,0],[j.bottom,h]]){
        if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
        canvas.getContext('2d',{alpha:false}).drawImage(frame,0,y,w,h,0,0,w,h);canvas.style.opacity='1';
      }
      j.record.ready=true;j.record.frames++;report.frames++;
    }
  }
  function tick(now){raf=0;if(document.hidden||!moving)return;if(now-last>=1000/30){draw();last=now;}if(joins.some(j=>j.visible))raf=requestAnimationFrame(tick);}
  function update(motion){moving=motion;geometry();if(!document.hidden)draw();if(moving&&!document.hidden&&joins.some(j=>j.visible)){if(!raf)raf=requestAnimationFrame(tick);}else if(raf){cancelAnimationFrame(raf);raf=0;}}
  for(const s of states)s.el.querySelector('.cr-motion-media picture img')?.addEventListener('load',()=>update(moving));
  function players(winner){geometry();const ranked=joins.filter(j=>j.visible>1).sort((a,b)=>b.visible-a.visible||Math.abs(a.band.y+half-innerHeight/2)-Math.abs(b.band.y+half-innerHeight/2));
    const j=ranked[0];if(!j){pairKey=null;return new Set(winner?[winner]:[]);}
    if(j.a.record.id===j.b.record.id&&pairKey!==j.record.index&&j.a.video.readyState>=1&&j.b.video.readyState>=1){const lead=winner===j.b?j.b:j.a,other=lead===j.a?j.b:j.a;if(Math.abs(lead.video.currentTime-other.video.currentTime)>.2)other.video.currentTime=lead.video.currentTime;pairKey=j.record.index;}
    return new Set([j.a,j.b]);
  }
  return{players,update};
}
