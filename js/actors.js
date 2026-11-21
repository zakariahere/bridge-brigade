// Draws everything that moves. The game simulation (game.js) owns plain data; this file turns
// that data into pixels each frame and never changes gameplay state. Purely cosmetic things
// (particles, shockwave rings, bodies knocked flying) live here because the rules never read them.
//
// Colours written as setRGB(...) with values above 1.0 are deliberate: the scene is rendered in
// HDR and anything brighter than 1.0 picks up bloom (see post.js).
(function (BB) {
  'use strict';

  const CFG = BB.CFG;
  const A = BB.Actors = {};
  const LIVE = CFG.MAX_VISUAL, SOLDIER_CAP = LIVE + 40;
  const ENEMY_CAP = 780, CORPSE_CAP = 150, BULLET_CAP = 700, PART_CAP = 760, RING_CAP = 48;
  const BLOAT_CAP = 160, COIN_CAP = 90, FB_CAP = 8, DRONES = 3;
  const BOSS_SCALE = 2.3, ALLY_SCALE = 1.9;

  let scene, group, time = 0;
  const S = {}, E = {}, FX = {};
  let bossK, allyK, slamZone, bossPal = null, dome = null, domeK = 0, iceK = 0, fwT = 0, fwN = 0;
  let beamCore, beamShell, mouthOrb, hitOrb;
  const droneViews = [];
  const parts = [], rings = [], corpses = [], dying = [], liveCrates = [], coinsFx = [];
  const v3a = new THREE.Vector3();

  // Bullets change colour as the squad powers up: stock green -> cyan -> gold -> magenta.
  const BULLET_RAMP = [
    { core: [1.9, 2.4, 1.5], glow: [0.2, 1.1, 0.2] },
    { core: [1.4, 2.4, 2.7], glow: [0.15, 0.85, 1.25] },
    { core: [2.8, 2.2, 0.9], glow: [1.25, 0.8, 0.12] },
    { core: [2.9, 1.5, 2.8], glow: [1.2, 0.25, 1.15] }
  ];
  const MULTI_POWER = [1, 1.5, 1.95];
  const FW_COLORS = [0xff5a7a, 0x5ad1ff, 0xffe066, 0x8dff7a, 0xc98bff, 0xffa24a];
  let gateCull = 0, crateCull = 0;
  let unitPlane, postGeo, barrelGeo, bandGeo, cageGeo, postGood, postBad, bandMat, capMat, cageTex = null;
  const gateMats = {};
  let TYPE_COL = [];

  const EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  const HEAVY = '"Arial Black", "Segoe UI Black", Impact, sans-serif';

  const CRATE = {
    rate:   { icon: '🔫', color: 0x3d7be0 },
    dmg:    { icon: '💥', color: 0xe07a2d },
    multi:  { icon: '✨', color: 0x9b5de5 },
    troops: { icon: '🪖', color: 0x3fae5a },
    coins:  { icon: '💰', color: 0xe0b12d },
    nuke:   { icon: '💣', color: 0xc9302c },
    kaiju:  { icon: '🦖', color: 0xf2f2f2 },
    drone:  { icon: '🚁', color: 0x1fb5a8 },
    freeze: { icon: '❄️', color: 0x8fdcff },
    shield: { icon: '🛡️', color: 0x7a6cf0 }
  };

  // ---------- instancing helpers ----------

  // Writes one instance transform: uniform scale, rotation about X, then translation.
  function put(mesh, i, x, y, z, rx, sc) {
    const a = mesh.instanceMatrix.array, o = i * 16;
    const c = Math.cos(rx) * sc, s = Math.sin(rx) * sc;
    a[o] = sc;     a[o + 1] = 0;  a[o + 2] = 0;   a[o + 3] = 0;
    a[o + 4] = 0;  a[o + 5] = c;  a[o + 6] = s;   a[o + 7] = 0;
    a[o + 8] = 0;  a[o + 9] = -s; a[o + 10] = c;  a[o + 11] = 0;
    a[o + 12] = x; a[o + 13] = y; a[o + 14] = z;  a[o + 15] = 1;
  }

  // One body part of a figure standing at (x, y, z) whose whole body is tipped by `rot` about the
  // X axis through its feet. (ox, oy, oz) is where the part sits on an upright body; tipping the
  // body swings that offset round with it, which is all a "ragdoll" needs here. cr/sr = cos/sin(rot).
  function limb(mesh, i, x, y, z, sc, cr, sr, rot, ox, oy, oz, rx) {
    put(mesh, i, x + ox * sc, y + (oy * cr - oz * sr) * sc, z + (oy * sr + oz * cr) * sc, rot + rx, sc);
  }

  function commit(mesh, n) {
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function inst(geo, mat, cap, shadow, colored) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;   // instances are spread far beyond the base geometry's bounds
    m.castShadow = !!shadow;
    if (colored) {
      const white = new THREE.Color(1, 1, 1);
      for (let i = 0; i < cap; i++) m.setColorAt(i, white);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    m.count = 0;
    scene.add(m);
    return m;
  }

  function rgb(hex) { return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255]; }
  function frac(x) { return x - Math.floor(x); }
  function hdr(mat, r, g, b) { mat.color.setRGB(r, g, b); return mat; }

  function easeOutBack(t) {
    const c1 = 1.70158, c3 = c1 + 1, u = t - 1;
    return 1 + c3 * u * u * u + c1 * u * u;
  }

  function roundRect(x, l, t, w, h, r) {
    x.beginPath();
    x.moveTo(l + r, t);
    x.arcTo(l + w, t, l + w, t + h, r);
    x.arcTo(l + w, t + h, l, t + h, r);
    x.arcTo(l, t + h, l, t, r);
    x.arcTo(l, t, l + w, t, r);
    x.closePath();
  }

  // ---------- kaiju (boss + caged ally share one model) ----------

  function makeKaiju(pal) {
    const g = new THREE.Group();
    const flat = function (color) { return new THREE.MeshPhongMaterial({ color: color, flatShading: true, shininess: 8 }); };
    const body = flat(pal.body), belly = flat(pal.belly), spike = flat(pal.spike), bone = flat(0xf3efe2);
    spike.emissive.setRGB(pal.glow[0], pal.glow[1], pal.glow[2]);
    const eye = hdr(new THREE.MeshBasicMaterial(), pal.eye[0], pal.eye[1], pal.eye[2]);
    const mk = function (geo, mat, x, y, z, parent) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      (parent || g).add(m);
      return m;
    };

    mk(new THREE.SphereGeometry(1, 9, 7), body, 0, 2.05, 0).scale.set(1.05, 1.3, 0.95);
    mk(new THREE.SphereGeometry(0.8, 8, 6), belly, 0, 1.9, 0.38).scale.set(0.95, 1.2, 0.75);

    const head = new THREE.Group();
    head.position.set(0, 3.25, 0.45);
    g.add(head);
    mk(new THREE.SphereGeometry(0.62, 8, 6), body, 0, 0, 0, head).scale.set(0.95, 0.85, 1.25);
    mk(new THREE.BoxGeometry(0.7, 0.34, 0.7), body, 0, -0.02, 0.62, head);
    const jaw = mk(new THREE.BoxGeometry(0.62, 0.16, 0.66), belly, 0, -0.3, 0.55, head);
    mk(new THREE.SphereGeometry(0.11, 6, 5), eye, -0.3, 0.2, 0.56, head);
    mk(new THREE.SphereGeometry(0.11, 6, 5), eye, 0.3, 0.2, 0.56, head);
    const toothGeo = new THREE.ConeGeometry(0.05, 0.16, 4).rotateX(Math.PI);    // points down from the upper jaw
    for (let i = 0; i < 5; i++) mk(toothGeo, bone, -0.26 + i * 0.13, -0.24, 0.93, head);

    const legGeo = new THREE.CylinderGeometry(0.42, 0.5, 1.3, 7).translate(0, -0.65, 0);
    const footGeo = new THREE.BoxGeometry(0.75, 0.3, 1.05);
    const clawGeo = new THREE.ConeGeometry(0.07, 0.3, 4).rotateX(Math.PI / 2);  // points forward
    const legL = mk(legGeo, body, -0.62, 1.3, 0), legR = mk(legGeo, body, 0.62, 1.3, 0);
    [legL, legR].forEach(function (leg) {
      mk(footGeo, body, 0, -1.16, 0.22, leg);
      for (let i = -1; i <= 1; i++) mk(clawGeo, bone, i * 0.24, -1.22, 0.86, leg);
    });

    const armGeo = new THREE.CylinderGeometry(0.16, 0.2, 0.9, 6).translate(0, -0.45, 0);
    const handClaw = new THREE.ConeGeometry(0.05, 0.24, 4).rotateX(Math.PI);
    const armL = mk(armGeo, body, -0.98, 2.65, 0.3), armR = mk(armGeo, body, 0.98, 2.65, 0.3);
    [armL, armR].forEach(function (arm) {
      for (let i = -1; i <= 1; i++) mk(handClaw, bone, i * 0.1, -0.98, 0, arm);
    });

    const tail = [];
    let tz = -0.85, ty = 1.5, r = 0.55;
    for (let i = 0; i < 5; i++) {
      const seg = mk(new THREE.SphereGeometry(r, 7, 5), body, 0, ty, tz);
      seg.scale.z = 1.5;
      tail.push(seg);
      tz -= r * 1.5;
      ty = Math.max(0.3, ty - 0.3);
      r *= 0.78;
    }

    // dorsal plates: walk an arc from the nape down the back, tilting each plate to stand off the body
    for (let i = 0; i < 7; i++) {
      const t = i / 6, phi = 0.25 + t * 1.75, big = Math.sin(Math.PI * (0.15 + t * 0.8));
      const sp = mk(new THREE.ConeGeometry(0.16 + 0.14 * big, 0.45 + 0.6 * big, 4), spike,
        0, 2.05 + Math.cos(phi) * 1.42, -Math.sin(phi) * 1.02);
      sp.rotation.x = -phi;
    }
    mk(new THREE.ConeGeometry(0.14, 0.4, 4), spike, 0, 0.6, -0.1, head).rotation.x = -0.5;

    g.visible = false;
    scene.add(g);
    return { group: g, head: head, jaw: jaw, legL: legL, legR: legR, armL: armL, armR: armR, tail: tail, body: body, belly: belly, spike: spike, eye: eye, bob: 0 };
  }

  // Every biome has its own boss: same skeleton, different hide, plates and eyes.
  function paintKaiju(k, pal) {
    k.body.color.setHex(pal.body);
    k.belly.color.setHex(pal.belly);
    k.spike.color.setHex(pal.spike);
    k.spike.emissive.setRGB(pal.glow[0], pal.glow[1], pal.glow[2]);
    k.eye.color.setRGB(pal.eye[0], pal.eye[1], pal.eye[2]);
  }

  // A gunship drone: boxy body, four spinning rotors, a gun slung underneath.
  function makeDrone() {
    const g = new THREE.Group();
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a3340 }), trim = new THREE.MeshLambertMaterial({ color: 0x1fb5a8 });
    const mk = function (geo, mat, x, y, z) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    mk(new THREE.BoxGeometry(0.62, 0.24, 0.95), dark, 0, 0, 0).castShadow = true;
    mk(new THREE.BoxGeometry(0.66, 0.08, 0.5), trim, 0, 0.14, 0.1);
    mk(new THREE.SphereGeometry(0.19, 8, 6), hdr(new THREE.MeshBasicMaterial(), 0.5, 2.2, 2.6), 0, 0.05, -0.42);   // cockpit glass
    mk(new THREE.BoxGeometry(0.1, 0.1, 0.62), dark, 0, -0.19, -0.3);                                              // the gun
    const armGeo = new THREE.BoxGeometry(1.7, 0.06, 0.1), bladeGeo = new THREE.BoxGeometry(0.78, 0.02, 0.08);
    const discGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.015, 14);
    const discMat = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.16, depthWrite: false });
    mk(armGeo, dark, 0, 0.06, 0).rotation.y = Math.PI / 4;
    mk(armGeo, dark, 0, 0.06, 0).rotation.y = -Math.PI / 4;
    const rotors = [];
    for (let i = 0; i < 4; i++) {
      const x = (i % 2 ? 1 : -1) * 0.6, z = (i < 2 ? 1 : -1) * 0.6;
      rotors.push(mk(bladeGeo, dark, x, 0.14, z));
      mk(discGeo, discMat, x, 0.15, z);   // a faint disc sells the blur of the blades
    }
    const lamp = mk(new THREE.SphereGeometry(0.07, 6, 4), hdr(new THREE.MeshBasicMaterial(), 3.2, 0.4, 0.25), 0, 0.2, 0.46);
    const flash = mk(new THREE.OctahedronGeometry(0.2, 0).scale(1, 1, 2.6), hdr(new THREE.MeshBasicMaterial({ fog: false }), 3.2, 2.4, 0.9), 0, -0.19, -0.78);
    g.visible = false;
    scene.add(g);
    return { g: g, rotors: rotors, lamp: lamp, flash: flash };
  }

  // The energy shield: a dome whose rim glows (Fresnel) with bands of light climbing up it.
  function makeDome() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uHit: { value: 0 } },
      vertexShader: [
        'varying vec3 vN; varying vec3 vV; varying float vY;',
        'void main() {',
        '  vec4 wp = modelMatrix * vec4(position, 1.0);',
        '  vN = normalize(mat3(modelMatrix) * normal);',
        '  vV = normalize(cameraPosition - wp.xyz);',
        '  vY = position.y;',
        '  gl_Position = projectionMatrix * viewMatrix * wp;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float uTime; uniform float uHit;',
        'varying vec3 vN; varying vec3 vV; varying float vY;',
        'void main() {',
        '  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.2);',
        '  float bands = smoothstep(0.75, 1.0, sin(vY * 30.0 - uTime * 3.5));',
        '  float a = rim * 0.62 + 0.035 + bands * 0.06 + uHit * 0.55;',
        '  gl_FragColor = vec4(mix(vec3(0.35, 0.95, 1.5), vec3(1.6, 1.7, 1.9), uHit) * a, 1.0);',
        '}'
      ].join('\n'),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    m.visible = false;
    m.renderOrder = 4;
    scene.add(m);
    return m;
  }

  function animKaiju(k, t, walk, roar) {
    const s = Math.sin(t * 4.5);
    k.legL.rotation.x = s * 0.5 * walk;
    k.legR.rotation.x = -s * 0.5 * walk;
    k.armL.rotation.x = -1.0 + s * 0.25 * walk - roar * 0.6;
    k.armR.rotation.x = -1.0 - s * 0.25 * walk - roar * 0.6;
    k.bob = Math.abs(Math.cos(t * 4.5)) * 0.1 * walk;
    for (let i = 0; i < k.tail.length; i++) k.tail[i].position.x = Math.sin(t * 2.6 - i * 0.7) * 0.11 * (i + 1);
    k.head.rotation.x = -roar * 0.35 + Math.sin(t * 1.7) * 0.04;
    k.jaw.rotation.x = roar * 0.5;
    k.group.rotation.z = s * 0.035 * walk;
    k.spike.emissiveIntensity = 0.75 + 0.3 * Math.sin(t * 3) + roar * 1.3;   // the plates pulse, and flare when it roars
  }

  // ---------- gates ----------

  function gateLabel(g) {
    if (g.op === 'mul') return g.value >= 1 ? '×' + g.value : '÷' + Math.round(1 / g.value);
    return (g.value >= 0 ? '+' : '−') + Math.abs(g.value);
  }
  function gateGood(g) { return g.op === 'mul' ? g.value >= 1 : g.value >= 0; }

  // Gate faces are canvas textures, cached per label so twenty "+1" gates share one material.
  function gateMaterial(label, good, shootable) {
    const key = label + (good ? '|g' : '|b') + (shootable ? '|s' : '');
    if (gateMats[key]) return gateMats[key];
    const c = document.createElement('canvas');
    c.width = 256; c.height = 160;
    const x = c.getContext('2d');
    const grd = x.createLinearGradient(0, 0, 0, 160);
    if (good) { grd.addColorStop(0, 'rgba(80,170,255,0.82)'); grd.addColorStop(1, 'rgba(30,100,240,0.55)'); }
    else      { grd.addColorStop(0, 'rgba(255,95,95,0.84)');  grd.addColorStop(1, 'rgba(215,40,60,0.58)'); }
    x.fillStyle = grd;
    x.fillRect(0, 0, 256, 160);
    x.lineWidth = 8;
    x.strokeStyle = good ? 'rgba(205,235,255,0.95)' : 'rgba(255,212,212,0.95)';
    x.strokeRect(4, 4, 248, 152);
    const ty = shootable ? 70 : 84;
    x.font = '900 104px ' + HEAVY;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineJoin = 'round';
    x.lineWidth = 12;
    x.strokeStyle = good ? '#0b3fa8' : '#8a0f1f';
    x.strokeText(label, 128, ty, 228);
    x.fillStyle = '#fff';
    x.fillText(label, 128, ty, 228);
    if (shootable) {
      x.font = '900 21px ' + HEAVY;
      x.lineWidth = 5;
      x.strokeText('▲ SHOOT TO BOOST ▲', 128, 136, 236);
      x.fillStyle = '#fff59d';
      x.fillText('▲ SHOOT TO BOOST ▲', 128, 136, 236);
    }
    const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    hdr(mat, 1.22, 1.22, 1.22);   // slightly over-bright, so the numbers and frame glow like a hologram
    gateMats[key] = mat;
    return mat;
  }

  function addGate(g) {
    const w = g.x1 - g.x0 - (g.slim ? 0.5 : 0.75), h = g.slim ? 2.5 : 3.3;
    const good = gateGood(g);
    const grp = new THREE.Group();
    const panel = new THREE.Mesh(unitPlane, gateMaterial(gateLabel(g), good, g.shootable));
    panel.scale.set(w, h, 1);
    panel.position.y = h / 2 + 0.12;
    panel.renderOrder = 2;
    grp.add(panel);
    let posts = null;
    if (!g.slim) {
      posts = [-1, 1].map(function (sx) {
        const p = new THREE.Mesh(postGeo, good ? postGood : postBad);
        p.scale.set(1, h + 0.5, 1);
        p.position.set(sx * (w / 2 + 0.17), (h + 0.5) / 2, 0);
        p.castShadow = true;
        grp.add(p);
        return p;
      });
    }
    grp.position.set((g.x0 + g.x1) / 2, 0, -g.d);
    group.add(grp);
    g.view = { grp: grp, panel: panel, posts: posts, t: 0 };
  }

  // A sliding gate changes width every frame: stretch the pane and walk the posts along with it.
  function layoutGate(g) {
    const v = g.view, w = Math.max(0.6, g.x1 - g.x0 - 0.75);
    v.grp.position.x = (g.x0 + g.x1) / 2;
    v.panel.scale.x = w;
    if (v.posts) { v.posts[0].position.x = -(w / 2 + 0.17); v.posts[1].position.x = w / 2 + 0.17; }
  }

  // Called when shooting a gate changed its number (and possibly flipped it from red to blue).
  A.refreshGate = function (g) {
    const v = g.view;
    if (!v) return;
    const good = gateGood(g);
    v.panel.material = gateMaterial(gateLabel(g), good, g.shootable);
    if (v.posts) v.posts.forEach(function (p) { p.material = good ? postGood : postBad; });
  };

  // The squad ran through it: the pane bursts into shards and the frame squashes away.
  A.consumeGate = function (g) {
    if (!g.view) return;
    g.view.t = 0.2;
    dying.push(g);
    const hex = gateGood(g) ? 0x6ab8ff : 0xff6a6a, n = g.slim ? 3 : 5;
    for (let k = 0; k < n; k++) A.burst(g.x0 + (g.x1 - g.x0) * (k + 0.5) / n, 1.6, -g.d, hex, 3, 6, 1.1, 1.7);
  };

  // ---------- barrels / cages ----------

  function cageTexture() {
    if (cageTex) return cageTex;
    const c = document.createElement('canvas');
    c.width = 640; c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#f4f1e8';
    x.fillRect(0, 0, 640, 256);
    x.fillStyle = 'rgba(0,0,0,0.07)';
    for (let i = 0; i < 16; i++) x.fillRect(i * 40, 0, 5, 256);
    x.fillStyle = '#2b3448';
    x.fillRect(0, 0, 640, 20);
    x.fillRect(0, 236, 640, 20);
    x.font = '168px ' + EMOJI;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#333';
    [0, 320, 640].forEach(function (px) { x.fillText('🦖', px, 134); });
    cageTex = new THREE.CanvasTexture(c);
    cageTex.wrapS = THREE.RepeatWrapping;
    cageTex.offset.x = 0.5;   // a cylinder's UV seam faces the camera, so slide a dino onto it
    return cageTex;
  }

  function drawCrateLabel(c) {
    const v = c.view, txt = BB.fmt(Math.max(1, Math.ceil(c.hp)));
    if (txt === v.txt) return;
    v.txt = txt;
    const x = v.ctx;
    x.clearRect(0, 0, 256, 128);
    x.fillStyle = 'rgba(10,16,48,0.84)';
    roundRect(x, 6, 22, 244, 84, 30);
    x.fill();
    x.lineWidth = 6;
    x.strokeStyle = '#fff';
    x.stroke();
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#fff';
    x.font = '56px ' + EMOJI;
    x.fillText(v.icon, 58, 68);
    x.font = '900 54px ' + HEAVY;
    x.fillText(txt, 162, 67, 150);
    v.tex.needsUpdate = true;
  }

  function addCrate(c) {
    const st = CRATE[c.reward];
    const grp = new THREE.Group();
    const mats = [];
    let top;
    if (c.reward === 'kaiju') {
      const side = new THREE.MeshLambertMaterial({ map: cageTexture() });
      mats.push(side);
      const body = new THREE.Mesh(cageGeo, [side, capMat, capMat]);
      body.position.y = 1.7;
      body.castShadow = true;
      grp.add(body);
      top = 3.4;
    } else {
      const m = new THREE.MeshLambertMaterial({ color: st.color });
      mats.push(m);
      const body = new THREE.Mesh(barrelGeo, m);
      body.position.y = 0.9;
      body.castShadow = true;
      grp.add(body);
      [0.42, 1.38].forEach(function (y) {
        const band = new THREE.Mesh(bandGeo, bandMat);
        band.position.y = y;
        grp.add(band);
      });
      top = 1.8;
    }
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const tex = new THREE.CanvasTexture(cv);
    const sm = new THREE.SpriteMaterial({ map: tex, depthWrite: false });
    const sp = new THREE.Sprite(sm);
    sp.scale.set(2.7, 1.35, 1);
    sp.position.y = top + 0.95;
    sp.renderOrder = 3;
    grp.add(sp);
    grp.position.set(c.x, 0, -c.d);
    group.add(grp);
    c.view = { grp: grp, ctx: cv.getContext('2d'), tex: tex, sm: sm, mats: mats, icon: st.icon, txt: '' };
    liveCrates.push(c.view);
    drawCrateLabel(c);
  }

  function disposeCrateView(v) {
    group.remove(v.grp);
    v.tex.dispose();
    v.sm.dispose();
    v.mats.forEach(function (m) { m.dispose(); });   // the shared cage texture is deliberately kept
  }

  A.removeCrate = function (c) {
    if (!c.view) return;
    const i = liveCrates.indexOf(c.view);
    if (i >= 0) liveCrates.splice(i, 1);
    disposeCrateView(c.view);
    c.view = null;
  };

  // ---------- cosmetic effects: particles, rings, flying bodies ----------

  // boost > 1 makes the chunks over-bright (sparks, embers) so they bloom.
  A.burst = function (x, y, z, hex, n, speed, size, boost) {
    const col = rgb(hex), k = boost || 1;
    for (let i = 0; i < n; i++) {
      if (parts.length >= PART_CAP) return;
      const a = Math.random() * 6.283, h = 0.4 + Math.random() * 0.6, sp = speed * (0.4 + Math.random() * 0.8);
      parts.push({
        x: x, y: y, z: z,
        vx: Math.cos(a) * sp * h, vy: sp * (0.6 + Math.random() * 0.9), vz: Math.sin(a) * sp * h,
        life: 0, max: 0.45 + Math.random() * 0.45,
        size: (size || 1) * (0.6 + Math.random() * 0.8),
        r: col[0] * k, g: col[1] * k, b: col[2] * k, spin: 4 + Math.random() * 20, grav: 1, drag: 0
      });
    }
  };

  // A firework shell: sparks thrown out evenly over a sphere, light enough to hang in the air
  // and slowed by drag so the burst blooms and then droops.
  A.firework = function (x, y, z) {
    const col = rgb(FW_COLORS[Math.floor(Math.random() * FW_COLORS.length)]);
    for (let i = 0; i < 46; i++) {
      if (parts.length >= PART_CAP) return;
      const u = Math.random() * 2 - 1, a = Math.random() * 6.283, h = Math.sqrt(1 - u * u), sp = 9 + Math.random() * 4;
      parts.push({
        x: x, y: y, z: z, vx: Math.cos(a) * h * sp, vy: u * sp, vz: Math.sin(a) * h * sp,
        life: 0, max: 1.0 + Math.random() * 0.6, size: 2.3,
        r: col[0] * 2.1, g: col[1] * 2.1, b: col[2] * 2.1, spin: 9, grav: 0.2, drag: 2.1
      });
    }
  };

  // Victory: a big opening salvo, then the odd shell for as long as the result card is showing.
  A.celebrate = function (dt, G) {
    fwT -= dt;
    if (fwT > 0) return;
    fwT = fwN++ < 24 ? 0.14 + Math.random() * 0.3 : 0.9 + Math.random() * 1.6;
    const s = G.squad;
    A.firework(s.x + BB.rand(-10, 10), BB.rand(3.5, 9.5), -(s.d + BB.rand(6, 34)));
    BB.Audio.firework();
  };

  // Gold coins pop out of whatever just paid out, bounce once, then get hoovered up by the squad.
  A.coins = function (x, d, n) {
    for (let i = 0; i < n; i++) {
      if (coinsFx.length >= COIN_CAP) return;
      const a = Math.random() * 6.283, sp = 1.5 + Math.random() * 4.5;
      coinsFx.push({ x: x, y: 1, z: -d, vx: Math.cos(a) * sp, vy: 6 + Math.random() * 6, vz: Math.sin(a) * sp, t: -i * 0.012, spin: Math.random() * 6 });
    }
  };

  function updateCoins(G, dt) {
    const s = G.squad, tx = s.x, tz = -s.d;
    for (let i = coinsFx.length - 1; i >= 0; i--) {
      const c = coinsFx[i];
      c.t += dt;
      if (c.t < 0) continue;
      if (c.t < 0.5) {
        c.vy -= 24 * dt;
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        if (c.y < 0.25 && c.vy < 0) { c.y = 0.25; c.vy *= -0.45; }
      } else {
        const k = 1 - Math.exp(-(4 + (c.t - 0.5) * 24) * dt);   // the pull gets stronger the longer it has been flying
        c.x += (tx - c.x) * k; c.y += (1.3 - c.y) * k; c.z += (tz - c.z) * k;
        const dx = tx - c.x, dz = tz - c.z;
        if (dx * dx + dz * dz < 0.7 || c.t > 2.2) {
          coinsFx[i] = coinsFx[coinsFx.length - 1];
          coinsFx.pop();
          BB.Audio.coin();
        }
      }
    }
    const n = coinsFx.length;
    for (let i = 0; i < n; i++) {
      const c = coinsFx[i];
      put(FX.coins, i, c.x, c.y, c.z, c.spin + c.t * 11, c.t < 0 ? 0.0001 : 1);
    }
    commit(FX.coins, n);
  }

  function updateParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.max) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      p.vy -= 22 * p.grav * dt;
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.1 && p.vy < 0 && Math.abs(p.x) < 6.6) { p.y = 0.1; p.vy *= -0.4; p.vx *= 0.7; p.vz *= 0.7; }  // bounce on the deck
    }
    const pc = FX.parts.instanceColor.array, n = parts.length;
    for (let i = 0; i < n; i++) {
      const p = parts[i], o = i * 3;
      put(FX.parts, i, p.x, p.y, p.z, p.spin * p.life, p.size * (1 - p.life / p.max));
      pc[o] = p.r; pc[o + 1] = p.g; pc[o + 2] = p.b;
    }
    commit(FX.parts, n);
  }

  // A flat shockwave on the deck that grows to radius r1 and fades. It is drawn additively, so
  // "fading out" is simply its colour heading to black: no per-instance opacity needed.
  A.ring = function (x, d, r1, hex, life) {
    if (rings.length >= RING_CAP) return;
    const c = rgb(hex);
    rings.push({ x: x, d: d, r1: r1, t: 0, life: life || 0.5, r: c[0], g: c[1], b: c[2] });
  };

  function drawRings(dt) {
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].t += dt;
      if (rings[i].t >= rings[i].life) { rings[i] = rings[rings.length - 1]; rings.pop(); }
    }
    const rc = FX.rings.instanceColor.array, n = rings.length;
    for (let i = 0; i < n; i++) {
      const r = rings[i], k = r.t / r.life, grow = 1 - (1 - k) * (1 - k) * (1 - k), f = (1 - k) * (1 - k) * 1.9, o = i * 3;
      put(FX.rings, i, r.x, 0.07, -r.d, 0, 0.2 + r.r1 * grow);
      rc[o] = r.r * f; rc[o + 1] = r.g * f; rc[o + 2] = r.b * f;
    }
    commit(FX.rings, n);
  }

  // Something just died at (x, d): instead of vanishing, its body is knocked off its feet.
  // kind 0 = enemy (thrown away from the squad, falls on its back), kind 1 = soldier (thrown towards the camera).
  A.corpse = function (kind, type, x, d, phase) {
    if (corpses.length >= CORPSE_CAP) return;
    const away = kind === 0 ? 1 : -1;
    corpses.push({
      kind: kind, type: type, x: x, d: d, y: 0.05, phase: phase || 0,
      vx: BB.rand(-1.8, 1.8), vd: away * BB.rand(4, 10), vy: BB.rand(4, 8),
      rot: 0, vr: -away * BB.rand(5, 11), t: 0, life: BB.rand(0.75, 1.05)
    });
  };

  function updateCorpses(dt) {
    for (let i = corpses.length - 1; i >= 0; i--) {
      const c = corpses[i];
      c.t += dt;
      if (c.t >= c.life) { corpses[i] = corpses[corpses.length - 1]; corpses.pop(); continue; }
      c.vy -= 24 * dt;
      c.x += c.vx * dt; c.d += c.vd * dt; c.y += c.vy * dt;
      c.rot = BB.clamp(c.rot + c.vr * dt, -1.6, 1.6);          // stops once flat on its back
      if (c.y < 0.05) { c.y = 0.05; c.vy = 0; c.vd *= 0.82; c.vx *= 0.82; }   // slides to a halt
    }
  }

  // ---------- setup ----------

  A.init = function (sc) {
    scene = sc;
    group = new THREE.Group();
    scene.add(group);
    const lam = function (color) { return new THREE.MeshLambertMaterial({ color: color }); };
    const basic = function (opts) { return new THREE.MeshBasicMaterial(opts || {}); };
    const legGeo = function () { return new THREE.BoxGeometry(0.2, 0.6, 0.22).translate(0, -0.3, 0); };  // pivot at the hip

    // soldiers face up the bridge (-z), so what the camera mostly sees is helmets and backpacks
    S.legs = inst(legGeo(), lam(0x2b55c8), SOLDIER_CAP * 2, true);
    S.torso = inst(new THREE.BoxGeometry(0.52, 0.56, 0.32), lam(0xd8382e), SOLDIER_CAP, true);
    S.head = inst(new THREE.SphereGeometry(0.2, 10, 8), lam(0xf2c58e), SOLDIER_CAP, true);
    S.helmet = inst(new THREE.SphereGeometry(0.225, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), lam(0x22252e), SOLDIER_CAP, false);
    S.gun = inst(new THREE.BoxGeometry(0.1, 0.13, 0.75), lam(0x1b1d22), SOLDIER_CAP, false);
    S.arms = inst(new THREE.BoxGeometry(0.13, 0.13, 0.46).translate(0, 0, -0.2), lam(0xd8382e), SOLDIER_CAP * 2, false);
    S.pack = inst(new THREE.BoxGeometry(0.36, 0.4, 0.17), lam(0x4a5a2e), SOLDIER_CAP, false);
    S.ring = inst(new THREE.RingGeometry(0.36, 0.48, 24).rotateX(-Math.PI / 2),
      hdr(basic({ transparent: true, opacity: 0.85, depthWrite: false }), 0.42, 1.45, 0.36), LIVE, false);

    // enemies face the camera (+z); per-instance colour tints each type and drives the hit flash
    E.legs = inst(legGeo(), lam(0x33343f), ENEMY_CAP * 2, true);
    E.torso = inst(new THREE.BoxGeometry(0.54, 0.6, 0.34), lam(0xffffff), ENEMY_CAP, true, true);
    E.head = inst(new THREE.SphereGeometry(0.23, 8, 6), lam(0xffffff), ENEMY_CAP, true, true);
    E.arms = inst(new THREE.BoxGeometry(0.13, 0.13, 0.55).translate(0, 0, 0.27), lam(0xffffff), ENEMY_CAP * 2, false, true);
    E.eyes = inst(new THREE.BoxGeometry(0.08, 0.055, 0.06), hdr(basic(), 2.8, 0.5, 0.12), ENEMY_CAP * 2, false);
    // a bloater's swollen, glowing gut: one pulsing HDR sphere over the torso
    E.bloat = inst(new THREE.SphereGeometry(0.36, 10, 8), hdr(basic(), 2.6, 0.95, 0.2), BLOAT_CAP, false);
    TYPE_COL = BB.ENEMY.map(function (e) { return { torso: rgb(e.color), skin: rgb(e.skin) }; });

    // Each bullet is a white-hot core inside a larger translucent green shell, so it reads on any deck colour.
    const dart = function () { return new THREE.SphereGeometry(0.11, 6, 4).scale(1, 1, 6); };
    FX.glow = inst(dart(), hdr(basic({ transparent: true, opacity: 0.5, depthWrite: false, fog: false }), 0.2, 1.1, 0.2), BULLET_CAP, false);
    FX.bullets = inst(dart(), hdr(basic({ fog: false }), 1.9, 2.4, 1.5), BULLET_CAP, false);
    FX.muzzle = inst(new THREE.OctahedronGeometry(0.16, 0).scale(1, 1, 2.6), hdr(basic({ fog: false }), 3.2, 2.4, 0.9), LIVE, false);
    FX.parts = inst(new THREE.BoxGeometry(0.2, 0.2, 0.2), basic({ color: 0xffffff }), PART_CAP, false, true);
    FX.rings = inst(new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2),
      basic({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), RING_CAP, false, true);
    FX.coins = inst(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10).rotateX(Math.PI / 2), hdr(basic({ fog: false }), 2.3, 1.7, 0.35), COIN_CAP, false);

    // boss fireballs: a hot core in a soft shell, plus the target painted on the deck where each will land
    FX.fb = inst(new THREE.IcosahedronGeometry(0.5, 1), basic({ fog: false }), FB_CAP, false);
    FX.fbGlow = inst(new THREE.SphereGeometry(0.5, 10, 8),
      basic({ transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), FB_CAP, false);
    FX.fbRing = inst(new THREE.RingGeometry(0.9, 1, 40).rotateX(-Math.PI / 2), hdr(basic({ depthWrite: false }), 3.0, 0.5, 0.2), FB_CAP, false);
    FX.fbMark = inst(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2),
      hdr(basic({ transparent: true, opacity: 0.42, depthWrite: false }), 1.9, 0.2, 0.1), FB_CAP, false);
    FX.fbRing.renderOrder = FX.fbMark.renderOrder = 1;

    // The boss's breath: a white-hot core inside a wider translucent sheath, a ball of light
    // gathering in its mouth while it charges, and another where the beam meets the deck.
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);   // runs from z=0 to z=1
    beamCore = new THREE.Mesh(beamGeo, basic({ fog: false }));
    beamShell = new THREE.Mesh(beamGeo, basic({ transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    const orbMat = function () {
      return new THREE.SpriteMaterial({ map: BB.World.glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    };
    mouthOrb = new THREE.Sprite(orbMat());
    hitOrb = new THREE.Sprite(orbMat());
    [beamCore, beamShell, mouthOrb, hitOrb].forEach(function (m) { m.visible = false; m.frustumCulled = false; m.renderOrder = 5; scene.add(m); });

    for (let i = 0; i < DRONES; i++) droneViews.push(makeDrone());
    dome = makeDome();

    unitPlane = new THREE.PlaneGeometry(1, 1);
    postGeo = new THREE.BoxGeometry(0.3, 1, 0.3);
    postGood = lam(0x2f7cf6);
    postBad = lam(0xe5484d);
    barrelGeo = new THREE.CylinderGeometry(0.85, 0.85, 1.7, 18);
    bandGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.14, 18);
    bandMat = lam(0x23262e);
    cageGeo = new THREE.CylinderGeometry(1.25, 1.25, 3.4, 28);
    capMat = lam(0x2b3448);

    bossK = makeKaiju({ body: 0x3c4a44, belly: 0x93a184, spike: 0x7fe9ff, glow: [0.1, 1.15, 1.6], eye: [3.4, 0.25, 0.2] });
    bossK.group.scale.setScalar(BOSS_SCALE);

    // red warning strip laid over the half of the deck the boss is about to slam
    slamZone = new THREE.Mesh(new THREE.PlaneGeometry(CFG.HALF_W, 70).rotateX(-Math.PI / 2),
      hdr(basic({ transparent: true, opacity: 0.3, depthWrite: false }), 1.7, 0.16, 0.1));
    slamZone.visible = false;
    slamZone.renderOrder = 1;
    scene.add(slamZone);

    allyK = makeKaiju({ body: 0x2f7fd6, belly: 0xcfe9ff, spike: 0xffd24a, glow: [1.5, 0.95, 0.12], eye: [2.8, 2.3, 0.6] });
    allyK.group.scale.setScalar(ALLY_SCALE);
    allyK.group.rotation.y = Math.PI;   // the ally charges away from the camera
  };

  A.buildLevel = function (G) {
    liveCrates.forEach(disposeCrateView);
    liveCrates.length = 0;
    for (let i = group.children.length - 1; i >= 0; i--) group.remove(group.children[i]);
    dying.length = parts.length = rings.length = corpses.length = coinsFx.length = 0;
    gateCull = crateCull = 0;
    domeK = fwT = fwN = 0;
    G.gates.forEach(addGate);
    G.crates.forEach(addCrate);

    // this level's boss, and everything it breathes or throws, in its own colours
    const pal = bossPal = G.level.boss.info, gl = pal.glow;
    paintKaiju(bossK, pal);
    beamCore.material.color.setRGB(1.6 + gl[0] * 1.6, 1.6 + gl[1] * 1.6, 1.6 + gl[2] * 1.6);
    beamShell.material.color.setRGB(gl[0] * 1.3, gl[1] * 1.3, gl[2] * 1.3);
    mouthOrb.material.color.setRGB(gl[0] * 1.5 + 0.3, gl[1] * 1.5 + 0.3, gl[2] * 1.5 + 0.3);
    hitOrb.material.color.copy(mouthOrb.material.color);
    FX.fb.material.color.setRGB(1.2 + gl[0] * 1.5, 1.0 + gl[1] * 1.5, 0.8 + gl[2] * 1.5);
    FX.fbGlow.material.color.setRGB(gl[0] + 0.5, gl[1] + 0.25, gl[2] + 0.1);
  };

  // ---------- per-frame drawing ----------

  // up = 0..1: arms and rifle thrown in the air (the victory cheer)
  function soldierRig(i, x, y, z, sc, rot, sw, kick, up) {
    const cr = Math.cos(rot), sr = Math.sin(rot), ar = -0.12 + up * 1.45;
    limb(S.legs, i * 2, x, y, z, sc, cr, sr, rot, -0.13, 0.6, 0, sw);
    limb(S.legs, i * 2 + 1, x, y, z, sc, cr, sr, rot, 0.13, 0.6, 0, -sw);
    limb(S.torso, i, x, y, z, sc, cr, sr, rot, 0, 0.88, 0, -0.08);
    limb(S.head, i, x, y, z, sc, cr, sr, rot, 0, 1.37, -0.03, 0);
    limb(S.helmet, i, x, y, z, sc, cr, sr, rot, 0, 1.4, -0.03, 0);
    limb(S.gun, i, x, y, z, sc, cr, sr, rot, 0.27 * up, 0.98 + 0.62 * up, (-0.5 + kick) * (1 - up) - 0.08 * up, up * 1.45);
    limb(S.arms, i * 2, x, y, z, sc, cr, sr, rot, -0.27, 1.04, -0.05, ar);
    limb(S.arms, i * 2 + 1, x, y, z, sc, cr, sr, rot, 0.27, 1.04, -0.05, ar);
    limb(S.pack, i, x, y, z, sc, cr, sr, rot, 0, 0.93, 0.24, -0.08);
  }

  function drawSoldiers(G, dt) {
    const sq = G.squad, list = sq.soldiers, n = Math.min(list.length, LIVE), run = sq.moving ? 1 : 0;
    const cheer = G.run && G.run.result === 'win';
    let flashes = 0;
    for (let i = 0; i < n; i++) {
      const s = list[i], sc = easeOutBack(s.pop);
      const ph = time * 15 + s.phase;
      const sw = Math.sin(ph) * 0.85 * run;
      const fl = s.flash > 0 ? s.flash : 0;
      if (cheer) {   // everyone jumps, each to their own beat
        const hop = Math.abs(Math.sin(time * 7.5 + s.phase));
        soldierRig(i, s.x, hop * 0.5, -s.d, sc, 0, 0.25 * hop, 0, 0.75 + 0.25 * hop);
        put(S.ring, i, s.x, 0.04, -s.d, 0, sc);
        continue;
      }
      const y = run ? Math.abs(Math.cos(ph)) * 0.09 * sc : (Math.sin(time * 2.2 + s.phase) + 1) * 0.012;
      soldierRig(i, s.x, y, -s.d, sc, 0, sw, fl * 2.4, 0);     // the gun kicks back for the instant it fires
      put(S.ring, i, s.x, 0.04, -s.d, 0, sc);
      if (fl > 0) {
        put(FX.muzzle, flashes++, s.x, y + 0.99 * sc, -s.d - 1.02 * sc, 0, 0.75 + fl * 9);
        s.flash = fl - dt;
      }
    }
    let k = n;
    for (let i = 0; i < corpses.length && k < SOLDIER_CAP; i++) {
      const c = corpses[i];
      if (c.kind !== 1) continue;
      soldierRig(k++, c.x, c.y, -c.d, Math.min(1, (c.life - c.t) / 0.25), c.rot, 0, 0, 0);
    }
    commit(S.legs, k * 2); commit(S.arms, k * 2);
    commit(S.torso, k); commit(S.head, k); commit(S.helmet, k); commit(S.gun, k); commit(S.pack, k);
    commit(S.ring, n);
    commit(FX.muzzle, flashes);
  }

  function enemyRig(i, x, y, z, sc, rot, sw, type, flash, tint, eyeSc) {
    const cr = Math.cos(rot), sr = Math.sin(rot);
    limb(E.legs, i * 2, x, y, z, sc, cr, sr, rot, -0.14, 0.6, 0, sw);
    limb(E.legs, i * 2 + 1, x, y, z, sc, cr, sr, rot, 0.14, 0.6, 0, -sw);
    limb(E.torso, i, x, y, z, sc, cr, sr, rot, 0, 0.9, 0.03, 0.2);
    limb(E.head, i, x, y, z, sc, cr, sr, rot, 0, 1.38, 0.14, 0);
    limb(E.arms, i * 2, x, y, z, sc, cr, sr, rot, -0.3, 1.1, 0.08, -0.1 + sw * 0.35);
    limb(E.arms, i * 2 + 1, x, y, z, sc, cr, sr, rot, 0.3, 1.1, 0.08, -0.1 - sw * 0.35);
    // eyes ride on the head's offset but are scaled separately, so they can be "switched off"
    const ey = y + (1.43 * cr - 0.36 * sr) * sc, ez = z + (1.43 * sr + 0.36 * cr) * sc;
    put(E.eyes, i * 2, x - 0.09 * sc, ey, ez, rot, eyeSc);
    put(E.eyes, i * 2 + 1, x + 0.09 * sc, ey, ez, rot, eyeSc);

    const col = TYPE_COL[type];
    let t0 = 1.6, t1 = 1.6, t2 = 1.6, s0 = 1.6, s1 = 1.6, s2 = 1.6;   // hit flash: everything white-hot
    if (!flash) {
      t0 = col.torso[0] * tint; t1 = col.torso[1] * tint; t2 = col.torso[2] * tint;
      s0 = col.skin[0] * tint; s1 = col.skin[1] * tint; s2 = col.skin[2] * tint;
      if (iceK > 0) {   // deep freeze: every colour is pulled most of the way to frosty blue
        const k = iceK * 0.72;
        t0 += (0.45 - t0) * k; t1 += (0.8 - t1) * k; t2 += (1.2 - t2) * k;
        s0 += (0.62 - s0) * k; s1 += (0.9 - s1) * k; s2 += (1.22 - s2) * k;
      }
    }
    const tc = E.torso.instanceColor.array, hc = E.head.instanceColor.array, ac = E.arms.instanceColor.array;
    let o = i * 3;
    tc[o] = t0; tc[o + 1] = t1; tc[o + 2] = t2;
    hc[o] = s0; hc[o + 1] = s1; hc[o + 2] = s2;
    o = i * 6;
    ac[o] = s0; ac[o + 1] = s1; ac[o + 2] = s2; ac[o + 3] = s0; ac[o + 4] = s1; ac[o + 5] = s2;
  }

  function drawEnemies(G) {
    const list = G.enemies, n = Math.min(list.length, ENEMY_CAP - CORPSE_CAP);
    const pace = iceK > 0 ? 0.3 : 1;   // frozen enemies shuffle in slow motion
    let nb = 0;
    for (let i = 0; i < n; i++) {
      const e = list[i], def = BB.ENEMY[e.type];
      // every enemy gets its own slight size and shade from its random phase, so a horde is not a row of clones
      const sc = def.scale * (0.93 + frac(e.phase * 3.7) * 0.15), tint = 0.84 + frac(e.phase * 5.3) * 0.3;
      const ph = time * (e.aggro ? def.anim * pace : 2.2) + e.phase;
      const sw = Math.sin(ph) * (e.aggro ? 0.75 : 0.1);
      const y = e.aggro ? Math.abs(Math.cos(ph)) * 0.08 * sc : 0;
      enemyRig(i, e.x, y, -e.d, sc, 0, sw, e.type, e.flash > 0, tint, sc);
      if (def.boom && nb < BLOAT_CAP) {   // the gut throbs faster the closer it gets
        const near = BB.clamp(1 - (e.d - G.squad.d) / 40, 0, 1);
        put(E.bloat, nb++, e.x, y + 0.93 * sc, -e.d + 0.1 * sc, 0, sc * (1 + 0.13 * Math.sin(time * (5 + near * 9) + e.phase)));
      }
    }
    E.bloat.material.color.setRGB(2.3 + 0.7 * Math.sin(time * 6), 0.85 + 0.25 * Math.sin(time * 6), 0.18);
    commit(E.bloat, nb);
    let k = n;
    for (let i = 0; i < corpses.length && k < ENEMY_CAP; i++) {
      const c = corpses[i];
      if (c.kind !== 0) continue;
      const sc = BB.ENEMY[c.type].scale * (0.93 + frac(c.phase * 3.7) * 0.15) * Math.min(1, (c.life - c.t) / 0.25);
      enemyRig(k++, c.x, c.y, -c.d, sc, c.rot, 0.5, c.type, c.t < 0.07, 0.84 + frac(c.phase * 5.3) * 0.3, 0.0001);
    }
    commit(E.legs, k * 2); commit(E.arms, k * 2); commit(E.eyes, k * 2); commit(E.torso, k); commit(E.head, k);
  }

  function drawBullets(G) {
    const list = G.bullets, n = Math.min(list.length, BULLET_CAP), run = G.run;
    // How far up the colour ramp: two x1.5 buffs is roughly one step.
    const p = BB.clamp(Math.log(run.dmgMul * run.rateMul * MULTI_POWER[run.multi - 1]) / Math.LN2 / 1.1, 0, BULLET_RAMP.length - 1);
    const i0 = Math.min(BULLET_RAMP.length - 2, Math.floor(p)), f = p - i0, a = BULLET_RAMP[i0], c = BULLET_RAMP[i0 + 1];
    FX.bullets.material.color.setRGB(BB.lerp(a.core[0], c.core[0], f), BB.lerp(a.core[1], c.core[1], f), BB.lerp(a.core[2], c.core[2], f));
    FX.glow.material.color.setRGB(BB.lerp(a.glow[0], c.glow[0], f), BB.lerp(a.glow[1], c.glow[1], f), BB.lerp(a.glow[2], c.glow[2], f));
    const sc = 1.1 + p * 0.09;
    for (let i = 0; i < n; i++) {
      const b = list[i];
      put(FX.bullets, i, b.x, b.y, -b.d, 0, sc);
      put(FX.glow, i, b.x, b.y, -b.d + 0.25, 0, sc * 1.9);
    }
    commit(FX.bullets, n);
    commit(FX.glow, n);
  }

  function drawDrones(G) {
    for (let i = 0; i < DRONES; i++) {
      const v = droneViews[i], dr = G.drones[i];
      v.g.visible = !!dr;
      if (!dr) continue;
      const pop = easeOutBack(Math.min(1, Math.max(0, G.time - dr.born) * 2.5));
      v.g.position.set(dr.x, 3.3 + Math.sin(time * 3 + i * 2) * 0.14, -dr.d);
      v.g.rotation.set(-0.14, 0, -BB.clamp(dr.vx * 0.05, -0.45, 0.45));   // nose down, and banking into its turns
      v.g.scale.setScalar(Math.max(0.001, pop) * 1.45);
      for (let k = 0; k < 4; k++) v.rotors[k].rotation.y = time * 40 * (k % 2 ? 1 : -1);
      v.flash.visible = dr.flash > 0;
      v.lamp.visible = Math.sin(time * 9 + i) > 0;
    }
  }

  function drawDome(G, dt) {
    const run = G.run, s = G.squad;
    domeK = BB.damp(domeK, run.shield > 0 && s.count > 0 ? 1 : 0, 9, dt);
    dome.visible = domeK > 0.02;
    if (!dome.visible) return;
    dome.position.set(s.x, 0, -s.d);
    dome.scale.set((s.hw + 1.1) * domeK, (2.4 + s.hw * 0.3) * domeK, (s.hd + 1.1) * domeK);
    dome.material.uniforms.uTime.value = time;
    dome.material.uniforms.uHit.value = Math.max(0, run.shieldHit) * 4;
  }

  function drawFireballs(G, dt) {
    const fs = G.fireballs, n = Math.min(fs.length, FB_CAP);
    for (let i = 0; i < n; i++) {
      const f = fs[i], p = Math.min(1, f.t / f.dur);
      const x = f.x0 + (f.x - f.x0) * p, d = f.d0 + (f.d - f.d0) * p;
      const y = 7.3 + (0.5 - 7.3) * p + Math.sin(Math.PI * p) * 8;   // lobbed in a high arc from the boss's mouth
      put(FX.fb, i, x, y, -d, time * 9, 1);
      put(FX.fbGlow, i, x, y, -d, 0, 2 + 0.3 * Math.sin(time * 30 + i));
      put(FX.fbRing, i, f.x, 0.06, -f.d, 0, f.r);
      put(FX.fbMark, i, f.x, 0.05, -f.d, 0, Math.max(0.05, f.r * p));   // the target fills in as the fireball closes
      if (dt > 0 && Math.random() < 0.6) A.burst(x, y, -d, bossPal.hex, 1, 2, 0.9, 2.2);
    }
    commit(FX.fb, n); commit(FX.fbGlow, n); commit(FX.fbRing, n); commit(FX.fbMark, n);
  }

  function updateLevelViews(G, dt) {
    const sd = G.squad.d, gs = G.gates, cs = G.crates;

    // gates the squad just ran through squash flat and vanish
    for (let i = dying.length - 1; i >= 0; i--) {
      const g = dying[i], v = g.view;
      if (v) {
        v.t -= dt;
        const k = Math.max(0, v.t / 0.2);
        v.grp.scale.set(1 + (1 - k) * 0.3, Math.max(0.001, k), 1);
        if (v.t > 0) continue;
        group.remove(v.grp);
        g.view = null;
      }
      dying.splice(i, 1);
    }

    // drop what is behind the camera, hide what is still beyond the fog
    while (gateCull < gs.length && gs[gateCull].d < sd - 18) {
      const g = gs[gateCull++];
      if (g.view && g.view.t <= 0) { group.remove(g.view.grp); g.view = null; }
    }
    for (let i = gateCull; i < gs.length; i++) {
      const g = gs[i], v = g.view;
      if (!v) continue;
      v.grp.visible = g.d - sd < 135;
      if (g.slide && !g.used && v.grp.visible) layoutGate(g);
    }

    while (crateCull < cs.length && cs[crateCull].d < sd - 18) A.removeCrate(cs[crateCull++]);
    for (let i = crateCull; i < cs.length; i++) {
      const c = cs[i], v = c.view;
      if (!v) continue;
      v.grp.visible = c.d - sd < 135;
      if (c.hitT > 0) c.hitT = Math.max(0, c.hitT - dt);
      const k = 1 + c.hitT * 1.3;
      v.grp.scale.set(k, 1 / k, k);
      drawCrateLabel(c);
    }
  }

  // The breath beam. It lights up for the last instant of the warning, reaches the squad exactly
  // when the damage lands, and carries on down the lane for a moment afterwards.
  function drawBeam(G, dt) {
    const b = G.boss, s = G.squad, sl = b.slam;
    let on = false, endD = 0, charge = 0;
    if (b.active && !b.dead) {
      if (sl) {
        charge = 1 - sl.t / sl.total;
        if (sl.t < 0.22) { on = true; endD = BB.lerp(b.d - 5, s.d + s.hd + 1, 1 - sl.t / 0.22); }
      } else if (b.beamT > 0) {
        on = true;
        charge = 1;
        endD = BB.lerp(s.d + s.hd + 1, s.d - 9, 1 - b.beamT / 0.32);
      }
    }
    const mx = b.x, my = 7.3, mz = -b.d + 2.8;   // where its open mouth is
    mouthOrb.visible = charge > 0;
    if (mouthOrb.visible) {
      const sz = on ? 8 : 1.2 + charge * 4.5 + Math.sin(time * 40) * 0.4 * charge;
      mouthOrb.position.set(mx, my, mz + 0.4);
      mouthOrb.scale.set(sz, sz, 1);
      // motes of light streaming into the mouth while it charges
      if (!on && dt > 0 && Math.random() < 0.7) A.burst(mx + BB.rand(-2.5, 2.5), my + BB.rand(-2, 2.5), mz + BB.rand(0, 3), bossPal.hex, 1, 1.5, 0.7, 2.6);
    }
    beamCore.visible = beamShell.visible = hitOrb.visible = on;
    if (!on) return;
    const ex = b.beamSide * 3, ey = 0.25, ez = -endD;
    const len = Math.hypot(ex - mx, ey - my, ez - mz), w = 0.3 + 0.07 * Math.sin(time * 70);
    v3a.set(ex, ey, ez);
    beamCore.position.set(mx, my, mz);
    beamCore.lookAt(v3a);
    beamCore.scale.set(w, w, len);
    beamShell.position.set(mx, my, mz);
    beamShell.lookAt(v3a);
    beamShell.scale.set(w * 2.9, w * 2.9, len);
    hitOrb.position.set(ex, 0.8, ez);
    hitOrb.scale.set(9, 9, 1);
    if (dt > 0) {
      A.burst(ex + BB.rand(-2.4, 2.4), 0.3, ez, bossPal.hex, 3, 9, 1.2, 2.6);
      A.burst(ex + BB.rand(-2.4, 2.4), 0.3, ez, 0xff6a3a, 1, 7, 1.3, 2);
    }
  }

  function updateKaijus(G, dt) {
    const b = G.boss;
    if (b && b.d - G.squad.d < 135 && !(b.dead && b.deadT > 3.5)) {
      bossK.group.visible = true;
      const roar = b.dead ? 1 : Math.min(1, Math.max(0, b.roar) * 2.5);
      animKaiju(bossK, time, b.walking && !b.dead ? 1 : 0, roar);
      bossK.group.position.set(b.x, bossK.bob * BOSS_SCALE - Math.max(0, b.deadT - 1.1) * 4, -b.d);
      bossK.group.rotation.x = b.dead ? -Math.min(1, b.deadT * 1.3) * 1.45 : 0;   // topple backwards
      const f = b.flash > 0 && !b.dead ? 0.38 : 0;
      // Enraged: the plates burn from their own colour to furnace red and the hide smoulders.
      const rg = b.dead ? 0 : b.rage, gl = bossPal.glow, heat = rg * 0.16 * (0.6 + 0.4 * Math.sin(time * 9));
      bossK.spike.emissive.setRGB(gl[0] + (2.0 - gl[0]) * rg, gl[1] + (0.24 - gl[1]) * rg, gl[2] + (0.06 - gl[2]) * rg);
      bossK.body.emissive.setRGB(f + heat, f + heat * 0.12, f);
      bossK.belly.emissive.setRGB(f + heat * 1.4, f + heat * 0.2, f);
      if (rg > 0.4 && dt > 0 && Math.random() < 0.4) A.burst(b.x + BB.rand(-2, 2), BB.rand(2, 8), -b.d + BB.rand(-1, 1.5), 0xff4a2a, 1, 3, 0.8, 2.6);
      if (b.dead) bossK.spike.emissiveIntensity = Math.max(0, 1 - b.deadT);   // the glow dies with it
    } else {
      bossK.group.visible = false;
    }
    drawBeam(G, dt);

    // the slam warning blinks faster and brighter as the hit gets closer
    const sl = b && !b.dead ? b.slam : null;
    slamZone.visible = !!sl;
    if (sl) {
      const k = 1 - sl.t / sl.total;
      slamZone.position.set(sl.side * CFG.HALF_W / 2, 0.035, -(G.squad.d + 24));
      slamZone.material.opacity = 0.2 + 0.26 * k + 0.13 * Math.sin(time * (14 + 22 * k));
    }

    const a = G.ally;
    if (a) {
      allyK.group.visible = true;
      animKaiju(allyK, time * 1.7, 1, a.roar > 0 ? 1 : 0.3);
      allyK.group.position.set(a.x, allyK.bob * ALLY_SCALE, -a.d);
    } else {
      allyK.group.visible = false;
    }
  }

  A.sync = function (G, dt) {
    time += dt;
    iceK = BB.clamp(G.run.freezeT / 0.6, 0, 1);   // thaws over the last half second
    updateCorpses(dt);
    drawSoldiers(G, dt);
    drawEnemies(G);
    drawBullets(G);
    drawDrones(G);
    drawDome(G, dt);
    drawFireballs(G, dt);
    updateCoins(G, dt);
    updateLevelViews(G, dt);
    updateKaijus(G, dt);
    updateParts(dt);   // after everything that can emit particles this frame
    drawRings(dt);
  };
})(window.BB);
