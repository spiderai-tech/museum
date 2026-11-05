/* ==========================================================
   webrtc.js — video calls between visitors, shown on the hall TV.
   - Signalling (offers, answers, ICE candidates) goes through
     Firebase Realtime Database under calls/hall.
   - Everyone signed in is in the hall. Each pair of visitors keeps
     one WebRTC connection open, so a live video can be seen by the
     others even when they have not started a call themselves.
   - 3-dot menu > Video call: asks for camera and microphone, then
     sends them to the other visitors. Mic and camera buttons work
     while the call is live.
   - The TV in the middle of the main hall shows the live video:
       nobody live ............ "no video call" message
       only you are live ...... your own camera (what you see on the TV)
       others are live ........ the others' cameras (not your own)
   Plain script (no modules).
   ========================================================== */

const CALL_ROOT = 'calls/hall';
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];
const HEARTBEAT_MS = 60 * 1000;   // how often this visitor says "still here"
const STALE_MS = 5 * 60 * 1000;   // visitors silent for longer are removed (old or dummy data)

// one id per browser tab, so two tabs of the same account can each be in the hall
const callId = 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const hallCall = {
  me: null,          // { uid, name } while this tab is in the hall
  people: {},        // other visitors: callId -> { uid, name, live }
  peers: {},         // callId -> peer connection record
  local: null,       // our camera + microphone stream, only while live
  live: false,
  micOn: true,
  camOn: true,
  starting: false,  // true while the browser asks for camera and microphone
  timer: null,
  offs: [],          // functions that stop our Firebase listeners
  serverOffset: 0
};

const callEl = document.getElementById('call');
const callStage = document.getElementById('call-stage');
const callWait = document.getElementById('call-wait');
const callStatus = document.getElementById('call-status');
const callMicBtn = document.getElementById('call-mic');
const callCamBtn = document.getElementById('call-cam');
const callHideBtn = document.getElementById('call-hide');
const callEndBtn = document.getElementById('call-end');
const callToast = document.getElementById('call-toast');
const menuCallBtn = document.getElementById('menu-call');
const menuCallEndBtn = document.getElementById('menu-call-end');
const menuPanelEl = document.getElementById('menu-panel');
const callTiles = {};   // callId -> tile shown in the call panel

fbDb.ref('.info/serverTimeOffset').on('value', s => { hallCall.serverOffset = s.val() || 0; });
function serverNow() { return Date.now() + hallCall.serverOffset; }

function listen(ref, event, fn) {
  ref.on(event, fn);
  hallCall.offs.push(() => ref.off(event, fn));
}

function plain(obj) { return JSON.parse(JSON.stringify(obj)); }

let toastTimer = null;
function toast(msg) {
  callToast.textContent = msg;
  callToast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => callToast.classList.add('hidden'), 6000);
}

