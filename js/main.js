// Boot, the frame loop and player input.
(function (BB) {
  'use strict';

  if (!window.THREE) {   // the CDN script failed (offline?) - show a message instead of a black page
    document.getElementById('fatal').classList.remove('hidden');
    return;
  }

  const G = BB.Game;
  BB.Save.load();
  BB.Audio.setSfx(BB.Save.data.sfx);
  BB.Audio.setMusic(BB.Save.data.music);
  BB.World.init(document.getElementById('c'));
  BB.Post.enabled = BB.Save.data.fx;
  BB.Actors.init(BB.World.scene);
  BB.UI.init();
  G.toMenu();

  // ---------- input ----------
  // Mouse: the squad goes to wherever the cursor is over the bridge (no button needed).
  // Touch: relative drag, so your thumb does not have to cover the squad.
  // Keyboard: A/D or the arrow keys.

  const p0 = { x: 0, y: 0 }, p1 = { x: 0, y: 0 };
  const keys = {};
  let dragging = false, lastX = 0, mouseX = -1, mouseMode = false;

  // Where the two edges of the bridge are on screen at the squad's depth, in pixels.
  function bridgeEdges() {
    const z = -G.squad.d;
    BB.World.project(-BB.CFG.HALF_W, 0, z, p0);
    BB.World.project(BB.CFG.HALF_W, 0, z, p1);
  }

  function followMouse() {
    bridgeEdges();
    const t = (mouseX - p0.x) / Math.max(1, p1.x - p0.x);
    G.squad.tx = -BB.CFG.HALF_W + 2 * BB.CFG.HALF_W * t;
  }

  window.addEventListener('pointerdown', function (e) {
    BB.Audio.init();
    if (e.target.closest('button, .screen')) return;
    dragging = true;
    lastX = e.clientX;
    if (e.pointerType === 'mouse') { mouseMode = true; mouseX = e.clientX; }
  });

  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse') {
      mouseMode = true;
      mouseX = e.clientX;
    } else if (dragging && G.state === 'playing') {
      mouseMode = false;
      bridgeEdges();
      G.squad.tx += (e.clientX - lastX) * (2 * BB.CFG.HALF_W / Math.max(1, p1.x - p0.x)) * 1.35;
      lastX = e.clientX;
    }
  });

  window.addEventListener('pointerup', function () { dragging = false; });
  window.addEventListener('pointercancel', function () { dragging = false; });

  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (G.state === 'playing') G.pause(); else if (G.state === 'paused') G.resume();
    }
    if ((e.code === 'Enter' || e.code === 'Space') && G.state === 'menu') { BB.Audio.init(); G.start(); }
    if (G.state === 'menu' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) G.select(e.code === 'ArrowLeft' ? -1 : 1);
    if (e.code.indexOf('Arrow') === 0 || e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () { for (const k in keys) keys[k] = false; });
  document.addEventListener('visibilitychange', function () { if (document.hidden) G.pause(); });

  function input(dt) {
    if (G.state !== 'playing') return;
    const dir = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    if (dir) { mouseMode = false; G.squad.tx += dir * 18 * dt; }
    // Re-evaluated every frame, not just on mouse events: the camera pans as the squad moves,
    // so the world point under a stationary cursor keeps changing.
    else if (mouseMode && mouseX >= 0) followMouse();
  }

  // ---------- frame loop ----------

  // One frame: input -> simulate -> move camera -> draw actors -> overlay UI -> render.
  BB.tick = function (dt) {
    input(dt);
    const simDt = G.update(dt);
    // Visual-only animation still runs on the menu and behind a victory card (the squad cheers and
    // the fireworks keep going), but freezes while paused or after a defeat.
    const won = G.run.result === 'win';
    const animDt = (G.state === 'playing' || G.state === 'ending') ? simDt
      : (G.state === 'menu' || (G.state === 'result' && won)) ? dt : 0;
    if (won && (G.state === 'ending' || G.state === 'result')) BB.Actors.celebrate(dt, G);
    BB.World.update(dt, G.squad.x, -G.squad.d);
    BB.Actors.sync(G, animDt);
    BB.UI.update(G, dt);
    BB.World.render(dt);
  };

  // If the picture cannot keep up, the two most expensive effects are given up one at a time:
  // first the sea's mirror image, then ambient occlusion. It is judged over 120 frames of real
  // play, so one hitch never triggers it, and frames from a tab left in the background (very long
  // ones) are not counted at all. 38 ms is slower than 30 frames a second, so a screen or a
  // power-saving mode capped at 30 does not count as struggling.
  let slow = 0, seen = 0, dropped = 0;
  function watch(ms) {
    if (dropped >= 2 || G.state !== 'playing' || document.hidden || ms > 200) return;
    seen++;
    if (ms > 38) slow++;
    if (seen < 120) return;
    if (slow > 72) {
      dropped++;
      if (dropped === 1) BB.World.mirror = false; else BB.Post.aoOn = false;
    }
    seen = slow = 0;
  }

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    watch(now - last);
    const dt = Math.min(0.05, (now - last) / 1000);   // clamp so a stalled tab cannot teleport things
    last = now;
    BB.tick(dt);
  }
  requestAnimationFrame(frame);
})(window.BB);
