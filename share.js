/* ==========================================================
   share.js — photos and videos added by one visitor appear live
   for the other visitors signed in with the same account.
   - The file moves device to device over WebRTC (RTCDataChannel),
     in small chunks, at original quality. No server stores the file.
   - Files only go to visitors with the same account id.
   - Firebase keeps only a small record per frame:
       frames/{uid}/{slot} = { fid, mime, size, sync, owner }
   - Sync on (3-dot menu): the file is also kept in this browser
     (IndexedDB), so it is still there after a refresh.
   - Sync off: the file is kept in memory only, while in the museum.
     Its frame record is removed when this visitor leaves.
   Plain script (no modules).
   ========================================================== */

const SHARE_CHUNK = 16 * 1024;              // bytes per message (safe for every browser)
const SHARE_HIGH_WATER = 1024 * 1024;       // pause sending while this much is queued
const SHARE_MAX_IMAGE = 25 * 1024 * 1024;
const SHARE_MAX_VIDEO = 50 * 1024 * 1024;   // larger videos stay on the uploader's screen only
const SHARE_PARALLEL = 2;                   // at most two transfers requested at once
let sharePaused = false;                    // true while the app is in the background
const SYNC_KEY = 'museumSync';

let syncOn = true;   // default on: saved in this browser unless turned off
try { syncOn = localStorage.getItem(SYNC_KEY) !== '0'; } catch (e) {}

const shareMenuBtn = document.getElementById('menu-sync');
let shareUid = null;
let shareRef = null;
let shareTimer = null;
const shareFiles = new Map();      // fid -> Blob (kept for this session)
const shareUrls = new Map();       // fid -> object URL used to show it
const shareInflight = new Map();   // fid -> { peer, t } asked from one peer
const shareTried = new Map();      // fid -> Set of peer ids that did not have it
const shareOwn = new Map();        // slot index -> { sync, fid }, for records this visitor wrote

const shareWait = ms => new Promise(r => setTimeout(r, ms));
function newFileId() { return 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
function shareKind(mime) { return String(mime || '').startsWith('video/') ? 'video' : 'picture'; }

/* ---------- storage: memory always, IndexedDB only when sync is on ---------- */
let idbDb = null;
function idbOpen() {
  if (idbDb) return Promise.resolve(idbDb);
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('no storage')); return; }
    const r = indexedDB.open('museum-files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => { idbDb = r.result; resolve(idbDb); };
    r.onerror = () => reject(r.error);
  });
}
async function idbRun(mode, make) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    const req = make(tx.objectStore('files'));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
const idbPut = (fid, blob) => idbRun('readwrite', s => s.put(blob, fid)).catch(() => {});
const idbGet = fid => idbRun('readonly', s => s.get(fid)).catch(() => null);
const idbDel = fid => idbRun('readwrite', s => s.delete(fid)).catch(() => {});
const idbClear = () => idbRun('readwrite', s => s.clear()).catch(() => {});

async function getBlob(fid) {
  if (shareFiles.has(fid)) return shareFiles.get(fid);
  if (!syncOn) return null;
  const blob = await idbGet(fid);
  if (blob instanceof Blob) { shareFiles.set(fid, blob); return blob; }
  return null;
}

function keepBlob(fid, blob) {
  shareFiles.set(fid, blob);
  if (syncOn) idbPut(fid, blob);
}

function forgetFile(fid) {
  shareFiles.delete(fid);
  shareInflight.delete(fid);
  shareTried.delete(fid);
  const url = shareUrls.get(fid);
  if (url) { URL.revokeObjectURL(url); shareUrls.delete(fid); }
  if (syncOn) idbDel(fid);
}

function urlFor(fid, blob) {
  if (!shareUrls.has(fid)) shareUrls.set(fid, URL.createObjectURL(blob));
  return shareUrls.get(fid);
}

/* ---------- sync on / off (3-dot menu) ---------- */
function paintSyncButton() {
  if (shareMenuBtn) shareMenuBtn.textContent = 'Sync photos & videos: ' + (syncOn ? 'on' : 'off');
}