/* ---------- joining and leaving the hall (called from auth.js) ---------- */
function joinHall(sess) {
  if (hallCall.me) return;
  hallCall.me = { uid: sess.uid, name: sess.name };

  // this visitor, removed automatically if the connection drops
  const myRef = fbDb.ref(`${CALL_ROOT}/people/${callId}`);
  myRef.onDisconnect().remove();
  myRef.set({
    uid: sess.uid,
    name: sess.name,
    live: false,
    heartbeat: firebase.database.ServerValue.TIMESTAMP
  });
  hallCall.timer = setInterval(() => {
    myRef.update({ heartbeat: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
  }, HEARTBEAT_MS);

  // messages addressed to this tab (offers, answers, ICE candidates)
  const sigRef = fbDb.ref(`${CALL_ROOT}/signals/${callId}`);
  sigRef.onDisconnect().remove();
  listen(sigRef, 'child_added', snap => {
    const msg = snap.val();
    snap.ref.remove();
    if (msg) handleSignal(msg);
  });

  // who is in the hall, and who is live
  const peopleRef = fbDb.ref(`${CALL_ROOT}/people`);
  listen(peopleRef, 'child_added', snap => onPerson(snap.key, snap.val()));
  listen(peopleRef, 'child_changed', snap => onPerson(snap.key, snap.val()));
  listen(peopleRef, 'child_removed', snap => onPersonLeft(snap.key));

  removeStaleVisitors();
}

function leaveHall() {
  if (!hallCall.me) return;
  endVideoCall();
  clearInterval(hallCall.timer);
  hallCall.offs.forEach(off => off());
  hallCall.offs = [];
  Object.keys(hallCall.peers).forEach(closePeer);
  hallCall.people = {};
  fbDb.ref(`${CALL_ROOT}/people/${callId}`).remove();
  fbDb.ref(`${CALL_ROOT}/signals/${callId}`).remove();
  hallCall.me = null;
  renderCallPanel();
}

// clears old or dummy visitor entries that have no recent heartbeat
function removeStaleVisitors() {
  fbDb.ref(`${CALL_ROOT}/people`).once('value').then(snap => {
    const cutoff = serverNow() - STALE_MS;
    snap.forEach(child => {
      if (child.key === callId) return;
      const d = child.val() || {};
      if (typeof d.heartbeat !== 'number' || d.heartbeat < cutoff) child.ref.remove();
    });
  }).catch(() => {});
}

function onPerson(id, data) {
  if (!hallCall.me || id === callId || !data) return;
  hallCall.people[id] = { uid: data.uid, name: data.name || 'Visitor', live: data.live === true };
  if (!hallCall.peers[id]) makePeer(id);
  renderCallPanel();
}

function onPersonLeft(id) {
  if (id === callId) return;
  delete hallCall.people[id];
  closePeer(id);
  renderCallPanel();
}

/* ---------- signalling through Firebase ---------- */
function sendSignal(toId, data) {
  fbDb.ref(`${CALL_ROOT}/signals/${toId}`).push(Object.assign({ from: callId }, data));
}

// "perfect negotiation": when both sides send an offer at the same time,
// the side with the smaller id gives way, so the connection always settles
async function handleSignal(msg) {
  const id = msg.from;
  if (!id || id === callId) return;

  if (!hallCall.peers[id]) {
    const isOffer = !!msg.description && msg.description.type === 'offer';
    if (!isOffer && !hallCall.people[id]) return;   // not a visitor we know
    makePeer(id);
  }

  const peer = hallCall.peers[id];
  const pc = peer.pc;
  try {
    if (msg.description) {
      const desc = msg.description;
      const readyForOffer = !peer.makingOffer && (pc.signalingState === 'stable' || peer.settingAnswer);
      const collision = desc.type === 'offer' && !readyForOffer;
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;

      peer.settingAnswer = desc.type === 'answer';
      await pc.setRemoteDescription(desc);
      peer.settingAnswer = false;
      await flushIce(peer);

      if (desc.type === 'offer') {
        await pc.setLocalDescription();
        sendSignal(id, { description: plain(pc.localDescription) });
      }
    } else if (msg.candidate) {
      if (!pc.remoteDescription) peer.pendingIce.push(msg.candidate);
      else if (!peer.ignoreOffer) await pc.addIceCandidate(msg.candidate);
    }
  } catch (err) {
    if (!peer.ignoreOffer) console.warn('call signal problem', err);
  }
}

async function flushIce(peer) {
  const queued = peer.pendingIce.splice(0);
  for (const c of queued) {
    try { await peer.pc.addIceCandidate(c); } catch (e) {}
  }
}

/* ---------- one connection per pair of visitors ---------- */
function makePeer(id) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const remote = new MediaStream();

  // plays the other person's sound
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.playsInline = true;
  audio.srcObject = remote;
  document.body.appendChild(audio);

  const peer = {
    id, pc, remote, audio,
    polite: callId < id,
    makingOffer: false,
    ignoreOffer: false,
    settingAnswer: false,
    pendingIce: []
  };
  hallCall.peers[id] = peer;

  // one audio and one video slot in each direction, always there;
  // sending is switched on and off with replaceTrack, so no renegotiation is needed
  pc.addTransceiver('audio', { direction: 'sendrecv' });
  preferVP8(pc.addTransceiver('video', { direction: 'sendrecv' }));
  if (hallCall.live) attachLocal(peer);

  pc.onicecandidate = e => {
    if (e.candidate) sendSignal(id, { candidate: plain(e.candidate) });
  };
  pc.ontrack = e => {
    if (!remote.getTracks().includes(e.track)) remote.addTrack(e.track);
    e.track.onmute = e.track.onunmute = e.track.onended = () => renderCallPanel();
    audio.play().catch(() => {});
    renderCallPanel();
  };
  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      sendSignal(id, { description: plain(pc.localDescription) });
    } catch (err) {
      console.warn('call offer problem', err);
    } finally {
      peer.makingOffer = false;
    }
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') pc.restartIce();
  };
  return peer;
}

