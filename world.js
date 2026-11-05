/* ==========================================================
   world.js — plaza, street, trees, the museum building with the
   front door in the MIDDLE, the main hall (a TV in the middle that shows live video calls),
   a gap in the hall's right wall that leads to a Side Room,
   and a Media Room behind the hall through the back arch.
   Plain script (no modules) so it works when opened from disk.
   ========================================================== */

/* ---------- settings ---------- */
const MY_PICTURES = [];                           // optional: paste image links here, in order
const ROOM = { h: 7 };                            // every room is 7 m high
const PW = 3, PH = 2.2;                           // painting size
const WALL_Y = 2.8;                               // painting centre height
const DOOR = { w: 3.2, h: 3.4, x: 0 };            // front door, middle of the front wall (z = +20)
const EYE = 1.6;                                  // eye height
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;  // phones and tablets: lighter settings

/* layout
   main hall:  x -20 … 20, z -20 … 20   (front door in the middle)
   side room:  x  20 … 34, z -10 … 10   (through a gap in the hall's RIGHT wall)
   media room: x -20 … 20, z -20 … -50  (through an arch in the hall's BACK wall) */
const GAP_Z = 0;                                  // centre of the gap in the right wall
const SIDE = { cx: 27, halfX: 7, halfZ: 10 };     // side room
const MEDIA_Z = -35;                              // media room centre z

/* ---------- seeded random (same scene every time) ---------- */
let seed = 20261106;
function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
function rr(a, b) { return a + (b - a) * rnd(); }

/* ---------- renderer, scene, camera ---------- */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 600);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------- helpers ---------- */
const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');

function makeTexture(draw, w = 512, h = 512, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

const mat = (color, roughness = 0.8, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

function sh(m, cast = true, recv = true) { m.castShadow = cast; m.receiveShadow = recv; return m; }
function put(mesh, x, y, z, parent = scene) { mesh.position.set(x, y, z); parent.add(mesh); return mesh; }

// plane whose texture repeats every `tile` metres
function tiledPlane(w, h, tile) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * h / tile);
  return g;
}

// horizontal plane (floor / ground)
function floorPlane(w, d, x, y, z, material, tile, shadowRecv = true) {
  const m = new THREE.Mesh(tiledPlane(w, d, tile), material);
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = shadowRecv;
  return put(m, x, y, z);
}

// horizontal ceiling plane (faces down)
function ceilingPlane(w, d, x, z, material) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  m.rotation.x = Math.PI / 2;
  return put(m, x, ROOM.h, z);
}

// walking obstacles
const colliders = [];
function addBox(x0, x1, z0, z1) {
  const c = { x0, x1, z0, z1, active: true };
  colliders.push(c);
  return c;
}
function collider(x, z, sx, sz) { return addBox(x - sx / 2, x + sx / 2, z - sz / 2, z + sz / 2); }
function blocked(x, z) {
  const m = 0.4; // player radius
  for (const c of colliders) {
    if (!c.active) continue;
    if (x > c.x0 - m && x < c.x1 + m && z > c.z0 - m && z < c.z1 + m) return true;
  }
  return false;
}

/* ---------- textures ---------- */
function drawMarble(g, w, h) {
  const n = 8, s = w / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    g.fillStyle = (i + j) % 2 ? '#e9e3d7' : '#cdc3ae';
    g.fillRect(i * s, j * s, s, s);
  }
  g.strokeStyle = 'rgba(110,100,85,0.18)';
  g.lineWidth = 2;
  for (let k = 0; k < 40; k++) {
    let x = rr(0, w), y = rr(0, h);
    g.beginPath(); g.moveTo(x, y);
    for (let m = 0; m < 6; m++) { x += rr(-70, 70); y += rr(-70, 70); g.lineTo(x, y); }
    g.stroke();
  }
}

function drawStone(g, w, h) {
  g.fillStyle = '#7f776a';
  g.fillRect(0, 0, w, h);
  const rows = 8, rh = h / rows;
  for (let r = 0; r < rows; r++) {
    let x = (r % 2) * -60;
    while (x < w) {
      const bw = rr(90, 150), b = rr(196, 222);
      g.fillStyle = `rgb(${b},${b - 8},${b - 22})`;
      g.fillRect(x + 2, r * rh + 2, bw - 4, rh - 4);
      for (let k = 0; k < 30; k++) {
        g.fillStyle = `rgba(90,80,60,${rr(0.05, 0.2)})`;
        g.fillRect(x + rr(0, bw), r * rh + rr(0, rh), rr(1, 3), rr(1, 3));
      }
      x += bw;
    }
  }
}

function drawGrass(g, w, h) {
  g.fillStyle = '#56803f';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `hsla(${rr(78, 115)},${rr(30, 50)}%,${rr(20, 42)}%,0.7)`;
    g.fillRect(rr(0, w), rr(0, h), rr(1, 3), rr(2, 5));
  }
}

function drawPavers(g, w, h) {
  const n = 8, s = w / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const b = rr(182, 200);
    g.fillStyle = `rgb(${b},${b - 6},${b - 14})`;
    g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
  }
}

