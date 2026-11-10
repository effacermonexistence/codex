(()=>{'use strict';
 const params=new URLSearchParams(location.search),page=params.get('path')||'/',selected=params.get('revision')||'';
 const status=document.getElementById('history-status'),list=document.getElementById('history-list'),detail=document.getElementById('history-selected'),frame=document.getElementById('history-frame');
 const title=document.getElementById('history-selected-title'),pathLabel=document.getElementById('history-page'),back=document.getElementById('history-return'),close=document.getElementById('history-close');
 pathLabel.textContent='Page / '+page;back.href=page;close.href='/history?path='+encodeURIComponent(page);
 const item=(tag,className,text)=>{const e=document.createElement(tag);e.className=className;e.textContent=text;return e};
 fetch('/api/site-history/index?path='+encodeURIComponent(page),{cache:'no-store'}).then(async response=>{if(!response.ok)throw Error('History unavailable');return response.json()}).then(data=>{
  status.textContent=data.releases.length?'':'No verified earlier page snapshot is available yet';
  const groups=[['Deployed states',data.releases.filter(x=>x.kind==='source_verified_release')],['Source captures',data.releases.filter(x=>x.kind==='direct_public_capture')]];
  for(const [heading,revisions] of groups){if(!revisions.length)continue;list.append(item('li','history-group',heading));
   for(const revision of revisions){const li=document.createElement('li'),left=document.createElement('div'),link=item('a','history-view','View version ↗');
    left.append(item('span','history-date',revision.date),item('span','history-release',revision.label),item('span','history-source',revision.id));
    link.href='/history?path='+encodeURIComponent(page)+'&revision='+encodeURIComponent(revision.id);
    li.append(left,link);list.append(li)}}
  const rev=data.releases.find(x=>x.id===selected);
  if(rev){detail.hidden=false;title.textContent=rev.label+' · '+rev.date;frame.src=rev.viewUrl;detail.scrollIntoView({block:'start'})}
  const ledger=document.getElementById('history-ledger'),items=document.getElementById('history-ledger-list');
  for(const entry of data.unavailable||[]){const li=document.createElement('li');li.textContent=entry.date+' · '+entry.label+' · source not available';items.append(li)}
  ledger.hidden=items.children.length===0;
 }).catch(()=>{status.textContent='The archive is temporarily unavailable';document.getElementById('history-ledger').hidden=true});
})();