function setSync(on) {
  syncOn = !!on;
  try { localStorage.setItem(SYNC_KEY, syncOn ? '1' : '0'); } catch (e) {}
  if (syncOn) shareFiles.forEach((blob, fid) => idbPut(fid, blob));
  else idbClear();                                    // off: nothing stays in this browser
  paintSyncButton();
  toast(syncOn
    ? 'Sync is on: photos and videos are kept in this browser, so they stay after a refresh.'
    : 'Sync is off: photos and videos are kept only while you are in the museum.');
}

if (shareMenuBtn) {
  paintSyncButton();
  shareMenuBtn.addEventListener('click', e => { e.stopPropagation(); setSync(!syncOn); });
}

/* ---------- peers: only visitors with the same account ---------- */
function isSameAccount(peerId) {
  const p = hallCall.people[peerId];
  return !!(p && shareUid && p.uid === shareUid);
}

function shareReady(peer) {
  return !!peer.dc && peer.dc.readyState === 'open' && isSameAccount(peer.id);
}

// called from webrtc.js for every peer connection (both sides, same channel id)
function setupShare(peer) {
  const dc = peer.pc.createDataChannel('share', { negotiated: true, id: 0 });
  dc.binaryType = 'arraybuffer';
  peer.dc = dc;
  peer.rx = null;
  peer.sendChain = Promise.resolve();
  dc.onopen = () => {
    console.info('[museum] file channel open to', peer.id, isSameAccount(peer.id) ? '(same account)' : '(other account, not used)');
    if (isSameAccount(peer.id)) shareWantMissing();
  };
  dc.onclose = () => { console.info('[museum] file channel closed to', peer.id); shareDropPeer(peer.id); };
  dc.onmessage = e => shareOnMessage(peer, e.data);
}

function shareDropPeer(peerId) {
  for (const [fid, inf] of shareInflight) if (inf.peer === peerId) shareInflight.delete(fid);
  for (const set of shareTried.values()) set.delete(peerId);
}

function shareSendJson(dc, obj) {
  if (dc.readyState === 'open') dc.send(JSON.stringify(obj));
}

/* ---------- sending: one file at a time per peer, with backpressure ---------- */
function queueSend(peer, fid) {
  peer.sendChain = peer.sendChain.then(() => sendFileTo(peer, fid)).catch(() => {});
}

async function sendFileTo(peer, fid) {
  if (!shareReady(peer)) return;
  const dc = peer.dc;
  const blob = await getBlob(fid);
  if (!shareReady(peer)) return;
  if (!blob) { shareSendJson(dc, { t: 'none', fid }); return; }

  shareSendJson(dc, { t: 'start', fid, mime: blob.type || 'application/octet-stream', size: blob.size });
  let n = 0;
  for (let off = 0; off < blob.size; off += SHARE_CHUNK) {
    while (dc.readyState === 'open' && (sharePaused || dc.bufferedAmount > SHARE_HIGH_WATER)) await shareWait(100);
    if (dc.readyState !== 'open') return;
    const buf = await blob.slice(off, off + SHARE_CHUNK).arrayBuffer();
    if (dc.readyState !== 'open') return;
    dc.send(buf);
    if (++n % 8 === 0) await shareWait(0);   // let the page draw and respond
  }
  shareSendJson(dc, { t: 'end', fid });
}

/* ---------- receiving ---------- */
function shareOnMessage(peer, data) {
  if (!isSameAccount(peer.id)) return;
  if (typeof data === 'string') {
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (m.t === 'want') queueSend(peer, m.fid);
    else if (m.t === 'start') startReceive(peer, m);
    else if (m.t === 'end') finishReceive(peer, m.fid);
    else if (m.t === 'none') {
      const inf = shareInflight.get(m.fid);
      if (inf && inf.peer === peer.id) shareInflight.delete(m.fid);
      markTried(m.fid, peer.id);
    }
    return;
  }
  if (peer.rx && data instanceof ArrayBuffer) {
    peer.rx.parts.push(data);
    peer.rx.got += data.byteLength;
  }
}

function startReceive(peer, m) {
  shareInflight.delete(m.fid);
  if (shareFiles.has(m.fid) || !m.size || m.size > SHARE_MAX_VIDEO) { peer.rx = null; return; }
  peer.rx = { fid: m.fid, mime: m.mime, size: m.size, parts: [], got: 0 };
}

