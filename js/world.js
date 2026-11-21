// Renderer, camera, lights and everything that is scenery: ocean, sky, suspension bridge,
// islands and weather.
(function (BB) {
  'use strict';

  const CFG = BB.CFG;
  const W = BB.World = { scene: null, camera: null, renderer: null };

  // One per biome, in the same order as BB.BIOMES (config.js).
  // disc / glitter / birds are HDR colours (above 1.0 on purpose: that is what makes them bloom).
  // precip = what falls (or rises) through the air, isle = what stands in the sea, city = skyline tint.
  const THEMES = [
    { name: 'Day', skyTop: '#1f6fd0', skyMid: '#7fbcf0', fog: '#bfe4f5', deep: '#07509a', shallow: '#2f9fd6',
      sun: 0xfff1d6, sunI: 0.78, hemiSky: 0xcfeaff, hemiGround: 0x6a7f8f, hemiI: 0.6, fillI: 0.2, deck: '#757b84',
      sunElev: 24, disc: [3.0, 2.7, 2.1], discSize: 150, glitter: [1.7, 1.55, 1.2], cloud: 0xffffff, lamp: 0, stars: false,
      precip: null, isle: 'tropic', birds: [1.04, 1.04, 1.0], boats: true, city: 0x5f86ad, cityLit: 0, bolts: false },
    { name: 'Sunset', skyTop: '#27286c', skyMid: '#c4567c', fog: '#f4a877', deep: '#2c2a6e', shallow: '#d86f86',
      sun: 0xffa868, sunI: 0.8, hemiSky: 0xffc2a0, hemiGround: 0x54466a, hemiI: 0.56, fillI: 0.16, deck: '#7a747c',
      sunElev: 4, disc: [3.4, 1.7, 0.7], discSize: 260, glitter: [2.4, 1.2, 0.5], cloud: 0xffb0a8, lamp: 0.55, stars: false,
      precip: null, isle: 'tropic', birds: [0.2, 0.12, 0.17], boats: true, city: 0x3a2350, cityLit: 0.7, bolts: false },
    { name: 'Frost', skyTop: '#2f5f9c', skyMid: '#a5d0ea', fog: '#d9eaf3', deep: '#0c4466', shallow: '#58b0cc',
      sun: 0xf2faff, sunI: 0.72, hemiSky: 0xe4f3ff, hemiGround: 0x7c93a8, hemiI: 0.66, fillI: 0.22, deck: '#8d969f',
      sunElev: 13, disc: [2.6, 2.7, 2.9], discSize: 170, glitter: [1.5, 1.7, 1.9], cloud: 0xf2f7ff, lamp: 0.25, stars: false,
      precip: 'snow', isle: 'ice', birds: [1.04, 1.07, 1.1], boats: true, city: 0x6f8fb0, cityLit: 0.3, bolts: false },
    { name: 'Night', skyTop: '#01030c', skyMid: '#0a1636', fog: '#172850', deep: '#020d24', shallow: '#12507c',
      sun: 0x9fc0ff, sunI: 0.5, hemiSky: 0x6f8fd0, hemiGround: 0x1a2440, hemiI: 0.6, fillI: 0.14, deck: '#5d6373',
      sunElev: 27, disc: [1.9, 2.1, 2.5], discSize: 90, glitter: [0.8, 0.95, 1.3], cloud: 0x33466e, lamp: 1, stars: true,
      precip: null, isle: 'tropic', birds: null, boats: true, city: 0x070d24, cityLit: 1.7, bolts: false },
    { name: 'Storm', skyTop: '#121a21', skyMid: '#46605c', fog: '#7f9d8f', deep: '#0c3434', shallow: '#3f957c',
      sun: 0xdaf5e4, sunI: 0.5, hemiSky: 0xb0d0c0, hemiGround: 0x38483f, hemiI: 0.6, fillI: 0.16, deck: '#6c7571',
      sunElev: 20, disc: null, discSize: 0, glitter: [0.35, 0.45, 0.42], cloud: 0x66756f, lamp: 0.75, stars: false,
      precip: 'rain', isle: 'tropic', birds: null, boats: true, city: 0x2a3a38, cityLit: 0.9, bolts: true },
    { name: 'Ember', skyTop: '#0c0406', skyMid: '#5c1a12', fog: '#8a3c20', deep: '#190606', shallow: '#b4380e',
      sun: 0xff9a5c, sunI: 0.62, hemiSky: 0xffa078, hemiGround: 0x34161a, hemiI: 0.62, fillI: 0.2, deck: '#5e5557',
      sunElev: 7, disc: [3.4, 0.9, 0.3], discSize: 210, glitter: [2.6, 0.9, 0.22], cloud: 0x3c2222, lamp: 0.9, stars: false,
      precip: 'ember', isle: 'volcano', birds: null, boats: false, city: 0x1c0a0c, cityLit: 0.8, bolts: false }
  ];

  // How each kind of weather moves: fall speed (negative = down), wind, sideways sway, colour.
  const PRECIP = {
    rain:  { vy: -46,  vx: -5.5, sway: 0,   rgb: [0.77, 0.85, 0.88], op: 0.38, add: false },
    snow:  { vy: -5.5, vx: -1.8, sway: 1.5, rgb: [1.5, 1.55, 1.65],  op: 0.92, add: false },
    ember: { vy: 3.4,  vx: -1.2, sway: 2.0, rgb: [3.2, 1.2, 0.25],   op: 0.95, add: true }
  };

  // Chase camera: above and behind the squad, looking a little way up the bridge.
  const CAM_H = 15, CAM_BACK = 17, CAM_AHEAD = 16;
  const WATER_Y = -9;

  // The sun sits ahead of the squad and to the right, so shadows fall back towards the camera.
  const SUN_DIR = new THREE.Vector3(0.2, 0.8, -0.56).normalize();
  const SHADOW_SNAP = 0.25;
  const RAIN = 600, BIRDS = 14, BOLT_SEGS = 16;

  let scene, sun, fill, hemi, water, far, sunSprite, clouds, stars, rain, levelGroup = null, theme = THEMES[0];
  let city, cityLights, birds, boltMesh, boltGlow, precip = null;
  let glowTex = null;
  let camX = 0, shake = 0, clock = 0, lastFz = 0;
  let menuBlend = 1, menuGoal = 1;                 // 1 = low "hero shot" for the menu, 0 = gameplay camera
  let cine = 0, cineGoal = 0, cineX = 0, cineZ = 0; // 1 = the boss's entrance shot, low and close in front of it
  let fovBase = 55, fovKick = 0;
  let skyCanvas = null, skyTex = null, skyHorizon = -1;
  let boltT = 6, bolt = 0;
  const rainPos = new Float32Array(RAIN * 3);
  const precipGeo = {};
  const boats = [], birdData = [];
  const tmp = new THREE.Vector3(), size = new THREE.Vector2(), m4 = new THREE.Matrix4(), dummy = new THREE.Object3D();
  const bdummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  bdummy.rotation.order = 'YXZ';   // birds: heading first, then the wing's flap about the body axis

  W.init = function (canvas) {
    const renderer = W.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    BB.Post.init(renderer);

    scene = W.scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xbfe4f5, 55, 118);
    W.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 1300);

    hemi = new THREE.HemisphereLight(0xffffff, 0x666666, 0.6);
    scene.add(hemi);

    // One shadow-casting sun. Its shadow box is fitted to the stretch of bridge around the squad
    // and slides along with it. The box is sized so that a 0.25-unit step of the squad moves it
    // by a whole number of shadow-map texels on both axes; snapping to that step stops shadow
    // edges from crawling as it moves.
    sun = new THREE.DirectionalLight(0xffffff, 0.78);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -20; sc.right = 37.4;
    sc.bottom = -63; sc.top = 33.74;
    sc.near = 8; sc.far = 115;
    sun.shadow.bias = -0.0007;
    scene.add(sun);
    scene.add(sun.target);

    // Weak, shadowless light from behind the camera so the faces we actually look at are not flat grey.
    fill = new THREE.DirectionalLight(0xffffff, 0.2);
    fill.position.set(-30, 50, 100);
    scene.add(fill);

    water = makeWater();
    scene.add(water);

    // Things so far away they should never appear to move: they ride along with the camera.
    far = new THREE.Group();
    scene.add(far);
    sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending
    }));
    far.add(sunSprite);
    clouds = makeClouds();
    far.add(clouds);
    stars = makeStars();
    far.add(stars);
    makeCity();
    rain = makeRain();
    scene.add(rain);
    birds = makeBirds();
    scene.add(birds);
    makeBolt();

    W.resize();
    window.addEventListener('resize', W.resize);
  };

  // ---------- sky ----------

  // Soft radial blob: used for the sun/moon and for the pools of light under street lamps.
  function glowTexture() {
    if (glowTex) return glowTex;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.1, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.38)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    glowTex = new THREE.CanvasTexture(c);
    glowTex.userData.shared = true;
    return glowTex;
  }
  W.glowTexture = glowTexture;

  // The city the bridge leads to: a silhouette on the horizon, drawn once into a texture, with a
  // second layer of lit windows on top that only comes on after dark. Like the clouds and the sun
  // it rides along with the camera, so it never gets any closer. It stands nearer than the sun,
  // which means a low sun really does set behind the towers.
  function makeCity() {
    const CW = 2048, CH = 256, rng = BB.mulberry32(777);
    const a = document.createElement('canvas'), b = document.createElement('canvas');
    a.width = b.width = CW; a.height = b.height = CH;
    const x = a.getContext('2d'), y = b.getContext('2d');
    x.fillStyle = '#fff';
    let px = 0;
    while (px < CW) {
      const bw = 14 + rng() * 34, mid = 1 - Math.abs(px / CW - 0.5) * 2;      // towers get taller towards downtown
      const bh = 22 + rng() * 60 + mid * mid * 140 * rng();
      x.fillRect(px, CH - bh, bw - 2, bh);
      if (rng() < 0.22) x.fillRect(px + bw / 2 - 1, CH - bh - 10 - rng() * 22, 2, 34);   // antenna
      if (rng() < 0.3) x.fillRect(px + 3, CH - bh - 5, bw - 8, 6);                        // stepped crown
      for (let wy = CH - bh + 5; wy < CH - 5; wy += 7) {
        for (let wx = px + 3; wx < px + bw - 6; wx += 6) {
          if (rng() < 0.4) { y.fillStyle = rng() < 0.8 ? '#ffd89a' : '#bfe6ff'; y.fillRect(wx, wy, 3, 3); }
        }
      }
      px += bw;
    }
    const geo = new THREE.PlaneGeometry(1500, 130);
    city = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(a), alphaTest: 0.5, fog: false }));
    city.position.set(0, WATER_Y + 62, -700);
    cityLights = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(b), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    }));
    cityLights.position.set(0, WATER_Y + 62, -699);
    city.frustumCulled = cityLights.frustumCulled = false;
    far.add(city);
    far.add(cityLights);
  }

  // Gulls: each is just two triangles that flap. They circle over the water beside the bridge and
  // keep pace with the squad, so there is always something alive in the corner of your eye.
  function makeBirds() {
    const rng = BB.mulberry32(1234);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.2, 0, 0, 0.32, 1.2, 0, 0.08]), 3));
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), BIRDS * 2);
    for (let i = 0; i < BIRDS; i++) {
      birdData.push({
        side: i % 2 ? 1 : -1, off: 15 + rng() * 9, rx: 4 + rng() * 5, rz: 12 + rng() * 16,
        y: 1.5 + rng() * 8, sp: (0.35 + rng() * 0.3) * (rng() < 0.5 ? 1 : -1), ph: rng() * 6.283, flap: 7 + rng() * 4
      });
    }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
  }

  function updateBirds(dt, fz, vz) {
    for (let i = 0; i < BIRDS; i++) {
      const b = birdData[i], a = clock * b.sp + b.ph;
      const x = b.side * b.off + Math.cos(a) * b.rx, z = fz - 30 + Math.sin(a) * b.rz;
      const y = b.y + Math.sin(a * 2 + b.ph) * 1.1;
      // face the way it is really travelling: its own circling plus the drift that keeps it alongside
      const hx = -Math.sin(a) * b.rx * b.sp, hz = Math.cos(a) * b.rz * b.sp + vz;
      const yaw = Math.atan2(-hx, -hz);
      const glide = Math.sin(clock * 0.6 + b.ph) > 0.55 ? 0.15 : 1;   // now and then it stops flapping and glides
      const fl = Math.sin(clock * b.flap + b.ph) * 0.75 * glide + 0.12;
      bdummy.position.set(x, y, z);
      bdummy.rotation.set(0, yaw, fl);
      bdummy.scale.set(1, 1, 1);
      bdummy.updateMatrix();
      birds.setMatrixAt(i * 2, bdummy.matrix);
      bdummy.rotation.set(0, yaw, -fl);
      bdummy.scale.set(-1, 1, 1);
      bdummy.updateMatrix();
      birds.setMatrixAt(i * 2 + 1, bdummy.matrix);
    }
    birds.instanceMatrix.needsUpdate = true;
  }

  // A lightning bolt you can actually see: a jagged chain of glowing segments from the clouds down
  // to the sea, redrawn at a new spot beside the bridge for every strike.
  function makeBolt() {
    const mat = new THREE.MeshBasicMaterial({ fog: false });
    mat.color.setRGB(5, 5.4, 7);
    boltMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, BOLT_SEGS);
    boltMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    boltMesh.frustumCulled = false;
    boltMesh.visible = false;
    scene.add(boltMesh);
    boltGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    boltGlow.material.color.setRGB(1.6, 1.8, 2.6);
    boltGlow.scale.set(52, 52, 1);
    boltGlow.visible = false;
    scene.add(boltGlow);
  }

  function strike(fz) {
    const side = Math.random() < 0.5 ? -1 : 1;
    // close enough to the bridge to be in frame even on a tall, narrow screen
    let x = camX + side * (13 + Math.random() * 30), y = 70, z = fz - 35 - Math.random() * 70;
    const main = BOLT_SEGS - 4, step = (y - WATER_Y) / main;
    let n = 0, fx = x, fy = y, fz2 = z;
    const seg = function (x0, y0, z0, x1, y1, z1, w) {
      dir.set(x1 - x0, y1 - y0, z1 - z0);
      const len = dir.length();
      dummy.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      dummy.quaternion.setFromUnitVectors(up, dir.divideScalar(len));
      dummy.scale.set(w, len, w);
      dummy.updateMatrix();
      boltMesh.setMatrixAt(n++, dummy.matrix);
    };
    for (let i = 0; i < main; i++) {
      const nx = x + (Math.random() - 0.5) * 9, nz = z + (Math.random() - 0.5) * 7, ny = y - step;
      seg(x, y, z, nx, ny, nz, 0.85);
      if (i === 3) { fx = nx; fy = ny; fz2 = nz; }
      x = nx; y = ny; z = nz;
    }
    for (let i = 0; i < 4; i++) {   // a short fork peeling off part of the way down
      const nx = fx + side * (3 + Math.random() * 5), ny = fy - 5 - Math.random() * 5, nz = fz2 + (Math.random() - 0.5) * 6;
      seg(fx, fy, fz2, nx, ny, nz, 0.45);
      fx = nx; fy = ny; fz2 = nz;
    }
    dummy.quaternion.identity();
    dummy.rotation.set(0, 0, 0);
    boltMesh.instanceMatrix.needsUpdate = true;
    boltGlow.position.set(x, WATER_Y + 3, z);
  }

  // Low-poly clouds: each one is a handful of squashed icosahedra, all drawn as one instanced mesh.
  function makeClouds() {
    const rng = BB.mulberry32(4242);
    const N = 18, PER = 5;
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 0, fog: false }), N * PER);
    let k = 0;
    for (let i = 0; i < N; i++) {
      const side = i % 2 ? 1 : -1, s = 0.7 + rng() * 0.9;
      const cx = side * (90 + rng() * 560), cz = -330 - rng() * 580;
      const cy = i % 3 ? 30 + rng() * 55 : 100 + rng() * 170;      // a low band near the horizon, a few high up
      for (let j = 0; j < PER; j++) {
        dummy.position.set(cx + (rng() - 0.5) * 46 * s, cy + (rng() - 0.5) * 7 * s, cz + (rng() - 0.5) * 22 * s);
        dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        dummy.scale.set((12 + rng() * 9) * s, (5 + rng() * 3.5) * s, (9 + rng() * 5) * s);
        dummy.updateMatrix();
        mesh.setMatrixAt(k++, dummy.matrix);
      }
    }
    mesh.frustumCulled = false;
    return mesh;
  }

  function makeStars() {
    const rng = BB.mulberry32(99);
    const N = 520, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const az = (rng() - 0.5) * Math.PI * 1.1, el = 0.03 + rng() * 1.2, r = 1000;
      pos[i * 3] = Math.sin(az) * Math.cos(el) * r;
      pos[i * 3 + 1] = Math.sin(el) * r;
      pos[i * 3 + 2] = -Math.cos(az) * Math.cos(el) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false });
    mat.color.setRGB(1.5, 1.5, 1.75);
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  // Rain, snow and embers are the same 600 instances: only the shape, colour and motion change.
  function makeRain() {
    precipGeo.rain = new THREE.BoxGeometry(0.035, 1.7, 0.035).rotateZ(-0.119);
    precipGeo.snow = new THREE.OctahedronGeometry(0.085, 0);
    precipGeo.ember = new THREE.BoxGeometry(0.075, 0.075, 0.075).rotateZ(0.6).rotateX(0.5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xc4dae0, transparent: true, opacity: 0.38, fog: false, depthWrite: false });
    const mesh = new THREE.InstancedMesh(precipGeo.rain, mat, RAIN);
    for (let i = 0; i < RAIN; i++) {
      rainPos[i * 3] = (Math.random() - 0.5) * 60;
      rainPos[i * 3 + 1] = -6 + Math.random() * 36;
      rainPos[i * 3 + 2] = -72 + Math.random() * 96;
      m4.makeTranslation(rainPos[i * 3], rainPos[i * 3 + 1], rainPos[i * 3 + 2]);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
  }

  // Drops fall (or embers rise) through a box that follows the squad; one that leaves the box
  // re-enters on the far side.
  function updateRain(dt, fz) {
    const a = rain.instanceMatrix.array, P = precip;
    for (let i = 0; i < RAIN; i++) {
      const o = i * 3, m = i * 16;
      rainPos[o] += (P.vx + (P.sway ? Math.sin(clock * 1.7 + i * 1.31) * P.sway : 0)) * dt;
      rainPos[o + 1] += P.vy * dt;
      if (rainPos[o + 1] < -6) { rainPos[o + 1] += 36; rainPos[o] = camX + (Math.random() - 0.5) * 60; }
      else if (rainPos[o + 1] > 30) { rainPos[o + 1] -= 36; rainPos[o] = camX + (Math.random() - 0.5) * 60; }
      if (rainPos[o] < camX - 30) rainPos[o] += 60; else if (rainPos[o] > camX + 30) rainPos[o] -= 60;
      let rz = (rainPos[o + 2] - (fz - 72)) % 96;
      if (rz < 0) rz += 96;
      rainPos[o + 2] = fz - 72 + rz;
      a[m + 12] = rainPos[o]; a[m + 13] = rainPos[o + 1]; a[m + 14] = rainPos[o + 2];
    }
    rain.instanceMatrix.needsUpdate = true;
  }

  // The sky is a screen-space gradient. It has to reach the fog colour exactly at the horizon
  // line, so that line's height on screen is worked out from the camera's pitch and field of
  // view, and the gradient is redrawn whenever the camera tilts (e.g. menu -> gameplay swoop).
  function drawSky() {
    if (!skyCanvas) {
      skyCanvas = document.createElement('canvas');
      skyCanvas.width = 4; skyCanvas.height = 256;
      skyTex = new THREE.CanvasTexture(skyCanvas);
      scene.background = skyTex;
    }
    const h = skyHorizon > 0 ? skyHorizon : 0.1;
    const x = skyCanvas.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, theme.skyTop);
    g.addColorStop(h * 0.62, theme.skyMid);
    g.addColorStop(h, theme.fog);
    g.addColorStop(1, theme.fog);
    x.fillStyle = g;
    x.fillRect(0, 0, 4, 256);
    skyTex.needsUpdate = true;
  }

  function trackHorizon() {
    const cam = W.camera;
    cam.getWorldDirection(tmp);
    const pitch = Math.asin(BB.clamp(-tmp.y, -1, 1));
    const half = THREE.MathUtils.degToRad(cam.fov / 2);
    let h = 0.5 - Math.tan(pitch) / Math.tan(half) / 2;
    h = isFinite(h) ? BB.clamp(h, 0.03, 0.92) : 0.1;
    if (Math.abs(h - skyHorizon) > 0.004) { skyHorizon = h; drawSky(); }
  }

  // ---------- water ----------

  // Six sine waves travelling in different directions. Summing their slopes gives a surface
  // normal per pixel, and the normal is what makes it read as water: it tilts how much sky is
  // reflected (Fresnel) and decides where the sun glints. The plane itself stays perfectly flat.
  function makeWater() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color() },
        uShallow: { value: new THREE.Color() },
        uSky: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() },
        uGlitter: { value: new THREE.Vector3(1, 1, 1) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uFogNear: { value: 70 },
        uFogFar: { value: 300 }
      },
      vertexShader: [
        'varying vec3 vWorld;',
        'void main() {',
        '  vec4 wp = modelMatrix * vec4(position, 1.0);',
        '  vWorld = wp.xyz;',
        '  gl_Position = projectionMatrix * viewMatrix * wp;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky; uniform vec3 uFog;',
        'uniform vec3 uGlitter; uniform vec3 uSunDir; uniform float uFogNear; uniform float uFogFar;',
        'varying vec3 vWorld;',
        // returns (height, d/dx, d/dz) of one wave
        'vec3 wave(vec2 p, vec2 dir, float freq, float speed, float amp) {',
        '  float ph = dot(p, dir) * freq + uTime * speed;',
        '  return vec3(amp * sin(ph), amp * freq * cos(ph) * dir);',
        '}',
        'void main() {',
        '  vec2 p = vWorld.xz;',
        '  float dist = distance(vWorld, cameraPosition);',
        '  float fine = 1.0 - smoothstep(50.0, 240.0, dist);',   // fade the small ripples out with distance or they alias into noise
        '  vec3 w = wave(p, vec2(0.857, 0.515), 0.085, 0.8, 1.0)',
        '         + wave(p, vec2(-0.573, 0.819), 0.15, 1.1, 0.6)',
        '         + wave(p, vec2(0.196, -0.981), 0.29, 1.6, 0.32)',
        '         + wave(p, vec2(-0.958, -0.287), 0.55, 2.2, 0.16 * fine)',
        '         + wave(p, vec2(0.664, 0.747), 1.05, 3.0, 0.08 * fine)',
        '         + wave(p, vec2(-0.3, -0.954), 2.1, 4.1, 0.035 * fine);',
        '  vec3 n = normalize(vec3(-w.y * 1.4, 1.0, -w.z * 1.4));',
        '  vec3 v = normalize(cameraPosition - vWorld);',
        '  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);',
        '  vec3 col = mix(uDeep, uShallow, smoothstep(-1.5, 1.7, w.x));',
        '  col = mix(col, uSky, fres * 0.6);',
        // The glints use a flatter copy of the normal. With the full, choppy normal the sun would
        // sparkle off half the sea; flattening it gathers the sparkle into one path towards the sun.
        '  vec3 ns = normalize(vec3(-w.y * 0.55, 1.0, -w.z * 0.55));',
        '  float nh = max(dot(ns, normalize(uSunDir + v)), 0.0);',
        // ...and a moving mask breaks that path into separate glints instead of one white smear
        // (three ripples at unrelated angles and speeds, so the glints never line up into a grid)
        '  float gl3 = sin(dot(p, vec2(1.7, 0.9)) + uTime * 2.6) + sin(dot(p, vec2(-0.8, 2.1)) - uTime * 2.1) + sin(dot(p, vec2(2.4, -1.3)) + uTime * 3.3);',
        '  float glint = smoothstep(0.5, 2.2, gl3);',
        '  col += uGlitter * (pow(nh, 320.0) * 1.1 * glint + pow(nh, 40.0) * 0.04);',
        '  float foam = smoothstep(1.45, 2.0, w.x + 0.35 * sin(p.x * 0.9 + uTime) * sin(p.y * 1.1 - uTime * 0.7));',
        '  col += foam * 0.16;',
        '  col = mix(col, uFog, smoothstep(uFogNear, uFogFar, dist));',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n')
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), mat);
    m.rotation.x = -Math.PI / 2;
    m.frustumCulled = false;
    return m;
  }

  // ---------- themes ----------

  function applyTheme(th) {
    theme = th;
    scene.fog.color.set(th.fog);
    hemi.color.setHex(th.hemiSky);
    hemi.groundColor.setHex(th.hemiGround);
    hemi.intensity = th.hemiI;
    sun.color.setHex(th.sun);
    sun.intensity = th.sunI;
    fill.color.setHex(th.hemiSky);
    fill.intensity = th.fillI;

    // What you see (disc, glitter) uses the sun's compass direction but its own, lower elevation.
    const el = THREE.MathUtils.degToRad(th.sunElev);
    const hl = Math.hypot(SUN_DIR.x, SUN_DIR.z);
    const vx = SUN_DIR.x / hl * Math.cos(el), vy = Math.sin(el), vz = SUN_DIR.z / hl * Math.cos(el);

    const u = water.material.uniforms;
    u.uDeep.value.set(th.deep);
    u.uShallow.value.set(th.shallow);
    u.uFog.value.set(th.fog);
    u.uSky.value.set(th.skyMid).lerp(scene.fog.color, 0.35);
    u.uGlitter.value.set(th.glitter[0], th.glitter[1], th.glitter[2]);
    u.uSunDir.value.set(vx, vy, vz);

    sunSprite.visible = !!th.disc;
    if (th.disc) {
      sunSprite.material.color.setRGB(th.disc[0], th.disc[1], th.disc[2]);
      sunSprite.scale.set(th.discSize, th.discSize, 1);
      sunSprite.position.set(vx * 760, vy * 760 + CAM_H, vz * 760);
    }
    // Clouds are seen from underneath, where only dim ground-bounce light reaches. Most of their
    // colour is therefore self-lit, so the bellies read as soft shade instead of going dark, and
    // the sunlit tops end up just over 1.0 and pick up a little glow.
    clouds.material.color.setHex(th.cloud).lerp(scene.fog.color, 0.25).multiplyScalar(0.36);
    clouds.material.emissive.setHex(th.cloud).lerp(scene.fog.color, 0.25).multiplyScalar(0.8);
    stars.visible = th.stars;

    precip = th.precip ? PRECIP[th.precip] : null;
    rain.visible = !!precip;
    if (precip) {
      rain.geometry = precipGeo[th.precip];
      rain.material.color.setRGB(precip.rgb[0], precip.rgb[1], precip.rgb[2]);
      rain.material.opacity = precip.op;
      rain.material.blending = precip.add ? THREE.AdditiveBlending : THREE.NormalBlending;
      rain.material.needsUpdate = true;
    }
    // far-off haze: the skyline is the fog colour with only a hint of its own
    city.material.color.setHex(th.city).lerp(scene.fog.color, 0.5);
    cityLights.visible = th.cityLit > 0;
    cityLights.material.color.setRGB(1.5 * th.cityLit, 1.3 * th.cityLit, 0.9 * th.cityLit);
    birds.visible = !!th.birds;
    if (th.birds) birds.material.color.setRGB(th.birds[0], th.birds[1], th.birds[2]);
    bolt = 0;
    boltMesh.visible = boltGlow.visible = false;
    drawSky();
  }

  // ---------- bridge ----------

  function deckTexture(base) {
    const S = 512, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const deckW = CFG.HALF_W * 2 + 1.4;
    const px = function (wx) { return (wx + deckW / 2) / deckW * S; };
    x.fillStyle = base;
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 5000; i++) {   // asphalt speckle
      x.fillStyle = Math.random() < 0.5
        ? 'rgba(0,0,0,' + (0.03 + Math.random() * 0.07) + ')'
        : 'rgba(255,255,255,' + (0.02 + Math.random() * 0.05) + ')';
      x.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    x.fillStyle = 'rgba(0,0,0,0.07)';           // worn tyre tracks, two per lane
    [-3.9, -2.1, 2.1, 3.9].forEach(function (wx) { x.fillRect(px(wx) - 10, 0, 20, S); });
    x.fillStyle = 'rgba(0,0,0,0.22)';           // expansion joint, once per repeat
    x.fillRect(0, 0, S, 4);
    x.fillStyle = 'rgba(255,255,255,0.85)';     // edge lines
    x.fillRect(px(-5.7) - 4, 0, 8, S);
    x.fillRect(px(5.7) - 4, 0, 8, S);
    x.fillStyle = 'rgba(255,214,90,0.9)';       // dashed centre line
    x.fillRect(px(0) - 5, S * 0.1, 10, S * 0.45);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  }

  function hazardTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 32;
    const x = c.getContext('2d');
    x.fillStyle = '#ffd23f';
    x.fillRect(0, 0, 256, 32);
    x.fillStyle = '#1a1a1a';
    for (let i = -2; i < 12; i++) {
      x.beginPath();
      x.moveTo(i * 32, 32); x.lineTo(i * 32 + 16, 32); x.lineTo(i * 32 + 48, 0); x.lineTo(i * 32 + 32, 0);
      x.fill();
    }
    return new THREE.CanvasTexture(c);
  }

  function disposeTree(root) {
    root.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
          if (m.map && !m.map.userData.shared) m.map.dispose();
          m.dispose();
        });
      }
    });
  }

  // Rebuilds all level-specific scenery: the deck is sized to the level, dividers sit where the
  // generator put them, and islands are scattered from a seed so each level has its own skyline.
  W.buildLevel = function (L) {
    if (levelGroup) { scene.remove(levelGroup); disposeTree(levelGroup); }
    levelGroup = new THREE.Group();
    scene.add(levelGroup);
    applyTheme(THEMES[L.theme]);

    const HW = CFG.HALF_W;
    const z0 = 50, z1 = -(L.length + 150), len = z0 - z1, zc = (z0 + z1) / 2;
    const add = function (mesh) { levelGroup.add(mesh); return mesh; };
    const lam = function (color) { return new THREE.MeshLambertMaterial({ color: color }); };
    const inst = function (geo, mat, n) {
      const m = add(new THREE.InstancedMesh(geo, mat, n));
      m.frustumCulled = false;
      return m;
    };

    // deck: only the top face carries the road texture
    const tex = deckTexture(theme.deck);
    tex.repeat.set(1, len / 12);
    const top = new THREE.MeshLambertMaterial({ map: tex });
    const side = lam(0x59616d);
    const deck = add(new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 1.4, 0.8, len), [side, side, top, side, side, side]));
    deck.position.set(0, -0.4, zc);
    deck.receiveShadow = true;

    // kerbs + guard rails
    const kerbMat = lam(0xc9ced6), railMat = lam(0x39424e);
    [-1, 1].forEach(function (sx) {
      const kerb = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, len), kerbMat));
      kerb.position.set(sx * (HW + 0.45), 0.35, zc);
      kerb.receiveShadow = true;
      const rail = add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, len), railMat));
      rail.position.set(sx * (HW + 0.45), 1.36, zc);
    });
    const nPost = Math.floor(len / 3);
    const posts = inst(new THREE.BoxGeometry(0.14, 0.62, 0.14), railMat, nPost * 2);
    for (let i = 0; i < nPost; i++) {
      m4.makeTranslation(-(HW + 0.45), 1.0, z0 - i * 3); posts.setMatrixAt(i * 2, m4);
      m4.makeTranslation(HW + 0.45, 1.0, z0 - i * 3);    posts.setMatrixAt(i * 2 + 1, m4);
    }

    // piers holding the deck above the water
    const pierMat = lam(0x7d8792);
    const nPier = Math.floor(len / 48);
    const legs = inst(new THREE.BoxGeometry(2.2, 16, 2.2), pierMat, nPier * 2);
    const beams = inst(new THREE.BoxGeometry(HW * 2 + 0.6, 1.3, 2.6), pierMat, nPier);
    for (let i = 0; i < nPier; i++) {
      const z = z0 - 54 - i * 48;
      m4.makeTranslation(-4.4, -9.4, z); legs.setMatrixAt(i * 2, m4);
      m4.makeTranslation(4.4, -9.4, z);  legs.setMatrixAt(i * 2 + 1, m4);
      m4.makeTranslation(0, -1.45, z);   beams.setMatrixAt(i, m4);
    }

    // Suspension towers every SPAN units, with a main cable hanging between each pair as a
    // parabola and a vertical hanger dropping from it to the deck every few units. Everything
    // sits outside the kerbs, so it frames the road without ever getting between camera and squad.
    const SPAN = 96, SEG = 12, CABLE_X = 7.5, TOP = 23.6, SAG = 4.2;
    const steel = lam(0xc2482d), cableMat = lam(0x93381f);
    const nTower = Math.ceil(len / SPAN) + 1;
    const tLegs = inst(new THREE.BoxGeometry(1.5, 37, 2.4), steel, nTower * 2);
    const tBeams = inst(new THREE.BoxGeometry(17.5, 1.5, 1.9), steel, nTower * 2);
    const cables = inst(new THREE.BoxGeometry(0.2, 0.2, 1), cableMat, nTower * 2 * SEG);
    const hangers = inst(new THREE.BoxGeometry(0.055, 1, 0.055), cableMat, nTower * 2 * SEG);
    tLegs.castShadow = tBeams.castShadow = true;
    const cableY = function (u) { const k = 2 * u - 1; return SAG + (TOP - SAG) * k * k; };
    let ci = 0, hi = 0;
    for (let t = 0; t < nTower; t++) {
      const z = z0 - 30 - t * SPAN;
      m4.makeTranslation(-8, 6.5, z);  tLegs.setMatrixAt(t * 2, m4);
      m4.makeTranslation(8, 6.5, z);   tLegs.setMatrixAt(t * 2 + 1, m4);
      m4.makeTranslation(0, 19.4, z);  tBeams.setMatrixAt(t * 2, m4);
      m4.makeTranslation(0, 24.2, z);  tBeams.setMatrixAt(t * 2 + 1, m4);
      for (let s = 0; s < SEG; s++) {
        const u0 = s / SEG, u1 = (s + 1) / SEG, y0 = cableY(u0), y1 = cableY(u1);
        const dy = y1 - y0, dz = -SPAN / SEG, segLen = Math.hypot(dy, dz);
        for (let sx = -1; sx <= 1; sx += 2) {
          dummy.position.set(sx * CABLE_X, (y0 + y1) / 2, z - SPAN * (u0 + u1) / 2);
          dummy.rotation.set(Math.atan2(-dy, dz), 0, 0);    // tip the unit-length box onto the cable's slope
          dummy.scale.set(1, 1, segLen);
          dummy.updateMatrix();
          cables.setMatrixAt(ci++, dummy.matrix);
          const h = y1 + 0.3;
          dummy.position.set(sx * CABLE_X, -0.3 + h / 2, z - SPAN * u1);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, s === SEG - 1 ? 0.0001 : h, 1);   // no hanger where the tower leg already stands
          dummy.updateMatrix();
          hangers.setMatrixAt(hi++, dummy.matrix);
        }
      }
    }

    // street lamps: glowing heads, and after dark a warm pool of light on the road under each
    const lampOn = theme.lamp;
    const headMat = new THREE.MeshBasicMaterial();
    if (lampOn > 0) headMat.color.setRGB(1 + 1.8 * lampOn, 0.95 + 1.3 * lampOn, 0.8 + 0.5 * lampOn);
    else headMat.color.setRGB(0.82, 0.83, 0.8);
    const nLamp = Math.floor(len / 24);
    const poles = inst(new THREE.BoxGeometry(0.14, 5.3, 0.14), railMat, nLamp * 2);
    const arms = inst(new THREE.BoxGeometry(1.6, 0.1, 0.1), railMat, nLamp * 2);
    const heads = inst(new THREE.BoxGeometry(0.6, 0.12, 0.32), headMat, nLamp * 2);
    let pools = null;
    if (lampOn > 0) {
      const poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      poolMat.color.setRGB(0.55 * lampOn, 0.42 * lampOn, 0.22 * lampOn);
      pools = inst(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), poolMat, nLamp * 2);
    }
    for (let i = 0; i < nLamp; i++) {
      const z = z0 - 18 - i * 24;
      for (let k = 0; k < 2; k++) {
        const sx = k ? 1 : -1;
        m4.makeTranslation(sx * (HW + 0.45), 3.35, z); poles.setMatrixAt(i * 2 + k, m4);
        m4.makeTranslation(sx * (HW - 0.3), 5.95, z);  arms.setMatrixAt(i * 2 + k, m4);
        m4.makeTranslation(sx * (HW - 1.0), 5.86, z);  heads.setMatrixAt(i * 2 + k, m4);
        if (pools) { m4.makeTranslation(sx * (HW - 1.6), 0.03, z); pools.setMatrixAt(i * 2 + k, m4); }
      }
    }

    // lane dividers (the orange wall you commit to a side of)
    const divMat = lam(0xf28c28), capMat = lam(0xffd9a0);
    L.dividers.forEach(function (dv) {
      const wall = add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.85, dv.d1 - dv.d0), divMat));
      wall.position.set(0, 0.425, -(dv.d0 + dv.d1) / 2);
      wall.castShadow = true;
      wall.receiveShadow = true;
      const cap = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, dv.d1 - dv.d0), capMat));
      cap.position.set(0, 0.9, -(dv.d0 + dv.d1) / 2);
    });

    // hazard stripe where the boss arena starts
    const stripe = add(new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, 1.4), new THREE.MeshBasicMaterial({ map: hazardTexture() })));
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0, 0.02, -(L.length + 4));

    // The bridge's own shadow on the sea, pushed sideways by the sun angle. A flat dark strip is
    // far cheaper than real shadows on the water and anchors the bridge above it just as well.
    const drop = -WATER_Y / SUN_DIR.y;
    const shade = add(new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 + 3.5, len).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x00060f, transparent: true, opacity: 0.3, depthWrite: false })));
    shade.position.set(-SUN_DIR.x * drop, WATER_Y + 0.06, zc - SUN_DIR.z * drop);

    // What stands in the sea depends on the biome: sandy islands, icebergs or volcanoes.
    const rng = BB.mulberry32(L.level * 31 + 7);
    const flat = function (color, glow) {
      const m = new THREE.MeshPhongMaterial({ color: color, flatShading: true, shininess: 0 });
      if (glow) m.emissive.setHex(glow);
      return m;
    };
    const nIsland = 10 + Math.floor(len / 60);
    if (theme.isle === 'ice') {
      // the faint blue self-glow keeps the shaded faces glacier-blue instead of dirty grey
      const iceMat = flat(0xeef8ff, 0x2c4a66), blueMat = flat(0xa9dcf2, 0x1d3f5c), floeMat = flat(0xf6fbff, 0x33506a);
      for (let i = 0; i < nIsland; i++) {
        const sx = i % 2 ? 1 : -1;
        const x = sx * (36 + rng() * 150), z = z0 - rng() * (len + 220), r = 6 + rng() * 16;
        const bergs = 1 + Math.floor(rng() * 3);
        for (let h = 0; h < bergs; h++) {
          const br = r * (0.45 + rng() * 0.5);
          const berg = add(new THREE.Mesh(new THREE.IcosahedronGeometry(br, 0), rng() < 0.7 ? iceMat : blueMat));
          berg.scale.set(1, 0.8 + rng() * 1.1, 0.7 + rng() * 0.5);
          berg.position.set(x + (rng() - 0.5) * r * 1.2, WATER_Y + br * 0.15, z + (rng() - 0.5) * r * 1.2);
          berg.rotation.set(rng() * 0.5, rng() * 6, rng() * 0.5);
        }
      }
      // pack ice drifting right beside the bridge, where you actually look
      const nFloe = Math.floor(len / 9);
      const floes = inst(new THREE.CylinderGeometry(1, 1.12, 0.5, 6), floeMat, nFloe);
      for (let i = 0; i < nFloe; i++) {
        const sx = rng() < 0.5 ? -1 : 1, fr = 1.2 + rng() * 3.4;
        dummy.position.set(sx * (10.5 + rng() * 34), WATER_Y + 0.12, z0 - rng() * len);
        dummy.rotation.set(0, rng() * 6, 0);
        dummy.scale.set(fr, 1, fr * (0.7 + rng() * 0.5));
        dummy.updateMatrix();
        floes.setMatrixAt(i, dummy.matrix);
      }
    } else if (theme.isle === 'volcano') {
      const rockMat = flat(0x2c2428), ashMat = flat(0x3a3034);
      const lavaMat = new THREE.MeshBasicMaterial();
      lavaMat.color.setRGB(3.6, 0.95, 0.14);
      for (let i = 0; i < nIsland; i++) {
        const sx = i % 2 ? 1 : -1;
        const x = sx * (38 + rng() * 150), z = z0 - rng() * (len + 220), r = 8 + rng() * 18;
        const h = r * (0.8 + rng() * 0.7), seg = 7 + Math.floor(rng() * 3);
        const base = add(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.1, r * 1.3, 1.2, 10), ashMat));
        base.position.set(x, WATER_Y + 0.2, z);
        const cone = add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.26, r, h, seg), rockMat));
        cone.position.set(x, WATER_Y + 0.6 + h / 2, z);
        cone.rotation.y = rng() * 6;
        const crater = add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.2, 0.5, seg), lavaMat));
        crater.position.set(x, WATER_Y + 0.6 + h, z);
        // one lava flow running down the flank that faces the bridge
        const flow = add(new THREE.Mesh(new THREE.BoxGeometry(r * 0.09, h * 1.02, r * 0.09), lavaMat));
        flow.position.set(x - sx * r * 0.62, WATER_Y + 0.6 + h / 2, z);
        flow.rotation.z = -sx * Math.atan2(r * 0.74, h);
      }
    } else {
      const sandMat = flat(0xe6d5a0), greenMat = flat(0x4f9a4a), rockMat = flat(0x7b7f86);
      for (let i = 0; i < nIsland; i++) {
        const sx = i % 2 ? 1 : -1;
        const x = sx * (40 + rng() * 150), z = z0 - rng() * (len + 220), r = 7 + rng() * 20;
        const sand = add(new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.2, 1.4, 12), sandMat));
        sand.position.set(x, WATER_Y + 0.3, z);
        const hills = 1 + Math.floor(rng() * 3);
        for (let h = 0; h < hills; h++) {
          const hr = r * (0.35 + rng() * 0.4), hh = r * (0.35 + rng() * 0.8);
          const hill = add(new THREE.Mesh(new THREE.ConeGeometry(hr, hh, 6 + Math.floor(rng() * 3)), rng() < 0.65 ? greenMat : rockMat));
          hill.position.set(x + (rng() - 0.5) * r * 0.8, WATER_Y + 1 + hh / 2, z + (rng() - 0.5) * r * 0.8);
          hill.rotation.y = rng() * 6;
        }
      }
    }
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);

    // Boats out on the water: sailing dinghies close in, the odd container ship further off.
    boats.length = 0;
    if (theme.boats) {
      const brng = BB.mulberry32(L.level * 53 + 19);
      const nBoat = 3 + Math.floor(len / 150);
      for (let i = 0; i < nBoat; i++) {
        const big = brng() < 0.3, sx = brng() < 0.5 ? -1 : 1;
        const g = big ? makeShip(brng) : makeSailboat(brng);
        g.position.set(sx * (big ? 30 + brng() * 22 : 14 + brng() * 16), WATER_Y, z0 - 40 - (i + brng() * 0.8) * (len - 60) / nBoat);
        const fwd = brng() < 0.5 ? 1 : -1;       // some sail with you, some against
        g.rotation.y = fwd > 0 ? 0 : Math.PI;
        levelGroup.add(g);
        boats.push({ g: g, ph: brng() * 6.283, v: fwd * (big ? 1.6 : 0.9 + brng() * 0.8), roll: big ? 0.012 : 0.05, bob: big ? 0.1 : 0.22 });
      }
    }
  };

  function makeSailboat(rng) {
    const g = new THREE.Group();
    const lam = function (c) { return new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide }); };
    const hullCol = [0xf4f4f0, 0x2d5d9c, 0xc8442e, 0x2a8a7a][Math.floor(rng() * 4)];
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.0, 4.2), lam(hullCol));
    hull.position.y = 0.25;
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.9, 4).rotateY(Math.PI / 4).rotateX(-Math.PI / 2).scale(1.42, 0.83, 1), hull.material);
    bow.position.set(0, 0.25, -3.05);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.12, 6.6, 0.12), lam(0x4a3a2a));
    mast.position.set(0, 4, -0.3);
    const tri = function (pts) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
      geo.computeVertexNormals();
      return geo;
    };
    const sailMat = lam(0xfbf7ea);
    sailMat.emissive.setHex(0x55524a);   // sails stay bright even in shade
    const main = new THREE.Mesh(tri([0.08, 1.3, -0.2, 0.08, 7.1, -0.2, 0.5, 1.3, 2.3]), sailMat);
    const jib = new THREE.Mesh(tri([-0.08, 1.2, -0.45, -0.08, 6.2, -0.45, -0.3, 1.2, -2.7]), sailMat);
    [hull, bow, mast, main, jib].forEach(function (m) { g.add(m); });
    return g;
  }

  function makeShip(rng) {
    const g = new THREE.Group();
    const lam = function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
    const hull = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.6, 17), lam(rng() < 0.5 ? 0x7a2a26 : 0x24364f));
    hull.position.y = 0.7;
    g.add(hull);
    const cols = [0xc8442e, 0x2d7fb8, 0xe0a02a, 0x3a9a5c, 0xd9d9d2, 0x8a4fb0];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 2; c++) {
        const h = 1.1 + Math.floor(rng() * 3) * 1.1;
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.9, h, 2.7), lam(cols[Math.floor(rng() * cols.length)]));
        box.position.set(c ? 1.05 : -1.05, 2 + h / 2, -6.3 + r * 3);
        g.add(box);
      }
    }
    const house = new THREE.Mesh(new THREE.BoxGeometry(4, 3.4, 2.6), lam(0xf0f0ea));
    house.position.set(0, 3.7, 6.6);
    g.add(house);
    const lit = new THREE.MeshBasicMaterial();
    lit.color.setRGB(2.4, 2.0, 1.1);     // the wheelhouse windows are always on: they bloom after dark
    const win = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.45, 2.7), lit);
    win.position.set(0, 4.7, 6.6);
    g.add(win);
    const funnel = new THREE.Mesh(new THREE.BoxGeometry(1, 1.8, 1), lam(0x23262e));
    funnel.position.set(0, 6.2, 7);
    g.add(funnel);
    return g;
  }

  // ---------- per-frame ----------

  function place(dt, fz) {
    lastFz = fz;
    shake = Math.max(0, shake - dt * 2.4);
    const s = shake * shake * 0.9;
    const cam = W.camera;

    // Blend between the gameplay chase camera and a low, slowly drifting hero shot for the menu.
    menuBlend = BB.damp(menuBlend, menuGoal, 3.2, dt);
    const m = menuBlend * menuBlend * (3 - 2 * menuBlend);
    const drift = Math.sin(clock * 0.35) * 0.8 * m;
    let px = BB.lerp(camX, -5.2 + drift, m), py = BB.lerp(CAM_H, 3.9, m), pz = fz + BB.lerp(CAM_BACK, 9.5, m);
    let lx = BB.lerp(camX * 0.85, 0.6, m), ly = BB.lerp(1, 0.3, m), lz = fz - BB.lerp(CAM_AHEAD, 5, m);

    // Boss entrance: fly to a low spot in front of the monster and look up at it, then back again.
    cine = BB.damp(cine, cineGoal, cineGoal ? 4.2 : 5.5, dt);
    if (cine > 0.001) {
      const c = cine * cine * (3 - 2 * cine), sway = Math.sin(clock * 0.7) * 1.2;
      px = BB.lerp(px, cineX - 7 + sway, c); py = BB.lerp(py, 2.4, c); pz = BB.lerp(pz, cineZ + 17.5, c);
      lx = BB.lerp(lx, cineX, c);            ly = BB.lerp(ly, 6.4, c); lz = BB.lerp(lz, cineZ, c);
    }

    // A punch of extra field of view for big moments; it relaxes back on its own.
    fovKick = Math.max(0, fovKick - dt * 1.5);
    const fov = fovBase + fovKick * fovKick * 9;
    if (Math.abs(fov - cam.fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }

    cam.position.set(px + (Math.random() - 0.5) * s, py + (Math.random() - 0.5) * s, pz);
    cam.lookAt(lx, ly, lz);
    cam.updateMatrixWorld();   // so project() is correct before the frame is rendered
    trackHorizon();

    const tz = Math.round(fz / SHADOW_SNAP) * SHADOW_SNAP;
    sun.target.position.set(0, 0, tz);
    sun.position.set(SUN_DIR.x * 80, SUN_DIR.y * 80, tz + SUN_DIR.z * 80);
    sun.target.updateMatrixWorld();
    water.position.set(0, WATER_Y, cam.position.z - 280);
    far.position.set(cam.position.x, 0, cam.position.z);
  }

  W.update = function (dt, fx, fz) {
    clock += dt;
    water.material.uniforms.uTime.value = clock;
    camX = BB.damp(camX, fx * 0.5, 6, dt);
    const vz = dt > 0 ? BB.clamp((fz - lastFz) / dt, -30, 30) : 0;   // how fast the squad is running up the bridge
    place(dt, fz);

    if (precip) updateRain(dt, fz);
    if (birds.visible) updateBirds(dt, fz, vz);
    for (let i = 0; i < boats.length; i++) {   // bob and roll on the swell, and keep sailing
      const b = boats[i], g = b.g;
      g.position.z -= b.v * dt;
      g.position.y = WATER_Y + Math.sin(clock * 0.9 + b.ph) * b.bob;
      g.rotation.z = Math.sin(clock * 0.7 + b.ph) * b.roll;
      g.rotation.x = Math.sin(clock * 0.55 + b.ph * 1.7) * b.roll * 0.6;
    }

    if (theme.bolts) {
      // lightning: a bolt hits the sea beside the bridge, with the thunder arriving a beat late
      boltT -= dt;
      if (boltT <= 0) { boltT = 4 + Math.random() * 7; bolt = 1; strike(fz); BB.Audio.thunder(); }
    }
    if (bolt > 0) bolt = Math.max(0, bolt - dt * 3);
    const fl = bolt > 0 ? bolt * (0.55 + 0.45 * Math.sin(clock * 75)) : 0;
    boltMesh.visible = boltGlow.visible = bolt > 0.35 && Math.sin(clock * 90) > -0.5;   // it stutters like the real thing
    hemi.intensity = theme.hemiI * (1 + fl * 2.2);
    BB.Post.exposure = 1 + fl * 0.45;
  };

  W.snapCamera = function (fx, fz) { camX = fx * 0.5; shake = 0; lastFz = fz; place(0, fz); };
  W.setMenu = function (on, snap) { menuGoal = on ? 1 : 0; if (snap) menuBlend = menuGoal; };
  // (x, z) = where the boss stands, in world space
  W.setCine = function (on, x, z, snap) {
    cineGoal = on ? 1 : 0;
    if (on) { cineX = x; cineZ = z; }
    if (snap) cine = cineGoal;
  };
  W.kick = function (a) { fovKick = Math.min(1.2, Math.max(fovKick, a)); };
  // Anything that shakes the camera also splits the colours a little at the screen edges (post.js).
  W.addShake = function (a) { shake = Math.min(1.6, shake + a); BB.Post.kick(a); };
  W.render = function (dt) { BB.Post.render(scene, W.camera, dt); };

  // World position -> CSS pixel position, for DOM overlays such as the squad badge.
  W.project = function (x, y, z, out) {
    tmp.set(x, y, z).project(W.camera);
    out.x = (tmp.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-tmp.y * 0.5 + 0.5) * window.innerHeight;
    out.visible = tmp.z > -1 && tmp.z < 1;
    return out;
  };

  W.resize = function () {
    // A tab that is still opening can report a 0x0 window; never let that turn into a NaN camera.
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight), cam = W.camera;
    W.renderer.setSize(w, h, false);
    W.renderer.getDrawingBufferSize(size);
    BB.Post.resize(size.x, size.y);
    cam.aspect = w / h;
    // Widen the field of view on tall screens so the whole bridge always fits across.
    cam.fov = fovBase = BB.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(0.345 / cam.aspect)), 48, 88);
    cam.updateProjectionMatrix();
    place(0, lastFz);
  };
})(window.BB);
