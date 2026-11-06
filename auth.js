/* ==========================================================
   auth.js — Firebase login popup, sessions, and live presence.
   - Email/password and Google sign-in, password reset, sign-out bar.
   - Each browser tab gets its own session id (sessionStorage), saved in
     Firebase under sessions/{uid}/{sessionId}.
   - Everyone signed in with the same account sees each other as a
     gold dot, synced live under presence/{uid}/{sessionId}.
   Plain script (no modules).
   ========================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyCI2Zu4_achdDbca2sBKwgefGOjEcaUe3E",
  authDomain: "spider-ai-85323.firebaseapp.com",
  projectId: "spider-ai-85323",
  storageBucket: "spider-ai-85323.firebasestorage.app",
  messagingSenderId: "789983326385",
  appId: "1:789983326385:web:1a2e5110cbfe0e69003290",
  measurementId: "G-G84FXM1STC",
  databaseURL: "https://spider-ai-85323-default-rtdb.firebaseio.com"
};

firebase.initializeApp(firebaseConfig);
const fbAuth = firebase.auth();
const fbDb = firebase.database();

/* ---------- login popup UI ---------- */
const authEl = document.getElementById('auth');
const authForm = document.getElementById('auth-form');
const emailInput = document.getElementById('auth-email');
const passInput = document.getElementById('auth-pass');
const submitBtn = document.getElementById('auth-submit');
const googleBtn = document.getElementById('auth-google');
const resetBtn = document.getElementById('auth-reset');
const errorEl = document.getElementById('auth-error');
const titleEl = document.getElementById('auth-title');
const subEl = document.getElementById('auth-sub');
const tabBtns = document.querySelectorAll('.auth-tab');
const userbar = document.getElementById('userbar');
const userEmailEl = document.getElementById('user-email');
const signOutBtn = document.getElementById('signout');

let authMode = 'signin';

const COPY = {
  signin: { title: 'Welcome back', sub: 'Sign in to walk through the galleries', button: 'Sign in' },
  signup: { title: 'Join the museum', sub: 'Create an account to enter the galleries', button: 'Create account' }
};

const ERRORS = {
  'auth/invalid-email': 'That email address does not look right.',
  'auth/missing-email': 'Please type your email first.',
  'auth/user-not-found': 'No account found with this email.',
  'auth/wrong-password': 'Wrong password. Please try again.',
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/invalid-login-credentials': 'Email or password is incorrect.',
  'auth/email-already-in-use': 'An account already exists with this email.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment.',
  'auth/network-request-failed': 'No internet connection.',
  'auth/popup-closed-by-user': 'The Google window was closed before sign-in finished.',
  'auth/unauthorized-domain': 'Google sign-in is not allowed from this address yet. Open the site from localhost or your Firebase domain.',
  'auth/operation-not-allowed': 'This sign-in method is not turned on in the Firebase console.'
};

function friendlyError(err) {
  return ERRORS[err.code] || 'Something went wrong. Please try again.';
}

function showMessage(msg, ok = false) {
  errorEl.textContent = msg;
  errorEl.classList.toggle('show', !!msg);
  errorEl.classList.toggle('ok', ok);
}

function setBusy(busy) {
  submitBtn.disabled = busy;
  googleBtn.disabled = busy;
  submitBtn.classList.toggle('loading', busy);
  googleBtn.classList.toggle('loading', busy);
}

function setMode(mode) {
  authMode = mode;
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  titleEl.textContent = COPY[mode].title;
  subEl.textContent = COPY[mode].sub;
  submitBtn.textContent = COPY[mode].button;
  passInput.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  showMessage('');
}

tabBtns.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

authForm.addEventListener('submit', async e => {
  e.preventDefault();
  const email = emailInput.value.trim();
  const pass = passInput.value;
  if (!email) { showMessage(ERRORS['auth/missing-email']); return; }
  if (!pass) { showMessage('Please type your password.'); return; }

  setBusy(true);
  showMessage('');
  try {
    if (authMode === 'signup') await fbAuth.createUserWithEmailAndPassword(email, pass);
    else await fbAuth.signInWithEmailAndPassword(email, pass);
    authForm.reset();
  } catch (err) {
    showMessage(friendlyError(err));
  } finally {
    setBusy(false);
  }
});

