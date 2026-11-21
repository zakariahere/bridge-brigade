// Post-processing: HDR bloom + a light colour grade.
//
// The scene is drawn into a multisampled half-float buffer, so emissive things (bullets, lamps,
// eyes, the sun) can hold colour values above 1.0. Bloom then keeps only what exceeds a threshold
// just under 1.0, blurs it by repeatedly halving the image and adding the levels back up, and the
// final pass lays that glow over the scene, rolls the over-bright values off and adds a vignette.
(function (BB) {
  'use strict';

  const P = BB.Post = { supported: false, enabled: true, exposure: 1, aberr: 0 };
  // Impacts split the red and blue channels apart towards the screen edges for a few frames.
  P.kick = function (a) { P.aberr = Math.min(1.4, Math.max(P.aberr, a * 1.3)); };
  const LEVELS = 4, THRESHOLD = 0.95;
  let renderer, rtScene, quad, quadScene, quadCam, matDown, matUp, matFinal;
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

  const FINAL = [
    'uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uStrength; uniform float uExposure; uniform float uTime; uniform float uAberr;',
    'varying vec2 vUv;',
    // identity below 0.8, then a soft shoulder that approaches 1.0: over-bright cores go white-hot instead of clipping
    'vec3 shoulder(vec3 x) { return min(x, 0.8) + 0.2 * (1.0 - exp(-max(x - 0.8, 0.0) * 4.0)); }',
    'void main() {',
    '  vec2 c = vUv - 0.5;',
    '  vec2 off = c * (0.25 + dot(c, c) * 3.0) * uAberr * 0.007;',   // nothing in the middle, growing towards the corners
    '  vec3 col = vec3(texture2D(tScene, vUv + off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - off).b);',
    '  col += texture2D(tBloom, vUv).rgb * uStrength;',
    '  col = shoulder(col * uExposure);',
    '  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));',
    '  col = mix(vec3(l), col, 1.14);',                      // a touch more saturation
    '  col = (col - 0.5) * 1.06 + 0.5;',                     // and contrast
    '  vec2 q = (vUv - 0.5) * vec2(1.0, 0.86);',
    '  col *= 1.0 - 0.2 * smoothstep(0.38, 0.9, length(q));',  // vignette
    '  col += (fract(sin(dot(vUv * 913.7 + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;',  // dither: no banding in the sky
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
    for (let i = 0; i < LEVELS; i++) down.push(target(0, false));
    for (let i = 0; i < LEVELS - 1; i++) up.push(target(0, false));

    matDown = shader(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0 } });
    matUp = shader(UP, { tSrc: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() } });
    matFinal = shader(FINAL, { tScene: { value: null }, tBloom: { value: null }, uStrength: { value: 0.55 }, uExposure: { value: 1 }, uTime: { value: 0 }, uAberr: { value: 0 } });

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
    matFinal.uniforms.uExposure.value = P.exposure;
    matFinal.uniforms.uAberr.value = P.aberr;
    matFinal.uniforms.uTime.value = clock % 97;
    pass(matFinal, null);
  };
})(window.BB);
