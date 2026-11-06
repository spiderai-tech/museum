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
// desktop: no pointer lock, so the real mouse cursor stays visible.
// Look around by holding the left mouse button and dragging.
overlayEl.addEventListener('click', () => setPlaying(true));

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
let mouseLook = false;   // true while the left mouse button is held down and dragged
document.addEventListener('mousedown', e => {
  if (isTouch || !playing || e.button !== 0) return;
  if (e.target.closest && e.target.closest('button, input, textarea, a, .chat-panel, .userbar, .frame-card, .call, .call-toast, .frames-btn, .dpad')) return;
  mouseLook = true;
});
document.addEventListener('mouseup', () => { mouseLook = false; });

document.addEventListener('mousemove', e => {
  if (!mouseLook && document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * 0.0022;
  pitch -= e.movementY * 0.0022;
  applyLook();
});

/* ---------- keyboard (desktop) ---------- */
addEventListener('keydown', e => {
  // typing in the chat or a name box must not walk the visitor around
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  keys[e.code] = true;
});
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
  if (!playing || chatOpen || uiOpen()) return;   // no walking while the chat or a frame panel is open

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
    shareUpload(slots[i], file);   // shared live with the same account (share.js)
  });
  e.target.value = '';
});

/* ---------- smart frames: walk up to a frame or screen to add, change or remove ---------- */
const frameCard = document.getElementById('frame-card');
const fcTitle = document.getElementById('fc-title');
const fcState = document.getElementById('fc-state');
const fcNew = document.getElementById('fc-new');
const fcChange = document.getElementById('fc-change');
const fcRemove = document.getElementById('fc-remove');
let focusSlot = null;      // the frame in front of the visitor right now
let cardSig = '';          // what the card currently shows
const _pos = new THREE.Vector3(), _nrm = new THREE.Vector3(), _fwd = new THREE.Vector3();

const STATE_TEXT = {
  empty: 'Empty. Add a picture or a video.',
  loading: 'Loading…',
  picture: 'Showing a picture.',
  video: 'Playing a video.',
  waiting: 'Waiting for the file. It comes from another visitor on your account who is online.'
};

function slotState(slot) {
  return slot.state || 'empty';
}

function slotRoom(slot) {
  slot.mesh.getWorldPosition(_pos);
  if (_pos.x > 15) return 'Side room';
  if (_pos.z < -20) return 'Media room';
  return 'Main hall';
}

// the frame the visitor is close to, looking at, and standing on the picture side of
function findFocusSlot() {
  const cam = camera.position;
  camera.getWorldDirection(_fwd);
  _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-6) return null;
  _fwd.normalize();
  let best = null, bestScore = -Infinity;
  for (const slot of slots) {
    slot.mesh.getWorldPosition(_pos);
    slot.mesh.getWorldDirection(_nrm);            // the side of the frame that shows the picture
    const dx = _pos.x - cam.x, dz = _pos.z - cam.z;
    const d = Math.hypot(dx, dz);
    if (d > 5.5 || d < 0.01) continue;
    const ahead = (dx * _fwd.x + dz * _fwd.z) / d;          // 1 = straight ahead
    const front = (-dx * _nrm.x - dz * _nrm.z) / d;          // > 0 = standing on the picture side
    if (front < 0.3 || ahead < 0.55) continue;
    const score = ahead * 2 - d * 0.15;
    if (score > bestScore) { bestScore = score; best = slot; }
  }
  return best;
}

// the nearest frame within reach, even if the visitor is not facing it
function findNearestSlot() {
  const cam = camera.position;
  let best = null, bestD = 6;
  for (const slot of slots) {
    slot.mesh.getWorldPosition(_pos);
    const d = Math.hypot(_pos.x - cam.x, _pos.z - cam.z);
    if (d < bestD) { bestD = d; best = slot; }
  }
  return best;
}

// the card only opens when asked (Frames button or F key), never by walking up
function updateFrameCard() {
  const show = frameOpen && playing && !chatOpen;
  if (!show) {
    frameCard.classList.add('hidden');
    focusSlot = null;
    cardSig = '';
    return;
  }
  const slot = findFocusSlot() || findNearestSlot();
  focusSlot = slot;
  if (!slot) {
    if (cardSig !== 'none') {
      cardSig = 'none';
      fcTitle.textContent = 'No frame nearby';
      fcState.textContent = 'Walk up to a frame or screen.';
      fcNew.classList.add('hidden');
      fcChange.classList.add('hidden');
      fcRemove.classList.add('hidden');
      frameCard.classList.remove('hidden');
    }
    return;
  }
  const st = slotState(slot);
  const sig = slot.idx + '|' + st;
  if (sig === cardSig) return;
  cardSig = sig;
  fcTitle.textContent = slotRoom(slot) + ' · frame ' + (slot.idx + 1);
  fcState.textContent = STATE_TEXT[st] || '';
  const showing = st === 'picture' || st === 'video' || st === 'loading';
  fcNew.classList.toggle('hidden', st !== 'empty');     // empty placeholder: New only
  fcChange.classList.toggle('hidden', !showing);        // a file on screen: Change
  fcRemove.classList.toggle('hidden', st === 'empty');  // file or waiting: Remove
  frameCard.classList.remove('hidden');
}

/* ---------- Frames button (top left) and F shortcut open or close the card ---------- */
const framesBtn = document.getElementById('frames-btn');
const fcClose = document.getElementById('fc-close');
let frameOpen = false;

function toggleFrames() {
  toggleFramesPanel();   // full-screen frames panel (ui-frames.js)
}

framesBtn.addEventListener('click', e => { e.stopPropagation(); toggleFrames(); });
fcClose.addEventListener('click', e => { e.stopPropagation(); frameOpen = false; cardSig = ''; frameCard.classList.add('hidden'); });

addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.code === 'KeyF' && !e.repeat && playing) toggleFrames();
});

// open the file picker for one frame: new picture or video, or a change
function pickFileFor(slot) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*,video/*';
  inp.addEventListener('change', () => {
    const f = inp.files && inp.files[0];
    if (f) shareUpload(slot, f);   // shared live with the same account (share.js)
  });
  inp.click();
}

fcNew.addEventListener('click', e => { e.stopPropagation(); if (focusSlot) pickFileFor(focusSlot); });
fcChange.addEventListener('click', e => { e.stopPropagation(); if (focusSlot) pickFileFor(focusSlot); });
fcRemove.addEventListener('click', e => { e.stopPropagation(); if (focusSlot) shareRemove(focusSlot); });

// keyboard: N = new, C = change, R = remove (when the card is showing)
addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (!focusSlot || frameCard.classList.contains('hidden')) return;
  const st = slotState(focusSlot);
  if (e.code === 'KeyN' && st === 'empty') pickFileFor(focusSlot);
  else if (e.code === 'KeyC' && st !== 'empty') pickFileFor(focusSlot);
  else if (e.code === 'KeyR' && st !== 'empty') shareRemove(focusSlot);
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
  updateFrameCard();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