function drawConcrete(g, w, h) {
  g.fillStyle = '#b9b4a9';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#9f9a8f';
  g.lineWidth = 3;
  for (let x = 0; x <= w; x += w / 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = 0; y <= h; y += h / 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  for (let k = 0; k < 2500; k++) {
    const v = rr(150, 200);
    g.fillStyle = `rgba(${v},${v},${v},0.4)`;
    g.fillRect(rr(0, w), rr(0, h), 2, 2);
  }
}

function drawAsphalt(g, w, h) {
  g.fillStyle = '#3a3c41';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 5000; i++) {
    const v = rr(40, 70);
    g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
    g.fillRect(rr(0, w), rr(0, h), 2, 2);
  }
  g.fillStyle = '#e9e4d0';
  g.fillRect(0, h * 0.04, w, 8);
  g.fillRect(0, h * 0.96 - 8, w, 8);
  g.fillStyle = '#e8c35a';
  for (let x = 0; x < w; x += 256) g.fillRect(x, h / 2 - 6, 128, 12);
}

function drawSign(g, w, h) {
  g.fillStyle = '#1d3a2c';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#c9a24a';
  g.lineWidth = 10;
  g.strokeRect(14, 14, w - 28, h - 28);
  g.fillStyle = '#e6c26e';
  g.font = 'bold 76px Georgia';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('MUSEUM OF FINE ART', w / 2, h / 2 + 4);
}

