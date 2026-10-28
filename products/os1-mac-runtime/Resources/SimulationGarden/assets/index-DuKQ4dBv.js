(()=>{
(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))n(r);new MutationObserver(r=>{for(const s of r)if(s.type==="childList")for(const o of s.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&n(o)}).observe(document,{childList:!0,subtree:!0});function e(r){const s={};return r.integrity&&(s.integrity=r.integrity),r.referrerPolicy&&(s.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?s.credentials="include":r.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function n(r){if(r.ep)return;r.ep=!0;const s=e(r);fetch(r.href,s)}})();const Fa="180",xc=0,uo=1,Mc=2,Ml=1,Sl=2,bn=3,Xn=0,Oe=1,un=2,Hn=0,Bi=1,ho=2,fo=3,po=4,Sc=5,si=100,Ec=101,yc=102,bc=103,Tc=104,Ac=200,wc=201,Rc=202,Cc=203,Gs=204,Ws=205,Pc=206,Dc=207,Lc=208,Ic=209,Uc=210,Nc=211,Fc=212,Oc=213,Bc=214,Xs=0,qs=1,Ys=2,Hi=3,$s=4,Ks=5,js=6,Zs=7,El=0,zc=1,Hc=2,kn=0,kc=1,Vc=2,Gc=3,yl=4,Wc=5,Xc=6,qc=7,bl=300,ki=301,Vi=302,Js=303,Qs=304,es=306,Kr=1e3,oi=1001,ta=1002,Ue=1003,Tl=1004,vr=1005,dn=1006,os=1007,li=1008,mn=1009,Al=1010,wl=1011,or=1012,Oa=1013,hi=1014,fn=1015,dr=1016,Ba=1017,za=1018,lr=1020,Rl=35902,Cl=35899,Pl=1021,Dl=1022,en=1023,cr=1026,ur=1027,Ha=1028,ka=1029,Ll=1030,Va=1031,Ga=1033,Wr=33776,Xr=33777,qr=33778,Yr=33779,ea=35840,na=35841,ia=35842,ra=35843,sa=36196,aa=37492,oa=37496,la=37808,ca=37809,ua=37810,ha=37811,da=37812,fa=37813,pa=37814,ma=37815,ga=37816,_a=37817,va=37818,xa=37819,Ma=37820,Sa=37821,Ea=36492,ya=36494,ba=36495,Ta=36283,Aa=36284,wa=36285,Ra=36286,Yc=3200,$c=3201,Il=0,Kc=1,On="",Le="srgb",Gi="srgb-linear",jr="linear",Zt="srgb",vi=7680,mo=519,jc=512,Zc=513,Jc=514,Ul=515,Qc=516,tu=517,eu=518,nu=519,Ca=35044,iu=35048,go="300 es",pn=2e3,Zr=2001;class Xi{addEventListener(t,e){this._listeners===void 0&&(this._listeners={});const n=this._listeners;n[t]===void 0&&(n[t]=[]),n[t].indexOf(e)===-1&&n[t].push(e)}hasEventListener(t,e){const n=this._listeners;return n===void 0?!1:n[t]!==void 0&&n[t].indexOf(e)!==-1}removeEventListener(t,e){const n=this._listeners;if(n===void 0)return;const r=n[t];if(r!==void 0){const s=r.indexOf(e);s!==-1&&r.splice(s,1)}}dispatchEvent(t){const e=this._listeners;if(e===void 0)return;const n=e[t.type];if(n!==void 0){t.target=this;const r=n.slice(0);for(let s=0,o=r.length;s<o;s++)r[s].call(this,t);t.target=null}}}const Se=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],ls=Math.PI/180,Pa=180/Math.PI;function Vn(){const i=Math.random()*4294967295|0,t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Se[i&255]+Se[i>>8&255]+Se[i>>16&255]+Se[i>>24&255]+"-"+Se[t&255]+Se[t>>8&255]+"-"+Se[t>>16&15|64]+Se[t>>24&255]+"-"+Se[e&63|128]+Se[e>>8&255]+"-"+Se[e>>16&255]+Se[e>>24&255]+Se[n&255]+Se[n>>8&255]+Se[n>>16&255]+Se[n>>24&255]).toLowerCase()}function Wt(i,t,e){return Math.max(t,Math.min(e,i))}function ru(i,t){return(i%t+t)%t}function cs(i,t,e){return(1-e)*i+e*t}function hn(i,t){switch(t.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("Invalid component type.")}}function Jt(i,t){switch(t.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("Invalid component type.")}}class Ot{constructor(t=0,e=0){Ot.prototype.isVector2=!0,this.x=t,this.y=e}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,e){return this.x=t,this.y=e,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){const e=this.x,n=this.y,r=t.elements;return this.x=r[0]*e+r[3]*n+r[6],this.y=r[1]*e+r[4]*n+r[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,e){return this.x=Wt(this.x,t.x,e.x),this.y=Wt(this.y,t.y,e.y),this}clampScalar(t,e){return this.x=Wt(this.x,t,e),this.y=Wt(this.y,t,e),this}clampLength(t,e){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Wt(n,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const n=this.dot(t)/e;return Math.acos(Wt(n,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,n=this.y-t.y;return e*e+n*n}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this}rotateAround(t,e){const n=Math.cos(e),r=Math.sin(e),s=this.x-t.x,o=this.y-t.y;return this.x=s*n-o*r+t.x,this.y=s*r+o*n+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class fr{constructor(t=0,e=0,n=0,r=1){this.isQuaternion=!0,this._x=t,this._y=e,this._z=n,this._w=r}static slerpFlat(t,e,n,r,s,o,a){let l=n[r+0],c=n[r+1],h=n[r+2],d=n[r+3];const f=s[o+0],m=s[o+1],g=s[o+2],x=s[o+3];if(a===0){t[e+0]=l,t[e+1]=c,t[e+2]=h,t[e+3]=d;return}if(a===1){t[e+0]=f,t[e+1]=m,t[e+2]=g,t[e+3]=x;return}if(d!==x||l!==f||c!==m||h!==g){let p=1-a;const u=l*f+c*m+h*g+d*x,b=u>=0?1:-1,T=1-u*u;if(T>Number.EPSILON){const C=Math.sqrt(T),w=Math.atan2(C,u*b);p=Math.sin(p*w)/C,a=Math.sin(a*w)/C}const E=a*b;if(l=l*p+f*E,c=c*p+m*E,h=h*p+g*E,d=d*p+x*E,p===1-a){const C=1/Math.sqrt(l*l+c*c+h*h+d*d);l*=C,c*=C,h*=C,d*=C}}t[e]=l,t[e+1]=c,t[e+2]=h,t[e+3]=d}static multiplyQuaternionsFlat(t,e,n,r,s,o){const a=n[r],l=n[r+1],c=n[r+2],h=n[r+3],d=s[o],f=s[o+1],m=s[o+2],g=s[o+3];return t[e]=a*g+h*d+l*m-c*f,t[e+1]=l*g+h*f+c*d-a*m,t[e+2]=c*g+h*m+a*f-l*d,t[e+3]=h*g-a*d-l*f-c*m,t}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get w(){return this._w}set w(t){this._w=t,this._onChangeCallback()}set(t,e,n,r){return this._x=t,this._y=e,this._z=n,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(t){return this._x=t.x,this._y=t.y,this._z=t.z,this._w=t.w,this._onChangeCallback(),this}setFromEuler(t,e=!0){const n=t._x,r=t._y,s=t._z,o=t._order,a=Math.cos,l=Math.sin,c=a(n/2),h=a(r/2),d=a(s/2),f=l(n/2),m=l(r/2),g=l(s/2);switch(o){case"XYZ":this._x=f*h*d+c*m*g,this._y=c*m*d-f*h*g,this._z=c*h*g+f*m*d,this._w=c*h*d-f*m*g;break;case"YXZ":this._x=f*h*d+c*m*g,this._y=c*m*d-f*h*g,this._z=c*h*g-f*m*d,this._w=c*h*d+f*m*g;break;case"ZXY":this._x=f*h*d-c*m*g,this._y=c*m*d+f*h*g,this._z=c*h*g+f*m*d,this._w=c*h*d-f*m*g;break;case"ZYX":this._x=f*h*d-c*m*g,this._y=c*m*d+f*h*g,this._z=c*h*g-f*m*d,this._w=c*h*d+f*m*g;break;case"YZX":this._x=f*h*d+c*m*g,this._y=c*m*d+f*h*g,this._z=c*h*g-f*m*d,this._w=c*h*d-f*m*g;break;case"XZY":this._x=f*h*d-c*m*g,this._y=c*m*d-f*h*g,this._z=c*h*g+f*m*d,this._w=c*h*d+f*m*g;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+o)}return e===!0&&this._onChangeCallback(),this}setFromAxisAngle(t,e){const n=e/2,r=Math.sin(n);return this._x=t.x*r,this._y=t.y*r,this._z=t.z*r,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(t){const e=t.elements,n=e[0],r=e[4],s=e[8],o=e[1],a=e[5],l=e[9],c=e[2],h=e[6],d=e[10],f=n+a+d;if(f>0){const m=.5/Math.sqrt(f+1);this._w=.25/m,this._x=(h-l)*m,this._y=(s-c)*m,this._z=(o-r)*m}else if(n>a&&n>d){const m=2*Math.sqrt(1+n-a-d);this._w=(h-l)/m,this._x=.25*m,this._y=(r+o)/m,this._z=(s+c)/m}else if(a>d){const m=2*Math.sqrt(1+a-n-d);this._w=(s-c)/m,this._x=(r+o)/m,this._y=.25*m,this._z=(l+h)/m}else{const m=2*Math.sqrt(1+d-n-a);this._w=(o-r)/m,this._x=(s+c)/m,this._y=(l+h)/m,this._z=.25*m}return this._onChangeCallback(),this}setFromUnitVectors(t,e){let n=t.dot(e)+1;return n<1e-8?(n=0,Math.abs(t.x)>Math.abs(t.z)?(this._x=-t.y,this._y=t.x,this._z=0,this._w=n):(this._x=0,this._y=-t.z,this._z=t.y,this._w=n)):(this._x=t.y*e.z-t.z*e.y,this._y=t.z*e.x-t.x*e.z,this._z=t.x*e.y-t.y*e.x,this._w=n),this.normalize()}angleTo(t){return 2*Math.acos(Math.abs(Wt(this.dot(t),-1,1)))}rotateTowards(t,e){const n=this.angleTo(t);if(n===0)return this;const r=Math.min(1,e/n);return this.slerp(t,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(t){return this._x*t._x+this._y*t._y+this._z*t._z+this._w*t._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let t=this.length();return t===0?(this._x=0,this._y=0,this._z=0,this._w=1):(t=1/t,this._x=this._x*t,this._y=this._y*t,this._z=this._z*t,this._w=this._w*t),this._onChangeCallback(),this}multiply(t){return this.multiplyQuaternions(this,t)}premultiply(t){return this.multiplyQuaternions(t,this)}multiplyQuaternions(t,e){const n=t._x,r=t._y,s=t._z,o=t._w,a=e._x,l=e._y,c=e._z,h=e._w;return this._x=n*h+o*a+r*c-s*l,this._y=r*h+o*l+s*a-n*c,this._z=s*h+o*c+n*l-r*a,this._w=o*h-n*a-r*l-s*c,this._onChangeCallback(),this}slerp(t,e){if(e===0)return this;if(e===1)return this.copy(t);const n=this._x,r=this._y,s=this._z,o=this._w;let a=o*t._w+n*t._x+r*t._y+s*t._z;if(a<0?(this._w=-t._w,this._x=-t._x,this._y=-t._y,this._z=-t._z,a=-a):this.copy(t),a>=1)return this._w=o,this._x=n,this._y=r,this._z=s,this;const l=1-a*a;if(l<=Number.EPSILON){const m=1-e;return this._w=m*o+e*this._w,this._x=m*n+e*this._x,this._y=m*r+e*this._y,this._z=m*s+e*this._z,this.normalize(),this}const c=Math.sqrt(l),h=Math.atan2(c,a),d=Math.sin((1-e)*h)/c,f=Math.sin(e*h)/c;return this._w=o*d+this._w*f,this._x=n*d+this._x*f,this._y=r*d+this._y*f,this._z=s*d+this._z*f,this._onChangeCallback(),this}slerpQuaternions(t,e,n){return this.copy(t).slerp(e,n)}random(){const t=2*Math.PI*Math.random(),e=2*Math.PI*Math.random(),n=Math.random(),r=Math.sqrt(1-n),s=Math.sqrt(n);return this.set(r*Math.sin(t),r*Math.cos(t),s*Math.sin(e),s*Math.cos(e))}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._w===this._w}fromArray(t,e=0){return this._x=t[e],this._y=t[e+1],this._z=t[e+2],this._w=t[e+3],this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._w,t}fromBufferAttribute(t,e){return this._x=t.getX(e),this._y=t.getY(e),this._z=t.getZ(e),this._w=t.getW(e),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class F{constructor(t=0,e=0,n=0){F.prototype.isVector3=!0,this.x=t,this.y=e,this.z=n}set(t,e,n){return n===void 0&&(n=this.z),this.x=t,this.y=e,this.z=n,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,e){return this.x=t.x*e.x,this.y=t.y*e.y,this.z=t.z*e.z,this}applyEuler(t){return this.applyQuaternion(_o.setFromEuler(t))}applyAxisAngle(t,e){return this.applyQuaternion(_o.setFromAxisAngle(t,e))}applyMatrix3(t){const e=this.x,n=this.y,r=this.z,s=t.elements;return this.x=s[0]*e+s[3]*n+s[6]*r,this.y=s[1]*e+s[4]*n+s[7]*r,this.z=s[2]*e+s[5]*n+s[8]*r,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){const e=this.x,n=this.y,r=this.z,s=t.elements,o=1/(s[3]*e+s[7]*n+s[11]*r+s[15]);return this.x=(s[0]*e+s[4]*n+s[8]*r+s[12])*o,this.y=(s[1]*e+s[5]*n+s[9]*r+s[13])*o,this.z=(s[2]*e+s[6]*n+s[10]*r+s[14])*o,this}applyQuaternion(t){const e=this.x,n=this.y,r=this.z,s=t.x,o=t.y,a=t.z,l=t.w,c=2*(o*r-a*n),h=2*(a*e-s*r),d=2*(s*n-o*e);return this.x=e+l*c+o*d-a*h,this.y=n+l*h+a*c-s*d,this.z=r+l*d+s*h-o*c,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){const e=this.x,n=this.y,r=this.z,s=t.elements;return this.x=s[0]*e+s[4]*n+s[8]*r,this.y=s[1]*e+s[5]*n+s[9]*r,this.z=s[2]*e+s[6]*n+s[10]*r,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,e){return this.x=Wt(this.x,t.x,e.x),this.y=Wt(this.y,t.y,e.y),this.z=Wt(this.z,t.z,e.z),this}clampScalar(t,e){return this.x=Wt(this.x,t,e),this.y=Wt(this.y,t,e),this.z=Wt(this.z,t,e),this}clampLength(t,e){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Wt(n,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this.z=t.z+(e.z-t.z)*n,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,e){const n=t.x,r=t.y,s=t.z,o=e.x,a=e.y,l=e.z;return this.x=r*l-s*a,this.y=s*o-n*l,this.z=n*a-r*o,this}projectOnVector(t){const e=t.lengthSq();if(e===0)return this.set(0,0,0);const n=t.dot(this)/e;return this.copy(t).multiplyScalar(n)}projectOnPlane(t){return us.copy(this).projectOnVector(t),this.sub(us)}reflect(t){return this.sub(us.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const n=this.dot(t)/e;return Math.acos(Wt(n,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,n=this.y-t.y,r=this.z-t.z;return e*e+n*n+r*r}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,e,n){const r=Math.sin(e)*t;return this.x=r*Math.sin(n),this.y=Math.cos(e)*t,this.z=r*Math.cos(n),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,e,n){return this.x=t*Math.sin(e),this.y=n,this.z=t*Math.cos(e),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this}setFromMatrixScale(t){const e=this.setFromMatrixColumn(t,0).length(),n=this.setFromMatrixColumn(t,1).length(),r=this.setFromMatrixColumn(t,2).length();return this.x=e,this.y=n,this.z=r,this}setFromMatrixColumn(t,e){return this.fromArray(t.elements,e*4)}setFromMatrix3Column(t,e){return this.fromArray(t.elements,e*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const t=Math.random()*Math.PI*2,e=Math.random()*2-1,n=Math.sqrt(1-e*e);return this.x=n*Math.cos(t),this.y=e,this.z=n*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const us=new F,_o=new fr;class Ft{constructor(t,e,n,r,s,o,a,l,c){Ft.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,e,n,r,s,o,a,l,c)}set(t,e,n,r,s,o,a,l,c){const h=this.elements;return h[0]=t,h[1]=r,h[2]=a,h[3]=e,h[4]=s,h[5]=l,h[6]=n,h[7]=o,h[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){const e=this.elements,n=t.elements;return e[0]=n[0],e[1]=n[1],e[2]=n[2],e[3]=n[3],e[4]=n[4],e[5]=n[5],e[6]=n[6],e[7]=n[7],e[8]=n[8],this}extractBasis(t,e,n){return t.setFromMatrix3Column(this,0),e.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(t){const e=t.elements;return this.set(e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const n=t.elements,r=e.elements,s=this.elements,o=n[0],a=n[3],l=n[6],c=n[1],h=n[4],d=n[7],f=n[2],m=n[5],g=n[8],x=r[0],p=r[3],u=r[6],b=r[1],T=r[4],E=r[7],C=r[2],w=r[5],R=r[8];return s[0]=o*x+a*b+l*C,s[3]=o*p+a*T+l*w,s[6]=o*u+a*E+l*R,s[1]=c*x+h*b+d*C,s[4]=c*p+h*T+d*w,s[7]=c*u+h*E+d*R,s[2]=f*x+m*b+g*C,s[5]=f*p+m*T+g*w,s[8]=f*u+m*E+g*R,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[3]*=t,e[6]*=t,e[1]*=t,e[4]*=t,e[7]*=t,e[2]*=t,e[5]*=t,e[8]*=t,this}determinant(){const t=this.elements,e=t[0],n=t[1],r=t[2],s=t[3],o=t[4],a=t[5],l=t[6],c=t[7],h=t[8];return e*o*h-e*a*c-n*s*h+n*a*l+r*s*c-r*o*l}invert(){const t=this.elements,e=t[0],n=t[1],r=t[2],s=t[3],o=t[4],a=t[5],l=t[6],c=t[7],h=t[8],d=h*o-a*c,f=a*l-h*s,m=c*s-o*l,g=e*d+n*f+r*m;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);const x=1/g;return t[0]=d*x,t[1]=(r*c-h*n)*x,t[2]=(a*n-r*o)*x,t[3]=f*x,t[4]=(h*e-r*l)*x,t[5]=(r*s-a*e)*x,t[6]=m*x,t[7]=(n*l-c*e)*x,t[8]=(o*e-n*s)*x,this}transpose(){let t;const e=this.elements;return t=e[1],e[1]=e[3],e[3]=t,t=e[2],e[2]=e[6],e[6]=t,t=e[5],e[5]=e[7],e[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){const e=this.elements;return t[0]=e[0],t[1]=e[3],t[2]=e[6],t[3]=e[1],t[4]=e[4],t[5]=e[7],t[6]=e[2],t[7]=e[5],t[8]=e[8],this}setUvTransform(t,e,n,r,s,o,a){const l=Math.cos(s),c=Math.sin(s);return this.set(n*l,n*c,-n*(l*o+c*a)+o+t,-r*c,r*l,-r*(-c*o+l*a)+a+e,0,0,1),this}scale(t,e){return this.premultiply(hs.makeScale(t,e)),this}rotate(t){return this.premultiply(hs.makeRotation(-t)),this}translate(t,e){return this.premultiply(hs.makeTranslation(t,e)),this}makeTranslation(t,e){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,e,0,0,1),this}makeRotation(t){const e=Math.cos(t),n=Math.sin(t);return this.set(e,-n,0,n,e,0,0,0,1),this}makeScale(t,e){return this.set(t,0,0,0,e,0,0,0,1),this}equals(t){const e=this.elements,n=t.elements;for(let r=0;r<9;r++)if(e[r]!==n[r])return!1;return!0}fromArray(t,e=0){for(let n=0;n<9;n++)this.elements[n]=t[n+e];return this}toArray(t=[],e=0){const n=this.elements;return t[e]=n[0],t[e+1]=n[1],t[e+2]=n[2],t[e+3]=n[3],t[e+4]=n[4],t[e+5]=n[5],t[e+6]=n[6],t[e+7]=n[7],t[e+8]=n[8],t}clone(){return new this.constructor().fromArray(this.elements)}}const hs=new Ft;function Nl(i){for(let t=i.length-1;t>=0;--t)if(i[t]>=65535)return!0;return!1}function Jr(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function su(){const i=Jr("canvas");return i.style.display="block",i}const vo={};function hr(i){i in vo||(vo[i]=!0,console.warn(i))}function au(i,t,e){return new Promise(function(n,r){function s(){switch(i.clientWaitSync(t,i.SYNC_FLUSH_COMMANDS_BIT,0)){case i.WAIT_FAILED:r();break;case i.TIMEOUT_EXPIRED:setTimeout(s,e);break;default:n()}}setTimeout(s,e)})}const xo=new Ft().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Mo=new Ft().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function ou(){const i={enabled:!0,workingColorSpace:Gi,spaces:{},convert:function(r,s,o){return this.enabled===!1||s===o||!s||!o||(this.spaces[s].transfer===Zt&&(r.r=wn(r.r),r.g=wn(r.g),r.b=wn(r.b)),this.spaces[s].primaries!==this.spaces[o].primaries&&(r.applyMatrix3(this.spaces[s].toXYZ),r.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===Zt&&(r.r=zi(r.r),r.g=zi(r.g),r.b=zi(r.b))),r},workingToColorSpace:function(r,s){return this.convert(r,this.workingColorSpace,s)},colorSpaceToWorking:function(r,s){return this.convert(r,s,this.workingColorSpace)},getPrimaries:function(r){return this.spaces[r].primaries},getTransfer:function(r){return r===On?jr:this.spaces[r].transfer},getToneMappingMode:function(r){return this.spaces[r].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(r,s=this.workingColorSpace){return r.fromArray(this.spaces[s].luminanceCoefficients)},define:function(r){Object.assign(this.spaces,r)},_getMatrix:function(r,s,o){return r.copy(this.spaces[s].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(r){return this.spaces[r].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(r=this.workingColorSpace){return this.spaces[r].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(r,s){return hr("THREE.ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),i.workingToColorSpace(r,s)},toWorkingColorSpace:function(r,s){return hr("THREE.ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),i.colorSpaceToWorking(r,s)}},t=[.64,.33,.3,.6,.15,.06],e=[.2126,.7152,.0722],n=[.3127,.329];return i.define({[Gi]:{primaries:t,whitePoint:n,transfer:jr,toXYZ:xo,fromXYZ:Mo,luminanceCoefficients:e,workingColorSpaceConfig:{unpackColorSpace:Le},outputColorSpaceConfig:{drawingBufferColorSpace:Le}},[Le]:{primaries:t,whitePoint:n,transfer:Zt,toXYZ:xo,fromXYZ:Mo,luminanceCoefficients:e,outputColorSpaceConfig:{drawingBufferColorSpace:Le}}}),i}const Yt=ou();function wn(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function zi(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}let xi;class lu{static getDataURL(t,e="image/png"){if(/^data:/i.test(t.src)||typeof HTMLCanvasElement>"u")return t.src;let n;if(t instanceof HTMLCanvasElement)n=t;else{xi===void 0&&(xi=Jr("canvas")),xi.width=t.width,xi.height=t.height;const r=xi.getContext("2d");t instanceof ImageData?r.putImageData(t,0,0):r.drawImage(t,0,0,t.width,t.height),n=xi}return n.toDataURL(e)}static sRGBToLinear(t){if(typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap){const e=Jr("canvas");e.width=t.width,e.height=t.height;const n=e.getContext("2d");n.drawImage(t,0,0,t.width,t.height);const r=n.getImageData(0,0,t.width,t.height),s=r.data;for(let o=0;o<s.length;o++)s[o]=wn(s[o]/255)*255;return n.putImageData(r,0,0),e}else if(t.data){const e=t.data.slice(0);for(let n=0;n<e.length;n++)e instanceof Uint8Array||e instanceof Uint8ClampedArray?e[n]=Math.floor(wn(e[n]/255)*255):e[n]=wn(e[n]);return{data:e,width:t.width,height:t.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),t}}let cu=0;class Wa{constructor(t=null){this.isSource=!0,Object.defineProperty(this,"id",{value:cu++}),this.uuid=Vn(),this.data=t,this.dataReady=!0,this.version=0}getSize(t){const e=this.data;return typeof HTMLVideoElement<"u"&&e instanceof HTMLVideoElement?t.set(e.videoWidth,e.videoHeight,0):e instanceof VideoFrame?t.set(e.displayHeight,e.displayWidth,0):e!==null?t.set(e.width,e.height,e.depth||0):t.set(0,0,0),t}set needsUpdate(t){t===!0&&this.version++}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.images[this.uuid]!==void 0)return t.images[this.uuid];const n={uuid:this.uuid,url:""},r=this.data;if(r!==null){let s;if(Array.isArray(r)){s=[];for(let o=0,a=r.length;o<a;o++)r[o].isDataTexture?s.push(ds(r[o].image)):s.push(ds(r[o]))}else s=ds(r);n.url=s}return e||(t.images[this.uuid]=n),n}}function ds(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?lu.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let uu=0;const fs=new F;class Te extends Xi{constructor(t=Te.DEFAULT_IMAGE,e=Te.DEFAULT_MAPPING,n=oi,r=oi,s=dn,o=li,a=en,l=mn,c=Te.DEFAULT_ANISOTROPY,h=On){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:uu++}),this.uuid=Vn(),this.name="",this.source=new Wa(t),this.mipmaps=[],this.mapping=e,this.channel=0,this.wrapS=n,this.wrapT=r,this.magFilter=s,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new Ot(0,0),this.repeat=new Ot(1,1),this.center=new Ot(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Ft,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0}get width(){return this.source.getSize(fs).x}get height(){return this.source.getSize(fs).y}get depth(){return this.source.getSize(fs).z}get image(){return this.source.data}set image(t=null){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.renderTarget=t.renderTarget,this.isRenderTargetTexture=t.isRenderTargetTexture,this.isArrayTexture=t.isArrayTexture,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}setValues(t){for(const e in t){const n=t[e];if(n===void 0){console.warn(`THREE.Texture.setValues(): parameter '${e}' has value of undefined.`);continue}const r=this[e];if(r===void 0){console.warn(`THREE.Texture.setValues(): property '${e}' does not exist.`);continue}r&&n&&r.isVector2&&n.isVector2||r&&n&&r.isVector3&&n.isVector3||r&&n&&r.isMatrix3&&n.isMatrix3?r.copy(n):this[e]=n}}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];const n={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),e||(t.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==bl)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case Kr:t.x=t.x-Math.floor(t.x);break;case oi:t.x=t.x<0?0:1;break;case ta:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case Kr:t.y=t.y-Math.floor(t.y);break;case oi:t.y=t.y<0?0:1;break;case ta:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}}Te.DEFAULT_IMAGE=null;Te.DEFAULT_MAPPING=bl;Te.DEFAULT_ANISOTROPY=1;class he{constructor(t=0,e=0,n=0,r=1){he.prototype.isVector4=!0,this.x=t,this.y=e,this.z=n,this.w=r}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,e,n,r){return this.x=t,this.y=e,this.z=n,this.w=r,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;case 3:this.w=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this.w=t.w+e.w,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this.w+=t.w*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this.w=t.w-e.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){const e=this.x,n=this.y,r=this.z,s=this.w,o=t.elements;return this.x=o[0]*e+o[4]*n+o[8]*r+o[12]*s,this.y=o[1]*e+o[5]*n+o[9]*r+o[13]*s,this.z=o[2]*e+o[6]*n+o[10]*r+o[14]*s,this.w=o[3]*e+o[7]*n+o[11]*r+o[15]*s,this}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this.w/=t.w,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);const e=Math.sqrt(1-t.w*t.w);return e<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/e,this.y=t.y/e,this.z=t.z/e),this}setAxisAngleFromRotationMatrix(t){let e,n,r,s;const l=t.elements,c=l[0],h=l[4],d=l[8],f=l[1],m=l[5],g=l[9],x=l[2],p=l[6],u=l[10];if(Math.abs(h-f)<.01&&Math.abs(d-x)<.01&&Math.abs(g-p)<.01){if(Math.abs(h+f)<.1&&Math.abs(d+x)<.1&&Math.abs(g+p)<.1&&Math.abs(c+m+u-3)<.1)return this.set(1,0,0,0),this;e=Math.PI;const T=(c+1)/2,E=(m+1)/2,C=(u+1)/2,w=(h+f)/4,R=(d+x)/4,U=(g+p)/4;return T>E&&T>C?T<.01?(n=0,r=.707106781,s=.707106781):(n=Math.sqrt(T),r=w/n,s=R/n):E>C?E<.01?(n=.707106781,r=0,s=.707106781):(r=Math.sqrt(E),n=w/r,s=U/r):C<.01?(n=.707106781,r=.707106781,s=0):(s=Math.sqrt(C),n=R/s,r=U/s),this.set(n,r,s,e),this}let b=Math.sqrt((p-g)*(p-g)+(d-x)*(d-x)+(f-h)*(f-h));return Math.abs(b)<.001&&(b=1),this.x=(p-g)/b,this.y=(d-x)/b,this.z=(f-h)/b,this.w=Math.acos((c+m+u-1)/2),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this.w=e[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,e){return this.x=Wt(this.x,t.x,e.x),this.y=Wt(this.y,t.y,e.y),this.z=Wt(this.z,t.z,e.z),this.w=Wt(this.w,t.w,e.w),this}clampScalar(t,e){return this.x=Wt(this.x,t,e),this.y=Wt(this.y,t,e),this.z=Wt(this.z,t,e),this.w=Wt(this.w,t,e),this}clampLength(t,e){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Wt(n,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this.w+=(t.w-this.w)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this.z=t.z+(e.z-t.z)*n,this.w=t.w+(e.w-t.w)*n,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this.w=t[e+3],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t[e+3]=this.w,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this.w=t.getW(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class hu extends Xi{constructor(t=1,e=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:dn,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},n),this.isRenderTarget=!0,this.width=t,this.height=e,this.depth=n.depth,this.scissor=new he(0,0,t,e),this.scissorTest=!1,this.viewport=new he(0,0,t,e);const r={width:t,height:e,depth:n.depth},s=new Te(r);this.textures=[];const o=n.count;for(let a=0;a<o;a++)this.textures[a]=s.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview}_setTextureOptions(t={}){const e={minFilter:dn,generateMipmaps:!1,flipY:!1,internalFormat:null};t.mapping!==void 0&&(e.mapping=t.mapping),t.wrapS!==void 0&&(e.wrapS=t.wrapS),t.wrapT!==void 0&&(e.wrapT=t.wrapT),t.wrapR!==void 0&&(e.wrapR=t.wrapR),t.magFilter!==void 0&&(e.magFilter=t.magFilter),t.minFilter!==void 0&&(e.minFilter=t.minFilter),t.format!==void 0&&(e.format=t.format),t.type!==void 0&&(e.type=t.type),t.anisotropy!==void 0&&(e.anisotropy=t.anisotropy),t.colorSpace!==void 0&&(e.colorSpace=t.colorSpace),t.flipY!==void 0&&(e.flipY=t.flipY),t.generateMipmaps!==void 0&&(e.generateMipmaps=t.generateMipmaps),t.internalFormat!==void 0&&(e.internalFormat=t.internalFormat);for(let n=0;n<this.textures.length;n++)this.textures[n].setValues(e)}get texture(){return this.textures[0]}set texture(t){this.textures[0]=t}set depthTexture(t){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),t!==null&&(t.renderTarget=this),this._depthTexture=t}get depthTexture(){return this._depthTexture}setSize(t,e,n=1){if(this.width!==t||this.height!==e||this.depth!==n){this.width=t,this.height=e,this.depth=n;for(let r=0,s=this.textures.length;r<s;r++)this.textures[r].image.width=t,this.textures[r].image.height=e,this.textures[r].image.depth=n,this.textures[r].isArrayTexture=this.textures[r].image.depth>1;this.dispose()}this.viewport.set(0,0,t,e),this.scissor.set(0,0,t,e)}clone(){return new this.constructor().copy(this)}copy(t){this.width=t.width,this.height=t.height,this.depth=t.depth,this.scissor.copy(t.scissor),this.scissorTest=t.scissorTest,this.viewport.copy(t.viewport),this.textures.length=0;for(let e=0,n=t.textures.length;e<n;e++){this.textures[e]=t.textures[e].clone(),this.textures[e].isRenderTargetTexture=!0,this.textures[e].renderTarget=this;const r=Object.assign({},t.textures[e].image);this.textures[e].source=new Wa(r)}return this.depthBuffer=t.depthBuffer,this.stencilBuffer=t.stencilBuffer,this.resolveDepthBuffer=t.resolveDepthBuffer,this.resolveStencilBuffer=t.resolveStencilBuffer,t.depthTexture!==null&&(this.depthTexture=t.depthTexture.clone()),this.samples=t.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class di extends hu{constructor(t=1,e=1,n={}){super(t,e,n),this.isWebGLRenderTarget=!0}}class Fl extends Te{constructor(t=null,e=1,n=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:t,width:e,height:n,depth:r},this.magFilter=Ue,this.minFilter=Ue,this.wrapR=oi,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(t){this.layerUpdates.add(t)}clearLayerUpdates(){this.layerUpdates.clear()}}class du extends Te{constructor(t=null,e=1,n=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:t,width:e,height:n,depth:r},this.magFilter=Ue,this.minFilter=Ue,this.wrapR=oi,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class pi{constructor(t=new F(1/0,1/0,1/0),e=new F(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromArray(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e+=3)this.expandByPoint(je.fromArray(t,e));return this}setFromBufferAttribute(t){this.makeEmpty();for(let e=0,n=t.count;e<n;e++)this.expandByPoint(je.fromBufferAttribute(t,e));return this}setFromPoints(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){const n=je.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(n),this.max.copy(t).add(n),this}setFromObject(t,e=!1){return this.makeEmpty(),this.expandByObject(t,e)}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(t){return this.isEmpty()?t.set(0,0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}expandByObject(t,e=!1){t.updateWorldMatrix(!1,!1);const n=t.geometry;if(n!==void 0){const s=n.getAttribute("position");if(e===!0&&s!==void 0&&t.isInstancedMesh!==!0)for(let o=0,a=s.count;o<a;o++)t.isMesh===!0?t.getVertexPosition(o,je):je.fromBufferAttribute(s,o),je.applyMatrix4(t.matrixWorld),this.expandByPoint(je);else t.boundingBox!==void 0?(t.boundingBox===null&&t.computeBoundingBox(),xr.copy(t.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),xr.copy(n.boundingBox)),xr.applyMatrix4(t.matrixWorld),this.union(xr)}const r=t.children;for(let s=0,o=r.length;s<o;s++)this.expandByObject(r[s],e);return this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y&&t.z>=this.min.z&&t.z<=this.max.z}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y&&this.min.z<=t.min.z&&t.max.z<=this.max.z}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y),(t.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y&&t.max.z>=this.min.z&&t.min.z<=this.max.z}intersectsSphere(t){return this.clampPoint(t.center,je),je.distanceToSquared(t.center)<=t.radius*t.radius}intersectsPlane(t){let e,n;return t.normal.x>0?(e=t.normal.x*this.min.x,n=t.normal.x*this.max.x):(e=t.normal.x*this.max.x,n=t.normal.x*this.min.x),t.normal.y>0?(e+=t.normal.y*this.min.y,n+=t.normal.y*this.max.y):(e+=t.normal.y*this.max.y,n+=t.normal.y*this.min.y),t.normal.z>0?(e+=t.normal.z*this.min.z,n+=t.normal.z*this.max.z):(e+=t.normal.z*this.max.z,n+=t.normal.z*this.min.z),e<=-t.constant&&n>=-t.constant}intersectsTriangle(t){if(this.isEmpty())return!1;this.getCenter(Ki),Mr.subVectors(this.max,Ki),Mi.subVectors(t.a,Ki),Si.subVectors(t.b,Ki),Ei.subVectors(t.c,Ki),Cn.subVectors(Si,Mi),Pn.subVectors(Ei,Si),jn.subVectors(Mi,Ei);let e=[0,-Cn.z,Cn.y,0,-Pn.z,Pn.y,0,-jn.z,jn.y,Cn.z,0,-Cn.x,Pn.z,0,-Pn.x,jn.z,0,-jn.x,-Cn.y,Cn.x,0,-Pn.y,Pn.x,0,-jn.y,jn.x,0];return!ps(e,Mi,Si,Ei,Mr)||(e=[1,0,0,0,1,0,0,0,1],!ps(e,Mi,Si,Ei,Mr))?!1:(Sr.crossVectors(Cn,Pn),e=[Sr.x,Sr.y,Sr.z],ps(e,Mi,Si,Ei,Mr))}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,je).distanceTo(t)}getBoundingSphere(t){return this.isEmpty()?t.makeEmpty():(this.getCenter(t.center),t.radius=this.getSize(je).length()*.5),t}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}applyMatrix4(t){return this.isEmpty()?this:(xn[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(t),xn[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(t),xn[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(t),xn[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(t),xn[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(t),xn[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(t),xn[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(t),xn[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(t),this.setFromPoints(xn),this)}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(t){return this.min.fromArray(t.min),this.max.fromArray(t.max),this}}const xn=[new F,new F,new F,new F,new F,new F,new F,new F],je=new F,xr=new pi,Mi=new F,Si=new F,Ei=new F,Cn=new F,Pn=new F,jn=new F,Ki=new F,Mr=new F,Sr=new F,Zn=new F;function ps(i,t,e,n,r){for(let s=0,o=i.length-3;s<=o;s+=3){Zn.fromArray(i,s);const a=r.x*Math.abs(Zn.x)+r.y*Math.abs(Zn.y)+r.z*Math.abs(Zn.z),l=t.dot(Zn),c=e.dot(Zn),h=n.dot(Zn);if(Math.max(-Math.max(l,c,h),Math.min(l,c,h))>a)return!1}return!0}const fu=new pi,ji=new F,ms=new F;class pr{constructor(t=new F,e=-1){this.isSphere=!0,this.center=t,this.radius=e}set(t,e){return this.center.copy(t),this.radius=e,this}setFromPoints(t,e){const n=this.center;e!==void 0?n.copy(e):fu.setFromPoints(t).getCenter(n);let r=0;for(let s=0,o=t.length;s<o;s++)r=Math.max(r,n.distanceToSquared(t[s]));return this.radius=Math.sqrt(r),this}copy(t){return this.center.copy(t.center),this.radius=t.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(t){return t.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(t){return t.distanceTo(this.center)-this.radius}intersectsSphere(t){const e=this.radius+t.radius;return t.center.distanceToSquared(this.center)<=e*e}intersectsBox(t){return t.intersectsSphere(this)}intersectsPlane(t){return Math.abs(t.distanceToPoint(this.center))<=this.radius}clampPoint(t,e){const n=this.center.distanceToSquared(t);return e.copy(t),n>this.radius*this.radius&&(e.sub(this.center).normalize(),e.multiplyScalar(this.radius).add(this.center)),e}getBoundingBox(t){return this.isEmpty()?(t.makeEmpty(),t):(t.set(this.center,this.center),t.expandByScalar(this.radius),t)}applyMatrix4(t){return this.center.applyMatrix4(t),this.radius=this.radius*t.getMaxScaleOnAxis(),this}translate(t){return this.center.add(t),this}expandByPoint(t){if(this.isEmpty())return this.center.copy(t),this.radius=0,this;ji.subVectors(t,this.center);const e=ji.lengthSq();if(e>this.radius*this.radius){const n=Math.sqrt(e),r=(n-this.radius)*.5;this.center.addScaledVector(ji,r/n),this.radius+=r}return this}union(t){return t.isEmpty()?this:this.isEmpty()?(this.copy(t),this):(this.center.equals(t.center)===!0?this.radius=Math.max(this.radius,t.radius):(ms.subVectors(t.center,this.center).setLength(t.radius),this.expandByPoint(ji.copy(t.center).add(ms)),this.expandByPoint(ji.copy(t.center).sub(ms))),this)}equals(t){return t.center.equals(this.center)&&t.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(t){return this.radius=t.radius,this.center.fromArray(t.center),this}}const Mn=new F,gs=new F,Er=new F,Dn=new F,_s=new F,yr=new F,vs=new F;class Ol{constructor(t=new F,e=new F(0,0,-1)){this.origin=t,this.direction=e}set(t,e){return this.origin.copy(t),this.direction.copy(e),this}copy(t){return this.origin.copy(t.origin),this.direction.copy(t.direction),this}at(t,e){return e.copy(this.origin).addScaledVector(this.direction,t)}lookAt(t){return this.direction.copy(t).sub(this.origin).normalize(),this}recast(t){return this.origin.copy(this.at(t,Mn)),this}closestPointToPoint(t,e){e.subVectors(t,this.origin);const n=e.dot(this.direction);return n<0?e.copy(this.origin):e.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(t){return Math.sqrt(this.distanceSqToPoint(t))}distanceSqToPoint(t){const e=Mn.subVectors(t,this.origin).dot(this.direction);return e<0?this.origin.distanceToSquared(t):(Mn.copy(this.origin).addScaledVector(this.direction,e),Mn.distanceToSquared(t))}distanceSqToSegment(t,e,n,r){gs.copy(t).add(e).multiplyScalar(.5),Er.copy(e).sub(t).normalize(),Dn.copy(this.origin).sub(gs);const s=t.distanceTo(e)*.5,o=-this.direction.dot(Er),a=Dn.dot(this.direction),l=-Dn.dot(Er),c=Dn.lengthSq(),h=Math.abs(1-o*o);let d,f,m,g;if(h>0)if(d=o*l-a,f=o*a-l,g=s*h,d>=0)if(f>=-g)if(f<=g){const x=1/h;d*=x,f*=x,m=d*(d+o*f+2*a)+f*(o*d+f+2*l)+c}else f=s,d=Math.max(0,-(o*f+a)),m=-d*d+f*(f+2*l)+c;else f=-s,d=Math.max(0,-(o*f+a)),m=-d*d+f*(f+2*l)+c;else f<=-g?(d=Math.max(0,-(-o*s+a)),f=d>0?-s:Math.min(Math.max(-s,-l),s),m=-d*d+f*(f+2*l)+c):f<=g?(d=0,f=Math.min(Math.max(-s,-l),s),m=f*(f+2*l)+c):(d=Math.max(0,-(o*s+a)),f=d>0?s:Math.min(Math.max(-s,-l),s),m=-d*d+f*(f+2*l)+c);else f=o>0?-s:s,d=Math.max(0,-(o*f+a)),m=-d*d+f*(f+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,d),r&&r.copy(gs).addScaledVector(Er,f),m}intersectSphere(t,e){Mn.subVectors(t.center,this.origin);const n=Mn.dot(this.direction),r=Mn.dot(Mn)-n*n,s=t.radius*t.radius;if(r>s)return null;const o=Math.sqrt(s-r),a=n-o,l=n+o;return l<0?null:a<0?this.at(l,e):this.at(a,e)}intersectsSphere(t){return t.radius<0?!1:this.distanceSqToPoint(t.center)<=t.radius*t.radius}distanceToPlane(t){const e=t.normal.dot(this.direction);if(e===0)return t.distanceToPoint(this.origin)===0?0:null;const n=-(this.origin.dot(t.normal)+t.constant)/e;return n>=0?n:null}intersectPlane(t,e){const n=this.distanceToPlane(t);return n===null?null:this.at(n,e)}intersectsPlane(t){const e=t.distanceToPoint(this.origin);return e===0||t.normal.dot(this.direction)*e<0}intersectBox(t,e){let n,r,s,o,a,l;const c=1/this.direction.x,h=1/this.direction.y,d=1/this.direction.z,f=this.origin;return c>=0?(n=(t.min.x-f.x)*c,r=(t.max.x-f.x)*c):(n=(t.max.x-f.x)*c,r=(t.min.x-f.x)*c),h>=0?(s=(t.min.y-f.y)*h,o=(t.max.y-f.y)*h):(s=(t.max.y-f.y)*h,o=(t.min.y-f.y)*h),n>o||s>r||((s>n||isNaN(n))&&(n=s),(o<r||isNaN(r))&&(r=o),d>=0?(a=(t.min.z-f.z)*d,l=(t.max.z-f.z)*d):(a=(t.max.z-f.z)*d,l=(t.min.z-f.z)*d),n>l||a>r)||((a>n||n!==n)&&(n=a),(l<r||r!==r)&&(r=l),r<0)?null:this.at(n>=0?n:r,e)}intersectsBox(t){return this.intersectBox(t,Mn)!==null}intersectTriangle(t,e,n,r,s){_s.subVectors(e,t),yr.subVectors(n,t),vs.crossVectors(_s,yr);let o=this.direction.dot(vs),a;if(o>0){if(r)return null;a=1}else if(o<0)a=-1,o=-o;else return null;Dn.subVectors(this.origin,t);const l=a*this.direction.dot(yr.crossVectors(Dn,yr));if(l<0)return null;const c=a*this.direction.dot(_s.cross(Dn));if(c<0||l+c>o)return null;const h=-a*Dn.dot(vs);return h<0?null:this.at(h/o,s)}applyMatrix4(t){return this.origin.applyMatrix4(t),this.direction.transformDirection(t),this}equals(t){return t.origin.equals(this.origin)&&t.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class te{constructor(t,e,n,r,s,o,a,l,c,h,d,f,m,g,x,p){te.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,e,n,r,s,o,a,l,c,h,d,f,m,g,x,p)}set(t,e,n,r,s,o,a,l,c,h,d,f,m,g,x,p){const u=this.elements;return u[0]=t,u[4]=e,u[8]=n,u[12]=r,u[1]=s,u[5]=o,u[9]=a,u[13]=l,u[2]=c,u[6]=h,u[10]=d,u[14]=f,u[3]=m,u[7]=g,u[11]=x,u[15]=p,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new te().fromArray(this.elements)}copy(t){const e=this.elements,n=t.elements;return e[0]=n[0],e[1]=n[1],e[2]=n[2],e[3]=n[3],e[4]=n[4],e[5]=n[5],e[6]=n[6],e[7]=n[7],e[8]=n[8],e[9]=n[9],e[10]=n[10],e[11]=n[11],e[12]=n[12],e[13]=n[13],e[14]=n[14],e[15]=n[15],this}copyPosition(t){const e=this.elements,n=t.elements;return e[12]=n[12],e[13]=n[13],e[14]=n[14],this}setFromMatrix3(t){const e=t.elements;return this.set(e[0],e[3],e[6],0,e[1],e[4],e[7],0,e[2],e[5],e[8],0,0,0,0,1),this}extractBasis(t,e,n){return t.setFromMatrixColumn(this,0),e.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(t,e,n){return this.set(t.x,e.x,n.x,0,t.y,e.y,n.y,0,t.z,e.z,n.z,0,0,0,0,1),this}extractRotation(t){const e=this.elements,n=t.elements,r=1/yi.setFromMatrixColumn(t,0).length(),s=1/yi.setFromMatrixColumn(t,1).length(),o=1/yi.setFromMatrixColumn(t,2).length();return e[0]=n[0]*r,e[1]=n[1]*r,e[2]=n[2]*r,e[3]=0,e[4]=n[4]*s,e[5]=n[5]*s,e[6]=n[6]*s,e[7]=0,e[8]=n[8]*o,e[9]=n[9]*o,e[10]=n[10]*o,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromEuler(t){const e=this.elements,n=t.x,r=t.y,s=t.z,o=Math.cos(n),a=Math.sin(n),l=Math.cos(r),c=Math.sin(r),h=Math.cos(s),d=Math.sin(s);if(t.order==="XYZ"){const f=o*h,m=o*d,g=a*h,x=a*d;e[0]=l*h,e[4]=-l*d,e[8]=c,e[1]=m+g*c,e[5]=f-x*c,e[9]=-a*l,e[2]=x-f*c,e[6]=g+m*c,e[10]=o*l}else if(t.order==="YXZ"){const f=l*h,m=l*d,g=c*h,x=c*d;e[0]=f+x*a,e[4]=g*a-m,e[8]=o*c,e[1]=o*d,e[5]=o*h,e[9]=-a,e[2]=m*a-g,e[6]=x+f*a,e[10]=o*l}else if(t.order==="ZXY"){const f=l*h,m=l*d,g=c*h,x=c*d;e[0]=f-x*a,e[4]=-o*d,e[8]=g+m*a,e[1]=m+g*a,e[5]=o*h,e[9]=x-f*a,e[2]=-o*c,e[6]=a,e[10]=o*l}else if(t.order==="ZYX"){const f=o*h,m=o*d,g=a*h,x=a*d;e[0]=l*h,e[4]=g*c-m,e[8]=f*c+x,e[1]=l*d,e[5]=x*c+f,e[9]=m*c-g,e[2]=-c,e[6]=a*l,e[10]=o*l}else if(t.order==="YZX"){const f=o*l,m=o*c,g=a*l,x=a*c;e[0]=l*h,e[4]=x-f*d,e[8]=g*d+m,e[1]=d,e[5]=o*h,e[9]=-a*h,e[2]=-c*h,e[6]=m*d+g,e[10]=f-x*d}else if(t.order==="XZY"){const f=o*l,m=o*c,g=a*l,x=a*c;e[0]=l*h,e[4]=-d,e[8]=c*h,e[1]=f*d+x,e[5]=o*h,e[9]=m*d-g,e[2]=g*d-m,e[6]=a*h,e[10]=x*d+f}return e[3]=0,e[7]=0,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromQuaternion(t){return this.compose(pu,t,mu)}lookAt(t,e,n){const r=this.elements;return He.subVectors(t,e),He.lengthSq()===0&&(He.z=1),He.normalize(),Ln.crossVectors(n,He),Ln.lengthSq()===0&&(Math.abs(n.z)===1?He.x+=1e-4:He.z+=1e-4,He.normalize(),Ln.crossVectors(n,He)),Ln.normalize(),br.crossVectors(He,Ln),r[0]=Ln.x,r[4]=br.x,r[8]=He.x,r[1]=Ln.y,r[5]=br.y,r[9]=He.y,r[2]=Ln.z,r[6]=br.z,r[10]=He.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const n=t.elements,r=e.elements,s=this.elements,o=n[0],a=n[4],l=n[8],c=n[12],h=n[1],d=n[5],f=n[9],m=n[13],g=n[2],x=n[6],p=n[10],u=n[14],b=n[3],T=n[7],E=n[11],C=n[15],w=r[0],R=r[4],U=r[8],S=r[12],M=r[1],P=r[5],O=r[9],k=r[13],Y=r[2],X=r[6],q=r[10],Z=r[14],V=r[3],at=r[7],ut=r[11],yt=r[15];return s[0]=o*w+a*M+l*Y+c*V,s[4]=o*R+a*P+l*X+c*at,s[8]=o*U+a*O+l*q+c*ut,s[12]=o*S+a*k+l*Z+c*yt,s[1]=h*w+d*M+f*Y+m*V,s[5]=h*R+d*P+f*X+m*at,s[9]=h*U+d*O+f*q+m*ut,s[13]=h*S+d*k+f*Z+m*yt,s[2]=g*w+x*M+p*Y+u*V,s[6]=g*R+x*P+p*X+u*at,s[10]=g*U+x*O+p*q+u*ut,s[14]=g*S+x*k+p*Z+u*yt,s[3]=b*w+T*M+E*Y+C*V,s[7]=b*R+T*P+E*X+C*at,s[11]=b*U+T*O+E*q+C*ut,s[15]=b*S+T*k+E*Z+C*yt,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[4]*=t,e[8]*=t,e[12]*=t,e[1]*=t,e[5]*=t,e[9]*=t,e[13]*=t,e[2]*=t,e[6]*=t,e[10]*=t,e[14]*=t,e[3]*=t,e[7]*=t,e[11]*=t,e[15]*=t,this}determinant(){const t=this.elements,e=t[0],n=t[4],r=t[8],s=t[12],o=t[1],a=t[5],l=t[9],c=t[13],h=t[2],d=t[6],f=t[10],m=t[14],g=t[3],x=t[7],p=t[11],u=t[15];return g*(+s*l*d-r*c*d-s*a*f+n*c*f+r*a*m-n*l*m)+x*(+e*l*m-e*c*f+s*o*f-r*o*m+r*c*h-s*l*h)+p*(+e*c*d-e*a*m-s*o*d+n*o*m+s*a*h-n*c*h)+u*(-r*a*h-e*l*d+e*a*f+r*o*d-n*o*f+n*l*h)}transpose(){const t=this.elements;let e;return e=t[1],t[1]=t[4],t[4]=e,e=t[2],t[2]=t[8],t[8]=e,e=t[6],t[6]=t[9],t[9]=e,e=t[3],t[3]=t[12],t[12]=e,e=t[7],t[7]=t[13],t[13]=e,e=t[11],t[11]=t[14],t[14]=e,this}setPosition(t,e,n){const r=this.elements;return t.isVector3?(r[12]=t.x,r[13]=t.y,r[14]=t.z):(r[12]=t,r[13]=e,r[14]=n),this}invert(){const t=this.elements,e=t[0],n=t[1],r=t[2],s=t[3],o=t[4],a=t[5],l=t[6],c=t[7],h=t[8],d=t[9],f=t[10],m=t[11],g=t[12],x=t[13],p=t[14],u=t[15],b=d*p*c-x*f*c+x*l*m-a*p*m-d*l*u+a*f*u,T=g*f*c-h*p*c-g*l*m+o*p*m+h*l*u-o*f*u,E=h*x*c-g*d*c+g*a*m-o*x*m-h*a*u+o*d*u,C=g*d*l-h*x*l-g*a*f+o*x*f+h*a*p-o*d*p,w=e*b+n*T+r*E+s*C;if(w===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const R=1/w;return t[0]=b*R,t[1]=(x*f*s-d*p*s-x*r*m+n*p*m+d*r*u-n*f*u)*R,t[2]=(a*p*s-x*l*s+x*r*c-n*p*c-a*r*u+n*l*u)*R,t[3]=(d*l*s-a*f*s-d*r*c+n*f*c+a*r*m-n*l*m)*R,t[4]=T*R,t[5]=(h*p*s-g*f*s+g*r*m-e*p*m-h*r*u+e*f*u)*R,t[6]=(g*l*s-o*p*s-g*r*c+e*p*c+o*r*u-e*l*u)*R,t[7]=(o*f*s-h*l*s+h*r*c-e*f*c-o*r*m+e*l*m)*R,t[8]=E*R,t[9]=(g*d*s-h*x*s-g*n*m+e*x*m+h*n*u-e*d*u)*R,t[10]=(o*x*s-g*a*s+g*n*c-e*x*c-o*n*u+e*a*u)*R,t[11]=(h*a*s-o*d*s-h*n*c+e*d*c+o*n*m-e*a*m)*R,t[12]=C*R,t[13]=(h*x*r-g*d*r+g*n*f-e*x*f-h*n*p+e*d*p)*R,t[14]=(g*a*r-o*x*r-g*n*l+e*x*l+o*n*p-e*a*p)*R,t[15]=(o*d*r-h*a*r+h*n*l-e*d*l-o*n*f+e*a*f)*R,this}scale(t){const e=this.elements,n=t.x,r=t.y,s=t.z;return e[0]*=n,e[4]*=r,e[8]*=s,e[1]*=n,e[5]*=r,e[9]*=s,e[2]*=n,e[6]*=r,e[10]*=s,e[3]*=n,e[7]*=r,e[11]*=s,this}getMaxScaleOnAxis(){const t=this.elements,e=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],n=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],r=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(e,n,r))}makeTranslation(t,e,n){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,e,0,0,1,n,0,0,0,1),this}makeRotationX(t){const e=Math.cos(t),n=Math.sin(t);return this.set(1,0,0,0,0,e,-n,0,0,n,e,0,0,0,0,1),this}makeRotationY(t){const e=Math.cos(t),n=Math.sin(t);return this.set(e,0,n,0,0,1,0,0,-n,0,e,0,0,0,0,1),this}makeRotationZ(t){const e=Math.cos(t),n=Math.sin(t);return this.set(e,-n,0,0,n,e,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,e){const n=Math.cos(e),r=Math.sin(e),s=1-n,o=t.x,a=t.y,l=t.z,c=s*o,h=s*a;return this.set(c*o+n,c*a-r*l,c*l+r*a,0,c*a+r*l,h*a+n,h*l-r*o,0,c*l-r*a,h*l+r*o,s*l*l+n,0,0,0,0,1),this}makeScale(t,e,n){return this.set(t,0,0,0,0,e,0,0,0,0,n,0,0,0,0,1),this}makeShear(t,e,n,r,s,o){return this.set(1,n,s,0,t,1,o,0,e,r,1,0,0,0,0,1),this}compose(t,e,n){const r=this.elements,s=e._x,o=e._y,a=e._z,l=e._w,c=s+s,h=o+o,d=a+a,f=s*c,m=s*h,g=s*d,x=o*h,p=o*d,u=a*d,b=l*c,T=l*h,E=l*d,C=n.x,w=n.y,R=n.z;return r[0]=(1-(x+u))*C,r[1]=(m+E)*C,r[2]=(g-T)*C,r[3]=0,r[4]=(m-E)*w,r[5]=(1-(f+u))*w,r[6]=(p+b)*w,r[7]=0,r[8]=(g+T)*R,r[9]=(p-b)*R,r[10]=(1-(f+x))*R,r[11]=0,r[12]=t.x,r[13]=t.y,r[14]=t.z,r[15]=1,this}decompose(t,e,n){const r=this.elements;let s=yi.set(r[0],r[1],r[2]).length();const o=yi.set(r[4],r[5],r[6]).length(),a=yi.set(r[8],r[9],r[10]).length();this.determinant()<0&&(s=-s),t.x=r[12],t.y=r[13],t.z=r[14],Ze.copy(this);const c=1/s,h=1/o,d=1/a;return Ze.elements[0]*=c,Ze.elements[1]*=c,Ze.elements[2]*=c,Ze.elements[4]*=h,Ze.elements[5]*=h,Ze.elements[6]*=h,Ze.elements[8]*=d,Ze.elements[9]*=d,Ze.elements[10]*=d,e.setFromRotationMatrix(Ze),n.x=s,n.y=o,n.z=a,this}makePerspective(t,e,n,r,s,o,a=pn,l=!1){const c=this.elements,h=2*s/(e-t),d=2*s/(n-r),f=(e+t)/(e-t),m=(n+r)/(n-r);let g,x;if(l)g=s/(o-s),x=o*s/(o-s);else if(a===pn)g=-(o+s)/(o-s),x=-2*o*s/(o-s);else if(a===Zr)g=-o/(o-s),x=-o*s/(o-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return c[0]=h,c[4]=0,c[8]=f,c[12]=0,c[1]=0,c[5]=d,c[9]=m,c[13]=0,c[2]=0,c[6]=0,c[10]=g,c[14]=x,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(t,e,n,r,s,o,a=pn,l=!1){const c=this.elements,h=2/(e-t),d=2/(n-r),f=-(e+t)/(e-t),m=-(n+r)/(n-r);let g,x;if(l)g=1/(o-s),x=o/(o-s);else if(a===pn)g=-2/(o-s),x=-(o+s)/(o-s);else if(a===Zr)g=-1/(o-s),x=-s/(o-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return c[0]=h,c[4]=0,c[8]=0,c[12]=f,c[1]=0,c[5]=d,c[9]=0,c[13]=m,c[2]=0,c[6]=0,c[10]=g,c[14]=x,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(t){const e=this.elements,n=t.elements;for(let r=0;r<16;r++)if(e[r]!==n[r])return!1;return!0}fromArray(t,e=0){for(let n=0;n<16;n++)this.elements[n]=t[n+e];return this}toArray(t=[],e=0){const n=this.elements;return t[e]=n[0],t[e+1]=n[1],t[e+2]=n[2],t[e+3]=n[3],t[e+4]=n[4],t[e+5]=n[5],t[e+6]=n[6],t[e+7]=n[7],t[e+8]=n[8],t[e+9]=n[9],t[e+10]=n[10],t[e+11]=n[11],t[e+12]=n[12],t[e+13]=n[13],t[e+14]=n[14],t[e+15]=n[15],t}}const yi=new F,Ze=new te,pu=new F(0,0,0),mu=new F(1,1,1),Ln=new F,br=new F,He=new F,So=new te,Eo=new fr;class gn{constructor(t=0,e=0,n=0,r=gn.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=e,this._z=n,this._order=r}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,e,n,r=this._order){return this._x=t,this._y=e,this._z=n,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,e=this._order,n=!0){const r=t.elements,s=r[0],o=r[4],a=r[8],l=r[1],c=r[5],h=r[9],d=r[2],f=r[6],m=r[10];switch(e){case"XYZ":this._y=Math.asin(Wt(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-h,m),this._z=Math.atan2(-o,s)):(this._x=Math.atan2(f,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Wt(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(a,m),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-d,s),this._z=0);break;case"ZXY":this._x=Math.asin(Wt(f,-1,1)),Math.abs(f)<.9999999?(this._y=Math.atan2(-d,m),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-Wt(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(f,m),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(Wt(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-h,c),this._y=Math.atan2(-d,s)):(this._x=0,this._y=Math.atan2(a,m));break;case"XZY":this._z=Math.asin(-Wt(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(f,c),this._y=Math.atan2(a,s)):(this._x=Math.atan2(-h,m),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+e)}return this._order=e,n===!0&&this._onChangeCallback(),this}setFromQuaternion(t,e,n){return So.makeRotationFromQuaternion(t),this.setFromRotationMatrix(So,e,n)}setFromVector3(t,e=this._order){return this.set(t.x,t.y,t.z,e)}reorder(t){return Eo.setFromEuler(this),this.setFromQuaternion(Eo,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}gn.DEFAULT_ORDER="XYZ";class Xa{constructor(){this.mask=1}set(t){this.mask=(1<<t|0)>>>0}enable(t){this.mask|=1<<t|0}enableAll(){this.mask=-1}toggle(t){this.mask^=1<<t|0}disable(t){this.mask&=~(1<<t|0)}disableAll(){this.mask=0}test(t){return(this.mask&t.mask)!==0}isEnabled(t){return(this.mask&(1<<t|0))!==0}}let gu=0;const yo=new F,bi=new fr,Sn=new te,Tr=new F,Zi=new F,_u=new F,vu=new fr,bo=new F(1,0,0),To=new F(0,1,0),Ao=new F(0,0,1),wo={type:"added"},xu={type:"removed"},Ti={type:"childadded",child:null},xs={type:"childremoved",child:null};class fe extends Xi{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:gu++}),this.uuid=Vn(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=fe.DEFAULT_UP.clone();const t=new F,e=new gn,n=new fr,r=new F(1,1,1);function s(){n.setFromEuler(e,!1)}function o(){e.setFromQuaternion(n,void 0,!1)}e._onChange(s),n._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:e},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:r},modelViewMatrix:{value:new te},normalMatrix:{value:new Ft}}),this.matrix=new te,this.matrixWorld=new te,this.matrixAutoUpdate=fe.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=fe.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Xa,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,e){this.quaternion.setFromAxisAngle(t,e)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,e){return bi.setFromAxisAngle(t,e),this.quaternion.multiply(bi),this}rotateOnWorldAxis(t,e){return bi.setFromAxisAngle(t,e),this.quaternion.premultiply(bi),this}rotateX(t){return this.rotateOnAxis(bo,t)}rotateY(t){return this.rotateOnAxis(To,t)}rotateZ(t){return this.rotateOnAxis(Ao,t)}translateOnAxis(t,e){return yo.copy(t).applyQuaternion(this.quaternion),this.position.add(yo.multiplyScalar(e)),this}translateX(t){return this.translateOnAxis(bo,t)}translateY(t){return this.translateOnAxis(To,t)}translateZ(t){return this.translateOnAxis(Ao,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(Sn.copy(this.matrixWorld).invert())}lookAt(t,e,n){t.isVector3?Tr.copy(t):Tr.set(t,e,n);const r=this.parent;this.updateWorldMatrix(!0,!1),Zi.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Sn.lookAt(Zi,Tr,this.up):Sn.lookAt(Tr,Zi,this.up),this.quaternion.setFromRotationMatrix(Sn),r&&(Sn.extractRotation(r.matrixWorld),bi.setFromRotationMatrix(Sn),this.quaternion.premultiply(bi.invert()))}add(t){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return t===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(wo),Ti.child=t,this.dispatchEvent(Ti),Ti.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}const e=this.children.indexOf(t);return e!==-1&&(t.parent=null,this.children.splice(e,1),t.dispatchEvent(xu),xs.child=t,this.dispatchEvent(xs),xs.child=null),this}removeFromParent(){const t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),Sn.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),Sn.multiply(t.parent.matrixWorld)),t.applyMatrix4(Sn),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(wo),Ti.child=t,this.dispatchEvent(Ti),Ti.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,e){if(this[t]===e)return this;for(let n=0,r=this.children.length;n<r;n++){const o=this.children[n].getObjectByProperty(t,e);if(o!==void 0)return o}}getObjectsByProperty(t,e,n=[]){this[t]===e&&n.push(this);const r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].getObjectsByProperty(t,e,n);return n}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Zi,t,_u),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Zi,vu,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);const e=this.matrixWorld.elements;return t.set(e[8],e[9],e[10]).normalize()}raycast(){}traverse(t){t(this);const e=this.children;for(let n=0,r=e.length;n<r;n++)e[n].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);const e=this.children;for(let n=0,r=e.length;n<r;n++)e[n].traverseVisible(t)}traverseAncestors(t){const e=this.parent;e!==null&&(t(e),e.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);const e=this.children;for(let n=0,r=e.length;n<r;n++)e[n].updateMatrixWorld(t)}updateWorldMatrix(t,e){const n=this.parent;if(t===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),e===!0){const r=this.children;for(let s=0,o=r.length;s<o;s++)r[s].updateWorldMatrix(!1,!0)}}toJSON(t){const e=t===void 0||typeof t=="string",n={};e&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});const r={};r.uuid=this.uuid,r.type=this.type,this.name!==""&&(r.name=this.name),this.castShadow===!0&&(r.castShadow=!0),this.receiveShadow===!0&&(r.receiveShadow=!0),this.visible===!1&&(r.visible=!1),this.frustumCulled===!1&&(r.frustumCulled=!1),this.renderOrder!==0&&(r.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(r.matrixAutoUpdate=!1),this.isInstancedMesh&&(r.type="InstancedMesh",r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type="BatchedMesh",r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?a.boundingBox.toJSON():void 0,boundingSphere:a.boundingSphere?a.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(a=>({...a})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(t),r.indirectTexture=this._indirectTexture.toJSON(t),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function s(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(t)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=s(t.geometries,this.geometry);const a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){const l=a.shapes;if(Array.isArray(l))for(let c=0,h=l.length;c<h;c++){const d=l[c];s(t.shapes,d)}else s(t.shapes,l)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(t.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(s(t.materials,this.material[l]));r.material=a}else r.material=s(t.materials,this.material);if(this.children.length>0){r.children=[];for(let a=0;a<this.children.length;a++)r.children.push(this.children[a].toJSON(t).object)}if(this.animations.length>0){r.animations=[];for(let a=0;a<this.animations.length;a++){const l=this.animations[a];r.animations.push(s(t.animations,l))}}if(e){const a=o(t.geometries),l=o(t.materials),c=o(t.textures),h=o(t.images),d=o(t.shapes),f=o(t.skeletons),m=o(t.animations),g=o(t.nodes);a.length>0&&(n.geometries=a),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),h.length>0&&(n.images=h),d.length>0&&(n.shapes=d),f.length>0&&(n.skeletons=f),m.length>0&&(n.animations=m),g.length>0&&(n.nodes=g)}return n.object=r,n;function o(a){const l=[];for(const c in a){const h=a[c];delete h.metadata,l.push(h)}return l}}clone(t){return new this.constructor().copy(this,t)}copy(t,e=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),e===!0)for(let n=0;n<t.children.length;n++){const r=t.children[n];this.add(r.clone())}return this}}fe.DEFAULT_UP=new F(0,1,0);fe.DEFAULT_MATRIX_AUTO_UPDATE=!0;fe.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const Je=new F,En=new F,Ms=new F,yn=new F,Ai=new F,wi=new F,Ro=new F,Ss=new F,Es=new F,ys=new F,bs=new he,Ts=new he,As=new he;class Ye{constructor(t=new F,e=new F,n=new F){this.a=t,this.b=e,this.c=n}static getNormal(t,e,n,r){r.subVectors(n,e),Je.subVectors(t,e),r.cross(Je);const s=r.lengthSq();return s>0?r.multiplyScalar(1/Math.sqrt(s)):r.set(0,0,0)}static getBarycoord(t,e,n,r,s){Je.subVectors(r,e),En.subVectors(n,e),Ms.subVectors(t,e);const o=Je.dot(Je),a=Je.dot(En),l=Je.dot(Ms),c=En.dot(En),h=En.dot(Ms),d=o*c-a*a;if(d===0)return s.set(0,0,0),null;const f=1/d,m=(c*l-a*h)*f,g=(o*h-a*l)*f;return s.set(1-m-g,g,m)}static containsPoint(t,e,n,r){return this.getBarycoord(t,e,n,r,yn)===null?!1:yn.x>=0&&yn.y>=0&&yn.x+yn.y<=1}static getInterpolation(t,e,n,r,s,o,a,l){return this.getBarycoord(t,e,n,r,yn)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,yn.x),l.addScaledVector(o,yn.y),l.addScaledVector(a,yn.z),l)}static getInterpolatedAttribute(t,e,n,r,s,o){return bs.setScalar(0),Ts.setScalar(0),As.setScalar(0),bs.fromBufferAttribute(t,e),Ts.fromBufferAttribute(t,n),As.fromBufferAttribute(t,r),o.setScalar(0),o.addScaledVector(bs,s.x),o.addScaledVector(Ts,s.y),o.addScaledVector(As,s.z),o}static isFrontFacing(t,e,n,r){return Je.subVectors(n,e),En.subVectors(t,e),Je.cross(En).dot(r)<0}set(t,e,n){return this.a.copy(t),this.b.copy(e),this.c.copy(n),this}setFromPointsAndIndices(t,e,n,r){return this.a.copy(t[e]),this.b.copy(t[n]),this.c.copy(t[r]),this}setFromAttributeAndIndices(t,e,n,r){return this.a.fromBufferAttribute(t,e),this.b.fromBufferAttribute(t,n),this.c.fromBufferAttribute(t,r),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return Je.subVectors(this.c,this.b),En.subVectors(this.a,this.b),Je.cross(En).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return Ye.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,e){return Ye.getBarycoord(t,this.a,this.b,this.c,e)}getInterpolation(t,e,n,r,s){return Ye.getInterpolation(t,this.a,this.b,this.c,e,n,r,s)}containsPoint(t){return Ye.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return Ye.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,e){const n=this.a,r=this.b,s=this.c;let o,a;Ai.subVectors(r,n),wi.subVectors(s,n),Ss.subVectors(t,n);const l=Ai.dot(Ss),c=wi.dot(Ss);if(l<=0&&c<=0)return e.copy(n);Es.subVectors(t,r);const h=Ai.dot(Es),d=wi.dot(Es);if(h>=0&&d<=h)return e.copy(r);const f=l*d-h*c;if(f<=0&&l>=0&&h<=0)return o=l/(l-h),e.copy(n).addScaledVector(Ai,o);ys.subVectors(t,s);const m=Ai.dot(ys),g=wi.dot(ys);if(g>=0&&m<=g)return e.copy(s);const x=m*c-l*g;if(x<=0&&c>=0&&g<=0)return a=c/(c-g),e.copy(n).addScaledVector(wi,a);const p=h*g-m*d;if(p<=0&&d-h>=0&&m-g>=0)return Ro.subVectors(s,r),a=(d-h)/(d-h+(m-g)),e.copy(r).addScaledVector(Ro,a);const u=1/(p+x+f);return o=x*u,a=f*u,e.copy(n).addScaledVector(Ai,o).addScaledVector(wi,a)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}}const Bl={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},In={h:0,s:0,l:0},Ar={h:0,s:0,l:0};function ws(i,t,e){return e<0&&(e+=1),e>1&&(e-=1),e<1/6?i+(t-i)*6*e:e<1/2?t:e<2/3?i+(t-i)*6*(2/3-e):i}class Vt{constructor(t,e,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(t,e,n)}set(t,e,n){if(e===void 0&&n===void 0){const r=t;r&&r.isColor?this.copy(r):typeof r=="number"?this.setHex(r):typeof r=="string"&&this.setStyle(r)}else this.setRGB(t,e,n);return this}setScalar(t){return this.r=t,this.g=t,this.b=t,this}setHex(t,e=Le){return t=Math.floor(t),this.r=(t>>16&255)/255,this.g=(t>>8&255)/255,this.b=(t&255)/255,Yt.colorSpaceToWorking(this,e),this}setRGB(t,e,n,r=Yt.workingColorSpace){return this.r=t,this.g=e,this.b=n,Yt.colorSpaceToWorking(this,r),this}setHSL(t,e,n,r=Yt.workingColorSpace){if(t=ru(t,1),e=Wt(e,0,1),n=Wt(n,0,1),e===0)this.r=this.g=this.b=n;else{const s=n<=.5?n*(1+e):n+e-n*e,o=2*n-s;this.r=ws(o,s,t+1/3),this.g=ws(o,s,t),this.b=ws(o,s,t-1/3)}return Yt.colorSpaceToWorking(this,r),this}setStyle(t,e=Le){function n(s){s!==void 0&&parseFloat(s)<1&&console.warn("THREE.Color: Alpha component of "+t+" will be ignored.")}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(t)){let s;const o=r[1],a=r[2];switch(o){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,e);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,e);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,e);break;default:console.warn("THREE.Color: Unknown color model "+t)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(t)){const s=r[1],o=s.length;if(o===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,e);if(o===6)return this.setHex(parseInt(s,16),e);console.warn("THREE.Color: Invalid hex color "+t)}else if(t&&t.length>0)return this.setColorName(t,e);return this}setColorName(t,e=Le){const n=Bl[t.toLowerCase()];return n!==void 0?this.setHex(n,e):console.warn("THREE.Color: Unknown color "+t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(t){return this.r=t.r,this.g=t.g,this.b=t.b,this}copySRGBToLinear(t){return this.r=wn(t.r),this.g=wn(t.g),this.b=wn(t.b),this}copyLinearToSRGB(t){return this.r=zi(t.r),this.g=zi(t.g),this.b=zi(t.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(t=Le){return Yt.workingToColorSpace(Ee.copy(this),t),Math.round(Wt(Ee.r*255,0,255))*65536+Math.round(Wt(Ee.g*255,0,255))*256+Math.round(Wt(Ee.b*255,0,255))}getHexString(t=Le){return("000000"+this.getHex(t).toString(16)).slice(-6)}getHSL(t,e=Yt.workingColorSpace){Yt.workingToColorSpace(Ee.copy(this),e);const n=Ee.r,r=Ee.g,s=Ee.b,o=Math.max(n,r,s),a=Math.min(n,r,s);let l,c;const h=(a+o)/2;if(a===o)l=0,c=0;else{const d=o-a;switch(c=h<=.5?d/(o+a):d/(2-o-a),o){case n:l=(r-s)/d+(r<s?6:0);break;case r:l=(s-n)/d+2;break;case s:l=(n-r)/d+4;break}l/=6}return t.h=l,t.s=c,t.l=h,t}getRGB(t,e=Yt.workingColorSpace){return Yt.workingToColorSpace(Ee.copy(this),e),t.r=Ee.r,t.g=Ee.g,t.b=Ee.b,t}getStyle(t=Le){Yt.workingToColorSpace(Ee.copy(this),t);const e=Ee.r,n=Ee.g,r=Ee.b;return t!==Le?`color(${t} ${e.toFixed(3)} ${n.toFixed(3)} ${r.toFixed(3)})`:`rgb(${Math.round(e*255)},${Math.round(n*255)},${Math.round(r*255)})`}offsetHSL(t,e,n){return this.getHSL(In),this.setHSL(In.h+t,In.s+e,In.l+n)}add(t){return this.r+=t.r,this.g+=t.g,this.b+=t.b,this}addColors(t,e){return this.r=t.r+e.r,this.g=t.g+e.g,this.b=t.b+e.b,this}addScalar(t){return this.r+=t,this.g+=t,this.b+=t,this}sub(t){return this.r=Math.max(0,this.r-t.r),this.g=Math.max(0,this.g-t.g),this.b=Math.max(0,this.b-t.b),this}multiply(t){return this.r*=t.r,this.g*=t.g,this.b*=t.b,this}multiplyScalar(t){return this.r*=t,this.g*=t,this.b*=t,this}lerp(t,e){return this.r+=(t.r-this.r)*e,this.g+=(t.g-this.g)*e,this.b+=(t.b-this.b)*e,this}lerpColors(t,e,n){return this.r=t.r+(e.r-t.r)*n,this.g=t.g+(e.g-t.g)*n,this.b=t.b+(e.b-t.b)*n,this}lerpHSL(t,e){this.getHSL(In),t.getHSL(Ar);const n=cs(In.h,Ar.h,e),r=cs(In.s,Ar.s,e),s=cs(In.l,Ar.l,e);return this.setHSL(n,r,s),this}setFromVector3(t){return this.r=t.x,this.g=t.y,this.b=t.z,this}applyMatrix3(t){const e=this.r,n=this.g,r=this.b,s=t.elements;return this.r=s[0]*e+s[3]*n+s[6]*r,this.g=s[1]*e+s[4]*n+s[7]*r,this.b=s[2]*e+s[5]*n+s[8]*r,this}equals(t){return t.r===this.r&&t.g===this.g&&t.b===this.b}fromArray(t,e=0){return this.r=t[e],this.g=t[e+1],this.b=t[e+2],this}toArray(t=[],e=0){return t[e]=this.r,t[e+1]=this.g,t[e+2]=this.b,t}fromBufferAttribute(t,e){return this.r=t.getX(e),this.g=t.getY(e),this.b=t.getZ(e),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const Ee=new Vt;Vt.NAMES=Bl;let Mu=0;class qi extends Xi{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Mu++}),this.uuid=Vn(),this.name="",this.type="Material",this.blending=Bi,this.side=Xn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Gs,this.blendDst=Ws,this.blendEquation=si,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Vt(0,0,0),this.blendAlpha=0,this.depthFunc=Hi,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=mo,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=vi,this.stencilZFail=vi,this.stencilZPass=vi,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(t){this._alphaTest>0!=t>0&&this.version++,this._alphaTest=t}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(t){if(t!==void 0)for(const e in t){const n=t[e];if(n===void 0){console.warn(`THREE.Material: parameter '${e}' has value of undefined.`);continue}const r=this[e];if(r===void 0){console.warn(`THREE.Material: '${e}' is not a property of THREE.${this.type}.`);continue}r&&r.isColor?r.set(n):r&&r.isVector3&&n&&n.isVector3?r.copy(n):this[e]=n}}toJSON(t){const e=t===void 0||typeof t=="string";e&&(t={textures:{},images:{}});const n={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(t).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(t).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(t).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(t).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(t).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(t).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(t).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(t).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(t).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(t).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(t).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(t).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(t).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(t).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(t).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(t).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(t).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(t).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(t).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(t).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(t).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(t).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(t).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(t).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(t).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(t).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==Bi&&(n.blending=this.blending),this.side!==Xn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==Gs&&(n.blendSrc=this.blendSrc),this.blendDst!==Ws&&(n.blendDst=this.blendDst),this.blendEquation!==si&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==Hi&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==mo&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==vi&&(n.stencilFail=this.stencilFail),this.stencilZFail!==vi&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==vi&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function r(s){const o=[];for(const a in s){const l=s[a];delete l.metadata,o.push(l)}return o}if(e){const s=r(t.textures),o=r(t.images);s.length>0&&(n.textures=s),o.length>0&&(n.images=o)}return n}clone(){return new this.constructor().copy(this)}copy(t){this.name=t.name,this.blending=t.blending,this.side=t.side,this.vertexColors=t.vertexColors,this.opacity=t.opacity,this.transparent=t.transparent,this.blendSrc=t.blendSrc,this.blendDst=t.blendDst,this.blendEquation=t.blendEquation,this.blendSrcAlpha=t.blendSrcAlpha,this.blendDstAlpha=t.blendDstAlpha,this.blendEquationAlpha=t.blendEquationAlpha,this.blendColor.copy(t.blendColor),this.blendAlpha=t.blendAlpha,this.depthFunc=t.depthFunc,this.depthTest=t.depthTest,this.depthWrite=t.depthWrite,this.stencilWriteMask=t.stencilWriteMask,this.stencilFunc=t.stencilFunc,this.stencilRef=t.stencilRef,this.stencilFuncMask=t.stencilFuncMask,this.stencilFail=t.stencilFail,this.stencilZFail=t.stencilZFail,this.stencilZPass=t.stencilZPass,this.stencilWrite=t.stencilWrite;const e=t.clippingPlanes;let n=null;if(e!==null){const r=e.length;n=new Array(r);for(let s=0;s!==r;++s)n[s]=e[s].clone()}return this.clippingPlanes=n,this.clipIntersection=t.clipIntersection,this.clipShadows=t.clipShadows,this.shadowSide=t.shadowSide,this.colorWrite=t.colorWrite,this.precision=t.precision,this.polygonOffset=t.polygonOffset,this.polygonOffsetFactor=t.polygonOffsetFactor,this.polygonOffsetUnits=t.polygonOffsetUnits,this.dithering=t.dithering,this.alphaTest=t.alphaTest,this.alphaHash=t.alphaHash,this.alphaToCoverage=t.alphaToCoverage,this.premultipliedAlpha=t.premultipliedAlpha,this.forceSinglePass=t.forceSinglePass,this.visible=t.visible,this.toneMapped=t.toneMapped,this.userData=JSON.parse(JSON.stringify(t.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(t){t===!0&&this.version++}}class Qr extends qi{constructor(t){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Vt(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new gn,this.combine=El,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}}const pe=new F,wr=new Ot;let Su=0;class Ke{constructor(t,e,n=!1){if(Array.isArray(t))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:Su++}),this.name="",this.array=t,this.itemSize=e,this.count=t!==void 0?t.length/e:0,this.normalized=n,this.usage=Ca,this.updateRanges=[],this.gpuType=fn,this.version=0}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.name=t.name,this.array=new t.array.constructor(t.array),this.itemSize=t.itemSize,this.count=t.count,this.normalized=t.normalized,this.usage=t.usage,this.gpuType=t.gpuType,this}copyAt(t,e,n){t*=this.itemSize,n*=e.itemSize;for(let r=0,s=this.itemSize;r<s;r++)this.array[t+r]=e.array[n+r];return this}copyArray(t){return this.array.set(t),this}applyMatrix3(t){if(this.itemSize===2)for(let e=0,n=this.count;e<n;e++)wr.fromBufferAttribute(this,e),wr.applyMatrix3(t),this.setXY(e,wr.x,wr.y);else if(this.itemSize===3)for(let e=0,n=this.count;e<n;e++)pe.fromBufferAttribute(this,e),pe.applyMatrix3(t),this.setXYZ(e,pe.x,pe.y,pe.z);return this}applyMatrix4(t){for(let e=0,n=this.count;e<n;e++)pe.fromBufferAttribute(this,e),pe.applyMatrix4(t),this.setXYZ(e,pe.x,pe.y,pe.z);return this}applyNormalMatrix(t){for(let e=0,n=this.count;e<n;e++)pe.fromBufferAttribute(this,e),pe.applyNormalMatrix(t),this.setXYZ(e,pe.x,pe.y,pe.z);return this}transformDirection(t){for(let e=0,n=this.count;e<n;e++)pe.fromBufferAttribute(this,e),pe.transformDirection(t),this.setXYZ(e,pe.x,pe.y,pe.z);return this}set(t,e=0){return this.array.set(t,e),this}getComponent(t,e){let n=this.array[t*this.itemSize+e];return this.normalized&&(n=hn(n,this.array)),n}setComponent(t,e,n){return this.normalized&&(n=Jt(n,this.array)),this.array[t*this.itemSize+e]=n,this}getX(t){let e=this.array[t*this.itemSize];return this.normalized&&(e=hn(e,this.array)),e}setX(t,e){return this.normalized&&(e=Jt(e,this.array)),this.array[t*this.itemSize]=e,this}getY(t){let e=this.array[t*this.itemSize+1];return this.normalized&&(e=hn(e,this.array)),e}setY(t,e){return this.normalized&&(e=Jt(e,this.array)),this.array[t*this.itemSize+1]=e,this}getZ(t){let e=this.array[t*this.itemSize+2];return this.normalized&&(e=hn(e,this.array)),e}setZ(t,e){return this.normalized&&(e=Jt(e,this.array)),this.array[t*this.itemSize+2]=e,this}getW(t){let e=this.array[t*this.itemSize+3];return this.normalized&&(e=hn(e,this.array)),e}setW(t,e){return this.normalized&&(e=Jt(e,this.array)),this.array[t*this.itemSize+3]=e,this}setXY(t,e,n){return t*=this.itemSize,this.normalized&&(e=Jt(e,this.array),n=Jt(n,this.array)),this.array[t+0]=e,this.array[t+1]=n,this}setXYZ(t,e,n,r){return t*=this.itemSize,this.normalized&&(e=Jt(e,this.array),n=Jt(n,this.array),r=Jt(r,this.array)),this.array[t+0]=e,this.array[t+1]=n,this.array[t+2]=r,this}setXYZW(t,e,n,r,s){return t*=this.itemSize,this.normalized&&(e=Jt(e,this.array),n=Jt(n,this.array),r=Jt(r,this.array),s=Jt(s,this.array)),this.array[t+0]=e,this.array[t+1]=n,this.array[t+2]=r,this.array[t+3]=s,this}onUpload(t){return this.onUploadCallback=t,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const t={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(t.name=this.name),this.usage!==Ca&&(t.usage=this.usage),t}}class zl extends Ke{constructor(t,e,n){super(new Uint16Array(t),e,n)}}class Hl extends Ke{constructor(t,e,n){super(new Uint32Array(t),e,n)}}class Ae extends Ke{constructor(t,e,n){super(new Float32Array(t),e,n)}}let Eu=0;const We=new te,Rs=new fe,Ri=new F,ke=new pi,Ji=new pi,xe=new F;class rn extends Xi{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Eu++}),this.uuid=Vn(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new(Nl(t)?Hl:zl)(t,1):this.index=t,this}setIndirect(t){return this.indirect=t,this}getIndirect(){return this.indirect}getAttribute(t){return this.attributes[t]}setAttribute(t,e){return this.attributes[t]=e,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,e,n=0){this.groups.push({start:t,count:e,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(t,e){this.drawRange.start=t,this.drawRange.count=e}applyMatrix4(t){const e=this.attributes.position;e!==void 0&&(e.applyMatrix4(t),e.needsUpdate=!0);const n=this.attributes.normal;if(n!==void 0){const s=new Ft().getNormalMatrix(t);n.applyNormalMatrix(s),n.needsUpdate=!0}const r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(t),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(t){return We.makeRotationFromQuaternion(t),this.applyMatrix4(We),this}rotateX(t){return We.makeRotationX(t),this.applyMatrix4(We),this}rotateY(t){return We.makeRotationY(t),this.applyMatrix4(We),this}rotateZ(t){return We.makeRotationZ(t),this.applyMatrix4(We),this}translate(t,e,n){return We.makeTranslation(t,e,n),this.applyMatrix4(We),this}scale(t,e,n){return We.makeScale(t,e,n),this.applyMatrix4(We),this}lookAt(t){return Rs.lookAt(t),Rs.updateMatrix(),this.applyMatrix4(Rs.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Ri).negate(),this.translate(Ri.x,Ri.y,Ri.z),this}setFromPoints(t){const e=this.getAttribute("position");if(e===void 0){const n=[];for(let r=0,s=t.length;r<s;r++){const o=t[r];n.push(o.x,o.y,o.z||0)}this.setAttribute("position",new Ae(n,3))}else{const n=Math.min(t.length,e.count);for(let r=0;r<n;r++){const s=t[r];e.setXYZ(r,s.x,s.y,s.z||0)}t.length>e.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),e.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new pi);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new F(-1/0,-1/0,-1/0),new F(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),e)for(let n=0,r=e.length;n<r;n++){const s=e[n];ke.setFromBufferAttribute(s),this.morphTargetsRelative?(xe.addVectors(this.boundingBox.min,ke.min),this.boundingBox.expandByPoint(xe),xe.addVectors(this.boundingBox.max,ke.max),this.boundingBox.expandByPoint(xe)):(this.boundingBox.expandByPoint(ke.min),this.boundingBox.expandByPoint(ke.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new pr);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new F,1/0);return}if(t){const n=this.boundingSphere.center;if(ke.setFromBufferAttribute(t),e)for(let s=0,o=e.length;s<o;s++){const a=e[s];Ji.setFromBufferAttribute(a),this.morphTargetsRelative?(xe.addVectors(ke.min,Ji.min),ke.expandByPoint(xe),xe.addVectors(ke.max,Ji.max),ke.expandByPoint(xe)):(ke.expandByPoint(Ji.min),ke.expandByPoint(Ji.max))}ke.getCenter(n);let r=0;for(let s=0,o=t.count;s<o;s++)xe.fromBufferAttribute(t,s),r=Math.max(r,n.distanceToSquared(xe));if(e)for(let s=0,o=e.length;s<o;s++){const a=e[s],l=this.morphTargetsRelative;for(let c=0,h=a.count;c<h;c++)xe.fromBufferAttribute(a,c),l&&(Ri.fromBufferAttribute(t,c),xe.add(Ri)),r=Math.max(r,n.distanceToSquared(xe))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const t=this.index,e=this.attributes;if(t===null||e.position===void 0||e.normal===void 0||e.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const n=e.position,r=e.normal,s=e.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Ke(new Float32Array(4*n.count),4));const o=this.getAttribute("tangent"),a=[],l=[];for(let U=0;U<n.count;U++)a[U]=new F,l[U]=new F;const c=new F,h=new F,d=new F,f=new Ot,m=new Ot,g=new Ot,x=new F,p=new F;function u(U,S,M){c.fromBufferAttribute(n,U),h.fromBufferAttribute(n,S),d.fromBufferAttribute(n,M),f.fromBufferAttribute(s,U),m.fromBufferAttribute(s,S),g.fromBufferAttribute(s,M),h.sub(c),d.sub(c),m.sub(f),g.sub(f);const P=1/(m.x*g.y-g.x*m.y);isFinite(P)&&(x.copy(h).multiplyScalar(g.y).addScaledVector(d,-m.y).multiplyScalar(P),p.copy(d).multiplyScalar(m.x).addScaledVector(h,-g.x).multiplyScalar(P),a[U].add(x),a[S].add(x),a[M].add(x),l[U].add(p),l[S].add(p),l[M].add(p))}let b=this.groups;b.length===0&&(b=[{start:0,count:t.count}]);for(let U=0,S=b.length;U<S;++U){const M=b[U],P=M.start,O=M.count;for(let k=P,Y=P+O;k<Y;k+=3)u(t.getX(k+0),t.getX(k+1),t.getX(k+2))}const T=new F,E=new F,C=new F,w=new F;function R(U){C.fromBufferAttribute(r,U),w.copy(C);const S=a[U];T.copy(S),T.sub(C.multiplyScalar(C.dot(S))).normalize(),E.crossVectors(w,S);const P=E.dot(l[U])<0?-1:1;o.setXYZW(U,T.x,T.y,T.z,P)}for(let U=0,S=b.length;U<S;++U){const M=b[U],P=M.start,O=M.count;for(let k=P,Y=P+O;k<Y;k+=3)R(t.getX(k+0)),R(t.getX(k+1)),R(t.getX(k+2))}}computeVertexNormals(){const t=this.index,e=this.getAttribute("position");if(e!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new Ke(new Float32Array(e.count*3),3),this.setAttribute("normal",n);else for(let f=0,m=n.count;f<m;f++)n.setXYZ(f,0,0,0);const r=new F,s=new F,o=new F,a=new F,l=new F,c=new F,h=new F,d=new F;if(t)for(let f=0,m=t.count;f<m;f+=3){const g=t.getX(f+0),x=t.getX(f+1),p=t.getX(f+2);r.fromBufferAttribute(e,g),s.fromBufferAttribute(e,x),o.fromBufferAttribute(e,p),h.subVectors(o,s),d.subVectors(r,s),h.cross(d),a.fromBufferAttribute(n,g),l.fromBufferAttribute(n,x),c.fromBufferAttribute(n,p),a.add(h),l.add(h),c.add(h),n.setXYZ(g,a.x,a.y,a.z),n.setXYZ(x,l.x,l.y,l.z),n.setXYZ(p,c.x,c.y,c.z)}else for(let f=0,m=e.count;f<m;f+=3)r.fromBufferAttribute(e,f+0),s.fromBufferAttribute(e,f+1),o.fromBufferAttribute(e,f+2),h.subVectors(o,s),d.subVectors(r,s),h.cross(d),n.setXYZ(f+0,h.x,h.y,h.z),n.setXYZ(f+1,h.x,h.y,h.z),n.setXYZ(f+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){const t=this.attributes.normal;for(let e=0,n=t.count;e<n;e++)xe.fromBufferAttribute(t,e),xe.normalize(),t.setXYZ(e,xe.x,xe.y,xe.z)}toNonIndexed(){function t(a,l){const c=a.array,h=a.itemSize,d=a.normalized,f=new c.constructor(l.length*h);let m=0,g=0;for(let x=0,p=l.length;x<p;x++){a.isInterleavedBufferAttribute?m=l[x]*a.data.stride+a.offset:m=l[x]*h;for(let u=0;u<h;u++)f[g++]=c[m++]}return new Ke(f,h,d)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const e=new rn,n=this.index.array,r=this.attributes;for(const a in r){const l=r[a],c=t(l,n);e.setAttribute(a,c)}const s=this.morphAttributes;for(const a in s){const l=[],c=s[a];for(let h=0,d=c.length;h<d;h++){const f=c[h],m=t(f,n);l.push(m)}e.morphAttributes[a]=l}e.morphTargetsRelative=this.morphTargetsRelative;const o=this.groups;for(let a=0,l=o.length;a<l;a++){const c=o[a];e.addGroup(c.start,c.count,c.materialIndex)}return e}toJSON(){const t={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.type,this.name!==""&&(t.name=this.name),Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0){const l=this.parameters;for(const c in l)l[c]!==void 0&&(t[c]=l[c]);return t}t.data={attributes:{}};const e=this.index;e!==null&&(t.data.index={type:e.array.constructor.name,array:Array.prototype.slice.call(e.array)});const n=this.attributes;for(const l in n){const c=n[l];t.data.attributes[l]=c.toJSON(t.data)}const r={};let s=!1;for(const l in this.morphAttributes){const c=this.morphAttributes[l],h=[];for(let d=0,f=c.length;d<f;d++){const m=c[d];h.push(m.toJSON(t.data))}h.length>0&&(r[l]=h,s=!0)}s&&(t.data.morphAttributes=r,t.data.morphTargetsRelative=this.morphTargetsRelative);const o=this.groups;o.length>0&&(t.data.groups=JSON.parse(JSON.stringify(o)));const a=this.boundingSphere;return a!==null&&(t.data.boundingSphere=a.toJSON()),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const e={};this.name=t.name;const n=t.index;n!==null&&this.setIndex(n.clone());const r=t.attributes;for(const c in r){const h=r[c];this.setAttribute(c,h.clone(e))}const s=t.morphAttributes;for(const c in s){const h=[],d=s[c];for(let f=0,m=d.length;f<m;f++)h.push(d[f].clone(e));this.morphAttributes[c]=h}this.morphTargetsRelative=t.morphTargetsRelative;const o=t.groups;for(let c=0,h=o.length;c<h;c++){const d=o[c];this.addGroup(d.start,d.count,d.materialIndex)}const a=t.boundingBox;a!==null&&(this.boundingBox=a.clone());const l=t.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const Co=new te,Jn=new Ol,Rr=new pr,Po=new F,Cr=new F,Pr=new F,Dr=new F,Cs=new F,Lr=new F,Do=new F,Ir=new F;class Ie extends fe{constructor(t=new rn,e=new Qr){super(),this.isMesh=!0,this.type="Mesh",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),t.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=t.morphTargetInfluences.slice()),t.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}updateMorphTargets(){const e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){const r=e[n[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=r.length;s<o;s++){const a=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}getVertexPosition(t,e){const n=this.geometry,r=n.attributes.position,s=n.morphAttributes.position,o=n.morphTargetsRelative;e.fromBufferAttribute(r,t);const a=this.morphTargetInfluences;if(s&&a){Lr.set(0,0,0);for(let l=0,c=s.length;l<c;l++){const h=a[l],d=s[l];h!==0&&(Cs.fromBufferAttribute(d,t),o?Lr.addScaledVector(Cs,h):Lr.addScaledVector(Cs.sub(e),h))}e.add(Lr)}return e}raycast(t,e){const n=this.geometry,r=this.material,s=this.matrixWorld;r!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),Rr.copy(n.boundingSphere),Rr.applyMatrix4(s),Jn.copy(t.ray).recast(t.near),!(Rr.containsPoint(Jn.origin)===!1&&(Jn.intersectSphere(Rr,Po)===null||Jn.origin.distanceToSquared(Po)>(t.far-t.near)**2))&&(Co.copy(s).invert(),Jn.copy(t.ray).applyMatrix4(Co),!(n.boundingBox!==null&&Jn.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(t,e,Jn)))}_computeIntersections(t,e,n){let r;const s=this.geometry,o=this.material,a=s.index,l=s.attributes.position,c=s.attributes.uv,h=s.attributes.uv1,d=s.attributes.normal,f=s.groups,m=s.drawRange;if(a!==null)if(Array.isArray(o))for(let g=0,x=f.length;g<x;g++){const p=f[g],u=o[p.materialIndex],b=Math.max(p.start,m.start),T=Math.min(a.count,Math.min(p.start+p.count,m.start+m.count));for(let E=b,C=T;E<C;E+=3){const w=a.getX(E),R=a.getX(E+1),U=a.getX(E+2);r=Ur(this,u,t,n,c,h,d,w,R,U),r&&(r.faceIndex=Math.floor(E/3),r.face.materialIndex=p.materialIndex,e.push(r))}}else{const g=Math.max(0,m.start),x=Math.min(a.count,m.start+m.count);for(let p=g,u=x;p<u;p+=3){const b=a.getX(p),T=a.getX(p+1),E=a.getX(p+2);r=Ur(this,o,t,n,c,h,d,b,T,E),r&&(r.faceIndex=Math.floor(p/3),e.push(r))}}else if(l!==void 0)if(Array.isArray(o))for(let g=0,x=f.length;g<x;g++){const p=f[g],u=o[p.materialIndex],b=Math.max(p.start,m.start),T=Math.min(l.count,Math.min(p.start+p.count,m.start+m.count));for(let E=b,C=T;E<C;E+=3){const w=E,R=E+1,U=E+2;r=Ur(this,u,t,n,c,h,d,w,R,U),r&&(r.faceIndex=Math.floor(E/3),r.face.materialIndex=p.materialIndex,e.push(r))}}else{const g=Math.max(0,m.start),x=Math.min(l.count,m.start+m.count);for(let p=g,u=x;p<u;p+=3){const b=p,T=p+1,E=p+2;r=Ur(this,o,t,n,c,h,d,b,T,E),r&&(r.faceIndex=Math.floor(p/3),e.push(r))}}}}function yu(i,t,e,n,r,s,o,a){let l;if(t.side===Oe?l=n.intersectTriangle(o,s,r,!0,a):l=n.intersectTriangle(r,s,o,t.side===Xn,a),l===null)return null;Ir.copy(a),Ir.applyMatrix4(i.matrixWorld);const c=e.ray.origin.distanceTo(Ir);return c<e.near||c>e.far?null:{distance:c,point:Ir.clone(),object:i}}function Ur(i,t,e,n,r,s,o,a,l,c){i.getVertexPosition(a,Cr),i.getVertexPosition(l,Pr),i.getVertexPosition(c,Dr);const h=yu(i,t,e,n,Cr,Pr,Dr,Do);if(h){const d=new F;Ye.getBarycoord(Do,Cr,Pr,Dr,d),r&&(h.uv=Ye.getInterpolatedAttribute(r,a,l,c,d,new Ot)),s&&(h.uv1=Ye.getInterpolatedAttribute(s,a,l,c,d,new Ot)),o&&(h.normal=Ye.getInterpolatedAttribute(o,a,l,c,d,new F),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));const f={a,b:l,c,normal:new F,materialIndex:0};Ye.getNormal(Cr,Pr,Dr,f.normal),h.face=f,h.barycoord=d}return h}class mi extends rn{constructor(t=1,e=1,n=1,r=1,s=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:t,height:e,depth:n,widthSegments:r,heightSegments:s,depthSegments:o};const a=this;r=Math.floor(r),s=Math.floor(s),o=Math.floor(o);const l=[],c=[],h=[],d=[];let f=0,m=0;g("z","y","x",-1,-1,n,e,t,o,s,0),g("z","y","x",1,-1,n,e,-t,o,s,1),g("x","z","y",1,1,t,n,e,r,o,2),g("x","z","y",1,-1,t,n,-e,r,o,3),g("x","y","z",1,-1,t,e,n,r,s,4),g("x","y","z",-1,-1,t,e,-n,r,s,5),this.setIndex(l),this.setAttribute("position",new Ae(c,3)),this.setAttribute("normal",new Ae(h,3)),this.setAttribute("uv",new Ae(d,2));function g(x,p,u,b,T,E,C,w,R,U,S){const M=E/R,P=C/U,O=E/2,k=C/2,Y=w/2,X=R+1,q=U+1;let Z=0,V=0;const at=new F;for(let ut=0;ut<q;ut++){const yt=ut*P-k;for(let Ht=0;Ht<X;Ht++){const ee=Ht*M-O;at[x]=ee*b,at[p]=yt*T,at[u]=Y,c.push(at.x,at.y,at.z),at[x]=0,at[p]=0,at[u]=w>0?1:-1,h.push(at.x,at.y,at.z),d.push(Ht/R),d.push(1-ut/U),Z+=1}}for(let ut=0;ut<U;ut++)for(let yt=0;yt<R;yt++){const Ht=f+yt+X*ut,ee=f+yt+X*(ut+1),re=f+(yt+1)+X*(ut+1),$t=f+(yt+1)+X*ut;l.push(Ht,ee,$t),l.push(ee,re,$t),V+=6}a.addGroup(m,V,S),m+=V,f+=Z}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new mi(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}}function Wi(i){const t={};for(const e in i){t[e]={};for(const n in i[e]){const r=i[e][n];r&&(r.isColor||r.isMatrix3||r.isMatrix4||r.isVector2||r.isVector3||r.isVector4||r.isTexture||r.isQuaternion)?r.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[e][n]=null):t[e][n]=r.clone():Array.isArray(r)?t[e][n]=r.slice():t[e][n]=r}}return t}function Pe(i){const t={};for(let e=0;e<i.length;e++){const n=Wi(i[e]);for(const r in n)t[r]=n[r]}return t}function bu(i){const t=[];for(let e=0;e<i.length;e++)t.push(i[e].clone());return t}function kl(i){const t=i.getRenderTarget();return t===null?i.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:Yt.workingColorSpace}const Tu={clone:Wi,merge:Pe};var Au=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,wu=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class qn extends qi{constructor(t){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Au,this.fragmentShader=wu,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,t!==void 0&&this.setValues(t)}copy(t){return super.copy(t),this.fragmentShader=t.fragmentShader,this.vertexShader=t.vertexShader,this.uniforms=Wi(t.uniforms),this.uniformsGroups=bu(t.uniformsGroups),this.defines=Object.assign({},t.defines),this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.fog=t.fog,this.lights=t.lights,this.clipping=t.clipping,this.extensions=Object.assign({},t.extensions),this.glslVersion=t.glslVersion,this}toJSON(t){const e=super.toJSON(t);e.glslVersion=this.glslVersion,e.uniforms={};for(const r in this.uniforms){const o=this.uniforms[r].value;o&&o.isTexture?e.uniforms[r]={type:"t",value:o.toJSON(t).uuid}:o&&o.isColor?e.uniforms[r]={type:"c",value:o.getHex()}:o&&o.isVector2?e.uniforms[r]={type:"v2",value:o.toArray()}:o&&o.isVector3?e.uniforms[r]={type:"v3",value:o.toArray()}:o&&o.isVector4?e.uniforms[r]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?e.uniforms[r]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?e.uniforms[r]={type:"m4",value:o.toArray()}:e.uniforms[r]={value:o}}Object.keys(this.defines).length>0&&(e.defines=this.defines),e.vertexShader=this.vertexShader,e.fragmentShader=this.fragmentShader,e.lights=this.lights,e.clipping=this.clipping;const n={};for(const r in this.extensions)this.extensions[r]===!0&&(n[r]=!0);return Object.keys(n).length>0&&(e.extensions=n),e}}class Vl extends fe{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new te,this.projectionMatrix=new te,this.projectionMatrixInverse=new te,this.coordinateSystem=pn,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(t,e){return super.copy(t,e),this.matrixWorldInverse.copy(t.matrixWorldInverse),this.projectionMatrix.copy(t.projectionMatrix),this.projectionMatrixInverse.copy(t.projectionMatrixInverse),this.coordinateSystem=t.coordinateSystem,this}getWorldDirection(t){return super.getWorldDirection(t).negate()}updateMatrixWorld(t){super.updateMatrixWorld(t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(t,e){super.updateWorldMatrix(t,e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}}const Un=new F,Lo=new Ot,Io=new Ot;class Qe extends Vl{constructor(t=50,e=1,n=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=t,this.zoom=1,this.near=n,this.far=r,this.focus=10,this.aspect=e,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.fov=t.fov,this.zoom=t.zoom,this.near=t.near,this.far=t.far,this.focus=t.focus,this.aspect=t.aspect,this.view=t.view===null?null:Object.assign({},t.view),this.filmGauge=t.filmGauge,this.filmOffset=t.filmOffset,this}setFocalLength(t){const e=.5*this.getFilmHeight()/t;this.fov=Pa*2*Math.atan(e),this.updateProjectionMatrix()}getFocalLength(){const t=Math.tan(ls*.5*this.fov);return .5*this.getFilmHeight()/t}getEffectiveFOV(){return Pa*2*Math.atan(Math.tan(ls*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(t,e,n){Un.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),e.set(Un.x,Un.y).multiplyScalar(-t/Un.z),Un.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Un.x,Un.y).multiplyScalar(-t/Un.z)}getViewSize(t,e){return this.getViewBounds(t,Lo,Io),e.subVectors(Io,Lo)}setViewOffset(t,e,n,r,s,o){this.aspect=t/e,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=n,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=this.near;let e=t*Math.tan(ls*.5*this.fov)/this.zoom,n=2*e,r=this.aspect*n,s=-.5*r;const o=this.view;if(this.view!==null&&this.view.enabled){const l=o.fullWidth,c=o.fullHeight;s+=o.offsetX*r/l,e-=o.offsetY*n/c,r*=o.width/l,n*=o.height/c}const a=this.filmOffset;a!==0&&(s+=t*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+r,e,e-n,t,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.fov=this.fov,e.object.zoom=this.zoom,e.object.near=this.near,e.object.far=this.far,e.object.focus=this.focus,e.object.aspect=this.aspect,this.view!==null&&(e.object.view=Object.assign({},this.view)),e.object.filmGauge=this.filmGauge,e.object.filmOffset=this.filmOffset,e}}const Ci=-90,Pi=1;class Ru extends fe{constructor(t,e,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;const r=new Qe(Ci,Pi,t,e);r.layers=this.layers,this.add(r);const s=new Qe(Ci,Pi,t,e);s.layers=this.layers,this.add(s);const o=new Qe(Ci,Pi,t,e);o.layers=this.layers,this.add(o);const a=new Qe(Ci,Pi,t,e);a.layers=this.layers,this.add(a);const l=new Qe(Ci,Pi,t,e);l.layers=this.layers,this.add(l);const c=new Qe(Ci,Pi,t,e);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){const t=this.coordinateSystem,e=this.children.concat(),[n,r,s,o,a,l]=e;for(const c of e)this.remove(c);if(t===pn)n.up.set(0,1,0),n.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(t===Zr)n.up.set(0,-1,0),n.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+t);for(const c of e)this.add(c),c.updateMatrixWorld()}update(t,e){this.parent===null&&this.updateMatrixWorld();const{renderTarget:n,activeMipmapLevel:r}=this;this.coordinateSystem!==t.coordinateSystem&&(this.coordinateSystem=t.coordinateSystem,this.updateCoordinateSystem());const[s,o,a,l,c,h]=this.children,d=t.getRenderTarget(),f=t.getActiveCubeFace(),m=t.getActiveMipmapLevel(),g=t.xr.enabled;t.xr.enabled=!1;const x=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,t.setRenderTarget(n,0,r),t.render(e,s),t.setRenderTarget(n,1,r),t.render(e,o),t.setRenderTarget(n,2,r),t.render(e,a),t.setRenderTarget(n,3,r),t.render(e,l),t.setRenderTarget(n,4,r),t.render(e,c),n.texture.generateMipmaps=x,t.setRenderTarget(n,5,r),t.render(e,h),t.setRenderTarget(d,f,m),t.xr.enabled=g,n.texture.needsPMREMUpdate=!0}}class Gl extends Te{constructor(t=[],e=ki,n,r,s,o,a,l,c,h){super(t,e,n,r,s,o,a,l,c,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(t){this.image=t}}class Cu extends di{constructor(t=1,e={}){super(t,t,e),this.isWebGLCubeRenderTarget=!0;const n={width:t,height:t,depth:1},r=[n,n,n,n,n,n];this.texture=new Gl(r),this._setTextureOptions(e),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(t,e){this.texture.type=e.type,this.texture.colorSpace=e.colorSpace,this.texture.generateMipmaps=e.generateMipmaps,this.texture.minFilter=e.minFilter,this.texture.magFilter=e.magFilter;const n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},r=new mi(5,5,5),s=new qn({name:"CubemapFromEquirect",uniforms:Wi(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Oe,blending:Hn});s.uniforms.tEquirect.value=e;const o=new Ie(r,s),a=e.minFilter;return e.minFilter===li&&(e.minFilter=dn),new Ru(1,10,this).update(t,o),e.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(t,e=!0,n=!0,r=!0){const s=t.getRenderTarget();for(let o=0;o<6;o++)t.setRenderTarget(this,o),t.clear(e,n,r);t.setRenderTarget(s)}}class zn extends fe{constructor(){super(),this.isGroup=!0,this.type="Group"}}const Pu={type:"move"};class Ps{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new zn,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new zn,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new F,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new F),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new zn,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new F,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new F),this._grip}dispatchEvent(t){return this._targetRay!==null&&this._targetRay.dispatchEvent(t),this._grip!==null&&this._grip.dispatchEvent(t),this._hand!==null&&this._hand.dispatchEvent(t),this}connect(t){if(t&&t.hand){const e=this._hand;if(e)for(const n of t.hand.values())this._getHandJoint(e,n)}return this.dispatchEvent({type:"connected",data:t}),this}disconnect(t){return this.dispatchEvent({type:"disconnected",data:t}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(t,e,n){let r=null,s=null,o=null;const a=this._targetRay,l=this._grip,c=this._hand;if(t&&e.session.visibilityState!=="visible-blurred"){if(c&&t.hand){o=!0;for(const x of t.hand.values()){const p=e.getJointPose(x,n),u=this._getHandJoint(c,x);p!==null&&(u.matrix.fromArray(p.transform.matrix),u.matrix.decompose(u.position,u.rotation,u.scale),u.matrixWorldNeedsUpdate=!0,u.jointRadius=p.radius),u.visible=p!==null}const h=c.joints["index-finger-tip"],d=c.joints["thumb-tip"],f=h.position.distanceTo(d.position),m=.02,g=.005;c.inputState.pinching&&f>m+g?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:t.handedness,target:this})):!c.inputState.pinching&&f<=m-g&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:t.handedness,target:this}))}else l!==null&&t.gripSpace&&(s=e.getPose(t.gripSpace,n),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1));a!==null&&(r=e.getPose(t.targetRaySpace,n),r===null&&s!==null&&(r=s),r!==null&&(a.matrix.fromArray(r.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,r.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(r.linearVelocity)):a.hasLinearVelocity=!1,r.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(r.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(Pu)))}return a!==null&&(a.visible=r!==null),l!==null&&(l.visible=s!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(t,e){if(t.joints[e.jointName]===void 0){const n=new zn;n.matrixAutoUpdate=!1,n.visible=!1,t.joints[e.jointName]=n,t.add(n)}return t.joints[e.jointName]}}class qa{constructor(t,e=1,n=1e3){this.isFog=!0,this.name="",this.color=new Vt(t),this.near=e,this.far=n}clone(){return new qa(this.color,this.near,this.far)}toJSON(){return{type:"Fog",name:this.name,color:this.color.getHex(),near:this.near,far:this.far}}}class Du extends fe{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new gn,this.environmentIntensity=1,this.environmentRotation=new gn,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(t,e){return super.copy(t,e),t.background!==null&&(this.background=t.background.clone()),t.environment!==null&&(this.environment=t.environment.clone()),t.fog!==null&&(this.fog=t.fog.clone()),this.backgroundBlurriness=t.backgroundBlurriness,this.backgroundIntensity=t.backgroundIntensity,this.backgroundRotation.copy(t.backgroundRotation),this.environmentIntensity=t.environmentIntensity,this.environmentRotation.copy(t.environmentRotation),t.overrideMaterial!==null&&(this.overrideMaterial=t.overrideMaterial.clone()),this.matrixAutoUpdate=t.matrixAutoUpdate,this}toJSON(t){const e=super.toJSON(t);return this.fog!==null&&(e.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(e.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(e.object.backgroundIntensity=this.backgroundIntensity),e.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(e.object.environmentIntensity=this.environmentIntensity),e.object.environmentRotation=this.environmentRotation.toArray(),e}}class Lu{constructor(t,e){this.isInterleavedBuffer=!0,this.array=t,this.stride=e,this.count=t!==void 0?t.length/e:0,this.usage=Ca,this.updateRanges=[],this.version=0,this.uuid=Vn()}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.array=new t.array.constructor(t.array),this.count=t.count,this.stride=t.stride,this.usage=t.usage,this}copyAt(t,e,n){t*=this.stride,n*=e.stride;for(let r=0,s=this.stride;r<s;r++)this.array[t+r]=e.array[n+r];return this}set(t,e=0){return this.array.set(t,e),this}clone(t){t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=Vn()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);const e=new this.array.constructor(t.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(e,this.stride);return n.setUsage(this.usage),n}onUpload(t){return this.onUploadCallback=t,this}toJSON(t){return t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=Vn()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}}const Ce=new F;class ts{constructor(t,e,n,r=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=t,this.itemSize=e,this.offset=n,this.normalized=r}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(t){this.data.needsUpdate=t}applyMatrix4(t){for(let e=0,n=this.data.count;e<n;e++)Ce.fromBufferAttribute(this,e),Ce.applyMatrix4(t),this.setXYZ(e,Ce.x,Ce.y,Ce.z);return this}applyNormalMatrix(t){for(let e=0,n=this.count;e<n;e++)Ce.fromBufferAttribute(this,e),Ce.applyNormalMatrix(t),this.setXYZ(e,Ce.x,Ce.y,Ce.z);return this}transformDirection(t){for(let e=0,n=this.count;e<n;e++)Ce.fromBufferAttribute(this,e),Ce.transformDirection(t),this.setXYZ(e,Ce.x,Ce.y,Ce.z);return this}getComponent(t,e){let n=this.array[t*this.data.stride+this.offset+e];return this.normalized&&(n=hn(n,this.array)),n}setComponent(t,e,n){return this.normalized&&(n=Jt(n,this.array)),this.data.array[t*this.data.stride+this.offset+e]=n,this}setX(t,e){return this.normalized&&(e=Jt(e,this.array)),this.data.array[t*this.data.stride+this.offset]=e,this}setY(t,e){return this.normalized&&(e=Jt(e,this.array)),this.data.array[t*this.data.stride+this.offset+1]=e,this}setZ(t,e){return this.normalized&&(e=Jt(e,this.array)),this.data.array[t*this.data.stride+this.offset+2]=e,this}setW(t,e){return this.normalized&&(e=Jt(e,this.array)),this.data.array[t*this.data.stride+this.offset+3]=e,this}getX(t){let e=this.data.array[t*this.data.stride+this.offset];return this.normalized&&(e=hn(e,this.array)),e}getY(t){let e=this.data.array[t*this.data.stride+this.offset+1];return this.normalized&&(e=hn(e,this.array)),e}getZ(t){let e=this.data.array[t*this.data.stride+this.offset+2];return this.normalized&&(e=hn(e,this.array)),e}getW(t){let e=this.data.array[t*this.data.stride+this.offset+3];return this.normalized&&(e=hn(e,this.array)),e}setXY(t,e,n){return t=t*this.data.stride+this.offset,this.normalized&&(e=Jt(e,this.array),n=Jt(n,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this}setXYZ(t,e,n,r){return t=t*this.data.stride+this.offset,this.normalized&&(e=Jt(e,this.array),n=Jt(n,this.array),r=Jt(r,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this.data.array[t+2]=r,this}setXYZW(t,e,n,r,s){return t=t*this.data.stride+this.offset,this.normalized&&(e=Jt(e,this.array),n=Jt(n,this.array),r=Jt(r,this.array),s=Jt(s,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this.data.array[t+2]=r,this.data.array[t+3]=s,this}clone(t){if(t===void 0){console.log("THREE.InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");const e=[];for(let n=0;n<this.count;n++){const r=n*this.data.stride+this.offset;for(let s=0;s<this.itemSize;s++)e.push(this.data.array[r+s])}return new Ke(new this.array.constructor(e),this.itemSize,this.normalized)}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.clone(t)),new ts(t.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(t){if(t===void 0){console.log("THREE.InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");const e=[];for(let n=0;n<this.count;n++){const r=n*this.data.stride+this.offset;for(let s=0;s<this.itemSize;s++)e.push(this.data.array[r+s])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:e,normalized:this.normalized}}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.toJSON(t)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}}class Wl extends qi{constructor(t){super(),this.isSpriteMaterial=!0,this.type="SpriteMaterial",this.color=new Vt(16777215),this.map=null,this.alphaMap=null,this.rotation=0,this.sizeAttenuation=!0,this.transparent=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.rotation=t.rotation,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}}let Di;const Qi=new F,Li=new F,Ii=new F,Ui=new Ot,tr=new Ot,Xl=new te,Nr=new F,er=new F,Fr=new F,Uo=new Ot,Ds=new Ot,No=new Ot;class Iu extends fe{constructor(t=new Wl){if(super(),this.isSprite=!0,this.type="Sprite",Di===void 0){Di=new rn;const e=new Float32Array([-.5,-.5,0,0,0,.5,-.5,0,1,0,.5,.5,0,1,1,-.5,.5,0,0,1]),n=new Lu(e,5);Di.setIndex([0,1,2,0,2,3]),Di.setAttribute("position",new ts(n,3,0,!1)),Di.setAttribute("uv",new ts(n,2,3,!1))}this.geometry=Di,this.material=t,this.center=new Ot(.5,.5),this.count=1}raycast(t,e){t.camera===null&&console.error('THREE.Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.'),Li.setFromMatrixScale(this.matrixWorld),Xl.copy(t.camera.matrixWorld),this.modelViewMatrix.multiplyMatrices(t.camera.matrixWorldInverse,this.matrixWorld),Ii.setFromMatrixPosition(this.modelViewMatrix),t.camera.isPerspectiveCamera&&this.material.sizeAttenuation===!1&&Li.multiplyScalar(-Ii.z);const n=this.material.rotation;let r,s;n!==0&&(s=Math.cos(n),r=Math.sin(n));const o=this.center;Or(Nr.set(-.5,-.5,0),Ii,o,Li,r,s),Or(er.set(.5,-.5,0),Ii,o,Li,r,s),Or(Fr.set(.5,.5,0),Ii,o,Li,r,s),Uo.set(0,0),Ds.set(1,0),No.set(1,1);let a=t.ray.intersectTriangle(Nr,er,Fr,!1,Qi);if(a===null&&(Or(er.set(-.5,.5,0),Ii,o,Li,r,s),Ds.set(0,1),a=t.ray.intersectTriangle(Nr,Fr,er,!1,Qi),a===null))return;const l=t.ray.origin.distanceTo(Qi);l<t.near||l>t.far||e.push({distance:l,point:Qi.clone(),uv:Ye.getInterpolation(Qi,Nr,er,Fr,Uo,Ds,No,new Ot),face:null,object:this})}copy(t,e){return super.copy(t,e),t.center!==void 0&&this.center.copy(t.center),this.material=t.material,this}}function Or(i,t,e,n,r,s){Ui.subVectors(i,e).addScalar(.5).multiply(n),r!==void 0?(tr.x=s*Ui.x-r*Ui.y,tr.y=r*Ui.x+s*Ui.y):tr.copy(Ui),i.copy(t),i.x+=tr.x,i.y+=tr.y,i.applyMatrix4(Xl)}class Uu extends Te{constructor(t=null,e=1,n=1,r,s,o,a,l,c=Ue,h=Ue,d,f){super(null,o,a,l,c,h,r,s,d,f),this.isDataTexture=!0,this.image={data:t,width:e,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class Fo extends Ke{constructor(t,e,n,r=1){super(t,e,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=r}copy(t){return super.copy(t),this.meshPerAttribute=t.meshPerAttribute,this}toJSON(){const t=super.toJSON();return t.meshPerAttribute=this.meshPerAttribute,t.isInstancedBufferAttribute=!0,t}}const Ni=new te,Oo=new te,Br=[],Bo=new pi,Nu=new te,nr=new Ie,ir=new pr;class ql extends Ie{constructor(t,e,n){super(t,e),this.isInstancedMesh=!0,this.instanceMatrix=new Fo(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let r=0;r<n;r++)this.setMatrixAt(r,Nu)}computeBoundingBox(){const t=this.geometry,e=this.count;this.boundingBox===null&&(this.boundingBox=new pi),t.boundingBox===null&&t.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<e;n++)this.getMatrixAt(n,Ni),Bo.copy(t.boundingBox).applyMatrix4(Ni),this.boundingBox.union(Bo)}computeBoundingSphere(){const t=this.geometry,e=this.count;this.boundingSphere===null&&(this.boundingSphere=new pr),t.boundingSphere===null&&t.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<e;n++)this.getMatrixAt(n,Ni),ir.copy(t.boundingSphere).applyMatrix4(Ni),this.boundingSphere.union(ir)}copy(t,e){return super.copy(t,e),this.instanceMatrix.copy(t.instanceMatrix),t.morphTexture!==null&&(this.morphTexture=t.morphTexture.clone()),t.instanceColor!==null&&(this.instanceColor=t.instanceColor.clone()),this.count=t.count,t.boundingBox!==null&&(this.boundingBox=t.boundingBox.clone()),t.boundingSphere!==null&&(this.boundingSphere=t.boundingSphere.clone()),this}getColorAt(t,e){e.fromArray(this.instanceColor.array,t*3)}getMatrixAt(t,e){e.fromArray(this.instanceMatrix.array,t*16)}getMorphAt(t,e){const n=e.morphTargetInfluences,r=this.morphTexture.source.data.data,s=n.length+1,o=t*s+1;for(let a=0;a<n.length;a++)n[a]=r[o+a]}raycast(t,e){const n=this.matrixWorld,r=this.count;if(nr.geometry=this.geometry,nr.material=this.material,nr.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),ir.copy(this.boundingSphere),ir.applyMatrix4(n),t.ray.intersectsSphere(ir)!==!1))for(let s=0;s<r;s++){this.getMatrixAt(s,Ni),Oo.multiplyMatrices(n,Ni),nr.matrixWorld=Oo,nr.raycast(t,Br);for(let o=0,a=Br.length;o<a;o++){const l=Br[o];l.instanceId=s,l.object=this,e.push(l)}Br.length=0}}setColorAt(t,e){this.instanceColor===null&&(this.instanceColor=new Fo(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),e.toArray(this.instanceColor.array,t*3)}setMatrixAt(t,e){e.toArray(this.instanceMatrix.array,t*16)}setMorphAt(t,e){const n=e.morphTargetInfluences,r=n.length+1;this.morphTexture===null&&(this.morphTexture=new Uu(new Float32Array(r*this.count),r,this.count,Ha,fn));const s=this.morphTexture.source.data.data;let o=0;for(let c=0;c<n.length;c++)o+=n[c];const a=this.geometry.morphTargetsRelative?1:1-o,l=r*t;s[l]=a,s.set(n,l+1)}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}}const Ls=new F,Fu=new F,Ou=new Ft;class ii{constructor(t=new F(1,0,0),e=0){this.isPlane=!0,this.normal=t,this.constant=e}set(t,e){return this.normal.copy(t),this.constant=e,this}setComponents(t,e,n,r){return this.normal.set(t,e,n),this.constant=r,this}setFromNormalAndCoplanarPoint(t,e){return this.normal.copy(t),this.constant=-e.dot(this.normal),this}setFromCoplanarPoints(t,e,n){const r=Ls.subVectors(n,e).cross(Fu.subVectors(t,e)).normalize();return this.setFromNormalAndCoplanarPoint(r,t),this}copy(t){return this.normal.copy(t.normal),this.constant=t.constant,this}normalize(){const t=1/this.normal.length();return this.normal.multiplyScalar(t),this.constant*=t,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(t){return this.normal.dot(t)+this.constant}distanceToSphere(t){return this.distanceToPoint(t.center)-t.radius}projectPoint(t,e){return e.copy(t).addScaledVector(this.normal,-this.distanceToPoint(t))}intersectLine(t,e){const n=t.delta(Ls),r=this.normal.dot(n);if(r===0)return this.distanceToPoint(t.start)===0?e.copy(t.start):null;const s=-(t.start.dot(this.normal)+this.constant)/r;return s<0||s>1?null:e.copy(t.start).addScaledVector(n,s)}intersectsLine(t){const e=this.distanceToPoint(t.start),n=this.distanceToPoint(t.end);return e<0&&n>0||n<0&&e>0}intersectsBox(t){return t.intersectsPlane(this)}intersectsSphere(t){return t.intersectsPlane(this)}coplanarPoint(t){return t.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(t,e){const n=e||Ou.getNormalMatrix(t),r=this.coplanarPoint(Ls).applyMatrix4(t),s=this.normal.applyMatrix3(n).normalize();return this.constant=-r.dot(s),this}translate(t){return this.constant-=t.dot(this.normal),this}equals(t){return t.normal.equals(this.normal)&&t.constant===this.constant}clone(){return new this.constructor().copy(this)}}const Qn=new pr,Bu=new Ot(.5,.5),zr=new F;class Ya{constructor(t=new ii,e=new ii,n=new ii,r=new ii,s=new ii,o=new ii){this.planes=[t,e,n,r,s,o]}set(t,e,n,r,s,o){const a=this.planes;return a[0].copy(t),a[1].copy(e),a[2].copy(n),a[3].copy(r),a[4].copy(s),a[5].copy(o),this}copy(t){const e=this.planes;for(let n=0;n<6;n++)e[n].copy(t.planes[n]);return this}setFromProjectionMatrix(t,e=pn,n=!1){const r=this.planes,s=t.elements,o=s[0],a=s[1],l=s[2],c=s[3],h=s[4],d=s[5],f=s[6],m=s[7],g=s[8],x=s[9],p=s[10],u=s[11],b=s[12],T=s[13],E=s[14],C=s[15];if(r[0].setComponents(c-o,m-h,u-g,C-b).normalize(),r[1].setComponents(c+o,m+h,u+g,C+b).normalize(),r[2].setComponents(c+a,m+d,u+x,C+T).normalize(),r[3].setComponents(c-a,m-d,u-x,C-T).normalize(),n)r[4].setComponents(l,f,p,E).normalize(),r[5].setComponents(c-l,m-f,u-p,C-E).normalize();else if(r[4].setComponents(c-l,m-f,u-p,C-E).normalize(),e===pn)r[5].setComponents(c+l,m+f,u+p,C+E).normalize();else if(e===Zr)r[5].setComponents(l,f,p,E).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+e);return this}intersectsObject(t){if(t.boundingSphere!==void 0)t.boundingSphere===null&&t.computeBoundingSphere(),Qn.copy(t.boundingSphere).applyMatrix4(t.matrixWorld);else{const e=t.geometry;e.boundingSphere===null&&e.computeBoundingSphere(),Qn.copy(e.boundingSphere).applyMatrix4(t.matrixWorld)}return this.intersectsSphere(Qn)}intersectsSprite(t){Qn.center.set(0,0,0);const e=Bu.distanceTo(t.center);return Qn.radius=.7071067811865476+e,Qn.applyMatrix4(t.matrixWorld),this.intersectsSphere(Qn)}intersectsSphere(t){const e=this.planes,n=t.center,r=-t.radius;for(let s=0;s<6;s++)if(e[s].distanceToPoint(n)<r)return!1;return!0}intersectsBox(t){const e=this.planes;for(let n=0;n<6;n++){const r=e[n];if(zr.x=r.normal.x>0?t.max.x:t.min.x,zr.y=r.normal.y>0?t.max.y:t.min.y,zr.z=r.normal.z>0?t.max.z:t.min.z,r.distanceToPoint(zr)<0)return!1}return!0}containsPoint(t){const e=this.planes;for(let n=0;n<6;n++)if(e[n].distanceToPoint(t)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}class $a extends Te{constructor(t,e,n,r,s,o,a,l,c){super(t,e,n,r,s,o,a,l,c),this.isCanvasTexture=!0,this.needsUpdate=!0}}class Yl extends Te{constructor(t,e,n=hi,r,s,o,a=Ue,l=Ue,c,h=cr,d=1){if(h!==cr&&h!==ur)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");const f={width:t,height:e,depth:d};super(f,r,s,o,a,l,h,n,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(t){return super.copy(t),this.source=new Wa(Object.assign({},t.image)),this.compareFunction=t.compareFunction,this}toJSON(t){const e=super.toJSON(t);return this.compareFunction!==null&&(e.compareFunction=this.compareFunction),e}}class $l extends Te{constructor(t=null){super(),this.sourceTexture=t,this.isExternalTexture=!0}copy(t){return super.copy(t),this.sourceTexture=t.sourceTexture,this}}class Ka extends rn{constructor(t=1,e=1,n=1,r=32,s=1,o=!1,a=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:t,radiusBottom:e,height:n,radialSegments:r,heightSegments:s,openEnded:o,thetaStart:a,thetaLength:l};const c=this;r=Math.floor(r),s=Math.floor(s);const h=[],d=[],f=[],m=[];let g=0;const x=[],p=n/2;let u=0;b(),o===!1&&(t>0&&T(!0),e>0&&T(!1)),this.setIndex(h),this.setAttribute("position",new Ae(d,3)),this.setAttribute("normal",new Ae(f,3)),this.setAttribute("uv",new Ae(m,2));function b(){const E=new F,C=new F;let w=0;const R=(e-t)/n;for(let U=0;U<=s;U++){const S=[],M=U/s,P=M*(e-t)+t;for(let O=0;O<=r;O++){const k=O/r,Y=k*l+a,X=Math.sin(Y),q=Math.cos(Y);C.x=P*X,C.y=-M*n+p,C.z=P*q,d.push(C.x,C.y,C.z),E.set(X,R,q).normalize(),f.push(E.x,E.y,E.z),m.push(k,1-M),S.push(g++)}x.push(S)}for(let U=0;U<r;U++)for(let S=0;S<s;S++){const M=x[S][U],P=x[S+1][U],O=x[S+1][U+1],k=x[S][U+1];(t>0||S!==0)&&(h.push(M,P,k),w+=3),(e>0||S!==s-1)&&(h.push(P,O,k),w+=3)}c.addGroup(u,w,0),u+=w}function T(E){const C=g,w=new Ot,R=new F;let U=0;const S=E===!0?t:e,M=E===!0?1:-1;for(let O=1;O<=r;O++)d.push(0,p*M,0),f.push(0,M,0),m.push(.5,.5),g++;const P=g;for(let O=0;O<=r;O++){const Y=O/r*l+a,X=Math.cos(Y),q=Math.sin(Y);R.x=S*q,R.y=p*M,R.z=S*X,d.push(R.x,R.y,R.z),f.push(0,M,0),w.x=X*.5+.5,w.y=q*.5*M+.5,m.push(w.x,w.y),g++}for(let O=0;O<r;O++){const k=C+O,Y=P+O;E===!0?h.push(Y,Y+1,k):h.push(Y+1,Y,k),U+=3}c.addGroup(u,U,E===!0?1:2),u+=U}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Ka(t.radiusTop,t.radiusBottom,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}}class gi extends rn{constructor(t=1,e=1,n=1,r=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:e,widthSegments:n,heightSegments:r};const s=t/2,o=e/2,a=Math.floor(n),l=Math.floor(r),c=a+1,h=l+1,d=t/a,f=e/l,m=[],g=[],x=[],p=[];for(let u=0;u<h;u++){const b=u*f-o;for(let T=0;T<c;T++){const E=T*d-s;g.push(E,-b,0),x.push(0,0,1),p.push(T/a),p.push(1-u/l)}}for(let u=0;u<l;u++)for(let b=0;b<a;b++){const T=b+c*u,E=b+c*(u+1),C=b+1+c*(u+1),w=b+1+c*u;m.push(T,E,w),m.push(E,C,w)}this.setIndex(m),this.setAttribute("position",new Ae(g,3)),this.setAttribute("normal",new Ae(x,3)),this.setAttribute("uv",new Ae(p,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new gi(t.width,t.height,t.widthSegments,t.heightSegments)}}class ja extends rn{constructor(t=.5,e=1,n=32,r=1,s=0,o=Math.PI*2){super(),this.type="RingGeometry",this.parameters={innerRadius:t,outerRadius:e,thetaSegments:n,phiSegments:r,thetaStart:s,thetaLength:o},n=Math.max(3,n),r=Math.max(1,r);const a=[],l=[],c=[],h=[];let d=t;const f=(e-t)/r,m=new F,g=new Ot;for(let x=0;x<=r;x++){for(let p=0;p<=n;p++){const u=s+p/n*o;m.x=d*Math.cos(u),m.y=d*Math.sin(u),l.push(m.x,m.y,m.z),c.push(0,0,1),g.x=(m.x/e+1)/2,g.y=(m.y/e+1)/2,h.push(g.x,g.y)}d+=f}for(let x=0;x<r;x++){const p=x*(n+1);for(let u=0;u<n;u++){const b=u+p,T=b,E=b+n+1,C=b+n+2,w=b+1;a.push(T,E,w),a.push(E,C,w)}}this.setIndex(a),this.setAttribute("position",new Ae(l,3)),this.setAttribute("normal",new Ae(c,3)),this.setAttribute("uv",new Ae(h,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new ja(t.innerRadius,t.outerRadius,t.thetaSegments,t.phiSegments,t.thetaStart,t.thetaLength)}}class An extends qi{constructor(t){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Vt(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Vt(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Il,this.normalScale=new Ot(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new gn,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.defines={STANDARD:""},this.color.copy(t.color),this.roughness=t.roughness,this.metalness=t.metalness,this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.roughnessMap=t.roughnessMap,this.metalnessMap=t.metalnessMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.envMapIntensity=t.envMapIntensity,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}}class zu extends qi{constructor(t){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Yc,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(t)}copy(t){return super.copy(t),this.depthPacking=t.depthPacking,this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this}}class Hu extends qi{constructor(t){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(t)}copy(t){return super.copy(t),this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this}}class Za extends fe{constructor(t,e=1){super(),this.isLight=!0,this.type="Light",this.color=new Vt(t),this.intensity=e}dispose(){}copy(t,e){return super.copy(t,e),this.color.copy(t.color),this.intensity=t.intensity,this}toJSON(t){const e=super.toJSON(t);return e.object.color=this.color.getHex(),e.object.intensity=this.intensity,this.groundColor!==void 0&&(e.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(e.object.distance=this.distance),this.angle!==void 0&&(e.object.angle=this.angle),this.decay!==void 0&&(e.object.decay=this.decay),this.penumbra!==void 0&&(e.object.penumbra=this.penumbra),this.shadow!==void 0&&(e.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(e.object.target=this.target.uuid),e}}class ku extends Za{constructor(t,e,n){super(t,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(fe.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Vt(e)}copy(t,e){return super.copy(t,e),this.groundColor.copy(t.groundColor),this}}const Is=new te,zo=new F,Ho=new F;class Vu{constructor(t){this.camera=t,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ot(512,512),this.mapType=mn,this.map=null,this.mapPass=null,this.matrix=new te,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Ya,this._frameExtents=new Ot(1,1),this._viewportCount=1,this._viewports=[new he(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(t){const e=this.camera,n=this.matrix;zo.setFromMatrixPosition(t.matrixWorld),e.position.copy(zo),Ho.setFromMatrixPosition(t.target.matrixWorld),e.lookAt(Ho),e.updateMatrixWorld(),Is.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Is,e.coordinateSystem,e.reversedDepth),e.reversedDepth?n.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Is)}getViewport(t){return this._viewports[t]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(t){return this.camera=t.camera.clone(),this.intensity=t.intensity,this.bias=t.bias,this.radius=t.radius,this.autoUpdate=t.autoUpdate,this.needsUpdate=t.needsUpdate,this.normalBias=t.normalBias,this.blurSamples=t.blurSamples,this.mapSize.copy(t.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){const t={};return this.intensity!==1&&(t.intensity=this.intensity),this.bias!==0&&(t.bias=this.bias),this.normalBias!==0&&(t.normalBias=this.normalBias),this.radius!==1&&(t.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(t.mapSize=this.mapSize.toArray()),t.camera=this.camera.toJSON(!1).object,delete t.camera.matrix,t}}class Ja extends Vl{constructor(t=-1,e=1,n=1,r=-1,s=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=t,this.right=e,this.top=n,this.bottom=r,this.near=s,this.far=o,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.left=t.left,this.right=t.right,this.top=t.top,this.bottom=t.bottom,this.near=t.near,this.far=t.far,this.zoom=t.zoom,this.view=t.view===null?null:Object.assign({},t.view),this}setViewOffset(t,e,n,r,s,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=n,this.view.offsetY=r,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=(this.right-this.left)/(2*this.zoom),e=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,r=(this.top+this.bottom)/2;let s=n-t,o=n+t,a=r+e,l=r-e;if(this.view!==null&&this.view.enabled){const c=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=c*this.view.offsetX,o=s+c*this.view.width,a-=h*this.view.offsetY,l=a-h*this.view.height}this.projectionMatrix.makeOrthographic(s,o,a,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.zoom=this.zoom,e.object.left=this.left,e.object.right=this.right,e.object.top=this.top,e.object.bottom=this.bottom,e.object.near=this.near,e.object.far=this.far,this.view!==null&&(e.object.view=Object.assign({},this.view)),e}}class Gu extends Vu{constructor(){super(new Ja(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}}class Wu extends Za{constructor(t,e){super(t,e),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(fe.DEFAULT_UP),this.updateMatrix(),this.target=new fe,this.shadow=new Gu}dispose(){this.shadow.dispose()}copy(t){return super.copy(t),this.target=t.target.clone(),this.shadow=t.shadow.clone(),this}}class Xu extends Za{constructor(t,e){super(t,e),this.isAmbientLight=!0,this.type="AmbientLight"}}class qu extends Qe{constructor(t=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=t}}const ko=new te;class Yu{constructor(t,e,n=0,r=1/0){this.ray=new Ol(t,e),this.near=n,this.far=r,this.camera=null,this.layers=new Xa,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(t,e){this.ray.set(t,e)}setFromCamera(t,e){e.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(t.x,t.y,.5).unproject(e).sub(this.ray.origin).normalize(),this.camera=e):e.isOrthographicCamera?(this.ray.origin.set(t.x,t.y,(e.near+e.far)/(e.near-e.far)).unproject(e),this.ray.direction.set(0,0,-1).transformDirection(e.matrixWorld),this.camera=e):console.error("THREE.Raycaster: Unsupported camera type: "+e.type)}setFromXRController(t){return ko.identity().extractRotation(t.matrixWorld),this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(ko),this}intersectObject(t,e=!0,n=[]){return Da(t,this,n,e),n.sort(Vo),n}intersectObjects(t,e=!0,n=[]){for(let r=0,s=t.length;r<s;r++)Da(t[r],this,n,e);return n.sort(Vo),n}}function Vo(i,t){return i.distance-t.distance}function Da(i,t,e,n){let r=!0;if(i.layers.test(t.layers)&&i.raycast(t,e)===!1&&(r=!1),r===!0&&n===!0){const s=i.children;for(let o=0,a=s.length;o<a;o++)Da(s[o],t,e,!0)}}function Go(i,t,e,n){const r=$u(n);switch(e){case Pl:return i*t;case Ha:return i*t/r.components*r.byteLength;case ka:return i*t/r.components*r.byteLength;case Ll:return i*t*2/r.components*r.byteLength;case Va:return i*t*2/r.components*r.byteLength;case Dl:return i*t*3/r.components*r.byteLength;case en:return i*t*4/r.components*r.byteLength;case Ga:return i*t*4/r.components*r.byteLength;case Wr:case Xr:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*8;case qr:case Yr:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*16;case na:case ra:return Math.max(i,16)*Math.max(t,8)/4;case ea:case ia:return Math.max(i,8)*Math.max(t,8)/2;case sa:case aa:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*8;case oa:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*16;case la:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*16;case ca:return Math.floor((i+4)/5)*Math.floor((t+3)/4)*16;case ua:return Math.floor((i+4)/5)*Math.floor((t+4)/5)*16;case ha:return Math.floor((i+5)/6)*Math.floor((t+4)/5)*16;case da:return Math.floor((i+5)/6)*Math.floor((t+5)/6)*16;case fa:return Math.floor((i+7)/8)*Math.floor((t+4)/5)*16;case pa:return Math.floor((i+7)/8)*Math.floor((t+5)/6)*16;case ma:return Math.floor((i+7)/8)*Math.floor((t+7)/8)*16;case ga:return Math.floor((i+9)/10)*Math.floor((t+4)/5)*16;case _a:return Math.floor((i+9)/10)*Math.floor((t+5)/6)*16;case va:return Math.floor((i+9)/10)*Math.floor((t+7)/8)*16;case xa:return Math.floor((i+9)/10)*Math.floor((t+9)/10)*16;case Ma:return Math.floor((i+11)/12)*Math.floor((t+9)/10)*16;case Sa:return Math.floor((i+11)/12)*Math.floor((t+11)/12)*16;case Ea:case ya:case ba:return Math.ceil(i/4)*Math.ceil(t/4)*16;case Ta:case Aa:return Math.ceil(i/4)*Math.ceil(t/4)*8;case wa:case Ra:return Math.ceil(i/4)*Math.ceil(t/4)*16}throw new Error(`Unable to determine texture byte length for ${e} format.`)}function $u(i){switch(i){case mn:case Al:return{byteLength:1,components:1};case or:case wl:case dr:return{byteLength:2,components:1};case Ba:case za:return{byteLength:2,components:4};case hi:case Oa:case fn:return{byteLength:4,components:1};case Rl:case Cl:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${i}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:Fa}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=Fa);function Kl(){let i=null,t=!1,e=null,n=null;function r(s,o){e(s,o),n=i.requestAnimationFrame(r)}return{start:function(){t!==!0&&e!==null&&(n=i.requestAnimationFrame(r),t=!0)},stop:function(){i.cancelAnimationFrame(n),t=!1},setAnimationLoop:function(s){e=s},setContext:function(s){i=s}}}function Ku(i){const t=new WeakMap;function e(a,l){const c=a.array,h=a.usage,d=c.byteLength,f=i.createBuffer();i.bindBuffer(l,f),i.bufferData(l,c,h),a.onUploadCallback();let m;if(c instanceof Float32Array)m=i.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)m=i.HALF_FLOAT;else if(c instanceof Uint16Array)a.isFloat16BufferAttribute?m=i.HALF_FLOAT:m=i.UNSIGNED_SHORT;else if(c instanceof Int16Array)m=i.SHORT;else if(c instanceof Uint32Array)m=i.UNSIGNED_INT;else if(c instanceof Int32Array)m=i.INT;else if(c instanceof Int8Array)m=i.BYTE;else if(c instanceof Uint8Array)m=i.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)m=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:f,type:m,bytesPerElement:c.BYTES_PER_ELEMENT,version:a.version,size:d}}function n(a,l,c){const h=l.array,d=l.updateRanges;if(i.bindBuffer(c,a),d.length===0)i.bufferSubData(c,0,h);else{d.sort((m,g)=>m.start-g.start);let f=0;for(let m=1;m<d.length;m++){const g=d[f],x=d[m];x.start<=g.start+g.count+1?g.count=Math.max(g.count,x.start+x.count-g.start):(++f,d[f]=x)}d.length=f+1;for(let m=0,g=d.length;m<g;m++){const x=d[m];i.bufferSubData(c,x.start*h.BYTES_PER_ELEMENT,h,x.start,x.count)}l.clearUpdateRanges()}l.onUploadCallback()}function r(a){return a.isInterleavedBufferAttribute&&(a=a.data),t.get(a)}function s(a){a.isInterleavedBufferAttribute&&(a=a.data);const l=t.get(a);l&&(i.deleteBuffer(l.buffer),t.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){const h=t.get(a);(!h||h.version<a.version)&&t.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}const c=t.get(a);if(c===void 0)t.set(a,e(a,l));else if(c.version<a.version){if(c.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(c.buffer,a,l),c.version=a.version}}return{get:r,remove:s,update:o}}var ju=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Zu=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,Ju=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Qu=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,th=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,eh=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,nh=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,ih=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,rh=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,sh=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,ah=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,oh=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,lh=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,ch=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,uh=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,hh=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,dh=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,fh=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,ph=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,mh=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,gh=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,_h=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,vh=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,xh=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,Mh=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,Sh=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,Eh=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,yh=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,bh=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,Th=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,Ah="gl_FragColor = linearToOutputTexel( gl_FragColor );",wh=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,Rh=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,Ch=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,Ph=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,Dh=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,Lh=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,Ih=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,Uh=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Nh=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Fh=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Oh=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,Bh=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,zh=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Hh=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,kh=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,Vh=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,Gh=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Wh=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Xh=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,qh=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Yh=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,$h=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,Kh=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,jh=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,Zh=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Jh=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Qh=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,td=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,ed=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,nd=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,id=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,rd=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,sd=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,ad=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,od=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,ld=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,cd=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,ud=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,hd=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,dd=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,fd=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,pd=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,md=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,gd=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,_d=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,vd=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,xd=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,Md=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,Sd=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,Ed=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,yd=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,bd=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,Td=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,Ad=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,wd=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,Rd=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,Cd=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,Pd=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,Dd=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		float depth = unpackRGBAToDepth( texture2D( depths, uv ) );
		#ifdef USE_REVERSED_DEPTH_BUFFER
			return step( depth, compare );
		#else
			return step( compare, depth );
		#endif
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow( sampler2D shadow, vec2 uv, float compare ) {
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		#ifdef USE_REVERSED_DEPTH_BUFFER
			float hard_shadow = step( distribution.x, compare );
		#else
			float hard_shadow = step( compare, distribution.x );
		#endif
		if ( hard_shadow != 1.0 ) {
			float distance = compare - distribution.x;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,Ld=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,Id=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,Ud=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,Nd=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,Fd=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,Od=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Bd=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,zd=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Hd=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,kd=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Vd=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,Gd=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,Wd=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,Xd=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,qd=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Yd=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,$d=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const Kd=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,jd=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Zd=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Jd=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Qd=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,tf=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,ef=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,nf=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,rf=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,sf=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,af=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,of=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,lf=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,cf=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,uf=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,hf=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,df=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,ff=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,pf=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,mf=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,gf=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,_f=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,vf=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,xf=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Mf=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,Sf=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Ef=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,yf=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,bf=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,Tf=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Af=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,wf=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Rf=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Cf=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,zt={alphahash_fragment:ju,alphahash_pars_fragment:Zu,alphamap_fragment:Ju,alphamap_pars_fragment:Qu,alphatest_fragment:th,alphatest_pars_fragment:eh,aomap_fragment:nh,aomap_pars_fragment:ih,batching_pars_vertex:rh,batching_vertex:sh,begin_vertex:ah,beginnormal_vertex:oh,bsdfs:lh,iridescence_fragment:ch,bumpmap_pars_fragment:uh,clipping_planes_fragment:hh,clipping_planes_pars_fragment:dh,clipping_planes_pars_vertex:fh,clipping_planes_vertex:ph,color_fragment:mh,color_pars_fragment:gh,color_pars_vertex:_h,color_vertex:vh,common:xh,cube_uv_reflection_fragment:Mh,defaultnormal_vertex:Sh,displacementmap_pars_vertex:Eh,displacementmap_vertex:yh,emissivemap_fragment:bh,emissivemap_pars_fragment:Th,colorspace_fragment:Ah,colorspace_pars_fragment:wh,envmap_fragment:Rh,envmap_common_pars_fragment:Ch,envmap_pars_fragment:Ph,envmap_pars_vertex:Dh,envmap_physical_pars_fragment:Vh,envmap_vertex:Lh,fog_vertex:Ih,fog_pars_vertex:Uh,fog_fragment:Nh,fog_pars_fragment:Fh,gradientmap_pars_fragment:Oh,lightmap_pars_fragment:Bh,lights_lambert_fragment:zh,lights_lambert_pars_fragment:Hh,lights_pars_begin:kh,lights_toon_fragment:Gh,lights_toon_pars_fragment:Wh,lights_phong_fragment:Xh,lights_phong_pars_fragment:qh,lights_physical_fragment:Yh,lights_physical_pars_fragment:$h,lights_fragment_begin:Kh,lights_fragment_maps:jh,lights_fragment_end:Zh,logdepthbuf_fragment:Jh,logdepthbuf_pars_fragment:Qh,logdepthbuf_pars_vertex:td,logdepthbuf_vertex:ed,map_fragment:nd,map_pars_fragment:id,map_particle_fragment:rd,map_particle_pars_fragment:sd,metalnessmap_fragment:ad,metalnessmap_pars_fragment:od,morphinstance_vertex:ld,morphcolor_vertex:cd,morphnormal_vertex:ud,morphtarget_pars_vertex:hd,morphtarget_vertex:dd,normal_fragment_begin:fd,normal_fragment_maps:pd,normal_pars_fragment:md,normal_pars_vertex:gd,normal_vertex:_d,normalmap_pars_fragment:vd,clearcoat_normal_fragment_begin:xd,clearcoat_normal_fragment_maps:Md,clearcoat_pars_fragment:Sd,iridescence_pars_fragment:Ed,opaque_fragment:yd,packing:bd,premultiplied_alpha_fragment:Td,project_vertex:Ad,dithering_fragment:wd,dithering_pars_fragment:Rd,roughnessmap_fragment:Cd,roughnessmap_pars_fragment:Pd,shadowmap_pars_fragment:Dd,shadowmap_pars_vertex:Ld,shadowmap_vertex:Id,shadowmask_pars_fragment:Ud,skinbase_vertex:Nd,skinning_pars_vertex:Fd,skinning_vertex:Od,skinnormal_vertex:Bd,specularmap_fragment:zd,specularmap_pars_fragment:Hd,tonemapping_fragment:kd,tonemapping_pars_fragment:Vd,transmission_fragment:Gd,transmission_pars_fragment:Wd,uv_pars_fragment:Xd,uv_pars_vertex:qd,uv_vertex:Yd,worldpos_vertex:$d,background_vert:Kd,background_frag:jd,backgroundCube_vert:Zd,backgroundCube_frag:Jd,cube_vert:Qd,cube_frag:tf,depth_vert:ef,depth_frag:nf,distanceRGBA_vert:rf,distanceRGBA_frag:sf,equirect_vert:af,equirect_frag:of,linedashed_vert:lf,linedashed_frag:cf,meshbasic_vert:uf,meshbasic_frag:hf,meshlambert_vert:df,meshlambert_frag:ff,meshmatcap_vert:pf,meshmatcap_frag:mf,meshnormal_vert:gf,meshnormal_frag:_f,meshphong_vert:vf,meshphong_frag:xf,meshphysical_vert:Mf,meshphysical_frag:Sf,meshtoon_vert:Ef,meshtoon_frag:yf,points_vert:bf,points_frag:Tf,shadow_vert:Af,shadow_frag:wf,sprite_vert:Rf,sprite_frag:Cf},st={common:{diffuse:{value:new Vt(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Ft},alphaMap:{value:null},alphaMapTransform:{value:new Ft},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Ft}},envmap:{envMap:{value:null},envMapRotation:{value:new Ft},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Ft}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Ft}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Ft},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Ft},normalScale:{value:new Ot(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Ft},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Ft}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Ft}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Ft}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Vt(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new Vt(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Ft},alphaTest:{value:0},uvTransform:{value:new Ft}},sprite:{diffuse:{value:new Vt(16777215)},opacity:{value:1},center:{value:new Ot(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Ft},alphaMap:{value:null},alphaMapTransform:{value:new Ft},alphaTest:{value:0}}},cn={basic:{uniforms:Pe([st.common,st.specularmap,st.envmap,st.aomap,st.lightmap,st.fog]),vertexShader:zt.meshbasic_vert,fragmentShader:zt.meshbasic_frag},lambert:{uniforms:Pe([st.common,st.specularmap,st.envmap,st.aomap,st.lightmap,st.emissivemap,st.bumpmap,st.normalmap,st.displacementmap,st.fog,st.lights,{emissive:{value:new Vt(0)}}]),vertexShader:zt.meshlambert_vert,fragmentShader:zt.meshlambert_frag},phong:{uniforms:Pe([st.common,st.specularmap,st.envmap,st.aomap,st.lightmap,st.emissivemap,st.bumpmap,st.normalmap,st.displacementmap,st.fog,st.lights,{emissive:{value:new Vt(0)},specular:{value:new Vt(1118481)},shininess:{value:30}}]),vertexShader:zt.meshphong_vert,fragmentShader:zt.meshphong_frag},standard:{uniforms:Pe([st.common,st.envmap,st.aomap,st.lightmap,st.emissivemap,st.bumpmap,st.normalmap,st.displacementmap,st.roughnessmap,st.metalnessmap,st.fog,st.lights,{emissive:{value:new Vt(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:zt.meshphysical_vert,fragmentShader:zt.meshphysical_frag},toon:{uniforms:Pe([st.common,st.aomap,st.lightmap,st.emissivemap,st.bumpmap,st.normalmap,st.displacementmap,st.gradientmap,st.fog,st.lights,{emissive:{value:new Vt(0)}}]),vertexShader:zt.meshtoon_vert,fragmentShader:zt.meshtoon_frag},matcap:{uniforms:Pe([st.common,st.bumpmap,st.normalmap,st.displacementmap,st.fog,{matcap:{value:null}}]),vertexShader:zt.meshmatcap_vert,fragmentShader:zt.meshmatcap_frag},points:{uniforms:Pe([st.points,st.fog]),vertexShader:zt.points_vert,fragmentShader:zt.points_frag},dashed:{uniforms:Pe([st.common,st.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:zt.linedashed_vert,fragmentShader:zt.linedashed_frag},depth:{uniforms:Pe([st.common,st.displacementmap]),vertexShader:zt.depth_vert,fragmentShader:zt.depth_frag},normal:{uniforms:Pe([st.common,st.bumpmap,st.normalmap,st.displacementmap,{opacity:{value:1}}]),vertexShader:zt.meshnormal_vert,fragmentShader:zt.meshnormal_frag},sprite:{uniforms:Pe([st.sprite,st.fog]),vertexShader:zt.sprite_vert,fragmentShader:zt.sprite_frag},background:{uniforms:{uvTransform:{value:new Ft},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:zt.background_vert,fragmentShader:zt.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Ft}},vertexShader:zt.backgroundCube_vert,fragmentShader:zt.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:zt.cube_vert,fragmentShader:zt.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:zt.equirect_vert,fragmentShader:zt.equirect_frag},distanceRGBA:{uniforms:Pe([st.common,st.displacementmap,{referencePosition:{value:new F},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:zt.distanceRGBA_vert,fragmentShader:zt.distanceRGBA_frag},shadow:{uniforms:Pe([st.lights,st.fog,{color:{value:new Vt(0)},opacity:{value:1}}]),vertexShader:zt.shadow_vert,fragmentShader:zt.shadow_frag}};cn.physical={uniforms:Pe([cn.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Ft},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Ft},clearcoatNormalScale:{value:new Ot(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Ft},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Ft},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Ft},sheen:{value:0},sheenColor:{value:new Vt(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Ft},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Ft},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Ft},transmissionSamplerSize:{value:new Ot},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Ft},attenuationDistance:{value:0},attenuationColor:{value:new Vt(0)},specularColor:{value:new Vt(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Ft},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Ft},anisotropyVector:{value:new Ot},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Ft}}]),vertexShader:zt.meshphysical_vert,fragmentShader:zt.meshphysical_frag};const Hr={r:0,b:0,g:0},ti=new gn,Pf=new te;function Df(i,t,e,n,r,s,o){const a=new Vt(0);let l=s===!0?0:1,c,h,d=null,f=0,m=null;function g(T){let E=T.isScene===!0?T.background:null;return E&&E.isTexture&&(E=(T.backgroundBlurriness>0?e:t).get(E)),E}function x(T){let E=!1;const C=g(T);C===null?u(a,l):C&&C.isColor&&(u(C,1),E=!0);const w=i.xr.getEnvironmentBlendMode();w==="additive"?n.buffers.color.setClear(0,0,0,1,o):w==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,o),(i.autoClear||E)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil))}function p(T,E){const C=g(E);C&&(C.isCubeTexture||C.mapping===es)?(h===void 0&&(h=new Ie(new mi(1,1,1),new qn({name:"BackgroundCubeMaterial",uniforms:Wi(cn.backgroundCube.uniforms),vertexShader:cn.backgroundCube.vertexShader,fragmentShader:cn.backgroundCube.fragmentShader,side:Oe,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(w,R,U){this.matrixWorld.copyPosition(U.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),r.update(h)),ti.copy(E.backgroundRotation),ti.x*=-1,ti.y*=-1,ti.z*=-1,C.isCubeTexture&&C.isRenderTargetTexture===!1&&(ti.y*=-1,ti.z*=-1),h.material.uniforms.envMap.value=C,h.material.uniforms.flipEnvMap.value=C.isCubeTexture&&C.isRenderTargetTexture===!1?-1:1,h.material.uniforms.backgroundBlurriness.value=E.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=E.backgroundIntensity,h.material.uniforms.backgroundRotation.value.setFromMatrix4(Pf.makeRotationFromEuler(ti)),h.material.toneMapped=Yt.getTransfer(C.colorSpace)!==Zt,(d!==C||f!==C.version||m!==i.toneMapping)&&(h.material.needsUpdate=!0,d=C,f=C.version,m=i.toneMapping),h.layers.enableAll(),T.unshift(h,h.geometry,h.material,0,0,null)):C&&C.isTexture&&(c===void 0&&(c=new Ie(new gi(2,2),new qn({name:"BackgroundMaterial",uniforms:Wi(cn.background.uniforms),vertexShader:cn.background.vertexShader,fragmentShader:cn.background.fragmentShader,side:Xn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),r.update(c)),c.material.uniforms.t2D.value=C,c.material.uniforms.backgroundIntensity.value=E.backgroundIntensity,c.material.toneMapped=Yt.getTransfer(C.colorSpace)!==Zt,C.matrixAutoUpdate===!0&&C.updateMatrix(),c.material.uniforms.uvTransform.value.copy(C.matrix),(d!==C||f!==C.version||m!==i.toneMapping)&&(c.material.needsUpdate=!0,d=C,f=C.version,m=i.toneMapping),c.layers.enableAll(),T.unshift(c,c.geometry,c.material,0,0,null))}function u(T,E){T.getRGB(Hr,kl(i)),n.buffers.color.setClear(Hr.r,Hr.g,Hr.b,E,o)}function b(){h!==void 0&&(h.geometry.dispose(),h.material.dispose(),h=void 0),c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0)}return{getClearColor:function(){return a},setClearColor:function(T,E=1){a.set(T),l=E,u(a,l)},getClearAlpha:function(){return l},setClearAlpha:function(T){l=T,u(a,l)},render:x,addToRenderList:p,dispose:b}}function Lf(i,t){const e=i.getParameter(i.MAX_VERTEX_ATTRIBS),n={},r=f(null);let s=r,o=!1;function a(M,P,O,k,Y){let X=!1;const q=d(k,O,P);s!==q&&(s=q,c(s.object)),X=m(M,k,O,Y),X&&g(M,k,O,Y),Y!==null&&t.update(Y,i.ELEMENT_ARRAY_BUFFER),(X||o)&&(o=!1,E(M,P,O,k),Y!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,t.get(Y).buffer))}function l(){return i.createVertexArray()}function c(M){return i.bindVertexArray(M)}function h(M){return i.deleteVertexArray(M)}function d(M,P,O){const k=O.wireframe===!0;let Y=n[M.id];Y===void 0&&(Y={},n[M.id]=Y);let X=Y[P.id];X===void 0&&(X={},Y[P.id]=X);let q=X[k];return q===void 0&&(q=f(l()),X[k]=q),q}function f(M){const P=[],O=[],k=[];for(let Y=0;Y<e;Y++)P[Y]=0,O[Y]=0,k[Y]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:P,enabledAttributes:O,attributeDivisors:k,object:M,attributes:{},index:null}}function m(M,P,O,k){const Y=s.attributes,X=P.attributes;let q=0;const Z=O.getAttributes();for(const V in Z)if(Z[V].location>=0){const ut=Y[V];let yt=X[V];if(yt===void 0&&(V==="instanceMatrix"&&M.instanceMatrix&&(yt=M.instanceMatrix),V==="instanceColor"&&M.instanceColor&&(yt=M.instanceColor)),ut===void 0||ut.attribute!==yt||yt&&ut.data!==yt.data)return!0;q++}return s.attributesNum!==q||s.index!==k}function g(M,P,O,k){const Y={},X=P.attributes;let q=0;const Z=O.getAttributes();for(const V in Z)if(Z[V].location>=0){let ut=X[V];ut===void 0&&(V==="instanceMatrix"&&M.instanceMatrix&&(ut=M.instanceMatrix),V==="instanceColor"&&M.instanceColor&&(ut=M.instanceColor));const yt={};yt.attribute=ut,ut&&ut.data&&(yt.data=ut.data),Y[V]=yt,q++}s.attributes=Y,s.attributesNum=q,s.index=k}function x(){const M=s.newAttributes;for(let P=0,O=M.length;P<O;P++)M[P]=0}function p(M){u(M,0)}function u(M,P){const O=s.newAttributes,k=s.enabledAttributes,Y=s.attributeDivisors;O[M]=1,k[M]===0&&(i.enableVertexAttribArray(M),k[M]=1),Y[M]!==P&&(i.vertexAttribDivisor(M,P),Y[M]=P)}function b(){const M=s.newAttributes,P=s.enabledAttributes;for(let O=0,k=P.length;O<k;O++)P[O]!==M[O]&&(i.disableVertexAttribArray(O),P[O]=0)}function T(M,P,O,k,Y,X,q){q===!0?i.vertexAttribIPointer(M,P,O,Y,X):i.vertexAttribPointer(M,P,O,k,Y,X)}function E(M,P,O,k){x();const Y=k.attributes,X=O.getAttributes(),q=P.defaultAttributeValues;for(const Z in X){const V=X[Z];if(V.location>=0){let at=Y[Z];if(at===void 0&&(Z==="instanceMatrix"&&M.instanceMatrix&&(at=M.instanceMatrix),Z==="instanceColor"&&M.instanceColor&&(at=M.instanceColor)),at!==void 0){const ut=at.normalized,yt=at.itemSize,Ht=t.get(at);if(Ht===void 0)continue;const ee=Ht.buffer,re=Ht.type,$t=Ht.bytesPerElement,$=re===i.INT||re===i.UNSIGNED_INT||at.gpuType===Oa;if(at.isInterleavedBufferAttribute){const J=at.data,ft=J.stride,Dt=at.offset;if(J.isInstancedInterleavedBuffer){for(let Et=0;Et<V.locationSize;Et++)u(V.location+Et,J.meshPerAttribute);M.isInstancedMesh!==!0&&k._maxInstanceCount===void 0&&(k._maxInstanceCount=J.meshPerAttribute*J.count)}else for(let Et=0;Et<V.locationSize;Et++)p(V.location+Et);i.bindBuffer(i.ARRAY_BUFFER,ee);for(let Et=0;Et<V.locationSize;Et++)T(V.location+Et,yt/V.locationSize,re,ut,ft*$t,(Dt+yt/V.locationSize*Et)*$t,$)}else{if(at.isInstancedBufferAttribute){for(let J=0;J<V.locationSize;J++)u(V.location+J,at.meshPerAttribute);M.isInstancedMesh!==!0&&k._maxInstanceCount===void 0&&(k._maxInstanceCount=at.meshPerAttribute*at.count)}else for(let J=0;J<V.locationSize;J++)p(V.location+J);i.bindBuffer(i.ARRAY_BUFFER,ee);for(let J=0;J<V.locationSize;J++)T(V.location+J,yt/V.locationSize,re,ut,yt*$t,yt/V.locationSize*J*$t,$)}}else if(q!==void 0){const ut=q[Z];if(ut!==void 0)switch(ut.length){case 2:i.vertexAttrib2fv(V.location,ut);break;case 3:i.vertexAttrib3fv(V.location,ut);break;case 4:i.vertexAttrib4fv(V.location,ut);break;default:i.vertexAttrib1fv(V.location,ut)}}}}b()}function C(){U();for(const M in n){const P=n[M];for(const O in P){const k=P[O];for(const Y in k)h(k[Y].object),delete k[Y];delete P[O]}delete n[M]}}function w(M){if(n[M.id]===void 0)return;const P=n[M.id];for(const O in P){const k=P[O];for(const Y in k)h(k[Y].object),delete k[Y];delete P[O]}delete n[M.id]}function R(M){for(const P in n){const O=n[P];if(O[M.id]===void 0)continue;const k=O[M.id];for(const Y in k)h(k[Y].object),delete k[Y];delete O[M.id]}}function U(){S(),o=!0,s!==r&&(s=r,c(s.object))}function S(){r.geometry=null,r.program=null,r.wireframe=!1}return{setup:a,reset:U,resetDefaultState:S,dispose:C,releaseStatesOfGeometry:w,releaseStatesOfProgram:R,initAttributes:x,enableAttribute:p,disableUnusedAttributes:b}}function If(i,t,e){let n;function r(c){n=c}function s(c,h){i.drawArrays(n,c,h),e.update(h,n,1)}function o(c,h,d){d!==0&&(i.drawArraysInstanced(n,c,h,d),e.update(h,n,d))}function a(c,h,d){if(d===0)return;t.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,c,0,h,0,d);let m=0;for(let g=0;g<d;g++)m+=h[g];e.update(m,n,1)}function l(c,h,d,f){if(d===0)return;const m=t.get("WEBGL_multi_draw");if(m===null)for(let g=0;g<c.length;g++)o(c[g],h[g],f[g]);else{m.multiDrawArraysInstancedWEBGL(n,c,0,h,0,f,0,d);let g=0;for(let x=0;x<d;x++)g+=h[x]*f[x];e.update(g,n,1)}}this.setMode=r,this.render=s,this.renderInstances=o,this.renderMultiDraw=a,this.renderMultiDrawInstances=l}function Uf(i,t,e,n){let r;function s(){if(r!==void 0)return r;if(t.has("EXT_texture_filter_anisotropic")===!0){const R=t.get("EXT_texture_filter_anisotropic");r=i.getParameter(R.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else r=0;return r}function o(R){return!(R!==en&&n.convert(R)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(R){const U=R===dr&&(t.has("EXT_color_buffer_half_float")||t.has("EXT_color_buffer_float"));return!(R!==mn&&n.convert(R)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_TYPE)&&R!==fn&&!U)}function l(R){if(R==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";R="mediump"}return R==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=e.precision!==void 0?e.precision:"highp";const h=l(c);h!==c&&(console.warn("THREE.WebGLRenderer:",c,"not supported, using",h,"instead."),c=h);const d=e.logarithmicDepthBuffer===!0,f=e.reversedDepthBuffer===!0&&t.has("EXT_clip_control"),m=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),g=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),x=i.getParameter(i.MAX_TEXTURE_SIZE),p=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),u=i.getParameter(i.MAX_VERTEX_ATTRIBS),b=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),T=i.getParameter(i.MAX_VARYING_VECTORS),E=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),C=g>0,w=i.getParameter(i.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:c,logarithmicDepthBuffer:d,reversedDepthBuffer:f,maxTextures:m,maxVertexTextures:g,maxTextureSize:x,maxCubemapSize:p,maxAttributes:u,maxVertexUniforms:b,maxVaryings:T,maxFragmentUniforms:E,vertexTextures:C,maxSamples:w}}function Nf(i){const t=this;let e=null,n=0,r=!1,s=!1;const o=new ii,a=new Ft,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(d,f){const m=d.length!==0||f||n!==0||r;return r=f,n=d.length,m},this.beginShadows=function(){s=!0,h(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(d,f){e=h(d,f,0)},this.setState=function(d,f,m){const g=d.clippingPlanes,x=d.clipIntersection,p=d.clipShadows,u=i.get(d);if(!r||g===null||g.length===0||s&&!p)s?h(null):c();else{const b=s?0:n,T=b*4;let E=u.clippingState||null;l.value=E,E=h(g,f,T,m);for(let C=0;C!==T;++C)E[C]=e[C];u.clippingState=E,this.numIntersection=x?this.numPlanes:0,this.numPlanes+=b}};function c(){l.value!==e&&(l.value=e,l.needsUpdate=n>0),t.numPlanes=n,t.numIntersection=0}function h(d,f,m,g){const x=d!==null?d.length:0;let p=null;if(x!==0){if(p=l.value,g!==!0||p===null){const u=m+x*4,b=f.matrixWorldInverse;a.getNormalMatrix(b),(p===null||p.length<u)&&(p=new Float32Array(u));for(let T=0,E=m;T!==x;++T,E+=4)o.copy(d[T]).applyMatrix4(b,a),o.normal.toArray(p,E),p[E+3]=o.constant}l.value=p,l.needsUpdate=!0}return t.numPlanes=x,t.numIntersection=0,p}}function Ff(i){let t=new WeakMap;function e(o,a){return a===Js?o.mapping=ki:a===Qs&&(o.mapping=Vi),o}function n(o){if(o&&o.isTexture){const a=o.mapping;if(a===Js||a===Qs)if(t.has(o)){const l=t.get(o).texture;return e(l,o.mapping)}else{const l=o.image;if(l&&l.height>0){const c=new Cu(l.height);return c.fromEquirectangularTexture(i,o),t.set(o,c),o.addEventListener("dispose",r),e(c.texture,o.mapping)}else return null}}return o}function r(o){const a=o.target;a.removeEventListener("dispose",r);const l=t.get(a);l!==void 0&&(t.delete(a),l.dispose())}function s(){t=new WeakMap}return{get:n,dispose:s}}const Oi=4,Wo=[.125,.215,.35,.446,.526,.582],ai=20,Us=new Ja,Xo=new Vt;let Ns=null,Fs=0,Os=0,Bs=!1;const ri=(1+Math.sqrt(5))/2,Fi=1/ri,qo=[new F(-ri,Fi,0),new F(ri,Fi,0),new F(-Fi,0,ri),new F(Fi,0,ri),new F(0,ri,-Fi),new F(0,ri,Fi),new F(-1,1,-1),new F(1,1,-1),new F(-1,1,1),new F(1,1,1)],Of=new F;class Yo{constructor(t){this._renderer=t,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(t,e=0,n=.1,r=100,s={}){const{size:o=256,position:a=Of}=s;Ns=this._renderer.getRenderTarget(),Fs=this._renderer.getActiveCubeFace(),Os=this._renderer.getActiveMipmapLevel(),Bs=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);const l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(t,n,r,l,a),e>0&&this._blur(l,0,0,e),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(t,e=null){return this._fromTexture(t,e)}fromCubemap(t,e=null){return this._fromTexture(t,e)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=jo(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Ko(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(t){this._lodMax=Math.floor(Math.log2(t)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let t=0;t<this._lodPlanes.length;t++)this._lodPlanes[t].dispose()}_cleanup(t){this._renderer.setRenderTarget(Ns,Fs,Os),this._renderer.xr.enabled=Bs,t.scissorTest=!1,kr(t,0,0,t.width,t.height)}_fromTexture(t,e){t.mapping===ki||t.mapping===Vi?this._setSize(t.image.length===0?16:t.image[0].width||t.image[0].image.width):this._setSize(t.image.width/4),Ns=this._renderer.getRenderTarget(),Fs=this._renderer.getActiveCubeFace(),Os=this._renderer.getActiveMipmapLevel(),Bs=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const n=e||this._allocateTargets();return this._textureToCubeUV(t,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){const t=3*Math.max(this._cubeSize,112),e=4*this._cubeSize,n={magFilter:dn,minFilter:dn,generateMipmaps:!1,type:dr,format:en,colorSpace:Gi,depthBuffer:!1},r=$o(t,e,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==t||this._pingPongRenderTarget.height!==e){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=$o(t,e,n);const{_lodMax:s}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=Bf(s)),this._blurMaterial=zf(s,t,e)}return r}_compileMaterial(t){const e=new Ie(this._lodPlanes[0],t);this._renderer.compile(e,Us)}_sceneToCubeUV(t,e,n,r,s){const l=new Qe(90,1,e,n),c=[1,-1,1,1,1,1],h=[1,1,1,-1,-1,-1],d=this._renderer,f=d.autoClear,m=d.toneMapping;d.getClearColor(Xo),d.toneMapping=kn,d.autoClear=!1,d.state.buffers.depth.getReversed()&&(d.setRenderTarget(r),d.clearDepth(),d.setRenderTarget(null));const x=new Qr({name:"PMREM.Background",side:Oe,depthWrite:!1,depthTest:!1}),p=new Ie(new mi,x);let u=!1;const b=t.background;b?b.isColor&&(x.color.copy(b),t.background=null,u=!0):(x.color.copy(Xo),u=!0);for(let T=0;T<6;T++){const E=T%3;E===0?(l.up.set(0,c[T],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x+h[T],s.y,s.z)):E===1?(l.up.set(0,0,c[T]),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y+h[T],s.z)):(l.up.set(0,c[T],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y,s.z+h[T]));const C=this._cubeSize;kr(r,E*C,T>2?C:0,C,C),d.setRenderTarget(r),u&&d.render(p,l),d.render(t,l)}p.geometry.dispose(),p.material.dispose(),d.toneMapping=m,d.autoClear=f,t.background=b}_textureToCubeUV(t,e){const n=this._renderer,r=t.mapping===ki||t.mapping===Vi;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=jo()),this._cubemapMaterial.uniforms.flipEnvMap.value=t.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Ko());const s=r?this._cubemapMaterial:this._equirectMaterial,o=new Ie(this._lodPlanes[0],s),a=s.uniforms;a.envMap.value=t;const l=this._cubeSize;kr(e,0,0,3*l,2*l),n.setRenderTarget(e),n.render(o,Us)}_applyPMREM(t){const e=this._renderer,n=e.autoClear;e.autoClear=!1;const r=this._lodPlanes.length;for(let s=1;s<r;s++){const o=Math.sqrt(this._sigmas[s]*this._sigmas[s]-this._sigmas[s-1]*this._sigmas[s-1]),a=qo[(r-s-1)%qo.length];this._blur(t,s-1,s,o,a)}e.autoClear=n}_blur(t,e,n,r,s){const o=this._pingPongRenderTarget;this._halfBlur(t,o,e,n,r,"latitudinal",s),this._halfBlur(o,t,n,n,r,"longitudinal",s)}_halfBlur(t,e,n,r,s,o,a){const l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const h=3,d=new Ie(this._lodPlanes[r],c),f=c.uniforms,m=this._sizeLods[n]-1,g=isFinite(s)?Math.PI/(2*m):2*Math.PI/(2*ai-1),x=s/g,p=isFinite(s)?1+Math.floor(h*x):ai;p>ai&&console.warn(`sigmaRadians, ${s}, is too large and will clip, as it requested ${p} samples when the maximum is set to ${ai}`);const u=[];let b=0;for(let R=0;R<ai;++R){const U=R/x,S=Math.exp(-U*U/2);u.push(S),R===0?b+=S:R<p&&(b+=2*S)}for(let R=0;R<u.length;R++)u[R]=u[R]/b;f.envMap.value=t.texture,f.samples.value=p,f.weights.value=u,f.latitudinal.value=o==="latitudinal",a&&(f.poleAxis.value=a);const{_lodMax:T}=this;f.dTheta.value=g,f.mipInt.value=T-n;const E=this._sizeLods[r],C=3*E*(r>T-Oi?r-T+Oi:0),w=4*(this._cubeSize-E);kr(e,C,w,3*E,2*E),l.setRenderTarget(e),l.render(d,Us)}}function Bf(i){const t=[],e=[],n=[];let r=i;const s=i-Oi+1+Wo.length;for(let o=0;o<s;o++){const a=Math.pow(2,r);e.push(a);let l=1/a;o>i-Oi?l=Wo[o-i+Oi-1]:o===0&&(l=0),n.push(l);const c=1/(a-2),h=-c,d=1+c,f=[h,h,d,h,d,d,h,h,d,d,h,d],m=6,g=6,x=3,p=2,u=1,b=new Float32Array(x*g*m),T=new Float32Array(p*g*m),E=new Float32Array(u*g*m);for(let w=0;w<m;w++){const R=w%3*2/3-1,U=w>2?0:-1,S=[R,U,0,R+2/3,U,0,R+2/3,U+1,0,R,U,0,R+2/3,U+1,0,R,U+1,0];b.set(S,x*g*w),T.set(f,p*g*w);const M=[w,w,w,w,w,w];E.set(M,u*g*w)}const C=new rn;C.setAttribute("position",new Ke(b,x)),C.setAttribute("uv",new Ke(T,p)),C.setAttribute("faceIndex",new Ke(E,u)),t.push(C),r>Oi&&r--}return{lodPlanes:t,sizeLods:e,sigmas:n}}function $o(i,t,e){const n=new di(i,t,e);return n.texture.mapping=es,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function kr(i,t,e,n,r){i.viewport.set(t,e,n,r),i.scissor.set(t,e,n,r)}function zf(i,t,e){const n=new Float32Array(ai),r=new F(0,1,0);return new qn({name:"SphericalGaussianBlur",defines:{n:ai,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:r}},vertexShader:Qa(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Hn,depthTest:!1,depthWrite:!1})}function Ko(){return new qn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Qa(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Hn,depthTest:!1,depthWrite:!1})}function jo(){return new qn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Qa(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Hn,depthTest:!1,depthWrite:!1})}function Qa(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function Hf(i){let t=new WeakMap,e=null;function n(a){if(a&&a.isTexture){const l=a.mapping,c=l===Js||l===Qs,h=l===ki||l===Vi;if(c||h){let d=t.get(a);const f=d!==void 0?d.texture.pmremVersion:0;if(a.isRenderTargetTexture&&a.pmremVersion!==f)return e===null&&(e=new Yo(i)),d=c?e.fromEquirectangular(a,d):e.fromCubemap(a,d),d.texture.pmremVersion=a.pmremVersion,t.set(a,d),d.texture;if(d!==void 0)return d.texture;{const m=a.image;return c&&m&&m.height>0||h&&m&&r(m)?(e===null&&(e=new Yo(i)),d=c?e.fromEquirectangular(a):e.fromCubemap(a),d.texture.pmremVersion=a.pmremVersion,t.set(a,d),a.addEventListener("dispose",s),d.texture):null}}}return a}function r(a){let l=0;const c=6;for(let h=0;h<c;h++)a[h]!==void 0&&l++;return l===c}function s(a){const l=a.target;l.removeEventListener("dispose",s);const c=t.get(l);c!==void 0&&(t.delete(l),c.dispose())}function o(){t=new WeakMap,e!==null&&(e.dispose(),e=null)}return{get:n,dispose:o}}function kf(i){const t={};function e(n){if(t[n]!==void 0)return t[n];let r;switch(n){case"WEBGL_depth_texture":r=i.getExtension("WEBGL_depth_texture")||i.getExtension("MOZ_WEBGL_depth_texture")||i.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":r=i.getExtension("EXT_texture_filter_anisotropic")||i.getExtension("MOZ_EXT_texture_filter_anisotropic")||i.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":r=i.getExtension("WEBGL_compressed_texture_s3tc")||i.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":r=i.getExtension("WEBGL_compressed_texture_pvrtc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:r=i.getExtension(n)}return t[n]=r,r}return{has:function(n){return e(n)!==null},init:function(){e("EXT_color_buffer_float"),e("WEBGL_clip_cull_distance"),e("OES_texture_float_linear"),e("EXT_color_buffer_half_float"),e("WEBGL_multisampled_render_to_texture"),e("WEBGL_render_shared_exponent")},get:function(n){const r=e(n);return r===null&&hr("THREE.WebGLRenderer: "+n+" extension not supported."),r}}}function Vf(i,t,e,n){const r={},s=new WeakMap;function o(d){const f=d.target;f.index!==null&&t.remove(f.index);for(const g in f.attributes)t.remove(f.attributes[g]);f.removeEventListener("dispose",o),delete r[f.id];const m=s.get(f);m&&(t.remove(m),s.delete(f)),n.releaseStatesOfGeometry(f),f.isInstancedBufferGeometry===!0&&delete f._maxInstanceCount,e.memory.geometries--}function a(d,f){return r[f.id]===!0||(f.addEventListener("dispose",o),r[f.id]=!0,e.memory.geometries++),f}function l(d){const f=d.attributes;for(const m in f)t.update(f[m],i.ARRAY_BUFFER)}function c(d){const f=[],m=d.index,g=d.attributes.position;let x=0;if(m!==null){const b=m.array;x=m.version;for(let T=0,E=b.length;T<E;T+=3){const C=b[T+0],w=b[T+1],R=b[T+2];f.push(C,w,w,R,R,C)}}else if(g!==void 0){const b=g.array;x=g.version;for(let T=0,E=b.length/3-1;T<E;T+=3){const C=T+0,w=T+1,R=T+2;f.push(C,w,w,R,R,C)}}else return;const p=new(Nl(f)?Hl:zl)(f,1);p.version=x;const u=s.get(d);u&&t.remove(u),s.set(d,p)}function h(d){const f=s.get(d);if(f){const m=d.index;m!==null&&f.version<m.version&&c(d)}else c(d);return s.get(d)}return{get:a,update:l,getWireframeAttribute:h}}function Gf(i,t,e){let n;function r(f){n=f}let s,o;function a(f){s=f.type,o=f.bytesPerElement}function l(f,m){i.drawElements(n,m,s,f*o),e.update(m,n,1)}function c(f,m,g){g!==0&&(i.drawElementsInstanced(n,m,s,f*o,g),e.update(m,n,g))}function h(f,m,g){if(g===0)return;t.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,m,0,s,f,0,g);let p=0;for(let u=0;u<g;u++)p+=m[u];e.update(p,n,1)}function d(f,m,g,x){if(g===0)return;const p=t.get("WEBGL_multi_draw");if(p===null)for(let u=0;u<f.length;u++)c(f[u]/o,m[u],x[u]);else{p.multiDrawElementsInstancedWEBGL(n,m,0,s,f,0,x,0,g);let u=0;for(let b=0;b<g;b++)u+=m[b]*x[b];e.update(u,n,1)}}this.setMode=r,this.setIndex=a,this.render=l,this.renderInstances=c,this.renderMultiDraw=h,this.renderMultiDrawInstances=d}function Wf(i){const t={geometries:0,textures:0},e={frame:0,calls:0,triangles:0,points:0,lines:0};function n(s,o,a){switch(e.calls++,o){case i.TRIANGLES:e.triangles+=a*(s/3);break;case i.LINES:e.lines+=a*(s/2);break;case i.LINE_STRIP:e.lines+=a*(s-1);break;case i.LINE_LOOP:e.lines+=a*s;break;case i.POINTS:e.points+=a*s;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",o);break}}function r(){e.calls=0,e.triangles=0,e.points=0,e.lines=0}return{memory:t,render:e,programs:null,autoReset:!0,reset:r,update:n}}function Xf(i,t,e){const n=new WeakMap,r=new he;function s(o,a,l){const c=o.morphTargetInfluences,h=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,d=h!==void 0?h.length:0;let f=n.get(a);if(f===void 0||f.count!==d){let M=function(){U.dispose(),n.delete(a),a.removeEventListener("dispose",M)};var m=M;f!==void 0&&f.texture.dispose();const g=a.morphAttributes.position!==void 0,x=a.morphAttributes.normal!==void 0,p=a.morphAttributes.color!==void 0,u=a.morphAttributes.position||[],b=a.morphAttributes.normal||[],T=a.morphAttributes.color||[];let E=0;g===!0&&(E=1),x===!0&&(E=2),p===!0&&(E=3);let C=a.attributes.position.count*E,w=1;C>t.maxTextureSize&&(w=Math.ceil(C/t.maxTextureSize),C=t.maxTextureSize);const R=new Float32Array(C*w*4*d),U=new Fl(R,C,w,d);U.type=fn,U.needsUpdate=!0;const S=E*4;for(let P=0;P<d;P++){const O=u[P],k=b[P],Y=T[P],X=C*w*4*P;for(let q=0;q<O.count;q++){const Z=q*S;g===!0&&(r.fromBufferAttribute(O,q),R[X+Z+0]=r.x,R[X+Z+1]=r.y,R[X+Z+2]=r.z,R[X+Z+3]=0),x===!0&&(r.fromBufferAttribute(k,q),R[X+Z+4]=r.x,R[X+Z+5]=r.y,R[X+Z+6]=r.z,R[X+Z+7]=0),p===!0&&(r.fromBufferAttribute(Y,q),R[X+Z+8]=r.x,R[X+Z+9]=r.y,R[X+Z+10]=r.z,R[X+Z+11]=Y.itemSize===4?r.w:1)}}f={count:d,texture:U,size:new Ot(C,w)},n.set(a,f),a.addEventListener("dispose",M)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(i,"morphTexture",o.morphTexture,e);else{let g=0;for(let p=0;p<c.length;p++)g+=c[p];const x=a.morphTargetsRelative?1:1-g;l.getUniforms().setValue(i,"morphTargetBaseInfluence",x),l.getUniforms().setValue(i,"morphTargetInfluences",c)}l.getUniforms().setValue(i,"morphTargetsTexture",f.texture,e),l.getUniforms().setValue(i,"morphTargetsTextureSize",f.size)}return{update:s}}function qf(i,t,e,n){let r=new WeakMap;function s(l){const c=n.render.frame,h=l.geometry,d=t.get(l,h);if(r.get(d)!==c&&(t.update(d),r.set(d,c)),l.isInstancedMesh&&(l.hasEventListener("dispose",a)===!1&&l.addEventListener("dispose",a),r.get(l)!==c&&(e.update(l.instanceMatrix,i.ARRAY_BUFFER),l.instanceColor!==null&&e.update(l.instanceColor,i.ARRAY_BUFFER),r.set(l,c))),l.isSkinnedMesh){const f=l.skeleton;r.get(f)!==c&&(f.update(),r.set(f,c))}return d}function o(){r=new WeakMap}function a(l){const c=l.target;c.removeEventListener("dispose",a),e.remove(c.instanceMatrix),c.instanceColor!==null&&e.remove(c.instanceColor)}return{update:s,dispose:o}}const jl=new Te,Zo=new Yl(1,1),Zl=new Fl,Jl=new du,Ql=new Gl,Jo=[],Qo=[],tl=new Float32Array(16),el=new Float32Array(9),nl=new Float32Array(4);function Yi(i,t,e){const n=i[0];if(n<=0||n>0)return i;const r=t*e;let s=Jo[r];if(s===void 0&&(s=new Float32Array(r),Jo[r]=s),t!==0){n.toArray(s,0);for(let o=1,a=0;o!==t;++o)a+=e,i[o].toArray(s,a)}return s}function me(i,t){if(i.length!==t.length)return!1;for(let e=0,n=i.length;e<n;e++)if(i[e]!==t[e])return!1;return!0}function ge(i,t){for(let e=0,n=t.length;e<n;e++)i[e]=t[e]}function ns(i,t){let e=Qo[t];e===void 0&&(e=new Int32Array(t),Qo[t]=e);for(let n=0;n!==t;++n)e[n]=i.allocateTextureUnit();return e}function Yf(i,t){const e=this.cache;e[0]!==t&&(i.uniform1f(this.addr,t),e[0]=t)}function $f(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(i.uniform2f(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(me(e,t))return;i.uniform2fv(this.addr,t),ge(e,t)}}function Kf(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(i.uniform3f(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else if(t.r!==void 0)(e[0]!==t.r||e[1]!==t.g||e[2]!==t.b)&&(i.uniform3f(this.addr,t.r,t.g,t.b),e[0]=t.r,e[1]=t.g,e[2]=t.b);else{if(me(e,t))return;i.uniform3fv(this.addr,t),ge(e,t)}}function jf(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(i.uniform4f(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(me(e,t))return;i.uniform4fv(this.addr,t),ge(e,t)}}function Zf(i,t){const e=this.cache,n=t.elements;if(n===void 0){if(me(e,t))return;i.uniformMatrix2fv(this.addr,!1,t),ge(e,t)}else{if(me(e,n))return;nl.set(n),i.uniformMatrix2fv(this.addr,!1,nl),ge(e,n)}}function Jf(i,t){const e=this.cache,n=t.elements;if(n===void 0){if(me(e,t))return;i.uniformMatrix3fv(this.addr,!1,t),ge(e,t)}else{if(me(e,n))return;el.set(n),i.uniformMatrix3fv(this.addr,!1,el),ge(e,n)}}function Qf(i,t){const e=this.cache,n=t.elements;if(n===void 0){if(me(e,t))return;i.uniformMatrix4fv(this.addr,!1,t),ge(e,t)}else{if(me(e,n))return;tl.set(n),i.uniformMatrix4fv(this.addr,!1,tl),ge(e,n)}}function tp(i,t){const e=this.cache;e[0]!==t&&(i.uniform1i(this.addr,t),e[0]=t)}function ep(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(i.uniform2i(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(me(e,t))return;i.uniform2iv(this.addr,t),ge(e,t)}}function np(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(i.uniform3i(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(me(e,t))return;i.uniform3iv(this.addr,t),ge(e,t)}}function ip(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(i.uniform4i(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(me(e,t))return;i.uniform4iv(this.addr,t),ge(e,t)}}function rp(i,t){const e=this.cache;e[0]!==t&&(i.uniform1ui(this.addr,t),e[0]=t)}function sp(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(i.uniform2ui(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(me(e,t))return;i.uniform2uiv(this.addr,t),ge(e,t)}}function ap(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(i.uniform3ui(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(me(e,t))return;i.uniform3uiv(this.addr,t),ge(e,t)}}function op(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(i.uniform4ui(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(me(e,t))return;i.uniform4uiv(this.addr,t),ge(e,t)}}function lp(i,t,e){const n=this.cache,r=e.allocateTextureUnit();n[0]!==r&&(i.uniform1i(this.addr,r),n[0]=r);let s;this.type===i.SAMPLER_2D_SHADOW?(Zo.compareFunction=Ul,s=Zo):s=jl,e.setTexture2D(t||s,r)}function cp(i,t,e){const n=this.cache,r=e.allocateTextureUnit();n[0]!==r&&(i.uniform1i(this.addr,r),n[0]=r),e.setTexture3D(t||Jl,r)}function up(i,t,e){const n=this.cache,r=e.allocateTextureUnit();n[0]!==r&&(i.uniform1i(this.addr,r),n[0]=r),e.setTextureCube(t||Ql,r)}function hp(i,t,e){const n=this.cache,r=e.allocateTextureUnit();n[0]!==r&&(i.uniform1i(this.addr,r),n[0]=r),e.setTexture2DArray(t||Zl,r)}function dp(i){switch(i){case 5126:return Yf;case 35664:return $f;case 35665:return Kf;case 35666:return jf;case 35674:return Zf;case 35675:return Jf;case 35676:return Qf;case 5124:case 35670:return tp;case 35667:case 35671:return ep;case 35668:case 35672:return np;case 35669:case 35673:return ip;case 5125:return rp;case 36294:return sp;case 36295:return ap;case 36296:return op;case 35678:case 36198:case 36298:case 36306:case 35682:return lp;case 35679:case 36299:case 36307:return cp;case 35680:case 36300:case 36308:case 36293:return up;case 36289:case 36303:case 36311:case 36292:return hp}}function fp(i,t){i.uniform1fv(this.addr,t)}function pp(i,t){const e=Yi(t,this.size,2);i.uniform2fv(this.addr,e)}function mp(i,t){const e=Yi(t,this.size,3);i.uniform3fv(this.addr,e)}function gp(i,t){const e=Yi(t,this.size,4);i.uniform4fv(this.addr,e)}function _p(i,t){const e=Yi(t,this.size,4);i.uniformMatrix2fv(this.addr,!1,e)}function vp(i,t){const e=Yi(t,this.size,9);i.uniformMatrix3fv(this.addr,!1,e)}function xp(i,t){const e=Yi(t,this.size,16);i.uniformMatrix4fv(this.addr,!1,e)}function Mp(i,t){i.uniform1iv(this.addr,t)}function Sp(i,t){i.uniform2iv(this.addr,t)}function Ep(i,t){i.uniform3iv(this.addr,t)}function yp(i,t){i.uniform4iv(this.addr,t)}function bp(i,t){i.uniform1uiv(this.addr,t)}function Tp(i,t){i.uniform2uiv(this.addr,t)}function Ap(i,t){i.uniform3uiv(this.addr,t)}function wp(i,t){i.uniform4uiv(this.addr,t)}function Rp(i,t,e){const n=this.cache,r=t.length,s=ns(e,r);me(n,s)||(i.uniform1iv(this.addr,s),ge(n,s));for(let o=0;o!==r;++o)e.setTexture2D(t[o]||jl,s[o])}function Cp(i,t,e){const n=this.cache,r=t.length,s=ns(e,r);me(n,s)||(i.uniform1iv(this.addr,s),ge(n,s));for(let o=0;o!==r;++o)e.setTexture3D(t[o]||Jl,s[o])}function Pp(i,t,e){const n=this.cache,r=t.length,s=ns(e,r);me(n,s)||(i.uniform1iv(this.addr,s),ge(n,s));for(let o=0;o!==r;++o)e.setTextureCube(t[o]||Ql,s[o])}function Dp(i,t,e){const n=this.cache,r=t.length,s=ns(e,r);me(n,s)||(i.uniform1iv(this.addr,s),ge(n,s));for(let o=0;o!==r;++o)e.setTexture2DArray(t[o]||Zl,s[o])}function Lp(i){switch(i){case 5126:return fp;case 35664:return pp;case 35665:return mp;case 35666:return gp;case 35674:return _p;case 35675:return vp;case 35676:return xp;case 5124:case 35670:return Mp;case 35667:case 35671:return Sp;case 35668:case 35672:return Ep;case 35669:case 35673:return yp;case 5125:return bp;case 36294:return Tp;case 36295:return Ap;case 36296:return wp;case 35678:case 36198:case 36298:case 36306:case 35682:return Rp;case 35679:case 36299:case 36307:return Cp;case 35680:case 36300:case 36308:case 36293:return Pp;case 36289:case 36303:case 36311:case 36292:return Dp}}class Ip{constructor(t,e,n){this.id=t,this.addr=n,this.cache=[],this.type=e.type,this.setValue=dp(e.type)}}class Up{constructor(t,e,n){this.id=t,this.addr=n,this.cache=[],this.type=e.type,this.size=e.size,this.setValue=Lp(e.type)}}class Np{constructor(t){this.id=t,this.seq=[],this.map={}}setValue(t,e,n){const r=this.seq;for(let s=0,o=r.length;s!==o;++s){const a=r[s];a.setValue(t,e[a.id],n)}}}const zs=/(\w+)(\])?(\[|\.)?/g;function il(i,t){i.seq.push(t),i.map[t.id]=t}function Fp(i,t,e){const n=i.name,r=n.length;for(zs.lastIndex=0;;){const s=zs.exec(n),o=zs.lastIndex;let a=s[1];const l=s[2]==="]",c=s[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===r){il(e,c===void 0?new Ip(a,i,t):new Up(a,i,t));break}else{let d=e.map[a];d===void 0&&(d=new Np(a),il(e,d)),e=d}}}class $r{constructor(t,e){this.seq=[],this.map={};const n=t.getProgramParameter(e,t.ACTIVE_UNIFORMS);for(let r=0;r<n;++r){const s=t.getActiveUniform(e,r),o=t.getUniformLocation(e,s.name);Fp(s,o,this)}}setValue(t,e,n,r){const s=this.map[e];s!==void 0&&s.setValue(t,n,r)}setOptional(t,e,n){const r=e[n];r!==void 0&&this.setValue(t,n,r)}static upload(t,e,n,r){for(let s=0,o=e.length;s!==o;++s){const a=e[s],l=n[a.id];l.needsUpdate!==!1&&a.setValue(t,l.value,r)}}static seqWithValue(t,e){const n=[];for(let r=0,s=t.length;r!==s;++r){const o=t[r];o.id in e&&n.push(o)}return n}}function rl(i,t,e){const n=i.createShader(t);return i.shaderSource(n,e),i.compileShader(n),n}const Op=37297;let Bp=0;function zp(i,t){const e=i.split(`
`),n=[],r=Math.max(t-6,0),s=Math.min(t+6,e.length);for(let o=r;o<s;o++){const a=o+1;n.push(`${a===t?">":" "} ${a}: ${e[o]}`)}return n.join(`
`)}const sl=new Ft;function Hp(i){Yt._getMatrix(sl,Yt.workingColorSpace,i);const t=`mat3( ${sl.elements.map(e=>e.toFixed(4))} )`;switch(Yt.getTransfer(i)){case jr:return[t,"LinearTransferOETF"];case Zt:return[t,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space: ",i),[t,"LinearTransferOETF"]}}function al(i,t,e){const n=i.getShaderParameter(t,i.COMPILE_STATUS),s=(i.getShaderInfoLog(t)||"").trim();if(n&&s==="")return"";const o=/ERROR: 0:(\d+)/.exec(s);if(o){const a=parseInt(o[1]);return e.toUpperCase()+`

`+s+`

`+zp(i.getShaderSource(t),a)}else return s}function kp(i,t){const e=Hp(t);return[`vec4 ${i}( vec4 value ) {`,`	return ${e[1]}( vec4( value.rgb * ${e[0]}, value.a ) );`,"}"].join(`
`)}function Vp(i,t){let e;switch(t){case kc:e="Linear";break;case Vc:e="Reinhard";break;case Gc:e="Cineon";break;case yl:e="ACESFilmic";break;case Xc:e="AgX";break;case qc:e="Neutral";break;case Wc:e="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",t),e="Linear"}return"vec3 "+i+"( vec3 color ) { return "+e+"ToneMapping( color ); }"}const Vr=new F;function Gp(){Yt.getLuminanceCoefficients(Vr);const i=Vr.x.toFixed(4),t=Vr.y.toFixed(4),e=Vr.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${i}, ${t}, ${e} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Wp(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",i.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(sr).join(`
`)}function Xp(i){const t=[];for(const e in i){const n=i[e];n!==!1&&t.push("#define "+e+" "+n)}return t.join(`
`)}function qp(i,t){const e={},n=i.getProgramParameter(t,i.ACTIVE_ATTRIBUTES);for(let r=0;r<n;r++){const s=i.getActiveAttrib(t,r),o=s.name;let a=1;s.type===i.FLOAT_MAT2&&(a=2),s.type===i.FLOAT_MAT3&&(a=3),s.type===i.FLOAT_MAT4&&(a=4),e[o]={type:s.type,location:i.getAttribLocation(t,o),locationSize:a}}return e}function sr(i){return i!==""}function ol(i,t){const e=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return i.replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,e).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function ll(i,t){return i.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}const Yp=/^[ \t]*#include +<([\w\d./]+)>/gm;function La(i){return i.replace(Yp,Kp)}const $p=new Map;function Kp(i,t){let e=zt[t];if(e===void 0){const n=$p.get(t);if(n!==void 0)e=zt[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',t,n);else throw new Error("Can not resolve #include <"+t+">")}return La(e)}const jp=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function cl(i){return i.replace(jp,Zp)}function Zp(i,t,e,n){let r="";for(let s=parseInt(t);s<parseInt(e);s++)r+=n.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return r}function ul(i){let t=`precision ${i.precision} float;
	precision ${i.precision} int;
	precision ${i.precision} sampler2D;
	precision ${i.precision} samplerCube;
	precision ${i.precision} sampler3D;
	precision ${i.precision} sampler2DArray;
	precision ${i.precision} sampler2DShadow;
	precision ${i.precision} samplerCubeShadow;
	precision ${i.precision} sampler2DArrayShadow;
	precision ${i.precision} isampler2D;
	precision ${i.precision} isampler3D;
	precision ${i.precision} isamplerCube;
	precision ${i.precision} isampler2DArray;
	precision ${i.precision} usampler2D;
	precision ${i.precision} usampler3D;
	precision ${i.precision} usamplerCube;
	precision ${i.precision} usampler2DArray;
	`;return i.precision==="highp"?t+=`
#define HIGH_PRECISION`:i.precision==="mediump"?t+=`
#define MEDIUM_PRECISION`:i.precision==="lowp"&&(t+=`
#define LOW_PRECISION`),t}function Jp(i){let t="SHADOWMAP_TYPE_BASIC";return i.shadowMapType===Ml?t="SHADOWMAP_TYPE_PCF":i.shadowMapType===Sl?t="SHADOWMAP_TYPE_PCF_SOFT":i.shadowMapType===bn&&(t="SHADOWMAP_TYPE_VSM"),t}function Qp(i){let t="ENVMAP_TYPE_CUBE";if(i.envMap)switch(i.envMapMode){case ki:case Vi:t="ENVMAP_TYPE_CUBE";break;case es:t="ENVMAP_TYPE_CUBE_UV";break}return t}function tm(i){let t="ENVMAP_MODE_REFLECTION";return i.envMap&&i.envMapMode===Vi&&(t="ENVMAP_MODE_REFRACTION"),t}function em(i){let t="ENVMAP_BLENDING_NONE";if(i.envMap)switch(i.combine){case El:t="ENVMAP_BLENDING_MULTIPLY";break;case zc:t="ENVMAP_BLENDING_MIX";break;case Hc:t="ENVMAP_BLENDING_ADD";break}return t}function nm(i){const t=i.envMapCubeUVHeight;if(t===null)return null;const e=Math.log2(t)-2,n=1/t;return{texelWidth:1/(3*Math.max(Math.pow(2,e),112)),texelHeight:n,maxMip:e}}function im(i,t,e,n){const r=i.getContext(),s=e.defines;let o=e.vertexShader,a=e.fragmentShader;const l=Jp(e),c=Qp(e),h=tm(e),d=em(e),f=nm(e),m=Wp(e),g=Xp(s),x=r.createProgram();let p,u,b=e.glslVersion?"#version "+e.glslVersion+`
`:"";e.isRawShaderMaterial?(p=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g].filter(sr).join(`
`),p.length>0&&(p+=`
`),u=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g].filter(sr).join(`
`),u.length>0&&(u+=`
`)):(p=[ul(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g,e.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",e.batching?"#define USE_BATCHING":"",e.batchingColor?"#define USE_BATCHING_COLOR":"",e.instancing?"#define USE_INSTANCING":"",e.instancingColor?"#define USE_INSTANCING_COLOR":"",e.instancingMorph?"#define USE_INSTANCING_MORPH":"",e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.map?"#define USE_MAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+h:"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.displacementMap?"#define USE_DISPLACEMENTMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.mapUv?"#define MAP_UV "+e.mapUv:"",e.alphaMapUv?"#define ALPHAMAP_UV "+e.alphaMapUv:"",e.lightMapUv?"#define LIGHTMAP_UV "+e.lightMapUv:"",e.aoMapUv?"#define AOMAP_UV "+e.aoMapUv:"",e.emissiveMapUv?"#define EMISSIVEMAP_UV "+e.emissiveMapUv:"",e.bumpMapUv?"#define BUMPMAP_UV "+e.bumpMapUv:"",e.normalMapUv?"#define NORMALMAP_UV "+e.normalMapUv:"",e.displacementMapUv?"#define DISPLACEMENTMAP_UV "+e.displacementMapUv:"",e.metalnessMapUv?"#define METALNESSMAP_UV "+e.metalnessMapUv:"",e.roughnessMapUv?"#define ROUGHNESSMAP_UV "+e.roughnessMapUv:"",e.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+e.anisotropyMapUv:"",e.clearcoatMapUv?"#define CLEARCOATMAP_UV "+e.clearcoatMapUv:"",e.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+e.clearcoatNormalMapUv:"",e.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+e.clearcoatRoughnessMapUv:"",e.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+e.iridescenceMapUv:"",e.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+e.iridescenceThicknessMapUv:"",e.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+e.sheenColorMapUv:"",e.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+e.sheenRoughnessMapUv:"",e.specularMapUv?"#define SPECULARMAP_UV "+e.specularMapUv:"",e.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+e.specularColorMapUv:"",e.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+e.specularIntensityMapUv:"",e.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+e.transmissionMapUv:"",e.thicknessMapUv?"#define THICKNESSMAP_UV "+e.thicknessMapUv:"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.flatShading?"#define FLAT_SHADED":"",e.skinning?"#define USE_SKINNING":"",e.morphTargets?"#define USE_MORPHTARGETS":"",e.morphNormals&&e.flatShading===!1?"#define USE_MORPHNORMALS":"",e.morphColors?"#define USE_MORPHCOLORS":"",e.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+e.morphTextureStride:"",e.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+e.morphTargetsCount:"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.sizeAttenuation?"#define USE_SIZEATTENUATION":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(sr).join(`
`),u=[ul(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g,e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",e.map?"#define USE_MAP":"",e.matcap?"#define USE_MATCAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+c:"",e.envMap?"#define "+h:"",e.envMap?"#define "+d:"",f?"#define CUBEUV_TEXEL_WIDTH "+f.texelWidth:"",f?"#define CUBEUV_TEXEL_HEIGHT "+f.texelHeight:"",f?"#define CUBEUV_MAX_MIP "+f.maxMip+".0":"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoat?"#define USE_CLEARCOAT":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.dispersion?"#define USE_DISPERSION":"",e.iridescence?"#define USE_IRIDESCENCE":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaTest?"#define USE_ALPHATEST":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.sheen?"#define USE_SHEEN":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors||e.instancingColor||e.batchingColor?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.gradientMap?"#define USE_GRADIENTMAP":"",e.flatShading?"#define FLAT_SHADED":"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",e.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",e.toneMapping!==kn?"#define TONE_MAPPING":"",e.toneMapping!==kn?zt.tonemapping_pars_fragment:"",e.toneMapping!==kn?Vp("toneMapping",e.toneMapping):"",e.dithering?"#define DITHERING":"",e.opaque?"#define OPAQUE":"",zt.colorspace_pars_fragment,kp("linearToOutputTexel",e.outputColorSpace),Gp(),e.useDepthPacking?"#define DEPTH_PACKING "+e.depthPacking:"",`
`].filter(sr).join(`
`)),o=La(o),o=ol(o,e),o=ll(o,e),a=La(a),a=ol(a,e),a=ll(a,e),o=cl(o),a=cl(a),e.isRawShaderMaterial!==!0&&(b=`#version 300 es
`,p=[m,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+p,u=["#define varying in",e.glslVersion===go?"":"layout(location = 0) out highp vec4 pc_fragColor;",e.glslVersion===go?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+u);const T=b+p+o,E=b+u+a,C=rl(r,r.VERTEX_SHADER,T),w=rl(r,r.FRAGMENT_SHADER,E);r.attachShader(x,C),r.attachShader(x,w),e.index0AttributeName!==void 0?r.bindAttribLocation(x,0,e.index0AttributeName):e.morphTargets===!0&&r.bindAttribLocation(x,0,"position"),r.linkProgram(x);function R(P){if(i.debug.checkShaderErrors){const O=r.getProgramInfoLog(x)||"",k=r.getShaderInfoLog(C)||"",Y=r.getShaderInfoLog(w)||"",X=O.trim(),q=k.trim(),Z=Y.trim();let V=!0,at=!0;if(r.getProgramParameter(x,r.LINK_STATUS)===!1)if(V=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(r,x,C,w);else{const ut=al(r,C,"vertex"),yt=al(r,w,"fragment");console.error("THREE.WebGLProgram: Shader Error "+r.getError()+" - VALIDATE_STATUS "+r.getProgramParameter(x,r.VALIDATE_STATUS)+`

Material Name: `+P.name+`
Material Type: `+P.type+`

Program Info Log: `+X+`
`+ut+`
`+yt)}else X!==""?console.warn("THREE.WebGLProgram: Program Info Log:",X):(q===""||Z==="")&&(at=!1);at&&(P.diagnostics={runnable:V,programLog:X,vertexShader:{log:q,prefix:p},fragmentShader:{log:Z,prefix:u}})}r.deleteShader(C),r.deleteShader(w),U=new $r(r,x),S=qp(r,x)}let U;this.getUniforms=function(){return U===void 0&&R(this),U};let S;this.getAttributes=function(){return S===void 0&&R(this),S};let M=e.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return M===!1&&(M=r.getProgramParameter(x,Op)),M},this.destroy=function(){n.releaseStatesOfProgram(this),r.deleteProgram(x),this.program=void 0},this.type=e.shaderType,this.name=e.shaderName,this.id=Bp++,this.cacheKey=t,this.usedTimes=1,this.program=x,this.vertexShader=C,this.fragmentShader=w,this}let rm=0;class sm{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(t){const e=t.vertexShader,n=t.fragmentShader,r=this._getShaderStage(e),s=this._getShaderStage(n),o=this._getShaderCacheForMaterial(t);return o.has(r)===!1&&(o.add(r),r.usedTimes++),o.has(s)===!1&&(o.add(s),s.usedTimes++),this}remove(t){const e=this.materialCache.get(t);for(const n of e)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(t),this}getVertexShaderID(t){return this._getShaderStage(t.vertexShader).id}getFragmentShaderID(t){return this._getShaderStage(t.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(t){const e=this.materialCache;let n=e.get(t);return n===void 0&&(n=new Set,e.set(t,n)),n}_getShaderStage(t){const e=this.shaderCache;let n=e.get(t);return n===void 0&&(n=new am(t),e.set(t,n)),n}}class am{constructor(t){this.id=rm++,this.code=t,this.usedTimes=0}}function om(i,t,e,n,r,s,o){const a=new Xa,l=new sm,c=new Set,h=[],d=r.logarithmicDepthBuffer,f=r.vertexTextures;let m=r.precision;const g={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function x(S){return c.add(S),S===0?"uv":`uv${S}`}function p(S,M,P,O,k){const Y=O.fog,X=k.geometry,q=S.isMeshStandardMaterial?O.environment:null,Z=(S.isMeshStandardMaterial?e:t).get(S.envMap||q),V=Z&&Z.mapping===es?Z.image.height:null,at=g[S.type];S.precision!==null&&(m=r.getMaxPrecision(S.precision),m!==S.precision&&console.warn("THREE.WebGLProgram.getParameters:",S.precision,"not supported, using",m,"instead."));const ut=X.morphAttributes.position||X.morphAttributes.normal||X.morphAttributes.color,yt=ut!==void 0?ut.length:0;let Ht=0;X.morphAttributes.position!==void 0&&(Ht=1),X.morphAttributes.normal!==void 0&&(Ht=2),X.morphAttributes.color!==void 0&&(Ht=3);let ee,re,$t,$;if(at){const Kt=cn[at];ee=Kt.vertexShader,re=Kt.fragmentShader}else ee=S.vertexShader,re=S.fragmentShader,l.update(S),$t=l.getVertexShaderID(S),$=l.getFragmentShaderID(S);const J=i.getRenderTarget(),ft=i.state.buffers.depth.getReversed(),Dt=k.isInstancedMesh===!0,Et=k.isBatchedMesh===!0,Xt=!!S.map,Me=!!S.matcap,A=!!Z,se=!!S.aoMap,Ut=!!S.lightMap,Ct=!!S.bumpMap,gt=!!S.normalMap,ae=!!S.displacementMap,_t=!!S.emissiveMap,Bt=!!S.metalnessMap,ve=!!S.roughnessMap,de=S.anisotropy>0,y=S.clearcoat>0,_=S.dispersion>0,N=S.iridescence>0,W=S.sheen>0,j=S.transmission>0,G=de&&!!S.anisotropyMap,St=y&&!!S.clearcoatMap,it=y&&!!S.clearcoatNormalMap,vt=y&&!!S.clearcoatRoughnessMap,xt=N&&!!S.iridescenceMap,et=N&&!!S.iridescenceThicknessMap,ct=W&&!!S.sheenColorMap,Rt=W&&!!S.sheenRoughnessMap,Mt=!!S.specularMap,ot=!!S.specularColorMap,Nt=!!S.specularIntensityMap,D=j&&!!S.transmissionMap,nt=j&&!!S.thicknessMap,rt=!!S.gradientMap,dt=!!S.alphaMap,Q=S.alphaTest>0,K=!!S.alphaHash,mt=!!S.extensions;let It=kn;S.toneMapped&&(J===null||J.isXRRenderTarget===!0)&&(It=i.toneMapping);const ne={shaderID:at,shaderType:S.type,shaderName:S.name,vertexShader:ee,fragmentShader:re,defines:S.defines,customVertexShaderID:$t,customFragmentShaderID:$,isRawShaderMaterial:S.isRawShaderMaterial===!0,glslVersion:S.glslVersion,precision:m,batching:Et,batchingColor:Et&&k._colorsTexture!==null,instancing:Dt,instancingColor:Dt&&k.instanceColor!==null,instancingMorph:Dt&&k.morphTexture!==null,supportsVertexTextures:f,outputColorSpace:J===null?i.outputColorSpace:J.isXRRenderTarget===!0?J.texture.colorSpace:Gi,alphaToCoverage:!!S.alphaToCoverage,map:Xt,matcap:Me,envMap:A,envMapMode:A&&Z.mapping,envMapCubeUVHeight:V,aoMap:se,lightMap:Ut,bumpMap:Ct,normalMap:gt,displacementMap:f&&ae,emissiveMap:_t,normalMapObjectSpace:gt&&S.normalMapType===Kc,normalMapTangentSpace:gt&&S.normalMapType===Il,metalnessMap:Bt,roughnessMap:ve,anisotropy:de,anisotropyMap:G,clearcoat:y,clearcoatMap:St,clearcoatNormalMap:it,clearcoatRoughnessMap:vt,dispersion:_,iridescence:N,iridescenceMap:xt,iridescenceThicknessMap:et,sheen:W,sheenColorMap:ct,sheenRoughnessMap:Rt,specularMap:Mt,specularColorMap:ot,specularIntensityMap:Nt,transmission:j,transmissionMap:D,thicknessMap:nt,gradientMap:rt,opaque:S.transparent===!1&&S.blending===Bi&&S.alphaToCoverage===!1,alphaMap:dt,alphaTest:Q,alphaHash:K,combine:S.combine,mapUv:Xt&&x(S.map.channel),aoMapUv:se&&x(S.aoMap.channel),lightMapUv:Ut&&x(S.lightMap.channel),bumpMapUv:Ct&&x(S.bumpMap.channel),normalMapUv:gt&&x(S.normalMap.channel),displacementMapUv:ae&&x(S.displacementMap.channel),emissiveMapUv:_t&&x(S.emissiveMap.channel),metalnessMapUv:Bt&&x(S.metalnessMap.channel),roughnessMapUv:ve&&x(S.roughnessMap.channel),anisotropyMapUv:G&&x(S.anisotropyMap.channel),clearcoatMapUv:St&&x(S.clearcoatMap.channel),clearcoatNormalMapUv:it&&x(S.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:vt&&x(S.clearcoatRoughnessMap.channel),iridescenceMapUv:xt&&x(S.iridescenceMap.channel),iridescenceThicknessMapUv:et&&x(S.iridescenceThicknessMap.channel),sheenColorMapUv:ct&&x(S.sheenColorMap.channel),sheenRoughnessMapUv:Rt&&x(S.sheenRoughnessMap.channel),specularMapUv:Mt&&x(S.specularMap.channel),specularColorMapUv:ot&&x(S.specularColorMap.channel),specularIntensityMapUv:Nt&&x(S.specularIntensityMap.channel),transmissionMapUv:D&&x(S.transmissionMap.channel),thicknessMapUv:nt&&x(S.thicknessMap.channel),alphaMapUv:dt&&x(S.alphaMap.channel),vertexTangents:!!X.attributes.tangent&&(gt||de),vertexColors:S.vertexColors,vertexAlphas:S.vertexColors===!0&&!!X.attributes.color&&X.attributes.color.itemSize===4,pointsUvs:k.isPoints===!0&&!!X.attributes.uv&&(Xt||dt),fog:!!Y,useFog:S.fog===!0,fogExp2:!!Y&&Y.isFogExp2,flatShading:S.flatShading===!0&&S.wireframe===!1,sizeAttenuation:S.sizeAttenuation===!0,logarithmicDepthBuffer:d,reversedDepthBuffer:ft,skinning:k.isSkinnedMesh===!0,morphTargets:X.morphAttributes.position!==void 0,morphNormals:X.morphAttributes.normal!==void 0,morphColors:X.morphAttributes.color!==void 0,morphTargetsCount:yt,morphTextureStride:Ht,numDirLights:M.directional.length,numPointLights:M.point.length,numSpotLights:M.spot.length,numSpotLightMaps:M.spotLightMap.length,numRectAreaLights:M.rectArea.length,numHemiLights:M.hemi.length,numDirLightShadows:M.directionalShadowMap.length,numPointLightShadows:M.pointShadowMap.length,numSpotLightShadows:M.spotShadowMap.length,numSpotLightShadowsWithMaps:M.numSpotLightShadowsWithMaps,numLightProbes:M.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:S.dithering,shadowMapEnabled:i.shadowMap.enabled&&P.length>0,shadowMapType:i.shadowMap.type,toneMapping:It,decodeVideoTexture:Xt&&S.map.isVideoTexture===!0&&Yt.getTransfer(S.map.colorSpace)===Zt,decodeVideoTextureEmissive:_t&&S.emissiveMap.isVideoTexture===!0&&Yt.getTransfer(S.emissiveMap.colorSpace)===Zt,premultipliedAlpha:S.premultipliedAlpha,doubleSided:S.side===un,flipSided:S.side===Oe,useDepthPacking:S.depthPacking>=0,depthPacking:S.depthPacking||0,index0AttributeName:S.index0AttributeName,extensionClipCullDistance:mt&&S.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(mt&&S.extensions.multiDraw===!0||Et)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:S.customProgramCacheKey()};return ne.vertexUv1s=c.has(1),ne.vertexUv2s=c.has(2),ne.vertexUv3s=c.has(3),c.clear(),ne}function u(S){const M=[];if(S.shaderID?M.push(S.shaderID):(M.push(S.customVertexShaderID),M.push(S.customFragmentShaderID)),S.defines!==void 0)for(const P in S.defines)M.push(P),M.push(S.defines[P]);return S.isRawShaderMaterial===!1&&(b(M,S),T(M,S),M.push(i.outputColorSpace)),M.push(S.customProgramCacheKey),M.join()}function b(S,M){S.push(M.precision),S.push(M.outputColorSpace),S.push(M.envMapMode),S.push(M.envMapCubeUVHeight),S.push(M.mapUv),S.push(M.alphaMapUv),S.push(M.lightMapUv),S.push(M.aoMapUv),S.push(M.bumpMapUv),S.push(M.normalMapUv),S.push(M.displacementMapUv),S.push(M.emissiveMapUv),S.push(M.metalnessMapUv),S.push(M.roughnessMapUv),S.push(M.anisotropyMapUv),S.push(M.clearcoatMapUv),S.push(M.clearcoatNormalMapUv),S.push(M.clearcoatRoughnessMapUv),S.push(M.iridescenceMapUv),S.push(M.iridescenceThicknessMapUv),S.push(M.sheenColorMapUv),S.push(M.sheenRoughnessMapUv),S.push(M.specularMapUv),S.push(M.specularColorMapUv),S.push(M.specularIntensityMapUv),S.push(M.transmissionMapUv),S.push(M.thicknessMapUv),S.push(M.combine),S.push(M.fogExp2),S.push(M.sizeAttenuation),S.push(M.morphTargetsCount),S.push(M.morphAttributeCount),S.push(M.numDirLights),S.push(M.numPointLights),S.push(M.numSpotLights),S.push(M.numSpotLightMaps),S.push(M.numHemiLights),S.push(M.numRectAreaLights),S.push(M.numDirLightShadows),S.push(M.numPointLightShadows),S.push(M.numSpotLightShadows),S.push(M.numSpotLightShadowsWithMaps),S.push(M.numLightProbes),S.push(M.shadowMapType),S.push(M.toneMapping),S.push(M.numClippingPlanes),S.push(M.numClipIntersection),S.push(M.depthPacking)}function T(S,M){a.disableAll(),M.supportsVertexTextures&&a.enable(0),M.instancing&&a.enable(1),M.instancingColor&&a.enable(2),M.instancingMorph&&a.enable(3),M.matcap&&a.enable(4),M.envMap&&a.enable(5),M.normalMapObjectSpace&&a.enable(6),M.normalMapTangentSpace&&a.enable(7),M.clearcoat&&a.enable(8),M.iridescence&&a.enable(9),M.alphaTest&&a.enable(10),M.vertexColors&&a.enable(11),M.vertexAlphas&&a.enable(12),M.vertexUv1s&&a.enable(13),M.vertexUv2s&&a.enable(14),M.vertexUv3s&&a.enable(15),M.vertexTangents&&a.enable(16),M.anisotropy&&a.enable(17),M.alphaHash&&a.enable(18),M.batching&&a.enable(19),M.dispersion&&a.enable(20),M.batchingColor&&a.enable(21),M.gradientMap&&a.enable(22),S.push(a.mask),a.disableAll(),M.fog&&a.enable(0),M.useFog&&a.enable(1),M.flatShading&&a.enable(2),M.logarithmicDepthBuffer&&a.enable(3),M.reversedDepthBuffer&&a.enable(4),M.skinning&&a.enable(5),M.morphTargets&&a.enable(6),M.morphNormals&&a.enable(7),M.morphColors&&a.enable(8),M.premultipliedAlpha&&a.enable(9),M.shadowMapEnabled&&a.enable(10),M.doubleSided&&a.enable(11),M.flipSided&&a.enable(12),M.useDepthPacking&&a.enable(13),M.dithering&&a.enable(14),M.transmission&&a.enable(15),M.sheen&&a.enable(16),M.opaque&&a.enable(17),M.pointsUvs&&a.enable(18),M.decodeVideoTexture&&a.enable(19),M.decodeVideoTextureEmissive&&a.enable(20),M.alphaToCoverage&&a.enable(21),S.push(a.mask)}function E(S){const M=g[S.type];let P;if(M){const O=cn[M];P=Tu.clone(O.uniforms)}else P=S.uniforms;return P}function C(S,M){let P;for(let O=0,k=h.length;O<k;O++){const Y=h[O];if(Y.cacheKey===M){P=Y,++P.usedTimes;break}}return P===void 0&&(P=new im(i,M,S,s),h.push(P)),P}function w(S){if(--S.usedTimes===0){const M=h.indexOf(S);h[M]=h[h.length-1],h.pop(),S.destroy()}}function R(S){l.remove(S)}function U(){l.dispose()}return{getParameters:p,getProgramCacheKey:u,getUniforms:E,acquireProgram:C,releaseProgram:w,releaseShaderCache:R,programs:h,dispose:U}}function lm(){let i=new WeakMap;function t(o){return i.has(o)}function e(o){let a=i.get(o);return a===void 0&&(a={},i.set(o,a)),a}function n(o){i.delete(o)}function r(o,a,l){i.get(o)[a]=l}function s(){i=new WeakMap}return{has:t,get:e,remove:n,update:r,dispose:s}}function cm(i,t){return i.groupOrder!==t.groupOrder?i.groupOrder-t.groupOrder:i.renderOrder!==t.renderOrder?i.renderOrder-t.renderOrder:i.material.id!==t.material.id?i.material.id-t.material.id:i.z!==t.z?i.z-t.z:i.id-t.id}function hl(i,t){return i.groupOrder!==t.groupOrder?i.groupOrder-t.groupOrder:i.renderOrder!==t.renderOrder?i.renderOrder-t.renderOrder:i.z!==t.z?t.z-i.z:i.id-t.id}function dl(){const i=[];let t=0;const e=[],n=[],r=[];function s(){t=0,e.length=0,n.length=0,r.length=0}function o(d,f,m,g,x,p){let u=i[t];return u===void 0?(u={id:d.id,object:d,geometry:f,material:m,groupOrder:g,renderOrder:d.renderOrder,z:x,group:p},i[t]=u):(u.id=d.id,u.object=d,u.geometry=f,u.material=m,u.groupOrder=g,u.renderOrder=d.renderOrder,u.z=x,u.group=p),t++,u}function a(d,f,m,g,x,p){const u=o(d,f,m,g,x,p);m.transmission>0?n.push(u):m.transparent===!0?r.push(u):e.push(u)}function l(d,f,m,g,x,p){const u=o(d,f,m,g,x,p);m.transmission>0?n.unshift(u):m.transparent===!0?r.unshift(u):e.unshift(u)}function c(d,f){e.length>1&&e.sort(d||cm),n.length>1&&n.sort(f||hl),r.length>1&&r.sort(f||hl)}function h(){for(let d=t,f=i.length;d<f;d++){const m=i[d];if(m.id===null)break;m.id=null,m.object=null,m.geometry=null,m.material=null,m.group=null}}return{opaque:e,transmissive:n,transparent:r,init:s,push:a,unshift:l,finish:h,sort:c}}function um(){let i=new WeakMap;function t(n,r){const s=i.get(n);let o;return s===void 0?(o=new dl,i.set(n,[o])):r>=s.length?(o=new dl,s.push(o)):o=s[r],o}function e(){i=new WeakMap}return{get:t,dispose:e}}function hm(){const i={};return{get:function(t){if(i[t.id]!==void 0)return i[t.id];let e;switch(t.type){case"DirectionalLight":e={direction:new F,color:new Vt};break;case"SpotLight":e={position:new F,direction:new F,color:new Vt,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":e={position:new F,color:new Vt,distance:0,decay:0};break;case"HemisphereLight":e={direction:new F,skyColor:new Vt,groundColor:new Vt};break;case"RectAreaLight":e={color:new Vt,position:new F,halfWidth:new F,halfHeight:new F};break}return i[t.id]=e,e}}}function dm(){const i={};return{get:function(t){if(i[t.id]!==void 0)return i[t.id];let e;switch(t.type){case"DirectionalLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ot};break;case"SpotLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ot};break;case"PointLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ot,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[t.id]=e,e}}}let fm=0;function pm(i,t){return(t.castShadow?2:0)-(i.castShadow?2:0)+(t.map?1:0)-(i.map?1:0)}function mm(i){const t=new hm,e=dm(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)n.probe.push(new F);const r=new F,s=new te,o=new te;function a(c){let h=0,d=0,f=0;for(let S=0;S<9;S++)n.probe[S].set(0,0,0);let m=0,g=0,x=0,p=0,u=0,b=0,T=0,E=0,C=0,w=0,R=0;c.sort(pm);for(let S=0,M=c.length;S<M;S++){const P=c[S],O=P.color,k=P.intensity,Y=P.distance,X=P.shadow&&P.shadow.map?P.shadow.map.texture:null;if(P.isAmbientLight)h+=O.r*k,d+=O.g*k,f+=O.b*k;else if(P.isLightProbe){for(let q=0;q<9;q++)n.probe[q].addScaledVector(P.sh.coefficients[q],k);R++}else if(P.isDirectionalLight){const q=t.get(P);if(q.color.copy(P.color).multiplyScalar(P.intensity),P.castShadow){const Z=P.shadow,V=e.get(P);V.shadowIntensity=Z.intensity,V.shadowBias=Z.bias,V.shadowNormalBias=Z.normalBias,V.shadowRadius=Z.radius,V.shadowMapSize=Z.mapSize,n.directionalShadow[m]=V,n.directionalShadowMap[m]=X,n.directionalShadowMatrix[m]=P.shadow.matrix,b++}n.directional[m]=q,m++}else if(P.isSpotLight){const q=t.get(P);q.position.setFromMatrixPosition(P.matrixWorld),q.color.copy(O).multiplyScalar(k),q.distance=Y,q.coneCos=Math.cos(P.angle),q.penumbraCos=Math.cos(P.angle*(1-P.penumbra)),q.decay=P.decay,n.spot[x]=q;const Z=P.shadow;if(P.map&&(n.spotLightMap[C]=P.map,C++,Z.updateMatrices(P),P.castShadow&&w++),n.spotLightMatrix[x]=Z.matrix,P.castShadow){const V=e.get(P);V.shadowIntensity=Z.intensity,V.shadowBias=Z.bias,V.shadowNormalBias=Z.normalBias,V.shadowRadius=Z.radius,V.shadowMapSize=Z.mapSize,n.spotShadow[x]=V,n.spotShadowMap[x]=X,E++}x++}else if(P.isRectAreaLight){const q=t.get(P);q.color.copy(O).multiplyScalar(k),q.halfWidth.set(P.width*.5,0,0),q.halfHeight.set(0,P.height*.5,0),n.rectArea[p]=q,p++}else if(P.isPointLight){const q=t.get(P);if(q.color.copy(P.color).multiplyScalar(P.intensity),q.distance=P.distance,q.decay=P.decay,P.castShadow){const Z=P.shadow,V=e.get(P);V.shadowIntensity=Z.intensity,V.shadowBias=Z.bias,V.shadowNormalBias=Z.normalBias,V.shadowRadius=Z.radius,V.shadowMapSize=Z.mapSize,V.shadowCameraNear=Z.camera.near,V.shadowCameraFar=Z.camera.far,n.pointShadow[g]=V,n.pointShadowMap[g]=X,n.pointShadowMatrix[g]=P.shadow.matrix,T++}n.point[g]=q,g++}else if(P.isHemisphereLight){const q=t.get(P);q.skyColor.copy(P.color).multiplyScalar(k),q.groundColor.copy(P.groundColor).multiplyScalar(k),n.hemi[u]=q,u++}}p>0&&(i.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=st.LTC_FLOAT_1,n.rectAreaLTC2=st.LTC_FLOAT_2):(n.rectAreaLTC1=st.LTC_HALF_1,n.rectAreaLTC2=st.LTC_HALF_2)),n.ambient[0]=h,n.ambient[1]=d,n.ambient[2]=f;const U=n.hash;(U.directionalLength!==m||U.pointLength!==g||U.spotLength!==x||U.rectAreaLength!==p||U.hemiLength!==u||U.numDirectionalShadows!==b||U.numPointShadows!==T||U.numSpotShadows!==E||U.numSpotMaps!==C||U.numLightProbes!==R)&&(n.directional.length=m,n.spot.length=x,n.rectArea.length=p,n.point.length=g,n.hemi.length=u,n.directionalShadow.length=b,n.directionalShadowMap.length=b,n.pointShadow.length=T,n.pointShadowMap.length=T,n.spotShadow.length=E,n.spotShadowMap.length=E,n.directionalShadowMatrix.length=b,n.pointShadowMatrix.length=T,n.spotLightMatrix.length=E+C-w,n.spotLightMap.length=C,n.numSpotLightShadowsWithMaps=w,n.numLightProbes=R,U.directionalLength=m,U.pointLength=g,U.spotLength=x,U.rectAreaLength=p,U.hemiLength=u,U.numDirectionalShadows=b,U.numPointShadows=T,U.numSpotShadows=E,U.numSpotMaps=C,U.numLightProbes=R,n.version=fm++)}function l(c,h){let d=0,f=0,m=0,g=0,x=0;const p=h.matrixWorldInverse;for(let u=0,b=c.length;u<b;u++){const T=c[u];if(T.isDirectionalLight){const E=n.directional[d];E.direction.setFromMatrixPosition(T.matrixWorld),r.setFromMatrixPosition(T.target.matrixWorld),E.direction.sub(r),E.direction.transformDirection(p),d++}else if(T.isSpotLight){const E=n.spot[m];E.position.setFromMatrixPosition(T.matrixWorld),E.position.applyMatrix4(p),E.direction.setFromMatrixPosition(T.matrixWorld),r.setFromMatrixPosition(T.target.matrixWorld),E.direction.sub(r),E.direction.transformDirection(p),m++}else if(T.isRectAreaLight){const E=n.rectArea[g];E.position.setFromMatrixPosition(T.matrixWorld),E.position.applyMatrix4(p),o.identity(),s.copy(T.matrixWorld),s.premultiply(p),o.extractRotation(s),E.halfWidth.set(T.width*.5,0,0),E.halfHeight.set(0,T.height*.5,0),E.halfWidth.applyMatrix4(o),E.halfHeight.applyMatrix4(o),g++}else if(T.isPointLight){const E=n.point[f];E.position.setFromMatrixPosition(T.matrixWorld),E.position.applyMatrix4(p),f++}else if(T.isHemisphereLight){const E=n.hemi[x];E.direction.setFromMatrixPosition(T.matrixWorld),E.direction.transformDirection(p),x++}}}return{setup:a,setupView:l,state:n}}function fl(i){const t=new mm(i),e=[],n=[];function r(h){c.camera=h,e.length=0,n.length=0}function s(h){e.push(h)}function o(h){n.push(h)}function a(){t.setup(e)}function l(h){t.setupView(e,h)}const c={lightsArray:e,shadowsArray:n,camera:null,lights:t,transmissionRenderTarget:{}};return{init:r,state:c,setupLights:a,setupLightsView:l,pushLight:s,pushShadow:o}}function gm(i){let t=new WeakMap;function e(r,s=0){const o=t.get(r);let a;return o===void 0?(a=new fl(i),t.set(r,[a])):s>=o.length?(a=new fl(i),o.push(a)):a=o[s],a}function n(){t=new WeakMap}return{get:e,dispose:n}}const _m=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,vm=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function xm(i,t,e){let n=new Ya;const r=new Ot,s=new Ot,o=new he,a=new zu({depthPacking:$c}),l=new Hu,c={},h=e.maxTextureSize,d={[Xn]:Oe,[Oe]:Xn,[un]:un},f=new qn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ot},radius:{value:4}},vertexShader:_m,fragmentShader:vm}),m=f.clone();m.defines.HORIZONTAL_PASS=1;const g=new rn;g.setAttribute("position",new Ke(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const x=new Ie(g,f),p=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Ml;let u=this.type;this.render=function(w,R,U){if(p.enabled===!1||p.autoUpdate===!1&&p.needsUpdate===!1||w.length===0)return;const S=i.getRenderTarget(),M=i.getActiveCubeFace(),P=i.getActiveMipmapLevel(),O=i.state;O.setBlending(Hn),O.buffers.depth.getReversed()===!0?O.buffers.color.setClear(0,0,0,0):O.buffers.color.setClear(1,1,1,1),O.buffers.depth.setTest(!0),O.setScissorTest(!1);const k=u!==bn&&this.type===bn,Y=u===bn&&this.type!==bn;for(let X=0,q=w.length;X<q;X++){const Z=w[X],V=Z.shadow;if(V===void 0){console.warn("THREE.WebGLShadowMap:",Z,"has no shadow.");continue}if(V.autoUpdate===!1&&V.needsUpdate===!1)continue;r.copy(V.mapSize);const at=V.getFrameExtents();if(r.multiply(at),s.copy(V.mapSize),(r.x>h||r.y>h)&&(r.x>h&&(s.x=Math.floor(h/at.x),r.x=s.x*at.x,V.mapSize.x=s.x),r.y>h&&(s.y=Math.floor(h/at.y),r.y=s.y*at.y,V.mapSize.y=s.y)),V.map===null||k===!0||Y===!0){const yt=this.type!==bn?{minFilter:Ue,magFilter:Ue}:{};V.map!==null&&V.map.dispose(),V.map=new di(r.x,r.y,yt),V.map.texture.name=Z.name+".shadowMap",V.camera.updateProjectionMatrix()}i.setRenderTarget(V.map),i.clear();const ut=V.getViewportCount();for(let yt=0;yt<ut;yt++){const Ht=V.getViewport(yt);o.set(s.x*Ht.x,s.y*Ht.y,s.x*Ht.z,s.y*Ht.w),O.viewport(o),V.updateMatrices(Z,yt),n=V.getFrustum(),E(R,U,V.camera,Z,this.type)}V.isPointLightShadow!==!0&&this.type===bn&&b(V,U),V.needsUpdate=!1}u=this.type,p.needsUpdate=!1,i.setRenderTarget(S,M,P)};function b(w,R){const U=t.update(x);f.defines.VSM_SAMPLES!==w.blurSamples&&(f.defines.VSM_SAMPLES=w.blurSamples,m.defines.VSM_SAMPLES=w.blurSamples,f.needsUpdate=!0,m.needsUpdate=!0),w.mapPass===null&&(w.mapPass=new di(r.x,r.y)),f.uniforms.shadow_pass.value=w.map.texture,f.uniforms.resolution.value=w.mapSize,f.uniforms.radius.value=w.radius,i.setRenderTarget(w.mapPass),i.clear(),i.renderBufferDirect(R,null,U,f,x,null),m.uniforms.shadow_pass.value=w.mapPass.texture,m.uniforms.resolution.value=w.mapSize,m.uniforms.radius.value=w.radius,i.setRenderTarget(w.map),i.clear(),i.renderBufferDirect(R,null,U,m,x,null)}function T(w,R,U,S){let M=null;const P=U.isPointLight===!0?w.customDistanceMaterial:w.customDepthMaterial;if(P!==void 0)M=P;else if(M=U.isPointLight===!0?l:a,i.localClippingEnabled&&R.clipShadows===!0&&Array.isArray(R.clippingPlanes)&&R.clippingPlanes.length!==0||R.displacementMap&&R.displacementScale!==0||R.alphaMap&&R.alphaTest>0||R.map&&R.alphaTest>0||R.alphaToCoverage===!0){const O=M.uuid,k=R.uuid;let Y=c[O];Y===void 0&&(Y={},c[O]=Y);let X=Y[k];X===void 0&&(X=M.clone(),Y[k]=X,R.addEventListener("dispose",C)),M=X}if(M.visible=R.visible,M.wireframe=R.wireframe,S===bn?M.side=R.shadowSide!==null?R.shadowSide:R.side:M.side=R.shadowSide!==null?R.shadowSide:d[R.side],M.alphaMap=R.alphaMap,M.alphaTest=R.alphaToCoverage===!0?.5:R.alphaTest,M.map=R.map,M.clipShadows=R.clipShadows,M.clippingPlanes=R.clippingPlanes,M.clipIntersection=R.clipIntersection,M.displacementMap=R.displacementMap,M.displacementScale=R.displacementScale,M.displacementBias=R.displacementBias,M.wireframeLinewidth=R.wireframeLinewidth,M.linewidth=R.linewidth,U.isPointLight===!0&&M.isMeshDistanceMaterial===!0){const O=i.properties.get(M);O.light=U}return M}function E(w,R,U,S,M){if(w.visible===!1)return;if(w.layers.test(R.layers)&&(w.isMesh||w.isLine||w.isPoints)&&(w.castShadow||w.receiveShadow&&M===bn)&&(!w.frustumCulled||n.intersectsObject(w))){w.modelViewMatrix.multiplyMatrices(U.matrixWorldInverse,w.matrixWorld);const k=t.update(w),Y=w.material;if(Array.isArray(Y)){const X=k.groups;for(let q=0,Z=X.length;q<Z;q++){const V=X[q],at=Y[V.materialIndex];if(at&&at.visible){const ut=T(w,at,S,M);w.onBeforeShadow(i,w,R,U,k,ut,V),i.renderBufferDirect(U,null,k,ut,w,V),w.onAfterShadow(i,w,R,U,k,ut,V)}}}else if(Y.visible){const X=T(w,Y,S,M);w.onBeforeShadow(i,w,R,U,k,X,null),i.renderBufferDirect(U,null,k,X,w,null),w.onAfterShadow(i,w,R,U,k,X,null)}}const O=w.children;for(let k=0,Y=O.length;k<Y;k++)E(O[k],R,U,S,M)}function C(w){w.target.removeEventListener("dispose",C);for(const U in c){const S=c[U],M=w.target.uuid;M in S&&(S[M].dispose(),delete S[M])}}}const Mm={[Xs]:qs,[Ys]:js,[$s]:Zs,[Hi]:Ks,[qs]:Xs,[js]:Ys,[Zs]:$s,[Ks]:Hi};function Sm(i,t){function e(){let D=!1;const nt=new he;let rt=null;const dt=new he(0,0,0,0);return{setMask:function(Q){rt!==Q&&!D&&(i.colorMask(Q,Q,Q,Q),rt=Q)},setLocked:function(Q){D=Q},setClear:function(Q,K,mt,It,ne){ne===!0&&(Q*=It,K*=It,mt*=It),nt.set(Q,K,mt,It),dt.equals(nt)===!1&&(i.clearColor(Q,K,mt,It),dt.copy(nt))},reset:function(){D=!1,rt=null,dt.set(-1,0,0,0)}}}function n(){let D=!1,nt=!1,rt=null,dt=null,Q=null;return{setReversed:function(K){if(nt!==K){const mt=t.get("EXT_clip_control");K?mt.clipControlEXT(mt.LOWER_LEFT_EXT,mt.ZERO_TO_ONE_EXT):mt.clipControlEXT(mt.LOWER_LEFT_EXT,mt.NEGATIVE_ONE_TO_ONE_EXT),nt=K;const It=Q;Q=null,this.setClear(It)}},getReversed:function(){return nt},setTest:function(K){K?J(i.DEPTH_TEST):ft(i.DEPTH_TEST)},setMask:function(K){rt!==K&&!D&&(i.depthMask(K),rt=K)},setFunc:function(K){if(nt&&(K=Mm[K]),dt!==K){switch(K){case Xs:i.depthFunc(i.NEVER);break;case qs:i.depthFunc(i.ALWAYS);break;case Ys:i.depthFunc(i.LESS);break;case Hi:i.depthFunc(i.LEQUAL);break;case $s:i.depthFunc(i.EQUAL);break;case Ks:i.depthFunc(i.GEQUAL);break;case js:i.depthFunc(i.GREATER);break;case Zs:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}dt=K}},setLocked:function(K){D=K},setClear:function(K){Q!==K&&(nt&&(K=1-K),i.clearDepth(K),Q=K)},reset:function(){D=!1,rt=null,dt=null,Q=null,nt=!1}}}function r(){let D=!1,nt=null,rt=null,dt=null,Q=null,K=null,mt=null,It=null,ne=null;return{setTest:function(Kt){D||(Kt?J(i.STENCIL_TEST):ft(i.STENCIL_TEST))},setMask:function(Kt){nt!==Kt&&!D&&(i.stencilMask(Kt),nt=Kt)},setFunc:function(Kt,vn,an){(rt!==Kt||dt!==vn||Q!==an)&&(i.stencilFunc(Kt,vn,an),rt=Kt,dt=vn,Q=an)},setOp:function(Kt,vn,an){(K!==Kt||mt!==vn||It!==an)&&(i.stencilOp(Kt,vn,an),K=Kt,mt=vn,It=an)},setLocked:function(Kt){D=Kt},setClear:function(Kt){ne!==Kt&&(i.clearStencil(Kt),ne=Kt)},reset:function(){D=!1,nt=null,rt=null,dt=null,Q=null,K=null,mt=null,It=null,ne=null}}}const s=new e,o=new n,a=new r,l=new WeakMap,c=new WeakMap;let h={},d={},f=new WeakMap,m=[],g=null,x=!1,p=null,u=null,b=null,T=null,E=null,C=null,w=null,R=new Vt(0,0,0),U=0,S=!1,M=null,P=null,O=null,k=null,Y=null;const X=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let q=!1,Z=0;const V=i.getParameter(i.VERSION);V.indexOf("WebGL")!==-1?(Z=parseFloat(/^WebGL (\d)/.exec(V)[1]),q=Z>=1):V.indexOf("OpenGL ES")!==-1&&(Z=parseFloat(/^OpenGL ES (\d)/.exec(V)[1]),q=Z>=2);let at=null,ut={};const yt=i.getParameter(i.SCISSOR_BOX),Ht=i.getParameter(i.VIEWPORT),ee=new he().fromArray(yt),re=new he().fromArray(Ht);function $t(D,nt,rt,dt){const Q=new Uint8Array(4),K=i.createTexture();i.bindTexture(D,K),i.texParameteri(D,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(D,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let mt=0;mt<rt;mt++)D===i.TEXTURE_3D||D===i.TEXTURE_2D_ARRAY?i.texImage3D(nt,0,i.RGBA,1,1,dt,0,i.RGBA,i.UNSIGNED_BYTE,Q):i.texImage2D(nt+mt,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,Q);return K}const $={};$[i.TEXTURE_2D]=$t(i.TEXTURE_2D,i.TEXTURE_2D,1),$[i.TEXTURE_CUBE_MAP]=$t(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),$[i.TEXTURE_2D_ARRAY]=$t(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),$[i.TEXTURE_3D]=$t(i.TEXTURE_3D,i.TEXTURE_3D,1,1),s.setClear(0,0,0,1),o.setClear(1),a.setClear(0),J(i.DEPTH_TEST),o.setFunc(Hi),Ct(!1),gt(uo),J(i.CULL_FACE),se(Hn);function J(D){h[D]!==!0&&(i.enable(D),h[D]=!0)}function ft(D){h[D]!==!1&&(i.disable(D),h[D]=!1)}function Dt(D,nt){return d[D]!==nt?(i.bindFramebuffer(D,nt),d[D]=nt,D===i.DRAW_FRAMEBUFFER&&(d[i.FRAMEBUFFER]=nt),D===i.FRAMEBUFFER&&(d[i.DRAW_FRAMEBUFFER]=nt),!0):!1}function Et(D,nt){let rt=m,dt=!1;if(D){rt=f.get(nt),rt===void 0&&(rt=[],f.set(nt,rt));const Q=D.textures;if(rt.length!==Q.length||rt[0]!==i.COLOR_ATTACHMENT0){for(let K=0,mt=Q.length;K<mt;K++)rt[K]=i.COLOR_ATTACHMENT0+K;rt.length=Q.length,dt=!0}}else rt[0]!==i.BACK&&(rt[0]=i.BACK,dt=!0);dt&&i.drawBuffers(rt)}function Xt(D){return g!==D?(i.useProgram(D),g=D,!0):!1}const Me={[si]:i.FUNC_ADD,[Ec]:i.FUNC_SUBTRACT,[yc]:i.FUNC_REVERSE_SUBTRACT};Me[bc]=i.MIN,Me[Tc]=i.MAX;const A={[Ac]:i.ZERO,[wc]:i.ONE,[Rc]:i.SRC_COLOR,[Gs]:i.SRC_ALPHA,[Uc]:i.SRC_ALPHA_SATURATE,[Lc]:i.DST_COLOR,[Pc]:i.DST_ALPHA,[Cc]:i.ONE_MINUS_SRC_COLOR,[Ws]:i.ONE_MINUS_SRC_ALPHA,[Ic]:i.ONE_MINUS_DST_COLOR,[Dc]:i.ONE_MINUS_DST_ALPHA,[Nc]:i.CONSTANT_COLOR,[Fc]:i.ONE_MINUS_CONSTANT_COLOR,[Oc]:i.CONSTANT_ALPHA,[Bc]:i.ONE_MINUS_CONSTANT_ALPHA};function se(D,nt,rt,dt,Q,K,mt,It,ne,Kt){if(D===Hn){x===!0&&(ft(i.BLEND),x=!1);return}if(x===!1&&(J(i.BLEND),x=!0),D!==Sc){if(D!==p||Kt!==S){if((u!==si||E!==si)&&(i.blendEquation(i.FUNC_ADD),u=si,E=si),Kt)switch(D){case Bi:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case ho:i.blendFunc(i.ONE,i.ONE);break;case fo:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case po:i.blendFuncSeparate(i.DST_COLOR,i.ONE_MINUS_SRC_ALPHA,i.ZERO,i.ONE);break;default:console.error("THREE.WebGLState: Invalid blending: ",D);break}else switch(D){case Bi:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case ho:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE,i.ONE,i.ONE);break;case fo:console.error("THREE.WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case po:console.error("THREE.WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:console.error("THREE.WebGLState: Invalid blending: ",D);break}b=null,T=null,C=null,w=null,R.set(0,0,0),U=0,p=D,S=Kt}return}Q=Q||nt,K=K||rt,mt=mt||dt,(nt!==u||Q!==E)&&(i.blendEquationSeparate(Me[nt],Me[Q]),u=nt,E=Q),(rt!==b||dt!==T||K!==C||mt!==w)&&(i.blendFuncSeparate(A[rt],A[dt],A[K],A[mt]),b=rt,T=dt,C=K,w=mt),(It.equals(R)===!1||ne!==U)&&(i.blendColor(It.r,It.g,It.b,ne),R.copy(It),U=ne),p=D,S=!1}function Ut(D,nt){D.side===un?ft(i.CULL_FACE):J(i.CULL_FACE);let rt=D.side===Oe;nt&&(rt=!rt),Ct(rt),D.blending===Bi&&D.transparent===!1?se(Hn):se(D.blending,D.blendEquation,D.blendSrc,D.blendDst,D.blendEquationAlpha,D.blendSrcAlpha,D.blendDstAlpha,D.blendColor,D.blendAlpha,D.premultipliedAlpha),o.setFunc(D.depthFunc),o.setTest(D.depthTest),o.setMask(D.depthWrite),s.setMask(D.colorWrite);const dt=D.stencilWrite;a.setTest(dt),dt&&(a.setMask(D.stencilWriteMask),a.setFunc(D.stencilFunc,D.stencilRef,D.stencilFuncMask),a.setOp(D.stencilFail,D.stencilZFail,D.stencilZPass)),_t(D.polygonOffset,D.polygonOffsetFactor,D.polygonOffsetUnits),D.alphaToCoverage===!0?J(i.SAMPLE_ALPHA_TO_COVERAGE):ft(i.SAMPLE_ALPHA_TO_COVERAGE)}function Ct(D){M!==D&&(D?i.frontFace(i.CW):i.frontFace(i.CCW),M=D)}function gt(D){D!==xc?(J(i.CULL_FACE),D!==P&&(D===uo?i.cullFace(i.BACK):D===Mc?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):ft(i.CULL_FACE),P=D}function ae(D){D!==O&&(q&&i.lineWidth(D),O=D)}function _t(D,nt,rt){D?(J(i.POLYGON_OFFSET_FILL),(k!==nt||Y!==rt)&&(i.polygonOffset(nt,rt),k=nt,Y=rt)):ft(i.POLYGON_OFFSET_FILL)}function Bt(D){D?J(i.SCISSOR_TEST):ft(i.SCISSOR_TEST)}function ve(D){D===void 0&&(D=i.TEXTURE0+X-1),at!==D&&(i.activeTexture(D),at=D)}function de(D,nt,rt){rt===void 0&&(at===null?rt=i.TEXTURE0+X-1:rt=at);let dt=ut[rt];dt===void 0&&(dt={type:void 0,texture:void 0},ut[rt]=dt),(dt.type!==D||dt.texture!==nt)&&(at!==rt&&(i.activeTexture(rt),at=rt),i.bindTexture(D,nt||$[D]),dt.type=D,dt.texture=nt)}function y(){const D=ut[at];D!==void 0&&D.type!==void 0&&(i.bindTexture(D.type,null),D.type=void 0,D.texture=void 0)}function _(){try{i.compressedTexImage2D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function N(){try{i.compressedTexImage3D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function W(){try{i.texSubImage2D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function j(){try{i.texSubImage3D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function G(){try{i.compressedTexSubImage2D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function St(){try{i.compressedTexSubImage3D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function it(){try{i.texStorage2D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function vt(){try{i.texStorage3D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function xt(){try{i.texImage2D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function et(){try{i.texImage3D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function ct(D){ee.equals(D)===!1&&(i.scissor(D.x,D.y,D.z,D.w),ee.copy(D))}function Rt(D){re.equals(D)===!1&&(i.viewport(D.x,D.y,D.z,D.w),re.copy(D))}function Mt(D,nt){let rt=c.get(nt);rt===void 0&&(rt=new WeakMap,c.set(nt,rt));let dt=rt.get(D);dt===void 0&&(dt=i.getUniformBlockIndex(nt,D.name),rt.set(D,dt))}function ot(D,nt){const dt=c.get(nt).get(D);l.get(nt)!==dt&&(i.uniformBlockBinding(nt,dt,D.__bindingPointIndex),l.set(nt,dt))}function Nt(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),o.setReversed(!1),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),h={},at=null,ut={},d={},f=new WeakMap,m=[],g=null,x=!1,p=null,u=null,b=null,T=null,E=null,C=null,w=null,R=new Vt(0,0,0),U=0,S=!1,M=null,P=null,O=null,k=null,Y=null,ee.set(0,0,i.canvas.width,i.canvas.height),re.set(0,0,i.canvas.width,i.canvas.height),s.reset(),o.reset(),a.reset()}return{buffers:{color:s,depth:o,stencil:a},enable:J,disable:ft,bindFramebuffer:Dt,drawBuffers:Et,useProgram:Xt,setBlending:se,setMaterial:Ut,setFlipSided:Ct,setCullFace:gt,setLineWidth:ae,setPolygonOffset:_t,setScissorTest:Bt,activeTexture:ve,bindTexture:de,unbindTexture:y,compressedTexImage2D:_,compressedTexImage3D:N,texImage2D:xt,texImage3D:et,updateUBOMapping:Mt,uniformBlockBinding:ot,texStorage2D:it,texStorage3D:vt,texSubImage2D:W,texSubImage3D:j,compressedTexSubImage2D:G,compressedTexSubImage3D:St,scissor:ct,viewport:Rt,reset:Nt}}function Em(i,t,e,n,r,s,o){const a=t.has("WEBGL_multisampled_render_to_texture")?t.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new Ot,h=new WeakMap;let d;const f=new WeakMap;let m=!1;try{m=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function g(y,_){return m?new OffscreenCanvas(y,_):Jr("canvas")}function x(y,_,N){let W=1;const j=de(y);if((j.width>N||j.height>N)&&(W=N/Math.max(j.width,j.height)),W<1)if(typeof HTMLImageElement<"u"&&y instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&y instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&y instanceof ImageBitmap||typeof VideoFrame<"u"&&y instanceof VideoFrame){const G=Math.floor(W*j.width),St=Math.floor(W*j.height);d===void 0&&(d=g(G,St));const it=_?g(G,St):d;return it.width=G,it.height=St,it.getContext("2d").drawImage(y,0,0,G,St),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+j.width+"x"+j.height+") to ("+G+"x"+St+")."),it}else return"data"in y&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+j.width+"x"+j.height+")."),y;return y}function p(y){return y.generateMipmaps}function u(y){i.generateMipmap(y)}function b(y){return y.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:y.isWebGL3DRenderTarget?i.TEXTURE_3D:y.isWebGLArrayRenderTarget||y.isCompressedArrayTexture?i.TEXTURE_2D_ARRAY:i.TEXTURE_2D}function T(y,_,N,W,j=!1){if(y!==null){if(i[y]!==void 0)return i[y];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+y+"'")}let G=_;if(_===i.RED&&(N===i.FLOAT&&(G=i.R32F),N===i.HALF_FLOAT&&(G=i.R16F),N===i.UNSIGNED_BYTE&&(G=i.R8)),_===i.RED_INTEGER&&(N===i.UNSIGNED_BYTE&&(G=i.R8UI),N===i.UNSIGNED_SHORT&&(G=i.R16UI),N===i.UNSIGNED_INT&&(G=i.R32UI),N===i.BYTE&&(G=i.R8I),N===i.SHORT&&(G=i.R16I),N===i.INT&&(G=i.R32I)),_===i.RG&&(N===i.FLOAT&&(G=i.RG32F),N===i.HALF_FLOAT&&(G=i.RG16F),N===i.UNSIGNED_BYTE&&(G=i.RG8)),_===i.RG_INTEGER&&(N===i.UNSIGNED_BYTE&&(G=i.RG8UI),N===i.UNSIGNED_SHORT&&(G=i.RG16UI),N===i.UNSIGNED_INT&&(G=i.RG32UI),N===i.BYTE&&(G=i.RG8I),N===i.SHORT&&(G=i.RG16I),N===i.INT&&(G=i.RG32I)),_===i.RGB_INTEGER&&(N===i.UNSIGNED_BYTE&&(G=i.RGB8UI),N===i.UNSIGNED_SHORT&&(G=i.RGB16UI),N===i.UNSIGNED_INT&&(G=i.RGB32UI),N===i.BYTE&&(G=i.RGB8I),N===i.SHORT&&(G=i.RGB16I),N===i.INT&&(G=i.RGB32I)),_===i.RGBA_INTEGER&&(N===i.UNSIGNED_BYTE&&(G=i.RGBA8UI),N===i.UNSIGNED_SHORT&&(G=i.RGBA16UI),N===i.UNSIGNED_INT&&(G=i.RGBA32UI),N===i.BYTE&&(G=i.RGBA8I),N===i.SHORT&&(G=i.RGBA16I),N===i.INT&&(G=i.RGBA32I)),_===i.RGB&&(N===i.UNSIGNED_INT_5_9_9_9_REV&&(G=i.RGB9_E5),N===i.UNSIGNED_INT_10F_11F_11F_REV&&(G=i.R11F_G11F_B10F)),_===i.RGBA){const St=j?jr:Yt.getTransfer(W);N===i.FLOAT&&(G=i.RGBA32F),N===i.HALF_FLOAT&&(G=i.RGBA16F),N===i.UNSIGNED_BYTE&&(G=St===Zt?i.SRGB8_ALPHA8:i.RGBA8),N===i.UNSIGNED_SHORT_4_4_4_4&&(G=i.RGBA4),N===i.UNSIGNED_SHORT_5_5_5_1&&(G=i.RGB5_A1)}return(G===i.R16F||G===i.R32F||G===i.RG16F||G===i.RG32F||G===i.RGBA16F||G===i.RGBA32F)&&t.get("EXT_color_buffer_float"),G}function E(y,_){let N;return y?_===null||_===hi||_===lr?N=i.DEPTH24_STENCIL8:_===fn?N=i.DEPTH32F_STENCIL8:_===or&&(N=i.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):_===null||_===hi||_===lr?N=i.DEPTH_COMPONENT24:_===fn?N=i.DEPTH_COMPONENT32F:_===or&&(N=i.DEPTH_COMPONENT16),N}function C(y,_){return p(y)===!0||y.isFramebufferTexture&&y.minFilter!==Ue&&y.minFilter!==dn?Math.log2(Math.max(_.width,_.height))+1:y.mipmaps!==void 0&&y.mipmaps.length>0?y.mipmaps.length:y.isCompressedTexture&&Array.isArray(y.image)?_.mipmaps.length:1}function w(y){const _=y.target;_.removeEventListener("dispose",w),U(_),_.isVideoTexture&&h.delete(_)}function R(y){const _=y.target;_.removeEventListener("dispose",R),M(_)}function U(y){const _=n.get(y);if(_.__webglInit===void 0)return;const N=y.source,W=f.get(N);if(W){const j=W[_.__cacheKey];j.usedTimes--,j.usedTimes===0&&S(y),Object.keys(W).length===0&&f.delete(N)}n.remove(y)}function S(y){const _=n.get(y);i.deleteTexture(_.__webglTexture);const N=y.source,W=f.get(N);delete W[_.__cacheKey],o.memory.textures--}function M(y){const _=n.get(y);if(y.depthTexture&&(y.depthTexture.dispose(),n.remove(y.depthTexture)),y.isWebGLCubeRenderTarget)for(let W=0;W<6;W++){if(Array.isArray(_.__webglFramebuffer[W]))for(let j=0;j<_.__webglFramebuffer[W].length;j++)i.deleteFramebuffer(_.__webglFramebuffer[W][j]);else i.deleteFramebuffer(_.__webglFramebuffer[W]);_.__webglDepthbuffer&&i.deleteRenderbuffer(_.__webglDepthbuffer[W])}else{if(Array.isArray(_.__webglFramebuffer))for(let W=0;W<_.__webglFramebuffer.length;W++)i.deleteFramebuffer(_.__webglFramebuffer[W]);else i.deleteFramebuffer(_.__webglFramebuffer);if(_.__webglDepthbuffer&&i.deleteRenderbuffer(_.__webglDepthbuffer),_.__webglMultisampledFramebuffer&&i.deleteFramebuffer(_.__webglMultisampledFramebuffer),_.__webglColorRenderbuffer)for(let W=0;W<_.__webglColorRenderbuffer.length;W++)_.__webglColorRenderbuffer[W]&&i.deleteRenderbuffer(_.__webglColorRenderbuffer[W]);_.__webglDepthRenderbuffer&&i.deleteRenderbuffer(_.__webglDepthRenderbuffer)}const N=y.textures;for(let W=0,j=N.length;W<j;W++){const G=n.get(N[W]);G.__webglTexture&&(i.deleteTexture(G.__webglTexture),o.memory.textures--),n.remove(N[W])}n.remove(y)}let P=0;function O(){P=0}function k(){const y=P;return y>=r.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+y+" texture units while this GPU supports only "+r.maxTextures),P+=1,y}function Y(y){const _=[];return _.push(y.wrapS),_.push(y.wrapT),_.push(y.wrapR||0),_.push(y.magFilter),_.push(y.minFilter),_.push(y.anisotropy),_.push(y.internalFormat),_.push(y.format),_.push(y.type),_.push(y.generateMipmaps),_.push(y.premultiplyAlpha),_.push(y.flipY),_.push(y.unpackAlignment),_.push(y.colorSpace),_.join()}function X(y,_){const N=n.get(y);if(y.isVideoTexture&&Bt(y),y.isRenderTargetTexture===!1&&y.isExternalTexture!==!0&&y.version>0&&N.__version!==y.version){const W=y.image;if(W===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(W.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{$(N,y,_);return}}else y.isExternalTexture&&(N.__webglTexture=y.sourceTexture?y.sourceTexture:null);e.bindTexture(i.TEXTURE_2D,N.__webglTexture,i.TEXTURE0+_)}function q(y,_){const N=n.get(y);if(y.isRenderTargetTexture===!1&&y.version>0&&N.__version!==y.version){$(N,y,_);return}e.bindTexture(i.TEXTURE_2D_ARRAY,N.__webglTexture,i.TEXTURE0+_)}function Z(y,_){const N=n.get(y);if(y.isRenderTargetTexture===!1&&y.version>0&&N.__version!==y.version){$(N,y,_);return}e.bindTexture(i.TEXTURE_3D,N.__webglTexture,i.TEXTURE0+_)}function V(y,_){const N=n.get(y);if(y.version>0&&N.__version!==y.version){J(N,y,_);return}e.bindTexture(i.TEXTURE_CUBE_MAP,N.__webglTexture,i.TEXTURE0+_)}const at={[Kr]:i.REPEAT,[oi]:i.CLAMP_TO_EDGE,[ta]:i.MIRRORED_REPEAT},ut={[Ue]:i.NEAREST,[Tl]:i.NEAREST_MIPMAP_NEAREST,[vr]:i.NEAREST_MIPMAP_LINEAR,[dn]:i.LINEAR,[os]:i.LINEAR_MIPMAP_NEAREST,[li]:i.LINEAR_MIPMAP_LINEAR},yt={[jc]:i.NEVER,[nu]:i.ALWAYS,[Zc]:i.LESS,[Ul]:i.LEQUAL,[Jc]:i.EQUAL,[eu]:i.GEQUAL,[Qc]:i.GREATER,[tu]:i.NOTEQUAL};function Ht(y,_){if(_.type===fn&&t.has("OES_texture_float_linear")===!1&&(_.magFilter===dn||_.magFilter===os||_.magFilter===vr||_.magFilter===li||_.minFilter===dn||_.minFilter===os||_.minFilter===vr||_.minFilter===li)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),i.texParameteri(y,i.TEXTURE_WRAP_S,at[_.wrapS]),i.texParameteri(y,i.TEXTURE_WRAP_T,at[_.wrapT]),(y===i.TEXTURE_3D||y===i.TEXTURE_2D_ARRAY)&&i.texParameteri(y,i.TEXTURE_WRAP_R,at[_.wrapR]),i.texParameteri(y,i.TEXTURE_MAG_FILTER,ut[_.magFilter]),i.texParameteri(y,i.TEXTURE_MIN_FILTER,ut[_.minFilter]),_.compareFunction&&(i.texParameteri(y,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(y,i.TEXTURE_COMPARE_FUNC,yt[_.compareFunction])),t.has("EXT_texture_filter_anisotropic")===!0){if(_.magFilter===Ue||_.minFilter!==vr&&_.minFilter!==li||_.type===fn&&t.has("OES_texture_float_linear")===!1)return;if(_.anisotropy>1||n.get(_).__currentAnisotropy){const N=t.get("EXT_texture_filter_anisotropic");i.texParameterf(y,N.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(_.anisotropy,r.getMaxAnisotropy())),n.get(_).__currentAnisotropy=_.anisotropy}}}function ee(y,_){let N=!1;y.__webglInit===void 0&&(y.__webglInit=!0,_.addEventListener("dispose",w));const W=_.source;let j=f.get(W);j===void 0&&(j={},f.set(W,j));const G=Y(_);if(G!==y.__cacheKey){j[G]===void 0&&(j[G]={texture:i.createTexture(),usedTimes:0},o.memory.textures++,N=!0),j[G].usedTimes++;const St=j[y.__cacheKey];St!==void 0&&(j[y.__cacheKey].usedTimes--,St.usedTimes===0&&S(_)),y.__cacheKey=G,y.__webglTexture=j[G].texture}return N}function re(y,_,N){return Math.floor(Math.floor(y/N)/_)}function $t(y,_,N,W){const G=y.updateRanges;if(G.length===0)e.texSubImage2D(i.TEXTURE_2D,0,0,0,_.width,_.height,N,W,_.data);else{G.sort((et,ct)=>et.start-ct.start);let St=0;for(let et=1;et<G.length;et++){const ct=G[St],Rt=G[et],Mt=ct.start+ct.count,ot=re(Rt.start,_.width,4),Nt=re(ct.start,_.width,4);Rt.start<=Mt+1&&ot===Nt&&re(Rt.start+Rt.count-1,_.width,4)===ot?ct.count=Math.max(ct.count,Rt.start+Rt.count-ct.start):(++St,G[St]=Rt)}G.length=St+1;const it=i.getParameter(i.UNPACK_ROW_LENGTH),vt=i.getParameter(i.UNPACK_SKIP_PIXELS),xt=i.getParameter(i.UNPACK_SKIP_ROWS);i.pixelStorei(i.UNPACK_ROW_LENGTH,_.width);for(let et=0,ct=G.length;et<ct;et++){const Rt=G[et],Mt=Math.floor(Rt.start/4),ot=Math.ceil(Rt.count/4),Nt=Mt%_.width,D=Math.floor(Mt/_.width),nt=ot,rt=1;i.pixelStorei(i.UNPACK_SKIP_PIXELS,Nt),i.pixelStorei(i.UNPACK_SKIP_ROWS,D),e.texSubImage2D(i.TEXTURE_2D,0,Nt,D,nt,rt,N,W,_.data)}y.clearUpdateRanges(),i.pixelStorei(i.UNPACK_ROW_LENGTH,it),i.pixelStorei(i.UNPACK_SKIP_PIXELS,vt),i.pixelStorei(i.UNPACK_SKIP_ROWS,xt)}}function $(y,_,N){let W=i.TEXTURE_2D;(_.isDataArrayTexture||_.isCompressedArrayTexture)&&(W=i.TEXTURE_2D_ARRAY),_.isData3DTexture&&(W=i.TEXTURE_3D);const j=ee(y,_),G=_.source;e.bindTexture(W,y.__webglTexture,i.TEXTURE0+N);const St=n.get(G);if(G.version!==St.__version||j===!0){e.activeTexture(i.TEXTURE0+N);const it=Yt.getPrimaries(Yt.workingColorSpace),vt=_.colorSpace===On?null:Yt.getPrimaries(_.colorSpace),xt=_.colorSpace===On||it===vt?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,_.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,_.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,_.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,xt);let et=x(_.image,!1,r.maxTextureSize);et=ve(_,et);const ct=s.convert(_.format,_.colorSpace),Rt=s.convert(_.type);let Mt=T(_.internalFormat,ct,Rt,_.colorSpace,_.isVideoTexture);Ht(W,_);let ot;const Nt=_.mipmaps,D=_.isVideoTexture!==!0,nt=St.__version===void 0||j===!0,rt=G.dataReady,dt=C(_,et);if(_.isDepthTexture)Mt=E(_.format===ur,_.type),nt&&(D?e.texStorage2D(i.TEXTURE_2D,1,Mt,et.width,et.height):e.texImage2D(i.TEXTURE_2D,0,Mt,et.width,et.height,0,ct,Rt,null));else if(_.isDataTexture)if(Nt.length>0){D&&nt&&e.texStorage2D(i.TEXTURE_2D,dt,Mt,Nt[0].width,Nt[0].height);for(let Q=0,K=Nt.length;Q<K;Q++)ot=Nt[Q],D?rt&&e.texSubImage2D(i.TEXTURE_2D,Q,0,0,ot.width,ot.height,ct,Rt,ot.data):e.texImage2D(i.TEXTURE_2D,Q,Mt,ot.width,ot.height,0,ct,Rt,ot.data);_.generateMipmaps=!1}else D?(nt&&e.texStorage2D(i.TEXTURE_2D,dt,Mt,et.width,et.height),rt&&$t(_,et,ct,Rt)):e.texImage2D(i.TEXTURE_2D,0,Mt,et.width,et.height,0,ct,Rt,et.data);else if(_.isCompressedTexture)if(_.isCompressedArrayTexture){D&&nt&&e.texStorage3D(i.TEXTURE_2D_ARRAY,dt,Mt,Nt[0].width,Nt[0].height,et.depth);for(let Q=0,K=Nt.length;Q<K;Q++)if(ot=Nt[Q],_.format!==en)if(ct!==null)if(D){if(rt)if(_.layerUpdates.size>0){const mt=Go(ot.width,ot.height,_.format,_.type);for(const It of _.layerUpdates){const ne=ot.data.subarray(It*mt/ot.data.BYTES_PER_ELEMENT,(It+1)*mt/ot.data.BYTES_PER_ELEMENT);e.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,Q,0,0,It,ot.width,ot.height,1,ct,ne)}_.clearLayerUpdates()}else e.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,Q,0,0,0,ot.width,ot.height,et.depth,ct,ot.data)}else e.compressedTexImage3D(i.TEXTURE_2D_ARRAY,Q,Mt,ot.width,ot.height,et.depth,0,ot.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else D?rt&&e.texSubImage3D(i.TEXTURE_2D_ARRAY,Q,0,0,0,ot.width,ot.height,et.depth,ct,Rt,ot.data):e.texImage3D(i.TEXTURE_2D_ARRAY,Q,Mt,ot.width,ot.height,et.depth,0,ct,Rt,ot.data)}else{D&&nt&&e.texStorage2D(i.TEXTURE_2D,dt,Mt,Nt[0].width,Nt[0].height);for(let Q=0,K=Nt.length;Q<K;Q++)ot=Nt[Q],_.format!==en?ct!==null?D?rt&&e.compressedTexSubImage2D(i.TEXTURE_2D,Q,0,0,ot.width,ot.height,ct,ot.data):e.compressedTexImage2D(i.TEXTURE_2D,Q,Mt,ot.width,ot.height,0,ot.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):D?rt&&e.texSubImage2D(i.TEXTURE_2D,Q,0,0,ot.width,ot.height,ct,Rt,ot.data):e.texImage2D(i.TEXTURE_2D,Q,Mt,ot.width,ot.height,0,ct,Rt,ot.data)}else if(_.isDataArrayTexture)if(D){if(nt&&e.texStorage3D(i.TEXTURE_2D_ARRAY,dt,Mt,et.width,et.height,et.depth),rt)if(_.layerUpdates.size>0){const Q=Go(et.width,et.height,_.format,_.type);for(const K of _.layerUpdates){const mt=et.data.subarray(K*Q/et.data.BYTES_PER_ELEMENT,(K+1)*Q/et.data.BYTES_PER_ELEMENT);e.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,K,et.width,et.height,1,ct,Rt,mt)}_.clearLayerUpdates()}else e.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,et.width,et.height,et.depth,ct,Rt,et.data)}else e.texImage3D(i.TEXTURE_2D_ARRAY,0,Mt,et.width,et.height,et.depth,0,ct,Rt,et.data);else if(_.isData3DTexture)D?(nt&&e.texStorage3D(i.TEXTURE_3D,dt,Mt,et.width,et.height,et.depth),rt&&e.texSubImage3D(i.TEXTURE_3D,0,0,0,0,et.width,et.height,et.depth,ct,Rt,et.data)):e.texImage3D(i.TEXTURE_3D,0,Mt,et.width,et.height,et.depth,0,ct,Rt,et.data);else if(_.isFramebufferTexture){if(nt)if(D)e.texStorage2D(i.TEXTURE_2D,dt,Mt,et.width,et.height);else{let Q=et.width,K=et.height;for(let mt=0;mt<dt;mt++)e.texImage2D(i.TEXTURE_2D,mt,Mt,Q,K,0,ct,Rt,null),Q>>=1,K>>=1}}else if(Nt.length>0){if(D&&nt){const Q=de(Nt[0]);e.texStorage2D(i.TEXTURE_2D,dt,Mt,Q.width,Q.height)}for(let Q=0,K=Nt.length;Q<K;Q++)ot=Nt[Q],D?rt&&e.texSubImage2D(i.TEXTURE_2D,Q,0,0,ct,Rt,ot):e.texImage2D(i.TEXTURE_2D,Q,Mt,ct,Rt,ot);_.generateMipmaps=!1}else if(D){if(nt){const Q=de(et);e.texStorage2D(i.TEXTURE_2D,dt,Mt,Q.width,Q.height)}rt&&e.texSubImage2D(i.TEXTURE_2D,0,0,0,ct,Rt,et)}else e.texImage2D(i.TEXTURE_2D,0,Mt,ct,Rt,et);p(_)&&u(W),St.__version=G.version,_.onUpdate&&_.onUpdate(_)}y.__version=_.version}function J(y,_,N){if(_.image.length!==6)return;const W=ee(y,_),j=_.source;e.bindTexture(i.TEXTURE_CUBE_MAP,y.__webglTexture,i.TEXTURE0+N);const G=n.get(j);if(j.version!==G.__version||W===!0){e.activeTexture(i.TEXTURE0+N);const St=Yt.getPrimaries(Yt.workingColorSpace),it=_.colorSpace===On?null:Yt.getPrimaries(_.colorSpace),vt=_.colorSpace===On||St===it?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,_.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,_.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,_.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,vt);const xt=_.isCompressedTexture||_.image[0].isCompressedTexture,et=_.image[0]&&_.image[0].isDataTexture,ct=[];for(let K=0;K<6;K++)!xt&&!et?ct[K]=x(_.image[K],!0,r.maxCubemapSize):ct[K]=et?_.image[K].image:_.image[K],ct[K]=ve(_,ct[K]);const Rt=ct[0],Mt=s.convert(_.format,_.colorSpace),ot=s.convert(_.type),Nt=T(_.internalFormat,Mt,ot,_.colorSpace),D=_.isVideoTexture!==!0,nt=G.__version===void 0||W===!0,rt=j.dataReady;let dt=C(_,Rt);Ht(i.TEXTURE_CUBE_MAP,_);let Q;if(xt){D&&nt&&e.texStorage2D(i.TEXTURE_CUBE_MAP,dt,Nt,Rt.width,Rt.height);for(let K=0;K<6;K++){Q=ct[K].mipmaps;for(let mt=0;mt<Q.length;mt++){const It=Q[mt];_.format!==en?Mt!==null?D?rt&&e.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+K,mt,0,0,It.width,It.height,Mt,It.data):e.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+K,mt,Nt,It.width,It.height,0,It.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):D?rt&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+K,mt,0,0,It.width,It.height,Mt,ot,It.data):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+K,mt,Nt,It.width,It.height,0,Mt,ot,It.data)}}}else{if(Q=_.mipmaps,D&&nt){Q.length>0&&dt++;const K=de(ct[0]);e.texStorage2D(i.TEXTURE_CUBE_MAP,dt,Nt,K.width,K.height)}for(let K=0;K<6;K++)if(et){D?rt&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+K,0,0,0,ct[K].width,ct[K].height,Mt,ot,ct[K].data):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+K,0,Nt,ct[K].width,ct[K].height,0,Mt,ot,ct[K].data);for(let mt=0;mt<Q.length;mt++){const ne=Q[mt].image[K].image;D?rt&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+K,mt+1,0,0,ne.width,ne.height,Mt,ot,ne.data):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+K,mt+1,Nt,ne.width,ne.height,0,Mt,ot,ne.data)}}else{D?rt&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+K,0,0,0,Mt,ot,ct[K]):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+K,0,Nt,Mt,ot,ct[K]);for(let mt=0;mt<Q.length;mt++){const It=Q[mt];D?rt&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+K,mt+1,0,0,Mt,ot,It.image[K]):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+K,mt+1,Nt,Mt,ot,It.image[K])}}}p(_)&&u(i.TEXTURE_CUBE_MAP),G.__version=j.version,_.onUpdate&&_.onUpdate(_)}y.__version=_.version}function ft(y,_,N,W,j,G){const St=s.convert(N.format,N.colorSpace),it=s.convert(N.type),vt=T(N.internalFormat,St,it,N.colorSpace),xt=n.get(_),et=n.get(N);if(et.__renderTarget=_,!xt.__hasExternalTextures){const ct=Math.max(1,_.width>>G),Rt=Math.max(1,_.height>>G);j===i.TEXTURE_3D||j===i.TEXTURE_2D_ARRAY?e.texImage3D(j,G,vt,ct,Rt,_.depth,0,St,it,null):e.texImage2D(j,G,vt,ct,Rt,0,St,it,null)}e.bindFramebuffer(i.FRAMEBUFFER,y),_t(_)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,W,j,et.__webglTexture,0,ae(_)):(j===i.TEXTURE_2D||j>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&j<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,W,j,et.__webglTexture,G),e.bindFramebuffer(i.FRAMEBUFFER,null)}function Dt(y,_,N){if(i.bindRenderbuffer(i.RENDERBUFFER,y),_.depthBuffer){const W=_.depthTexture,j=W&&W.isDepthTexture?W.type:null,G=E(_.stencilBuffer,j),St=_.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,it=ae(_);_t(_)?a.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,it,G,_.width,_.height):N?i.renderbufferStorageMultisample(i.RENDERBUFFER,it,G,_.width,_.height):i.renderbufferStorage(i.RENDERBUFFER,G,_.width,_.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,St,i.RENDERBUFFER,y)}else{const W=_.textures;for(let j=0;j<W.length;j++){const G=W[j],St=s.convert(G.format,G.colorSpace),it=s.convert(G.type),vt=T(G.internalFormat,St,it,G.colorSpace),xt=ae(_);N&&_t(_)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,xt,vt,_.width,_.height):_t(_)?a.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,xt,vt,_.width,_.height):i.renderbufferStorage(i.RENDERBUFFER,vt,_.width,_.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function Et(y,_){if(_&&_.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(e.bindFramebuffer(i.FRAMEBUFFER,y),!(_.depthTexture&&_.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");const W=n.get(_.depthTexture);W.__renderTarget=_,(!W.__webglTexture||_.depthTexture.image.width!==_.width||_.depthTexture.image.height!==_.height)&&(_.depthTexture.image.width=_.width,_.depthTexture.image.height=_.height,_.depthTexture.needsUpdate=!0),X(_.depthTexture,0);const j=W.__webglTexture,G=ae(_);if(_.depthTexture.format===cr)_t(_)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,j,0,G):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,j,0);else if(_.depthTexture.format===ur)_t(_)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,j,0,G):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,j,0);else throw new Error("Unknown depthTexture format")}function Xt(y){const _=n.get(y),N=y.isWebGLCubeRenderTarget===!0;if(_.__boundDepthTexture!==y.depthTexture){const W=y.depthTexture;if(_.__depthDisposeCallback&&_.__depthDisposeCallback(),W){const j=()=>{delete _.__boundDepthTexture,delete _.__depthDisposeCallback,W.removeEventListener("dispose",j)};W.addEventListener("dispose",j),_.__depthDisposeCallback=j}_.__boundDepthTexture=W}if(y.depthTexture&&!_.__autoAllocateDepthBuffer){if(N)throw new Error("target.depthTexture not supported in Cube render targets");const W=y.texture.mipmaps;W&&W.length>0?Et(_.__webglFramebuffer[0],y):Et(_.__webglFramebuffer,y)}else if(N){_.__webglDepthbuffer=[];for(let W=0;W<6;W++)if(e.bindFramebuffer(i.FRAMEBUFFER,_.__webglFramebuffer[W]),_.__webglDepthbuffer[W]===void 0)_.__webglDepthbuffer[W]=i.createRenderbuffer(),Dt(_.__webglDepthbuffer[W],y,!1);else{const j=y.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,G=_.__webglDepthbuffer[W];i.bindRenderbuffer(i.RENDERBUFFER,G),i.framebufferRenderbuffer(i.FRAMEBUFFER,j,i.RENDERBUFFER,G)}}else{const W=y.texture.mipmaps;if(W&&W.length>0?e.bindFramebuffer(i.FRAMEBUFFER,_.__webglFramebuffer[0]):e.bindFramebuffer(i.FRAMEBUFFER,_.__webglFramebuffer),_.__webglDepthbuffer===void 0)_.__webglDepthbuffer=i.createRenderbuffer(),Dt(_.__webglDepthbuffer,y,!1);else{const j=y.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,G=_.__webglDepthbuffer;i.bindRenderbuffer(i.RENDERBUFFER,G),i.framebufferRenderbuffer(i.FRAMEBUFFER,j,i.RENDERBUFFER,G)}}e.bindFramebuffer(i.FRAMEBUFFER,null)}function Me(y,_,N){const W=n.get(y);_!==void 0&&ft(W.__webglFramebuffer,y,y.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),N!==void 0&&Xt(y)}function A(y){const _=y.texture,N=n.get(y),W=n.get(_);y.addEventListener("dispose",R);const j=y.textures,G=y.isWebGLCubeRenderTarget===!0,St=j.length>1;if(St||(W.__webglTexture===void 0&&(W.__webglTexture=i.createTexture()),W.__version=_.version,o.memory.textures++),G){N.__webglFramebuffer=[];for(let it=0;it<6;it++)if(_.mipmaps&&_.mipmaps.length>0){N.__webglFramebuffer[it]=[];for(let vt=0;vt<_.mipmaps.length;vt++)N.__webglFramebuffer[it][vt]=i.createFramebuffer()}else N.__webglFramebuffer[it]=i.createFramebuffer()}else{if(_.mipmaps&&_.mipmaps.length>0){N.__webglFramebuffer=[];for(let it=0;it<_.mipmaps.length;it++)N.__webglFramebuffer[it]=i.createFramebuffer()}else N.__webglFramebuffer=i.createFramebuffer();if(St)for(let it=0,vt=j.length;it<vt;it++){const xt=n.get(j[it]);xt.__webglTexture===void 0&&(xt.__webglTexture=i.createTexture(),o.memory.textures++)}if(y.samples>0&&_t(y)===!1){N.__webglMultisampledFramebuffer=i.createFramebuffer(),N.__webglColorRenderbuffer=[],e.bindFramebuffer(i.FRAMEBUFFER,N.__webglMultisampledFramebuffer);for(let it=0;it<j.length;it++){const vt=j[it];N.__webglColorRenderbuffer[it]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,N.__webglColorRenderbuffer[it]);const xt=s.convert(vt.format,vt.colorSpace),et=s.convert(vt.type),ct=T(vt.internalFormat,xt,et,vt.colorSpace,y.isXRRenderTarget===!0),Rt=ae(y);i.renderbufferStorageMultisample(i.RENDERBUFFER,Rt,ct,y.width,y.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+it,i.RENDERBUFFER,N.__webglColorRenderbuffer[it])}i.bindRenderbuffer(i.RENDERBUFFER,null),y.depthBuffer&&(N.__webglDepthRenderbuffer=i.createRenderbuffer(),Dt(N.__webglDepthRenderbuffer,y,!0)),e.bindFramebuffer(i.FRAMEBUFFER,null)}}if(G){e.bindTexture(i.TEXTURE_CUBE_MAP,W.__webglTexture),Ht(i.TEXTURE_CUBE_MAP,_);for(let it=0;it<6;it++)if(_.mipmaps&&_.mipmaps.length>0)for(let vt=0;vt<_.mipmaps.length;vt++)ft(N.__webglFramebuffer[it][vt],y,_,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+it,vt);else ft(N.__webglFramebuffer[it],y,_,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+it,0);p(_)&&u(i.TEXTURE_CUBE_MAP),e.unbindTexture()}else if(St){for(let it=0,vt=j.length;it<vt;it++){const xt=j[it],et=n.get(xt);let ct=i.TEXTURE_2D;(y.isWebGL3DRenderTarget||y.isWebGLArrayRenderTarget)&&(ct=y.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),e.bindTexture(ct,et.__webglTexture),Ht(ct,xt),ft(N.__webglFramebuffer,y,xt,i.COLOR_ATTACHMENT0+it,ct,0),p(xt)&&u(ct)}e.unbindTexture()}else{let it=i.TEXTURE_2D;if((y.isWebGL3DRenderTarget||y.isWebGLArrayRenderTarget)&&(it=y.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),e.bindTexture(it,W.__webglTexture),Ht(it,_),_.mipmaps&&_.mipmaps.length>0)for(let vt=0;vt<_.mipmaps.length;vt++)ft(N.__webglFramebuffer[vt],y,_,i.COLOR_ATTACHMENT0,it,vt);else ft(N.__webglFramebuffer,y,_,i.COLOR_ATTACHMENT0,it,0);p(_)&&u(it),e.unbindTexture()}y.depthBuffer&&Xt(y)}function se(y){const _=y.textures;for(let N=0,W=_.length;N<W;N++){const j=_[N];if(p(j)){const G=b(y),St=n.get(j).__webglTexture;e.bindTexture(G,St),u(G),e.unbindTexture()}}}const Ut=[],Ct=[];function gt(y){if(y.samples>0){if(_t(y)===!1){const _=y.textures,N=y.width,W=y.height;let j=i.COLOR_BUFFER_BIT;const G=y.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,St=n.get(y),it=_.length>1;if(it)for(let xt=0;xt<_.length;xt++)e.bindFramebuffer(i.FRAMEBUFFER,St.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+xt,i.RENDERBUFFER,null),e.bindFramebuffer(i.FRAMEBUFFER,St.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+xt,i.TEXTURE_2D,null,0);e.bindFramebuffer(i.READ_FRAMEBUFFER,St.__webglMultisampledFramebuffer);const vt=y.texture.mipmaps;vt&&vt.length>0?e.bindFramebuffer(i.DRAW_FRAMEBUFFER,St.__webglFramebuffer[0]):e.bindFramebuffer(i.DRAW_FRAMEBUFFER,St.__webglFramebuffer);for(let xt=0;xt<_.length;xt++){if(y.resolveDepthBuffer&&(y.depthBuffer&&(j|=i.DEPTH_BUFFER_BIT),y.stencilBuffer&&y.resolveStencilBuffer&&(j|=i.STENCIL_BUFFER_BIT)),it){i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,St.__webglColorRenderbuffer[xt]);const et=n.get(_[xt]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,et,0)}i.blitFramebuffer(0,0,N,W,0,0,N,W,j,i.NEAREST),l===!0&&(Ut.length=0,Ct.length=0,Ut.push(i.COLOR_ATTACHMENT0+xt),y.depthBuffer&&y.resolveDepthBuffer===!1&&(Ut.push(G),Ct.push(G),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,Ct)),i.invalidateFramebuffer(i.READ_FRAMEBUFFER,Ut))}if(e.bindFramebuffer(i.READ_FRAMEBUFFER,null),e.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),it)for(let xt=0;xt<_.length;xt++){e.bindFramebuffer(i.FRAMEBUFFER,St.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+xt,i.RENDERBUFFER,St.__webglColorRenderbuffer[xt]);const et=n.get(_[xt]).__webglTexture;e.bindFramebuffer(i.FRAMEBUFFER,St.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+xt,i.TEXTURE_2D,et,0)}e.bindFramebuffer(i.DRAW_FRAMEBUFFER,St.__webglMultisampledFramebuffer)}else if(y.depthBuffer&&y.resolveDepthBuffer===!1&&l){const _=y.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[_])}}}function ae(y){return Math.min(r.maxSamples,y.samples)}function _t(y){const _=n.get(y);return y.samples>0&&t.has("WEBGL_multisampled_render_to_texture")===!0&&_.__useRenderToTexture!==!1}function Bt(y){const _=o.render.frame;h.get(y)!==_&&(h.set(y,_),y.update())}function ve(y,_){const N=y.colorSpace,W=y.format,j=y.type;return y.isCompressedTexture===!0||y.isVideoTexture===!0||N!==Gi&&N!==On&&(Yt.getTransfer(N)===Zt?(W!==en||j!==mn)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",N)),_}function de(y){return typeof HTMLImageElement<"u"&&y instanceof HTMLImageElement?(c.width=y.naturalWidth||y.width,c.height=y.naturalHeight||y.height):typeof VideoFrame<"u"&&y instanceof VideoFrame?(c.width=y.displayWidth,c.height=y.displayHeight):(c.width=y.width,c.height=y.height),c}this.allocateTextureUnit=k,this.resetTextureUnits=O,this.setTexture2D=X,this.setTexture2DArray=q,this.setTexture3D=Z,this.setTextureCube=V,this.rebindTextures=Me,this.setupRenderTarget=A,this.updateRenderTargetMipmap=se,this.updateMultisampleRenderTarget=gt,this.setupDepthRenderbuffer=Xt,this.setupFrameBufferTexture=ft,this.useMultisampledRTT=_t}function ym(i,t){function e(n,r=On){let s;const o=Yt.getTransfer(r);if(n===mn)return i.UNSIGNED_BYTE;if(n===Ba)return i.UNSIGNED_SHORT_4_4_4_4;if(n===za)return i.UNSIGNED_SHORT_5_5_5_1;if(n===Rl)return i.UNSIGNED_INT_5_9_9_9_REV;if(n===Cl)return i.UNSIGNED_INT_10F_11F_11F_REV;if(n===Al)return i.BYTE;if(n===wl)return i.SHORT;if(n===or)return i.UNSIGNED_SHORT;if(n===Oa)return i.INT;if(n===hi)return i.UNSIGNED_INT;if(n===fn)return i.FLOAT;if(n===dr)return i.HALF_FLOAT;if(n===Pl)return i.ALPHA;if(n===Dl)return i.RGB;if(n===en)return i.RGBA;if(n===cr)return i.DEPTH_COMPONENT;if(n===ur)return i.DEPTH_STENCIL;if(n===Ha)return i.RED;if(n===ka)return i.RED_INTEGER;if(n===Ll)return i.RG;if(n===Va)return i.RG_INTEGER;if(n===Ga)return i.RGBA_INTEGER;if(n===Wr||n===Xr||n===qr||n===Yr)if(o===Zt)if(s=t.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(n===Wr)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===Xr)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===qr)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===Yr)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=t.get("WEBGL_compressed_texture_s3tc"),s!==null){if(n===Wr)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===Xr)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===qr)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===Yr)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===ea||n===na||n===ia||n===ra)if(s=t.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(n===ea)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===na)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===ia)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===ra)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===sa||n===aa||n===oa)if(s=t.get("WEBGL_compressed_texture_etc"),s!==null){if(n===sa||n===aa)return o===Zt?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(n===oa)return o===Zt?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(n===la||n===ca||n===ua||n===ha||n===da||n===fa||n===pa||n===ma||n===ga||n===_a||n===va||n===xa||n===Ma||n===Sa)if(s=t.get("WEBGL_compressed_texture_astc"),s!==null){if(n===la)return o===Zt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===ca)return o===Zt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===ua)return o===Zt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===ha)return o===Zt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===da)return o===Zt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===fa)return o===Zt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===pa)return o===Zt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===ma)return o===Zt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===ga)return o===Zt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===_a)return o===Zt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===va)return o===Zt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===xa)return o===Zt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===Ma)return o===Zt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===Sa)return o===Zt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===Ea||n===ya||n===ba)if(s=t.get("EXT_texture_compression_bptc"),s!==null){if(n===Ea)return o===Zt?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===ya)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===ba)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===Ta||n===Aa||n===wa||n===Ra)if(s=t.get("EXT_texture_compression_rgtc"),s!==null){if(n===Ta)return s.COMPRESSED_RED_RGTC1_EXT;if(n===Aa)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===wa)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===Ra)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===lr?i.UNSIGNED_INT_24_8:i[n]!==void 0?i[n]:null}return{convert:e}}const bm=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,Tm=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;class Am{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(t,e){if(this.texture===null){const n=new $l(t.texture);(t.depthNear!==e.depthNear||t.depthFar!==e.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=n}}getMesh(t){if(this.texture!==null&&this.mesh===null){const e=t.cameras[0].viewport,n=new qn({vertexShader:bm,fragmentShader:Tm,uniforms:{depthColor:{value:this.texture},depthWidth:{value:e.z},depthHeight:{value:e.w}}});this.mesh=new Ie(new gi(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class wm extends Xi{constructor(t,e){super();const n=this;let r=null,s=1,o=null,a="local-floor",l=1,c=null,h=null,d=null,f=null,m=null,g=null;const x=typeof XRWebGLBinding<"u",p=new Am,u={},b=e.getContextAttributes();let T=null,E=null;const C=[],w=[],R=new Ot;let U=null;const S=new Qe;S.viewport=new he;const M=new Qe;M.viewport=new he;const P=[S,M],O=new qu;let k=null,Y=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function($){let J=C[$];return J===void 0&&(J=new Ps,C[$]=J),J.getTargetRaySpace()},this.getControllerGrip=function($){let J=C[$];return J===void 0&&(J=new Ps,C[$]=J),J.getGripSpace()},this.getHand=function($){let J=C[$];return J===void 0&&(J=new Ps,C[$]=J),J.getHandSpace()};function X($){const J=w.indexOf($.inputSource);if(J===-1)return;const ft=C[J];ft!==void 0&&(ft.update($.inputSource,$.frame,c||o),ft.dispatchEvent({type:$.type,data:$.inputSource}))}function q(){r.removeEventListener("select",X),r.removeEventListener("selectstart",X),r.removeEventListener("selectend",X),r.removeEventListener("squeeze",X),r.removeEventListener("squeezestart",X),r.removeEventListener("squeezeend",X),r.removeEventListener("end",q),r.removeEventListener("inputsourceschange",Z);for(let $=0;$<C.length;$++){const J=w[$];J!==null&&(w[$]=null,C[$].disconnect(J))}k=null,Y=null,p.reset();for(const $ in u)delete u[$];t.setRenderTarget(T),m=null,f=null,d=null,r=null,E=null,$t.stop(),n.isPresenting=!1,t.setPixelRatio(U),t.setSize(R.width,R.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function($){s=$,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function($){a=$,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function($){c=$},this.getBaseLayer=function(){return f!==null?f:m},this.getBinding=function(){return d===null&&x&&(d=new XRWebGLBinding(r,e)),d},this.getFrame=function(){return g},this.getSession=function(){return r},this.setSession=async function($){if(r=$,r!==null){if(T=t.getRenderTarget(),r.addEventListener("select",X),r.addEventListener("selectstart",X),r.addEventListener("selectend",X),r.addEventListener("squeeze",X),r.addEventListener("squeezestart",X),r.addEventListener("squeezeend",X),r.addEventListener("end",q),r.addEventListener("inputsourceschange",Z),b.xrCompatible!==!0&&await e.makeXRCompatible(),U=t.getPixelRatio(),t.getSize(R),x&&"createProjectionLayer"in XRWebGLBinding.prototype){let ft=null,Dt=null,Et=null;b.depth&&(Et=b.stencil?e.DEPTH24_STENCIL8:e.DEPTH_COMPONENT24,ft=b.stencil?ur:cr,Dt=b.stencil?lr:hi);const Xt={colorFormat:e.RGBA8,depthFormat:Et,scaleFactor:s};d=this.getBinding(),f=d.createProjectionLayer(Xt),r.updateRenderState({layers:[f]}),t.setPixelRatio(1),t.setSize(f.textureWidth,f.textureHeight,!1),E=new di(f.textureWidth,f.textureHeight,{format:en,type:mn,depthTexture:new Yl(f.textureWidth,f.textureHeight,Dt,void 0,void 0,void 0,void 0,void 0,void 0,ft),stencilBuffer:b.stencil,colorSpace:t.outputColorSpace,samples:b.antialias?4:0,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1})}else{const ft={antialias:b.antialias,alpha:!0,depth:b.depth,stencil:b.stencil,framebufferScaleFactor:s};m=new XRWebGLLayer(r,e,ft),r.updateRenderState({baseLayer:m}),t.setPixelRatio(1),t.setSize(m.framebufferWidth,m.framebufferHeight,!1),E=new di(m.framebufferWidth,m.framebufferHeight,{format:en,type:mn,colorSpace:t.outputColorSpace,stencilBuffer:b.stencil,resolveDepthBuffer:m.ignoreDepthValues===!1,resolveStencilBuffer:m.ignoreDepthValues===!1})}E.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await r.requestReferenceSpace(a),$t.setContext(r),$t.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return p.getDepthTexture()};function Z($){for(let J=0;J<$.removed.length;J++){const ft=$.removed[J],Dt=w.indexOf(ft);Dt>=0&&(w[Dt]=null,C[Dt].disconnect(ft))}for(let J=0;J<$.added.length;J++){const ft=$.added[J];let Dt=w.indexOf(ft);if(Dt===-1){for(let Xt=0;Xt<C.length;Xt++)if(Xt>=w.length){w.push(ft),Dt=Xt;break}else if(w[Xt]===null){w[Xt]=ft,Dt=Xt;break}if(Dt===-1)break}const Et=C[Dt];Et&&Et.connect(ft)}}const V=new F,at=new F;function ut($,J,ft){V.setFromMatrixPosition(J.matrixWorld),at.setFromMatrixPosition(ft.matrixWorld);const Dt=V.distanceTo(at),Et=J.projectionMatrix.elements,Xt=ft.projectionMatrix.elements,Me=Et[14]/(Et[10]-1),A=Et[14]/(Et[10]+1),se=(Et[9]+1)/Et[5],Ut=(Et[9]-1)/Et[5],Ct=(Et[8]-1)/Et[0],gt=(Xt[8]+1)/Xt[0],ae=Me*Ct,_t=Me*gt,Bt=Dt/(-Ct+gt),ve=Bt*-Ct;if(J.matrixWorld.decompose($.position,$.quaternion,$.scale),$.translateX(ve),$.translateZ(Bt),$.matrixWorld.compose($.position,$.quaternion,$.scale),$.matrixWorldInverse.copy($.matrixWorld).invert(),Et[10]===-1)$.projectionMatrix.copy(J.projectionMatrix),$.projectionMatrixInverse.copy(J.projectionMatrixInverse);else{const de=Me+Bt,y=A+Bt,_=ae-ve,N=_t+(Dt-ve),W=se*A/y*de,j=Ut*A/y*de;$.projectionMatrix.makePerspective(_,N,W,j,de,y),$.projectionMatrixInverse.copy($.projectionMatrix).invert()}}function yt($,J){J===null?$.matrixWorld.copy($.matrix):$.matrixWorld.multiplyMatrices(J.matrixWorld,$.matrix),$.matrixWorldInverse.copy($.matrixWorld).invert()}this.updateCamera=function($){if(r===null)return;let J=$.near,ft=$.far;p.texture!==null&&(p.depthNear>0&&(J=p.depthNear),p.depthFar>0&&(ft=p.depthFar)),O.near=M.near=S.near=J,O.far=M.far=S.far=ft,(k!==O.near||Y!==O.far)&&(r.updateRenderState({depthNear:O.near,depthFar:O.far}),k=O.near,Y=O.far),O.layers.mask=$.layers.mask|6,S.layers.mask=O.layers.mask&3,M.layers.mask=O.layers.mask&5;const Dt=$.parent,Et=O.cameras;yt(O,Dt);for(let Xt=0;Xt<Et.length;Xt++)yt(Et[Xt],Dt);Et.length===2?ut(O,S,M):O.projectionMatrix.copy(S.projectionMatrix),Ht($,O,Dt)};function Ht($,J,ft){ft===null?$.matrix.copy(J.matrixWorld):($.matrix.copy(ft.matrixWorld),$.matrix.invert(),$.matrix.multiply(J.matrixWorld)),$.matrix.decompose($.position,$.quaternion,$.scale),$.updateMatrixWorld(!0),$.projectionMatrix.copy(J.projectionMatrix),$.projectionMatrixInverse.copy(J.projectionMatrixInverse),$.isPerspectiveCamera&&($.fov=Pa*2*Math.atan(1/$.projectionMatrix.elements[5]),$.zoom=1)}this.getCamera=function(){return O},this.getFoveation=function(){if(!(f===null&&m===null))return l},this.setFoveation=function($){l=$,f!==null&&(f.fixedFoveation=$),m!==null&&m.fixedFoveation!==void 0&&(m.fixedFoveation=$)},this.hasDepthSensing=function(){return p.texture!==null},this.getDepthSensingMesh=function(){return p.getMesh(O)},this.getCameraTexture=function($){return u[$]};let ee=null;function re($,J){if(h=J.getViewerPose(c||o),g=J,h!==null){const ft=h.views;m!==null&&(t.setRenderTargetFramebuffer(E,m.framebuffer),t.setRenderTarget(E));let Dt=!1;ft.length!==O.cameras.length&&(O.cameras.length=0,Dt=!0);for(let A=0;A<ft.length;A++){const se=ft[A];let Ut=null;if(m!==null)Ut=m.getViewport(se);else{const gt=d.getViewSubImage(f,se);Ut=gt.viewport,A===0&&(t.setRenderTargetTextures(E,gt.colorTexture,gt.depthStencilTexture),t.setRenderTarget(E))}let Ct=P[A];Ct===void 0&&(Ct=new Qe,Ct.layers.enable(A),Ct.viewport=new he,P[A]=Ct),Ct.matrix.fromArray(se.transform.matrix),Ct.matrix.decompose(Ct.position,Ct.quaternion,Ct.scale),Ct.projectionMatrix.fromArray(se.projectionMatrix),Ct.projectionMatrixInverse.copy(Ct.projectionMatrix).invert(),Ct.viewport.set(Ut.x,Ut.y,Ut.width,Ut.height),A===0&&(O.matrix.copy(Ct.matrix),O.matrix.decompose(O.position,O.quaternion,O.scale)),Dt===!0&&O.cameras.push(Ct)}const Et=r.enabledFeatures;if(Et&&Et.includes("depth-sensing")&&r.depthUsage=="gpu-optimized"&&x){d=n.getBinding();const A=d.getDepthInformation(ft[0]);A&&A.isValid&&A.texture&&p.init(A,r.renderState)}if(Et&&Et.includes("camera-access")&&x){t.state.unbindTexture(),d=n.getBinding();for(let A=0;A<ft.length;A++){const se=ft[A].camera;if(se){let Ut=u[se];Ut||(Ut=new $l,u[se]=Ut);const Ct=d.getCameraImage(se);Ut.sourceTexture=Ct}}}}for(let ft=0;ft<C.length;ft++){const Dt=w[ft],Et=C[ft];Dt!==null&&Et!==void 0&&Et.update(Dt,J,c||o)}ee&&ee($,J),J.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:J}),g=null}const $t=new Kl;$t.setAnimationLoop(re),this.setAnimationLoop=function($){ee=$},this.dispose=function(){}}}const ei=new gn,Rm=new te;function Cm(i,t){function e(p,u){p.matrixAutoUpdate===!0&&p.updateMatrix(),u.value.copy(p.matrix)}function n(p,u){u.color.getRGB(p.fogColor.value,kl(i)),u.isFog?(p.fogNear.value=u.near,p.fogFar.value=u.far):u.isFogExp2&&(p.fogDensity.value=u.density)}function r(p,u,b,T,E){u.isMeshBasicMaterial||u.isMeshLambertMaterial?s(p,u):u.isMeshToonMaterial?(s(p,u),d(p,u)):u.isMeshPhongMaterial?(s(p,u),h(p,u)):u.isMeshStandardMaterial?(s(p,u),f(p,u),u.isMeshPhysicalMaterial&&m(p,u,E)):u.isMeshMatcapMaterial?(s(p,u),g(p,u)):u.isMeshDepthMaterial?s(p,u):u.isMeshDistanceMaterial?(s(p,u),x(p,u)):u.isMeshNormalMaterial?s(p,u):u.isLineBasicMaterial?(o(p,u),u.isLineDashedMaterial&&a(p,u)):u.isPointsMaterial?l(p,u,b,T):u.isSpriteMaterial?c(p,u):u.isShadowMaterial?(p.color.value.copy(u.color),p.opacity.value=u.opacity):u.isShaderMaterial&&(u.uniformsNeedUpdate=!1)}function s(p,u){p.opacity.value=u.opacity,u.color&&p.diffuse.value.copy(u.color),u.emissive&&p.emissive.value.copy(u.emissive).multiplyScalar(u.emissiveIntensity),u.map&&(p.map.value=u.map,e(u.map,p.mapTransform)),u.alphaMap&&(p.alphaMap.value=u.alphaMap,e(u.alphaMap,p.alphaMapTransform)),u.bumpMap&&(p.bumpMap.value=u.bumpMap,e(u.bumpMap,p.bumpMapTransform),p.bumpScale.value=u.bumpScale,u.side===Oe&&(p.bumpScale.value*=-1)),u.normalMap&&(p.normalMap.value=u.normalMap,e(u.normalMap,p.normalMapTransform),p.normalScale.value.copy(u.normalScale),u.side===Oe&&p.normalScale.value.negate()),u.displacementMap&&(p.displacementMap.value=u.displacementMap,e(u.displacementMap,p.displacementMapTransform),p.displacementScale.value=u.displacementScale,p.displacementBias.value=u.displacementBias),u.emissiveMap&&(p.emissiveMap.value=u.emissiveMap,e(u.emissiveMap,p.emissiveMapTransform)),u.specularMap&&(p.specularMap.value=u.specularMap,e(u.specularMap,p.specularMapTransform)),u.alphaTest>0&&(p.alphaTest.value=u.alphaTest);const b=t.get(u),T=b.envMap,E=b.envMapRotation;T&&(p.envMap.value=T,ei.copy(E),ei.x*=-1,ei.y*=-1,ei.z*=-1,T.isCubeTexture&&T.isRenderTargetTexture===!1&&(ei.y*=-1,ei.z*=-1),p.envMapRotation.value.setFromMatrix4(Rm.makeRotationFromEuler(ei)),p.flipEnvMap.value=T.isCubeTexture&&T.isRenderTargetTexture===!1?-1:1,p.reflectivity.value=u.reflectivity,p.ior.value=u.ior,p.refractionRatio.value=u.refractionRatio),u.lightMap&&(p.lightMap.value=u.lightMap,p.lightMapIntensity.value=u.lightMapIntensity,e(u.lightMap,p.lightMapTransform)),u.aoMap&&(p.aoMap.value=u.aoMap,p.aoMapIntensity.value=u.aoMapIntensity,e(u.aoMap,p.aoMapTransform))}function o(p,u){p.diffuse.value.copy(u.color),p.opacity.value=u.opacity,u.map&&(p.map.value=u.map,e(u.map,p.mapTransform))}function a(p,u){p.dashSize.value=u.dashSize,p.totalSize.value=u.dashSize+u.gapSize,p.scale.value=u.scale}function l(p,u,b,T){p.diffuse.value.copy(u.color),p.opacity.value=u.opacity,p.size.value=u.size*b,p.scale.value=T*.5,u.map&&(p.map.value=u.map,e(u.map,p.uvTransform)),u.alphaMap&&(p.alphaMap.value=u.alphaMap,e(u.alphaMap,p.alphaMapTransform)),u.alphaTest>0&&(p.alphaTest.value=u.alphaTest)}function c(p,u){p.diffuse.value.copy(u.color),p.opacity.value=u.opacity,p.rotation.value=u.rotation,u.map&&(p.map.value=u.map,e(u.map,p.mapTransform)),u.alphaMap&&(p.alphaMap.value=u.alphaMap,e(u.alphaMap,p.alphaMapTransform)),u.alphaTest>0&&(p.alphaTest.value=u.alphaTest)}function h(p,u){p.specular.value.copy(u.specular),p.shininess.value=Math.max(u.shininess,1e-4)}function d(p,u){u.gradientMap&&(p.gradientMap.value=u.gradientMap)}function f(p,u){p.metalness.value=u.metalness,u.metalnessMap&&(p.metalnessMap.value=u.metalnessMap,e(u.metalnessMap,p.metalnessMapTransform)),p.roughness.value=u.roughness,u.roughnessMap&&(p.roughnessMap.value=u.roughnessMap,e(u.roughnessMap,p.roughnessMapTransform)),u.envMap&&(p.envMapIntensity.value=u.envMapIntensity)}function m(p,u,b){p.ior.value=u.ior,u.sheen>0&&(p.sheenColor.value.copy(u.sheenColor).multiplyScalar(u.sheen),p.sheenRoughness.value=u.sheenRoughness,u.sheenColorMap&&(p.sheenColorMap.value=u.sheenColorMap,e(u.sheenColorMap,p.sheenColorMapTransform)),u.sheenRoughnessMap&&(p.sheenRoughnessMap.value=u.sheenRoughnessMap,e(u.sheenRoughnessMap,p.sheenRoughnessMapTransform))),u.clearcoat>0&&(p.clearcoat.value=u.clearcoat,p.clearcoatRoughness.value=u.clearcoatRoughness,u.clearcoatMap&&(p.clearcoatMap.value=u.clearcoatMap,e(u.clearcoatMap,p.clearcoatMapTransform)),u.clearcoatRoughnessMap&&(p.clearcoatRoughnessMap.value=u.clearcoatRoughnessMap,e(u.clearcoatRoughnessMap,p.clearcoatRoughnessMapTransform)),u.clearcoatNormalMap&&(p.clearcoatNormalMap.value=u.clearcoatNormalMap,e(u.clearcoatNormalMap,p.clearcoatNormalMapTransform),p.clearcoatNormalScale.value.copy(u.clearcoatNormalScale),u.side===Oe&&p.clearcoatNormalScale.value.negate())),u.dispersion>0&&(p.dispersion.value=u.dispersion),u.iridescence>0&&(p.iridescence.value=u.iridescence,p.iridescenceIOR.value=u.iridescenceIOR,p.iridescenceThicknessMinimum.value=u.iridescenceThicknessRange[0],p.iridescenceThicknessMaximum.value=u.iridescenceThicknessRange[1],u.iridescenceMap&&(p.iridescenceMap.value=u.iridescenceMap,e(u.iridescenceMap,p.iridescenceMapTransform)),u.iridescenceThicknessMap&&(p.iridescenceThicknessMap.value=u.iridescenceThicknessMap,e(u.iridescenceThicknessMap,p.iridescenceThicknessMapTransform))),u.transmission>0&&(p.transmission.value=u.transmission,p.transmissionSamplerMap.value=b.texture,p.transmissionSamplerSize.value.set(b.width,b.height),u.transmissionMap&&(p.transmissionMap.value=u.transmissionMap,e(u.transmissionMap,p.transmissionMapTransform)),p.thickness.value=u.thickness,u.thicknessMap&&(p.thicknessMap.value=u.thicknessMap,e(u.thicknessMap,p.thicknessMapTransform)),p.attenuationDistance.value=u.attenuationDistance,p.attenuationColor.value.copy(u.attenuationColor)),u.anisotropy>0&&(p.anisotropyVector.value.set(u.anisotropy*Math.cos(u.anisotropyRotation),u.anisotropy*Math.sin(u.anisotropyRotation)),u.anisotropyMap&&(p.anisotropyMap.value=u.anisotropyMap,e(u.anisotropyMap,p.anisotropyMapTransform))),p.specularIntensity.value=u.specularIntensity,p.specularColor.value.copy(u.specularColor),u.specularColorMap&&(p.specularColorMap.value=u.specularColorMap,e(u.specularColorMap,p.specularColorMapTransform)),u.specularIntensityMap&&(p.specularIntensityMap.value=u.specularIntensityMap,e(u.specularIntensityMap,p.specularIntensityMapTransform))}function g(p,u){u.matcap&&(p.matcap.value=u.matcap)}function x(p,u){const b=t.get(u).light;p.referencePosition.value.setFromMatrixPosition(b.matrixWorld),p.nearDistance.value=b.shadow.camera.near,p.farDistance.value=b.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:r}}function Pm(i,t,e,n){let r={},s={},o=[];const a=i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS);function l(b,T){const E=T.program;n.uniformBlockBinding(b,E)}function c(b,T){let E=r[b.id];E===void 0&&(g(b),E=h(b),r[b.id]=E,b.addEventListener("dispose",p));const C=T.program;n.updateUBOMapping(b,C);const w=t.render.frame;s[b.id]!==w&&(f(b),s[b.id]=w)}function h(b){const T=d();b.__bindingPointIndex=T;const E=i.createBuffer(),C=b.__size,w=b.usage;return i.bindBuffer(i.UNIFORM_BUFFER,E),i.bufferData(i.UNIFORM_BUFFER,C,w),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,T,E),E}function d(){for(let b=0;b<a;b++)if(o.indexOf(b)===-1)return o.push(b),b;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function f(b){const T=r[b.id],E=b.uniforms,C=b.__cache;i.bindBuffer(i.UNIFORM_BUFFER,T);for(let w=0,R=E.length;w<R;w++){const U=Array.isArray(E[w])?E[w]:[E[w]];for(let S=0,M=U.length;S<M;S++){const P=U[S];if(m(P,w,S,C)===!0){const O=P.__offset,k=Array.isArray(P.value)?P.value:[P.value];let Y=0;for(let X=0;X<k.length;X++){const q=k[X],Z=x(q);typeof q=="number"||typeof q=="boolean"?(P.__data[0]=q,i.bufferSubData(i.UNIFORM_BUFFER,O+Y,P.__data)):q.isMatrix3?(P.__data[0]=q.elements[0],P.__data[1]=q.elements[1],P.__data[2]=q.elements[2],P.__data[3]=0,P.__data[4]=q.elements[3],P.__data[5]=q.elements[4],P.__data[6]=q.elements[5],P.__data[7]=0,P.__data[8]=q.elements[6],P.__data[9]=q.elements[7],P.__data[10]=q.elements[8],P.__data[11]=0):(q.toArray(P.__data,Y),Y+=Z.storage/Float32Array.BYTES_PER_ELEMENT)}i.bufferSubData(i.UNIFORM_BUFFER,O,P.__data)}}}i.bindBuffer(i.UNIFORM_BUFFER,null)}function m(b,T,E,C){const w=b.value,R=T+"_"+E;if(C[R]===void 0)return typeof w=="number"||typeof w=="boolean"?C[R]=w:C[R]=w.clone(),!0;{const U=C[R];if(typeof w=="number"||typeof w=="boolean"){if(U!==w)return C[R]=w,!0}else if(U.equals(w)===!1)return U.copy(w),!0}return!1}function g(b){const T=b.uniforms;let E=0;const C=16;for(let R=0,U=T.length;R<U;R++){const S=Array.isArray(T[R])?T[R]:[T[R]];for(let M=0,P=S.length;M<P;M++){const O=S[M],k=Array.isArray(O.value)?O.value:[O.value];for(let Y=0,X=k.length;Y<X;Y++){const q=k[Y],Z=x(q),V=E%C,at=V%Z.boundary,ut=V+at;E+=at,ut!==0&&C-ut<Z.storage&&(E+=C-ut),O.__data=new Float32Array(Z.storage/Float32Array.BYTES_PER_ELEMENT),O.__offset=E,E+=Z.storage}}}const w=E%C;return w>0&&(E+=C-w),b.__size=E,b.__cache={},this}function x(b){const T={boundary:0,storage:0};return typeof b=="number"||typeof b=="boolean"?(T.boundary=4,T.storage=4):b.isVector2?(T.boundary=8,T.storage=8):b.isVector3||b.isColor?(T.boundary=16,T.storage=12):b.isVector4?(T.boundary=16,T.storage=16):b.isMatrix3?(T.boundary=48,T.storage=48):b.isMatrix4?(T.boundary=64,T.storage=64):b.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",b),T}function p(b){const T=b.target;T.removeEventListener("dispose",p);const E=o.indexOf(T.__bindingPointIndex);o.splice(E,1),i.deleteBuffer(r[T.id]),delete r[T.id],delete s[T.id]}function u(){for(const b in r)i.deleteBuffer(r[b]);o=[],r={},s={}}return{bind:l,update:c,dispose:u}}class Dm{constructor(t={}){const{canvas:e=su(),context:n=null,depth:r=!0,stencil:s=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:d=!1,reversedDepthBuffer:f=!1}=t;this.isWebGLRenderer=!0;let m;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");m=n.getContextAttributes().alpha}else m=o;const g=new Uint32Array(4),x=new Int32Array(4);let p=null,u=null;const b=[],T=[];this.domElement=e,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=kn,this.toneMappingExposure=1,this.transmissionResolutionScale=1;const E=this;let C=!1;this._outputColorSpace=Le;let w=0,R=0,U=null,S=-1,M=null;const P=new he,O=new he;let k=null;const Y=new Vt(0);let X=0,q=e.width,Z=e.height,V=1,at=null,ut=null;const yt=new he(0,0,q,Z),Ht=new he(0,0,q,Z);let ee=!1;const re=new Ya;let $t=!1,$=!1;const J=new te,ft=new F,Dt=new he,Et={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let Xt=!1;function Me(){return U===null?V:1}let A=n;function se(v,L){return e.getContext(v,L)}try{const v={alpha:!0,depth:r,stencil:s,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:h,failIfMajorPerformanceCaveat:d};if("setAttribute"in e&&e.setAttribute("data-engine",`three.js r${Fa}`),e.addEventListener("webglcontextlost",rt,!1),e.addEventListener("webglcontextrestored",dt,!1),e.addEventListener("webglcontextcreationerror",Q,!1),A===null){const L="webgl2";if(A=se(L,v),A===null)throw se(L)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(v){throw console.error("THREE.WebGLRenderer: "+v.message),v}let Ut,Ct,gt,ae,_t,Bt,ve,de,y,_,N,W,j,G,St,it,vt,xt,et,ct,Rt,Mt,ot,Nt;function D(){Ut=new kf(A),Ut.init(),Mt=new ym(A,Ut),Ct=new Uf(A,Ut,t,Mt),gt=new Sm(A,Ut),Ct.reversedDepthBuffer&&f&&gt.buffers.depth.setReversed(!0),ae=new Wf(A),_t=new lm,Bt=new Em(A,Ut,gt,_t,Ct,Mt,ae),ve=new Ff(E),de=new Hf(E),y=new Ku(A),ot=new Lf(A,y),_=new Vf(A,y,ae,ot),N=new qf(A,_,y,ae),et=new Xf(A,Ct,Bt),it=new Nf(_t),W=new om(E,ve,de,Ut,Ct,ot,it),j=new Cm(E,_t),G=new um,St=new gm(Ut),xt=new Df(E,ve,de,gt,N,m,l),vt=new xm(E,N,Ct),Nt=new Pm(A,ae,Ct,gt),ct=new If(A,Ut,ae),Rt=new Gf(A,Ut,ae),ae.programs=W.programs,E.capabilities=Ct,E.extensions=Ut,E.properties=_t,E.renderLists=G,E.shadowMap=vt,E.state=gt,E.info=ae}D();const nt=new wm(E,A);this.xr=nt,this.getContext=function(){return A},this.getContextAttributes=function(){return A.getContextAttributes()},this.forceContextLoss=function(){const v=Ut.get("WEBGL_lose_context");v&&v.loseContext()},this.forceContextRestore=function(){const v=Ut.get("WEBGL_lose_context");v&&v.restoreContext()},this.getPixelRatio=function(){return V},this.setPixelRatio=function(v){v!==void 0&&(V=v,this.setSize(q,Z,!1))},this.getSize=function(v){return v.set(q,Z)},this.setSize=function(v,L,B=!0){if(nt.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}q=v,Z=L,e.width=Math.floor(v*V),e.height=Math.floor(L*V),B===!0&&(e.style.width=v+"px",e.style.height=L+"px"),this.setViewport(0,0,v,L)},this.getDrawingBufferSize=function(v){return v.set(q*V,Z*V).floor()},this.setDrawingBufferSize=function(v,L,B){q=v,Z=L,V=B,e.width=Math.floor(v*B),e.height=Math.floor(L*B),this.setViewport(0,0,v,L)},this.getCurrentViewport=function(v){return v.copy(P)},this.getViewport=function(v){return v.copy(yt)},this.setViewport=function(v,L,B,z){v.isVector4?yt.set(v.x,v.y,v.z,v.w):yt.set(v,L,B,z),gt.viewport(P.copy(yt).multiplyScalar(V).round())},this.getScissor=function(v){return v.copy(Ht)},this.setScissor=function(v,L,B,z){v.isVector4?Ht.set(v.x,v.y,v.z,v.w):Ht.set(v,L,B,z),gt.scissor(O.copy(Ht).multiplyScalar(V).round())},this.getScissorTest=function(){return ee},this.setScissorTest=function(v){gt.setScissorTest(ee=v)},this.setOpaqueSort=function(v){at=v},this.setTransparentSort=function(v){ut=v},this.getClearColor=function(v){return v.copy(xt.getClearColor())},this.setClearColor=function(){xt.setClearColor(...arguments)},this.getClearAlpha=function(){return xt.getClearAlpha()},this.setClearAlpha=function(){xt.setClearAlpha(...arguments)},this.clear=function(v=!0,L=!0,B=!0){let z=0;if(v){let I=!1;if(U!==null){const tt=U.texture.format;I=tt===Ga||tt===Va||tt===ka}if(I){const tt=U.texture.type,lt=tt===mn||tt===hi||tt===or||tt===lr||tt===Ba||tt===za,pt=xt.getClearColor(),ht=xt.getClearAlpha(),wt=pt.r,Pt=pt.g,bt=pt.b;lt?(g[0]=wt,g[1]=Pt,g[2]=bt,g[3]=ht,A.clearBufferuiv(A.COLOR,0,g)):(x[0]=wt,x[1]=Pt,x[2]=bt,x[3]=ht,A.clearBufferiv(A.COLOR,0,x))}else z|=A.COLOR_BUFFER_BIT}L&&(z|=A.DEPTH_BUFFER_BIT),B&&(z|=A.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),A.clear(z)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){e.removeEventListener("webglcontextlost",rt,!1),e.removeEventListener("webglcontextrestored",dt,!1),e.removeEventListener("webglcontextcreationerror",Q,!1),xt.dispose(),G.dispose(),St.dispose(),_t.dispose(),ve.dispose(),de.dispose(),N.dispose(),ot.dispose(),Nt.dispose(),W.dispose(),nt.dispose(),nt.removeEventListener("sessionstart",an),nt.removeEventListener("sessionend",ro),$n.stop()};function rt(v){v.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),C=!0}function dt(){console.log("THREE.WebGLRenderer: Context Restored."),C=!1;const v=ae.autoReset,L=vt.enabled,B=vt.autoUpdate,z=vt.needsUpdate,I=vt.type;D(),ae.autoReset=v,vt.enabled=L,vt.autoUpdate=B,vt.needsUpdate=z,vt.type=I}function Q(v){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",v.statusMessage)}function K(v){const L=v.target;L.removeEventListener("dispose",K),mt(L)}function mt(v){It(v),_t.remove(v)}function It(v){const L=_t.get(v).programs;L!==void 0&&(L.forEach(function(B){W.releaseProgram(B)}),v.isShaderMaterial&&W.releaseShaderCache(v))}this.renderBufferDirect=function(v,L,B,z,I,tt){L===null&&(L=Et);const lt=I.isMesh&&I.matrixWorld.determinant()<0,pt=fc(v,L,B,z,I);gt.setMaterial(z,lt);let ht=B.index,wt=1;if(z.wireframe===!0){if(ht=_.getWireframeAttribute(B),ht===void 0)return;wt=2}const Pt=B.drawRange,bt=B.attributes.position;let kt=Pt.start*wt,jt=(Pt.start+Pt.count)*wt;tt!==null&&(kt=Math.max(kt,tt.start*wt),jt=Math.min(jt,(tt.start+tt.count)*wt)),ht!==null?(kt=Math.max(kt,0),jt=Math.min(jt,ht.count)):bt!=null&&(kt=Math.max(kt,0),jt=Math.min(jt,bt.count));const ue=jt-kt;if(ue<0||ue===1/0)return;ot.setup(I,z,pt,B,ht);let ie,Qt=ct;if(ht!==null&&(ie=y.get(ht),Qt=Rt,Qt.setIndex(ie)),I.isMesh)z.wireframe===!0?(gt.setLineWidth(z.wireframeLinewidth*Me()),Qt.setMode(A.LINES)):Qt.setMode(A.TRIANGLES);else if(I.isLine){let At=z.linewidth;At===void 0&&(At=1),gt.setLineWidth(At*Me()),I.isLineSegments?Qt.setMode(A.LINES):I.isLineLoop?Qt.setMode(A.LINE_LOOP):Qt.setMode(A.LINE_STRIP)}else I.isPoints?Qt.setMode(A.POINTS):I.isSprite&&Qt.setMode(A.TRIANGLES);if(I.isBatchedMesh)if(I._multiDrawInstances!==null)hr("THREE.WebGLRenderer: renderMultiDrawInstances has been deprecated and will be removed in r184. Append to renderMultiDraw arguments and use indirection."),Qt.renderMultiDrawInstances(I._multiDrawStarts,I._multiDrawCounts,I._multiDrawCount,I._multiDrawInstances);else if(Ut.get("WEBGL_multi_draw"))Qt.renderMultiDraw(I._multiDrawStarts,I._multiDrawCounts,I._multiDrawCount);else{const At=I._multiDrawStarts,oe=I._multiDrawCounts,qt=I._multiDrawCount,Be=ht?y.get(ht).bytesPerElement:1,_i=_t.get(z).currentProgram.getUniforms();for(let ze=0;ze<qt;ze++)_i.setValue(A,"_gl_DrawID",ze),Qt.render(At[ze]/Be,oe[ze])}else if(I.isInstancedMesh)Qt.renderInstances(kt,ue,I.count);else if(B.isInstancedBufferGeometry){const At=B._maxInstanceCount!==void 0?B._maxInstanceCount:1/0,oe=Math.min(B.instanceCount,At);Qt.renderInstances(kt,ue,oe)}else Qt.render(kt,ue)};function ne(v,L,B){v.transparent===!0&&v.side===un&&v.forceSinglePass===!1?(v.side=Oe,v.needsUpdate=!0,_r(v,L,B),v.side=Xn,v.needsUpdate=!0,_r(v,L,B),v.side=un):_r(v,L,B)}this.compile=function(v,L,B=null){B===null&&(B=v),u=St.get(B),u.init(L),T.push(u),B.traverseVisible(function(I){I.isLight&&I.layers.test(L.layers)&&(u.pushLight(I),I.castShadow&&u.pushShadow(I))}),v!==B&&v.traverseVisible(function(I){I.isLight&&I.layers.test(L.layers)&&(u.pushLight(I),I.castShadow&&u.pushShadow(I))}),u.setupLights();const z=new Set;return v.traverse(function(I){if(!(I.isMesh||I.isPoints||I.isLine||I.isSprite))return;const tt=I.material;if(tt)if(Array.isArray(tt))for(let lt=0;lt<tt.length;lt++){const pt=tt[lt];ne(pt,B,I),z.add(pt)}else ne(tt,B,I),z.add(tt)}),u=T.pop(),z},this.compileAsync=function(v,L,B=null){const z=this.compile(v,L,B);return new Promise(I=>{function tt(){if(z.forEach(function(lt){_t.get(lt).currentProgram.isReady()&&z.delete(lt)}),z.size===0){I(v);return}setTimeout(tt,10)}Ut.get("KHR_parallel_shader_compile")!==null?tt():setTimeout(tt,10)})};let Kt=null;function vn(v){Kt&&Kt(v)}function an(){$n.stop()}function ro(){$n.start()}const $n=new Kl;$n.setAnimationLoop(vn),typeof self<"u"&&$n.setContext(self),this.setAnimationLoop=function(v){Kt=v,nt.setAnimationLoop(v),v===null?$n.stop():$n.start()},nt.addEventListener("sessionstart",an),nt.addEventListener("sessionend",ro),this.render=function(v,L){if(L!==void 0&&L.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(C===!0)return;if(v.matrixWorldAutoUpdate===!0&&v.updateMatrixWorld(),L.parent===null&&L.matrixWorldAutoUpdate===!0&&L.updateMatrixWorld(),nt.enabled===!0&&nt.isPresenting===!0&&(nt.cameraAutoUpdate===!0&&nt.updateCamera(L),L=nt.getCamera()),v.isScene===!0&&v.onBeforeRender(E,v,L,U),u=St.get(v,T.length),u.init(L),T.push(u),J.multiplyMatrices(L.projectionMatrix,L.matrixWorldInverse),re.setFromProjectionMatrix(J,pn,L.reversedDepth),$=this.localClippingEnabled,$t=it.init(this.clippingPlanes,$),p=G.get(v,b.length),p.init(),b.push(p),nt.enabled===!0&&nt.isPresenting===!0){const tt=E.xr.getDepthSensingMesh();tt!==null&&ss(tt,L,-1/0,E.sortObjects)}ss(v,L,0,E.sortObjects),p.finish(),E.sortObjects===!0&&p.sort(at,ut),Xt=nt.enabled===!1||nt.isPresenting===!1||nt.hasDepthSensing()===!1,Xt&&xt.addToRenderList(p,v),this.info.render.frame++,$t===!0&&it.beginShadows();const B=u.state.shadowsArray;vt.render(B,v,L),$t===!0&&it.endShadows(),this.info.autoReset===!0&&this.info.reset();const z=p.opaque,I=p.transmissive;if(u.setupLights(),L.isArrayCamera){const tt=L.cameras;if(I.length>0)for(let lt=0,pt=tt.length;lt<pt;lt++){const ht=tt[lt];ao(z,I,v,ht)}Xt&&xt.render(v);for(let lt=0,pt=tt.length;lt<pt;lt++){const ht=tt[lt];so(p,v,ht,ht.viewport)}}else I.length>0&&ao(z,I,v,L),Xt&&xt.render(v),so(p,v,L);U!==null&&R===0&&(Bt.updateMultisampleRenderTarget(U),Bt.updateRenderTargetMipmap(U)),v.isScene===!0&&v.onAfterRender(E,v,L),ot.resetDefaultState(),S=-1,M=null,T.pop(),T.length>0?(u=T[T.length-1],$t===!0&&it.setGlobalState(E.clippingPlanes,u.state.camera)):u=null,b.pop(),b.length>0?p=b[b.length-1]:p=null};function ss(v,L,B,z){if(v.visible===!1)return;if(v.layers.test(L.layers)){if(v.isGroup)B=v.renderOrder;else if(v.isLOD)v.autoUpdate===!0&&v.update(L);else if(v.isLight)u.pushLight(v),v.castShadow&&u.pushShadow(v);else if(v.isSprite){if(!v.frustumCulled||re.intersectsSprite(v)){z&&Dt.setFromMatrixPosition(v.matrixWorld).applyMatrix4(J);const lt=N.update(v),pt=v.material;pt.visible&&p.push(v,lt,pt,B,Dt.z,null)}}else if((v.isMesh||v.isLine||v.isPoints)&&(!v.frustumCulled||re.intersectsObject(v))){const lt=N.update(v),pt=v.material;if(z&&(v.boundingSphere!==void 0?(v.boundingSphere===null&&v.computeBoundingSphere(),Dt.copy(v.boundingSphere.center)):(lt.boundingSphere===null&&lt.computeBoundingSphere(),Dt.copy(lt.boundingSphere.center)),Dt.applyMatrix4(v.matrixWorld).applyMatrix4(J)),Array.isArray(pt)){const ht=lt.groups;for(let wt=0,Pt=ht.length;wt<Pt;wt++){const bt=ht[wt],kt=pt[bt.materialIndex];kt&&kt.visible&&p.push(v,lt,kt,B,Dt.z,bt)}}else pt.visible&&p.push(v,lt,pt,B,Dt.z,null)}}const tt=v.children;for(let lt=0,pt=tt.length;lt<pt;lt++)ss(tt[lt],L,B,z)}function so(v,L,B,z){const I=v.opaque,tt=v.transmissive,lt=v.transparent;u.setupLightsView(B),$t===!0&&it.setGlobalState(E.clippingPlanes,B),z&&gt.viewport(P.copy(z)),I.length>0&&gr(I,L,B),tt.length>0&&gr(tt,L,B),lt.length>0&&gr(lt,L,B),gt.buffers.depth.setTest(!0),gt.buffers.depth.setMask(!0),gt.buffers.color.setMask(!0),gt.setPolygonOffset(!1)}function ao(v,L,B,z){if((B.isScene===!0?B.overrideMaterial:null)!==null)return;u.state.transmissionRenderTarget[z.id]===void 0&&(u.state.transmissionRenderTarget[z.id]=new di(1,1,{generateMipmaps:!0,type:Ut.has("EXT_color_buffer_half_float")||Ut.has("EXT_color_buffer_float")?dr:mn,minFilter:li,samples:4,stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:Yt.workingColorSpace}));const tt=u.state.transmissionRenderTarget[z.id],lt=z.viewport||P;tt.setSize(lt.z*E.transmissionResolutionScale,lt.w*E.transmissionResolutionScale);const pt=E.getRenderTarget(),ht=E.getActiveCubeFace(),wt=E.getActiveMipmapLevel();E.setRenderTarget(tt),E.getClearColor(Y),X=E.getClearAlpha(),X<1&&E.setClearColor(16777215,.5),E.clear(),Xt&&xt.render(B);const Pt=E.toneMapping;E.toneMapping=kn;const bt=z.viewport;if(z.viewport!==void 0&&(z.viewport=void 0),u.setupLightsView(z),$t===!0&&it.setGlobalState(E.clippingPlanes,z),gr(v,B,z),Bt.updateMultisampleRenderTarget(tt),Bt.updateRenderTargetMipmap(tt),Ut.has("WEBGL_multisampled_render_to_texture")===!1){let kt=!1;for(let jt=0,ue=L.length;jt<ue;jt++){const ie=L[jt],Qt=ie.object,At=ie.geometry,oe=ie.material,qt=ie.group;if(oe.side===un&&Qt.layers.test(z.layers)){const Be=oe.side;oe.side=Oe,oe.needsUpdate=!0,oo(Qt,B,z,At,oe,qt),oe.side=Be,oe.needsUpdate=!0,kt=!0}}kt===!0&&(Bt.updateMultisampleRenderTarget(tt),Bt.updateRenderTargetMipmap(tt))}E.setRenderTarget(pt,ht,wt),E.setClearColor(Y,X),bt!==void 0&&(z.viewport=bt),E.toneMapping=Pt}function gr(v,L,B){const z=L.isScene===!0?L.overrideMaterial:null;for(let I=0,tt=v.length;I<tt;I++){const lt=v[I],pt=lt.object,ht=lt.geometry,wt=lt.group;let Pt=lt.material;Pt.allowOverride===!0&&z!==null&&(Pt=z),pt.layers.test(B.layers)&&oo(pt,L,B,ht,Pt,wt)}}function oo(v,L,B,z,I,tt){v.onBeforeRender(E,L,B,z,I,tt),v.modelViewMatrix.multiplyMatrices(B.matrixWorldInverse,v.matrixWorld),v.normalMatrix.getNormalMatrix(v.modelViewMatrix),I.onBeforeRender(E,L,B,z,v,tt),I.transparent===!0&&I.side===un&&I.forceSinglePass===!1?(I.side=Oe,I.needsUpdate=!0,E.renderBufferDirect(B,L,z,I,v,tt),I.side=Xn,I.needsUpdate=!0,E.renderBufferDirect(B,L,z,I,v,tt),I.side=un):E.renderBufferDirect(B,L,z,I,v,tt),v.onAfterRender(E,L,B,z,I,tt)}function _r(v,L,B){L.isScene!==!0&&(L=Et);const z=_t.get(v),I=u.state.lights,tt=u.state.shadowsArray,lt=I.state.version,pt=W.getParameters(v,I.state,tt,L,B),ht=W.getProgramCacheKey(pt);let wt=z.programs;z.environment=v.isMeshStandardMaterial?L.environment:null,z.fog=L.fog,z.envMap=(v.isMeshStandardMaterial?de:ve).get(v.envMap||z.environment),z.envMapRotation=z.environment!==null&&v.envMap===null?L.environmentRotation:v.envMapRotation,wt===void 0&&(v.addEventListener("dispose",K),wt=new Map,z.programs=wt);let Pt=wt.get(ht);if(Pt!==void 0){if(z.currentProgram===Pt&&z.lightsStateVersion===lt)return co(v,pt),Pt}else pt.uniforms=W.getUniforms(v),v.onBeforeCompile(pt,E),Pt=W.acquireProgram(pt,ht),wt.set(ht,Pt),z.uniforms=pt.uniforms;const bt=z.uniforms;return(!v.isShaderMaterial&&!v.isRawShaderMaterial||v.clipping===!0)&&(bt.clippingPlanes=it.uniform),co(v,pt),z.needsLights=mc(v),z.lightsStateVersion=lt,z.needsLights&&(bt.ambientLightColor.value=I.state.ambient,bt.lightProbe.value=I.state.probe,bt.directionalLights.value=I.state.directional,bt.directionalLightShadows.value=I.state.directionalShadow,bt.spotLights.value=I.state.spot,bt.spotLightShadows.value=I.state.spotShadow,bt.rectAreaLights.value=I.state.rectArea,bt.ltc_1.value=I.state.rectAreaLTC1,bt.ltc_2.value=I.state.rectAreaLTC2,bt.pointLights.value=I.state.point,bt.pointLightShadows.value=I.state.pointShadow,bt.hemisphereLights.value=I.state.hemi,bt.directionalShadowMap.value=I.state.directionalShadowMap,bt.directionalShadowMatrix.value=I.state.directionalShadowMatrix,bt.spotShadowMap.value=I.state.spotShadowMap,bt.spotLightMatrix.value=I.state.spotLightMatrix,bt.spotLightMap.value=I.state.spotLightMap,bt.pointShadowMap.value=I.state.pointShadowMap,bt.pointShadowMatrix.value=I.state.pointShadowMatrix),z.currentProgram=Pt,z.uniformsList=null,Pt}function lo(v){if(v.uniformsList===null){const L=v.currentProgram.getUniforms();v.uniformsList=$r.seqWithValue(L.seq,v.uniforms)}return v.uniformsList}function co(v,L){const B=_t.get(v);B.outputColorSpace=L.outputColorSpace,B.batching=L.batching,B.batchingColor=L.batchingColor,B.instancing=L.instancing,B.instancingColor=L.instancingColor,B.instancingMorph=L.instancingMorph,B.skinning=L.skinning,B.morphTargets=L.morphTargets,B.morphNormals=L.morphNormals,B.morphColors=L.morphColors,B.morphTargetsCount=L.morphTargetsCount,B.numClippingPlanes=L.numClippingPlanes,B.numIntersection=L.numClipIntersection,B.vertexAlphas=L.vertexAlphas,B.vertexTangents=L.vertexTangents,B.toneMapping=L.toneMapping}function fc(v,L,B,z,I){L.isScene!==!0&&(L=Et),Bt.resetTextureUnits();const tt=L.fog,lt=z.isMeshStandardMaterial?L.environment:null,pt=U===null?E.outputColorSpace:U.isXRRenderTarget===!0?U.texture.colorSpace:Gi,ht=(z.isMeshStandardMaterial?de:ve).get(z.envMap||lt),wt=z.vertexColors===!0&&!!B.attributes.color&&B.attributes.color.itemSize===4,Pt=!!B.attributes.tangent&&(!!z.normalMap||z.anisotropy>0),bt=!!B.morphAttributes.position,kt=!!B.morphAttributes.normal,jt=!!B.morphAttributes.color;let ue=kn;z.toneMapped&&(U===null||U.isXRRenderTarget===!0)&&(ue=E.toneMapping);const ie=B.morphAttributes.position||B.morphAttributes.normal||B.morphAttributes.color,Qt=ie!==void 0?ie.length:0,At=_t.get(z),oe=u.state.lights;if($t===!0&&($===!0||v!==M)){const Re=v===M&&z.id===S;it.setState(z,v,Re)}let qt=!1;z.version===At.__version?(At.needsLights&&At.lightsStateVersion!==oe.state.version||At.outputColorSpace!==pt||I.isBatchedMesh&&At.batching===!1||!I.isBatchedMesh&&At.batching===!0||I.isBatchedMesh&&At.batchingColor===!0&&I.colorTexture===null||I.isBatchedMesh&&At.batchingColor===!1&&I.colorTexture!==null||I.isInstancedMesh&&At.instancing===!1||!I.isInstancedMesh&&At.instancing===!0||I.isSkinnedMesh&&At.skinning===!1||!I.isSkinnedMesh&&At.skinning===!0||I.isInstancedMesh&&At.instancingColor===!0&&I.instanceColor===null||I.isInstancedMesh&&At.instancingColor===!1&&I.instanceColor!==null||I.isInstancedMesh&&At.instancingMorph===!0&&I.morphTexture===null||I.isInstancedMesh&&At.instancingMorph===!1&&I.morphTexture!==null||At.envMap!==ht||z.fog===!0&&At.fog!==tt||At.numClippingPlanes!==void 0&&(At.numClippingPlanes!==it.numPlanes||At.numIntersection!==it.numIntersection)||At.vertexAlphas!==wt||At.vertexTangents!==Pt||At.morphTargets!==bt||At.morphNormals!==kt||At.morphColors!==jt||At.toneMapping!==ue||At.morphTargetsCount!==Qt)&&(qt=!0):(qt=!0,At.__version=z.version);let Be=At.currentProgram;qt===!0&&(Be=_r(z,L,I));let _i=!1,ze=!1,$i=!1;const le=Be.getUniforms(),Ve=At.uniforms;if(gt.useProgram(Be.program)&&(_i=!0,ze=!0,$i=!0),z.id!==S&&(S=z.id,ze=!0),_i||M!==v){gt.buffers.depth.getReversed()&&v.reversedDepth!==!0&&(v._reversedDepth=!0,v.updateProjectionMatrix()),le.setValue(A,"projectionMatrix",v.projectionMatrix),le.setValue(A,"viewMatrix",v.matrixWorldInverse);const Fe=le.map.cameraPosition;Fe!==void 0&&Fe.setValue(A,ft.setFromMatrixPosition(v.matrixWorld)),Ct.logarithmicDepthBuffer&&le.setValue(A,"logDepthBufFC",2/(Math.log(v.far+1)/Math.LN2)),(z.isMeshPhongMaterial||z.isMeshToonMaterial||z.isMeshLambertMaterial||z.isMeshBasicMaterial||z.isMeshStandardMaterial||z.isShaderMaterial)&&le.setValue(A,"isOrthographic",v.isOrthographicCamera===!0),M!==v&&(M=v,ze=!0,$i=!0)}if(I.isSkinnedMesh){le.setOptional(A,I,"bindMatrix"),le.setOptional(A,I,"bindMatrixInverse");const Re=I.skeleton;Re&&(Re.boneTexture===null&&Re.computeBoneTexture(),le.setValue(A,"boneTexture",Re.boneTexture,Bt))}I.isBatchedMesh&&(le.setOptional(A,I,"batchingTexture"),le.setValue(A,"batchingTexture",I._matricesTexture,Bt),le.setOptional(A,I,"batchingIdTexture"),le.setValue(A,"batchingIdTexture",I._indirectTexture,Bt),le.setOptional(A,I,"batchingColorTexture"),I._colorsTexture!==null&&le.setValue(A,"batchingColorTexture",I._colorsTexture,Bt));const Ge=B.morphAttributes;if((Ge.position!==void 0||Ge.normal!==void 0||Ge.color!==void 0)&&et.update(I,B,Be),(ze||At.receiveShadow!==I.receiveShadow)&&(At.receiveShadow=I.receiveShadow,le.setValue(A,"receiveShadow",I.receiveShadow)),z.isMeshGouraudMaterial&&z.envMap!==null&&(Ve.envMap.value=ht,Ve.flipEnvMap.value=ht.isCubeTexture&&ht.isRenderTargetTexture===!1?-1:1),z.isMeshStandardMaterial&&z.envMap===null&&L.environment!==null&&(Ve.envMapIntensity.value=L.environmentIntensity),ze&&(le.setValue(A,"toneMappingExposure",E.toneMappingExposure),At.needsLights&&pc(Ve,$i),tt&&z.fog===!0&&j.refreshFogUniforms(Ve,tt),j.refreshMaterialUniforms(Ve,z,V,Z,u.state.transmissionRenderTarget[v.id]),$r.upload(A,lo(At),Ve,Bt)),z.isShaderMaterial&&z.uniformsNeedUpdate===!0&&($r.upload(A,lo(At),Ve,Bt),z.uniformsNeedUpdate=!1),z.isSpriteMaterial&&le.setValue(A,"center",I.center),le.setValue(A,"modelViewMatrix",I.modelViewMatrix),le.setValue(A,"normalMatrix",I.normalMatrix),le.setValue(A,"modelMatrix",I.matrixWorld),z.isShaderMaterial||z.isRawShaderMaterial){const Re=z.uniformsGroups;for(let Fe=0,as=Re.length;Fe<as;Fe++){const Kn=Re[Fe];Nt.update(Kn,Be),Nt.bind(Kn,Be)}}return Be}function pc(v,L){v.ambientLightColor.needsUpdate=L,v.lightProbe.needsUpdate=L,v.directionalLights.needsUpdate=L,v.directionalLightShadows.needsUpdate=L,v.pointLights.needsUpdate=L,v.pointLightShadows.needsUpdate=L,v.spotLights.needsUpdate=L,v.spotLightShadows.needsUpdate=L,v.rectAreaLights.needsUpdate=L,v.hemisphereLights.needsUpdate=L}function mc(v){return v.isMeshLambertMaterial||v.isMeshToonMaterial||v.isMeshPhongMaterial||v.isMeshStandardMaterial||v.isShadowMaterial||v.isShaderMaterial&&v.lights===!0}this.getActiveCubeFace=function(){return w},this.getActiveMipmapLevel=function(){return R},this.getRenderTarget=function(){return U},this.setRenderTargetTextures=function(v,L,B){const z=_t.get(v);z.__autoAllocateDepthBuffer=v.resolveDepthBuffer===!1,z.__autoAllocateDepthBuffer===!1&&(z.__useRenderToTexture=!1),_t.get(v.texture).__webglTexture=L,_t.get(v.depthTexture).__webglTexture=z.__autoAllocateDepthBuffer?void 0:B,z.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(v,L){const B=_t.get(v);B.__webglFramebuffer=L,B.__useDefaultFramebuffer=L===void 0};const gc=A.createFramebuffer();this.setRenderTarget=function(v,L=0,B=0){U=v,w=L,R=B;let z=!0,I=null,tt=!1,lt=!1;if(v){const ht=_t.get(v);if(ht.__useDefaultFramebuffer!==void 0)gt.bindFramebuffer(A.FRAMEBUFFER,null),z=!1;else if(ht.__webglFramebuffer===void 0)Bt.setupRenderTarget(v);else if(ht.__hasExternalTextures)Bt.rebindTextures(v,_t.get(v.texture).__webglTexture,_t.get(v.depthTexture).__webglTexture);else if(v.depthBuffer){const bt=v.depthTexture;if(ht.__boundDepthTexture!==bt){if(bt!==null&&_t.has(bt)&&(v.width!==bt.image.width||v.height!==bt.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");Bt.setupDepthRenderbuffer(v)}}const wt=v.texture;(wt.isData3DTexture||wt.isDataArrayTexture||wt.isCompressedArrayTexture)&&(lt=!0);const Pt=_t.get(v).__webglFramebuffer;v.isWebGLCubeRenderTarget?(Array.isArray(Pt[L])?I=Pt[L][B]:I=Pt[L],tt=!0):v.samples>0&&Bt.useMultisampledRTT(v)===!1?I=_t.get(v).__webglMultisampledFramebuffer:Array.isArray(Pt)?I=Pt[B]:I=Pt,P.copy(v.viewport),O.copy(v.scissor),k=v.scissorTest}else P.copy(yt).multiplyScalar(V).floor(),O.copy(Ht).multiplyScalar(V).floor(),k=ee;if(B!==0&&(I=gc),gt.bindFramebuffer(A.FRAMEBUFFER,I)&&z&&gt.drawBuffers(v,I),gt.viewport(P),gt.scissor(O),gt.setScissorTest(k),tt){const ht=_t.get(v.texture);A.framebufferTexture2D(A.FRAMEBUFFER,A.COLOR_ATTACHMENT0,A.TEXTURE_CUBE_MAP_POSITIVE_X+L,ht.__webglTexture,B)}else if(lt){const ht=L;for(let wt=0;wt<v.textures.length;wt++){const Pt=_t.get(v.textures[wt]);A.framebufferTextureLayer(A.FRAMEBUFFER,A.COLOR_ATTACHMENT0+wt,Pt.__webglTexture,B,ht)}}else if(v!==null&&B!==0){const ht=_t.get(v.texture);A.framebufferTexture2D(A.FRAMEBUFFER,A.COLOR_ATTACHMENT0,A.TEXTURE_2D,ht.__webglTexture,B)}S=-1},this.readRenderTargetPixels=function(v,L,B,z,I,tt,lt,pt=0){if(!(v&&v.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let ht=_t.get(v).__webglFramebuffer;if(v.isWebGLCubeRenderTarget&&lt!==void 0&&(ht=ht[lt]),ht){gt.bindFramebuffer(A.FRAMEBUFFER,ht);try{const wt=v.textures[pt],Pt=wt.format,bt=wt.type;if(!Ct.textureFormatReadable(Pt)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!Ct.textureTypeReadable(bt)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}L>=0&&L<=v.width-z&&B>=0&&B<=v.height-I&&(v.textures.length>1&&A.readBuffer(A.COLOR_ATTACHMENT0+pt),A.readPixels(L,B,z,I,Mt.convert(Pt),Mt.convert(bt),tt))}finally{const wt=U!==null?_t.get(U).__webglFramebuffer:null;gt.bindFramebuffer(A.FRAMEBUFFER,wt)}}},this.readRenderTargetPixelsAsync=async function(v,L,B,z,I,tt,lt,pt=0){if(!(v&&v.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let ht=_t.get(v).__webglFramebuffer;if(v.isWebGLCubeRenderTarget&&lt!==void 0&&(ht=ht[lt]),ht)if(L>=0&&L<=v.width-z&&B>=0&&B<=v.height-I){gt.bindFramebuffer(A.FRAMEBUFFER,ht);const wt=v.textures[pt],Pt=wt.format,bt=wt.type;if(!Ct.textureFormatReadable(Pt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!Ct.textureTypeReadable(bt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");const kt=A.createBuffer();A.bindBuffer(A.PIXEL_PACK_BUFFER,kt),A.bufferData(A.PIXEL_PACK_BUFFER,tt.byteLength,A.STREAM_READ),v.textures.length>1&&A.readBuffer(A.COLOR_ATTACHMENT0+pt),A.readPixels(L,B,z,I,Mt.convert(Pt),Mt.convert(bt),0);const jt=U!==null?_t.get(U).__webglFramebuffer:null;gt.bindFramebuffer(A.FRAMEBUFFER,jt);const ue=A.fenceSync(A.SYNC_GPU_COMMANDS_COMPLETE,0);return A.flush(),await au(A,ue,4),A.bindBuffer(A.PIXEL_PACK_BUFFER,kt),A.getBufferSubData(A.PIXEL_PACK_BUFFER,0,tt),A.deleteBuffer(kt),A.deleteSync(ue),tt}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(v,L=null,B=0){const z=Math.pow(2,-B),I=Math.floor(v.image.width*z),tt=Math.floor(v.image.height*z),lt=L!==null?L.x:0,pt=L!==null?L.y:0;Bt.setTexture2D(v,0),A.copyTexSubImage2D(A.TEXTURE_2D,B,0,0,lt,pt,I,tt),gt.unbindTexture()};const _c=A.createFramebuffer(),vc=A.createFramebuffer();this.copyTextureToTexture=function(v,L,B=null,z=null,I=0,tt=null){tt===null&&(I!==0?(hr("WebGLRenderer: copyTextureToTexture function signature has changed to support src and dst mipmap levels."),tt=I,I=0):tt=0);let lt,pt,ht,wt,Pt,bt,kt,jt,ue;const ie=v.isCompressedTexture?v.mipmaps[tt]:v.image;if(B!==null)lt=B.max.x-B.min.x,pt=B.max.y-B.min.y,ht=B.isBox3?B.max.z-B.min.z:1,wt=B.min.x,Pt=B.min.y,bt=B.isBox3?B.min.z:0;else{const Ge=Math.pow(2,-I);lt=Math.floor(ie.width*Ge),pt=Math.floor(ie.height*Ge),v.isDataArrayTexture?ht=ie.depth:v.isData3DTexture?ht=Math.floor(ie.depth*Ge):ht=1,wt=0,Pt=0,bt=0}z!==null?(kt=z.x,jt=z.y,ue=z.z):(kt=0,jt=0,ue=0);const Qt=Mt.convert(L.format),At=Mt.convert(L.type);let oe;L.isData3DTexture?(Bt.setTexture3D(L,0),oe=A.TEXTURE_3D):L.isDataArrayTexture||L.isCompressedArrayTexture?(Bt.setTexture2DArray(L,0),oe=A.TEXTURE_2D_ARRAY):(Bt.setTexture2D(L,0),oe=A.TEXTURE_2D),A.pixelStorei(A.UNPACK_FLIP_Y_WEBGL,L.flipY),A.pixelStorei(A.UNPACK_PREMULTIPLY_ALPHA_WEBGL,L.premultiplyAlpha),A.pixelStorei(A.UNPACK_ALIGNMENT,L.unpackAlignment);const qt=A.getParameter(A.UNPACK_ROW_LENGTH),Be=A.getParameter(A.UNPACK_IMAGE_HEIGHT),_i=A.getParameter(A.UNPACK_SKIP_PIXELS),ze=A.getParameter(A.UNPACK_SKIP_ROWS),$i=A.getParameter(A.UNPACK_SKIP_IMAGES);A.pixelStorei(A.UNPACK_ROW_LENGTH,ie.width),A.pixelStorei(A.UNPACK_IMAGE_HEIGHT,ie.height),A.pixelStorei(A.UNPACK_SKIP_PIXELS,wt),A.pixelStorei(A.UNPACK_SKIP_ROWS,Pt),A.pixelStorei(A.UNPACK_SKIP_IMAGES,bt);const le=v.isDataArrayTexture||v.isData3DTexture,Ve=L.isDataArrayTexture||L.isData3DTexture;if(v.isDepthTexture){const Ge=_t.get(v),Re=_t.get(L),Fe=_t.get(Ge.__renderTarget),as=_t.get(Re.__renderTarget);gt.bindFramebuffer(A.READ_FRAMEBUFFER,Fe.__webglFramebuffer),gt.bindFramebuffer(A.DRAW_FRAMEBUFFER,as.__webglFramebuffer);for(let Kn=0;Kn<ht;Kn++)le&&(A.framebufferTextureLayer(A.READ_FRAMEBUFFER,A.COLOR_ATTACHMENT0,_t.get(v).__webglTexture,I,bt+Kn),A.framebufferTextureLayer(A.DRAW_FRAMEBUFFER,A.COLOR_ATTACHMENT0,_t.get(L).__webglTexture,tt,ue+Kn)),A.blitFramebuffer(wt,Pt,lt,pt,kt,jt,lt,pt,A.DEPTH_BUFFER_BIT,A.NEAREST);gt.bindFramebuffer(A.READ_FRAMEBUFFER,null),gt.bindFramebuffer(A.DRAW_FRAMEBUFFER,null)}else if(I!==0||v.isRenderTargetTexture||_t.has(v)){const Ge=_t.get(v),Re=_t.get(L);gt.bindFramebuffer(A.READ_FRAMEBUFFER,_c),gt.bindFramebuffer(A.DRAW_FRAMEBUFFER,vc);for(let Fe=0;Fe<ht;Fe++)le?A.framebufferTextureLayer(A.READ_FRAMEBUFFER,A.COLOR_ATTACHMENT0,Ge.__webglTexture,I,bt+Fe):A.framebufferTexture2D(A.READ_FRAMEBUFFER,A.COLOR_ATTACHMENT0,A.TEXTURE_2D,Ge.__webglTexture,I),Ve?A.framebufferTextureLayer(A.DRAW_FRAMEBUFFER,A.COLOR_ATTACHMENT0,Re.__webglTexture,tt,ue+Fe):A.framebufferTexture2D(A.DRAW_FRAMEBUFFER,A.COLOR_ATTACHMENT0,A.TEXTURE_2D,Re.__webglTexture,tt),I!==0?A.blitFramebuffer(wt,Pt,lt,pt,kt,jt,lt,pt,A.COLOR_BUFFER_BIT,A.NEAREST):Ve?A.copyTexSubImage3D(oe,tt,kt,jt,ue+Fe,wt,Pt,lt,pt):A.copyTexSubImage2D(oe,tt,kt,jt,wt,Pt,lt,pt);gt.bindFramebuffer(A.READ_FRAMEBUFFER,null),gt.bindFramebuffer(A.DRAW_FRAMEBUFFER,null)}else Ve?v.isDataTexture||v.isData3DTexture?A.texSubImage3D(oe,tt,kt,jt,ue,lt,pt,ht,Qt,At,ie.data):L.isCompressedArrayTexture?A.compressedTexSubImage3D(oe,tt,kt,jt,ue,lt,pt,ht,Qt,ie.data):A.texSubImage3D(oe,tt,kt,jt,ue,lt,pt,ht,Qt,At,ie):v.isDataTexture?A.texSubImage2D(A.TEXTURE_2D,tt,kt,jt,lt,pt,Qt,At,ie.data):v.isCompressedTexture?A.compressedTexSubImage2D(A.TEXTURE_2D,tt,kt,jt,ie.width,ie.height,Qt,ie.data):A.texSubImage2D(A.TEXTURE_2D,tt,kt,jt,lt,pt,Qt,At,ie);A.pixelStorei(A.UNPACK_ROW_LENGTH,qt),A.pixelStorei(A.UNPACK_IMAGE_HEIGHT,Be),A.pixelStorei(A.UNPACK_SKIP_PIXELS,_i),A.pixelStorei(A.UNPACK_SKIP_ROWS,ze),A.pixelStorei(A.UNPACK_SKIP_IMAGES,$i),tt===0&&L.generateMipmaps&&A.generateMipmap(oe),gt.unbindTexture()},this.initRenderTarget=function(v){_t.get(v).__webglFramebuffer===void 0&&Bt.setupRenderTarget(v)},this.initTexture=function(v){v.isCubeTexture?Bt.setTextureCube(v,0):v.isData3DTexture?Bt.setTexture3D(v,0):v.isDataArrayTexture||v.isCompressedArrayTexture?Bt.setTexture2DArray(v,0):Bt.setTexture2D(v,0),gt.unbindTexture()},this.resetState=function(){w=0,R=0,U=null,gt.reset(),ot.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return pn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(t){this._outputColorSpace=t;const e=this.getContext();e.drawingBufferColorSpace=Yt._getDrawingBufferColorSpace(t),e.unpackColorSpace=Yt._getUnpackColorSpace()}}const Xe={width:1024,height:650},$e={x:350,y:205},Rn=[[509,47],[550,89],[574,132],[596,178],[601,216],[582,253],[549,285],[507,299]],Lm=i=>{let t=2166136261;for(const e of String(i))t^=e.charCodeAt(0),t=Math.imul(t,16777619);return t>>>0};function Im(i,t=0){const e=Lm(i),n=t%Rn.length,r=Math.floor(t/Rn.length),s=(n/7-.5)*1.7;return{id:i,lane:n,seed:e,phase:0,x:$e.x+Math.cos(s)*(71+Math.min(r,10)*2),y:$e.y+Math.sin(s)*(45+Math.min(r,10)*2),cargo:!1,moving:!1,mining:!1,facing:1,heading:Math.PI/2,travelTime:0,mode:"outbound",dwell:0,cycles:0,distance:0}}function Um(i){const t=(i.lane/7-.5)*1.7;return[$e.x+Math.cos(t)*70,$e.y+Math.sin(t)*45]}function Nm(i){const t=Rn[i.lane],e=i.seed%5-2;return[t[0]-12+i.seed%3*2,t[1]+e*3]}function Fm(i,t,e,n=[]){if(!e)return i.moving=!1,i.mining=!1,i;if(t=Math.max(0,Math.min(t,.1)),i.phase+=t,i.travelTime+=t,i.mode==="mining"||i.mode==="deposit")return i.moving=!1,i.mining=i.mode==="mining",i.dwell-=t,i.dwell<=0&&(i.mode==="mining"?(i.mode="return",i.cargo=!0,i.mining=!1):(i.mode="outbound",i.cargo=!1,i.cycles++)),i;const r=i.mode==="return"?Um(i):Nm(i),s=r[0]-i.x,o=r[1]-i.y,a=Math.hypot(s,o);if(a<3)return i.x=r[0],i.y=r[1],i.mode=i.mode==="return"?"deposit":"mining",i.dwell=i.mode==="mining"?.62+i.seed%31/100:.2,i.moving=!1,i.mining=i.mode==="mining",i.mode==="deposit"&&(i.cargo=!1),i;let l=s/a,c=o/a;const h=i.mode==="return"?-1:1,d=Math.min(a/35,1)*.09;l+=-o/a*d*h,c+=s/a*d*h;for(const u of n){if(u.id===i.id||!u.moving)continue;const b=i.x-u.x,T=i.y-u.y,E=Math.hypot(b,T);if(E>0&&E<14){const C=(14-E)/14*.42;l+=b/E*C,c+=T/E*C}}const f=Math.hypot(l,c),m=53+i.seed%15,g=Math.min(m*t,a),x=l/f*g,p=c/f*g;return i.x+=x,i.y+=p,i.distance+=Math.hypot(x,p),i.heading=Math.atan2(x,-p),i.facing=x>=0?1:-1,i.moving=!0,i.mining=!1,i}function Om(i,t,e){const n=new Map,r=24;for(const s of i){const o=`${Math.floor(s.x/r)},${Math.floor(s.y/r)}`;n.has(o)||n.set(o,[]),n.get(o).push(s)}for(const s of i){const o=Math.floor(s.x/r),a=Math.floor(s.y/r),l=[];for(let c=-1;c<=1;c++)for(let h=-1;h<=1;h++)l.push(...n.get(`${o+h},${a+c}`)||[]);Fm(s,t,e.has(s.id),l)}return i}const tc=i=>i?.status==="working",ci=i=>i?.hasResult===!0&&i?.resultPending===!0&&i?.reviewed!==!0&&!tc(i)&&i.status!=="queued";function Bm(i,t=new Set){return i.filter(e=>tc(e)||e.status==="queued"||e.featured===!0&&e.reviewed!==!0||ci(e)||e.reviewed!==!0&&t.has(e.id))}function ui(i){const t=o=>Number.isFinite(o)&&o>=0?o:null,e=t(i?.remainingPercent),n=t(i?.remaining),r=t(i?.capacity);return{used:t(i?.used),remaining:n,capacity:r,ratio:n!==null&&r!==null&&r>0&&n<=r?n/r:null,remainingPercent:e!==null&&e<=100?e:null,label:i?.label||"토큰",source:i?.source||"공급자가 잔여 토큰을 제공하지 않음"}}function is(i,t){return ci(i)&&!!i.resultRevision&&t?.id===i.id&&t?.revision===i.resultRevision&&t?.hasOutput===!0}function Hs(i){const t=String(i?.engine||"").toLowerCase();return/claude|anthropic/.test(t)?"protoss":/codex|clodex/.test(t)?"terran":"unresolved"}const ec="#EDB3CC",to=i=>typeof i=="string"&&/^#[\da-f]{6}$/i.test(i)?i.toUpperCase():ec;function zm(i){return to(i).slice(1).match(/../g).map(t=>parseInt(t,16))}function Hm(i){const t=to(i),e=zm(t);return document.documentElement.style.setProperty("--accent",t),document.documentElement.style.setProperty("--accent-rgb",e.join(",")),document.documentElement.dataset.accent=t,t}const Ia=640,Ua=316,ln=.1,Tn=Math.PI/4,Gn=(i,t)=>new F((i-Ia/2)*ln,0,(t-Ua/2)*ln/Math.cos(Tn));function km(i,t=12){return i===null||!Number.isFinite(i)?Math.min(4,t):i===0?0:i===1?t:Math.min(t-1,Math.max(1,Math.floor(t*i)))}function Vm(i){return i>0&&i<.1?"<0.1":i<100&&i>99.9?">99.9":i.toLocaleString("en-US",{maximumFractionDigits:1})}const nc=new mi(1,1,1),rr=new fe,Gm=(i,t,e=1)=>(Math.imul(i+17,73856093)^Math.imul(t+43,19349663)^e)>>>0;function Wm(){const i=document.createElement("canvas");i.width=i.height=128;const t=i.getContext("2d");for(let n=0;n<128;n++)for(let r=0;r<128;r++){const s=Math.sin(r*.074)+Math.cos(n*.095)+Math.sin((r+n)*.043),o=Gm(r,n,9)%21-10,a=s>.45?[63,85,38]:[100,88,56];t.fillStyle=`rgb(${a[0]+o},${a[1]+o},${a[2]+Math.round(o*.6)})`,t.fillRect(r,n,1,1)}const e=new $a(i);return e.magFilter=Ue,e.minFilter=Tl,e.colorSpace=Le,e.wrapS=e.wrapT=Kr,e.repeat.set(3,3),e}function qe(i,t,e,n=[1,1,1],r=0){const s=new Ie(nc,t);return s.position.set(...e),s.scale.set(...n),s.rotation.y=r,s.castShadow=!0,s.receiveShadow=!0,i.add(s),s}function Nn(i,t,e,n,r,s,o=8,a=0){const l=new Ka(n,r,s,o),c=new Ie(l,t);return c.position.set(...e),c.rotation.y=a,c.castShadow=!0,c.receiveShadow=!0,i.add(c),c}function Xm(i,t,e,n){const r=new ql(t,e,Math.max(1,n.length));r.count=n.length,r.castShadow=!0,r.receiveShadow=!0;for(let s=0;s<n.length;s++){const o=n[s];rr.position.set(...o.p),rr.rotation.set(0,o.r||0,0),rr.scale.set(...o.s||[1,1,1]),rr.updateMatrix(),r.setMatrixAt(s,rr.matrix)}return r.instanceMatrix.needsUpdate=!0,i.add(r),r}function ic(i,t="#d7e4df",e=6){const n=document.createElement("canvas");n.width=256,n.height=40;const r=n.getContext("2d"),s=new $a(n);s.colorSpace=Le,s.minFilter=s.magFilter=Ue,s.generateMipmaps=!1;const o=new Wl({map:s,transparent:!0,depthTest:!1,depthWrite:!1}),a=new Iu(o);a.scale.set(e,e/6.4,1),a.renderOrder=12;const l=(c,h=t)=>{if(!(a.userData.text===c&&a.userData.tint===h)){a.userData.text=c,a.userData.tint=h,r.imageSmoothingEnabled=!1,r.clearRect(0,0,256,40);for(const[d,f,m,g,x]of[["#111510",0,4,256,32],["#111510",4,0,248,40],["#929b87",4,4,248,3],["#929b87",4,7,3,26],["#30382b",7,7,242,26],["#080b07",7,31,245,5],["#080b07",249,7,3,28]])r.fillStyle=d,r.fillRect(f,m,g,x);r.fillStyle=h,r.fillRect(8,9,3,20),r.font="700 17px ui-monospace,monospace",r.textAlign="center",r.textBaseline="middle",r.fillStyle="#080b07",r.fillText(String(c),131,22,224),r.fillStyle=h,r.fillText(String(c),130,21,224),s.needsUpdate=!0}};return l(i),{sprite:a,update:l,dispose(){s.dispose(),o.dispose()}}}const Tt=(i,t,e,n)=>({p:i,s:t,c:e,r:n});function ye(i){const t=[],e=[],n=[];for(const s of i){const o=new mi(...s.s).toNonIndexed();s.r&&o.applyMatrix4(new te().makeRotationZ(s.r)),o.translate(...s.p);const a=o.getAttribute("position"),l=o.getAttribute("normal"),c=new Vt(s.c);for(let h=0;h<a.count;h++)t.push(a.getX(h),a.getY(h),a.getZ(h)),e.push(l.getX(h),l.getY(h),l.getZ(h)),n.push(c.r,c.g,c.b);o.dispose()}const r=new rn;return r.setAttribute("position",new Ae(t,3)),r.setAttribute("normal",new Ae(e,3)),r.setAttribute("color",new Ae(n,3)),r}function qm(){const i=[],t=[2191022,3904716,8111599,11986431];for(let e=0;e<5;e++){const n=.3+e*.48,r=.68-e*.105;i.push(Tt([e*.045,n,0],[r,.55,r*.85],t[Math.min(e,3)]))}return ye(i)}function Ym(i="#EDB3CC"){const t=new zn;t.name="Terran battlefield · original SC1 object/layout";const e={ground:new An({map:Wm(),roughness:1}),metal:new An({color:9213853,roughness:.65,metalness:.24,flatShading:!0}),lightMetal:new An({color:12240070,roughness:.58,metalness:.3,flatShading:!0}),dark:new An({color:3161154,roughness:.78,metalness:.3}),accent:new An({color:i,roughness:.62,metalness:.15}),glass:new An({color:7186108,roughness:.3,metalness:.32,emissive:2180181,emissiveIntensity:.18})},n=new Ie(new gi(140,120),e.ground);n.name="Flat grass/dirt battlefield",n.rotation.x=-Math.PI/2,n.receiveShadow=!0,t.add(n);const r=new zn;r.name="Terran Command Center",r.userData.objectIdentity="CommandCenter",r.userData.features=["octagonal industrial hull","raised metal roof","control box","silver front ramp","radial team panels","side pipes and vents"],r.position.copy(Gn($e.x,$e.y)),t.add(r);const s=Math.PI/8;Nn(r,e.dark,[0,.38,0],5.55,5.9,.76,8,s),Nn(r,e.metal,[0,1.08,0],5.25,5.55,1,8,s),Nn(r,e.dark,[0,1.68,0],4.85,5.15,.26,8,s),Nn(r,e.lightMetal,[0,2.08,-.12],4.45,4.85,.66,8,s),Nn(r,e.dark,[0,2.52,-.22],4.12,4.38,.22,8,s),Nn(r,e.metal,[0,2.79,-.34],3.9,4.1,.35,8,s);for(let g=0;g<8;g++){const x=g*Math.PI/4,p=Math.sin(x),u=Math.cos(x);qe(r,e.accent,[p*4.83,1.65,u*4.83],[2.55,.34,.58],x),qe(r,e.dark,[p*3.15,3.03,u*3.15-.2],[.82,.18,1.25],x);for(let b=0;b<3;b++)qe(r,e.lightMetal,[p*3.15+Math.cos(x)*(b-1)*.23,3.15,u*3.15-.2-Math.sin(x)*(b-1)*.23],[.11,.13,.85],x)}qe(r,e.dark,[.65,3.3,-1.25],[2.55,.35,2.7]),qe(r,e.lightMetal,[.65,4.04,-1.25],[2.15,1.2,2.3]),qe(r,e.metal,[.65,4.79,-1.25],[2.55,.28,2.6]),qe(r,e.glass,[.65,4.12,-.072],[1.55,.45,.06]),qe(r,e.accent,[.65,4.97,-1.25],[1.65,.09,1.65]);for(const g of[-4.05,4.05]){const x=Nn(r,e.dark,[g,2.36,-1.45],.7,.7,1.25,8);x.rotation.z=Math.PI/2;for(let p=0;p<3;p++){const u=Nn(r,e.lightMetal,[g,2.4,-1.45+p*.32],.14,.14,1.4,6);u.rotation.z=Math.PI/2}qe(r,e.metal,[g,.6,1.6],[1.5,.6,2.35]),qe(r,e.accent,[g,.99,1.6],[1.12,.12,1.55])}const o=new zn;o.name="Silver front loading ramp",o.position.set(-2.3,0,4.4),o.rotation.y=-.24,r.add(o);for(let g=0;g<5;g++)qe(o,e.lightMetal,[0,.78-g*.16,.3+g*.58],[2.6,.2,.68]),qe(o,e.dark,[0,.895-g*.16,.3+g*.58],[2.2,.03,.11]);const a=[],l=[],c=qm();for(let g=0;g<Rn.length;g++){const x=new zn;x.name=`Blue mineral crystal cluster ${g+1}`,x.userData.objectIdentity="BlueMineralCrystalCluster",x.position.copy(Gn(...Rn[g])),t.add(x);const p=new An({vertexColors:!0,color:16777215,roughness:.39,metalness:.12,emissive:2778522,emissiveIntensity:.28,transparent:!0}),u=Array.from({length:12},(T,E)=>({p:[(E*7%5-2)*.6,0,(E*3%5-2)*.42],s:[.72+E%3*.15,1.1+E%4*.15,.72+E%3*.13],r:(E%3-1)*.38})),b=Xm(x,c,p,u);a.push({mesh:b,material:p,pieces:u,provider:g<4?"codex":"claude",ratio:null,source:[...Rn[g]],group:x})}for(const[g,x,p]of[["codex",601,114],["claude",592,282]]){const u=ic(`${g.toUpperCase()} · ? 미측정`,"#a8c5d7",6);u.sprite.position.copy(Gn(x,p)),u.sprite.position.y=3.3,t.add(u.sprite),l.push({provider:g,...u})}let h=ui(null),d=null;const f=g=>d?ui(d[g]):h;function m(g,x){h=ui(g),d=x??null;for(const p of a){const u=f(p.provider),b=u.ratio??(u.remainingPercent===null?null:u.remainingPercent/100);p.ratio=b,p.mesh.count=km(b,p.pieces.length),p.material.color.set(b===null?7111061:16777215),p.material.opacity=b===null?.5:1,p.material.emissiveIntensity=b===null?.025:.28}for(const p of l){const u=f(p.provider),b=u.ratio??(u.remainingPercent===null?null:u.remainingPercent/100),T=b===null?"? 미측정":u.remainingPercent!==null?`${Vm(u.remainingPercent)}% 한도`:u.remaining!==null?`${u.remaining.toLocaleString("en-US")} 토큰`:"? 미측정";p.update(`${p.provider.toUpperCase()} · ${T}`,b===null?"#a3b2bd":"#b8def1")}}return m(null,null),{group:t,materials:e,commandCenter:r,ground:n,oreBanks:a,labels:l,blockCount:0,heightAt:()=>0,updateAccent(g){e.accent.color.set(g)},updateBudget:m,diagnostics:()=>({objectIdentities:{commandCenter:{name:r.name,source:[$e.x,$e.y],features:r.userData.features},minerals:a.map(g=>({identity:g.group.userData.objectIdentity,source:g.source,color:"blue-crystal"})),ground:"flat-grass-dirt",forbiddenThemeProps:[]},oreBanks:a.map(g=>({provider:g.provider,ratio:g.ratio,visibleChunks:g.mesh.count,unknown:g.ratio===null})),tokenPool:h,tokenPools:d}),dispose(){t.traverse(g=>{g.geometry&&g.geometry!==nc&&g.geometry!==c&&g.geometry.dispose()}),c.dispose();for(const g of Object.values(e))g.map?.dispose(),g.dispose();a.forEach(g=>g.material.dispose()),l.forEach(g=>g.dispose())}}}const rc=()=>ye([Tt([0,4.2,0],[.17,.45,.17],16767371),Tt([0,3.86,0],[.17,.13,.17],16767371)]);function $m(i=!1){const t=i?9213592:11583171,e=4150111,n=12044494;return{chassis:ye([Tt([0,1.52,0],[1.85,1.02,1.55],e),Tt([0,1.95,.08],[1.74,.5,1.45],t),Tt([0,1.5,-.9],[1.3,.88,.42],6058106),Tt([-.62,1.78,-1.11],[.2,.48,.14],n),Tt([.62,1.78,-1.11],[.2,.48,.14],n)]),cockpit:ye([Tt([0,2.55,.15],[1.28,1.07,1.12],t),Tt([0,2.6,.73],[.99,.63,.09],5213099),Tt([0,3.14,.1],[1.45,.2,1.3],n),Tt([.42,3.31,-.22],[.26,.2,.25],15122538)]),legL:ye([Tt([0,-.36,0],[.52,.75,.65],e),Tt([-.15,-.68,.11],[.16,.68,.18],n),Tt([0,-1.05,.16],[.78,.3,1],t)]),legR:ye([Tt([0,-.36,0],[.52,.75,.65],e),Tt([.15,-.68,.11],[.16,.68,.18],n),Tt([0,-1.05,.16],[.78,.3,1],t)]),claw:ye([Tt([0,-.15,.25],[.59,.65,.65],t),Tt([0,-.52,.51],[.23,.62,.25],n),Tt([-.22,-.77,.88],[.14,.23,.6],e),Tt([.22,-.77,.88],[.14,.23,.6],e),Tt([0,-.77,.65],[.5,.25,.16],n)]),drillArm:ye([Tt([0,-.21,.27],[.64,.7,.75],t),Tt([0,-.56,.78],[.3,.26,.92],e),Tt([0,-.57,1.17],[.48,.4,.29],n)]),drillRotor:ye([Tt([0,0,0],[.4,.4,.32],8559525),Tt([0,0,.27],[.3,.3,.4],n),Tt([0,0,.58],[.17,.17,.25],6258318),Tt([.18,0,.1],[.11,.55,.16],14082269),Tt([0,.18,.1],[.55,.11,.16],14082269)]),teamPanels:ye([Tt([-.96,1.75,.05],[.09,.48,.97],16777215),Tt([.96,1.75,.05],[.09,.48,.97],16777215),Tt([0,2.07,.86],[1.1,.18,.06],16777215)]),cargo:ye([Tt([0,2,-1.12],[.48,.7,.48],5943264),Tt([0,2.48,-1.1],[.27,.29,.26],10607094)]),marker:rc(),shadow:new gi(3.4,2.3).rotateX(-Math.PI/2).translate(0,.018,0)}}function Km(){return{chassis:ye([Tt([0,1.58,0],[1.52,.51,1.38],13015870),Tt([0,1.93,-.12],[1.1,.45,1.05],15123307),Tt([-.96,1.65,-.3],[.57,.44,1.35],13609025),Tt([.96,1.65,-.3],[.57,.44,1.35],13609025),Tt([0,1.31,-.12],[1.16,.2,.92],9793834)]),cockpit:ye([Tt([0,2.24,-.18],[.73,.35,.7],15913351),Tt([0,2.22,.28],[.6,.3,.16],7784167),Tt([0,1.86,-.74],[.6,.32,.26],6467540)]),claw:ye([Tt([-.62,0,.67],[.28,.32,1.3],15121493),Tt([.62,0,.67],[.28,.32,1.3],15121493),Tt([-.57,.16,1.25],[.25,.33,.22],15782535),Tt([.57,.16,1.25],[.25,.33,.22],15782535)]),teamPanels:ye([Tt([-.98,1.92,-.29],[.28,.08,.7],16777215),Tt([.98,1.92,-.29],[.28,.08,.7],16777215)]),cargo:ye([Tt([0,1.7,-1.05],[.46,.7,.46],5943264),Tt([0,2.16,-1.05],[.25,.3,.25],11789823)]),marker:rc(),shadow:new gi(3,2.2).rotateX(-Math.PI/2).translate(0,.018,0)}}class jm{constructor(t,e){this.parent=t,this.accent=e,this.material=new An({vertexColors:!0,roughness:.62,metalness:.2,flatShading:!0}),this.teamMaterial=new An({color:e,roughness:.6,metalness:.15});const n=document.createElement("canvas");n.width=n.height=32;const r=n.getContext("2d"),s=r.createRadialGradient?.(16,16,2,16,16,16);s&&(s.addColorStop(0,"rgba(13,25,16,.55)"),s.addColorStop(1,"rgba(13,25,16,0)")),r.fillStyle=s||"rgba(13,25,16,.25)",r.fillRect(0,0,32,32),this.shadowTexture=new $a(n),this.shadowMaterial=new Qr({map:this.shadowTexture,transparent:!0,opacity:.45,depthWrite:!1}),this.groups=new Map,this.rigs=new Map,this.raycastMeshes=[],this.selection=new Ie(new ja(1.2,1.27,32),new Qr({color:e,transparent:!0,opacity:.95,side:un,depthWrite:!1})),this.selection.rotation.x=-Math.PI/2,this.selection.scale.y=.62,t.add(this.selection),this.selection.visible=!1,this.nameLabel=ic("",e,7.8),t.add(this.nameLabel.sprite),this.nameLabel.sprite.visible=!1}style(t){const e=String(t?.engine||"").toLowerCase();return/claude|anthropic/.test(e)?"claude":/codex|clodex/.test(e)?"codex":"neutral"}identity(t){return t==="claude"?"PROBE":t==="codex"?"SCV":"SCV-route-pending"}createRig(t){const e=new fe,n={};for(const r of["chassis","cockpit","legL","legR","claw","drillArm","drillRotor","teamPanels","cargo","marker","shadow"])n[r]=new fe,e.add(n[r]);return n.legL.position.set(-.65,1.2,0),n.legR.position.set(.65,1.2,0),n.claw.position.set(-1.14,2.12,.04),n.drillArm.position.set(1.14,2.12,.04),n.drillRotor.position.set(1.14,1.55,1.38),{id:t,root:e,parts:n,initialized:!1,style:"neutral",pose:{yaw:0,walk:0,arm:0,bob:0,drill:0,cargo:!1}}}ensure(t,e){let n=this.groups.get(t);if(n&&n.capacity>=e)return n;if(n){for(const a of Object.values(n.meshes))this.parent.remove(a),a.dispose?.();Object.values(n.geometries).forEach(a=>a.dispose())}const r=t==="claude"?Km():$m(t==="neutral"),s=2**Math.ceil(Math.log2(Math.max(16,e))),o={};for(const[a,l]of Object.entries(r)){const c=a==="teamPanels"?this.teamMaterial:a==="shadow"?this.shadowMaterial:this.material,h=new ql(l,c,s);h.name=`${this.identity(t)} · ${a}`,h.userData.objectIdentity=this.identity(t),h.userData.feature=a,h.instanceMatrix.setUsage(iu),h.frustumCulled=!1,h.receiveShadow=a!=="shadow",o[a]=h,this.parent.add(h)}return n={geometries:r,capacity:s,meshes:o},this.groups.set(t,n),this.raycastMeshes=[...this.groups.values()].flatMap(a=>[a.meshes.chassis,a.meshes.cockpit]),n}update(t,e,n,r=!0){const s={codex:[],claude:[],neutral:[]};for(const a of t){let l=this.rigs.get(a.id);if(l||(l=this.createRig(a.id),this.rigs.set(a.id,l)),l.style=this.style(a.session),s[l.style].push({u:a,rig:l}),l.initialized||(l.pose.yaw=Math.PI-a.heading,l.pose.cargo=a.cargo,l.initialized=!0),a.session?.status==="working"&&r){const h=Math.PI-a.heading,d=Math.atan2(Math.sin(h-l.pose.yaw),Math.cos(h-l.pose.yaw));l.pose.yaw+=d*(1-Math.exp(-12*n)),l.pose.walk=l.style==="claude"?0:a.moving?Math.sin(a.travelTime*12)*.29:0,l.pose.arm=a.mining?-.14+Math.sin(a.travelTime*17)*.16:a.moving?-l.pose.walk*.22:0,l.pose.bob=l.style==="claude"?Math.sin(a.travelTime*3)*.09:a.moving?Math.abs(Math.sin(a.travelTime*12))*.035:0,a.mining&&(l.pose.drill=a.travelTime*23),l.pose.cargo=a.cargo}const c=Gn(a.x,a.y);l.root.position.set(c.x,l.pose.bob,c.z),l.root.rotation.y=l.pose.yaw,l.parts.legL.rotation.x=l.pose.walk,l.parts.legR.rotation.x=-l.pose.walk,l.parts.claw.rotation.x=-l.pose.arm*.5,l.parts.claw.position.set(l.style==="claude"?0:-1.14,l.style==="claude"?1.6:2.12,.04),l.parts.drillArm.rotation.x=l.pose.arm,l.parts.drillRotor.rotation.z=l.pose.drill,l.parts.cargo.scale.setScalar(l.pose.cargo?1:0),l.parts.shadow.position.y=-l.pose.bob,l.parts.marker.scale.setScalar(a.session?.resultPending===!0&&a.session?.reviewed!==!0&&!["working","queued"].includes(a.session?.status)?1:0),l.root.updateMatrixWorld(!0)}for(const[a,l]of Object.entries(s)){if(!l.length){const h=this.groups.get(a);h&&Object.values(h.meshes).forEach(d=>d.count=0);continue}const c=this.ensure(a,l.length);for(const[h,d]of Object.entries(c.meshes)){d.count=l.length,d.castShadow=h!=="shadow"&&h!=="marker"&&t.length<=80,d.userData.workerIDs=l.map(f=>f.u.id);for(let f=0;f<l.length;f++)d.setMatrixAt(f,l[f].rig.parts[h].matrixWorld);d.instanceMatrix.needsUpdate=!0,d.boundingSphere=null,d.boundingBox=null}}const o=t.find(a=>a.id===e);if(this.selection.visible=!!o,this.nameLabel.sprite.visible=!!o,o){const a=Gn(o.x,o.y);this.selection.position.set(a.x,.025,a.z),this.nameLabel.sprite.position.set(a.x,4.3,a.z),this.nameLabel.update(o.session.name.length>34?o.session.name.slice(0,34)+"…":o.session.name,this.accent)}}setAccent(t){this.accent=t,this.teamMaterial.color.set(t),this.selection.material.color.set(t)}clear(){for(const t of this.groups.values())Object.values(t.meshes).forEach(e=>e.count=0);this.selection.visible=!1,this.nameLabel.sprite.visible=!1}pose(t){const e=this.rigs.get(t);return e?{...e.pose}:null}objectIdentities(){return[...this.groups].map(([t,e])=>({style:t,identity:this.identity(t),geometryParts:Object.keys(e.geometries)}))}dispose(){for(const t of this.groups.values()){for(const e of Object.values(t.meshes))this.parent.remove(e),e.dispose?.();Object.values(t.geometries).forEach(e=>e.dispose())}this.material.dispose(),this.teamMaterial.dispose(),this.shadowTexture.dispose(),this.shadowMaterial.dispose(),this.selection.geometry.dispose(),this.selection.material.dispose(),this.nameLabel.dispose()}}const Na=Object.freeze([{id:"move",meaning:"작업 프롬프트",rect:[505,355,33,36],glyph:"arrow"},{id:"stop",meaning:"실제 작업 중단",rect:[548,355,35,36],glyph:"stop"},{id:"focus",meaning:"선택 일꾼 찾기",rect:[594,355,38,36],glyph:"focus"},{id:"repair",meaning:"같은 세션 재작업",rect:[505,398,33,34],glyph:"wrench"},{id:"gather",meaning:"작업 배정",rect:[549,398,35,34],glyph:"crystal"},{id:"all",meaning:"전체 전장",rect:[594,397,38,35],glyph:"map"},{id:"build",meaning:"새 실제 세션",rect:[505,438,34,36],glyph:"plus"},{id:"base",meaning:"선택 세션 대화",rect:[549,438,35,36],glyph:"base"},{id:"help",meaning:"상태 검증",rect:[602,439,34,34],glyph:"question"}]),pl=Object.freeze({full:[0,316,640,164],minimap:[7,351,126,124],unit:[157,386,73,81],operator:[408,410,78,68],commands:Na.map(i=>i.rect)}),ml={A:["010","101","111","101","101"],B:["110","101","110","101","110"],C:["011","100","100","100","011"],D:["110","101","101","101","110"],E:["111","100","110","100","111"],F:["111","100","110","100","100"],G:["011","100","101","101","011"],H:["101","101","111","101","101"],I:["111","010","010","010","111"],J:["001","001","001","101","010"],K:["101","101","110","101","101"],L:["100","100","100","100","111"],M:["101","111","111","101","101"],N:["101","111","111","111","101"],O:["010","101","101","101","010"],P:["110","101","110","100","100"],Q:["010","101","101","111","011"],R:["110","101","110","101","101"],S:["011","100","010","001","110"],T:["111","010","010","010","010"],U:["101","101","101","101","111"],V:["101","101","101","101","010"],W:["101","101","111","111","101"],X:["101","101","010","101","101"],Y:["101","101","010","010","010"],Z:["111","001","010","100","111"],"?":["110","001","010","000","010"],"+":["000","010","111","010","000"],"-":["000","000","111","000","000"]," ":["000","000","000","000","000"]};function ni(i,t,e,n,r,s=1){i.fillStyle=r;for(const o of t.toUpperCase())(ml[o]||ml[" "]).forEach((l,c)=>{for(let h=0;h<l.length;h++)l[h]==="1"&&i.fillRect(e+h*s,n+c*s,s,s)}),e+=4*s}function on(i,t,e,n,r,{fill:s="#424b43",light:o="#809083",dark:a="#1a231e",edge:l="#101813",depth:c=3}={}){i.fillStyle=l,i.fillRect(t,e,n,r),i.fillStyle=s,i.fillRect(t+1,e+1,n-2,r-2),i.fillStyle=o,i.fillRect(t+1,e+1,n-2,c),i.fillRect(t+1,e+1,c,r-2),i.fillStyle=a,i.fillRect(t+1,e+r-c-1,n-2,c),i.fillRect(t+n-c-1,e+1,c,r-2)}function Gr(i,t,e,n,r){on(i,t,e,n,r,{fill:"#18231c",light:"#19251d",dark:"#68796c",edge:"#111a15",depth:2})}function Zm(i,t,e){i.fillStyle="#111a15",i.fillRect(t,e,4,4),i.fillStyle="#89978c",i.fillRect(t,e,3,2),i.fillStyle="#c3cbbf",i.fillRect(t,e,1,1)}function De(i,t,e,n,r,{face:s="#a6b6b8",top:o="#d3dfdd",side:a="#637b80",depth:l=3}={}){i.fillStyle=a,i.fillRect(t,e,n,r),i.fillStyle=o,i.fillRect(t+l,e-l,n-l,l+1),i.fillStyle=s,i.fillRect(t,e,n-l,r),i.fillStyle="#243b3e",i.fillRect(t,e+r-1,n,1)}function Jm(i,t,e,n){De(i,t+12,e+38,8,16,{face:"#60767f",top:"#a1b5b6",side:"#344d58",depth:2}),De(i,t+37,e+38,8,16,{face:"#60767f",top:"#a1b5b6",side:"#344d58",depth:2}),De(i,t+8,e+53,18,6),De(i,t+33,e+53,18,6),De(i,t+13,e+24,34,21),De(i,t+19,e+5,23,23,{face:"#c0ccca",top:"#e0e9e1",side:"#7d969b"}),i.fillStyle="#263d4b",i.fillRect(t+23,e+10,14,10),i.fillStyle="#73b5c8",i.fillRect(t+24,e+11,11,6),i.fillStyle="#b8e8e9",i.fillRect(t+25,e+11,7,2),De(i,t+1,e+29,12,14),i.fillStyle="#b9c9c7",i.fillRect(t+3,e+42,3,8),i.fillRect(t+10,e+42,3,8),De(i,t+46,e+29,12,12),i.fillStyle="#809da5",i.fillRect(t+55,e+34,6,5),i.fillStyle="#d1e3df",i.fillRect(t+59,e+35,4,3),i.fillStyle=n,i.fillRect(t+14,e+28,5,10),i.fillRect(t+41,e+28,5,10),i.fillRect(t+22,e+4,15,2),i.fillStyle="#ecd18f",i.fillRect(t+37,e+1,4,3),i.fillStyle="#d5e1dc",i.fillRect(t+16,e+40,2,9),i.fillRect(t+42,e+40,2,9)}function gl(i,t,e,n){De(i,t+17,e+17,31,15,{face:"#cfa642",top:"#f0d27b",side:"#8b6d28",depth:4}),De(i,t+24,e+9,18,13,{face:"#e2bf67",top:"#fae29b",side:"#9f7e33",depth:3}),De(i,t+2,e+16,11,17,{face:"#cda03e",top:"#f1cd6e",side:"#8b6726",depth:3}),De(i,t+51,e+16,11,17,{face:"#cda03e",top:"#f1cd6e",side:"#8b6726",depth:3}),i.fillStyle="#e3b64c",i.fillRect(t+12,e+29,6,18),i.fillRect(t+45,e+29,6,18),i.fillStyle="#ffe198",i.fillRect(t+13,e+29,2,13),i.fillRect(t+46,e+29,2,13),i.fillStyle="#285569",i.fillRect(t+28,e+17,11,8),i.fillStyle="#7fcee9",i.fillRect(t+29,e+18,8,5),i.fillStyle="#d0f4f4",i.fillRect(t+30,e+18,4,2),i.fillStyle=n,i.fillRect(t+4,e+16,6,2),i.fillRect(t+53,e+16,6,2)}function Qm(i,t,e,n){i.fillStyle="#273d34",i.fillRect(t,e,64,57);for(let r=0;r<8;r++)i.fillStyle=r%2?"#2e453b":"#293e35",i.fillRect(t,e+r*7,64,3);De(i,t+8,e+6,49,19,{face:"#7d9493",top:"#b5c9bd",side:"#425d62",depth:4}),i.fillStyle=n,i.fillRect(t+11,e+9,39,4),i.fillStyle="#c49b70",i.fillRect(t+17,e+23,31,26),i.fillStyle="#e0ba8c",i.fillRect(t+20,e+24,24,20),i.fillStyle="#293a3f",i.fillRect(t+16,e+24,33,12),i.fillStyle="#74a7ad",i.fillRect(t+19,e+26,26,5),i.fillStyle="#b9dbd8",i.fillRect(t+20,e+26,8,2),De(i,t+8,e+25,7,20,{face:"#778d8b",top:"#a0b4a9",side:"#3c5559",depth:2}),De(i,t+49,e+25,7,20,{face:"#778d8b",top:"#a0b4a9",side:"#3c5559",depth:2}),i.fillStyle="#7f593e",i.fillRect(t+28,e+42,10,2),i.fillStyle="#536e70",i.fillRect(t+8,e+49,49,8),i.fillStyle=n,i.fillRect(t+28,e+50,11,3)}function tg(i,t,e,n,r){i.fillStyle=r;const s=(o,a,l,c)=>i.fillRect(e+o,n+a,l,c);if(t==="arrow")s(2,10,13,4),s(12,4,4,16),s(16,7,3,10),s(19,10,3,4);else if(t==="stop")s(4,4,17,17),i.fillStyle="#34443b",s(8,8,9,9);else if(t==="focus"){for(const[o,a]of[[2,2],[16,2],[2,16],[16,16]])s(o,a,7,2),s(o,a,2,7);s(10,10,4,4)}else if(t==="wrench")s(4,2,5,8),s(14,2,5,8),s(7,8,9,5),s(10,12,5,9),s(7,19,10,3);else if(t==="crystal")i.fillStyle="#2f7198",s(5,10,15,11),i.fillStyle="#7ac5e7",s(9,2,6,17),s(3,9,5,10),s(16,6,5,14),i.fillStyle="#c3e7ef",s(10,3,2,11),s(4,10,2,6);else if(t==="map"){for(let o=0;o<3;o++)for(let a=0;a<3;a++)i.fillStyle=(o+a)%2?"#829a72":"#c0cdb8",s(2+a*7,2+o*7,6,6);i.fillStyle=r,s(11,9,4,4)}else if(t==="plus")s(10,2,5,20),s(3,9,19,5),i.fillStyle="#d0e0d0",s(11,3,2,5);else if(t==="base")i.fillStyle="#899b9c",s(4,8,17,12),s(1,11,23,6),i.fillStyle="#c0d1cb",s(7,3,11,8),i.fillStyle=r,s(4,16,17,3),i.fillStyle="#334a50",s(9,5,7,3);else if(t==="question"){const o=["01110","11011","00011","00110","01100","00000","01100"];for(let a=0;a<o.length;a++)for(let l=0;l<5;l++)o[a][l]==="1"&&s(l*3+4,a*3+1,3,3)}}function eg(i){return/claude|anthropic/i.test(String(i?.engine||""))?"PROBE":i?"SCV":"NONE"}class ng{constructor(t){this.canvas=t,this.context=t.getContext("2d"),this.lastKey="",this.drawCount=0,this.identity="NONE",this.portraitIdentity="NONE",this.status=""}draw({accent:t="#EDB3CC",selected:e=null,mode:n="native"}={}){const r=eg(e),s=e?.status||"idle",o=JSON.stringify([t,e?.id,e?.engine,s,e?.resultPending,e?.reviewed,n]);if(o===this.lastKey)return!1;this.lastKey=o,this.identity=r,this.portraitIdentity=r==="PROBE"?"PROBE_GOLD_OPTIC":r==="SCV"?"BLOCK_HELMET_OPERATOR":"NONE",this.status=s,this.drawCount++;const a=this.context;a.imageSmoothingEnabled=!1,a.clearRect(0,0,640,480),a.fillStyle="#343d35",a.fillRect(...pl.full);for(let c=0;c<21;c++)for(let h=0;h<80;h++){const d=(h*47+c*29^c*13)%7;a.fillStyle=d<2?"#39443a":d===3?"#30392f":"#364035",a.fillRect(h*8,316+c*8,8,8)}a.fillStyle="#101a14",a.fillRect(0,316,640,4),a.fillStyle="#a0ae99",a.fillRect(0,320,640,2),a.fillStyle=t,a.fillRect(143,316,2,164),a.fillRect(488,316,2,164),on(a,0,316,142,164),on(a,144,316,344,55),on(a,144,373,259,107),on(a,405,380,83,100),on(a,491,343,149,137),on(a,4,320,62,25,{fill:"#56634f",light:"#8a9b7f"}),on(a,75,320,61,25,{fill:"#56634f",light:"#8a9b7f"}),Gr(a,4,348,132,130),Gr(a,153,382,82,94),Gr(a,407,410,78,67),on(a,412,385,70,24,{fill:"#54634e",light:"#8c9f7e"});for(const[c,h]of[[1,317],[135,317],[146,317],[481,317],[493,345],[633,345],[146,473],[396,473]])Zm(a,c+1,h+1);ni(a,"SESSION CONTROL",181,331,"#b6c5ac"),ni(a,"VOXEL",429,331,t);for(let c=155;c<476;c+=12)a.fillStyle=c%24?"#2e3b2f":"#687b60",a.fillRect(c,350,7,3);a.fillStyle="#111d16",a.fillRect(238,385,160,90),r==="SCV"?(Jm(a,164,395,t),Qm(a,414,416,t)):r==="PROBE"?(gl(a,164,404,t),gl(a,414,417,t)):(ni(a,"SELECT",175,416,"#80947f"),ni(a,"UNIT",179,426,"#80947f"),ni(a,"NO LINK",427,440,"#80947f")),ni(a,r==="NONE"?"UNIT":r,r==="PROBE"?180:186,460,t);const l=n==="preview"?"DEMO":s==="working"?"RUN":s==="queued"?"WAIT":e?.resultPending?"CHECK":"IDLE";ni(a,l,r==="PROBE"?181:184,469,t);for(const c of Na){const[h,d,f,m]=c.rect;on(a,h-2,d-2,f+4,m+4,{fill:"#59654f",light:"#99aa8a",dark:"#273325",depth:2}),Gr(a,h+2,d+2,f-4,m-4);const g=c.id==="stop"&&s!=="working"?"#65745f":t;tg(a,c.glyph,h+Math.floor((f-25)/2),d+Math.floor((m-24)/2),g)}return!0}diagnostics(){return{source:"procedural-canvas-pixel-blocks",drawCount:this.drawCount,selectedIdentity:this.identity,portraitIdentity:this.portraitIdentity,status:this.status,regions:pl,commands:Na.map(t=>({id:t.id,meaning:t.meaning,glyph:t.glyph,rect:t.rect})),resourceOrHealthStatsDrawn:!1}}}const ig=(i,t)=>{const e=document.createElement("canvas");return e.width=i,e.height=t,e};class rg{constructor(t,e){this.container=t,this.onSelect=e,this.units=new Map,this.sessions=[],this.selected=null,this.enabled=!1,this.loaded=!1,this.failed=!1,this.mode="native",this.accent=ec,this.paintCount=0,this.pool=ui(null),this.pools=null,this.last=performance.now(),this.lastRender=0,this.lastDiagnostics=0,this.fps=0,this.drawCalls=0,this.triangles=0,this.frameEMA=16.67,this.pixelRatio=Math.min(globalThis.devicePixelRatio||1,1.5),this.quality="high",this.performanceSamples=0,this.pointer=null,this.orbit={theta:0,phi:Tn,radius:69,target:new F(0,0,0)},this.orbitGoal={...this.orbit,target:this.orbit.target.clone()};try{this.initialize(),this.loaded=!0,this.drawHUD(),this.ready=Promise.resolve(this),this.enabled&&this.paint()}catch(n){this.fail(n),this.ready=Promise.reject(n),this.ready.catch(()=>{})}this.animate=this.animate.bind(this),requestAnimationFrame(this.animate)}initialize(){this.hudCanvas=ig(640,480),this.hudCanvas.className="voxel-hud",this.hudCanvas.setAttribute("aria-hidden","true"),this.hudCanvas.style.cssText="position:absolute;left:0;top:0;width:640px;height:480px;z-index:0;pointer-events:none;image-rendering:pixelated;",this.container.appendChild(this.hudCanvas),this.hud=new ng(this.hudCanvas),this.renderer=new Dm({antialias:!0,alpha:!1,powerPreference:"high-performance"}),this.renderer.setPixelRatio(this.pixelRatio),this.renderer.outputColorSpace=Le,this.renderer.toneMapping=yl,this.renderer.toneMappingExposure=.98,this.renderer.shadowMap.enabled=!0,this.renderer.shadowMap.type=Sl,this.canvas=this.renderer.domElement,this.canvas.className="voxel-battlefield",this.canvas.setAttribute("aria-label","스타크래프트 원본 배치 · 3D 복셀 SCV 채광 전장"),this.canvas.style.cssText="position:absolute;left:0;top:0;display:block;z-index:1;outline:none;touch-action:none;image-rendering:auto;",this.canvas.style.setProperty("width","640px","important"),this.canvas.style.setProperty("height","316px","important"),this.canvas.tabIndex=0,this.container.appendChild(this.canvas),this.scene=new Du,this.scene.background=new Vt(5003829),this.scene.fog=new qa(5003829,200,280),this.camera=new Ja(-Ia*ln/2,Ia*ln/2,Ua*ln/2,-Ua*ln/2,.1,300),this.scene.add(new ku(14281968,5857847,1.4),new Xu(16777215,.16)),this.sun=new Wu(16772044,2.4),this.sun.position.set(-22,45,30),this.sun.castShadow=!0,this.sun.shadow.mapSize.set(2048,2048),Object.assign(this.sun.shadow.camera,{left:-43,right:43,top:37,bottom:-37,near:1,far:120}),this.sun.shadow.normalBias=.035,this.sun.shadow.bias=-6e-5,this.sun.shadow.radius=3,this.sun.target.position.set(5,0,0),this.scene.add(this.sun,this.sun.target),this.world=Ym(this.accent),this.scene.add(this.world.group),this.workforce=new jm(this.scene,this.accent),this.raycaster=new Yu,this.pointerVector=new Ot,this.bindPointer(),this.resize(),this.minimapHit=document.createElement("div"),this.minimapHit.className="voxel-minimap-hit",this.minimapHit.setAttribute("aria-label","복셀 HUD 미니맵 · 전장 이동"),this.minimapHit.style.cssText="position:absolute;left:7px;top:351px;width:126px;height:124px;z-index:2;pointer-events:auto;cursor:crosshair;",this.container.appendChild(this.minimapHit),this.minimapHit.addEventListener("pointerdown",t=>{const e=this.minimapHit.getBoundingClientRect(),n=(t.clientX-e.left)/e.width*Xe.width,r=(t.clientY-e.top)/e.height*Xe.height;this.orbitGoal.target.copy(Gn(n,r))}),this.canvas.addEventListener("webglcontextlost",t=>{t.preventDefault(),this.fail(new Error("WebGL 컨텍스트가 중단되었습니다. 전장 화면을 다시 열어 주세요."))}),this.canvas.addEventListener("webglcontextrestored",()=>{this.failed=!1,this.errorElement?.remove(),this.errorElement=null,this.container.removeAttribute("data-error"),this.last=performance.now()})}fail(t){this.failed=!0,this.container.dataset.error=String(t?.message||t),this.container.dataset.renderer="webgl-unavailable",this.errorElement||(this.errorElement=document.createElement("div"),this.errorElement.setAttribute("role","alert"),this.errorElement.style.cssText="position:absolute;left:0;top:0;width:640px;height:316px;display:grid;place-content:center;padding:35px;color:#f4d9e8;background:#152126;font:11px/1.7 -apple-system,sans-serif;white-space:pre-wrap;z-index:3;",this.container.appendChild(this.errorElement)),this.errorElement.textContent=`3D 테란 전장을 표시할 수 없습니다.
${t?.message||t}
WebGL이 필요합니다. 다른 테마로 대체하지 않았습니다.`}drawHUD(){this.hud?.draw({accent:this.accent,selected:this.sessions.find(t=>t.id===this.selected)||null,mode:this.mode}),this.drawMinimap()}drawMinimap(){if(!this.hud)return;const t=this.hudCanvas.getContext("2d");t.fillStyle="#16251b",t.fillRect(7,351,126,124),t.fillStyle="#1d3021";for(let r=15;r<133;r+=16)t.fillRect(r,351,1,124);for(let r=359;r<475;r+=16)t.fillRect(7,r,126,1);t.fillStyle=this.accent,t.fillRect(7+$e.x/Xe.width*126-3,351+$e.y/Xe.height*124-3,6,6);for(let r=0;r<Rn.length;r++){const s=Rn[r],o=this.pools?ui(this.pools[r<4?"codex":"claude"]):this.pool,a=o.ratio??(o.remainingPercent===null?null:o.remainingPercent/100);a!==0&&(t.fillStyle=a===null?"#526b7b":"#7cbbed",t.fillRect(7+s[0]/Xe.width*126,351+s[1]/Xe.height*124,2,3))}for(const r of this.sessions){const s=this.units.get(r.id);s&&(t.fillStyle=r.id===this.selected?"#fff":r.status==="working"?this.accent:ci(r)?"#ebd483":"#8c9890",t.fillRect(7+s.x/Xe.width*126,351+s.y/Xe.height*124,2,2))}const e=this.unprojectGround(-1,1),n=this.unprojectGround(1,-1);t.strokeStyle="#c6d3c8",t.lineWidth=.6,t.strokeRect(7+e.x/Xe.width*126,351+e.y/Xe.height*124,(n.x-e.x)/Xe.width*126,(n.y-e.y)/Xe.height*124)}resize(){!this.renderer||!this.camera||(this.width=640,this.height=316,this.renderer.setSize(640,316,!1),this.applyCamera(1),this.enabled&&this.paint())}applyCamera(t=1){const e=this.orbitGoal,n=this.orbit;n.radius+=(e.radius-n.radius)*t,n.target.lerp(e.target,t),this.camera.zoom=69/n.radius,this.camera.position.set(n.target.x,n.target.y+Math.cos(Tn)*120,n.target.z+Math.sin(Tn)*120),this.camera.lookAt(n.target),this.camera.updateProjectionMatrix(),this.camera.updateMatrixWorld()}projectGround(t,e){const n=Gn(t,e).project(this.camera);return{x:(n.x+1)*320,y:(1-n.y)*158}}unprojectGround(t,e){const n=this.orbit.target,r=this.camera.zoom;return{x:320+(n.x+t*32/r)/ln,y:158+(n.z-e*15.8/r/Math.cos(Tn))*Math.cos(Tn)/ln}}bindPointer(){this.canvas.addEventListener("contextmenu",t=>t.preventDefault()),this.canvas.addEventListener("pointerdown",t=>{this.pointer={x:t.clientX,y:t.clientY,button:t.button,target:this.orbitGoal.target.clone(),dragged:!1},this.canvas.setPointerCapture?.(t.pointerId)}),this.canvas.addEventListener("pointermove",t=>{if(!this.pointer)return;const e=this.pointer,n=this.canvas.getBoundingClientRect(),r=(t.clientX-e.x)/n.width*640,s=(t.clientY-e.y)/n.height*316;Math.hypot(r,s)>3&&(e.dragged=!0),(e.button===2||e.button===1||t.shiftKey)&&(this.orbitGoal.target.copy(e.target),this.orbitGoal.target.x-=r*ln/this.camera.zoom,this.orbitGoal.target.z-=s*ln/Math.cos(Tn)/this.camera.zoom)}),this.canvas.addEventListener("pointerup",t=>{const e=this.pointer;if(this.pointer=null,!e||e.dragged||e.button!==0)return;const n=this.canvas.getBoundingClientRect();this.pointerVector.set((t.clientX-n.left)/n.width*2-1,-(t.clientY-n.top)/n.height*2+1),this.raycaster.setFromCamera(this.pointerVector,this.camera);const r=this.raycaster.intersectObjects(this.workforce.raycastMeshes,!1).find(o=>o.instanceId!==void 0),s=r?.object.userData.workerIDs?.[r.instanceId];s&&this.sessions.some(o=>o.id===s)&&this.onSelect(s)}),this.canvas.addEventListener("pointercancel",()=>this.pointer=null),this.canvas.addEventListener("wheel",t=>{t.preventDefault(),this.orbitGoal.radius=Math.max(38,Math.min(105,this.orbitGoal.radius*Math.exp(t.deltaY*.001)))},{passive:!1})}setAccent(t){const e=to(t);e!==this.accent&&(this.accent=e,this.world?.updateAccent(e),this.workforce?.setAccent(e),this.drawHUD(),this.enabled&&this.paint())}setMode(t){t!==this.mode&&(this.sessions=[],this.selected=null,this.enabled=!1,this.workforce?.clear()),this.mode=t,this.drawHUD(),this.container.dataset.mode=t,this.canvas?.setAttribute("aria-label",t==="preview"?"모델 호출 없는 SCV/Probe 3D 복셀 동작 미리보기":"실제 OS1 세션 · SCV/Probe 3D 복셀 테란 전장")}sync(t,e,n,r,s){this.sessions=t,this.selected=e,this.enabled=n,this.pool=ui(r),this.pools=s??null,this.world?.updateBudget(r,s);for(let o=0;o<t.length;o++){const a=t[o];this.units.has(a.id)||this.units.set(a.id,Im(a.id,o));const l=this.units.get(a.id);if(l.session=a,(a.status!=="working"||!n)&&(l.moving=!1,l.mining=!1),l.phase===0){const c=this.workforce?.style(a);l.lane=c==="claude"?4+o%4:c==="codex"?o%4:l.lane}}this.drawHUD(),this.workforce&&(this.workforce.update(this.sessions.map(o=>this.units.get(o.id)),this.selected,0,!1),n&&this.paint()),this.updateDiagnosticsDOM()}cameraInMotion(){const t=this.orbit,e=this.orbitGoal;return Math.abs(t.radius-e.radius)>.001||t.target.distanceToSquared(e.target)>1e-5}animate(t){if(this.disposed)return;if(requestAnimationFrame(this.animate),!this.loaded||this.failed||!this.enabled||document.visibilityState==="hidden"){this.last=t,this.lastRender=t;return}const e=new Set(this.sessions.filter(o=>o.status==="working").map(o=>o.id));if(!e.size&&!this.cameraInMotion()){this.last=t,this.lastRender=t,this.fps=0,t-this.lastDiagnostics>250&&(this.lastDiagnostics=t,this.updateDiagnosticsDOM());return}if(t-this.lastRender<16)return;const n=Math.max(0,Math.min((t-this.last)/1e3,.05)),r=t-this.lastRender;this.last=t,this.lastRender=t;const s=this.sessions.map(o=>this.units.get(o.id));Om(s,n,e),this.workforce.update(s,this.selected,n,!0),this.applyCamera(1-Math.exp(-10*n)),this.paint(),r>0&&r<150&&(this.frameEMA=this.frameEMA*.96+r*.04,this.fps=1e3/this.frameEMA,this.performanceSamples++),this.performanceSamples>120&&this.frameEMA>25&&this.quality==="high"&&this.reduceQuality(),t-this.lastDiagnostics>250&&(this.lastDiagnostics=t,this.updateDiagnosticsDOM())}reduceQuality(){this.quality="balanced",this.pixelRatio=Math.min(globalThis.devicePixelRatio||1,1),this.renderer.setPixelRatio(this.pixelRatio),this.sun.shadow.mapSize.set(1024,1024),this.sun.shadow.map?.dispose?.(),this.sun.shadow.map=null,this.sun.shadow.needsUpdate=!0,this.resize()}paint(){!this.loaded||this.failed||!this.enabled||document.visibilityState==="hidden"||(this.renderer.render(this.scene,this.camera),this.paintCount++,this.drawCalls=this.renderer.info?.render?.calls??0,this.triangles=this.renderer.info?.render?.triangles??0,this.drawMinimap())}focus(t){const e=this.units.get(t);e&&(this.orbitGoal.target.copy(Gn(e.x,e.y)),this.orbitGoal.radius=Math.min(this.orbitGoal.radius,50))}fit(){this.orbitGoal={theta:0,phi:Tn,radius:69,target:new F(0,0,0)}}states(){return this.sessions.map(t=>{const e=this.units.get(t.id),n=this.workforce?.style(t)||"neutral";return{id:t.id,name:t.name,status:t.status,x:+e.x.toFixed(3),y:+e.y.toFixed(3),phase:+e.phase.toFixed(3),moving:e.moving,mining:e.mining,cargo:e.cargo,mode:e.mode,cycles:e.cycles,appearance:n,objectIdentity:this.workforce?.identity(n),awaitingReview:ci(t),pose:this.workforce?.pose(t.id)||null}})}updateDiagnosticsDOM(){if(!this.canvas)return;const t=this.states();this.canvas.dataset.visibleUnits=String(t.length),this.canvas.dataset.movingUnits=String(t.filter(e=>e.moving).length),this.canvas.dataset.miningUnits=String(t.filter(e=>e.mining).length),this.canvas.dataset.workerStates=JSON.stringify(t),this.canvas.dataset.paintCount=String(this.paintCount),this.canvas.dataset.renderMode=this.mode,this.canvas.dataset.renderer=this.failed?"webgl-unavailable":"three-webgl-voxel",this.canvas.dataset.fps=this.fps.toFixed(1),this.canvas.dataset.drawCalls=String(this.drawCalls),this.canvas.dataset.quality=this.quality,this.canvas.dataset.dpr=String(this.pixelRatio),this.container.dataset.renderer=this.canvas.dataset.renderer}diagnostics(){const t=this.world?.diagnostics();return{mode:this.mode,visible:this.enabled,workers:this.states(),moving:this.states().filter(e=>e.moving).length,mining:this.states().filter(e=>e.mining).length,paintCount:this.paintCount,tokenPool:this.pool,tokenPools:this.pools,sourceSprites:"true 3D voxel SCV utility mechs / gold hovering Probes · procedural Minecraft-style pixel HUD",renderer:this.failed?"webgl-unavailable":"three-webgl-voxel",fps:+this.fps.toFixed(1),drawCalls:this.drawCalls,triangles:this.triangles,dpr:this.pixelRatio,quality:this.quality,staticWorld:t,hud:this.hud?.diagnostics()||null,objectIdentities:{...t?.objectIdentities,workers:this.workforce?.objectIdentities()},groundProjection:this.camera?{base:this.projectGround($e.x,$e.y),minerals:Rn.map(e=>this.projectGround(...e))}:null,camera:{projection:"orthographic original-layout lock",theta:0,phi:Tn,radius:this.orbit.radius,target:this.orbit.target.toArray(),width:640,height:316},error:this.failed?this.container.dataset.error:null}}dispose(){this.disposed=!0,this.enabled=!1,this.workforce?.dispose(),this.world?.dispose(),this.renderer?.dispose()}}const H=i=>document.querySelector(i),ks=i=>String(i??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t]),sc={sessions:[],selectedID:null,selectedOutputID:null,selectedResultRevision:null,selectedOutput:"",notice:"",visible:!1};let mr={...sc},Lt=mr,be=0,eo="",Yn="field",Fn=null,fi=null,Bn=[],nn,Gt=!1,we=null,Vs=!1,tn=null;const Wn=new Map,_n=new Set,_l=new Set;H("#app").innerHTML=`<div id="stage-shell"><main id="game" class="mc-interface" aria-label="OS1 StarCraft Terran / voxel style 세션 전장"><div id="world"></div>
<button class="mc-button hotspot" id="sessions-menu" aria-label="실제 세션 목록 F9" data-tooltip="실제 세션 목록 (F9)"><span class="strip-label">세션 F9</span></button><button class="mc-button hotspot" id="menu" aria-label="메뉴 F10" data-tooltip="메뉴 (F10)"><span class="strip-label">메뉴 F10</span></button><button class="mc-button hotspot" id="messages-menu" aria-label="선택한 세션 결과 F11" data-tooltip="선택한 세션 결과 (F11)"><span class="strip-label">결과 F11</span></button><button class="mc-button hotspot" id="help" aria-label="상태 검증 F12" data-tooltip="상태 검증 (F12)"></button>
<div id="resource-bar" class="mc-panel mc-resource"><span id="token-title">◆ 토큰</span><b id="token-value">—</b><span id="token-source"></span></div><div id="supply" class="mc-stat" data-tooltip="실제 전장 세션 / 실행 중 세션"></div>
<div id="preview-banner" class="mc-panel mc-preview" hidden><b>동작 미리보기 · 실제 작업/토큰 아님</b><button class="mc-button" id="preview-pause">선택 일꾼 정지</button><button class="mc-button" id="preview-resume">같은 일꾼 재개</button><button class="mc-button" id="preview-finish">종료 보기</button><label class="preview-quota">예시 잔량<select class="mc-select" id="preview-budget" aria-label="미리보기 예시 한도 비율"><option value="">미측정</option><option value="100">100%</option><option value="25">25%</option><option value="5">5%</option><option value="0">0%</option></select></label><button class="mc-button" id="preview-exit">실제 세션으로</button></div>
<div id="field-summary" class="mc-panel mc-summary"><span id="working-count">0 RUNNING</span><span id="waiting-count"></span><button class="mc-button" id="preview-enter">동작 미리보기</button></div>
<section id="fleet" class="mc-panel mc-drawer" aria-label="실제 OS1 세션 목록"><div class="fleet-head"><b>OS1 · WORKSHOP</b><span id="total"></span></div><div class="fleet-tabs"><button id="tab-field" class="mc-button active">전장</button><button class="mc-button" id="tab-all">전체 세션</button></div><label id="search-label">세션 검색<input class="mc-input" id="search" aria-label="세션 이름 검색" placeholder="세션 이름 검색…"></label><div id="units"></div><div class="fleet-nav"><button class="mc-button" id="prev" aria-label="이전 세션">‹</button><span id="page"></span><button class="mc-button" id="next" aria-label="다음 세션">›</button></div></section>
<div id="field-empty" class="mc-panel mc-empty" hidden>실행 중인 세션이 없습니다.<br><button class="mc-button" id="empty-new">+ 새 일꾼 / 세션</button><button class="mc-button" id="empty-preview">채광 동작 미리보기</button></div>
<section id="selected-info" class="mc-panel mc-selection"><h1 id="selected-title">SCV · SESSION</h1><p id="status">Standing by</p><p id="provider"></p><p id="usage"></p><div class="selected-buttons"><button class="mc-button" id="view-result">결과 확인</button><button class="mc-button" id="open-chat">대화 ↗</button></div></section>
<button class="mc-button hotspot" id="move" aria-label="선택한 일꾼에 작업 배정" data-tooltip="프롬프트 배정 (M / Enter)"></button><button class="mc-button hotspot" id="stop" aria-label="선택한 실제 세션 중단" data-tooltip="실제 작업 중단 (S)"></button><button class="mc-button hotspot" id="gather" aria-label="채광 작업 프롬프트" data-tooltip="프롬프트로 작업 배정 (G)"></button><button class="mc-button hotspot" id="focus" aria-label="선택 일꾼 찾기" data-tooltip="선택 일꾼 찾기 (Space)"></button><button class="mc-button hotspot" id="all" aria-label="전장 전체 보기" data-tooltip="전체 전장 / 미니맵"></button><button class="mc-button hotspot" id="repair" aria-label="같은 세션에 다시 작업 배정" data-tooltip="같은 세션 재작업 (R)"></button><button class="mc-button hotspot" id="build" aria-label="새 일꾼 세션 생성" data-tooltip="새 일꾼 · 실제 OS1 세션 (N)"></button><button class="mc-button hotspot" id="base" aria-label="선택 세션의 실제 채팅 열기" data-tooltip="전체 대화 열기"></button><button class="mc-button hotspot" id="close" aria-label="시뮬레이션 닫기" data-tooltip="OS1 채팅으로"><span class="strip-label">OS1</span></button>
<div id="command-label">N 새 일꾼 · Enter 작업 · S 중단 · 휠 확대 · 우클릭 드래그</div>
<section id="order-panel" class="mc-panel mc-modal" hidden><div class="panel-heading"><span>WORKER · 작업 배정</span><button class="mc-button" id="close-order" aria-label="프롬프트 닫기">×</button></div><p id="order-name"></p><form id="order-form"><textarea class="mc-input" id="prompt" aria-label="일꾼 세션 작업 프롬프트" placeholder="이 세션에 실행할 작업을 입력하세요…" maxlength="32000" rows="4"></textarea><div class="order-bottom"><span id="notice"></span><button class="mc-button" id="dispatch" type="submit">실제 작업 보내기 →</button></div></form></section>
<section id="transmission" class="mc-panel mc-modal" hidden><div class="panel-heading"><span id="transmission-title">RESULT TRANSMISSION</span><button class="mc-button" id="close-result" aria-label="응답 닫기">×</button></div><p id="result-name"></p><pre id="result"></pre><div class="result-actions"><button class="mc-button" id="review-result" disabled>결과 확인 · 일꾼 귀환</button><button class="mc-button" id="result-chat">전체 대화 ↗</button></div><p id="review-note">확인하면 전장에서만 사라집니다. 세션과 대화는 보존됩니다.</p></section>
<section id="menu-panel" class="mc-panel mc-modal" hidden><h2>Menu</h2><button class="mc-button" id="resume">전장으로 돌아가기</button><button class="mc-button" id="new">새 일꾼 · 새 OS1 세션</button><button class="mc-button" id="preview-menu">동작 미리보기 · 모델 호출 없음</button><button class="mc-button" id="appearance">색상 설정 · Appearance</button><button class="mc-button" id="native-chat">OS1 채팅으로 돌아가기</button></section>
<section id="help-panel" class="mc-panel mc-modal" hidden><div class="panel-heading"><span>LIVE STATE / RUNTIME</span><button class="mc-button" id="close-help" aria-label="상태 닫기">×</button></div><p>일꾼 1기 = 실제 세션 1개. 병렬 실행은 전장에 모두 표시됩니다. 세션 목록의 페이지/검색은 전장 수를 제한하지 않습니다.</p><p>실행: SCV/PROBE 왕복 채광 + 3D voxel 애니메이션. 원래 테란 오브젝트와 배치는 유지하고, HUD·초상화·명령 버튼·패널은 절차 생성 voxel/pixel 스타일로 표시합니다.<br>종료/중단/실패: 현 위치 정지. 결과를 표시하고 직접 확인해야 귀환합니다. 같은 세션에 새 작업을 주면 같은 일꾼이 다시 움직입니다.</p><p>미네랄은 토큰/공급자 사용 한도의 표시입니다. 알려진 원자료만 표시하며, 채광 왕복 횟수로 토큰 사용량을 만들지 않습니다. 잔여 수량이 없으면 — 로 표시합니다.</p><pre id="pixel-check"></pre></section>
<div id="ui-tooltip" role="tooltip" hidden></div>
</main></div>`;function sn(i,t={}){if(Gt)return!1;const e=window.webkit?.messageHandlers?.os1Simulation;return e?(e.postMessage({action:i,...t}),!0):(H("#notice").textContent="OS1 앱 안에서 실제 세션에 연결됩니다.",!1)}const ce=()=>fi??Lt.selectedID,Ne=()=>Lt.sessions.find(i=>i.id===ce()),ac=()=>Bm(Lt.sessions,_n);function oc(){const i=Yn==="field"?ac():Lt.sessions,t=new Map(i.map(e=>[e.id,e]));return Bn.map(e=>t.get(e)).filter(Boolean).filter(e=>e.name.toLowerCase().includes(eo.toLowerCase()))}function lc(){return oc().slice(be*6,be*6+6)}function sg(i){return JSON.stringify([i.selectedID,i.selectedOutputID,i.selectedResultRevision,i.selectedOutput,i.notice,i.visible,i.accentHex,i.tokenPool,i.tokenPools,i.sessions.map(t=>[t.id,t.name,t.engine,t.status,t.activity,t.tokensUsed,t.usageLabel,t.resultRevision,t.reviewed,t.hasResult,t.featured,t.resultPending])])}function no(i,t=!0){Wn.set(ce(),H("#prompt").value),fi=i,we=null,H("#prompt").value=Wn.get(i)||"",_n.add(i),Gt?(Lt.selectedID=i,Lt.selectedOutputID=i,Lt.selectedResultRevision=Ne()?.resultRevision??null,Lt.selectedOutput=Ne()?.hasResult?"미리보기 작업이 종료되었습니다. 실제 모델 응답이 아닙니다.":"",fi=null):sn("select",{id:i}),t&&Ne()?.hasResult&&(H("#transmission").hidden=!1),_e()}function ar(){if(Ne()){if(Gt){H("#preview-banner").classList.add("attention"),setTimeout(()=>H("#preview-banner").classList.remove("attention"),500);return}_n.add(ce()),H("#order-panel").hidden=!1,H("#prompt").focus(),_e()}}function cc(){const i=Ne(),t=ce(),e=Lt.selectedID===t&&(Lt.selectedOutputID??Lt.selectedID)===t&&(!Lt.selectedResultRevision||Lt.selectedResultRevision===i?.resultRevision);return{matched:e,output:e&&Lt.selectedOutput||"",revision:e?i?.resultRevision:null}}function io(){Ne()&&(H("#transmission").hidden=!1,we=null,_e())}function ag(){Vs||H("#transmission").hidden||!Lt.visible||document.visibilityState==="hidden"||(Vs=!0,requestAnimationFrame(()=>requestAnimationFrame(()=>{Vs=!1;const i=Ne(),t=cc();if(H("#transmission").hidden||!Lt.visible||document.visibilityState==="hidden"||!i||!t.matched||!t.output||!t.revision)return;we={id:i.id,revision:t.revision,hasOutput:!0};const e=i.id+":"+t.revision;_l.has(e)||(Gt||sn("inspect",{id:i.id,text:t.revision}))&&_l.add(e),H("#review-result").disabled=!is(i,we)})))}const vl=i=>i>0&&i<.1?"<0.1":i>99.9&&i<100?">99.9":new Intl.NumberFormat("en-US",{maximumFractionDigits:1}).format(i);function og(){const i=ui(Lt.tokenPool),t=e=>e.toLocaleString("en-US");H("#token-title").textContent=Gt?"◆ PREVIEW":`◆ ${i.label}`,H("#token-value").textContent=Gt?i.remainingPercent!==null?`예시 ${vl(i.remainingPercent)}%`:"예시 미측정 ?":i.remaining!==null?`${t(i.remaining)} 남음`:i.remainingPercent!==null?`${vl(i.remainingPercent)}% 남음`:i.used!==null?`${t(i.used)} 사용`:"잔여 미측정 ?",H("#token-source").textContent=Gt?"실제 토큰 아님":i.source,H("#resource-bar").setAttribute("data-tooltip",Gt?"진단용 가상 일꾼입니다. 실제 작업/토큰을 표시하지 않습니다.":[i.source,Lt.tokenPool?.quota?.basis,Lt.tokenPool?.quota?.observedAt].filter(Boolean).join(`
`))}function _e(){const i=Hm(Lt.accentHex);nn?.setAccent(i);const t=oc(),e=Math.max(1,Math.ceil(t.length/6));be=Math.min(Math.max(0,be),e-1);const n=Ne(),r=ac(),s=r.filter(l=>l.status==="working").length,o=r.filter(ci).length;H("#total").textContent=`${r.length} / ${Lt.sessions.length}`,H("#page").textContent=`${be+1} / ${e}`,H("#prev").disabled=be===0,H("#next").disabled=be+1>=e,H("#supply").textContent=`${r.length} / ${s}`,H("#working-count").textContent=Gt?`${s} PREVIEW`:`${s} RUNNING`,H("#waiting-count").textContent=o?`${o} 결과 대기`:r.length?`${r.length} ON FIELD`:"실제 활성 작업 없음",H("#field-empty").hidden=r.length>0,H("#preview-banner").hidden=!Gt,H("#preview-enter").hidden=Gt,H("#tab-field").classList.toggle("active",Yn==="field"),H("#tab-all").classList.toggle("active",Yn==="all"),og(),H("#units").innerHTML=lc().map((l,c)=>`<button data-id="${ks(l.id)}" class="mc-button session ${l.id===ce()?"selected":""}" aria-pressed="${l.id===ce()}" data-tooltip="${ks(l.name)}"><span class="unit-number">${Hs(l)==="protoss"?"◈":String(be*6+c+1).padStart(2,"0")}</span><span>${ks(l.name)}</span><i class="${ci(l)?"result":l.status}"></i></button>`).join("")||'<p class="empty">해당 세션이 없습니다.</p>',H("#selected-title").textContent=n?.name||"SCV · SESSION",H("#selected-title").setAttribute("data-tooltip",n?.name||""),H("#order-name").textContent=n?.name||"",H("#provider").textContent=n?`${Hs(n)==="protoss"?"PROBE":Hs(n)==="terran"?"SCV":"WORKER"} · ${n.engine||"엔진 경로 대기"}`:"",H("#status").textContent=n?.status==="working"?Gt?"미리보기 · 채광 중":"Gathering · 실제 실행 중":n?.status==="queued"?Gt?"미리보기 · 대기":"Queued · 실제 작업 대기":ci(n)?Gt?"미리보기 · 종료 / 결과 확인":n.status==="failed"?"작업 오류 · 결과 확인 필요":"작업 종료 · 결과 확인 필요":n?.reviewed?Gt?"미리보기 · 보관됨":"보관됨 · 다시 배정 가능":n?Gt?"미리보기 · 정지":"Idle · 명령 대기":"일꾼을 선택하세요",H("#status").className=n?.status||"",H("#usage").textContent=n?.tokensUsed!=null?`이 작업 ${n.tokensUsed.toLocaleString("en-US")} tokens`:n?.usageLabel||"";const a=cc();H("#result-name").textContent=n?.name||"",H("#result").textContent=a.matched?a.output||"아직 수신된 결과가 없습니다.":"선택한 세션의 결과를 수신 중…",H("#transmission-title").textContent=Gt?"PREVIEW · 실제 모델 응답 아님":n?.status==="failed"?"ERROR TRANSMISSION":"RESULT TRANSMISSION",H("#review-result").disabled=!is(n,we)||!a.matched||!!tn,H("#review-result").textContent=tn?"확인 반영 중…":n?.reviewed?"확인됨 · 대화 보존":"결과 확인 · 일꾼 귀환",H("#view-result").disabled=!n?.hasResult,H("#notice").textContent=Lt.notice||n?.activity||"같은 실제 OS1 세션에 이어서 실행됩니다.",H("#dispatch").disabled=!n||n.status==="working"||Gt,H("#stop").disabled=n?.status!=="working",H("#stop").setAttribute("aria-label",Gt?"미리보기 일꾼 정지":"선택한 실제 세션 중단"),H("#stop").setAttribute("data-tooltip",Gt?"미리보기 일꾼 정지 (모델 호출 없음)":"실제 작업 중단 (S)");for(const l of["open-chat","result-chat","base","new","build","appearance","native-chat","close","empty-new"])H("#"+l).disabled=Gt;H("#command-label").textContent=Gt?"미리보기 · S 정지 · 상단에서 같은 일꾼 재개 / 종료 · 실제 작업 아님":"N 새 일꾼 · Enter 작업 · S 중단 · 휠 확대 · 우클릭 드래그",nn?.sync(r,ce(),Lt.visible,Lt.tokenPool,Lt.tokenPools),ag()}nn=new rg(H("#world"),i=>no(i,!0));nn.ready.then(()=>_e()).catch(i=>{H("#notice").textContent=i.message,H("#order-panel").hidden=!1});let xl="";window.os1SimulationUpdate=i=>{const t=sg(i);if(t===xl)return;if(xl=t,mr=i,Gt){Lt.visible=i.visible,_e();return}const e=ce(),n=i.sessions.map(s=>s.id),r=n.filter(s=>!Bn.includes(s));if(Bn.length)for(const s of r)_n.add(s);if(Bn=Bn.length?[...r,...Bn.filter(s=>n.includes(s))]:n,Lt=i,fi===i.selectedID&&(fi=null),tn){const s=Lt.sessions.find(o=>o.id===tn.id);s?.reviewed===!0&&s.resultRevision===tn.revision?(_n.delete(s.id),tn=null,we=null,H("#transmission").hidden=!0):(!s||s.resultRevision!==tn.revision||s.status==="working")&&(tn=null,we=null)}if(Fn){const s=Lt.sessions.find(o=>o.id===Fn.id);s&&["working","queued"].includes(s.status)?(ce()===Fn.id&&H("#prompt").value===Fn.text&&(H("#prompt").value=""),Wn.set(Fn.id,""),Fn=null,H("#order-panel").hidden=!0):Lt.notice&&(Fn=null)}e!==ce()&&(Wn.set(e,H("#prompt").value),H("#prompt").value=Wn.get(ce())||"",we=null),_e()};H("#units").onclick=i=>{const t=i.target.closest("[data-id]");t&&no(t.dataset.id)};H("#search").oninput=i=>{eo=i.target.value,be=0,_e()};H("#prev").onclick=()=>{be--,_e()};H("#next").onclick=()=>{be++,_e()};H("#tab-field").onclick=()=>{Yn="field",be=0,_e()};H("#tab-all").onclick=()=>{Yn="all",be=0,_e()};H("#order-form").onsubmit=i=>{i.preventDefault();const t=H("#prompt").value.trim();Gt||!t||!Ne()||Ne().status==="working"||(Fn={id:ce(),text:t},_n.add(ce()),sn("order",{id:ce(),text:t}))};H("#prompt").oninput=()=>Wn.set(ce(),H("#prompt").value);H("#prompt").onkeydown=i=>{i.key==="Enter"&&(i.metaKey||i.ctrlKey)&&(i.preventDefault(),H("#order-form").requestSubmit())};H("#open-chat").onclick=H("#result-chat").onclick=H("#base").onclick=()=>ce()&&sn("open",{id:ce()});H("#close").onclick=H("#native-chat").onclick=()=>sn("close");H("#new").onclick=H("#build").onclick=H("#empty-new").onclick=()=>sn("new");H("#stop").onclick=()=>{if(Gt){uc();return}ce()&&sn("stop",{id:ce()})};H("#move").onclick=H("#gather").onclick=H("#repair").onclick=ar;H("#focus").onclick=()=>nn.focus(ce());H("#all").onclick=()=>nn.fit();H("#menu").onclick=()=>H("#menu-panel").hidden=!H("#menu-panel").hidden;H("#resume").onclick=()=>H("#menu-panel").hidden=!0;H("#messages-menu").onclick=H("#view-result").onclick=io;H("#close-result").onclick=()=>{we=null,H("#transmission").hidden=!0};H("#close-order").onclick=()=>H("#order-panel").hidden=!0;H("#sessions-menu").onclick=()=>H("#fleet").classList.toggle("hidden-fleet");H("#appearance").onclick=()=>sn("settings");H("#review-result").onclick=()=>{const i=Ne();if(is(i,we)){if(Gt){i.reviewed=!0,i.resultPending=!1,i.featured=!1,_n.delete(i.id),H("#transmission").hidden=!0,we=null,_e();return}tn={id:i.id,revision:i.resultRevision},sn("review",{id:i.id,text:i.resultRevision})||(tn=null),_e()}};function lg(){const i=nn.diagnostics();H("#pixel-check").textContent=`MODE: ${Gt?"MODEL-FREE PREVIEW":"NATIVE SESSIONS"}
OBJECT / LAYOUT: StarCraft Terran · SCV / PROBE / Command Center / blue minerals
RENDER STYLE: VOXEL 3D
HUD SOURCE: ${i.hud?.source||"미제공"}
UI STYLE: procedural pixel-block HUD / portraits / commands / panels
RENDERER: ${i.renderer||"3D renderer"}
FPS: ${Number.isFinite(i.fps)?Math.round(i.fps):"—"}
DRAW CALLS: ${Number.isFinite(i.drawCalls)?i.drawCalls:"—"}
FIELD: ${i.workers.length} · MOVING: ${i.moving} · MINING: ${i.mining}
TOKEN SOURCE: ${i.tokenPool?.source||"unavailable"}
BASIS: ${Lt.tokenPool?.quota?.basis||"미제공"}
OBSERVED AT: ${Lt.tokenPool?.quota?.observedAt||"미제공"}
SCOPE: 테란 오브젝트·배치·세션 동작 유지 · HUD와 모든 패널은 voxel/pixel 스타일`}H("#help").onclick=()=>{H("#help-panel").hidden=!H("#help-panel").hidden,lg()};H("#close-help").onclick=()=>H("#help-panel").hidden=!0;function cg(){if(!Gt){Wn.set(ce(),H("#prompt").value),Gt=!0,fi=null,tn=null,we=null,_n.clear(),Lt={...sc,visible:!0,accentHex:mr.accentHex,selectedID:"preview-worker-01",selectedOutputID:"preview-worker-01",sessions:Array.from({length:12},(i,t)=>({id:`preview-worker-${String(t+1).padStart(2,"0")}`,name:`미리보기 일꾼 ${String(t+1).padStart(2,"0")}`,engine:t<8?"Codex · 미리보기":"Claude · 미리보기",status:"working",featured:!0,hasResult:!1,resultPending:!1,reviewed:!1})),tokenPool:{label:"PREVIEW",source:"모델 호출 없음 · 실제 토큰 아님"}},Bn=Lt.sessions.map(i=>i.id),eo="",H("#search").value="",be=0,Yn="field";for(const i of["menu-panel","transmission","order-panel","help-panel"])H("#"+i).hidden=!0;H("#preview-budget").value="",nn.setMode("preview"),_e()}}function ug(){if(Gt){Gt=!1,Lt=mr,Bn=Lt.sessions.map(i=>i.id),fi=null,we=null,_n.clear(),Yn="field",be=0,H("#prompt").value=Wn.get(Lt.selectedID)||"";for(const i of["menu-panel","transmission","order-panel","help-panel"])H("#"+i).hidden=!0;nn.setMode("native"),_e()}}H("#preview-budget").onchange=i=>{Gt&&(Lt.tokenPool={label:"미리보기 예시 한도",remainingPercent:i.target.value===""?null:Number(i.target.value),source:"미리보기용 예시 비율 · 실제 토큰 아님"},_e())};function uc(){const i=Ne();!Gt||!i||(i.status="idle",i.featured=!0,i.resultPending=!1,_e())}H("#preview-enter").onclick=H("#empty-preview").onclick=H("#preview-menu").onclick=cg;H("#preview-exit").onclick=ug;H("#preview-pause").onclick=uc;H("#preview-resume").onclick=()=>{const i=Ne();!Gt||!i||(i.status="working",i.reviewed=!1,i.resultPending=!1,i.hasResult=!1,i.featured=!0,Lt.selectedOutput="",Lt.selectedResultRevision=null,_n.add(i.id),H("#transmission").hidden=!0,_e())};H("#preview-finish").onclick=()=>{const i=Ne();!Gt||!i||(i.status="idle",i.hasResult=!0,i.resultPending=!0,i.reviewed=!1,i.resultRevision=`${i.id}:preview-result`,Lt.selectedOutputID=i.id,Lt.selectedResultRevision=i.resultRevision,Lt.selectedOutput=`미리보기 작업이 종료되었습니다. 실제 모델 응답이 아닙니다.

일꾼은 현 위치에 멈춥니다. 결과를 직접 확인하면 전장에서 사라지고, 같은 세션에 다시 배정할 수 있습니다.`,io())};document.addEventListener("keydown",i=>{if(i.metaKey||i.ctrlKey||i.altKey)return;if(i.key==="Escape"){i.preventDefault(),rs();for(const n of["order-panel","transmission","menu-panel","help-panel"])H("#"+n).hidden=!0;we=null;return}if(["INPUT","TEXTAREA","SELECT"].includes(i.target.tagName)||i.target.isContentEditable)return;const t=Number(i.key);if(t>=1&&t<=6){const n=lc()[t-1];n&&no(n.id);return}const e={Enter:ar,g:ar,m:ar,r:ar,s:()=>H("#stop").click(),n:()=>sn("new")," ":()=>nn.focus(ce()),F9:()=>H("#sessions-menu").click(),F10:()=>H("#menu").click(),F11:io,F12:()=>H("#help").click()}[i.key];e&&(i.preventDefault(),e())});function rs(){H("#ui-tooltip").hidden=!0}function hc(i){const t=i.target?.closest?.("[data-tooltip]"),e=H("#ui-tooltip"),n=t?.getAttribute?.("data-tooltip");if(!n){rs();return}const r=H("#game").getBoundingClientRect(),s=t.getBoundingClientRect(),o=r.width/640||1,a=Math.max(5,Math.min(440,(s.left-r.left)/o)),l=(s.top-r.top)/o;e.textContent=n,e.style.left=`${a}px`,e.style.top=`${l>37?l-30:(s.bottom-r.top)/o+5}px`,e.hidden=!1}document.addEventListener("pointerover",hc);document.addEventListener("focusin",hc);document.addEventListener("pointerout",rs);document.addEventListener("focusout",rs);window.os1SimulationDiagnostics=()=>({...nn.diagnostics(),nativeSessionCount:mr.sessions.length,selectedID:ce(),selectedOutputID:Lt.selectedOutputID,selectedResultRevision:Lt.selectedResultRevision,displayedResult:we,canAcknowledge:is(Ne(),we),rosterMode:Yn,rosterPage:be});function dc(){const i=H("#stage-shell"),t=Math.min(i.clientWidth/640,i.clientHeight/480);H("#game").style.transform=`translate(-50%,-50%) scale(${t})`}new ResizeObserver(dc).observe(H("#stage-shell"));dc();_e();sn("ready");

})();
