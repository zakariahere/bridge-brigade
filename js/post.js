// Post-processing: ambient occlusion, HDR bloom and a light colour grade.
//
// The scene is drawn into a multisampled half-float buffer, so emissive things (bullets, lamps,
// eyes, the sun) can hold colour values above 1.0. Bloom then keeps only what exceeds a threshold
// just under 1.0, blurs it by repeatedly halving the image and adding the levels back up, and the
// final pass lays that glow over the scene, rolls the over-bright values off and adds a vignette.
//
// The same buffer also keeps its depth as a texture. Ambient occlusion is worked out from that
// alone: each pixel's position in space is rebuilt from its depth, and the pixel is darkened by
// how much nearby geometry rises above its own surface. That is the soft shade you get where a
// box meets the deck or two containers touch, and it is what makes things look like they are
// sitting on each other instead of being pasted on.
(function (BB) {
  'use strict';

  const P = BB.Post = { supported: false, enabled: true, exposure: 1, aberr: 0, ao: 1, aoOn: true, debug: 0, dof: 0, focus: 12 };
  P.aoTint = new THREE.Color(0.2, 0.24, 0.36);   // occluded corners go towards this, not towards black
  // Impacts split the red and blue channels apart towards the screen edges for a few frames.
  P.kick = function (a) { P.aberr = Math.min(1.4, Math.max(P.aberr, a * 1.3)); };
  const LEVELS = 4, THRESHOLD = 0.95;
  const AO_RADIUS = 1.5, AO_TAPS = 12, AO_POWER = 2.6;
  let renderer, rtScene, rtAO, rtAO2, quad, quadScene, quadCam, matDown, matUp, matFinal, matAO, matBlur;
  const down = [], up = [];
  let clock = 0;

  const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  // Halve the image with a 5-tap filter. On the first level it also applies the bloom threshold.
  const DOWN = [
    'uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;',
    '  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;',
    '  c += texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb;',
    '  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb;',
    '  c += texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;',
    '  c /= 8.0;',
    '  if (uThreshold > 0.0) {',
    '    float br = max(c.r, max(c.g, c.b));',
    '    c *= max(br - uThreshold, 0.0) / max(br, 0.0001);',
    '    c = min(c, vec3(8.0));',            // one stray super-bright pixel must not flood the screen
    '  }',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  // Grow a blurred level back up (tent filter) and add the sharper level above it.
  const UP = [
    'uniform sampler2D tSrc; uniform sampler2D tAdd; uniform vec2 uTexel;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 0.0)).rgb',
    '         + texture2D(tSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.0, 1.0)).rgb;',
    '  c += 2.0 * (texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb',
    '            + texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb);',
    '  gl_FragColor = vec4(c / 12.0 + texture2D(tAdd, vUv).rgb, 1.0);',
    '}'
  ].join('\n');

  // Depth as stored (0..1, crowded towards 1) -> distance in front of the camera, in world units.
  const LINEAR = 'float lin(vec2 uv) { return uNear * uFar / (uFar - texture2DLodEXT(tDepth, uv, 0.0).x * (uFar - uNear)); }';

  // Ambient occlusion (after McGuire's "Scalable Ambient Obscurance"). Runs at half resolution.
  const AO = [
    'uniform sampler2D tDepth; uniform vec2 uTexel; uniform vec2 uTan; uniform float uNear; uniform float uFar; uniform float uRadius;',
    'varying vec2 vUv;',
    LINEAR,
    'vec3 pos(vec2 uv) { float z = lin(uv); return vec3((uv * 2.0 - 1.0) * uTan * z, -z); }',
    'void main() {',
    '  if (texture2DLodEXT(tDepth, vUv, 0.0).x >= 1.0) { gl_FragColor = vec4(1.0); return; }',     // sky
    '  vec3 p = pos(vUv);',
    '  float z = -p.z;',
    '  if (z > 150.0) { gl_FragColor = vec4(1.0); return; }',                            // lost in the haze anyway
    // The surface normal comes from the depth image too. Of the two neighbours on each axis the
    // one closer in depth is used, so a silhouette edge does not bend the normal.
    '  vec3 xa = pos(vUv + vec2(uTexel.x, 0.0)), xb = pos(vUv - vec2(uTexel.x, 0.0));',
    '  vec3 ya = pos(vUv + vec2(0.0, uTexel.y)), yb = pos(vUv - vec2(0.0, uTexel.y));',
    '  vec3 dx = abs(xa.z - p.z) < abs(p.z - xb.z) ? xa - p : p - xb;',
    '  vec3 dy = abs(ya.z - p.z) < abs(p.z - yb.z) ? ya - p : p - yb;',
    '  vec3 n = normalize(cross(dx, dy));',
    // a fixed radius in the world, so it covers fewer pixels the further away the surface is
    '  float ruv = min(uRadius / (2.0 * z * uTan.y), 0.085);',
    '  vec2 asp = vec2(uTan.y / uTan.x, 1.0);',
    // every pixel turns the sample spiral by a different angle; the blur afterwards averages that out
    '  float ang = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));',
    '  float r2 = uRadius * uRadius, bias = 0.012 + 0.0009 * z, sum = 0.0;',
    '  for (int i = 0; i < ' + AO_TAPS + '; i++) {',
    '    float t = (float(i) + 0.5) / ' + AO_TAPS + '.0;',
    '    float a = ang + t * 43.98;',                                                   // seven turns of the spiral
    '    vec3 v = pos(vUv + vec2(cos(a), sin(a)) * asp * (t * ruv)) - p;',
    '    float vv = dot(v, v), f = max(r2 - vv, 0.0);',
    '    sum += f * f * f * max((dot(v, n) - bias) / (vv + 0.01), 0.0);',
    '  }',
    '  float ao = max(0.0, 1.0 - sum * ' + (5 * AO_POWER).toFixed(1) + ' / (r2 * r2 * r2 * ' + AO_TAPS + '.0));',
    '  gl_FragColor = vec4(mix(ao, 1.0, smoothstep(85.0, 150.0, z)), 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  // Smooths the occlusion along one axis, but not across a jump in depth: shade must not leak
  // from a soldier onto the sea behind them.
  const BLUR = [
    'uniform sampler2D tSrc; uniform sampler2D tDepth; uniform vec2 uDir; uniform float uNear; uniform float uFar;',
    'varying vec2 vUv;',
    LINEAR,
    'void main() {',
    '  float z0 = lin(vUv), sum = texture2D(tSrc, vUv).r * 0.227, wsum = 0.227;',
    '  for (int i = 1; i <= 3; i++) {',
    '    float g = i == 1 ? 0.1945 : (i == 2 ? 0.1216 : 0.054);',
    '    for (int s = -1; s <= 1; s += 2) {',
    '      vec2 uv = vUv + uDir * float(i * s);',
    '      float w = g * exp(-abs(lin(uv) - z0) / z0 * 34.0);',
    '      sum += texture2DLodEXT(tSrc, uv, 0.0).r * w; wsum += w;',
    '    }',
    '  }',
    '  gl_FragColor = vec4(sum / wsum, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  const FINAL = [
    'uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tAO; uniform float uStrength; uniform float uExposure; uniform float uTime; uniform float uAberr;',
    'uniform float uAO; uniform vec3 uAoTint; uniform float uDebug;',
    'uniform sampler2D tDepth; uniform float uNear; uniform float uFar; uniform float uDof; uniform float uFocus; uniform vec2 uTexel;',
    'varying vec2 vUv;',
    LINEAR,
    // How far out of focus a point at distance z is, 0..1: sharp in a band around the focus
    // distance, softening in front of it and behind.
    'float blurAt(float z) { return smoothstep(0.14, 1.0, abs(1.0 - uFocus / z)); }',
    // identity below 0.8, then a soft shoulder that approaches 1.0: over-bright cores go white-hot instead of clipping
    'vec3 shoulder(vec3 x) { return min(x, 0.8) + 0.2 * (1.0 - exp(-max(x - 0.8, 0.0) * 4.0)); }',
    'void main() {',
    '  vec2 c = vUv - 0.5;',
    '  vec2 off = c * (0.25 + dot(c, c) * 3.0) * uAberr * 0.007;',   // nothing in the middle, growing towards the corners
    '  vec3 col = vec3(texture2D(tScene, vUv + off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - off).b);',
    // Depth of field, for the still shots (menu, boss entrance): each pixel is averaged with a
    // ring of neighbours, over a radius that grows with how far out of focus it is. A neighbour
    // that is itself in focus is given little weight, so sharp things do not smear into the blur.
    '  if (uDof > 0.001) {',
    '    float c0 = blurAt(lin(vUv));',
    '    float rad = c0 * uDof * 0.0065;',                  // in screen heights
    '    vec3 sum = col; float wsum = 1.0;',
    '    for (int i = 0; i < 14; i++) {',
    '      float fi = float(i) + 0.5, a = fi * 2.39996;',   // golden-angle spiral: even cover with few samples
    '      vec2 uv = vUv + vec2(cos(a), sin(a)) * sqrt(fi / 14.0) * rad * vec2(uTexel.x / uTexel.y, 1.0);',
    '      float w = 0.15 + 0.85 * blurAt(lin(uv));',
    '      sum += texture2DLodEXT(tScene, uv, 0.0).rgb * w; wsum += w;',
    '    }',
    '    col = sum / wsum;',
    '  }',
    // Occlusion shades what is lit, not what glows: anything already brighter than white is left alone.
    '  float ao = mix(1.0, texture2D(tAO, vUv).r, uAO);',
    '  ao = mix(ao, 1.0, smoothstep(0.95, 1.7, max(col.r, max(col.g, col.b))));',
    '  col *= mix(uAoTint, vec3(1.0), ao);',
    '  col += texture2D(tBloom, vUv).rgb * uStrength;',
    '  col = shoulder(col * uExposure);',
    '  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));',
    '  col = mix(vec3(l), col, 1.14);',                      // a touch more saturation
    '  col = (col - 0.5) * 1.06 + 0.5;',                     // and contrast
    '  vec2 q = (vUv - 0.5) * vec2(1.0, 0.86);',
    '  col *= 1.0 - 0.2 * smoothstep(0.38, 0.9, length(q));',  // vignette
    '  col += (fract(sin(dot(vUv * 913.7 + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;',  // dither: no banding in the sky
    '  if (uDebug > 0.5) col = vec3(ao);',                   // BB.Post.debug = 1 shows the occlusion on its own
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function target(samples, depth) {
    return new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: depth,
      samples: samples
    });
  }

  function shader(frag, uniforms) {
    return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms: uniforms, depthTest: false, depthWrite: false });
  }

  P.init = function (r) {
    renderer = r;
    // Rendering to float buffers is a WebGL2 feature with an extension; without it, fall back to plain drawing.
    P.supported = !!(r.capabilities.isWebGL2 && r.extensions.has('EXT_color_buffer_float'));
    if (!P.supported) return;

    rtScene = target(4, true);
    // keeping depth as a texture is what lets later passes ask "how far away is this pixel?"
    rtScene.depthTexture = new THREE.DepthTexture(4, 4);
    rtScene.depthTexture.type = THREE.UnsignedIntType;
    rtScene.depthTexture.minFilter = rtScene.depthTexture.magFilter = THREE.NearestFilter;
    const ldr = function () { return new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false }); };
    rtAO = ldr(); rtAO2 = ldr();
    for (let i = 0; i < LEVELS; i++) down.push(target(0, false));
    for (let i = 0; i < LEVELS - 1; i++) up.push(target(0, false));

    matDown = shader(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0 } });
    matUp = shader(UP, { tSrc: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() } });
    matFinal = shader(FINAL, { tScene: { value: null }, tBloom: { value: null }, tAO: { value: null }, uStrength: { value: 0.55 }, uExposure: { value: 1 },
      uTime: { value: 0 }, uAberr: { value: 0 }, uAO: { value: 1 }, uAoTint: { value: P.aoTint }, uDebug: { value: 0 },
      tDepth: { value: null }, uNear: { value: 0.5 }, uFar: { value: 1300 }, uDof: { value: 0 }, uFocus: { value: 12 }, uTexel: { value: new THREE.Vector2() } });
    const cam = function () { return { tDepth: { value: null }, uNear: { value: 0.5 }, uFar: { value: 1300 } }; };
    matAO = shader(AO, Object.assign(cam(), { uTexel: { value: new THREE.Vector2() }, uTan: { value: new THREE.Vector2(1, 1) }, uRadius: { value: AO_RADIUS } }));
    matBlur = shader(BLUR, Object.assign(cam(), { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }));

    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), matDown);
    quad.frustumCulled = false;
    quadScene = new THREE.Scene();
    quadScene.add(quad);
    quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  };

  // w, h are in device pixels (the canvas's real drawing-buffer size).
  P.resize = function (w, h) {
    if (!P.supported) return;
    rtScene.setSize(w, h);
    rtAO.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
    rtAO2.setSize(rtAO.width, rtAO.height);
    for (let i = 0; i < LEVELS; i++) {
      const lw = Math.max(2, w >> (i + 1)), lh = Math.max(2, h >> (i + 1));
      down[i].setSize(lw, lh);
      if (i < LEVELS - 1) up[i].setSize(lw, lh);
    }
  };

  function pass(mat, to) {
    quad.material = mat;
    renderer.setRenderTarget(to);
    renderer.render(quadScene, quadCam);
  }

  P.render = function (scene, camera, dt) {
    P.aberr = Math.max(0, P.aberr - (dt || 0) * 3.2);
    if (!P.supported || !P.enabled) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    clock += dt || 0;
    renderer.setRenderTarget(rtScene);
    renderer.render(scene, camera);

    const useAO = P.aoOn && P.ao > 0;
    if (useAO) {
      const depth = rtScene.depthTexture, tanY = Math.tan(camera.fov * Math.PI / 360);
      let u = matAO.uniforms;
      u.tDepth.value = depth; u.uNear.value = camera.near; u.uFar.value = camera.far;
      u.uTexel.value.set(1 / rtScene.width, 1 / rtScene.height);
      u.uTan.value.set(tanY * camera.aspect, tanY);
      pass(matAO, rtAO);
      u = matBlur.uniforms;
      u.tDepth.value = depth; u.uNear.value = camera.near; u.uFar.value = camera.far;
      u.tSrc.value = rtAO.texture; u.uDir.value.set(1 / rtAO.width, 0);
      pass(matBlur, rtAO2);
      u.tSrc.value = rtAO2.texture; u.uDir.value.set(0, 1 / rtAO.height);
      pass(matBlur, rtAO);
    }

    let src = rtScene;
    for (let i = 0; i < LEVELS; i++) {
      matDown.uniforms.tSrc.value = src.texture;
      matDown.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      matDown.uniforms.uThreshold.value = i === 0 ? THRESHOLD : 0;
      pass(matDown, down[i]);
      src = down[i];
    }
    let acc = down[LEVELS - 1];
    for (let i = LEVELS - 2; i >= 0; i--) {
      matUp.uniforms.tSrc.value = acc.texture;
      matUp.uniforms.uTexel.value.set(1 / acc.width, 1 / acc.height);
      matUp.uniforms.tAdd.value = down[i].texture;
      pass(matUp, up[i]);
      acc = up[i];
    }
    matFinal.uniforms.tScene.value = rtScene.texture;
    matFinal.uniforms.tBloom.value = acc.texture;
    matFinal.uniforms.tAO.value = rtAO.texture;
    matFinal.uniforms.uAO.value = useAO ? P.ao : 0;
    matFinal.uniforms.uDebug.value = P.debug;
    matFinal.uniforms.tDepth.value = rtScene.depthTexture;
    matFinal.uniforms.uNear.value = camera.near;
    matFinal.uniforms.uFar.value = camera.far;
    matFinal.uniforms.uDof.value = P.dof;
    matFinal.uniforms.uFocus.value = P.focus;
    matFinal.uniforms.uTexel.value.set(1 / rtScene.width, 1 / rtScene.height);
    matFinal.uniforms.uExposure.value = P.exposure;
    matFinal.uniforms.uAberr.value = P.aberr;
    matFinal.uniforms.uTime.value = clock % 97;
    pass(matFinal, null);
  };
})(window.BB);
