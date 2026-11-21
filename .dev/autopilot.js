// Test-only autopilot, loaded into the page from the console. Not part of the game.
//   __auto(level, {up, loot, sloppy})  plays one level headlessly (no rendering) and returns a summary
//   __rate(levels, upFn, n, extra)     win rate over n headless runs per level
//   __live(true|false)                 steers the real, rendered game through synthetic mouse events
(function () {
  // The test tab shares localStorage with any tab a person is really playing in. It only ever
  // works on its in-memory copy of the save: nothing it does is written back.
  BB.Save.save = function () {};
  BB.Save.reset = function () {};
  if (!document.getElementById('test-badge')) {   // say so on screen, in case a person wanders into this tab
    const badge = document.createElement('div');
    badge.id = 'test-badge';
    badge.textContent = 'TEST TAB - progress here is not saved';
    badge.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;padding:5px 9px;border-radius:6px;background:#ffd23f;color:#1a1a1a;font:800 11px/1 system-ui,sans-serif;pointer-events:none;opacity:.9';
    document.body.appendChild(badge);
  }
  function steer(G, opts, st, t, dt) {
    const s = G.squad;
    let tx = null, row = null;
    for (let i = G.gateIdx; i < G.gates.length; i++) {
      const g = G.gates[i];
      if (g.used) continue;
      if (g.d - s.d > 34) break;
      if (!row) row = [g]; else if (Math.abs(g.d - row[0].d) < 0.01) row.push(g); else break;
    }
    const val = function (g) { return g.op === 'mul' ? s.count * g.value : s.count + g.value; };
    let lootLane = false;
    if (row) {
      if (row[0].slim) {
        if (opts.loot) { lootLane = true; tx = -Math.sign((row[0].x0 + row[0].x1) / 2) * 3; }
        else tx = (row[0].x0 + row[0].x1) / 2;
      } else {
        if (st.rowKey !== row[0].d) { st.rowKey = row[0].d; st.rowWrong = !!opts.sloppy && Math.random() < 0.25; }
        const shoot = row.filter(function (g) { return g.shootable; })[0];
        let best = row[0];
        row.forEach(function (g) { if (st.rowWrong ? val(g) < val(best) : val(g) > val(best)) best = g; });
        if (shoot && row[0].d - s.d > 7 && !opts.sloppy) best = shoot;
        if (row[0].d - s.d < 20 || shoot) tx = (best.x0 + best.x1) / 2;
      }
    }
    if (tx === null || lootLane) {
      let target = null, bd = 1e9;
      const okSide = function (x) { return !s.side || Math.sign(x) === s.side; };
      for (let i = G.crateIdx; i < G.crates.length; i++) {
        const c = G.crates[i], r = c.d - s.d;
        if (!c.dead && c.reward === 'kaiju' && r > 0 && r < 48) target = c.x;
      }
      if (target === null && !opts.sloppy) for (const e of G.enemies) {
        const r = e.d - s.d;
        if (e.type === 2 && r > 0 && r < 46 && r < bd && okSide(e.x)) { bd = r; target = e.x; }
      }
      if (target === null) for (const e of G.enemies) {
        const r = e.d - s.d;
        if (r > 0 && r < 46 && r < bd && okSide(e.x)) { bd = r; target = e.x; }
      }
      if (target === null || bd > 30) for (let i = G.crateIdx; i < G.crates.length; i++) {
        const c = G.crates[i], r = c.d - s.d;
        if (!c.dead && r > 0 && r < 46 && okSide(c.x)) { target = c.x; break; }
      }
      if (target === null && G.boss.active && !G.boss.dead) target = G.boss.x;
      if (target !== null) tx = target; else if (tx === null) tx = s.x;
    }
    if (G.boss.slam) tx = -G.boss.slam.side * 3.2;   // get off the half that is about to be slammed
    if (G.fireballs.length) {   // stand wherever is furthest from every fireball that is about to land
      let best = tx, bestScore = -1e9;
      for (let x = -5; x <= 5.01; x += 0.5) {
        if (G.boss.slam && x * G.boss.slam.side > 0) continue;
        let near = 1e9;
        for (const f of G.fireballs) if (f.dur - f.t < 1.1) near = Math.min(near, Math.abs(f.x - x));
        const score = Math.min(near, 4) * 2 - Math.abs(x - s.x) * 0.15 - Math.abs(x) * 0.05;
        if (score > bestScore) { bestScore = score; best = x; }
      }
      tx = best;
    }
    if (opts.sloppy) {            // slow reactions + wobbly aim
      st.held -= dt;
      if (st.held <= 0) { st.held = 0.3; st.heldTx = tx + Math.sin(t * 1.3) * 1.4; }
      tx = st.heldTx;
    }
    for (let i = G.crateIdx; i < G.crates.length; i++) {   // don't walk into barrels
      const c = G.crates[i], r = c.d - s.d;
      if (c.dead || r < -1 || r > 6 + s.hd) continue;
      const need = s.hw * 0.85 + c.r + 0.5;
      if (Math.abs(c.x - tx) < need) {
        const dir = (s.x - c.x) >= 0 ? 1 : -1;
        let alt = c.x + dir * need;
        if (Math.abs(alt) > 5.6 - s.hw) alt = c.x - dir * need;
        tx = alt;
      }
    }
    return tx;
  }
  const fresh = function () { return { held: 0, heldTx: 0, rowKey: -1, rowWrong: false }; };

  // A real mouse hovering over the page puts the game in follow-the-cursor mode, which would
  // overrule the steering below on every rendered frame. A synthetic touch drag switches that off.
  function handsOff() {
    const c = document.getElementById('c'), o = { pointerType: 'touch', clientX: 5, clientY: 5, bubbles: true };
    c.dispatchEvent(new PointerEvent('pointerdown', o));
    c.dispatchEvent(new PointerEvent('pointermove', o));
    c.dispatchEvent(new PointerEvent('pointerup', o));
  }

  window.__auto = function (level, opts) {
    opts = opts || {};
    const G = BB.Game, save = BB.Save.data, keep = JSON.stringify(save);
    save.level = level;
    G.sel = level;
    if (opts.up) Object.assign(save.up, opts.up);
    G.start();
    const dt = 1 / 60, ev = [], st = fresh();
    let t = 0, lastCount = G.squad.count;
    while ((G.state === 'playing' || G.state === 'ending') && t < 400) {
      const s = G.squad;
      s.tx = steer(G, opts, st, t, dt);
      G.update(dt);
      t += dt;
      if (s.count !== lastCount) { ev.push(t.toFixed(1) + 's d' + Math.round(s.d) + ' ' + lastCount + '>' + s.count); lastCount = s.count; }
    }
    const r = {
      level: level, result: G.run.result, state: G.state, t: +t.toFixed(1), d: Math.round(G.squad.d), len: Math.round(G.level.length),
      count: G.squad.count, peak: G.run.peak, kills: G.run.kills, coins: Math.floor(G.run.coins),
      bossHp: Math.round(G.boss.hp) + '/' + G.boss.maxHp, keep: +(G.squad.count / Math.max(1, G.run.peak)).toFixed(2), combo: G.run.bestCombo, buffs: [G.run.rateMul.toFixed(2), G.run.dmgMul.toFixed(2), G.run.multi],
      ev: ev.length > 60 ? ev.slice(0, 30).concat(['...'], ev.slice(-25)) : ev, plan: G.level.plan
    };
    const orig = JSON.parse(keep);
    Object.assign(save, orig);
    save.up = orig.up;
    BB.Save.save();
    return r;
  };

  window.__rate = function (levels, upFn, n, extra) {
    const out = [];
    for (const lv of levels) {
      let wins = 0, frac = 0, coins = 0, tt = 0, surv = 0;
      const keeps = [];
      const where = [];
      for (let i = 0; i < n; i++) {
        const r = __auto(lv, Object.assign({ up: upFn(lv) }, extra || {}));
        if (r.result === 'win') { wins++; surv += r.count; keeps.push(r.keep); } else where.push(r.d + '/' + r.len);
        frac += r.d / r.len; coins += r.coins; tt += r.t;
      }
      out.push('L' + lv + ' wins ' + wins + '/' + n + ' prog ' + Math.round(frac / n * 100) + '% coins ' + Math.round(coins / n) +
        ' t ' + Math.round(tt / n) + 's' + (wins ? ' surv ' + Math.round(surv / wins) + ' keep ' + keeps.join('/') : '') + (where.length ? ' diedAt ' + where.join(',') : ''));
    }
    return out.join('\n');
  };
  window.__exp = function (l) { return { squad: Math.round(0.6 * (l - 1)), dmg: Math.round(0.8 * (l - 1)), rate: Math.round(0.4 * (l - 1)), armor: 0, income: 0 }; };
  window.__zero = function () { return { squad: 0, dmg: 0, rate: 0, armor: 0, income: 0 }; };

  // Fast-forward a level headlessly until cond(G) is true, then freeze it so it can be looked at.
  window.__until = function (level, cond, opts) {
    opts = opts || {};
    const G = BB.Game, save = BB.Save.data, keep = JSON.stringify(save);
    save.level = level;
    G.sel = level;
    if (opts.up) Object.assign(save.up, opts.up);
    G.start();
    const orig = JSON.parse(keep);
    Object.assign(save, orig);
    save.up = orig.up;
    const dt = 1 / 60, st = fresh();
    let t = 0;
    while (G.state === 'playing' && t < 400 && !cond(G)) { G.squad.tx = steer(G, opts, st, t, dt); G.update(dt); t += dt; }
    const hit = G.state === 'playing';
    if (hit) G.state = 'paused';
    BB.World.setMenu(false, true);
    BB.World.snapCamera(G.squad.x, -G.squad.d);
    for (let i = 0; i < 4; i++) BB.tick(0);   // force fresh frames even if the tab is being throttled
    return { reached: hit, t: +t.toFixed(1), d: Math.round(G.squad.d), count: G.squad.count, enemies: G.enemies.length, state: G.state };
  };

  // Like __until, but every step runs the whole frame (simulation + drawing), so cosmetic animation
  // ends up exactly as a player would see it. gl.finish() after each frame makes the timing include
  // the GPU's work, which gives a true per-frame cost even when the tab's own frame clock is throttled.
  window.__play = function (level, cond, opts) {
    opts = opts || {};
    const G = BB.Game, save = BB.Save.data, keep = JSON.stringify(save);
    save.level = level;
    G.sel = level;
    if (opts.up) Object.assign(save.up, opts.up);
    G.start();
    const orig = JSON.parse(keep);
    Object.assign(save, orig);
    save.up = orig.up;
    handsOff();
    const r = BB.World.renderer, gl = r.getContext(), dt = 1 / 60, st = fresh(), px = new Uint8Array(4);
    BB.World.setMenu(false, true);
    r.info.autoReset = false;
    let t = 0, frames = 0, worst = 0, calls = 0, tris = 0;
    const t0 = performance.now();
    while (G.state === 'playing' && t < 400 && !cond(G, t)) {
      G.squad.tx = steer(G, opts, st, t, dt);
      const f0 = performance.now();
      r.info.reset();
      BB.tick(dt);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // blocks until the GPU has really finished the frame
      worst = Math.max(worst, performance.now() - f0);
      calls = Math.max(calls, r.info.render.calls);
      tris = Math.max(tris, r.info.render.triangles);
      t += dt;
      frames++;
    }
    const ms = (performance.now() - t0) / Math.max(1, frames);
    r.info.autoReset = true;
    const hit = G.state === 'playing';
    if (hit) G.state = 'paused';
    BB.tick(0);
    // DOM overlays animate on the browser's clock, which stands still in a throttled tab: clear them for a clean look
    ['flash', 'hurt'].forEach(function (id) { document.getElementById(id).classList.remove('go'); });
    document.getElementById('floaters').replaceChildren();
    document.getElementById('banner').className = '';
    document.getElementById('hint').classList.remove('show');
    return { reached: hit, t: +t.toFixed(1), d: Math.round(G.squad.d), count: G.squad.count, enemies: G.enemies.length,
      msPerFrame: +ms.toFixed(2), worstMs: +worst.toFixed(1), maxDrawCalls: calls, maxTriangles: tris };
  };

  // Real-time play through the genuine input path: works out where the mouse would have to be
  // for the squad to go to the chosen x, and dispatches that as a pointermove.
  let liveId = 0;
  window.__live = function (on, opts) {
    cancelAnimationFrame(liveId);
    if (!on) return 'off';
    const st = fresh(), a = { x: 0, y: 0 }, b = { x: 0, y: 0 };
    let t = 0;
    (function loop() {
      liveId = requestAnimationFrame(loop);
      const G = BB.Game;
      if (G.state !== 'playing') return;
      t += 1 / 60;
      const tx = steer(G, opts || {}, st, t, 1 / 60);
      BB.World.project(-6, 0, -G.squad.d, a);
      BB.World.project(6, 0, -G.squad.d, b);
      const px = a.x + (tx + 6) / 12 * (b.x - a.x);
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: px, clientY: innerHeight * 0.7, pointerType: 'mouse', bubbles: true }));
    })();
    return 'on';
  };
})();
