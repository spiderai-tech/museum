/* ==========================================================
   ui-frames.js — frames panel, frame viewer, click-to-open.
   - Frames button (or F): full-screen grid of every frame, with a close button.
     Tap an empty tile to add a picture or video; tap a filled tile to view it.
   - Click (or tap) a frame in the museum: opens it full screen with
     Change and Remove. An empty frame opens the upload picker directly.
   Plain script (no modules).
   ========================================================== */

const fpEl = document.getElementById('frames-panel');
const fpGrid = document.getElementById('fp-grid');
const fpCount = document.getElementById('fp-count');
const fpCloseBtn = document.getElementById('fp-close');
const vwEl = document.getElementById('viewer');
const vwStage = document.getElementById('vw-stage');
const vwTitle = document.getElementById('vw-title');
const vwCloseBtn = document.getElementById('vw-close');
const vwChange = document.getElementById('vw-change');
const vwRemove = document.getElementById('vw-remove');

let framesOpen = false;
let viewSlot = null;      // the frame open in the viewer
let fpSig = '';
let vwSig = '';

function uiOpen() { return framesOpen || !!viewSlot; }

function frameTitle(slot) {
  return slotRoom(slot) + ' · frame ' + (slots.indexOf(slot) + 1);
}

/* ---------- frames panel ---------- */
function linkedCount() {
  return Object.values(hallCall.peers).filter(shareReady).length;   // other devices on this account, connected
}

function frameSig() {
  return slots.map(s => (s.state || 'empty') + '|' + (s.src || '')).join('\n') + '#' + linkedCount();
}

function renderFrames() {
  const sig = frameSig();
  if (sig === fpSig) return;
  fpSig = sig;
  fpGrid.innerHTML = '';
  let filled = 0;
  slots.forEach((slot, i) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'fp-tile';
    const thumb = document.createElement('div');
    thumb.className = 'fp-thumb';
    if (slot.src && slot.srcType === 'video') {
      const v = document.createElement('video');
      v.src = slot.src; v.muted = true; v.playsInline = true; v.preload = 'metadata';
      thumb.appendChild(v);
    } else if (slot.src) {
      const im = document.createElement('img');
      im.src = slot.src; im.alt = '';
      thumb.appendChild(im);
    } else if (slot.state === 'waiting') {
      const t = document.createElement('span');
      t.textContent = 'Waiting for file';
      thumb.appendChild(t);
    } else {
      thumb.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i><span>Add</span>';
    }
    if (slot.src || slot.state === 'waiting') filled++;
    const label = document.createElement('div');
    label.className = 'fp-label';
    label.textContent = (i + 1) + ' · ' + slotRoom(slot);
    tile.append(thumb, label);
    tile.addEventListener('click', () => openFrame(slot));
    fpGrid.appendChild(tile);
  });
  const linked = linkedCount();
  fpCount.textContent = filled + ' of ' + slots.length + ' filled · ' +
    (linked ? linked + ' other device' + (linked > 1 ? 's' : '') + ' connected' : 'no other device connected');
}

function openFramesPanel() {
  framesOpen = true;
  fpEl.classList.remove('hidden');
  fpSig = '';
  renderFrames();
}

function closeFramesPanel() {
  framesOpen = false;
  fpEl.classList.add('hidden');
  fpGrid.innerHTML = '';   // stops the video thumbnails
}

function toggleFramesPanel() {
  if (framesOpen) closeFramesPanel();
  else openFramesPanel();
}

fpCloseBtn.addEventListener('click', e => { e.stopPropagation(); closeFramesPanel(); });

// touches on the panels scroll them; they must not also turn the view
fpEl.addEventListener('pointerdown', e => e.stopPropagation());
vwEl.addEventListener('pointerdown', e => e.stopPropagation());

/* ---------- one frame, full screen ---------- */
// a filled or waiting frame opens the viewer; an empty one opens the upload picker
function openFrame(slot) {
  if (slot.src || slot.state === 'waiting') openViewer(slot);
  else pickFileFor(slot);
}

function openViewer(slot) {
  viewSlot = slot;
  vwSig = '';
  vwEl.classList.remove('hidden');
  renderViewer();
}

function closeViewer() {
  viewSlot = null;
  vwEl.classList.add('hidden');
  vwStage.innerHTML = '';  // stops any video
}

function renderViewer() {
  const s = viewSlot;
  if (!s) return;
  const sig = (s.src || '') + '|' + (s.state || '');
  if (sig === vwSig) return;
  vwSig = sig;
  vwStage.innerHTML = '';
  if (s.src && s.srcType === 'video') {
    const v = document.createElement('video');
    v.src = s.src; v.controls = true; v.loop = true; v.autoplay = true; v.playsInline = true;
    vwStage.appendChild(v);
  } else if (s.src) {
    const im = document.createElement('img');
    im.src = s.src; im.alt = '';
    vwStage.appendChild(im);
  } else {
    const p = document.createElement('p');
    p.className = 'vw-empty';
    p.textContent = 'Waiting for the file from another visitor on your account.';
    vwStage.appendChild(p);
  }
  vwTitle.textContent = frameTitle(s);
  vwChange.classList.toggle('hidden', !s.src);
  vwRemove.classList.remove('hidden');
}

vwCloseBtn.addEventListener('click', e => { e.stopPropagation(); closeViewer(); });
vwChange.addEventListener('click', e => { e.stopPropagation(); if (viewSlot) pickFileFor(viewSlot); });
vwRemove.addEventListener('click', e => { e.stopPropagation(); if (viewSlot) shareRemove(viewSlot); });

// keep the panel and viewer in step with changes from other visitors
setInterval(() => {
  if (framesOpen) renderFrames();
  if (viewSlot) {
    if (!viewSlot.src && viewSlot.state === 'empty') closeViewer();
    else renderViewer();
  }
}, 500);

addEventListener('keydown', e => {
  if (e.code !== 'Escape') return;
  if (viewSlot) { e.preventDefault(); closeViewer(); }
  else if (framesOpen) { e.preventDefault(); closeFramesPanel(); }
});

/* ---------- click or tap a frame in the museum ---------- */
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

function slotAtPoint(x, y) {
  const r = canvas.getBoundingClientRect();
  _ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  _ray.far = 14;   // only frames close enough to walk up to
  const hit = _ray.intersectObjects(scene.children, true)[0];
  if (!hit) return null;
  for (let o = hit.object; o; o = o.parent) {
    const s = slots.find(x2 => x2.mesh === o);
    if (s) return s;
  }
  return null;
}

let downAt = null;
canvas.addEventListener('pointerdown', e => {
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointerup', e => {
  if (!downAt) return;
  const start = downAt;
  downAt = null;
  if (!playing || uiOpen() || chatOpen) return;
  const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
  if (moved > 8 || performance.now() - start.t > 500) return;   // a drag to look, not a click
  const slot = slotAtPoint(e.clientX, e.clientY);
  if (slot) openFrame(slot);
});