function closePeer(id) {
  const peer = hallCall.peers[id];
  if (!peer) return;
  peer.pc.close();
  peer.audio.remove();
  delete hallCall.peers[id];
}

function attachLocal(peer) {
  if (!hallCall.local) return;
  for (const t of peer.pc.getTransceivers()) {
    const kind = t.receiver.track.kind;
    const track = hallCall.local.getTracks().find(x => x.kind === kind);
    if (track) t.sender.replaceTrack(track).catch(err => console.warn(err));
  }
}

function detachLocal(peer) {
  for (const t of peer.pc.getTransceivers()) {
    t.sender.replaceTrack(null).catch(() => {});
  }
}

/* ---------- starting and ending a video call ---------- */
// sharp HD picture from the camera; falls back to any camera if HD is not possible
async function getCallMedia() {
  // phones get a smaller, lighter picture; computers get 720p
  const hd = IS_TOUCH
    ? { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } }
    : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: hd
    });
  } catch (err) {
    if (err.name === 'OverconstrainedError' || err.name === 'NotReadableError') {
      return navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    }
    throw err;
  }
}

async function startVideoCall() {
  if (!hallCall.me) return;
  if (hallCall.live) { showCallPanel(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('This browser cannot use the camera and microphone.');
    return;
  }

  // asks the browser for camera and microphone permission
  if (hallCall.starting) return;     // a permission prompt is already open
  hallCall.starting = true;
  let stream;
  try {
    stream = await getCallMedia();
  } catch (err) {
    toast(
      err.name === 'NotAllowedError' ? 'Camera and microphone were refused. Allow them in the browser, then try again.' :
      err.name === 'NotFoundError' ? 'No camera or microphone was found on this device.' :
      'Could not start the camera and microphone.'
    );
    hallCall.starting = false;
    return;
  }
  hallCall.starting = false;
  if (!hallCall.me) {            // signed out while the browser was asking
    stream.getTracks().forEach(t => t.stop());
    return;
  }

  hallCall.local = stream;
  hallCall.live = true;
  hallCall.micOn = true;
  hallCall.camOn = true;
  for (const p of Object.values(hallCall.peers)) attachLocal(p);
  fbDb.ref(`${CALL_ROOT}/people/${callId}`).update({ live: true }).catch(() => {});
  showCallPanel();
}

function endVideoCall() {
  if (!hallCall.live) return;
  hallCall.local.getTracks().forEach(t => t.stop());
  for (const p of Object.values(hallCall.peers)) detachLocal(p);
  hallCall.local = null;
  hallCall.live = false;
  if (hallCall.me) fbDb.ref(`${CALL_ROOT}/people/${callId}`).update({ live: false }).catch(() => {});
  hideCallPanel();
  updateCallButtons();
}

function toggleMic() {
  if (!hallCall.local) return;
  hallCall.micOn = !hallCall.micOn;
  hallCall.local.getAudioTracks().forEach(t => { t.enabled = hallCall.micOn; });
  updateCallButtons();
}

function toggleCam() {
  if (!hallCall.local) return;
  hallCall.camOn = !hallCall.camOn;
  hallCall.local.getVideoTracks().forEach(t => { t.enabled = hallCall.camOn; });
  updateCallButtons();
}

/* ---------- the call panel: shows the other live visitors ---------- */
function showCallPanel() {
  if (document.pointerLockElement) document.exitPointerLock();
  callEl.classList.remove('hidden');
  renderCallPanel();
  updateCallButtons();
}

function hideCallPanel() {
  callEl.classList.add('hidden');
}

function updateCallButtons() {
  callMicBtn.textContent = hallCall.micOn ? 'Mic: on' : 'Mic: off';
  callMicBtn.classList.toggle('off', !hallCall.micOn);
  callCamBtn.textContent = hallCall.camOn ? 'Camera: on' : 'Camera: off';
  callCamBtn.classList.toggle('off', !hallCall.camOn);
  menuCallBtn.textContent = hallCall.live ? 'Show video call' : 'Video call';
  menuCallEndBtn.classList.toggle('hidden', !hallCall.live);
}

function renderCallPanel() {
  if (callEl.classList.contains('hidden')) return;

  // the other visitors who are live (never yourself)
  const others = Object.keys(hallCall.people).filter(id => hallCall.people[id].live && hallCall.peers[id]);
  const keep = new Set(others);

  for (const id of others) {
    const peer = hallCall.peers[id];
    let tile = callTiles[id];
    if (!tile) {
      const el = document.createElement('div');
      el.className = 'call-tile';
      const v = document.createElement('video');
      v.autoplay = true;
      v.playsInline = true;
      v.muted = true;                 // sound comes from the audio element
      const nocam = document.createElement('div');
      nocam.className = 'nocam';
      nocam.textContent = 'Camera off';
      const tag = document.createElement('span');
      tag.className = 'tag';
      el.append(v, nocam, tag);
      callStage.insertBefore(el, callWait);
      tile = callTiles[id] = { el, v, tag, peer };
    }
    tile.tag.textContent = hallCall.people[id].name;
    if (tile.v.srcObject !== peer.remote) {
      tile.v.srcObject = peer.remote;
      tile.v.play().catch(() => {});
    }
    tile.el.classList.toggle('no-video', !showableVideo(peer, tile.v));
  }

  for (const id of Object.keys(callTiles)) {
    if (!keep.has(id)) { callTiles[id].el.remove(); delete callTiles[id]; }
  }

  callWait.classList.toggle('hidden', others.length > 0);
  callStage.style.gridTemplateColumns = others.length > 1 ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)';
  callStatus.textContent = others.length ? others.length + ' live with you' : 'Waiting for others';
}