googleBtn.addEventListener('click', async () => {
  setBusy(true);
  showMessage('');
  try {
    await fbAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  } catch (err) {
    showMessage(friendlyError(err));
  } finally {
    setBusy(false);
  }
});

resetBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  if (!email) { showMessage('Type your email above first, then press Forgot password.'); return; }
  try {
    await fbAuth.sendPasswordResetEmail(email);
    showMessage('Password reset email sent. Please check your inbox.', true);
  } catch (err) {
    showMessage(friendlyError(err));
  }
});

signOutBtn.addEventListener('click', () => fbAuth.signOut());

/* ---------- sessions ---------- */
// session = { uid, sid, name } for the person currently signed in
let session = null;
let presenceRef = null;
let presenceAllRef = null;

function newSessionId() {
  return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// reuse the saved session id for this account, otherwise make one
function getSessionId(uid) {
  try {
    const saved = JSON.parse(sessionStorage.getItem('museumSession') || 'null');
    if (saved && saved.uid === uid && saved.sid) return { sid: saved.sid, isNew: false };
  } catch (e) {}
  const sid = newSessionId();
  try { sessionStorage.setItem('museumSession', JSON.stringify({ uid, sid })); } catch (e) {}
  return { sid, isNew: true };
}

function clearSavedSession() {
  try { sessionStorage.removeItem('museumSession'); } catch (e) {}
}

/* ---------- other people (characters, see character.js) ---------- */
const remotes = {}; // sid -> { ch, group, tx, tz, dir, speed, name }

function upsertRemote(sid, data) {
  if (!session || sid === session.sid || !data) return;
  let r = remotes[sid];
  if (!r) {
    const ch = makeCharacter(data.name);
    ch.group.position.set(data.x || 0, 0, data.z || 0);
    scene.add(ch.group);
    r = remotes[sid] = {
      ch,
      group: ch.group,
      tx: ch.group.position.x,
      tz: ch.group.position.z,
      dir: data.dir || 0,
      speed: 0,
      name: data.name
    };
  }
  if (typeof data.x === 'number') r.tx = data.x;
  if (typeof data.z === 'number') r.tz = data.z;
  if (typeof data.dir === 'number') r.dir = data.dir;
  if (data.name && data.name !== r.name) {
    // the visitor changed their name: swap the name tag over their head
    const oldTag = r.group.children.find(c => c.isSprite && c.userData.kind !== 'bubble');
    if (oldTag) r.group.remove(oldTag);
    r.group.add(makeNameTag(data.name));
    r.name = data.name;
  }
}

function removeRemote(sid) {
  const r = remotes[sid];
  if (!r) return;
  scene.remove(r.group);
  delete remotes[sid];
}

function clearRemotes() {
  Object.keys(remotes).forEach(removeRemote);
}

// move each character smoothly to its synced position, turn it to face
// where they look, and swing its legs while it moves
function updateRemotes(dt) {
  const k = Math.min(1, dt * 10);
  for (const r of Object.values(remotes)) {
    const g = r.group;
    const px = g.position.x, pz = g.position.z;
    g.position.x += (r.tx - px) * k;
    g.position.z += (r.tz - pz) * k;

    const moved = Math.hypot(g.position.x - px, g.position.z - pz);
    const speed = dt > 0 ? moved / dt : 0;
    r.speed += (speed - r.speed) * Math.min(1, dt * 8);

    let turn = r.dir - g.rotation.y;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));   // shortest way round
    g.rotation.y += turn * Math.min(1, dt * 8);

    r.ch.animate(dt, r.speed);
  }

  // keep visitors from standing inside each other: push overlapping pairs apart
  const list = Object.values(remotes);
  const MIN_GAP = 1.0;   // metres between two visitors
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i].group.position, b = list[j].group.position;
      let dx = b.x - a.x, dz = b.z - a.z;
      let d = Math.hypot(dx, dz);
      if (d >= MIN_GAP) continue;
      if (d < 0.001) { dx = 1; dz = 0; d = 1; }   // same spot: split them sideways
      const push = (MIN_GAP - d) / 2;
      const ux = dx / d, uz = dz / d;
      a.x -= ux * push; a.z -= uz * push;
      b.x += ux * push; b.z += uz * push;
    }
  }
}

