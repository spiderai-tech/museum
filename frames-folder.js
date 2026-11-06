/* ==========================================================
   frames-folder.js — fills frames from the media/ folder.
   - Files are named by frame number: media/frame1.jpg, frame2.mp4, ...
     (frame 1 is the first frame in the museum).
   - A frame that a visitor has changed (or that Firebase synced) keeps
     that change: the folder file never replaces it.
   - Frames with no file keep the empty placeholder.
   - Browsers block reading a folder from the disk (file://), so this
     runs only when the museum is opened from a web address.
   Plain script (no modules).
   ========================================================== */

const FRAME_FOLDER = 'media/';
const FRAME_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm'];

async function findFrameFile(n) {
  for (const ext of FRAME_EXTS) {
    const url = `${FRAME_FOLDER}frame${n}.${ext}`;
    try {
      const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (r.ok) return url;
    } catch (e) { /* not there */ }
  }
  return null;
}

// fills one frame from media/ (force: also when a visitor's record is only waiting)
async function loadFolderFrame(i, force) {
  if (location.protocol === 'file:') return;   // browsers do not allow reading the folder from disk
  const slot = slots[i];
  if (!slot || (!force && slot.touched)) return;
  const url = await findFrameFile(i + 1);
  if (!url || (!force && slot.touched)) return;
  try {
    const blob = await (await fetch(url, { cache: 'no-store' })).blob();
    if (!force && slot.touched) return;        // changed while loading
    const local = URL.createObjectURL(blob);
    if (/\.(mp4|webm)$/i.test(url)) setVideo(slot, local);
    else setPicture(slot, local);
  } catch (e) { /* keep the placeholder */ }
}

function loadFolderFrames() {
  slots.forEach((_, i) => loadFolderFrame(i));
}

loadFolderFrames();
