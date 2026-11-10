const oldStyle='<link id="apply-upload-style-v1" rel="stylesheet" href="/s/apply-upload-20261026.css">';
const oldRuntime='<script id="apply-upload-runtime-v1" defer src="/s/apply-upload-20261026.js"></script>';
export const style='<link id="apply-upload-style-v1" rel="stylesheet" href="/s/apply-upload-20261026-v2.css">';
export const runtime='<script id="apply-upload-runtime-v1" defer src="/s/apply-upload-20261026-v2.js"></script>';
export function addApplyUpload(html,route){
 if(route!=='/apply')return html;
 if(!html.includes('id="form-context-68656582e759892761381cba"')||!html.includes('id="block-61b1bd79481c34f2f1bb"'))throw Error('Unexpected Apply form identity');
 if(html.includes('id="apply-upload-style-v1"')||html.includes('id="apply-upload-runtime-v1"'))throw Error('Apply upload already mounted');
 if(html.split('</head>').length!==2||html.split('</body>').length!==2)throw Error('Unexpected Apply document');
 return html.replace('</head>',style+'\n</head>').replace('</body>',runtime+'\n</body>');
}
export function removeApplyUpload(html){
 const foundStyle=html.includes(oldStyle+'\n')?oldStyle:style;
 const foundRuntime=html.includes(oldRuntime+'\n')?oldRuntime:runtime;
 if(html.split(foundStyle+'\n').length!==2||html.split(foundRuntime+'\n').length!==2)throw Error('Apply upload identity not found');
 return html.replace(foundStyle+'\n','').replace(foundRuntime+'\n','');
}