// Chrome and some other browsers show a green or noisy picture before a real frame arrives,
// so a video is only shown when its track is live (not muted) and has decoded frames.
function showableVideo(peer, v) {
  if (!peer || !v) return false;
  const t = peer.remote.getVideoTracks()[0];
  return !!t && !t.muted && t.readyState === 'live' && v.readyState >= 2 && v.videoWidth > 0;
}

// asks for VP8 first; the other codecs stay available as fallback
function preferVP8(transceiver) {
  if (!transceiver || !transceiver.setCodecPreferences || !RTCRtpReceiver.getCapabilities) return;
  const caps = RTCRtpReceiver.getCapabilities('video');
  if (!caps) return;
  const vp8 = caps.codecs.filter(c => c.mimeType === 'video/VP8');
  const rest = caps.codecs.filter(c => c.mimeType !== 'video/VP8');
  if (vp8.length) { try { transceiver.setCodecPreferences([...vp8, ...rest]); } catch (e) {} }
}

/* ---------- the TV in the middle of the main hall ---------- */
const tvEls = {};          // key -> hidden <video> feeding the TV
let tvLast = 0;

const tvHolder = document.createElement('div');   // keeps the feeding videos out of sight
tvHolder.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;overflow:hidden';
document.body.appendChild(tvHolder);

// what this viewer sees on the TV
function tvSources() {
  const others = [];
  for (const [id, p] of Object.entries(hallCall.people)) {
    const peer = hallCall.peers[id];
    if (p.live && peer) others.push({ key: id, name: p.name, stream: peer.remote });
  }
  // alone and live: show your own camera
  if (hallCall.live && hallCall.local && others.length === 0) {
    return [{ key: 'me', name: hallCall.me ? hallCall.me.name : 'You', stream: hallCall.local }];
  }
  // otherwise show the others who are live (the opposite person when two are live)
  return others;
}

function feedVideo(key, stream) {
  let v = tvEls[key];
  if (!v) {
    v = tvEls[key] = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    tvHolder.appendChild(v);
  }
  const count = stream.getTracks().length;
  if (v.srcObject !== stream || v._tracks !== count) {
    v.srcObject = stream;
    v._tracks = count;
    v.play().catch(() => {});
  }
  return v;
}

function drawCover(g, v, x, y, w, h) {
  const s = Math.max(w / v.videoWidth, h / v.videoHeight);
  const dw = v.videoWidth * s, dh = v.videoHeight * s;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  g.restore();
}

