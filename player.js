/* ==========================================================
   player.js — walking and looking.
   - Desktop: W A S D / arrow keys, Shift to run, mouse to look.
   - Phone / tablet: arrow pad (hold to walk), RUN button,
     drag the right side of the screen to look.
   - Doors open automatically as you walk up to them.
   - Crosshair pointer, picture picker, render loop.
   ========================================================== */

const canvas = renderer.domElement;
const overlayEl = document.getElementById('overlay');
const pickLabel = document.getElementById('pick');
const fileInput = document.getElementById('file');
const btnRun = document.getElementById('btn-run');
const dotsBtn = document.getElementById('dots-btn');
const menuPanel = document.getElementById('menu-panel');
const menuGo = document.getElementById('menu-go');
const fsBtn = document.getElementById('fs-btn');
const rotateSkip = document.getElementById('rotate-skip');
const arrowBtns = document.querySelectorAll('.arrow');

const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
document.body.classList.toggle('touch', isTouch);

const SPEED_WALK = 5.5;
const SPEED_RUN = 10;
const WORLD_LIMIT = 140;

// start on the plaza, facing the door
camera.position.set(DOOR.x - 4, EYE, 34);
let yaw = 0, pitch = 0;

const keys = {};                                            // keyboard
const dpad = { up: false, down: false, left: false, right: false }; // arrow pad
let runHeld = false;                                        // RUN button
let playing = false;                                        // walking around (not on the menu)

function applyLook() {
  pitch = Math.max(-1.45, Math.min(1.45, pitch));
  camera.rotation.set(pitch, yaw, 0);
}

function setPlaying(on) {
  playing = on;
  document.body.classList.toggle('playing', on);
  overlayEl.style.display = on ? 'none' : 'flex';
  if (on && isTouch) onOrientation();   // phones: go full screen if already sideways
  if (!on) {
    for (const k in keys) keys[k] = false;
    for (const d in dpad) dpad[d] = false;
    arrowBtns.forEach(a => a.classList.remove('on'));
    runHeld = false;
    btnRun.classList.remove('on');
  }
}

/* ---------- start / pause ---------- */
overlayEl.addEventListener('click', () => {
  if (isTouch) setPlaying(true);
  else canvas.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  document.body.classList.toggle('locked', locked);
  setPlaying(locked);
});

/* ---------- full screen (phones and tablets go full screen by themselves) ---------- */
const landscapeQuery = matchMedia('(orientation: landscape)');
let fsPending = false;   // browser wants one tap before it allows full screen

function isFullscreen() {
  return !!document.fullscreenElement;
}

function enterFullscreen() {
  const el = document.documentElement;
  if (!el.requestFullscreen || isFullscreen()) return Promise.resolve();
  return el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
    // lock to sideways while in full screen (ignored where unsupported)
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  });
}

function exitFullscreen() {
  if (document.exitFullscreen && isFullscreen()) document.exitFullscreen().catch(() => {});
}

function toggleFullscreen() {
  if (isFullscreen()) exitFullscreen();
  else enterFullscreen().catch(() => {});
}

// when a phone is turned sideways while playing, go full screen
function onOrientation() {
  if (!isTouch || !playing || !landscapeQuery.matches || isFullscreen()) return;
  enterFullscreen().catch(() => { fsPending = true; });
}
landscapeQuery.addEventListener('change', onOrientation);
addEventListener('resize', onOrientation);

// if the browser refused, the next tap anywhere completes it
addEventListener('pointerdown', () => {
  if (fsPending && playing) {
    fsPending = false;
    enterFullscreen().catch(() => {});
  }
}, true);

document.addEventListener('fullscreenchange', () => {
  fsBtn.textContent = isFullscreen() ? 'Exit full screen' : 'Full screen';
  if (isFullscreen()) fsPending = false;
});

/* ---------- 3-dot menu (top right) ---------- */
dotsBtn.addEventListener('click', e => {
  e.stopPropagation();
  menuPanel.classList.toggle('hidden');
});

document.addEventListener('pointerdown', e => {
  if (!menuPanel.contains(e.target) && e.target !== dotsBtn) menuPanel.classList.add('hidden');
});

menuGo.addEventListener('click', e => {
  e.stopPropagation();
  menuPanel.classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  setPlaying(false);
});

fsBtn.addEventListener('click', e => {
  e.stopPropagation();
  menuPanel.classList.add('hidden');
  toggleFullscreen();
});

rotateSkip.addEventListener('click', e => {
  e.stopPropagation();
  document.body.classList.add('rotate-dismissed');
});

/* ---------- mouse look (desktop) ---------- */
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * 0.0022;
  pitch -= e.movementY * 0.0022;
  applyLook();
});

/* ---------- keyboard (desktop) ---------- */
addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup', e => { keys[e.code] = false; });

