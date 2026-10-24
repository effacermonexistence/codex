export const PINK='#EDB3CC';
export const normalizeAccent=value=>typeof value==='string'&&/^#[\da-f]{6}$/i.test(value)?value.toUpperCase():PINK;
export function accentRGB(hex){return normalizeAccent(hex).slice(1).match(/../g).map(s=>parseInt(s,16));}
export function hue(hex){const [r,g,b]=accentRGB(hex).map(v=>v/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;if(!d)return 0;return ((max===r?(g-b)/d:max===g?(b-r)/d+2:(r-g)/d+4)*60+360)%360;}
export function applyAccent(value){const hex=normalizeAccent(value),rgb=accentRGB(hex);document.documentElement.style.setProperty('--accent',hex);document.documentElement.style.setProperty('--accent-rgb',rgb.join(','));document.documentElement.dataset.accent=hex;return hex;}
