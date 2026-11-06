/* ==========================================================
   chat.js — chat between the visitors of one account.
   - Chat button (top right) opens a full-height chat panel on the left.
   - Your messages sit on the right, other visitors' on the left.
   - Every new message shows a notification to the other visitors,
     and a thought bubble above the sender's head in the museum.
   - Each visitor has a name. It is asked once after sign-in, saved on
     this device and in Firebase, and can be changed from the 3-dot menu.
   Plain script (no modules).
   ========================================================== */

const CHAT_MAX = 60;            // newest messages kept in the list
const CHAT_NAME_KEY = 'museumVisitorName';

let chatUid = null;
let chatSid = null;
let chatName = '';
let chatRef = null;
let chatStartedAt = 0;
let chatOpen = false;

const chatBtn = document.getElementById('chat-btn');
const chatPanel = document.getElementById('chat-panel');
const chatList = document.getElementById('chat-list');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatCloseBtn = document.getElementById('chat-close');
const noticeHost = document.getElementById('notice-host');
const nameModal = document.getElementById('name-modal');
const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('name-input');
const menuNameInput = document.getElementById('menu-name-input');
const menuNameSave = document.getElementById('menu-name-save');

/* ---------- names ---------- */
function cleanName(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 16);
}

function readStoredName(sid) {
  try {
    const s = JSON.parse(localStorage.getItem(CHAT_NAME_KEY) || 'null');
    if (s && s.sid === sid && s.name) return s.name;
  } catch (e) {}
  return '';
}

// set this visitor's name on this device and in the museum
function applyName(raw) {
  const name = cleanName(raw);
  if (!name) return false;
  chatName = name;
  try { localStorage.setItem(CHAT_NAME_KEY, JSON.stringify({ sid: chatSid, name })); } catch (e) {}
  if (session) session.name = name;
  if (presenceRef) presenceRef.update({ name });   // others see the new name
  return true;
}

// the same, and also saved in Firebase for next time
function saveVisitorName(raw) {
  if (!applyName(raw) || !chatUid) return false;
  fbDb.ref(`sessions/${chatUid}/${chatSid}`).update({ visitorName: chatName }).catch(() => {});
  return true;
}

function openNameModal() {
  nameModal.classList.remove('hidden');
  setTimeout(() => nameInput.focus(), 50);
}

nameForm.addEventListener('submit', e => {
  e.preventDefault();
  if (!saveVisitorName(nameInput.value)) { nameInput.focus(); return; }
  nameInput.value = '';
  nameModal.classList.add('hidden');
});

menuNameSave.addEventListener('click', e => {
  e.stopPropagation();
  if (!saveVisitorName(menuNameInput.value)) {
    menuNameInput.placeholder = 'Please type a name';
    return;
  }
  menuNameInput.value = '';
  menuNameInput.placeholder = 'Saved as ' + chatName;
});

/* ---------- chat messages ---------- */
function addMessageRow(m, mine) {
  const row = document.createElement('div');
  row.className = 'msg-row ' + (mine ? 'me' : 'other');
  const bubble = document.createElement('div');
  bubble.className = 'msg';
  if (!mine) {
    const who = document.createElement('div');
    who.className = 'msg-name';
    who.textContent = m.name || 'Visitor';
    bubble.appendChild(who);
  }
  const text = document.createElement('div');
  text.className = 'msg-text';
  text.textContent = m.text;
  bubble.appendChild(text);
  row.appendChild(bubble);
  chatList.appendChild(row);
  while (chatList.children.length > CHAT_MAX) chatList.removeChild(chatList.firstChild);
  chatList.scrollTop = chatList.scrollHeight;
}

function onChatMessage(snap) {
  const m = snap.val();
  if (!m) return;
  const mine = m.sid === chatSid;
  addMessageRow(m, mine);

  // only new messages from others notify, and only they get a bubble
  const isNew = (m.ts || 0) >= chatStartedAt;
  if (!isNew || mine) return;
  notify(m);
  showBubble(m.sid, m.text);
}

function sendChat(raw) {
  const text = String(raw || '').trim().slice(0, 300);
  if (!text || !chatUid) return;
  fbDb.ref(`chat/${chatUid}/messages`).push({
    sid: chatSid,
    name: chatName || 'Visitor',
    text,
    ts: firebase.database.ServerValue.TIMESTAMP
  });
}

chatForm.addEventListener('submit', e => {
  e.preventDefault();
  sendChat(chatInput.value);
  chatInput.value = '';
});

/* ---------- notifications for the other visitors ---------- */
function notify(m) {
  if (chatOpen) return;
  const el = document.createElement('div');
  el.className = 'notice';
  const who = document.createElement('div');
  who.className = 'notice-who';
  who.textContent = (m.name || 'Visitor') + ' sent a message';
  const text = document.createElement('div');
  text.className = 'notice-text';
  text.textContent = m.text;
  el.append(who, text);
  el.addEventListener('click', () => { el.remove(); openChat(); });
  noticeHost.appendChild(el);
  while (noticeHost.children.length > 3) noticeHost.removeChild(noticeHost.firstChild);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, 4500);
}