/* ---------- live position sync ---------- */
let lastSendAt = 0;
let lastSent = { x: NaN, z: NaN, dir: NaN };

// called every frame; writes only when position or direction changed,
// at most 10 times a second. update() changes only x, z, dir, so the
// name and id already in the database stay as they are.
function syncMyPosition(now) {
  if (!session || !presenceRef) return;
  if (now - lastSendAt < 100) return;
  const x = +camera.position.x.toFixed(2);
  const z = +camera.position.z.toFixed(2);
  const dir = +yaw.toFixed(3);
  if (x === lastSent.x && z === lastSent.z && dir === lastSent.dir) return;
  lastSendAt = now;
  lastSent = { x, z, dir };
  presenceRef.update({ x, z, dir });
}

async function startSession(user) {
  const { sid, isNew } = getSessionId(user.uid);
  const name = user.displayName || (user.email || 'Visitor').split('@')[0];
  session = { uid: user.uid, sid, name };

  // save the session id in Firebase too
  try {
    const sessionRef = fbDb.ref(`sessions/${user.uid}/${sid}`);
    const data = { name, lastLogin: firebase.database.ServerValue.TIMESTAMP };
    if (isNew) data.createdAt = firebase.database.ServerValue.TIMESTAMP;
    await sessionRef.update(data);
  } catch (e) { console.warn('session save failed', e); }

  // this person's live position, removed automatically when they leave
  presenceRef = fbDb.ref(`presence/${user.uid}/${sid}`);
  presenceRef.onDisconnect().remove();
  presenceRef.set({
    id: sid,
    name,
    x: +camera.position.x.toFixed(2),
    z: +camera.position.z.toFixed(2),
    dir: +yaw.toFixed(3)
  });
  lastSent = { x: NaN, z: NaN, dir: NaN };

  joinHall(session);     // video-call hall (webrtc.js)
  startChat(session);    // chat and visitor name (chat.js)
  startShare(session);   // photos and videos shared live (share.js)

  // watch everyone else signed in with this account
  presenceAllRef = fbDb.ref(`presence/${user.uid}`);
  presenceAllRef.on('child_added', snap => upsertRemote(snap.key, snap.val()));
  presenceAllRef.on('child_changed', snap => upsertRemote(snap.key, snap.val()));
  presenceAllRef.on('child_removed', snap => removeRemote(snap.key));
}

function stopSession() {
  stopChat();            // chat and notifications (chat.js)
  stopShare();           // photos and videos (share.js)
  leaveHall();           // leave the video-call hall (webrtc.js)
  if (presenceAllRef) presenceAllRef.off();
  if (presenceRef) presenceRef.remove();
  presenceAllRef = null;
  presenceRef = null;
  clearRemotes();
  session = null;
  clearSavedSession();
}

/* ---------- show the popup or the museum bar ---------- */
fbAuth.onAuthStateChanged(user => {
  if (session && (!user || session.uid !== user.uid)) stopSession();

  const signedIn = !!user;
  authEl.classList.toggle('hidden', signedIn);
  userbar.classList.toggle('hidden', !signedIn);
  if (signedIn) {
    userEmailEl.textContent = user.email || 'Signed in';
    authForm.reset();
    showMessage('');
    if (!session) startSession(user);
  }
});

// sign out of Firebase; the auth listener below then ends the session
signOutBtn.addEventListener('click', () => {
  fbAuth.signOut();
});

// Firebase removes a visitor's presence when the connection drops (phone asleep, network change).
// When the connection is back, put this visitor in the museum and in the call hall again.
fbDb.ref('.info/connected').on('value', snap => {
  if (snap.val() !== true || !session || !presenceRef) return;
  presenceRef.onDisconnect().remove();
  presenceRef.update({
    id: session.sid,
    name: session.name,
    x: +camera.position.x.toFixed(2),
    z: +camera.position.z.toFixed(2),
    dir: +yaw.toFixed(3)
  });
  if (hallCall.myRef) {
    hallCall.myRef.onDisconnect().remove();
    hallCall.myRef.update({
      uid: session.uid,
      name: session.name,
      live: hallCall.live === true,
      heartbeat: firebase.database.ServerValue.TIMESTAMP
    });
  }
});
