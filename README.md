# Museum of Fine Art

A walkable 3D museum in the browser. Visitors sign in, see each other as dots on the map, and can start a live video call that appears on a TV in the middle of the main hall.

Built with [Three.js](https://threejs.org/) (rendering) and [Firebase](https://firebase.google.com/) (sign-in, live presence, and video-call signalling). No build step is needed: it is plain HTML, CSS, and JavaScript.

## Features

- **Walkable museum** with a front door, a main hall, a Side Room, and a Media Room behind a back arch.
- **Doors open automatically** as you walk up to them.
- **Your pictures and videos** fill the empty frames. Add them from the start screen. They fill in order: main hall, then Side Room, then Media Room. Videos play muted and loop.
- **Live presence.** Everyone signed in with the same account sees each other as gold dots, updated in real time.
- **Video calls** over WebRTC, started from the ⋮ menu. The hall TV shows the live video.
- **Works on desktop and phones.** Phones get a lighter picture and simpler controls.

## Controls

| | Desktop | Phone / tablet |
|---|---|---|
| Move | W A S D or arrow keys | Arrow pad (hold to walk) |
| Run | Hold Shift | RUN button |
| Look around | Mouse | Drag the right side of the screen |
| Menu | Esc or ⋮ | ⋮ (top right) |

## Video calls

1. Sign in.
2. Open the ⋮ menu and choose **Video call**. Allow camera and microphone access when the browser asks.
3. Walk to the TV in the middle of the main hall to see the live picture.

Use the call panel's **Mic** and **Camera** buttons to switch them on and off. **Hide** closes the panel while the call keeps running. **End call** stops it. Use **Show video call** in the menu to reopen the panel.

The TV shows:

| Situation | What the TV shows |
|---|---|
| Nobody is live | "NO VIDEO CALL" message |
| Only you are live | Your own camera |
| Someone else is live, you are not | Their camera |
| You and one other person are live | The other person's camera |
| Two or more others are live | Their cameras side by side |

The call panel only lists other live visitors, never yourself.

## Project structure

```
index.html    Page layout, menus, and the start screen
style.css     All styling
world.js      The 3D building, rooms, furniture, doors, frames, and the hall TV
player.js     Movement, camera, controls, and the render loop
auth.js       Firebase config, sign-in, sessions, and presence
webrtc.js     Video calls, signalling, and the hall TV
```

## Setup

### 1. Create a Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) and create a project.
2. Turn on **Authentication** and enable the **Email/Password** and **Google** sign-in providers.
3. Turn on **Realtime Database**.
4. Register a web app and copy its config object.

### 2. Add your config

Open `auth.js` and replace the `firebaseConfig` object near the top with your own values.

### 3. Set the Realtime Database rules

In the Realtime Database **Rules** tab, keep your existing rules for `presence` and `sessions`, and add the `calls` block inside the top-level `"rules"` object:

```json
"calls": {
  "hall": {
    "people": {
      ".read": "auth != null",
      "$id": { ".write": "auth != null" }
    },
    "signals": {
      "$id": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

See **Known limitations** below before you publish these rules.

### 4. Clear test data

In the Realtime Database, delete any `calls` node and any dummy entries under `presence` and `sessions`. Visitor entries with no recent heartbeat are removed automatically after about five minutes.

### 5. Run it locally

Camera and microphone access only work on `https://` or `localhost`, so serve the folder over one of those:

```bash
cd museum-world
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Testing video calls

- Open two different browsers, or one normal window and one private window.
- Sign in on both. You can use two accounts, or the same account in both.
- In each window, choose **⋮ → Video call** and allow camera and microphone.
- Walk to the TV in the middle of the main hall.

## Configuration

| What | Where |
|---|---|
| Firebase project | `firebaseConfig` in `auth.js` |
| STUN / TURN servers | `ICE_SERVERS` in `webrtc.js` |
| Heartbeat and stale-visitor timeouts | `HEARTBEAT_MS` and `STALE_MS` in `webrtc.js` |
| Sofa and coffee table positions | `placeSofa(...)` and the coffee table call in `world.js` |
| TV position and size | `buildHallTV()` in `world.js` (`STEP` sets the distance from the middle of the hall) |

## Known limitations

- **Video is a full mesh.** Every visitor connects to every other visitor. This works well for about six people at once and gets heavy beyond that.
- **No TURN server by default.** The connection uses Google's public STUN servers only. Some networks, especially strict firewalls and some mobile connections, need a TURN server. Add one to `ICE_SERVERS`.
- **Shared hall.** Any signed-in user can join the hall, and anyone who starts a video call can be seen by all visitors in it.
- **Loose database rules.** As written above, any signed-in user can change another visitor's entry and read signalling messages, which contain network address information. Tighten the rules (for example, so that only the owner can write their own entry) before opening the site to the public.
- **Blur effects.** The video call panel and the start screen use a background blur. Remove the `backdrop-filter` rules in `style.css` if you want to turn it off.

## Browser support

Modern Chrome, Edge, Firefox, and Safari. WebGL and WebRTC must be available.

