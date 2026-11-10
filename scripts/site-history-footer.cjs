'use strict';
const fs=require('node:fs');
const path=require('node:path');
const STYLE='<style id="site-history-footer-style">#site-history-footnote{width:100%;box-sizing:border-box;padding:10px 16px 28px;text-align:center;color:#aaa;opacity:.55;font-family:inherit;font-size:11px;font-weight:400;line-height:1.5;letter-spacing:.055em}#site-history-footnote:hover,#site-history-footnote:focus-within{opacity:.8}#site-history-footnote a{color:inherit;text-decoration:none;border-bottom:1px solid currentColor;padding-bottom:2px}#site-history-footnote a:focus-visible{outline-offset:5px}@media(max-width:600px){#site-history-footnote{padding:12px 16px 24px;font-size:10px}}</style>';
function releaseDate(root){
 const id=fs.readFileSync(path.join(root,'os1-delivery-proof.txt'),'utf8').trim(),m=id.match(/(\d{8})T(\d{6})Z/);
 if(!m)throw Error('History footer requires timestamped release identity');
 const iso=m[1].slice(0,4)+'-'+m[1].slice(4,6)+'-'+m[1].slice(6,8)+'T'+m[2].slice(0,2)+':'+m[2].slice(2,4)+':'+m[2].slice(4,6)+'Z';
 const date=new Date(iso);if(!Number.isFinite(date.getTime()))throw Error('Invalid release timestamp');
 return new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'America/Los_Angeles'}).format(date);
}
function routeForFile(siteDir,file){
 const rel=path.relative(siteDir,file).replaceAll(path.sep,'/');
 if(rel==='index.html')return'/';
 if(rel==='404.html')return'/404';
 if(rel.startsWith('pages/')&&rel.endsWith('.html'))return'/'+rel.slice(6,-5);
 return null;
}
function withHistoryFooter(html,route,date){
 if(!route||!html.includes('id="footer-sections"'))return html;
 if(html.includes('id="site-history-footnote"')||html.includes('id="site-history-footer-style"'))throw Error('History footer duplicate');
 if(html.split('</head>').length!==2)throw Error('History footer head boundary');
 const open=html.lastIndexOf('<footer class="sections" id="footer-sections"'),close=html.indexOf('</footer>',open);
 if(open<0||close<open)throw Error('History footer identity');
 const href='/history?path='+encodeURIComponent(route);
 const note='<div id="site-history-footnote"><a href="'+href+'" aria-label="View the history of this page">Last updated '+date+' · View history</a></div>';
 const styled=html.replace('</head>',STYLE+'</head>'),position=styled.indexOf('</footer>',styled.lastIndexOf('<footer class="sections" id="footer-sections"'));
 return styled.slice(0,position)+note+styled.slice(position);
}
module.exports={withHistoryFooter,routeForFile,releaseDate,STYLE};