function finishReceive(peer, fid) {
  const rx = peer.rx;
  peer.rx = null;
  if (!rx || rx.fid !== fid) return;
  if (rx.got !== rx.size) { shareWantMissing(); return; }   // incomplete: ask again later
  keepBlob(fid, new Blob(rx.parts, { type: rx.mime }));
  onFileReady(fid);
}

function markTried(fid, peerId) {
  let set = shareTried.get(fid);
  if (!set) { set = new Set(); shareTried.set(fid, set); }
  set.add(peerId);
}

// ask one connected same-account peer for a file we do not have yet
function wantFile(fid) {
  if (shareFiles.has(fid)) return;
  const now = Date.now();
  const inf = shareInflight.get(fid);
  if (sharePaused) return;
  if (inf && now - inf.t < 15000) return;
  if (!inf && shareInflight.size >= SHARE_PARALLEL) return;
  const peers = Object.values(hallCall.peers).filter(shareReady);
  if (!peers.length) return;
  const tried = shareTried.get(fid) || new Set();
  let pick = peers.find(p => !tried.has(p.id));
  if (!pick) { shareTried.delete(fid); pick = peers[0]; }
  shareInflight.set(fid, { peer: pick.id, t: now });
  shareSendJson(pick.dc, { t: 'want', fid });
}

// frames nearest to the visitor are requested first
function shareWantMissing() {
  if (sharePaused) return;
  const pending = slots.filter(s => s.shareId && s.shareShown !== s.shareId);
  const p = new THREE.Vector3();
  const dist = s => { s.mesh.getWorldPosition(p); return p.distanceToSquared(camera.position); };
  pending.map(s => [dist(s), s]).sort((a, b) => a[0] - b[0]).forEach(([, s]) => wantFile(s.shareId));
}

// phones: pause transfers while the app is in the background
document.addEventListener('visibilitychange', () => {
  sharePaused = document.visibilityState === 'hidden';
  if (!sharePaused) shareWantMissing();
});

/* ---------- showing files in the frames ---------- */
function showShared(slot, fid, blob) {
  slot.shareShown = fid;
  const url = urlFor(fid, blob);
  if (shareKind(blob.type) === 'video') setVideo(slot, url);
  else setPicture(slot, url);
}

function onFileReady(fid) {
  const blob = shareFiles.get(fid);
  if (!blob) return;
  for (const slot of slots) {
    if (slot.shareId === fid && slot.shareShown !== fid) showShared(slot, fid, blob);
  }
}

// one frame record changed in Firebase (or was removed: rec = null)
function applyRecord(i, rec) {
  const slot = slots[i];
  if (!slot) return;
  if (!rec || !rec.fid) {
    if (slot.shareId) {
      const old = slot.shareId;
      slot.shareId = null;
      slot.shareShown = null;
      clearSlot(slot);
      forgetFile(old);
      slot.touched = false;
      loadFolderFrame(i);   // removed: the media folder file comes back, if there is one
    }
    return;
  }
  slot.touched = true;   // a synced change: the media folder no longer fills this frame
  if (slot.shareId === rec.fid) return;
  if (slot.shareId) forgetFile(slot.shareId);
  const fid = rec.fid;
  slot.shareId = fid;
  slot.shareShown = null;
  getBlob(fid).then(blob => {
    if (slot.shareId !== fid) return;
    if (blob) {
      showShared(slot, fid, blob);
      if (rec.owner !== callId) fbDb.ref(`frames/${shareUid}/${i}/owner`).set(callId).catch(() => {});  // this device holds it: it is the owner now
      return;
    }
    clearSlot(slot);
    slot.state = 'waiting';            // no connected visitor has it yet
    wantFile(fid);
    loadFolderFrame(i, true);          // meanwhile, the media folder file if there is one
    setTimeout(() => checkStaleRecord(i, fid), 20000);
  });
}