function drawRug(g, w, h) {
  g.fillStyle = '#6d1f22';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#c9a24a'; g.lineWidth = 18;
  g.strokeRect(30, 30, w - 60, h - 60);
  g.lineWidth = 6;
  g.strokeRect(70, 70, w - 140, h - 140);
  g.fillStyle = '#2b3f5c';
  g.beginPath(); g.ellipse(w / 2, h / 2, w * 0.2, h * 0.2, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#c9a24a'; g.lineWidth = 4; g.stroke();
}

/* ---------- sky, sun, fog, clouds, hills ---------- */
const sunDir = new THREE.Vector3(-0.55, 0.42, 0.72).normalize();
const skyMat = new THREE.ShaderMaterial({
  uniforms: {
    skyTop: { value: new THREE.Color(0x2f6fb8) },
    skyHorizon: { value: new THREE.Color(0xc9dcec) },
    sunDir: { value: sunDir },
    sunCol: { value: new THREE.Color(0xfff1d6) }
  },
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 skyTop; uniform vec3 skyHorizon; uniform vec3 sunDir; uniform vec3 sunCol;
    varying vec3 vDir;
    void main() {
      float h = clamp(vDir.y, 0.0, 1.0);
      vec3 col = mix(skyHorizon, skyTop, pow(h, 0.5));
      float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
      col += sunCol * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.35);
      gl_FragColor = vec4(col, 1.0);
    }`,
  side: THREE.BackSide,
  depthWrite: false
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), skyMat));
scene.fog = new THREE.Fog(0xc9dcec, 90, 330);

const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
sun.position.copy(sunDir).multiplyScalar(120);
sun.castShadow = true;
sun.shadow.mapSize.set(IS_TOUCH ? 512 : 1024, IS_TOUCH ? 512 : 1024);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 300 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x5a5a44, 0.6));

const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
for (let i = 0; i < 16; i++) {
  const g = new THREE.Group();
  for (let k = 0; k < 6; k++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(rr(10, 18), 16, 12), cloudMat);
    puff.position.set(rr(-22, 22), rr(-3, 3), rr(-12, 12));
    puff.scale.y = 0.45;
    g.add(puff);
  }
  g.position.set(rr(-300, 300), rr(85, 115), rr(-300, 300));
  scene.add(g);
}

const hillMat = new THREE.MeshStandardMaterial({ color: 0x587a5a, roughness: 1, flatShading: true });
for (let i = 0; i < 40; i++) {
  const a = (i / 40) * Math.PI * 2;
  const hill = new THREE.Mesh(new THREE.IcosahedronGeometry(rr(30, 60), 1), hillMat);
  hill.scale.y = 0.35;
  hill.position.set(Math.cos(a) * rr(250, 300), 0, Math.sin(a) * rr(250, 300));
  scene.add(hill);
}

/* ---------- ground, plaza, street ---------- */
const grassMat = new THREE.MeshStandardMaterial({ map: makeTexture(drawGrass, 512, 512), roughness: 1 });
floorPlane(900, 900, 0, 0, 0, grassMat, 8);

const plazaMat = new THREE.MeshStandardMaterial({ map: makeTexture(drawPavers, 512, 512), roughness: 0.8 });
floorPlane(60, 20, 0, 0.01, 30, plazaMat, 4);

const concreteMat = new THREE.MeshStandardMaterial({ map: makeTexture(drawConcrete, 256, 256), roughness: 0.9 });
floorPlane(300, 12, 0, 0.01, 46, concreteMat, 4);

const asphaltMat = new THREE.MeshStandardMaterial({ map: makeTexture(drawAsphalt, 512, 512), roughness: 0.85 });
floorPlane(300, 16, 0, 0.012, 60, asphaltMat, 16);

/* ---------- small props ---------- */
const metalMat = mat(0x4a4d52, 0.4, { metalness: 0.8 });
const barkMat = mat(0x5b4331, 0.95);
const bushMat = new THREE.MeshStandardMaterial({ color: 0x3a6b2e, roughness: 0.9, flatShading: true });
const leafMats = [0x3f7d3a, 0x4f8c3e, 0x33692f, 0x5e9a46].map(c =>
  new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }));
const lampGlass = new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffd48a, emissiveIntensity: 1.3 });

function lamp(x, z) {
  sh(put(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.8, 12), metalMat), x, 2.4, z));
  put(new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), lampGlass), x, 4.95, z);
  collider(x, z, 0.4, 0.4);
}

function tree(x, z, s = 1) {
  const g = new THREE.Group();
  g.add(sh(put(new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.28 * s, 3.2 * s, 10), barkMat), 0, 1.6 * s, 0)));
  for (let i = 0; i < 4; i++) {
    const crown = sh(new THREE.Mesh(
      new THREE.IcosahedronGeometry(rr(1.2, 1.7) * s, 1),
      leafMats[(rnd() * leafMats.length) | 0]));
    crown.position.set(rr(-0.7, 0.7) * s, rr(3.2, 4.6) * s, rr(-0.7, 0.7) * s);
    g.add(crown);
  }
  put(g, x, 0, z);
  collider(x, z, 1.0, 1.0);
}

function bush(x, z, s = 1) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const b = sh(new THREE.Mesh(new THREE.IcosahedronGeometry(rr(0.5, 0.75) * s, 1), bushMat));
    b.position.set(rr(-0.5, 0.5) * s, rr(0.4, 0.7) * s, rr(-0.4, 0.4) * s);
    g.add(b);
  }
  return put(g, x, 0, z);
}

function bench(x, z, rot) {
  const g = new THREE.Group();
  const wood = mat(0x6b4b2e, 0.7);
  const seat = sh(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 0.5), wood)); seat.position.y = 0.45;
  const back = sh(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 0.08), wood)); back.position.set(0, 0.75, -0.21);
  g.add(seat, back);
  for (const lx of [-0.85, 0.85]) {
    const leg = sh(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.5), metalMat));
    leg.position.set(lx, 0.225, 0);
    g.add(leg);
  }
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  scene.add(g);
  if (rot === 0 || rot === Math.PI) collider(x, z, 2.0, 0.6); else collider(x, z, 0.6, 2.0);
}

function car(x, z, color, rot) {
  const g = new THREE.Group();
  const paint = mat(color, 0.35, { metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.1, metalness: 0.6 });
  const body = sh(new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.9, 1.9), paint)); body.position.y = 0.65;
  const cabin = sh(new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.75, 1.7), glass)); cabin.position.set(-0.2, 1.35, 0);
  g.add(body, cabin);
  for (const wx of [-1.3, 1.3]) for (const wz of [-0.95, 0.95]) {
    const wheel = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 16), mat(0x111111, 0.9)));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.35, wz);
    g.add(wheel);
  }
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  scene.add(g);
  if (rot === 0 || rot === Math.PI) collider(x, z, 4.4, 2.0); else collider(x, z, 2.0, 4.4);
}

for (let x = -56; x <= 56; x += 14) lamp(x, 47);

car(-38, 57.5, 0x8b1e24, 0);
car(-6, 62.5, 0x2c4f7a, Math.PI);
car(26, 57.5, 0xcfcfc9, 0);
car(58, 62.5, 0x3d3d3d, Math.PI);

bench(-9, 34, 0);
bench(9, 34, 0);
for (const x of [-12, 12]) {
  sh(put(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.7, 24), mat(0xd9d2c3, 0.9)), x, 0.35, 26));
  bush(x, 26, 1.4);
  collider(x, 26, 1.8, 1.8);
}

// bushes beside the entrance steps
bush(-6, 22.5, 1.2);
bush(6, 22.5, 1.2);

tree(-27, 27, 1.2); tree(27, 27, 1.1); tree(-34, 43, 1.3); tree(34, 43, 1.3);
{
  let placed = 0, tries = 0;
  while (placed < 50 && tries < 2000) {
    tries++;
    const x = rr(-150, 150), z = rr(-150, 150);
    const nearBuilding = Math.abs(x) < 50 && z > -50 && z < 80;
    const nearStreet = z > 36 && z < 72;
    if (nearBuilding || nearStreet) continue;
    tree(x, z, rr(0.9, 1.4));
    placed++;
  }
}

/* ---------- building materials ---------- */
const plasterMat = mat(0xe7e0d2, 0.95);
const stoneMat = new THREE.MeshStandardMaterial({ map: makeTexture(drawStone, 512, 512), roughness: 0.9 });
const trimMat = mat(0xefe9dc, 0.6);
const glassMat = new THREE.MeshStandardMaterial({
  color: 0x2a3d4f, roughness: 0.08, metalness: 0.6, emissive: 0x3a2a12, emissiveIntensity: 0.25
});

// each wall: centre C, along-wall direction T, inward normal N, half-length len
// door: true = an opening centred at doorU along the wall
const WALLS = {
  front: { C: { x: 0, z: 20 },  T: { x: 1, z: 0 }, N: { x: 0, z: -1 }, door: true,  doorU: DOOR.x, len: 20 },
  back:  { C: { x: 0, z: -20 }, T: { x: 1, z: 0 }, N: { x: 0, z: 1 },  door: true,  doorU: 0,       len: 20 },  // arch to Media Room
  left:  { C: { x: -20, z: 0 }, T: { x: 0, z: 1 }, N: { x: 1, z: 0 },  door: false, len: 20 },
  right: { C: { x: 20, z: 0 },  T: { x: 0, z: 1 }, N: { x: -1, z: 0 }, door: true,  doorU: GAP_Z, len: 20 }  // gap to Side Room
};

function wallPlace(mesh, W, u, y, off, outward) {
  const n = outward ? { x: -W.N.x, z: -W.N.z } : W.N;
  mesh.position.set(W.C.x + W.T.x * u + n.x * off, y, W.C.z + W.T.z * u + n.z * off);
  mesh.rotation.y = Math.atan2(n.x, n.z);
  scene.add(mesh);
  return mesh;
}

// builds the plaster inside face, the stone outside face, and collisions for one wall
function buildWall(W) {
  const L = W.len || 20;
  const dx = W.doorU || 0;
  const segs = W.door
    ? [[-L, dx - DOOR.w / 2, 0, ROOM.h], [dx + DOOR.w / 2, L, 0, ROOM.h], [dx - DOOR.w / 2, dx + DOOR.w / 2, DOOR.h, ROOM.h]]
    : [[-L, L, 0, ROOM.h]];

  for (const [u0, u1, y0, y1] of segs) {
    const w = u1 - u0, h = y1 - y0, uc = (u0 + u1) / 2, yc = (y0 + y1) / 2;
    wallPlace(sh(new THREE.Mesh(new THREE.PlaneGeometry(w, h), plasterMat)), W, uc, yc, 0, false);
    wallPlace(sh(new THREE.Mesh(tiledPlane(w, h, 3), stoneMat)), W, uc, yc, 0.15, true);
    if (y0 === 0) {
      if (W.T.x) addBox(W.C.x + u0, W.C.x + u1, W.C.z - 0.25, W.C.z + 0.25);
      else addBox(W.C.x - 0.25, W.C.x + 0.25, W.C.z + u0, W.C.z + u1);
    }
  }
}

// a wall with plaster on BOTH sides (for the side room's dividers, if needed)
function solidWall(cx, cz, halfLen, alongX) {
  const sx = alongX ? halfLen * 2 : 0.1, sz = alongX ? 0.1 : halfLen * 2;
  const p = sh(new THREE.Mesh(new THREE.PlaneGeometry(alongX ? halfLen * 2 : halfLen * 2, ROOM.h), plasterMat));
  put(p, cx, ROOM.h / 2, cz, scene);
  addBox(cx - sx / 2 - (alongX ? 0 : 0), cx + sx / 2, cz - sz / 2, cz + sz / 2);
}

/* ---------- main hall + media room + side room shells ---------- */
for (const W of Object.values(WALLS)) buildWall(W);

// Media room walls (behind the hall)
const mediaWalls = {
  left:  { C: { x: -20, z: MEDIA_Z }, T: { x: 0, z: 1 }, N: { x: 1, z: 0 },  door: false, len: 15 },
  right: { C: { x: 20,  z: MEDIA_Z }, T: { x: 0, z: 1 }, N: { x: -1, z: 0 }, door: false, len: 15 },
  far:   { C: { x: 0,   z: -50 },     T: { x: 1, z: 0 }, N: { x: 0, z: 1 },  door: false, len: 20 }
};
for (const W of Object.values(mediaWalls)) buildWall(W);

// Side room walls (through the gap in the hall's right wall)
const sideWalls = {
  north: { C: { x: SIDE.cx, z: SIDE.halfZ },  T: { x: 1, z: 0 }, N: { x: 0, z: -1 }, door: false, len: SIDE.halfX },
  south: { C: { x: SIDE.cx, z: -SIDE.halfZ }, T: { x: 1, z: 0 }, N: { x: 0, z: 1 },  door: false, len: SIDE.halfX },
  east:  { C: { x: SIDE.cx + SIDE.halfX, z: 0 }, T: { x: 0, z: 1 }, N: { x: -1, z: 0 }, door: false, len: SIDE.halfZ }
};
for (const W of Object.values(sideWalls)) buildWall(W);

/* ---------- the front door ---------- */
const doorState = { open: false };
const doorCollider = addBox(DOOR.x - DOOR.w / 2, DOOR.x + DOOR.w / 2, 19.75, 20.25);

// exterior windows (decorative) on the front and left faces only
function windowOn(W, u, y) {
  wallPlace(sh(new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.5), trimMat), false), W, u, y, 0.16, true);
  wallPlace(new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.1), glassMat), W, u, y, 0.18, true);
}
[-16, -10, 10, 16].forEach(u => windowOn(WALLS.front, u, 3.5));
[-12, -4, 4, 12].forEach(u => windowOn(WALLS.left, u, 3.5));

// roof over hall + media room, and over the side room
sh(put(new THREE.Mesh(new THREE.BoxGeometry(40.6, 0.5, 70.6), mat(0x6c655b, 0.9)), 0, 7.3, -15));
sh(put(new THREE.Mesh(new THREE.BoxGeometry(SIDE.halfX * 2 + 0.6, 0.5, SIDE.halfZ * 2 + 0.6), mat(0x6c655b, 0.9)),
  SIDE.cx + 0.3, 7.3, 0));

// sign and portico over the front door
const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.0),
  new THREE.MeshStandardMaterial({ map: makeTexture(drawSign, 1024, 160), roughness: 0.6 }));
wallPlace(signMesh, WALLS.front, DOOR.x, 5.3, 0.17, true);

const columnMat = mat(0xf3efe6, 0.35);
for (const dx of [-3.6, 3.6]) {
  const x = DOOR.x + dx;
  sh(put(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 4.3, 24), columnMat), x, 2.15, 22.4));
  put(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.9), columnMat), x, 0.125, 22.4);
  collider(x, 22.4, 0.8, 0.8);
}
sh(put(new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.35, 4.2), columnMat), DOOR.x, 4.5, 22.1));
sh(put(new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.12, 2.6), mat(0xcfc7b6, 0.8)), DOOR.x, 0.06, 21.4));

// two glass leaves that swing inward
const bronzeMat = mat(0x5a4a32, 0.4, { metalness: 0.6 });
const doorGlass = new THREE.MeshStandardMaterial({
  color: 0xbfd9e8, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide
});
const doorLeaves = [];
for (const side of [-1, 1]) {
  const pivot = new THREE.Group();
  pivot.position.set(DOOR.x + side * DOOR.w / 2, 0, 20);
  const leaf = new THREE.Group();
  leaf.position.x = -side * DOOR.w / 4;
  const lw = DOOR.w / 2, lh = DOOR.h;

  const rails = [
    [0, lh - 0.05, lw, 0.1], [0, 0.05, lw, 0.1],
    [-lw / 2 + 0.05, lh / 2, 0.1, lh], [lw / 2 - 0.05, lh / 2, 0.1, lh]
  ];
  for (const [x, y, w, h] of rails) {
    const rail = sh(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), bronzeMat));
    rail.position.set(x, y, 0);
    leaf.add(rail);
  }
  const handle = sh(new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 0.08), bronzeMat));
  handle.position.set(-side * 0.6, lh / 2, 0.08);
  leaf.add(handle);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(lw - 0.2, lh - 0.2), doorGlass);
  glass.position.set(0, lh / 2, 0);
  leaf.add(glass);

  pivot.add(leaf);
  scene.add(pivot);
  doorLeaves.push({ pivot, side });
}

/* ---------- auto-opening sliding doors (Side Room and Media Room) ---------- */
const autoDoors = [];
const DOOR_TRIGGER = 2.8;   // how close you must be for the door to slide open

function autoDoor(W, u) {
  const cx = W.C.x + W.T.x * u, cz = W.C.z + W.T.z * u;
  const root = new THREE.Group();
  root.position.set(cx, 0, cz);
  root.rotation.y = Math.atan2(-W.T.z, W.T.x);   // local x runs along the wall
  scene.add(root);

  const panels = [];
  for (const side of [-1, 1]) {
    const p = new THREE.Group();
    const lw = DOOR.w / 2, lh = DOOR.h;
    const rails = [
      [0, lh - 0.05, lw, 0.1], [0, 0.05, lw, 0.1],
      [-lw / 2 + 0.05, lh / 2, 0.1, lh], [lw / 2 - 0.05, lh / 2, 0.1, lh]
    ];
    for (const [x, y, w, h] of rails) {
      const rail = sh(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), bronzeMat));
      rail.position.set(x, y, 0);
      p.add(rail);
    }
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(lw - 0.2, lh - 0.2), doorGlass);
    glass.position.set(0, lh / 2, 0);
    p.add(glass);
    root.add(p);
    panels.push({ obj: p, side });
  }

  const col = W.T.x
    ? addBox(cx - DOOR.w / 2, cx + DOOR.w / 2, cz - 0.25, cz + 0.25)
    : addBox(cx - 0.25, cx + 0.25, cz - DOOR.w / 2, cz + DOOR.w / 2);
  const door = { cx, cz, t: 0, panels, col };
  autoDoors.push(door);
  return door;
}

// slide the panels open when the player is near, closed when away
function updateAutoDoors(dt) {
  const px = camera.position.x, pz = camera.position.z;
  for (const d of autoDoors) {
    const near = Math.hypot(px - d.cx, pz - d.cz) < DOOR_TRIGGER;
    d.t += ((near ? 1 : 0) - d.t) * Math.min(1, dt * 4);
    for (const p of d.panels) p.obj.position.x = p.side * (DOOR.w / 4 + d.t * DOOR.w / 2);
    d.col.active = d.t < 0.9;   // solid until it has (almost) fully slid open
  }
}

autoDoor(WALLS.right, GAP_Z);   // door into the Side Room
autoDoor(WALLS.back, 0);        // door into the Media Room

/* ---------- interior lights and materials ---------- */
const floorMat = new THREE.MeshStandardMaterial({ map: makeTexture(drawMarble, 1024, 1024), roughness: 0.25, metalness: 0.05 });
const panelMat = new THREE.MeshBasicMaterial({ color: 0xfff8ec });
const ceilingMat = mat(0xf4f1ea, 0.95);
const columnInsideMat = columnMat;

scene.add(new THREE.AmbientLight(0xffffff, 0.15));

/* ---------- MAIN HALL (x -20…20, z -20…20) ---------- */
floorPlane(40, 40, 0, 0.02, 0, floorMat, 40);
ceilingPlane(40, 40, 0, 0, ceilingMat);
for (const x of [-10, 10]) for (const z of [-10, 10]) {
  const p = new THREE.PointLight(0xfff1dc, 1.6, 22, 2);
  p.position.set(x, ROOM.h - 1.2, z);
  scene.add(p);
}
for (const x of [-15, -5, 5, 15]) for (const z of [-15, -5, 5, 15]) {
  put(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 1.6), panelMat), x, ROOM.h - 0.03, z);
}

// interior columns (kept away from the side-room gap)
for (const x of [-17, 17]) for (const z of [-10, 10]) {
  sh(put(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, ROOM.h, 28), columnInsideMat), x, ROOM.h / 2, z));
  collider(x, z, 0.9, 0.9);
}

// plants in the hall corners
const potMat = mat(0xb5683a, 0.7);
function plant(x, z, s = 1) {
  const g = new THREE.Group();
  g.add(sh(put(new THREE.Mesh(new THREE.CylinderGeometry(0.45 * s, 0.35 * s, 0.8 * s, 24), potMat), 0, 0.4 * s, 0)));
  g.add(sh(put(new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 * s, 1), leafMats[0]), 0, 1.5 * s, 0)));
  put(g, x, 0, z);
  collider(x, z, 1.2, 1.2);
}
plant(-18, -18); plant(18, -18); plant(-18, 18); plant(18, 18);

// sculptures on pedestals
const bronze = mat(0x8c6a3c, 0.35, { metalness: 0.7 });
const marbleMat = mat(0xf2eee6, 0.35);
const spinners = [];
const sculptures = [
  { pos: [-9, -9], geo: new THREE.TorusKnotGeometry(0.4, 0.13, 160, 24), spin: true },
  { pos: [ 9, -9], geo: new THREE.SphereGeometry(0.55, 48, 32) },
  { pos: [-9,  9], geo: new THREE.IcosahedronGeometry(0.6, 1) },
  { pos: [ 9,  9], geo: new THREE.DodecahedronGeometry(0.6), spin: true }
];
for (const s of sculptures) {
  const [x, z] = s.pos;
  sh(put(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 1.0, 40), marbleMat), x, 0.5, z));
  const piece = sh(put(new THREE.Mesh(s.geo, bronze), x, 1.7, z));
  if (s.spin) spinners.push(piece);
  collider(x, z, 1.0, 1.0);
}

// sofas, coffee table and rug
function makeSofa() {
  const g = new THREE.Group();
  const fabric = mat(0x5b6b5a, 0.9);
  const wood = mat(0x4a3322, 0.5);
  const base = sh(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.4, 1.0), fabric)); base.position.y = 0.5;
  const back = sh(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 0.2), fabric)); back.position.set(0, 0.9, -0.4);
  const armL = sh(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.35, 1.0), fabric)); armL.position.set(-1.1, 0.8, 0);
  const armR = armL.clone(); armR.position.x = 1.1;
  const seatL = sh(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, 0.75), fabric)); seatL.position.set(-0.55, 0.8, 0.1);
  const seatR = seatL.clone(); seatR.position.x = 0.55;
  g.add(base, back, armL, armR, seatL, seatR);
  for (const [x, z] of [[-1.05, 0.4], [1.05, 0.4], [-1.05, -0.4], [1.05, -0.4]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.3, 8), wood);
    leg.position.set(x, 0.15, z);
    g.add(leg);
  }
  return g;
}
function placeSofa(x, z, rotY) {
  const s = makeSofa();
  s.position.set(x, 0, z);
  s.rotation.y = rotY;
  scene.add(s);
  collider(x, z, rotY === 0 || rotY === Math.PI ? 2.6 : 1.2, rotY === 0 || rotY === Math.PI ? 1.2 : 2.6);
}
// the two sofas face each other across the coffee table, turned sideways
placeSofa(3.6, 2.25, -Math.PI / 2);   // this one faces LEFT
placeSofa(-3.6, 2.25, Math.PI / 2);   // this one faces RIGHT

(function coffeeTable(x, z) {
  const g = new THREE.Group();
  const wood = mat(0x3a2716, 0.4);
  const top = sh(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.9), wood)); top.position.y = 0.45;
  g.add(top);
  for (const [lx, lz] of [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.06), wood);
    leg.position.set(lx, 0.21, lz);
    g.add(leg);
  }
  const vase = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.3, 24), bronze));
  vase.position.set(0.3, 0.63, 0.1);
  g.add(vase);
  g.position.set(x, 0, z);
  scene.add(g);
  collider(x, z, 1.6, 0.9);
})(0, 2.25);

const rug = new THREE.Mesh(
  tiledPlane(10, 11, 11),
  new THREE.MeshStandardMaterial({ map: makeTexture(drawRug, 1024, 1126), roughness: 0.9 })
);
rug.rotation.x = -Math.PI / 2;
put(rug, 0, 0.03, 0);

/* ---------- the TV in the middle of the main hall ----------
   Its screen faces the same way as the main (front) door: towards the entrance,
   so people coming in through the front door see it straight ahead.
   webrtc.js draws the live video onto hallTV.canvas every frame. */
const hallTV = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = IS_TOUCH ? 640 : 1280; canvas.height = IS_TOUCH ? 360 : 720;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#06070a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE.sRGBEncoding;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return { canvas, ctx, tex };
})();

(function buildHallTV() {
  const W = 4.4, H = 2.475, Y = 2.1;     // screen size, and height of its centre
  const STEP = 0.75;                      // one step, in metres
  const TV_Z = -3 * STEP;                 // three steps back from the middle, on the red carpet
  const body = sh(new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, H + 0.2, 0.12), mat(0x17181c, 0.4, { metalness: 0.3 })));
  body.position.set(0, Y, TV_Z - 0.02);
  scene.add(body);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: hallTV.tex }));
  screen.position.set(0, Y, TV_Z + 0.05); // faces +z, towards the front door
  scene.add(screen);
  const stand = sh(new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.7, 0.9), mat(0x3a2716, 0.5)));
  stand.position.set(0, 0.35, TV_Z);
  scene.add(stand);
  collider(0, TV_Z, 4.6, 0.9);
})();

/* ---------- frames ---------- */
const frameMat = mat(0x4a321c, 0.45);
const slots = [];      // every frame, in fill order: hall, side room, media room

function addFrame(x, y, z, rotY, w, h, kind = 'image') {
  const g = new THREE.Group();
  const frame = sh(new THREE.Mesh(new THREE.BoxGeometry(w + 0.22, h + 0.22, 0.08), frameMat));
  const canvasMat = new THREE.MeshBasicMaterial({ color: 0x999999 });
  const canvas = new THREE.Mesh(new THREE.PlaneGeometry(w, h), canvasMat);
  canvas.position.z = 0.045;
  g.add(frame, canvas);
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  scene.add(g);
  const slot = { mesh: canvas, mat: canvasMat, idx: slots.length, w, h, kind, anim: null, video: null };
  slots.push(slot);
  return slot;
}
const addPainting = (x, y, z, rotY) => addFrame(x, y, z, rotY, PW, PH, 'image');

// hall: back wall (4, arch in the middle), front wall (4, door in the middle),
// left wall (4 frames + a VIDEO SCREEN in the middle), right wall (4, gap in the middle)
[-12, -4, 4, 12].forEach(x => addPainting(x, WALL_Y, -19.9, 0));
[-12, -4, 4, 12].forEach(x => addPainting(x, WALL_Y,  19.9, Math.PI));
[-14, -7, 7, 14].forEach(z => addPainting(-19.9, WALL_Y, z, Math.PI / 2));
[-14, -7, 7, 14].forEach(z => addPainting( 19.9, WALL_Y, z, -Math.PI / 2));
addPainting(-19.9, WALL_Y, 0, Math.PI / 2);                // photo in the middle of the left wall

/* ---------- SIDE ROOM (through the gap in the hall's right wall) ---------- */
floorPlane(SIDE.halfX * 2, SIDE.halfZ * 2, SIDE.cx, 0.02, 0, floorMat, 14);
ceilingPlane(SIDE.halfX * 2, SIDE.halfZ * 2, SIDE.cx, 0, ceilingMat);
for (const x of [SIDE.cx - 4, SIDE.cx + 4]) {
  const p = new THREE.PointLight(0xfff1dc, 1.5, 18, 2);
  p.position.set(x, ROOM.h - 1.2, 0);
  scene.add(p);
}
for (const x of [SIDE.cx - 4, SIDE.cx + 4]) {
  put(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 1.6), panelMat), x, ROOM.h - 0.03, 0);
}
addFrame(23, WALL_Y,  SIDE.halfZ - 0.1, Math.PI, PW, PH, 'image');     // north wall
addFrame(31, WALL_Y,  SIDE.halfZ - 0.1, Math.PI, PW, PH, 'image');
addFrame(23, WALL_Y, -SIDE.halfZ + 0.1, 0, PW, PH, 'image');           // south wall
addFrame(31, WALL_Y, -SIDE.halfZ + 0.1, 0, PW, PH, 'image');
addFrame(SIDE.cx + SIDE.halfX - 0.1, 3.0, 0, -Math.PI / 2, 6, 3.4, 'screen'); // east wall screen
placeSofa(26, 0, Math.PI / 2);                                          // sofa facing the screen

/* ---------- MEDIA ROOM (behind the hall, through the back arch) ---------- */
const mediaFloor = new THREE.MeshStandardMaterial({ map: makeTexture(drawMarble, 1024, 1024), roughness: 0.3, metalness: 0.05 });
floorPlane(40, 30, 0, 0.02, MEDIA_Z, mediaFloor, 40);
ceilingPlane(40, 30, 0, MEDIA_Z, ceilingMat);
for (const x of [-10, 10]) for (const z of [-28, -42]) {
  const p = new THREE.PointLight(0xfff1dc, 1.6, 22, 2);
  p.position.set(x, ROOM.h - 1.2, z);
  scene.add(p);
}
for (const x of [-10, 0, 10]) for (const z of [-26, -44]) {
  put(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 1.6), panelMat), x, ROOM.h - 0.03, z);
}
for (const z of [-26, -33, -40, -47]) {
  addFrame(-19.9, WALL_Y, z,  Math.PI / 2, PW, PH, 'image');
  addFrame( 19.9, WALL_Y, z, -Math.PI / 2, PW, PH, 'image');
}
addFrame(-8, 3.0, -49.9, 0, 6, 3.4, 'screen');
addFrame( 8, 3.0, -49.9, 0, 6, 3.4, 'screen');
placeSofa(0, -30, Math.PI);
placeSofa(0, -42, Math.PI);

/* ---------- pictures and videos ---------- */
function placeholder(n) {
  return makeTexture((g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#c8b79a');
    gr.addColorStop(1, '#5f4c38');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.textAlign = 'center';
    g.font = 'bold 56px Georgia';
    g.fillText('Picture ' + n, w / 2, h / 2);
    g.font = '28px Georgia';
    g.fillText('replace with your own', w / 2, h / 2 + 50);
  });
}

const animatedSlots = [];

function stopMedia(slot) {
  const i = animatedSlots.indexOf(slot);
  if (i >= 0) animatedSlots.splice(i, 1);
  slot.anim = null;
  if (slot.video) { slot.video.pause(); slot.video = null; }
}

// keep the picture's proportions inside its frame
function fitSlot(slot, ar) {
  const fit = ar > slot.w / slot.h ? [1, (slot.w / ar) / slot.h, 1] : [(slot.h * ar) / slot.w, 1, 1];
  slot.mesh.scale.set(...fit);
}

function setPicture(slot, url) {
  stopMedia(slot);
  loader.load(url, tex => {
    tex.encoding = THREE.sRGBEncoding;
    fitSlot(slot, tex.image.width / tex.image.height);
    slot.mat.map = tex;
    slot.mat.color.set(0xffffff);
    slot.mat.needsUpdate = true;
  }, undefined, () => {
    slot.mesh.scale.set(1, 1, 1);
    if (slot.kind === 'screen') { startAnim(slot); return; }
    slot.mat.map = placeholder(slot.idx + 1);
    slot.mat.color.set(0xffffff);
    slot.mat.needsUpdate = true;
  });
}

// a real video file plays here, muted and looping
function setVideo(slot, url) {
  stopMedia(slot);
  const v = document.createElement('video');
  v.src = url;
  v.loop = true;
  v.muted = true;        // muted so autoplay is allowed
  v.playsInline = true;
  v.autoplay = true;
  v.addEventListener('loadedmetadata', () => fitSlot(slot, v.videoWidth / v.videoHeight));
  v.play().catch(() => {});
  slot.video = v;
  const tex = new THREE.VideoTexture(v);
  tex.encoding = THREE.sRGBEncoding;
  slot.mat.map = tex;
  slot.mat.color.set(0xffffff);
  slot.mat.needsUpdate = true;
}

// an animated stand-in screen until you add a real video or picture
function startAnim(slot) {
  stopMedia(slot);
  const c = document.createElement('canvas');
  c.width = 512; c.height = 288;
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  slot.mat.map = tex;
  slot.mat.color.set(0xffffff);
  slot.mat.needsUpdate = true;
  fitSlot(slot, 16 / 9);
  slot.anim = { g: c.getContext('2d'), tex, t: 0 };
  animatedSlots.push(slot);
}

let animAcc = 0;
const ANIM_STEP = IS_TOUCH ? 1 / 12 : 1 / 30;   // animated screens redraw this often
function updateAnimated(dt) {
  animAcc += dt;
  if (animAcc < ANIM_STEP) return;
  const step = animAcc;
  animAcc = 0;
  const w = 512, h = 288;
  for (const slot of animatedSlots) {
    const a = slot.anim, g = a.g;
    a.t += step;
    const hue = (a.t * 25) % 360;
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, `hsl(${hue},55%,30%)`);
    grd.addColorStop(1, `hsl(${(hue + 80) % 360},55%,15%)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.arc(w / 2 + Math.cos(a.t * 1.3) * 160, h / 2 + Math.sin(a.t * 1.7) * 60, 42, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.textAlign = 'center';
    g.font = 'bold 30px Georgia';
    g.fillText('VIDEO SCREEN', w / 2, h / 2 - 10);
    g.font = '20px Georgia';
    g.fillText('press Esc, then add a video to play it here', w / 2, h / 2 + 26);
    a.tex.needsUpdate = true;
  }
}

// start: screens animate, picture frames load pictures
slots.forEach((slot, i) => {
  if (slot.kind === 'screen') startAnim(slot);
  else setPicture(slot, MY_PICTURES[i] || `https://picsum.photos/seed/museumhall${i + 1}/900/660`);
});