/* ---------- touch: drag the scene to look ---------- */
let look = null;
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch' || !playing) return;
  look = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
addEventListener('pointermove', e => {
  if (!look || e.pointerId !== look.id) return;
  yaw -= (e.clientX - look.x) * 0.006;
  pitch -= (e.clientY - look.y) * 0.006;
  look.x = e.clientX;
  look.y = e.clientY;
  applyLook();
});
const lookEnd = e => { if (look && e.pointerId === look.id) look = null; };
addEventListener('pointerup', lookEnd);
addEventListener('pointercancel', lookEnd);

/* ---------- touch: arrow pad (hold a side to walk that way) ---------- */
arrowBtns.forEach(btn => {
  const dir = btn.dataset.dir;
  const press = e => {
    e.preventDefault();
    dpad[dir] = true;
    btn.classList.add('on');
  };
  const release = () => {
    dpad[dir] = false;
    btn.classList.remove('on');
  };
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
});

/* ---------- touch: RUN button ---------- */
btnRun.addEventListener('pointerdown', e => {
  e.preventDefault();
  runHeld = true;
  btnRun.classList.add('on');
});
const runOff = () => { runHeld = false; btnRun.classList.remove('on'); };
btnRun.addEventListener('pointerup', runOff);
btnRun.addEventListener('pointercancel', runOff);
btnRun.addEventListener('pointerleave', runOff);

/* ---------- doors open by themselves when you walk up to them ---------- */
const FRONT_OPEN_DIST = 3.2;   // opens when closer than this
const FRONT_CLOSE_DIST = 4.5;  // closes again when farther than this (hysteresis)

function updateFrontDoor() {
  const p = camera.position;
  const d = Math.hypot(p.x - DOOR.x, p.z - 20);
  if (!doorState.open && d < FRONT_OPEN_DIST) doorState.open = true;
  else if (doorState.open && d > FRONT_CLOSE_DIST) doorState.open = false;
}

function updateDoor(dt) {
  for (const l of doorLeaves) {
    const target = doorState.open ? -l.side * 1.45 : 0;   // leaves swing inward
    l.pivot.rotation.y += (target - l.pivot.rotation.y) * Math.min(1, dt * 3.5);
  }
  doorCollider.active = !doorState.open;
}

/* ---------- walking ---------- */
function move(dt) {
  if (!playing) return;

  // keyboard and arrow pad both count as -1 / 0 / +1
  let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0)
        + (dpad.up ? 1 : 0) - (dpad.down ? 1 : 0);
  let r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0)
        + (dpad.right ? 1 : 0) - (dpad.left ? 1 : 0);
  f = THREE.MathUtils.clamp(f, -1, 1);
  r = THREE.MathUtils.clamp(r, -1, 1);
  if (!f && !r) return;

  // directions on the ground plane, based on where we're looking
  const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
  let mx = f * fwdX + r * rightX;
  let mz = f * fwdZ + r * rightZ;
  const len = Math.hypot(mx, mz) || 1;
  mx /= len; mz /= len;

  const running = keys.ShiftLeft || keys.ShiftRight || runHeld;
  const step = (running ? SPEED_RUN : SPEED_WALK) * dt;
  const p = camera.position;

  // move one axis at a time so you slide along walls instead of sticking
  const ox = p.x, oz = p.z;
  p.x += mx * step;
  if (blocked(p.x, p.z)) p.x = ox;
  p.z += mz * step;
  if (blocked(p.x, p.z)) p.z = oz;

  p.x = THREE.MathUtils.clamp(p.x, -WORLD_LIMIT, WORLD_LIMIT);
  p.z = THREE.MathUtils.clamp(p.z, -WORLD_LIMIT, WORLD_LIMIT);
  p.y = EYE;
}

/* ---------- picture picker (adds your own pictures) ---------- */
pickLabel.addEventListener('click', e => e.stopPropagation()); // don't start the game
fileInput.addEventListener('change', e => {
  const files = [...e.target.files];
  files.forEach((file, i) => {
    if (i >= slots.length) return;
    const url = URL.createObjectURL(file);
    if (file.type.startsWith('video/')) setVideo(slots[i], url);
    else setPicture(slots[i], url);
  });
  e.target.value = '';
});

/* ---------- screen size: phone, tablet, desktop ---------- */
function onResize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1 : 1.5));
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', onResize);
onResize();

/* ---------- main loop ---------- */
const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  move(dt);
  updateFrontDoor();
  updateDoor(dt);
  updateAutoDoors(dt);
  for (const s of spinners) s.rotation.y += dt * 0.5;
  updateAnimated(dt);
  syncMyPosition(performance.now());
  updateRemotes(dt);
  updateCallTV(performance.now());
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