// a record whose file nobody has is dummy data: remove it when its owner is gone
function checkStaleRecord(i, fid) {
  const slot = slots[i];
  if (!slot || slot.shareId !== fid || slot.shareShown === fid || !shareUid) return;
  const rec = fbDb.ref(`frames/${shareUid}/${i}`);
  rec.once('value').then(snap => {
    const r = snap.val();
    if (!r || r.fid !== fid) return;
    const ownerGone = r.owner === callId ? true : !hallCall.people[r.owner];
    const openPeers = Object.values(hallCall.peers).filter(shareReady);
    const tried = shareTried.get(fid);
    const nobodyHas = openPeers.length === 0 || (!!tried && openPeers.every(p => tried.has(p.id)));
    if (ownerGone && nobodyHas) rec.transaction(cur => (cur && cur.fid === fid ? null : cur)).catch(() => {});
  }).catch(() => {});
}

/* ---------- add, remove ---------- */
// iPhone photos are often HEIC, which laptop browsers can't show. Convert to JPEG at full size.
function isHeic(file) {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || '');
}
async function heicToJpeg(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  if (bmp.close) bmp.close();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95));
  if (!blob) throw new Error('convert failed');
  return blob;
}

async function shareUpload(slot, file) {
  if (!file) return;
  slot.touched = true;    // a visitor's change: the media folder no longer fills this frame
  if (isHeic(file)) {
    try { file = await heicToJpeg(file); }
    catch (e) { toast("This photo format can't be shared. Set the camera to JPEG (Settings > Camera > Formats)."); return; }
  }
  if (!/^(image|video)\//.test(file.type)) { toast('Please choose a picture or a video.'); return; }
  const kind = shareKind(file.type);
  const limit = kind === 'video' ? SHARE_MAX_VIDEO : SHARE_MAX_IMAGE;
  if (file.size > limit) {
    toast('That file is too big. The limit is ' + Math.round(limit / 1048576) + ' MB.');
    return;
  }

  // not signed in: show it on this screen only
  if (!shareUid) {
    const url = URL.createObjectURL(file);
    if (kind === 'video') setVideo(slot, url); else setPicture(slot, url);
    return;
  }

  const i = slots.indexOf(slot);
  if (i < 0) return;
  const fid = newFileId();
  const sync = syncOn;
  keepBlob(fid, file);
  shareOwn.set(i, { sync, fid });

  fbDb.ref(`frames/${shareUid}/${i}`)
    .set({ fid, mime: file.type, size: file.size, sync, owner: callId })
    .catch(err => toast('Could not share it: ' + err.message));
}

function shareRemove(slot) {
  const i = slots.indexOf(slot);
  if (i < 0) return;
  if (slot.shareId) applyRecord(i, null);   // the media folder file comes back, if there is one
  else { slot.touched = true; clearSlot(slot); }   // a media file stays removed until refresh
  if (!shareUid) return;
  shareOwn.delete(i);
  fbDb.ref(`frames/${shareUid}/${i}`).remove().catch(err => toast('Could not remove it: ' + err.message));
}

/* ---------- start / stop (called from auth.js) ---------- */
function startShare(sess) {
  shareUid = sess.uid;
  shareRef = fbDb.ref(`frames/${shareUid}`);
  const onRecord = snap => applyRecord(Number(snap.key), snap.val());
  shareRef.on('child_added', onRecord);
  shareRef.on('child_changed', onRecord);
  shareRef.on('child_removed', snap => applyRecord(Number(snap.key), null));
  shareTimer = setInterval(shareWantMissing, 2000);
}

function stopShare() {
  if (shareRef) shareRef.off();
  shareRef = null;
  clearInterval(shareTimer);
  shareTimer = null;
  dropOwnRecords();
  shareOwn.clear();
  shareInflight.clear();
  shareTried.clear();
  slots.forEach(slot => {
    if (slot.shareId) { slot.shareId = null; slot.shareShown = null; clearSlot(slot); }
  });
  shareUid = null;
}

// sync-off frames last only while this visitor is in the museum. The record is removed only
// if it still points at this visitor's file, so a newer file from someone else is never deleted.
function dropOwnRecords() {
  if (!shareUid) return;
  shareOwn.forEach(({ sync, fid }, i) => {
    if (sync) return;
    fbDb.ref(`frames/${shareUid}/${i}`)
      .transaction(cur => (cur && cur.fid === fid ? null : cur))
      .catch(() => {});
  });
}
window.addEventListener('pagehide', dropOwnRecords);