/* ---------- thought bubble above the sender's head ---------- */
function wrapLines(g, text, maxW, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (g.measureText(t).width <= maxW) cur = t;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, -2) + '…';
  }
  return lines;
}

function makeThoughtSprite(text) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  const x = 12, y = 12, w = 488, h = 180, r = 36;

  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
  g.fillStyle = 'rgba(255, 255, 255, 0.96)';
  g.fill();
  g.strokeStyle = '#c9a24a';
  g.lineWidth = 6;
  g.stroke();

  // the two small "thought" circles under the bubble
  for (const [cx, cy, rr] of [[150, 222, 14], [118, 242, 8]]) {
    g.beginPath();
    g.arc(cx, cy, rr, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.fill();
    g.strokeStyle = '#c9a24a';
    g.lineWidth = 4;
    g.stroke();
  }

  g.fillStyle = '#1b1408';
  g.font = 'bold 40px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lines = wrapLines(g, text, 430, 3);
  lines.forEach((ln, i) => g.fillText(ln, 256, 102 + (i - (lines.length - 1) / 2) * 48));

  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(2.0, 1.0, 1);
  sprite.position.y = 2.7;
  sprite.userData.kind = 'bubble';
  return sprite;
}

function disposeSprite(s) {
  if (s.material.map) s.material.map.dispose();
  s.material.dispose();
}

function showBubble(sid, text) {
  const r = remotes[sid];   // the other visitor's character (auth.js)
  if (!r) return;
  if (r.bubble) { r.group.remove(r.bubble); disposeSprite(r.bubble); }
  clearTimeout(r.bubbleTimer);
  const s = makeThoughtSprite(text);
  r.group.add(s);
  r.bubble = s;
  r.bubbleTimer = setTimeout(() => {
    r.group.remove(s);
    disposeSprite(s);
    if (r.bubble === s) r.bubble = null;
  }, 6000);
}

/* ---------- panel open / close ---------- */
function fitChat() {
  // when the phone keyboard opens, shrink the panel so the input stays visible
  const vv = window.visualViewport;
  if (!vv || !chatPanel) return;
  chatPanel.style.height = vv.height + 'px';
  chatPanel.style.top = vv.offsetTop + 'px';
}
if (window.visualViewport) {
  visualViewport.addEventListener('resize', fitChat);
  visualViewport.addEventListener('scroll', fitChat);
}

function openChat() {
  if (!chatUid) return;
  chatOpen = true;
  document.body.classList.add('chat-open');
  chatPanel.classList.remove('hidden');
  document.getElementById('menu-panel').classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();   // so the mouse can type
  fitChat();
  chatList.scrollTop = chatList.scrollHeight;
}

function closeChat() {
  chatOpen = false;
  document.body.classList.remove('chat-open');
  chatPanel.classList.add('hidden');
  chatInput.blur();
}

chatBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (chatOpen) closeChat();
  else openChat();
});
chatCloseBtn.addEventListener('click', e => {
  e.stopPropagation();
  closeChat();
});
chatInput.addEventListener('focus', () => {
  setTimeout(() => { fitChat(); chatList.scrollTop = chatList.scrollHeight; }, 300);
});

/* ---------- Alt+C opens and closes the chat from the keyboard ---------- */
addEventListener('keydown', e => {
  if (e.altKey && e.code === 'KeyC') {
    e.preventDefault();
    if (chatOpen) closeChat();
    else openChat();
  }
});

/* ---------- start / stop (called from auth.js) ---------- */
function startChat(sess) {
  chatUid = sess.uid;
  chatSid = sess.sid;
  chatStartedAt = Date.now();

  // name: this device first, then Firebase, otherwise ask
  const local = readStoredName(chatSid);
  if (local) {
    applyName(local);
  } else {
    fbDb.ref(`sessions/${chatUid}/${chatSid}/visitorName`).once('value').then(snap => {
      if (!chatSid) return;
      if (snap.val()) applyName(snap.val());
      else openNameModal();
    }).catch(() => openNameModal());
  }

  chatRef = fbDb.ref(`chat/${chatUid}/messages`).orderByChild('ts').limitToLast(CHAT_MAX);
  chatRef.on('child_added', onChatMessage);
}

function stopChat() {
  if (chatRef) chatRef.off();
  chatRef = null;
  closeChat();
  nameModal.classList.add('hidden');
  chatList.innerHTML = '';
  noticeHost.innerHTML = '';
  chatUid = null;
  chatSid = null;
  chatName = '';
}
