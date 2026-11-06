/* ==========================================================
   character.js — the figure other visitors appear as.
   makeCharacter(name) returns:
     group    the THREE.Group to place in the scene (feet at y = 0)
     animate(dt, speed)  swings arms and legs while walking
   The figure faces its local -z direction, the same way the
   camera looks when yaw = 0, so rotation.y = yaw turns it right.
   Plain script (no modules).
   ========================================================== */

const CHARACTER_SHIRTS = [0x2f6f9f, 0x8a3b3b, 0x3f7d4e, 0x7a5a9e, 0xb0792c, 0x2c6a6a, 0x9b4f7a];

// the same name always gets the same shirt colour
function characterShirt(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CHARACTER_SHIRTS[h % CHARACTER_SHIRTS.length];
}

// name tag floating above the head
function makeNameTag(text) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10, 12, 18, 0.72)';
  g.fillRect(0, 16, 512, 96);
  g.fillStyle = '#e6c26e';
  g.fillRect(0, 16, 512, 4);
  g.font = 'bold 54px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f4efe6';
  g.fillText(String(text || 'Visitor').slice(0, 16), 256, 66);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.5, 0.375, 1);
  sprite.position.y = 2.15;
  return sprite;
}

function makeCharacter(name) {
  const group = new THREE.Group();

  const shirt = new THREE.MeshStandardMaterial({ color: characterShirt(name), roughness: 0.7 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0b08a, roughness: 0.6 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.9 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5 });
  const eye = new THREE.MeshBasicMaterial({ color: 0x111111 });

  const part = (geo, mat, x, y, z, parent) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // torso
  part(new THREE.CylinderGeometry(0.25, 0.2, 0.6, 16), shirt, 0, 1.2, 0, group);
  part(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 16), pants, 0, 0.88, 0, group);

  // head (front of the face is -z)
  const head = new THREE.Group();
  head.position.set(0, 1.6, 0);
  group.add(head);
  part(new THREE.SphereGeometry(0.2, 20, 16), skin, 0, 0, 0, head);
  part(new THREE.SphereGeometry(0.212, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.02, 0, head);
  part(new THREE.SphereGeometry(0.03, 8, 6), eye, -0.07, 0.02, -0.18, head);
  part(new THREE.SphereGeometry(0.03, 8, 6), eye, 0.07, 0.02, -0.18, head);

  // arms: each one swings from its shoulder
  const makeLimb = (x, y, lengthBody, mat, endGeo, endY, parentGroup) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    parentGroup.add(pivot);
    part(lengthBody, mat, 0, -0.25, 0, pivot);
    part(endGeo, mat, 0, endY, 0, pivot);
    return pivot;
  };
  const armL = makeLimb(-0.33, 1.45, new THREE.CylinderGeometry(0.075, 0.065, 0.5, 10), shirt,
    new THREE.SphereGeometry(0.075, 10, 8), -0.52, group);
  const armR = makeLimb(0.33, 1.45, new THREE.CylinderGeometry(0.075, 0.065, 0.5, 10), shirt,
    new THREE.SphereGeometry(0.075, 10, 8), -0.52, group);
  // hands are skin-coloured
  armL.children[1].material = skin;
  armR.children[1].material = skin;

  // legs: each one swings from its hip
  const makeLeg = x => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.9, 0);
    group.add(pivot);
    part(new THREE.CylinderGeometry(0.1, 0.085, 0.8, 12), pants, 0, -0.4, 0, pivot);
    part(new THREE.BoxGeometry(0.16, 0.1, 0.3), shoe, 0, -0.85, -0.05, pivot);
    return pivot;
  };
  const legL = makeLeg(-0.11);
  const legR = makeLeg(0.11);

  group.add(makeNameTag(name));

  let phase = 0;
  function animate(dt, speed) {
    // the faster they move, the bigger the swing; standing still settles to rest
    const amount = Math.min(0.7, speed * 0.13);
    phase += dt * (speed * 2.2);
    const swing = Math.sin(phase) * amount;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = -swing * 0.8;
    armR.rotation.x = swing * 0.8;
  }

  return { group, animate };
}
