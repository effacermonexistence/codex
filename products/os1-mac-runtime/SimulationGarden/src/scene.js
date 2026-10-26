import * as THREE from 'three';

const PALETTE = { hull: 0x454d4b, edge: 0x232d2e, roof: 0x6c7469, orange: 0xc79449, light: 0x9cdddb, green: 0xaff589 };
const mk = (color, roughness = .72, metalness = .4) => new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
const hull = mk(PALETTE.hull), edge = mk(PALETTE.edge), roof = mk(PALETTE.roof), amber = mk(PALETTE.orange), dark = mk(0x1a2425), silver = mk(0x98a69c), rubber = mk(0x131b1a);
const glow = (color, intensity = 1.5) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: .25, metalness: .6 });
const cyan = glow(0x52c6d8), orange = glow(0xe9a24b), green = glow(0x7dd58b);

function box(parent, x, y, z, w, h, d, mat = hull, angle = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = angle; m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function cyl(parent, x, y, z, rt, rb, h, mat = hull, sides = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, sides), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function line(parent, points, color, opacity = 1) {
  const m = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p))), new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity })); parent.add(m); return m;
}
function ring(parent, radius, color, y = .1, width = .035) {
  const m = new THREE.Mesh(new THREE.RingGeometry(radius - width, radius, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .85, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.y = y; parent.add(m); return m;
}
function textTexture(text, color = '#f0f4d9', size = 48) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const ctx = c.getContext('2d'); ctx.font = `600 ${size}px -apple-system, sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.fillText(text, 256, 66);
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}
function groundLabel(parent, text, x, z, width = 4.5, color) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 96 / 512), new THREE.MeshBasicMaterial({ map: textTexture(text, color), transparent: true, depthWrite: false }));
  p.rotation.x = -Math.PI / 2; p.position.set(x, .045, z); parent.add(p); return p;
}
export function makeWorker(color = 0xc89b50) {
  const g = new THREE.Group(); const paint = mk(color);
  // Original utility walker: articulated legs, industrial plating, welder arm.
  box(g, -.32, .28, .16, .32, .28, .69, edge); box(g, .32, .28, .16, .32, .28, .69, edge);
  for (const x of [-.32, .32]) {
    box(g, x, .45, .12, .2, .4, .23, silver, x * .6);
    box(g, x, .14, .26, .38, .14, .68, rubber);
    box(g, x, .62, .08, .34, .32, .41, paint);
    box(g, x, .33, -.07, .14, .13, .19, dark);
  }
  box(g, 0, .86, 0, .85, .54, .66, paint);
  box(g, 0, 1.18, -.02, .54, .22, .46, paint);
  box(g, 0, 1.1, .34, .48, .16, .035, cyan);
  box(g, 0, .88, .34, .31, .13, .08, dark);
  for (const x of [-.23, 0, .23]) box(g, x, .92, -.36, .1, .35, .14, edge);
  box(g, -.59, .85, .1, .27, .36, .29, paint, -.2);
  const arm = box(g, -.62, .6, .34, .18, .34, .18, silver); arm.rotation.x = -.5;
  box(g, -.61, .46, .56, .18, .16, .36, edge);
  box(g, .56, .85, .14, .25, .34, .32, paint);
  const drill = box(g, .58, .62, .48, .15, .18, .53, silver); drill.rotation.x = -.2;
  cyl(g, .58, .57, .75, .08, .04, .2, orange, 6).rotation.x = Math.PI / 2;
  box(g, .38, 1.43, -.16, .025, .48, .025, silver);
  cyl(g, .38, 1.69, -.16, .045, .045, .06, orange);
  box(g, 0, .84, -.47, .44, .43, .18, edge);
  box(g, 0, .8, -.58, .26, .13, .05, cyan);
  return g;
}

const SITES = [[4.8, 2.7], [1, -6.8], [-8.5, 3.5], [6.8, -4], [-5.9, -7.1], [-2, 7.8], [10, 3.5], [-11, -3]];
export class CommandScene {
  constructor(container, { select, move }) {
    this.container = container; this.onSelect = select; this.onMove = move; this.units = new Map(); this.selected = new Set(); this.state = []; this.elapsed = 0; this.zoom = 1.12; this.pan = new THREE.Vector3(); this.paused = false; this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; this.renderer.setClearColor(0x80a884); this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.3;
    container.appendChild(this.renderer.domElement); this.renderer.domElement.setAttribute('aria-label', '3D agent command map. Use the unit roster to select workers with a keyboard.');
    this.scene = new THREE.Scene(); this.scene.fog = new THREE.FogExp2(0xa5c4a0, .009);
    this.camera = new THREE.OrthographicCamera(-20, 20, 12, -12, .1, 200); this.camera.position.set(25, 29, 32); this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xc9e6dd, 0x456e30, 2.8));
    const sun = new THREE.DirectionalLight(0xffebbd, 4.1); sun.position.set(-15, 23, 12); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25 }); sun.shadow.bias = -.0005; this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x73bacc, 1.5); fill.position.set(12, 9, -20); this.scene.add(fill);
    this.map = new THREE.Group(); this.scene.add(this.map); this.buildWorld();
    this.ray = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    let down;
    container.addEventListener('pointerdown', e => { if (e.button === 1) { down = { x: e.clientX, y: e.clientY }; e.preventDefault(); } });
    container.addEventListener('pointermove', e => { if (down && e.buttons === 4) { this.pan.x -= (e.clientX - down.x) * .025; this.pan.z -= (e.clientY - down.y) * .025; down = { x: e.clientX, y: e.clientY }; this.updateCamera(); } });
    container.addEventListener('pointerup', () => { down = null; });
    container.addEventListener('click', e => this.pick(e));
    container.addEventListener('contextmenu', e => { e.preventDefault(); const p = this.groundPoint(e); if (p) { this.onMove(p.x, p.z); this.ping(p.x, p.z); } });
    container.addEventListener('wheel', e => { e.preventDefault(); this.setZoom(this.zoom * (e.deltaY > 0 ? .94 : 1.06)); }, { passive: false });
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container); this.resize();
    this.last = performance.now(); this.animate = this.animate.bind(this); requestAnimationFrame(this.animate);
  }
  buildWorld() {
    const m = this.map;
    // Procedural terrain, not borrowed game assets.
    const c = document.createElement('canvas'); c.width = c.height = 1024; const ctx = c.getContext('2d');
    ctx.fillStyle = '#719848'; ctx.fillRect(0, 0, 1024, 1024);
    let seed = 7183; const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < 55000; i++) { const v = 65 + Math.floor(random() * 70); ctx.fillStyle = `rgba(${Math.floor(v * .67)},${v + 36},${Math.floor(v * .35)},${.2 + random() * .4})`; const s = 1 + random() * 5; ctx.fillRect(random() * 1024, random() * 1024, s, s); }
    const texture = new THREE.CanvasTexture(c); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(6, 6); texture.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), new THREE.MeshStandardMaterial({ map: texture, roughness: 1, color: 0xc9df98 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; m.add(ground);
    const grid = new THREE.GridHelper(76, 38, 0xa3c57d, 0x91b968); grid.position.y = .015; grid.material.transparent = true; grid.material.opacity = .08; m.add(grid);
    // Colony concrete perimeter and inset metallic octagonal command deck.
    cyl(m, -2.8, .06, -.6, 5, 5.2, .12, mk(0x414b47), 8);
    const pad = cyl(m, -2.8, .16, -.6, 4.5, 4.6, .18, edge, 8); pad.rotation.y = Math.PI / 8;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4; const x = -2.8 + Math.cos(a) * 4.6, z = -.6 + Math.sin(a) * 4.6;
      box(m, x, .26, z, 1.1, .09, .14, amber, -a);
    }
    // Central command structure.
    const b = new THREE.Group(); b.position.set(-2.8, .3, -.6); m.add(b);
    cyl(b, 0, .25, 0, 2.6, 3, .5, hull, 8);
    cyl(b, 0, .9, 0, 2.15, 2.6, 1, roof, 8);
    cyl(b, 0, 1.45, -.15, 1.95, 2.18, .36, edge, 8);
    box(b, 0, 1.73, -.4, 2.6, .3, 2.05, roof);
    box(b, 0, 1.93, -.4, 2.25, .12, 1.72, hull);
    box(b, 0, 2.02, -.4, .46, .08, 1.68, amber);
    box(b, 0, .6, 2.1, 1.65, .85, .48, dark);
    box(b, 0, 1.03, 2.38, 1.85, .15, .08, amber);
    for (let i = 0; i < 5; i++) box(b, -.65 + i * .33, .65, 2.37, .23, .53, .025, i === 2 ? cyan : hull);
    for (const x of [-2.2, 2.2]) {
      box(b, x, .9, .05, .9, .65, 2.8, hull);
      box(b, x, 1.23, -.25, .95, .12, 1.9, amber);
      for (let z = -.9; z <= .9; z += .35) box(b, x, 1.31, z, .65, .035, .12, dark);
      box(b, x, .48, 1.65, .72, .38, .65, edge);
      box(b, x, .73, 1.8, .49, .07, .08, cyan);
    }
    // Communications mast and rotating radar.
    cyl(b, -.75, 2.63, -1.1, .08, .13, 1.5, silver);
    this.radar = new THREE.Group(); this.radar.position.set(-.75, 3.35, -1.1); b.add(this.radar);
    box(this.radar, 0, .12, 0, 1.35, .24, .15, silver); box(this.radar, 0, .3, 0, .12, .55, .15, hull);
    box(b, .8, 2.6, -.95, .1, 1.3, .1, dark); cyl(b, .8, 3.3, -.95, .07, .07, .11, orange);
    groundLabel(m, 'OS1 // SESSION GARDEN', -2.8, 3.25, 4.5, '#c4b485');
    // Work nodes. A unit's slot stays attached to its persistent session.
    SITES.forEach(([x, z], i) => {
      const site = new THREE.Group(); site.position.set(x, 0, z); m.add(site);
      box(site, 0, .045, 0, 2.8, .09, 2.8, mk(0x343d38));
      for (const dx of [-1.38, 1.38]) for (const dz of [-1.38, 1.38]) {
        box(site, dx, .1, dz, .5, .025, .045, amber); box(site, dx, .1, dz, .045, .025, .5, amber);
      }
      cyl(site, 0, .12, 0, .82, .95, .17, edge, 8);
      ring(site, .86, 0x5d8f8b, .23, .025);
      box(site, .8, .49, -.85, .55, .8, .4, hull); box(site, .8, .95, -.85, .62, .12, .5, edge);
      box(site, .8, .71, -.62, .32, .28, .02, cyan);
      groundLabel(site, `WORKSITE ${String(i + 1).padStart(2, '0')}`, 0, 1.92, 2.9, '#9caa8f');
      line(m, [[-2.8, .03, -.6], [x, .03, z]], 0xa4ac83, .16);
    });
    // Blue resource crystals, warm peripheral boulders, pipes and supply crates.
    const crystal = new THREE.MeshPhysicalMaterial({ color: 0x40a4bd, emissive: 0x13536e, emissiveIntensity: .75, metalness: .4, roughness: .2, flatShading: true });
    for (let i = 0; i < 24; i++) {
      const x = 4 + random() * 7, z = -12 - random() * 3, h = .7 + random() * 1.5;
      const rock = new THREE.Mesh(new THREE.ConeGeometry(.3 + random() * .5, h, 5), crystal); rock.position.set(x, h / 2, z); rock.rotation.set(random() * .3, random() * 6, random() * .4); rock.castShadow = true; m.add(rock);
    }
    groundLabel(m, 'CONTEXT SPRING', 7, -9.8, 4, '#70bcc8');
    for (let i = 0; i < 100; i++) {
      const x = (random() - .5) * 65, z = (random() - .5) * 55;
      if (Math.abs(x) < 15 && Math.abs(z) < 12) continue;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(.4 + random() * 1.6, 0), mk(0x747e5b)); rock.position.set(x, .1, z); rock.scale.set(1.5, .5 + random(), 1); rock.rotation.y = random() * 5; rock.castShadow = true; m.add(rock);
    }
    for (let i = 0; i < 12; i++) {
      const x = -11 + (i % 4) * .8, z = -9 + Math.floor(i / 4) * .7;
      box(m, x, .32, z, .65, .64, .6, i % 3 ? hull : amber); box(m, x, .66, z, .08, .02, .58, edge);
    }
    for (let i = 0; i < 4; i++) {
      cyl(m, -14, .65, 1.8 + i * 1.4, .5, .5, 1.3, hull, 12); cyl(m, -14, 1.33, 1.8 + i * 1.4, .37, .5, .12, amber, 12);
    }
    // Sunny grassland: deterministic, local geometry only.
    const grassGeometry = new THREE.ConeGeometry(.025, .25, 3);
    const grassMat = mk(0x638f3e, 1, 0);
    const grasses = new THREE.InstancedMesh(grassGeometry, grassMat, 2600);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 2600; i++) {
      let x = (random() - .5) * 55, z = (random() - .5) * 44;
      if (Math.abs(x) < 12 && Math.abs(z) < 9) { x += Math.sign(x || 1) * 13; }
      dummy.position.set(x, .11, z); dummy.scale.setScalar(.55 + random() * 1.1); dummy.rotation.set(0, random() * 6, .12); dummy.updateMatrix(); grasses.setMatrixAt(i, dummy.matrix);
    }
    m.add(grasses);
    for (let i = 0; i < 37; i++) {
      let x = (random() - .5) * 55, z = (random() - .5) * 44;
      if (Math.abs(x) < 15 && Math.abs(z) < 12) continue;
      const h = 1.6 + random() * 2.2;
      cyl(m, x, .45, z, .12, .18, .9, mk(0x71604a), 6);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(h * .43, h, 7), mk(i % 3 ? 0x315c39 : 0x528047));
      crown.position.set(x, .65 + h / 2, z); crown.castShadow = true; m.add(crown);
    }
    for (let i = 0; i < 70; i++) {
      const x = (random() - .5) * 38, z = (random() - .5) * 32;
      if (Math.abs(x) < 11 && Math.abs(z) < 9) continue;
      const petal = new THREE.Mesh(new THREE.IcosahedronGeometry(.07, 0), mk(i % 3 ? 0xf3eac0 : 0xedb7a0)); petal.position.set(x, .2, z); m.add(petal);
    }
    // Lamps across the perimeter.
    for (const [x, z] of [[-9, -4], [-9, 8], [4, 8], [11, -7]]) {
      cyl(m, x, .1, z, .35, .45, .2, edge); box(m, x, 1.1, z, .08, 2.1, .08, hull); box(m, x, 2.2, z, .5, .1, .3, amber); box(m, x, 2.16, z, .4, .025, .25, orange);
    }
    groundLabel(m, '01 / THE MEADOW', -3, 10.7, 7, '#8b927b');
    // Distant landing road and hazard stripes.
    box(m, 0, .01, 17, 5, .02, 20, mk(0x9b9b71));
    for (let z = 10; z < 27; z += 1.8) box(m, 0, .03, z, .1, .015, .7, mk(0x91927b));
  }
  resize() { const w = this.container.clientWidth, h = this.container.clientHeight; if (!w || !h) return; this.renderer.setSize(w, h); this.aspect = w / h; this.updateCamera(); }
  updateCamera() { const h = 12.8 / this.zoom; this.camera.left = -h * this.aspect; this.camera.right = h * this.aspect; this.camera.top = h; this.camera.bottom = -h; this.camera.position.set(25 + this.pan.x, 29, 32 + this.pan.z); this.camera.lookAt(this.pan.x, 0, this.pan.z); this.camera.updateProjectionMatrix(); }
  setZoom(value) { this.zoom = THREE.MathUtils.clamp(value, .65, 2.2); this.updateCamera(); return this.zoom; }
  resetCamera() { this.pan.set(0, 0, 0); this.zoom = 1; this.updateCamera(); }
  focus(id) { const u = this.units.get(id); if (u) { this.pan.set(u.root.position.x * .5, 0, u.root.position.z * .5); this.updateCamera(); } }
  groundPoint(e) { const r = this.container.getBoundingClientRect(); this.pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); this.ray.setFromCamera(this.pointer, this.camera); return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()); }
  pick(e) {
    if (e.button !== 0) return; this.groundPoint(e);
    const objects = [...this.units.values()].map(u => u.hit);
    const hits = this.ray.intersectObjects(objects, false);
    if (hits.length) this.onSelect(hits[0].object.userData.id, e.shiftKey);
    else {
      // Generous screen-space hit regions for small units.
      let nearest, distance = 35; const r = this.container.getBoundingClientRect();
      for (const [id, u] of this.units) { const p = u.root.position.clone(); p.y += .8; p.project(this.camera); const d = Math.hypot((p.x + 1) / 2 * r.width - (e.clientX - r.left), (1 - p.y) / 2 * r.height - (e.clientY - r.top)); if (d < distance) { distance = d; nearest = id; } }
      if (nearest) this.onSelect(nearest, e.shiftKey);
    }
  }
  sync(sessions, selected) {
    this.state = sessions; this.selected = new Set(selected);
    const live = new Set(sessions.map(s => s.id));
    for (const [id, u] of this.units) if (!live.has(id)) {
      this.scene.remove(u.root);
      u.root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.type === 'Sprite') { o.material.map?.dispose(); o.material.dispose(); } });
      this.units.delete(id);
    }
    for (const s of sessions) {
      if (!this.units.has(s.id)) {
        const root = new THREE.Group(); this.scene.add(root);
        const robot = makeWorker(s.engine === 'simulator' ? 0x6c9a9b : 0xc89b50); root.add(robot);
        const selectRing = ring(root, .95, PALETTE.green, .04, .04);
        const hit = new THREE.Mesh(new THREE.SphereGeometry(.9), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = .8; hit.userData.id = s.id; root.add(hit);
        const [x, z] = SITES[s.slot]; root.position.set(x - .9 + Math.floor((s.number - 1) / 8) * 1.05, 0, z + .8 + Math.floor((s.number - 1) / 8) * .8);
        const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(s.name, '#f6ffe5', 30), depthTest: false, transparent: true })); tag.scale.set(2.8, .525, 1); tag.position.y = 2.15; root.add(tag);
        const spark = new THREE.Points(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 18 }, () => new THREE.Vector3())), new THREE.PointsMaterial({ color: 0xffd084, size: .06, transparent: true })); root.add(spark);
        this.units.set(s.id, { root, robot, selectRing, hit, tag, spark, name: s.name, moveTarget: null, phase: 0 });
      }
      const u = this.units.get(s.id); u.session = s; u.selectRing.visible = this.selected.has(s.id);
      if (u.name !== s.name) { u.tag.material.map.dispose(); u.tag.material.map = textTexture(s.name, '#f6ffe5', 30); u.name = s.name; }
    }
  }
  moveSelected(x, z) { let i = 0; for (const id of this.selected) { const u = this.units.get(id); if (u) u.moveTarget = new THREE.Vector3(THREE.MathUtils.clamp(x, -16, 16) + i++ * .8, 0, THREE.MathUtils.clamp(z, -11, 11)); } }
  ping(x, z) { if (this.pingMesh) this.scene.remove(this.pingMesh); const g = new THREE.Group(); g.position.set(x, .08, z); ring(g, .6, 0xaff589); this.scene.add(g); this.pingMesh = g; this.pingTime = performance.now(); }
  animate(now) {
    requestAnimationFrame(this.animate); if (this.enabled === false) { this.last = now; return; } const dt = Math.min((now - this.last) / 1000, .05); this.last = now; this.elapsed += dt;
    if (!this.reduced) this.radar.rotation.y += dt * .25;
    for (const u of this.units.values()) {
      const s = u.session; const busy = ['starting', 'working', 'stopping'].includes(s.status);
      const [x, z] = SITES[s.slot]; let target;
      if (u.moveTarget) target = u.moveTarget;
      else if (busy && !this.reduced && !this.paused) {
        u.phase += dt * .55;
        const phase = u.phase % 6;
        if (phase < 1.4) target = new THREE.Vector3(-2.8 + Math.cos(s.slot) * 3.7, 0, -.6 + Math.sin(s.slot) * 3.7);
        else target = new THREE.Vector3(x - .65, 0, z + .4);
      }
      if (target && !this.paused) {
        const v = target.clone().sub(u.root.position); const d = v.length();
        if (d > .08) { const step = Math.min(d, dt * 2.4); u.root.position.add(v.normalize().multiplyScalar(step)); u.robot.rotation.y = Math.atan2(v.x, v.z); u.robot.position.y = this.reduced ? 0 : Math.sin(now * .016) * .045; }
        else { u.robot.position.y = 0; if (u.moveTarget) u.moveTarget = null; }
      } else u.robot.position.y = 0;
      u.spark.visible = busy && !this.reduced && !this.paused && u.phase % 6 > 3;
      if (u.spark.visible) {
        const a = u.spark.geometry.attributes.position; for (let i = 0; i < a.count; i++) { const p = (this.elapsed * 2 + i * .21) % 1; a.setXYZ(i, .5 + p * Math.sin(i * 7) * .6, .7 + p * (1 - p) * 2, .7 + p * Math.cos(i * 9) * .7); } a.needsUpdate = true;
      }
      u.tag.material.opacity = this.selected.has(s.id) ? 1 : .68;
    }
    if (this.pingMesh) { const t = (now - this.pingTime) / 1000; this.pingMesh.scale.setScalar(1 + t * 2); if (t > 1) { this.scene.remove(this.pingMesh); this.pingMesh = null; } }
    this.renderer.render(this.scene, this.camera);
  }
  drawMinimap(canvas) {
    const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#101e19'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#243b2c'; ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const p = (x, z) => [w / 2 + x * 5, h / 2 + z * 4];
    ctx.fillStyle = '#527264'; ctx.fillRect(...p(-5, -3), 24, 21);
    ctx.fillStyle = '#286d87'; for (let i = 0; i < 7; i++) ctx.fillRect(...p(4 + i * .7, -12), 3, 4);
    for (const s of this.state) { const u = this.units.get(s.id); const [x, y] = p(u.root.position.x, u.root.position.z); ctx.fillStyle = this.selected.has(s.id) ? '#bcfa8c' : '#c3a46e'; ctx.fillRect(x - 2, y - 2, 5, 5); }
    ctx.strokeStyle = '#a1b7a0'; ctx.strokeRect(30 + this.pan.x * 3, 22 + this.pan.z * 2, w - 60, h - 44);
  }
}