function drawName(g, text, x, yBottom, K) {
  g.font = `bold ${Math.round(30 * K)}px system-ui, sans-serif`;
  g.textAlign = 'left';
  const w = g.measureText(text).width + 28 * K;
  g.fillStyle = 'rgba(0, 0, 0, 0.6)';
  g.fillRect(x + 16 * K, yBottom - 62 * K, w, 46 * K);
  g.fillStyle = '#f4efe6';
  g.fillText(text, x + 30 * K, yBottom - 28 * K);
}

function centerText(g, text, x, y, size, color) {
  g.textAlign = 'center';
  g.fillStyle = color;
  g.font = `bold ${Math.round(size)}px Georgia, serif`;
  g.fillText(text, x, y);
}

function removeFeed(key) {
  const v = tvEls[key];
  if (!v) return;
  v.srcObject = null;
  v.remove();
  delete tvEls[key];
}

let tvIdleDrawn = false;

// called every frame from player.js. The TV is redrawn 30 times a second
// (12 on phones) and only while something is on it; an idle TV is drawn once.
function updateCallTV(now) {
  const interval = IS_TOUCH ? 1000 / 12 : 1000 / 30;
  if (now - tvLast < interval) return;
  tvLast = now;

  const g = hallTV.ctx;
  const W = hallTV.canvas.width, H = hallTV.canvas.height;
  const K = W / 1280;                 // scales text to the TV's resolution
  const sources = tvSources();

  if (!sources.length) {
    Object.keys(tvEls).forEach(key => removeFeed(key));
    if (tvIdleDrawn) return;          // nothing has changed since the last picture
    tvIdleDrawn = true;
    g.fillStyle = '#06070a';
    g.fillRect(0, 0, W, H);
    centerText(g, 'NO VIDEO CALL', W / 2, H / 2 - 20 * K, 72 * K, '#e6c26e');
    centerText(g, 'Press the 3-dot menu, then Video call', W / 2, H / 2 + 50 * K, 34 * K, 'rgba(244, 239, 230, 0.7)');
    hallTV.tex.needsUpdate = true;
    return;
  }
  tvIdleDrawn = false;

  const used = new Set();
  const cols = sources.length === 1 ? 1 : sources.length <= 4 ? 2 : 3;
  const rows = Math.ceil(sources.length / cols);
  const cw = W / cols, ch = H / rows;

  sources.forEach((s, i) => {
    used.add(s.key);
    const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
    const v = feedVideo(s.key, s.stream);
    g.fillStyle = '#06070a';
    g.fillRect(x, y, cw, ch);
    const hasCam = s.key === 'me' ? hallCall.camOn : showableVideo(hallCall.peers[s.key], v);
    if (!hasCam) {
      centerText(g, 'Camera off', x + cw / 2, y + ch / 2, 56 * K, 'rgba(244, 239, 230, 0.75)');
    } else if (v.readyState >= 2 && v.videoWidth) {
      drawCover(g, v, x, y, cw, ch);
    } else {
      centerText(g, 'Connecting…', x + cw / 2, y + ch / 2, 44 * K, '#e6c26e');
    }
    drawName(g, s.name, x, y + ch, K);
  });

  Object.keys(tvEls).forEach(key => { if (!used.has(key)) removeFeed(key); });
  hallTV.tex.needsUpdate = true;
}

/* ---------- 3-dot menu buttons ---------- */
callMicBtn.addEventListener('click', toggleMic);
callCamBtn.addEventListener('click', toggleCam);
callHideBtn.addEventListener('click', hideCallPanel);
callEndBtn.addEventListener('click', endVideoCall);

menuCallBtn.addEventListener('click', e => {
  e.stopPropagation();
  menuPanelEl.classList.add('hidden');
  if (hallCall.live) showCallPanel();
  else startVideoCall();
});

menuCallEndBtn.addEventListener('click', e => {
  e.stopPropagation();
  menuPanelEl.classList.add('hidden');
  endVideoCall();
});

// browsers block sound and video until the first tap or key press; resume them then
function resumeMedia() {
  document.querySelectorAll('audio, video').forEach(el => {
    if (el.paused && el.srcObject) el.play().catch(() => {});
  });
}
addEventListener('pointerdown', resumeMedia, true);
addEventListener('keydown', resumeMedia, true);

updateCallButtons();

// the call panel's tiles are refreshed twice a second (not every frame)
setInterval(renderCallPanel, 500);
