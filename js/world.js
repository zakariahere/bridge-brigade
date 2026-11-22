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
      sun: 0xfff1d6, sunI: 0.78, hemiSky: 0xcfeaff, hemiGround: 0x6a7f8f, hemiI: 0.6, fillI: 0.2, deck: '#757b84', rim: 0.42, sheen: [34, 0.05],
      sunElev: 24, disc: [3.0, 2.7, 2.1], discSize: 150, glitter: [1.7, 1.55, 1.2], cloud: 0xffffff, lamp: 0, stars: false,
      precip: null, isle: 'tropic', birds: [1.04, 1.04, 1.0], boats: true, city: 0x5f86ad, cityLit: 0, bolts: false },
    { name: 'Sunset', skyTop: '#27286c', skyMid: '#c4567c', fog: '#f4a877', deep: '#2c2a6e', shallow: '#d86f86',
      sun: 0xffa868, sunI: 0.8, hemiSky: 0xffc2a0, hemiGround: 0x54466a, hemiI: 0.56, fillI: 0.16, deck: '#7a747c', rim: 0.5, sheen: [40, 0.09],
      sunElev: 4, disc: [3.4, 1.7, 0.7], discSize: 260, glitter: [2.4, 1.2, 0.5], cloud: 0xffb0a8, lamp: 0.55, stars: false,
      precip: null, isle: 'tropic', birds: [0.2, 0.12, 0.17], boats: true, city: 0x3a2350, cityLit: 0.7, bolts: false },
    { name: 'Frost', skyTop: '#2f5f9c', skyMid: '#a5d0ea', fog: '#d9eaf3', deep: '#0c4466', shallow: '#58b0cc',
      sun: 0xf2faff, sunI: 0.72, hemiSky: 0xe4f3ff, hemiGround: 0x7c93a8, hemiI: 0.66, fillI: 0.22, deck: '#8d969f', rim: 0.45, sheen: [50, 0.12],
      sunElev: 13, disc: [2.6, 2.7, 2.9], discSize: 170, glitter: [1.5, 1.7, 1.9], cloud: 0xf2f7ff, lamp: 0.25, stars: false,
      precip: 'snow', isle: 'ice', birds: [1.04, 1.07, 1.1], boats: true, city: 0x6f8fb0, cityLit: 0.3, bolts: false },
    { name: 'Night', skyTop: '#01030c', skyMid: '#0a1636', fog: '#172850', deep: '#020d24', shallow: '#12507c',
      sun: 0x9fc0ff, sunI: 0.5, hemiSky: 0x6f8fd0, hemiGround: 0x1a2440, hemiI: 0.6, fillI: 0.14, deck: '#5d6373', rim: 0.6, sheen: [44, 0.12],
      sunElev: 27, disc: [1.9, 2.1, 2.5], discSize: 90, glitter: [0.8, 0.95, 1.3], cloud: 0x33466e, lamp: 1, stars: true,
      precip: null, isle: 'tropic', birds: null, boats: true, city: 0x070d24, cityLit: 1.7, bolts: false },
    { name: 'Storm', skyTop: '#121a21', skyMid: '#46605c', fog: '#7f9d8f', deep: '#0c3434', shallow: '#3f957c',
      sun: 0xdaf5e4, sunI: 0.5, hemiSky: 0xb0d0c0, hemiGround: 0x38483f, hemiI: 0.6, fillI: 0.16, deck: '#6c7571', rim: 0.42, sheen: [90, 0.34],
      sunElev: 20, disc: null, discSize: 0, glitter: [0.35, 0.45, 0.42], cloud: 0x66756f, lamp: 0.75, stars: false,
      precip: 'rain', isle: 'tropic', birds: null, boats: true, city: 0x2a3a38, cityLit: 0.9, bolts: true },
    { name: 'Ember', skyTop: '#0c0406', skyMid: '#5c1a12', fog: '#8a3c20', deep: '#190606', shallow: '#b4380e',
      sun: 0xff9a5c, sunI: 0.62, hemiSky: 0xffa078, hemiGround: 0x34161a, hemiI: 0.62, fillI: 0.2, deck: '#5e5557', rim: 0.5, sheen: [40, 0.08],
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

  // The light comes from ahead and well off to the right. Lit from the side like that, the
  // three faces of a box you can see are three different brightnesses, which is what makes it
  // look like a box; lit from straight ahead, the two sides come out the same and it goes flat.
  // Shadows fall back towards the camera and to the left.
  const SUN_DIR = new THREE.Vector3(0.38, 0.8, -0.46).normalize();
  // The sun you see in the sky stays closer to straight ahead, where it can be in the picture.
  const SUN_SEEN = new THREE.Vector2(0.2, -0.56).normalize();
  // How the three lights are balanced: a strong sun, a weaker sky, and a cool fill from the left.
  const SUN_K = 1.22, HEMI_K = 0.8, FILL_K = 1.5;
  const SHADOW_SNAP = 0.25;
  const RAIN = 600, BIRDS = 14, BOLT_SEGS = 16;

  // Phones and tablets get a lighter picture: shadows only on the bridge itself, and no mirror
  // image of the world in the sea. Everything else is the same.
  const LITE = W.lite = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
  const SUN_DIST = LITE ? 80 : 150;

  let scene, sun, fill, hemi, water, far, sunSprite, clouds, stars, rain, levelGroup = null, theme = THEMES[0];
  let mirrorRT = null, mirrorCam = null;
  const mirrorPlane = new THREE.Plane(), clipPlane = new THREE.Vector4(), clipQ = new THREE.Vector4(), aim = new THREE.Vector3();
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
  const boats = W.boats = [], birdData = [];
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

    // One shadow-casting sun. Its shadow box slides along with the squad. On a computer the box
    // takes in the sea and everything on it for some sixty units either side of the bridge, so
    // ships, ice and the water itself are shaded too; on a phone it only fits the bridge.
    sun = new THREE.DirectionalLight(0xffffff, 0.78);
    sun.castShadow = true;
    fitShadow();
    scene.add(sun);
    scene.add(sun.target);

    // A shadowless light from the camera's left, in the colour of the sky. It keeps the faces
    // that look at the camera from going flat grey, and it cools the side the sun does not reach.
    fill = new THREE.DirectionalLight(0xffffff, 0.2);
    fill.position.set(-75, 38, 56);
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

    if (!LITE) {
      // the mirror image of the world, drawn once a frame for the sea to reflect (see drawMirror)
      mirrorRT = new THREE.WebGLRenderTarget(4, 4, {
        type: BB.Post.supported ? THREE.HalfFloatType : THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter
      });
      mirrorCam = new THREE.PerspectiveCamera();
      water.material.uniforms.tMirror.value = mirrorRT.texture;
      water.material.uniforms.uMirror.value = 1;
    }

    W.resize();
    window.addEventListener('resize', W.resize);
  };

  // The shadow map is a picture taken from the sun, looking down a box-shaped view. As the squad
  // runs the box follows in steps of SHADOW_SNAP. If one step moved the picture by a fraction of
  // a texel, every shadow edge would shimmer, so the box is sized to make a step exactly kx
  // texels sideways and ky texels lengthways. The sizes follow from the sun's direction.
  function fitShadow() {
    const N = LITE ? 2048 : 4096;
    // the part of the world to cover, measured from the squad: x either side, y up, z0 behind to z1 ahead
    const B = LITE ? { x: 9, y0: -1, y1: 26, z0: 22, z1: -74 } : { x: 58, y0: WATER_Y - 0.5, y1: 12, z0: 20, z1: -92 };
    // the sun's own left/right and up/down axes, as lookAt() builds them
    const zh = SUN_DIR, flat = Math.hypot(zh.x, zh.z);
    const xh = new THREE.Vector3(zh.z / flat, 0, -zh.x / flat), yh = new THREE.Vector3().crossVectors(zh, xh);
    const lo = new THREE.Vector3(1e9, 1e9, 1e9), hi = new THREE.Vector3(-1e9, -1e9, -1e9), p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {      // where the eight corners of that region land in the sun's view
      p.set(i & 1 ? B.x : -B.x, i & 2 ? B.y1 : B.y0, i & 4 ? B.z1 : B.z0);
      tmp.set(p.dot(xh), p.dot(yh), p.dot(zh));
      lo.min(tmp); hi.max(tmp);
    }
    // One step of the squad moves the picture this far each way. The box is made the smallest
    // size that still covers the region and turns that into a whole number of texels.
    const stepX = SHADOW_SNAP * Math.abs(xh.z), stepY = SHADOW_SNAP * Math.abs(yh.z);
    const kx = Math.max(1, Math.floor(N * stepX / (hi.x - lo.x))), ky = Math.max(1, Math.floor(N * stepY / (hi.y - lo.y)));
    const w = N * stepX / kx, h = N * stepY / ky, cx = (lo.x + hi.x) / 2, cy = (lo.y + hi.y) / 2;
    const sc = sun.shadow.camera;
    sun.shadow.mapSize.set(N, N);
    sc.left = cx - w / 2; sc.right = cx + w / 2;
    sc.bottom = cy - h / 2; sc.top = cy + h / 2;
    sc.near = Math.max(1, SUN_DIST - hi.z - 30);       // room above for towers and the kaiju
    sc.far = SUN_DIST - lo.z + 4;
    sun.shadow.bias = -0.075 / (sc.far - sc.near);     // a fixed 7.5 cm, whatever the depth range
    sc.updateProjectionMatrix();
  }

  // ---------- materials ----------

  // Every lit surface is made here. Two things are added to plain matte shading:
  //   gloss - a highlight where the surface mirrors the sun towards the camera
  //   rim   - a little of the sky's colour where a surface turns edge-on to the camera
  // Both change as the camera moves, and that change is a large part of what makes a shape look solid.
  const rimU = { value: new THREE.Color(0, 0, 0) };
  function rimPatch(shader) {
    shader.uniforms.uRim = rimU;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 uRim;\nvoid main() {')
      .replace('#include <output_fragment>', [
        'float bbRim = 1.0 - saturate(dot(normalize(normal), normalize(vViewPosition)));',
        'outgoingLight += uRim * (bbRim * bbRim * bbRim) * (0.35 + 0.65 * diffuseColor.rgb);',
        '#include <output_fragment>'
      ].join('\n'));
  }
  // o: { gloss, spec, flat, map, vertexColors, glow, side }
  W.mat = function (color, o) {
    o = o || {};
    const m = new THREE.MeshPhongMaterial({ color: color, flatShading: !!o.flat, shininess: o.gloss || 1, side: o.side || THREE.FrontSide });
    m.specular.setScalar(o.gloss ? (o.spec === undefined ? 0.25 : o.spec) : 0);
    if (o.map) m.map = o.map;
    if (o.vertexColors) m.vertexColors = true;
    if (o.glow) m.emissive.setHex(o.glow);
    m.onBeforeCompile = rimPatch;
    return m;
  };
  // Marks a mesh (or a whole group) as both casting and catching shadows.
  function solid(o) {
    o.traverse(function (m) { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    return o;
  }

  // Many boxes, one mesh. Each entry is [w, h, d, x, y, z, colour] with an optional turn about
  // the vertical axis. Detail is cheap this way: fifty boxes still cost a single draw.
  function boxes(list) {
    const pos = [], nor = [], uv = [], col = [], c = new THREE.Color();
    list.forEach(function (b) {
      let g = new THREE.BoxGeometry(b[0], b[1], b[2]);
      if (b[7]) g.rotateY(b[7]);
      g.translate(b[3], b[4], b[5]);
      g = g.toNonIndexed();
      const p = g.attributes.position.array, n = g.attributes.normal.array, t = g.attributes.uv.array;
      c.setHex(b[6]);
      for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
      for (let i = 0; i < t.length; i++) uv.push(t[i]);
      for (let i = 0; i < p.length; i += 3) col.push(c.r, c.g, c.b);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return geo;
  }

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
  // normal per pixel, and the normal is what makes it read as water: it tilts how much is
  // reflected (Fresnel), bends the reflection, and decides where the sun glints. The plane itself
  // stays perfectly flat.
  //
  // What it reflects is real: the mirror image of the scene (drawMirror) where something stands
  // above the water, and the sky in that direction everywhere else. It also takes the sun's
  // shadow map like any other surface, so the bridge, the ships and the kaiju darken the sea.
  function makeWater() {
    const mat = new THREE.ShaderMaterial({
      lights: true,   // not for lighting: this is what makes three.js hand the shader its shadow map
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.lights, {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color() },
        uShallow: { value: new THREE.Color() },
        uSkyTop: { value: new THREE.Color() },
        uSkyMid: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() },
        uGlitter: { value: new THREE.Vector3(1, 1, 1) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uFogNear: { value: 70 },
        uFogFar: { value: 300 },
        tMirror: { value: null },
        uMirrorM: { value: new THREE.Matrix4() },
        uMirror: { value: 0 }
      }]),
      vertexShader: [
        '#include <common>',
        '#include <shadowmap_pars_vertex>',
        'varying vec3 vWorld;',
        'void main() {',
        '  #include <beginnormal_vertex>',
        '  #include <defaultnormal_vertex>',
        '  #include <begin_vertex>',
        '  #include <project_vertex>',
        '  #include <worldpos_vertex>',
        '  #include <shadowmap_vertex>',
        '  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;',
        '}'
      ].join('\n'),
      fragmentShader: [
        '#include <common>',
        '#include <packing>',
        '#include <bsdfs>',
        '#include <lights_pars_begin>',
        '#include <shadowmap_pars_fragment>',
        '#include <shadowmask_pars_fragment>',
        'uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSkyTop; uniform vec3 uSkyMid; uniform vec3 uFog;',
        'uniform vec3 uGlitter; uniform vec3 uSunDir; uniform float uFogNear; uniform float uFogFar;',
        'uniform sampler2D tMirror; uniform mat4 uMirrorM; uniform float uMirror;',
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
        '  float lit = getShadowMask();',
        '  vec3 col = mix(uDeep, uShallow, smoothstep(-1.5, 1.7, w.x));',
        '  col *= mix(vec3(0.46, 0.52, 0.66), vec3(1.0), lit);',   // in shade the sea keeps its blue and loses its brightness
        // the sky in the direction the surface mirrors: haze at the horizon, deep colour overhead
        '  float up = abs(reflect(-v, n).y);',
        '  vec3 sky = mix(mix(uFog, uSkyMid, smoothstep(0.0, 0.28, up)), uSkyTop, smoothstep(0.25, 0.95, up));',
        // The mirror image is looked up where this point of the sea lands in it, nudged along the
        // wave slope so reflections wobble. Its alpha says how much of the sky it covers there.
        '  vec4 mc = uMirrorM * vec4(vWorld, 1.0);',
        '  vec2 muv = mc.xy / mc.w + n.xz * vec2(0.05, 0.11) * (0.25 + 0.75 * fine);',
        '  vec4 mir = texture2D(tMirror, clamp(muv, 0.002, 0.998)) * uMirror;',
        '  vec3 seen = min(mir.rgb, vec3(6.0)) + sky * (1.0 - min(mir.a, 1.0));',
        '  col = mix(col, seen, clamp(0.07 + fres * 0.8, 0.0, 1.0));',
        // The glints use a flatter copy of the normal. With the full, choppy normal the sun would
        // sparkle off half the sea; flattening it gathers the sparkle into one path towards the sun.
        '  vec3 ns = normalize(vec3(-w.y * 0.55, 1.0, -w.z * 0.55));',
        '  float nh = max(dot(ns, normalize(uSunDir + v)), 0.0);',
        // ...and a moving mask breaks that path into separate glints instead of one white smear
        // (three ripples at unrelated angles and speeds, so the glints never line up into a grid)
        '  float gl3 = sin(dot(p, vec2(1.7, 0.9)) + uTime * 2.6) + sin(dot(p, vec2(-0.8, 2.1)) - uTime * 2.1) + sin(dot(p, vec2(2.4, -1.3)) + uTime * 3.3);',
        '  float glint = smoothstep(0.5, 2.2, gl3);',
        '  col += uGlitter * (pow(nh, 320.0) * 1.1 * glint + pow(nh, 40.0) * 0.04) * lit;',
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
    m.receiveShadow = true;
    return m;
  }

  // Draws the scene as its own reflection would see it: from a camera that is the real one
  // mirrored below the surface of the sea. Two details make it work. The view is cut off at the
  // waterline (by slanting the camera's near plane to lie along it), or things under the surface
  // would appear in their own reflection. And the sky is left out, so the picture's alpha says
  // where something actually stands; the water fills in the sky itself.
  function drawMirror() {
    const cam = W.camera, r = W.renderer, c = mirrorCam;
    cam.getWorldDirection(aim);
    c.position.set(cam.position.x, 2 * WATER_Y - cam.position.y, cam.position.z);
    c.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    c.up.y = -c.up.y;
    c.lookAt(cam.position.x + aim.x, 2 * WATER_Y - (cam.position.y + aim.y), cam.position.z + aim.z);
    c.updateMatrixWorld();
    c.projectionMatrix.copy(cam.projectionMatrix);

    // where a point of the sea lands in the mirror picture (0..1 across and up)
    water.material.uniforms.uMirrorM.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);

    // slant the near plane onto the waterline (Lengyel's oblique frustum)
    mirrorPlane.set(up, -(WATER_Y - 0.12)).applyMatrix4(c.matrixWorldInverse);
    clipPlane.set(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z, mirrorPlane.constant);
    const e = c.projectionMatrix.elements;
    clipQ.set((Math.sign(clipPlane.x) + e[8]) / e[0], (Math.sign(clipPlane.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    clipPlane.multiplyScalar(2 / clipPlane.dot(clipQ));
    e[2] = clipPlane.x; e[6] = clipPlane.y; e[10] = clipPlane.z + 1; e[14] = clipPlane.w;

    const sky = scene.background;
    scene.background = null;
    water.visible = false;
    r.setClearAlpha(0);
    r.setRenderTarget(mirrorRT);
    r.render(scene, c);
    r.setRenderTarget(null);
    r.setClearAlpha(1);
    water.visible = true;
    scene.background = sky;
  }

  // ---------- themes ----------

  function applyTheme(th) {
    theme = th;
    scene.fog.color.set(th.fog);
    hemi.color.setHex(th.hemiSky);
    hemi.groundColor.setHex(th.hemiGround);
    hemi.intensity = th.hemiI * HEMI_K;
    sun.color.setHex(th.sun);
    sun.intensity = th.sunI * SUN_K;
    fill.color.setHex(th.hemiSky);
    fill.intensity = th.fillI * FILL_K;
    // edges catch the sky's colour; corners sink towards the colour of the shade, not towards black
    rimU.value.setHex(th.hemiSky).multiplyScalar(th.rim);
    BB.Post.aoTint.setHex(th.hemiGround).multiplyScalar(0.42).addScalar(0.05);

    // What you see (disc, glitter) uses the sun's compass direction but its own, lower elevation.
    const el = THREE.MathUtils.degToRad(th.sunElev);
    const vx = SUN_SEEN.x * Math.cos(el), vy = Math.sin(el), vz = SUN_SEEN.y * Math.cos(el);

    const u = water.material.uniforms;
    u.uDeep.value.set(th.deep);
    u.uShallow.value.set(th.shallow);
    u.uFog.value.set(th.fog);
    u.uSkyTop.value.set(th.skyTop);
    u.uSkyMid.value.set(th.skyMid);
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
    const lam = function (color, gloss, spec) { return W.mat(color, gloss ? { gloss: gloss, spec: spec } : null); };
    // sh = this casts and catches shadows (left off for anything too thin to shade cleanly)
    const inst = function (geo, mat, n, sh) {
      const m = add(new THREE.InstancedMesh(geo, mat, n));
      m.frustumCulled = false;
      m.castShadow = m.receiveShadow = !!sh;
      return m;
    };

    // deck: only the top face carries the road texture. How shiny the road is depends on the
    // weather: a dull sheen on a dry day, a mirror-wet surface in the storm.
    const tex = deckTexture(theme.deck);
    tex.repeat.set(1, len / 12);
    const top = W.mat(0xffffff, { map: tex, gloss: theme.sheen[0], spec: theme.sheen[1] });
    const side = lam(0x59616d);
    const deck = add(new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 1.4, 0.8, len), [side, side, top, side, side, side]));
    deck.position.set(0, -0.4, zc);
    deck.receiveShadow = true;
    deck.castShadow = !LITE;        // onto the sea

    // kerbs + guard rails
    const kerbMat = lam(0xc9ced6, 20, 0.12), railMat = lam(0x39424e, 40, 0.35);
    [-1, 1].forEach(function (sx) {
      const kerb = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, len), kerbMat));
      kerb.position.set(sx * (HW + 0.45), 0.35, zc);
      kerb.receiveShadow = kerb.castShadow = true;
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
    const legs = inst(new THREE.BoxGeometry(2.2, 16, 2.2), pierMat, nPier * 2, !LITE);
    const beams = inst(new THREE.BoxGeometry(HW * 2 + 0.6, 1.3, 2.6), pierMat, nPier, !LITE);
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
    const steel = lam(0xc2482d, 30, 0.28), cableMat = lam(0x93381f, 30, 0.3);
    const nTower = Math.ceil(len / SPAN) + 1;
    const tLegs = inst(new THREE.BoxGeometry(1.5, 37, 2.4), steel, nTower * 2, true);
    const tBeams = inst(new THREE.BoxGeometry(17.5, 1.5, 1.9), steel, nTower * 2, true);
    const cables = inst(new THREE.BoxGeometry(0.2, 0.2, 1), cableMat, nTower * 2 * SEG);
    const hangers = inst(new THREE.BoxGeometry(0.055, 1, 0.055), cableMat, nTower * 2 * SEG);
    cables.castShadow = !LITE;
    // Tower dressing: a concrete collar where each leg passes the deck, a cap on top, struts
    // tying the two cross-beams together, and a red aircraft warning light.
    const collars = inst(new THREE.BoxGeometry(2.3, 1.6, 3.2), lam(0x8e97a1), nTower * 2, true);
    const caps = inst(new THREE.BoxGeometry(2.1, 0.7, 3.0), steel, nTower * 2, true);
    const struts = inst(new THREE.BoxGeometry(0.5, 3.3, 0.5), steel, nTower * 4, true);
    const beaconMat = new THREE.MeshBasicMaterial();
    beaconMat.color.setRGB(3.4, 0.32, 0.22);
    const beacons = inst(new THREE.BoxGeometry(0.42, 0.42, 0.42), beaconMat, nTower * 2);
    const cableY = function (u) { const k = 2 * u - 1; return SAG + (TOP - SAG) * k * k; };
    let ci = 0, hi = 0;
    for (let t = 0; t < nTower; t++) {
      const z = z0 - 30 - t * SPAN;
      m4.makeTranslation(-8, 6.5, z);  tLegs.setMatrixAt(t * 2, m4);
      m4.makeTranslation(8, 6.5, z);   tLegs.setMatrixAt(t * 2 + 1, m4);
      m4.makeTranslation(0, 19.4, z);  tBeams.setMatrixAt(t * 2, m4);
      m4.makeTranslation(0, 24.2, z);  tBeams.setMatrixAt(t * 2 + 1, m4);
      for (let k = 0; k < 2; k++) {
        const x = k ? 8 : -8;
        m4.makeTranslation(x, 0.1, z);   collars.setMatrixAt(t * 2 + k, m4);
        m4.makeTranslation(x, 25.35, z); caps.setMatrixAt(t * 2 + k, m4);
        m4.makeTranslation(x, 25.9, z);  beacons.setMatrixAt(t * 2 + k, m4);
      }
      for (let k = 0; k < 4; k++) { m4.makeTranslation(-5.25 + k * 3.5, 21.8, z); struts.setMatrixAt(t * 4 + k, m4); }
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
    const divMat = lam(0xf28c28, 30, 0.25), capMat = lam(0xffd9a0, 30, 0.25);
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

    // On a phone the sea takes no real shadows, so the bridge's shadow is faked: a flat dark strip
    // pushed sideways by the sun angle, which anchors the bridge above the water well enough.
    if (LITE) {
      const drop = -WATER_Y / SUN_DIR.y;
      const shade = add(new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 + 3.5, len).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x00060f, transparent: true, opacity: 0.3, depthWrite: false })));
      shade.position.set(-SUN_DIR.x * drop, WATER_Y + 0.06, zc - SUN_DIR.z * drop);
    }

    // What stands in the sea depends on the biome: sandy islands, icebergs or volcanoes.
    const rng = BB.mulberry32(L.level * 31 + 7);
    const flat = function (color, glow, gloss, spec) {
      return W.mat(color, { flat: true, glow: glow, gloss: gloss, spec: spec });
    };
    const land = function (geo, mat) {
      const m = add(new THREE.Mesh(geo, mat));
      m.castShadow = m.receiveShadow = true;
      return m;
    };
    // Around everything that stands in the sea lies a ring of shallow water with surf at the
    // shoreline. Without it an island looks like it was set down on a blue floor. Night and
    // storm dim the surf along with everything else.
    const dim = theme.stars ? 0.42 : (theme.bolts ? 0.72 : 1);
    const shoreGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const shoreMat = new THREE.MeshBasicMaterial({ map: shoreTexture(), transparent: true, depthWrite: false });
    const shore = function (x, z, r) {
      const ring = add(new THREE.Mesh(shoreGeo, shoreMat));
      ring.position.set(x, WATER_Y + 0.07, z);
      ring.scale.set(r, 1, r);
      ring.renderOrder = 1;
    };
    const nIsland = 10 + Math.floor(len / 60);
    const CLEAR = 41;      // nothing solid stands closer to the bridge than this: inside it are the shipping lanes
    if (theme.isle === 'ice') {
      // the faint blue self-glow keeps the shaded faces glacier-blue instead of dirty grey
      const iceMat = flat(0xeef8ff, 0x2c4a66, 70, 0.5), blueMat = flat(0xa9dcf2, 0x1d3f5c, 90, 0.6), floeMat = flat(0xf6fbff, 0x33506a, 50, 0.3);
      shoreMat.color.setRGB(0.75 * dim, 0.95 * dim, 1.15 * dim);
      for (let i = 0; i < nIsland; i++) {
        const sx = i % 2 ? 1 : -1;
        const out = rng(), z = z0 - rng() * (len + 220), r = 6 + rng() * 16;
        const x = sx * Math.max(36 + out * 150, CLEAR + r * 1.55);
        const bergs = 1 + Math.floor(rng() * 3);
        for (let h = 0; h < bergs; h++) {
          const br = r * (0.45 + rng() * 0.5);
          const berg = land(new THREE.IcosahedronGeometry(br, 0), rng() < 0.7 ? iceMat : blueMat);
          berg.scale.set(1, 0.8 + rng() * 1.1, 0.7 + rng() * 0.5);
          berg.position.set(x + (rng() - 0.5) * r * 1.2, WATER_Y + br * 0.15, z + (rng() - 0.5) * r * 1.2);
          berg.rotation.set(rng() * 0.5, rng() * 6, rng() * 0.5);
          shore(berg.position.x, berg.position.z, br * 1.75);   // the pale glow of the ice below the surface
        }
      }
      // pack ice drifting right beside the bridge, where you actually look
      const nFloe = Math.floor(len / 9);
      const floes = inst(new THREE.CylinderGeometry(1, 1.12, 0.5, 6), floeMat, nFloe, true);
      for (let i = 0; i < nFloe; i++) {
        const sx = rng() < 0.5 ? -1 : 1, fr = 1.2 + rng() * 3.4;
        dummy.position.set(sx * (10.5 + rng() * 34), WATER_Y + 0.12, z0 - rng() * len);
        dummy.rotation.set(0, rng() * 6, 0);
        dummy.scale.set(fr, 1, fr * (0.7 + rng() * 0.5));
        dummy.updateMatrix();
        floes.setMatrixAt(i, dummy.matrix);
      }
    } else if (theme.isle === 'volcano') {
      const rockMat = flat(0x2c2428, 0, 30, 0.2), ashMat = flat(0x3a3034);
      const lavaMat = new THREE.MeshBasicMaterial();
      lavaMat.color.setRGB(3.6, 0.95, 0.14);
      shoreMat.color.setRGB(2.3, 0.62, 0.14);          // the sea glows where it meets hot rock
      shoreMat.blending = THREE.AdditiveBlending;
      for (let i = 0; i < nIsland; i++) {
        const sx = i % 2 ? 1 : -1;
        const out = rng(), z = z0 - rng() * (len + 220), r = 8 + rng() * 18;
        const x = sx * Math.max(38 + out * 150, CLEAR + r * 1.35);
        const h = r * (0.8 + rng() * 0.7), seg = 7 + Math.floor(rng() * 3);
        const base = land(new THREE.CylinderGeometry(r * 1.1, r * 1.3, 1.2, 10), ashMat);
        base.position.set(x, WATER_Y + 0.2, z);
        const cone = land(new THREE.CylinderGeometry(r * 0.26, r, h, seg), rockMat);
        cone.position.set(x, WATER_Y + 0.6 + h / 2, z);
        cone.rotation.y = rng() * 6;
        const crater = add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.2, 0.5, seg), lavaMat));
        crater.position.set(x, WATER_Y + 0.6 + h, z);
        // one lava flow running down the flank that faces the bridge
        const flow = add(new THREE.Mesh(new THREE.BoxGeometry(r * 0.09, h * 1.02, r * 0.09), lavaMat));
        flow.position.set(x - sx * r * 0.62, WATER_Y + 0.6 + h / 2, z);
        flow.rotation.z = -sx * Math.atan2(r * 0.74, h);
        shore(x, z, r * 2.6);
      }
    } else {
      const sandMat = flat(0xe6d5a0), greenMat = flat(0x4f9a4a), rockMat = flat(0x7b7f86, 0, 20, 0.15);
      const tint = new THREE.Color(0xffffff).lerp(scene.fog.color, 0.3).multiplyScalar(dim);
      shoreMat.color.copy(tint);
      const palms = [];
      for (let i = 0; i < nIsland; i++) {
        const sx = i % 2 ? 1 : -1;
        const out = rng(), z = z0 - rng() * (len + 220), r = 7 + rng() * 20;
        const x = sx * Math.max(40 + out * 150, CLEAR + r * 1.25);
        const sand = land(new THREE.CylinderGeometry(r, r * 1.2, 1.4, 12), sandMat);
        sand.position.set(x, WATER_Y + 0.3, z);
        const hills = 1 + Math.floor(rng() * 3);
        for (let h = 0; h < hills; h++) {
          const hr = r * (0.35 + rng() * 0.4), hh = r * (0.35 + rng() * 0.8), rock = rng() >= 0.65;
          const hill = land(lump(rock ? 0.55 : 0.3, rng() * 100), rock ? rockMat : greenMat);
          hill.scale.set(hr * 1.08, hh, hr * 1.08);
          hill.position.set(x + (rng() - 0.5) * r * 0.8, WATER_Y + 0.95, z + (rng() - 0.5) * r * 0.8);
          hill.rotation.y = rng() * 6;
        }
        shore(x, z, r * 2.4);
        // a few palms out on the beach, clear of the hills
        const np = 2 + Math.floor(rng() * 3);
        for (let p = 0; p < np; p++) {
          const a = rng() * 6.283, d = r * (0.72 + rng() * 0.22);
          palms.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, h: 3.6 + rng() * 2.6, yaw: rng() * 6.283, lean: 0.12 + rng() * 0.3 });
        }
      }
      // Palms: a leaning trunk and six drooping fronds each, all drawn as two instanced meshes.
      const FRONDS = 6;
      const trunks = inst(new THREE.CylinderGeometry(0.1, 0.2, 1, 5).translate(0, 0.5, 0), flat(0x8a6a3c), palms.length, true);
      const fronds = inst(new THREE.ConeGeometry(0.36, 1, 4).scale(1, 1, 0.22).rotateZ(-Math.PI / 2).translate(0.5, 0, 0),
        flat(0x3f9b46, 0x0c2a10, 30, 0.2), palms.length * FRONDS, true);
      palms.forEach(function (p, i) {
        dummy.position.set(p.x, WATER_Y + 0.95, p.z);
        dummy.rotation.set(0, p.yaw, p.lean);
        dummy.scale.set(1, p.h, 1);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        // the crown sits where the leaning trunk ends
        const tx = p.x - p.h * Math.sin(p.lean) * Math.cos(p.yaw), ty = WATER_Y + 0.95 + p.h * Math.cos(p.lean), tz = p.z + p.h * Math.sin(p.lean) * Math.sin(p.yaw);
        for (let f = 0; f < FRONDS; f++) {
          const fl = p.h * (0.42 + ((f * 7 + i * 3) % 5) * 0.03);
          dummy.position.set(tx, ty, tz);
          dummy.rotation.set(0, p.yaw + f * 6.283 / FRONDS, -0.38 - (f % 2) * 0.22);
          dummy.scale.set(fl, fl * 0.5, fl * 0.5);
          dummy.updateMatrix();
          fronds.setMatrixAt(i * FRONDS + f, dummy.matrix);
        }
      });
    }
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);

    // Boats out on the water: sailing dinghies close in, the odd container ship further off.
    boats.length = 0;
    if (theme.boats) {
      const brng = BB.mulberry32(L.level * 53 + 19);
      const nBoat = 3 + Math.floor(len / 150);
      const washMat = new THREE.MeshBasicMaterial({ map: washTexture(), transparent: true, depthWrite: false });
      washMat.color.setRGB(1, 1, 1).lerp(scene.fog.color, 0.25).multiplyScalar(dim);
      for (let i = 0; i < nBoat; i++) {
        const big = brng() < 0.3, sx = brng() < 0.5 ? -1 : 1;
        const b = big ? makeShip(brng, theme.lamp > 0.4) : makeSailboat(brng);
        const g = solid(b.g);
        // dinghies keep to the inner lane and ships to the outer one, both inside CLEAR
        g.position.set(sx * (big ? 27 + brng() * 8 : 13 + brng() * 8.5), WATER_Y, z0 - 40 - (i + brng() * 0.8) * (len - 60) / nBoat);
        const fwd = brng() < 0.5 ? 1 : -1;       // some sail with you, some against
        g.rotation.y = fwd > 0 ? 0 : Math.PI;
        levelGroup.add(g);
        // The wash around the hull and the wake behind it lie flat on the sea. They follow the
        // boat along but take no part in its rolling.
        const wash = add(new THREE.Mesh(washGeo(b.len, b.beam), washMat));
        wash.rotation.y = g.rotation.y;
        wash.position.set(g.position.x, WATER_Y + 0.1, g.position.z);
        wash.renderOrder = 2;
        boats.push({ g: g, wash: wash, ph: brng() * 6.283, v: fwd * (big ? 1.6 : 0.9 + brng() * 0.8), roll: big ? 0.012 : 0.05, bob: big ? 0.1 : 0.22 });
      }
    }
  };

  // A hill: a ball of flat facets with each corner pushed in or out a little, the underside cut
  // off flat. No two faces catch the light alike, which a plain cone never manages.
  function lump(rough, seed) {
    const geo = new THREE.IcosahedronGeometry(1, 1), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      // corners shared by several faces must move together, so the push depends only on where the corner is
      const k = Math.sin(Math.round(x * 50) * 12.9898 + Math.round(y * 50) * 78.233 + Math.round(z * 50) * 37.719 + seed) * 43758.5453;
      const s = 1 + (k - Math.floor(k) - 0.5) * rough;
      p.setXYZ(i, x * s, Math.max(y * s, -0.08), z * s);
    }
    geo.computeVertexNormals();
    return geo;
  }

  // The ring of shallow water round an island: pale and clear over the sand, a white line of
  // surf where the shore is (half-way out from the centre), fading to open sea at the edge.
  let shoreTex = null, washTex = null, ribTex = null;
  function shoreTexture() {
    if (shoreTex) return shoreTex;
    const S = 256, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(150,255,230,0.85)');
    g.addColorStop(0.45, 'rgba(150,255,230,0.8)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.56, 'rgba(165,250,235,0.5)');
    g.addColorStop(0.76, 'rgba(120,225,235,0.2)');
    g.addColorStop(1, 'rgba(120,225,235,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
    x.strokeStyle = 'rgba(255,255,255,0.42)';      // a second, broken line of breakers further out
    x.lineWidth = 3;
    x.setLineDash([26, 17]);
    x.beginPath();
    x.arc(S / 2, S / 2, S * 0.325, 0, 6.2832);
    x.stroke();
    shoreTex = new THREE.CanvasTexture(c);
    shoreTex.userData.shared = true;
    return shoreTex;
  }

  // Foam for a boat, seen from above with the bow at the top: a soft white line hugging the
  // hull, a bow wave peeling off either side, and the wake spreading out astern.
  function washTexture() {
    if (washTex) return washTex;
    const c = document.createElement('canvas');
    c.width = 128; c.height = 256;
    const x = c.getContext('2d');
    x.lineCap = 'round';
    const fade = function (y0, y1, a) {
      const g = x.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, 'rgba(255,255,255,' + a + ')');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      return g;
    };
    x.fillStyle = fade(150, 250, 0.5);             // churned water straight behind the stern
    x.beginPath();
    x.moveTo(42, 150); x.lineTo(86, 150); x.lineTo(96, 250); x.lineTo(32, 250);
    x.fill();
    x.strokeStyle = fade(140, 256, 0.75);          // the two arms of the wake
    x.lineWidth = 6;
    x.beginPath(); x.moveTo(38, 146); x.lineTo(8, 254); x.moveTo(90, 146); x.lineTo(120, 254); x.stroke();
    x.strokeStyle = fade(30, 120, 0.6);            // bow wave
    x.lineWidth = 3;
    x.beginPath(); x.moveTo(62, 30); x.quadraticCurveTo(34, 52, 22, 112); x.moveTo(66, 30); x.quadraticCurveTo(94, 52, 106, 112); x.stroke();
    x.shadowColor = 'rgba(255,255,255,1)';         // the line of foam along the hull, twice for body
    x.shadowBlur = 12;
    x.strokeStyle = 'rgba(255,255,255,0.9)';
    x.lineWidth = 4;
    for (let i = 0; i < 2; i++) {
      x.beginPath();
      x.moveTo(64, 36);
      x.bezierCurveTo(86, 58, 92, 80, 92, 102);
      x.lineTo(89, 156); x.lineTo(39, 156); x.lineTo(36, 102);
      x.bezierCurveTo(36, 80, 42, 58, 64, 36);
      x.stroke();
    }
    washTex = new THREE.CanvasTexture(c);
    washTex.userData.shared = true;
    return washTex;
  }
  // In that picture the hull is 56 wide by 120 long, centred a little above the middle: the
  // plane is sized and shifted so the drawn hull lines up with a real one of this length and beam.
  function washGeo(len, beam) {
    const lp = len * 256 / 120;
    return new THREE.PlaneGeometry(beam * 128 / 56 * 1.06, lp).rotateX(-Math.PI / 2).translate(0, 0, lp * 0.125);
  }

  // Corrugated steel for shipping containers: pale, so the container's own colour shows through.
  function ribTexture() {
    if (ribTex) return ribTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#f4f4f4';
    x.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 64; i += 8) {
      x.fillStyle = 'rgba(0,0,0,0.2)'; x.fillRect(i, 0, 3, 64);
      x.fillStyle = 'rgba(255,255,255,0.5)'; x.fillRect(i + 3, 0, 1, 64);
    }
    x.fillStyle = 'rgba(0,0,0,0.34)';
    x.fillRect(0, 0, 64, 3); x.fillRect(0, 61, 64, 3); x.fillRect(0, 0, 2, 64); x.fillRect(62, 0, 2, 64);
    ribTex = new THREE.CanvasTexture(c);
    ribTex.userData.shared = true;
    ribTex.anisotropy = 4;
    return ribTex;
  }

  // A hull, lofted between three outlines: one below the waterline, one at the top of the boot
  // stripe, one at the deck edge. The bow points down -z. The sides flare out as they rise and
  // the stem is raked, so it leans forward over the water like a real one.
  function hullGeo(len, beam, free, bowLen, hullCol, bootCol, deckCol) {
    const ST = 14, pos = [], col = [], c = new THREE.Color();
    const ys = [-0.7, 0.42, free], flare = [0.72, 0.86, 1];
    const P = function (i, j, side) {
      const t = i / ST, b = Math.min(1, t * len / bowLen);
      const entry = Math.pow(Math.sin(b * Math.PI / 2), 0.8);
      const stern = t > 0.88 ? 1 - (t - 0.88) / 0.12 * 0.2 : 1;
      const rake = (free - ys[j]) / (free + 0.7) * bowLen * 0.24 * (1 - b) * (1 - b);
      return [side * beam / 2 * entry * stern * flare[j], ys[j], -len / 2 + t * len + rake];
    };
    const tri = function (a, b, d, hex) {
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2]);
      c.setHex(hex);
      for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
    };
    const quad = function (a, b, d, e, hex) { tri(a, b, d, hex); tri(a, d, e, hex); };
    for (let i = 0; i < ST; i++) {
      for (let j = 0; j < 2; j++) {
        const hex = j ? hullCol : bootCol;
        quad(P(i, j, 1), P(i, j + 1, 1), P(i + 1, j + 1, 1), P(i + 1, j, 1), hex);          // starboard
        quad(P(i, j, -1), P(i + 1, j, -1), P(i + 1, j + 1, -1), P(i, j + 1, -1), hex);      // port
      }
      quad(P(i, 2, -1), P(i + 1, 2, -1), P(i + 1, 2, 1), P(i, 2, 1), deckCol);              // deck
    }
    for (let j = 0; j < 2; j++) quad(P(ST, j, -1), P(ST, j, 1), P(ST, j + 1, 1), P(ST, j + 1, -1), j ? hullCol : bootCol);   // transom
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
  }

  function makeSailboat(rng) {
    const g = new THREE.Group();
    const LEN = 5.8, BEAM = 2.0, FREE = 0.8;
    const hullCol = [0xf4f4f0, 0x2d5d9c, 0xc8442e, 0x2a8a7a][Math.floor(rng() * 4)];
    g.add(new THREE.Mesh(hullGeo(LEN, BEAM, FREE, 2.6, hullCol, 0x27323e, 0xc9a26b),
      W.mat(0xffffff, { vertexColors: true, flat: true, gloss: 40, spec: 0.35 })));
    g.add(new THREE.Mesh(boxes([
      [0.95, 0.42, 1.6, 0, FREE + 0.21, 0.55, 0xf4f1e6],      // cabin
      [1.02, 0.07, 1.7, 0, FREE + 0.45, 0.55, 0x7a5a3a],      // its roof
      [0.12, 6.7, 0.12, 0, FREE + 3.35, -0.55, 0x4a3a2a],     // mast
      [0.09, 0.09, 2.8, 0, FREE + 1.0, 0.85, 0x4a3a2a],       // boom
      [0.3, 0.1, 0.5, 0, FREE + 0.05, 2.5, 0x3a3f48]          // tiller
    ]), W.mat(0xffffff, { vertexColors: true })));
    const tri = function (pts) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
      geo.computeVertexNormals();
      return geo;
    };
    const sailMat = W.mat(0xfbf7ea, { side: THREE.DoubleSide, glow: 0x55524a });   // sails stay bright even in shade
    g.add(new THREE.Mesh(tri([0.06, FREE + 1.1, -0.45, 0.06, FREE + 6.6, -0.5, 0.5, FREE + 1.1, 2.2]), sailMat));
    g.add(new THREE.Mesh(tri([-0.06, FREE + 0.35, -0.7, -0.06, FREE + 5.7, -0.6, -0.3, FREE + 0.35, -2.6]), sailMat));
    return { g: g, len: LEN, beam: BEAM };
  }

  // A container ship. lit = it is dark enough for the windows to be lit.
  function makeShip(rng, lit) {
    const g = new THREE.Group();
    const LEN = 28, BEAM = 5.8, FREE = 2.3, zs = LEN / 2;
    const navy = rng() < 0.5;
    const hullCol = navy ? 0x24364f : 0x7a2a26, WHITE = 0xf0f0ea, GREY = 0xaeb6bf, DARK = 0x23262e;
    g.add(new THREE.Mesh(hullGeo(LEN, BEAM, FREE, 7.5, hullCol, navy ? 0x8a2f24 : 0x2a2d35, 0x4a525c),
      W.mat(0xffffff, { vertexColors: true, flat: true, gloss: 28, spec: 0.22 })));

    // cargo: five bays of containers, three across, stacked one to three high
    const cols = [0xc8442e, 0x2d7fb8, 0xe0a02a, 0x3a9a5c, 0xd9d9d2, 0x8a4fb0, 0x1f8f8a, 0xd86a2c];
    const CW = 1.6, CH = 1.35, CL = 3.0, cargo = [];
    for (let bay = 0; bay < 5; bay++) {
      for (let c = -1; c <= 1; c++) {
        const tiers = 1 + Math.floor(rng() * 3);
        for (let t = 0; t < tiers; t++) {
          cargo.push([CW, CH, CL, c * (CW + 0.1), FREE + 0.06 + CH / 2 + t * (CH + 0.04), -zs + 8.3 + bay * (CL + 0.22), cols[Math.floor(rng() * cols.length)]]);
        }
      }
    }
    g.add(new THREE.Mesh(boxes(cargo), W.mat(0xffffff, { vertexColors: true, map: ribTexture(), gloss: 30, spec: 0.25 })));

    // the house at the stern, the bridge on top of it with wings out past the hull, and the rest of the fittings
    const hz = zs - 2.9, stripe = cols[Math.floor(rng() * 4)];
    g.add(new THREE.Mesh(boxes([
      [4.8, 2.2, 3.6, 0, FREE + 1.1, hz, WHITE],
      [4.3, 1.5, 3.0, 0, FREE + 2.95, hz, WHITE],
      [5.9, 1.15, 2.2, 0, FREE + 4.28, hz - 0.3, WHITE],
      [5.4, 0.14, 2.5, 0, FREE + 4.93, hz - 0.3, GREY],            // bridge roof
      [0.14, 2.3, 0.14, 0, FREE + 6.1, hz - 0.3, GREY],            // mast and yard
      [1.7, 0.1, 0.1, 0, FREE + 6.7, hz - 0.3, GREY],
      [1.0, 0.14, 0.24, 0, FREE + 5.25, hz - 0.95, GREY],          // radar
      [1.3, 2.4, 1.6, 0, FREE + 4.9, hz + 1.25, DARK],             // funnel, with the line's colours on a band
      [1.36, 0.5, 1.66, 0, FREE + 5.5, hz + 1.25, stripe],
      [0.7, 0.55, 1.9, -2.75, FREE + 1.7, hz + 0.2, 0xff7a1a],     // lifeboats
      [0.7, 0.55, 1.9, 2.75, FREE + 1.7, hz + 0.2, 0xff7a1a],
      [3.2, 0.75, 3.4, 0, FREE + 0.37, -zs + 3.8, GREY],           // forecastle
      [0.9, 0.5, 0.9, 0, FREE + 1.0, -zs + 4.7, DARK],             // windlass
      [0.12, 2.8, 0.12, 0, FREE + 2.1, -zs + 3.0, GREY]            // foremast
    ]), W.mat(0xffffff, { vertexColors: true, gloss: 24, spec: 0.18 })));

    // Windows, fore and aft. By day they are dark glass that catches the sun; after dusk they are lit.
    let glass;
    if (lit) { glass = new THREE.MeshBasicMaterial(); glass.color.setRGB(2.4, 2.0, 1.1); }
    else glass = W.mat(0x1c2a3a, { gloss: 90, spec: 0.9 });
    g.add(new THREE.Mesh(boxes([
      [5.5, 0.42, 0.06, 0, FREE + 4.42, hz - 1.41, 0xffffff],
      [0.06, 0.42, 1.7, -2.96, FREE + 4.42, hz - 0.3, 0xffffff],
      [0.06, 0.42, 1.7, 2.96, FREE + 4.42, hz - 0.3, 0xffffff],
      [3.6, 0.26, 0.06, 0, FREE + 3.05, hz - 1.51, 0xffffff],
      [3.6, 0.26, 0.06, 0, FREE + 3.05, hz + 1.51, 0xffffff],
      [4.1, 0.26, 0.06, 0, FREE + 1.5, hz - 1.81, 0xffffff],
      [4.1, 0.26, 0.06, 0, FREE + 1.5, hz + 1.81, 0xffffff]
    ]), glass));
    return { g: g, len: LEN, beam: BEAM };
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

    // The two still shots are photographed with a shallow depth of field, focused on their
    // subject: the squad on the menu, the monster in its entrance. In play everything is sharp.
    const cs = cine > 0.001 ? cine * cine * (3 - 2 * cine) : 0;
    BB.Post.dof = Math.max(m * 0.8, cs);
    tmp.set(BB.lerp(camX * 2, cineX, cs), BB.lerp(1, 5.5, cs), BB.lerp(fz, cineZ, cs));
    BB.Post.focus = cam.position.distanceTo(tmp);

    const tz = Math.round(fz / SHADOW_SNAP) * SHADOW_SNAP;
    sun.target.position.set(0, 0, tz);
    sun.position.set(SUN_DIR.x * SUN_DIST, SUN_DIR.y * SUN_DIST, tz + SUN_DIR.z * SUN_DIST);
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
      b.wash.position.z = g.position.z;
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
    hemi.intensity = theme.hemiI * HEMI_K * (1 + fl * 2.2);
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
  W.mirror = true;   // set false to switch the sea's reflections off
  W.render = function (dt) {
    const sm = W.renderer.shadowMap;
    if (mirrorRT) {
      water.material.uniforms.uMirror.value = W.mirror ? 1 : 0;
      // the mirror pass has just drawn this frame's shadow map: the main pass can reuse it
      if (W.mirror) { drawMirror(); sm.autoUpdate = false; }
    }
    BB.Post.render(scene, W.camera, dt);
    sm.autoUpdate = true;
  };

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
    if (mirrorRT) mirrorRT.setSize(Math.max(2, size.x >> 1), Math.max(2, size.y >> 1));
    cam.aspect = w / h;
    // Widen the field of view on tall screens so the whole bridge always fits across.
    cam.fov = fovBase = BB.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(0.345 / cam.aspect)), 48, 88);
    cam.updateProjectionMatrix();
    place(0, lastFz);
  };
})(window.BB);
