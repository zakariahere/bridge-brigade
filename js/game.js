// The simulation: squad, bullets, enemies, gates, barrels, the ally kaiju and the boss.
// Positions are (x, d): x across the bridge, d = distance along it. No three.js in here.
(function (BB) {
  'use strict';

  const CFG = BB.CFG;
  const G = BB.Game = {
    state: 'boot',      // boot | menu | playing | paused | ending | result
    sel: 1,             // the level picked on the menu (1..highest unlocked)
    time: 0, timeScale: 1,
    cine: 0,            // seconds left of the boss's entrance: the world crawls while the camera visits it
    stopT: 0,           // hit-stop: a few frames of near-freeze that give big impacts their weight
    level: null, stats: null, squad: null, run: null,
    enemies: [], bullets: [], gates: [], crates: [],
    booms: [], fireballs: [], drones: [],
    pending: [], pendingIdx: 0, gateIdx: 0, crateIdx: 0, scaleIdx: 0,
    boss: null, ally: null
  };

  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const MULTI = [[0], [-0.05, 0.05], [-0.09, 0, 0.09]];   // bullet fan angles per multi-shot level
  const MULTI_DMG = [1, 0.75, 0.65];                      // per-bullet damage, so 2 shots = x1.5, 3 = x1.95
  const COMBO_TIERS = [15, 40, 90, 180];                  // kills in a row for +10% / +20% / +30% / +40% kill coins
  const COMBO_BONUS = 0.1;
  const COMBO_HOLD = 2.6;                                 // seconds without a kill before the streak is gone
  const STAR2 = 0.45, STAR3 = 0.8;                       // share of your peak squad still standing at the end
  const bulletPool = [];

  function hitstop(t) { G.stopT = Math.max(G.stopT, t); }

  // ---------- setup ----------

  G.setup = function (n) {
    const L = G.level = BB.makeLevel(n);
    G.stats = BB.stats(BB.Save.data);
    G.enemies.length = 0;
    G.bullets.length = 0;
    G.gates = L.gates.map(function (g) { return Object.assign({ used: false, acc: 0, view: null }, g); });
    G.crates = L.crates.map(function (c) { return Object.assign({ dead: false, hitT: 0, view: null }, c); });
    G.pending = L.enemies;
    G.pendingIdx = G.gateIdx = G.crateIdx = G.scaleIdx = 0;
    G.booms.length = G.fireballs.length = G.drones.length = 0;
    G.boss = {
      x: 0, d: L.boss.d, hp: L.boss.hp, maxHp: L.boss.hp, tough: 1, active: false, dead: false, deadT: 0,
      flash: 0, flashCd: 0, roar: 0, walking: false, spawnT: 3, stompT: 0.6,
      atkT: 3.5, atkN: 0, slam: null, beamT: 0, beamSide: 1, holdT: 0, enraged: false, rage: 0
    };
    G.ally = null;
    G.run = {
      dmgMul: 1, rateMul: 1, multi: 1, kills: 0, coins: 0, lost: 0, peak: 0, t: 0, endT: 0, result: null,
      combo: 0, comboT: 0, tier: 0, bestCombo: 0,
      shield: 0, shieldHit: 0, freezeT: 0, tipBloat: false
    };
    G.squad = { x: 0, tx: 0, d: 0, count: 0, speed: 0, moving: false, side: 0, squeeze: 1, baseHw: 1, baseHd: 1, hw: 1, hd: 1, soldiers: [] };
    setCount(G.stats.squad, true);
    G.time = 0;
    G.timeScale = 1;
    G.cine = G.stopT = 0;
    BB.World.buildLevel(L);
    BB.World.setCine(false, 0, 0, true);
    BB.Actors.buildLevel(G);
    BB.World.snapCamera(0, 0);
  };

  G.toMenu = function () {
    const boot = G.state === 'boot';
    if (boot) G.sel = BB.Save.data.level;
    G.sel = BB.clamp(G.sel, 1, BB.Save.data.level);
    G.setup(G.sel);
    G.state = 'menu';
    BB.World.setMenu(true, boot);
    BB.Audio.setMood('menu');
    BB.UI.showMenu();
  };
  G.start = function () {
    G.sel = BB.clamp(G.sel, 1, BB.Save.data.level);
    G.setup(G.sel);
    G.state = 'playing';
    BB.World.setMenu(false, false);   // the camera swoops from the menu's hero shot up to the chase view
    BB.Audio.setMood('run');
    BB.UI.showHUD(G);
    BB.UI.banner(BB.BIOMES[G.level.theme].name, 'place');
  };
  // Menu level picker: any unlocked level can be replayed (for stars, coins or just the scenery).
  G.select = function (delta) {
    if (G.state !== 'menu') return;
    const n = BB.clamp(G.sel + delta, 1, BB.Save.data.level);
    if (n === G.sel) return;
    G.sel = n;
    G.setup(n);
    BB.UI.refreshMenu();
  };
  G.pause = function () { if (G.state === 'playing') { G.state = 'paused'; BB.UI.showPause(true); } };
  G.resume = function () { if (G.state === 'paused') { G.state = 'playing'; BB.UI.showPause(false); } };

  // Called after buying an upgrade on the menu so the idle squad reflects it immediately.
  G.refreshStats = function () {
    G.stats = BB.stats(BB.Save.data);
    if (G.state === 'menu') setCount(G.stats.squad, false);
  };

  // ---------- squad ----------

  // Sunflower-seed packing: soldier i sits at radius ~sqrt(i) and angle i * golden angle.
  // It stays a tight, evenly spaced blob at any head-count, and adding one never moves the rest.
  function slotOf(i, o) {
    const r = Math.sqrt(i + 0.35), a = i * GOLDEN;
    o.ox = Math.cos(a) * r * 0.42;
    o.od = Math.sin(a) * r * 0.5;
  }

  function setCount(n, silent) {
    const s = G.squad;
    n = Math.max(0, Math.min(9999, Math.round(n)));
    s.count = n;
    const vis = Math.min(n, CFG.MAX_VISUAL);
    while (s.soldiers.length > vis) {
      const gone = s.soldiers.pop();
      if (!silent) { BB.Actors.corpse(1, 0, gone.x, gone.d, 0); BB.Actors.burst(gone.x, 0.9, -gone.d, 0xd8382e, 3, 4); }
    }
    while (s.soldiers.length < vis) {
      const o = { ox: 0, od: 0, x: 0, d: 0, phase: Math.random() * 6.283, pop: silent ? 1 : 0, cd: Math.random() * 0.5 };
      slotOf(s.soldiers.length, o);
      o.x = s.x + o.ox * s.squeeze;
      o.d = s.d + o.od / s.squeeze;
      s.soldiers.push(o);
    }
    const r = Math.sqrt(Math.max(1, vis));
    s.baseHw = 0.42 * r + 0.3;
    s.baseHd = 0.5 * r + 0.3;
    if (G.run) G.run.peak = Math.max(G.run.peak, n);
  }

  function dividerAt(a, b) {
    const dv = G.level.dividers;
    for (let i = 0; i < dv.length; i++) if (dv[i].d0 < b && dv[i].d1 > a) return true;
    return false;
  }

  function addCoins(n) { G.run.coins += n * G.stats.income; }

  // Every rewarded kill extends the streak. Past each tier the kill coins pay out a little more,
  // so mowing through a horde without a pause is worth more than picking it apart.
  function addKill(coin) {
    const run = G.run;
    run.kills++;
    run.combo++;
    run.comboT = COMBO_HOLD;
    if (run.combo > run.bestCombo) run.bestCombo = run.combo;
    if (run.tier < COMBO_TIERS.length && run.combo >= COMBO_TIERS[run.tier]) {
      run.tier++;
      BB.Audio.combo(run.tier);
      BB.UI.comboTier(run.tier);
    }
    addCoins(coin * (1 + run.tier * COMBO_BONUS));
  }

  // Adaptive difficulty. The generator sized each encounter for an expected squad (`est`). If the
  // real squad is bigger or smaller, toughness follows it part of the way (exponent < 1), so
  // growing still pays off but a runaway squad cannot trivialise the rest of the level. Only
  // head-count is compared: bought upgrades and in-run power-ups keep their full value.
  function toughness(est, power, lo, hi) {
    return BB.clamp(Math.pow(Math.max(1, G.squad.count) / Math.max(1, est), power), lo, hi);
  }

  function hurtSquad(n, armored) {
    const s = G.squad, run = G.run;
    if (s.count <= 0) return;
    let lost = 0;
    if (armored) { for (let i = 0; i < n; i++) if (Math.random() >= G.stats.armor) lost++; }
    else lost = n;
    if (!lost) { BB.UI.floater('BLOCK', s.x, 2.4, -s.d, ''); return; }
    if (run.shield > 0) {   // the energy dome soaks up casualties one for one until it is spent
      const soak = Math.min(run.shield, lost);
      run.shield -= soak;
      lost -= soak;
      run.shieldHit = 0.25;
      BB.Audio.shieldHit();
      if (run.shield <= 0) {
        BB.Actors.burst(s.x, 1.6, -s.d, 0x8fe6ff, 26, 9, 1.1, 2.2);
        BB.Actors.ring(s.x, s.d, s.hw + 4, 0x8fe6ff, 0.5);
        BB.Audio.shieldBreak();
        BB.UI.floater('SHIELD DOWN', s.x, 3.2, -s.d, 'bad');
      }
      BB.UI.setBuffs(G);
      if (!lost) { BB.UI.floater('ABSORBED', s.x + BB.rand(-1, 1), 2.4, -s.d, 'cool'); return; }
    }
    lost = Math.min(lost, s.count);
    const shownBefore = s.soldiers.length;
    setCount(s.count - lost, false);
    // A squad bigger than what is drawn loses head-count without anyone visibly leaving the
    // formation, so knock a few bodies out of it anyway: the loss should always be seen.
    let extra = Math.min(4, lost) - (shownBefore - s.soldiers.length);
    while (extra-- > 0 && s.soldiers.length) {
      const o = s.soldiers[Math.floor(Math.random() * s.soldiers.length)];
      BB.Actors.corpse(1, 0, o.x, o.d, 0);
    }
    G.run.lost += lost;
    BB.Audio.hurt();
    BB.UI.hurt();
    BB.World.addShake(0.22);
    BB.UI.floater('-' + lost, s.x + BB.rand(-1, 1), 2.4, -s.d, 'bad');
    if (s.count <= 0) lose();
  }

  // ---------- bullets ----------

  // y is only for show: drone rounds start up in the air and drop to the usual bullet height.
  function fire(x, d, vx, dmg, y) {
    if (G.bullets.length >= 680) return;
    const b = bulletPool.pop() || {};
    b.x = x;
    b.d = d;
    b.y = y;
    b.vx = vx;
    b.life = CFG.BULLET_RANGE / CFG.BULLET_SPEED;
    b.dmg = dmg;
    G.bullets.push(b);
  }

  function shoot(o, dmg, multi) {
    const fan = MULTI[multi - 1];
    for (let i = 0; i < fan.length; i++) fire(o.x, o.d + 0.9, fan[i] * CFG.BULLET_SPEED + BB.rand(-0.6, 0.6), dmg, 1);
    o.flash = 0.05;   // read by the renderer: muzzle flash + gun recoil
  }

  // Gunship drones weave back and forth above the squad, hosing whatever is under them. Their
  // damage has a flat part (a lifeline for a tiny squad) plus a share of the head-count.
  function updateDrones(dt, playing) {
    const s = G.squad, ds = G.drones;
    if (!ds.length) return;
    const dmg = G.stats.dmg * G.run.dmgMul * (2.5 + s.count * 0.05);
    let lo = -5.3, hi = 5.3;
    if (s.side > 0) lo = 0.7; else if (s.side < 0) hi = -0.7;
    for (let i = 0; i < ds.length; i++) {
      const dr = ds[i];
      dr.ph += dt;
      const tx = BB.clamp(s.x + Math.sin(dr.ph * 1.5 + i * 2.1) * 3.6, lo, hi);
      const px = dr.x;
      dr.x = BB.damp(dr.x, tx, 5, dt);
      dr.vx = dt > 0 ? (dr.x - px) / dt : 0;
      dr.d = BB.damp(dr.d, s.d + 2.2 + Math.cos(dr.ph * 1.1 + i) * 1.2, 9, dt);
      if (dr.flash > 0) dr.flash -= dt;
      dr.cd -= dt;
      if (playing && s.count > 0 && dr.cd <= 0) {
        dr.cd = dr.cd < -0.2 ? 0.14 : dr.cd + 0.14;
        fire(dr.x, dr.d + 0.8, BB.rand(-1.4, 1.4), dmg, 3.1);
        dr.flash = 0.05;
      }
    }
  }

  function updateBullets(dt) {
    const bs = G.bullets, es = G.enemies, gates = G.gates, crates = G.crates, boss = G.boss;
    const bossUp = boss.active && !boss.dead;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i], pd = b.d;
      b.d += CFG.BULLET_SPEED * dt;
      b.x += b.vx * dt;
      b.life -= dt;
      if (b.y > 1) b.y = Math.max(1, b.y - 16 * dt);
      const nd = b.d;
      let hit = false;

      // Bullets move ~1 unit per frame, so every test is "did the segment pd..nd cross the target".
      if (bossUp && nd >= boss.d - 1.8 && pd <= boss.d + 1.8 && Math.abs(b.x - boss.x) < 2.7) {
        hurtBoss(b.dmg);
        hit = true;
      }
      for (let c = G.crateIdx; !hit && c < crates.length; c++) {
        const k = crates[c];
        if (k.d - k.r > nd) break;                       // sorted by d: nothing further can be in reach
        if (!k.dead && pd <= k.d + k.r && Math.abs(b.x - k.x) < k.r) { hurtCrate(k, b.dmg); hit = true; }
      }
      for (let g = G.gateIdx; !hit && g < gates.length; g++) {
        const k = gates[g];
        if (k.d > nd) break;
        if (k.shootable && !k.used && pd < k.d && b.x > k.x0 && b.x < k.x1) { boostGate(k, b.dmg); hit = true; }
      }
      for (let j = 0, m = es.length; !hit && j < m; j++) {
        const e = es[j];
        if (e.d < pd - 0.6 || e.d > nd + 0.6) continue;
        const dx = e.x - b.x;
        if (dx > e.r || dx < -e.r) continue;
        hurtEnemy(j, b.dmg);
        hit = true;
      }

      if (hit || b.life <= 0) {
        if (hit && Math.random() < 0.5) BB.Actors.burst(b.x, 1.0, -nd, 0xfff3a0, 1, 3, 0.6, 2.2);
        bs[i] = bs[bs.length - 1];
        bs.pop();
        bulletPool.push(b);
      }
    }
  }

  // ---------- enemies ----------

  function spawnEnemy(type, x, d, aggro, tough) {
    const def = BB.ENEMY[type];
    G.enemies.push({
      type: type, x: x, d: d,
      hp: def.hp * G.level.hpScale * tough,
      r: 0.42 * def.scale + 0.12,
      speed: def.speed * BB.rand(0.85, 1.15),
      tough: tough,
      aggro: !!aggro, flash: 0, phase: Math.random() * 6.283
    });
  }

  function killEnemy(j, reward) {
    const es = G.enemies, e = es[j], def = BB.ENEMY[e.type];
    if (def.boom) {
      // A bloater does not leave a body: it goes off a moment later and takes its neighbours along.
      G.booms.push({ x: e.x, d: e.d, t: 0.08, r: def.boom, dmg: 70 * G.level.hpScale * e.tough });
    } else {
      BB.Actors.corpse(0, e.type, e.x, e.d, e.phase);                     // the body is thrown back...
    }
    BB.Actors.burst(e.x, 0.9 * def.scale, -e.d, def.color, e.type === 2 ? 12 : 3, e.type === 2 ? 7 : 5, def.scale);   // ...with a few chunks
    if (e.type === 2) { BB.Actors.ring(e.x, e.d, 3.2, 0xff7a4a, 0.4); hitstop(0.045); }
    if (reward) {
      addKill(def.coin);
      BB.Audio.kill();
      if (e.type === 2) BB.Actors.coins(e.x, e.d, 5);
    }
    es[j] = es[es.length - 1];   // swap-remove: O(1), order does not matter
    es.pop();
  }

  // Blasts go off a beat after whatever caused them, so a chain visibly ripples through a horde
  // instead of happening in a single frame. (It also keeps killEnemy from ever calling itself.)
  function updateBooms(dt) {
    const bs = G.booms, es = G.enemies;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      b.t -= dt;
      if (b.t > 0) continue;
      bs.splice(i, 1);
      BB.Actors.burst(b.x, 1.1, -b.d, 0xff8a2a, 14, 11, 1.5, 2.2);
      BB.Actors.burst(b.x, 1.3, -b.d, 0xffe27a, 8, 8, 1.0, 2.6);
      BB.Actors.ring(b.x, b.d, b.r * 1.5, 0xff8a3a, 0.4);
      BB.Audio.pop();
      BB.World.addShake(0.2);
      const r2 = b.r * b.r;
      for (let j = es.length - 1; j >= 0; j--) {
        const dx = es[j].x - b.x, dd = es[j].d - b.d;
        if (dx * dx + dd * dd < r2) hurtEnemy(j, b.dmg);   // may queue further blasts: they land next frame
      }
    }
  }

  function hurtEnemy(j, dmg) {
    const e = G.enemies[j];
    e.hp -= dmg;
    e.flash = 0.07;
    if (e.hp <= 0) killEnemy(j, true); else BB.Audio.hit();
  }

  function updateEnemies(dt) {
    const s = G.squad, es = G.enemies, alive = s.count > 0, run = G.run;
    const slow = run.freezeT > 0 ? 0.3 : 1;   // deep freeze: everything on the deck wades through treacle
    for (let j = es.length - 1; j >= 0; j--) {
      const e = es[j], def = BB.ENEMY[e.type];
      if (e.flash > 0) e.flash -= dt;
      const rel = e.d - s.d;
      if (!e.aggro) {
        if (rel >= CFG.AGGRO_DIST) continue;
        e.aggro = true;
        if (def.boom && !run.tipBloat && G.level.level <= 5) { run.tipBloat = true; BB.UI.banner('SHOOT THE BLOATERS!', 'tip'); }
      }

      e.d -= e.speed * slow * dt;
      // Enemies only start closing in sideways when fairly near. From further out they hold their
      // column, so a squad that never moves only ever shoots the ones straight ahead of it and
      // gets flanked by the rest: sweeping left and right is what actually thins a horde.
      if (alive && rel < CFG.FUNNEL_DIST) {
        // close in sideways on the nearest part of the squad, but never through a lane divider
        const tx = BB.clamp(e.x, s.x - s.hw * 0.8, s.x + s.hw * 0.8);
        const mv = def.lat * slow * dt;
        let nx = e.x + BB.clamp(tx - e.x, -mv, mv);
        if (dividerAt(e.d - 0.5, e.d + 0.5)) nx = e.x >= 0 ? Math.max(0.5, nx) : Math.min(-0.5, nx);
        e.x = nx;
      }

      if (alive) {
        const ex = (e.x - s.x) / (s.hw + 0.45), ed = (e.d - s.d) / (s.hd + 0.55);
        if (ex * ex + ed * ed < 1) {      // inside the squad's footprint: trade one enemy for soldiers
          killEnemy(j, false);
          hurtSquad(def.dmg, true);
          continue;
        }
      }
      if (rel < -14) { es[j] = es[es.length - 1]; es.pop(); }
    }
  }

  // ---------- gates ----------

  function applyGate(g) {
    const s = G.squad, before = s.count;
    g.used = true;
    let after = g.op === 'mul' ? Math.ceil(before * g.value - 1e-9) : before + g.value;
    after = Math.max(0, after);
    setCount(after, false);
    const delta = s.count - before;
    BB.UI.floater((delta >= 0 ? '+' : '') + delta, s.x, 2.6, -s.d, delta >= 0 ? 'good' : 'bad');
    BB.UI.pulse();
    BB.Actors.ring(s.x, s.d, g.slim ? 2.6 : 4.5, delta >= 0 ? 0x4aa8ff : 0xff4a4a, g.slim ? 0.3 : 0.5);
    if (delta >= 0) { if (g.slim) BB.Audio.plus(); else BB.Audio.gateGood(); }
    else { BB.Audio.gateBad(); BB.World.addShake(0.3); G.run.lost -= delta; }
    BB.Actors.consumeGate(g);
    if (s.count <= 0) lose();
  }

  function boostGate(g, dmg) {
    if (g.value >= g.cap) return;
    g.acc += dmg;
    let changed = false;
    while (g.acc >= g.per && g.value < g.cap) { g.acc -= g.per; g.value++; changed = true; }
    if (changed) { BB.Actors.refreshGate(g); BB.Audio.tick(); }
  }

  // ---------- barrels ----------

  function hurtCrate(c, dmg) {
    c.hp -= dmg;
    c.hitT = 0.1;
    if (c.hp <= 0) breakCrate(c, true); else BB.Audio.hit();
  }

  function breakCrate(c, reward) {
    if (c.dead) return;
    c.dead = true;
    BB.Actors.burst(c.x, 1.2, -c.d, c.reward === 'kaiju' ? 0xf2f2f2 : 0x8a5a2b, 18, 8, 1.4);
    BB.Actors.burst(c.x, 1.4, -c.d, 0xffd95a, 8, 7, 0.8, 2);
    BB.Actors.ring(c.x, c.d, reward ? 4.5 : 3, reward ? 0xffd23f : 0xff5a4a, 0.45);
    BB.Actors.removeCrate(c);
    BB.Audio.crate();
    BB.World.addShake(0.25);
    if (reward) { hitstop(0.035); grant(c); }
  }

  function grant(c) {
    const run = G.run, s = G.squad;
    let msg = '', own = false;   // own = the reward plays its own sound instead of the generic jingle
    switch (c.reward) {
      case 'rate':  run.rateMul *= 1.5; msg = 'FIRE RATE UP!'; break;
      case 'dmg':   run.dmgMul *= 1.5; msg = 'DAMAGE UP!'; break;
      case 'multi':
        if (run.multi < 3) { run.multi++; msg = 'MULTI-SHOT!'; }
        else { run.dmgMul *= 1.5; msg = 'DAMAGE UP!'; }
        break;
      case 'troops': setCount(s.count + c.amount, false); msg = '+' + c.amount + ' TROOPS!'; BB.UI.pulse(); break;
      case 'coins':
        addCoins(c.amount);
        msg = '+' + Math.round(c.amount * G.stats.income) + ' COINS!';
        BB.Actors.coins(c.x, c.d, 14);
        break;
      case 'nuke':   nuke(c.x, c.d); msg = 'BOOM!'; own = true; break;
      case 'kaiju':  spawnAlly(c.x, c.d); msg = 'KAIJU UNLEASHED!'; own = true; break;
      case 'freeze':
        run.freezeT = 7;
        msg = 'DEEP FREEZE!';
        own = true;
        BB.Actors.burst(c.x, 1.4, -c.d, 0xbfefff, 36, 13, 1.2, 2.2);
        BB.Actors.ring(c.x, c.d, 26, 0x9fe4ff, 0.9);
        BB.Actors.ring(c.x, c.d, 14, 0xffffff, 0.55);
        BB.Audio.freeze();
        break;
      case 'shield':
        run.shield += Math.max(5, Math.ceil(s.count * 0.35));
        msg = 'SHIELD UP!';
        own = true;
        BB.Actors.ring(s.x, s.d, s.hw + 5, 0x8fe6ff, 0.6);
        BB.Audio.shield();
        break;
      case 'drone':
        if (G.drones.length < 3) {
          G.drones.push({ x: c.x, d: c.d, vx: 0, ph: G.drones.length * 2.1, cd: 0.3, flash: 0, born: G.time });
          msg = 'GUNSHIP DRONE!';
          own = true;
          BB.Audio.drone();
        } else { run.rateMul *= 1.5; msg = 'FIRE RATE UP!'; }   // the sky is full: take the next best thing
        break;
    }
    if (!own) BB.Audio.powerup();
    BB.UI.banner(msg);
    BB.UI.setBuffs(G);
  }

  function nuke(x, d) {
    const es = G.enemies, b = G.boss;
    for (let j = es.length - 1; j >= 0; j--) {
      const dx = es[j].x - x, dd = es[j].d - d;
      if (dx * dx + dd * dd < 14 * 14) killEnemy(j, true);
    }
    if (b.active && !b.dead && Math.abs(b.d - d) < 20) hurtBoss(b.maxHp * 0.06);
    BB.Actors.burst(x, 1.2, -d, 0xff8a2a, 40, 14, 2, 2);
    BB.Actors.burst(x, 1.2, -d, 0xffe066, 30, 10, 1.6, 2.4);
    BB.Actors.ring(x, d, 15, 0xff9a3a, 0.7);
    BB.Actors.ring(x, d, 9, 0xfff0a0, 0.45);
    BB.Audio.boom();
    BB.World.addShake(1.0);
    BB.UI.flash();
    hitstop(0.09);
  }

  function updateCrates() {
    const s = G.squad, cs = G.crates;
    while (G.crateIdx < cs.length && cs[G.crateIdx].d < s.d - s.hd - 3) G.crateIdx++;
    if (s.count <= 0) return;
    for (let i = G.crateIdx; i < cs.length; i++) {
      const c = cs[i];
      if (c.d - s.d > s.hd + 2) break;
      if (c.dead) continue;
      if (Math.abs(c.d - s.d) < s.hd + 0.6 && Math.abs(c.x - s.x) < s.hw * 0.85 + c.r) {
        // Ran into a barrel that was still standing: the loot is wasted and it costs 15% of the squad.
        breakCrate(c, false);
        const loss = Math.max(1, Math.ceil(s.count * 0.15));
        BB.UI.floater('CRASH!', c.x, 3, -c.d, 'bad big');
        hurtSquad(loss, false);
        BB.World.addShake(0.5);
      }
    }
  }

  // ---------- ally kaiju ----------

  function spawnAlly(x, d) {
    G.ally = { x: x, baseX: x, d: d, t: 0, life: 9, roar: 1, stepT: 0, hitBoss: false };
    BB.Audio.roar();
    BB.World.addShake(0.6);
    BB.World.kick(1);   // the camera's field of view punches out for a moment as it charges off
  }

  function updateAlly(dt) {
    const a = G.ally;
    if (!a) return;
    const es = G.enemies, cs = G.crates, b = G.boss;
    a.t += dt;
    a.roar = Math.max(0, a.roar - dt);
    a.d += 15 * dt;
    a.x = BB.clamp(a.baseX * Math.max(0, 1 - a.t) + Math.sin(a.t * 2.2) * 2.6, -3.4, 3.4);   // weave across the bridge
    // It is as wide as the bridge: everything level with it gets trampled, nothing slips past the sides.
    for (let j = es.length - 1; j >= 0; j--) {
      if (Math.abs(es[j].d - a.d) < 3.6) killEnemy(j, true);
    }
    for (let i = G.crateIdx; i < cs.length; i++) {
      const c = cs[i];
      if (!c.dead && Math.abs(c.d - a.d) < 2.5 && Math.abs(c.x - a.x) < 3.5) breakCrate(c, true);
    }
    a.stepT -= dt;
    if (a.stepT <= 0) {   // footfall: dust across the deck and a little camera thump
      a.stepT = 0.35;
      BB.Actors.burst(a.x, 0.3, -a.d, 0xd9dde3, 10, 9, 1.3);
      BB.Actors.ring(a.x, a.d, 6.5, 0x7fc4ff, 0.45);
      BB.World.addShake(0.12);
      BB.Audio.stomp();
    }
    if (b.active && !b.dead && !a.hitBoss && a.d > b.d - 5) {
      a.hitBoss = true;
      hurtBoss(b.maxHp * 0.2);
      BB.World.addShake(0.8);
      a.life = Math.min(a.life, a.t + 0.25);
    }
    if (a.t > a.life || a.d - G.squad.d > 105) {
      BB.Actors.burst(a.x, 2.5, -a.d, 0x9fd0ff, 30, 9, 1.8, 1.8);
      BB.Actors.ring(a.x, a.d, 9, 0x9fd0ff, 0.6);
      G.ally = null;
    }
  }

  // ---------- boss ----------

  function wakeBoss() {
    const b = G.boss, info = G.level.boss.info;
    b.active = true;
    b.tough = toughness(G.level.boss.est, 0.6, 0.6, 3);
    b.hp = b.maxHp = Math.round(b.maxHp * toughness(G.level.boss.est, 0.7, 0.75, 5));
    b.roar = 1.3;
    // The entrance: the simulation drops to a crawl while the camera flies up the bridge for a
    // good look at what is coming, then swoops back. See G.update for the slow-down itself.
    G.cine = 2.7;
    BB.World.setCine(true, b.x, -b.d, false);
    BB.Audio.setMood('boss');
    BB.Audio.roar();
    BB.Audio.braam();
    BB.World.addShake(0.5);
    BB.UI.showBoss(true, info.name);
    BB.UI.cine(info);
  }

  function hurtBoss(dmg) {
    const b = G.boss;
    if (b.dead) return;
    b.hp -= dmg;
    // The boss is hit almost every frame, so the flash is a short blink on a cooldown;
    // otherwise it would simply stay lit up for the whole fight.
    if (b.flashCd <= 0) { b.flash = 0.05; b.flashCd = 0.2; }
    BB.Audio.hit();
    if (b.hp > 0) return;
    b.hp = 0;
    b.dead = true;
    b.slam = null;
    G.fireballs.length = 0;
    for (let j = G.enemies.length - 1; j >= 0; j--) killEnemy(j, true);
    addCoins(40 + G.level.level * 12);
    const hex = G.level.boss.info.hex;
    BB.Actors.burst(b.x, 5, -b.d, hex, 50, 16, 2.4, 2.2);
    BB.Actors.burst(b.x, 3, -b.d, 0xffe066, 40, 12, 2, 2.2);
    BB.Actors.ring(b.x, b.d, 20, hex, 0.9);
    BB.Actors.ring(b.x, b.d, 11, 0xffffff, 0.55);
    BB.Actors.coins(b.x, b.d - 2, 40);
    BB.Audio.boom();
    BB.World.addShake(1.3);
    BB.UI.flash();
    endRun('win', 2.8, 0.35);
  }

  // Half its health gone: it gets faster, angrier and throws more.
  function enrage() {
    const b = G.boss;
    b.enraged = true;
    b.roar = 1.4;
    b.atkT = Math.min(b.atkT, 1.5);
    BB.Audio.roar();
    BB.Audio.braam();
    BB.World.addShake(0.9);
    BB.World.kick(0.7);
    BB.Actors.ring(b.x, b.d, 16, 0xff3a2a, 0.8);
    BB.Actors.burst(b.x, 4, -b.d, 0xff4a2a, 40, 14, 1.6, 2.4);
    BB.UI.banner('ENRAGED!', 'danger');
    BB.UI.enrage(true);
    hitstop(0.12);
  }

  // Breath attack: the half of the bridge the squad is standing on lights up red for a moment,
  // then the beam rakes it. Soldiers still on that half when it lands are the ones who pay.
  function startSlam() {
    const b = G.boss, s = G.squad;
    b.slam = { side: s.x >= 0 ? 1 : -1, t: 1.25, total: 1.25 };
    b.beamSide = b.slam.side;
    b.roar = 1.25;
    BB.Audio.roar();
    BB.Audio.charge();
    BB.UI.banner(b.slam.side > 0 ? '◀ DODGE!' : 'DODGE! ▶', 'danger');
  }

  // Fireball volley: one is aimed straight at the squad (so standing still is never right), the
  // rest are scattered across the deck. They land one after another, which means the safe place
  // to be keeps changing - often it is the crater of the one that has just gone off.
  function launchBarrage() {
    const b = G.boss, s = G.squad;
    const n = b.enraged ? (G.level.level >= 3 ? 5 : 4) : 3;
    const xs = [BB.clamp(s.x, -4.6, 4.6)];
    for (let guard = 0; xs.length < n && guard < 40; guard++) {
      const x = BB.rand(-4.8, 4.8);
      let free = true;
      for (let k = 0; k < xs.length; k++) if (Math.abs(xs[k] - x) < 2.7) free = false;
      if (free) xs.push(x);
    }
    for (let i = 0; i < xs.length; i++) {
      G.fireballs.push({ x0: b.x, d0: b.d - 2.5, x: xs[i], d: s.d + BB.rand(-1.2, 1.6), t: 0, dur: 1.5 + i * 0.3, r: 2.0 });
    }
    b.roar = 0.9;
    b.holdT = 1.5;
    BB.Audio.fireball();
    BB.UI.banner('INCOMING!', 'danger');
  }

  function updateFireballs(dt) {
    const fs = G.fireballs, s = G.squad;
    if (!fs.length) return;
    const hex = G.level.boss.info.hex;
    for (let i = fs.length - 1; i >= 0; i--) {
      const f = fs[i];
      f.t += dt;
      if (f.t < f.dur) continue;
      fs.splice(i, 1);
      BB.Actors.burst(f.x, 0.4, -f.d, hex, 16, 11, 1.4, 2.4);
      BB.Actors.burst(f.x, 0.4, -f.d, 0xff7a3a, 12, 8, 1.2, 2);
      BB.Actors.ring(f.x, f.d, f.r * 1.7, 0xff6a3a, 0.5);
      BB.Audio.boom();
      BB.World.addShake(0.45);
      if (s.count <= 0) continue;
      const list = s.soldiers, r2 = f.r * f.r;
      let caught = 0;
      for (let k = 0; k < list.length; k++) {
        const dx = list[k].x - f.x, dd = list[k].d - f.d;
        if (dx * dx + dd * dd < r2) caught++;
      }
      if (caught) hurtSquad(Math.max(1, Math.round(s.count * caught / list.length * 0.45)), false);
    }
  }

  function updateBoss(dt) {
    const b = G.boss, s = G.squad, alive = s.count > 0;
    if (b.dead) { b.deadT += dt; return; }
    if (!b.active) return;
    b.roar = Math.max(0, b.roar - dt);
    if (b.flash > 0) b.flash -= dt;
    if (b.flashCd > 0) b.flashCd -= dt;
    if (b.beamT > 0) b.beamT -= dt;
    if (!b.enraged && b.hp <= b.maxHp * 0.5) enrage();
    b.rage = BB.damp(b.rage, b.enraged ? 1 : 0, 3, dt);
    const bd = G.run.freezeT > 0 ? dt * 0.45 : dt;   // frozen stiff: it moves and thinks at half speed

    // It plants its feet to breathe or throw. That matters for balance as much as for looks: dodging
    // pulls the squad off its column (bullets only fly straight ahead), so every attack costs the
    // player damage, and the pause gives that time back before it gets close enough to stomp.
    if (b.holdT > 0) b.holdT -= bd;
    const close = b.d - s.d <= 5.5 + s.hd;   // near enough to stomp
    b.walking = !close && !b.slam && b.holdT <= 0;
    if (b.walking) b.d -= 1.8 * bd;
    b.x += BB.clamp(s.x - b.x, -1.2 * bd, 1.2 * bd);
    if (!alive) { b.slam = null; return; }

    if (b.slam) {
      b.slam.t -= dt;
      if (b.slam.t <= 0) {
        const side = b.slam.side, hex = G.level.boss.info.hex;
        b.slam = null;
        b.beamT = 0.32;   // the beam keeps raking past the squad for a moment after the hit
        b.holdT = 0.5;
        let caught = 0;
        for (let i = 0; i < s.soldiers.length; i++) if (s.soldiers[i].x * side > 0) caught++;
        const frac = s.soldiers.length ? caught / s.soldiers.length : 0;
        for (let k = 0; k < 7; k++) {
          BB.Actors.burst(side * BB.rand(0.8, 5.2), 0.3, -(s.d - 4 + k * 4), k % 2 ? hex : 0xff5a3c, 7, 9, 1.4, 2);
          if (k % 2 === 0) BB.Actors.ring(side * 3, s.d - 4 + k * 4, 4.5, 0xff4a2a, 0.5);
        }
        BB.Audio.boom();
        BB.Audio.beam();
        BB.World.addShake(0.8);
        hitstop(0.06);
        if (frac > 0.05) hurtSquad(Math.max(1, Math.round(s.count * frac * 0.5)), false);
        else BB.UI.floater('DODGED!', s.x, 2.6, -s.d, 'good');
      }
    } else if (b.d - s.d < 44) {
      b.atkT -= bd;
      if (b.atkT <= 0) {
        // The two attacks take turns. Level 1 only gets fireballs once the boss is enraged.
        const volley = (G.level.level >= 2 || b.enraged) && b.atkN % 2 === 1;
        b.atkN++;
        b.atkT = BB.rand(4.2, 5.8) * (b.enraged ? 0.66 : 1);
        if (volley) launchBarrage(); else startSlam();
      }
    }

    b.spawnT -= bd;
    if (b.spawnT <= 0) {
      b.spawnT = 4.2;
      b.roar = Math.max(b.roar, 0.6);
      const lv = G.level.level;
      for (let i = 0; i < G.level.boss.minions; i++) {
        const u = Math.random();
        spawnEnemy(lv >= 2 && u < 0.3 ? 1 : (lv >= 5 && u < 0.4 ? 3 : 0), BB.rand(-5, 5), b.d + BB.rand(0, 4), true, b.tough);
      }
    }
    if (close) {
      b.stompT -= bd;
      if (b.stompT <= 0) {
        b.stompT = 1.1;
        b.roar = 0.4;
        BB.Audio.stomp();
        BB.World.addShake(0.7);
        BB.Actors.burst(s.x, 0.3, -(s.d + s.hd), 0xcfd3da, 16, 8, 1.2);
        BB.Actors.ring(s.x, s.d + s.hd, 7, 0xff6a4a, 0.5);
        hurtSquad(Math.max(2, Math.ceil(s.count * 0.12)), false);
      }
    }
  }

  // ---------- end of run ----------

  function endRun(result, delay, slowmo) {
    if (G.state !== 'playing') return;
    G.state = 'ending';
    G.run.result = result;
    G.run.endT = delay;
    G.timeScale = slowmo;
    G.cine = 0;
    BB.World.setCine(false, 0, 0, false);
    BB.UI.cine(null);
    BB.Audio.setMood('quiet');
    if (result === 'win') BB.Audio.win(); else BB.Audio.lose();
  }

  function lose() { endRun('lose', 1.5, 0.5); }

  function finish() {
    const run = G.run, L = G.level, save = BB.Save.data, win = run.result === 'win';
    const bonus = win ? Math.round((30 + L.level * 15) * G.stats.income) : 0;
    // Stars: one for the win, more for bringing most of the squad you built through the boss fight.
    let stars = 0, gained = 0, starBonus = 0;
    if (win) {
      const kept = G.squad.count / Math.max(1, run.peak);
      stars = 1 + (kept >= STAR2 ? 1 : 0) + (kept >= STAR3 ? 1 : 0);
      gained = Math.max(0, stars - BB.starsOf(save, L.level));
      starBonus = Math.round(gained * 20 * G.stats.income);   // each star pays out once, the first time it is earned
      save.stars[L.level] = Math.max(stars, save.stars[L.level] || 0);
    }
    const total = Math.floor(run.coins) + bonus + starBonus;   // you keep what you earned even on a loss
    save.coins += total;
    save.kills += run.kills;
    if (win) {
      save.level = Math.max(save.level, L.level + 1);
      G.sel = L.level + 1;   // "next level" carries on from the one just played
    }
    BB.Save.save();
    G.timeScale = 1;
    G.state = 'result';
    BB.UI.showResult({
      win: win, level: L.level, kills: run.kills, survivors: G.squad.count, peak: run.peak, combo: run.bestCombo,
      bonus: bonus, total: total, stars: stars, gained: gained, starBonus: starBonus,
      progress: Math.round(BB.clamp(G.squad.d / L.length, 0, 1) * 100)
    });
  }

  // ---------- main step ----------

  function step(dt) {
    const s = G.squad, L = G.level, run = G.run, st = G.stats;
    const playing = G.state === 'playing', alive = s.count > 0;
    run.t += dt;
    if (run.comboT > 0) { run.comboT -= dt; if (run.comboT <= 0) { run.combo = 0; run.tier = 0; } }
    if (run.freezeT > 0) run.freezeT -= dt;
    if (run.shieldHit > 0) run.shieldHit -= dt;

    // 1. run forward, easing to a halt at the boss arena
    const left = L.length - s.d;
    const want = (playing && alive && left > 0.01) ? CFG.SQUAD_SPEED * BB.clamp(left / 6 + 0.15, 0, 1) : 0;
    s.speed = BB.damp(s.speed, want, 6, dt);
    s.d = Math.min(L.length, s.d + s.speed * dt);
    s.moving = s.speed > 1.5;
    if (!G.boss.active && left < 14) wakeBoss();

    // 2. steering. Beside a divider the squad is locked to one lane and squeezes narrower to fit.
    if (dividerAt(s.d - s.hd - 0.5, s.d + s.hd + 3)) { if (!s.side) s.side = s.x >= 0 ? 1 : -1; }
    else s.side = 0;
    s.squeeze = BB.damp(s.squeeze, Math.min(1, (s.side ? 2.55 : 5.5) / s.baseHw), 7, dt);
    s.hw = s.baseHw * s.squeeze;
    s.hd = s.baseHd / s.squeeze;
    let lo = -CFG.HALF_W + 0.3 + s.hw, hi = CFG.HALF_W - 0.3 - s.hw;
    if (s.side > 0) lo = 0.4 + s.hw; else if (s.side < 0) hi = -0.4 - s.hw;
    if (lo > hi) lo = hi = (lo + hi) / 2;
    s.tx = BB.clamp(s.tx, lo, hi);
    const mv = 36 * dt;
    s.x += BB.clamp(s.tx - s.x, -mv, mv);

    // 3. soldiers chase their formation slots and fire
    const k = 1 - Math.exp(-14 * dt);
    let wl = -CFG.HALF_W + 0.35, wh = CFG.HALF_W - 0.35;
    if (s.side > 0) wl = 0.55; else if (s.side < 0) wh = -0.55;
    const rate = st.rate * run.rateMul, vis = s.soldiers.length;
    // Only MAX_VISUAL soldiers are drawn and shoot; each bullet carries the damage of everyone it stands for.
    const dmg = vis ? st.dmg * run.dmgMul * MULTI_DMG[run.multi - 1] * (s.count / vis) : 0;
    let fired = false;
    for (let i = 0; i < vis; i++) {
      const o = s.soldiers[i];
      o.x += (BB.clamp(s.x + o.ox * s.squeeze, wl, wh) - o.x) * k;
      o.d = s.d + o.od / s.squeeze;
      if (o.pop < 1) o.pop = Math.min(1, o.pop + dt * 4.5);
      o.cd -= dt;
      if (playing && o.cd <= 0) {
        o.cd = o.cd < -0.2 ? 1 / rate : o.cd + 1 / rate;
        shoot(o, dmg, run.multi);
        fired = true;
      }
    }
    if (fired) BB.Audio.shoot();
    updateDrones(dt, playing);

    // 4. bring in enemies as they come within the fog line
    while (G.pendingIdx < G.pending.length && G.pending[G.pendingIdx].d - s.d < CFG.SPAWN_DIST) {
      const p = G.pending[G.pendingIdx++];
      spawnEnemy(p.type, p.x, p.d, false, toughness(p.est, 0.6, 0.6, 3));
    }
    // barrels get the same treatment, once, while they are still hidden in the fog
    while (G.scaleIdx < G.crates.length && G.crates[G.scaleIdx].d - s.d < CFG.SPAWN_DIST) {
      const c = G.crates[G.scaleIdx++];
      c.hp = Math.max(20, Math.round(c.hp * toughness(c.est, 0.6, 0.6, 3) / 10) * 10);
    }

    updateBullets(dt);
    updateEnemies(dt);
    updateBooms(dt);

    // 5. gates. A sliding pair shares one moving boundary: as one gate widens the other narrows.
    for (let i = G.gateIdx; i < G.gates.length; i++) {
      const g = G.gates[i];
      if (g.d - s.d > 140) break;
      if (!g.slide) continue;
      const bx = Math.sin(G.time * g.sp + g.ph) * g.slide;
      if (g.left) g.x1 = bx; else g.x0 = bx;
    }
    // ...and they are applied the moment the squad's centre crosses the gate line
    while (G.gateIdx < G.gates.length && G.gates[G.gateIdx].d <= s.d) {
      const g = G.gates[G.gateIdx++];
      if (!g.used && s.count > 0 && s.x >= g.x0 && s.x < g.x1) applyGate(g);
    }

    updateCrates();
    updateAlly(dt);
    updateBoss(dt);
    updateFireballs(dt);
  }

  G.update = function (rawDt) {
    if (G.state !== 'playing' && G.state !== 'ending') return 0;
    let k = G.timeScale;
    if (G.cine > 0) {
      G.cine -= rawDt;
      k *= 0.05;
      if (G.cine <= 0) { G.cine = 0; BB.World.setCine(false, 0, 0, false); BB.UI.cine(null); }
    }
    if (G.stopT > 0) { G.stopT -= rawDt; k *= 0.06; }
    const dt = rawDt * k;
    G.time += dt;
    step(dt);
    if (G.state === 'ending') {
      G.run.endT -= rawDt;
      if (G.run.endT <= 0) finish();
    }
    return dt;
  };
})(window.BB);
