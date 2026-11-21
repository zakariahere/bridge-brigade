// Tunables, upgrade definitions and the procedural level generator. Pure data: no rendering here.
(function (BB) {
  'use strict';

  const CFG = BB.CFG = {
    HALF_W: 6,          // bridge half-width in world units
    SQUAD_SPEED: 10,    // forward run speed, units per second
    BULLET_SPEED: 55,
    BULLET_RANGE: 45,
    SPAWN_DIST: 110,    // enemies appear this far ahead (hidden by fog)
    AGGRO_DIST: 52,     // ...and start charging once this close
    FUNNEL_DIST: 20,    // ...and only steer sideways towards the squad inside this range
    MAX_VISUAL: 60,     // soldiers actually drawn; head-count above this becomes bullet damage
    BASE_DMG: 10,
    BASE_RATE: 2.0,     // shots per soldier per second
    BASE_SQUAD: 4
  };

  BB.UPGRADES = [
    { id: 'squad',  icon: '🪖', name: 'Recruits',   desc: '+1 starting soldier',       base: 40, growth: 1.42, max: 40 },
    { id: 'dmg',    icon: '💥', name: 'Firepower',  desc: '+12% bullet damage',        base: 50, growth: 1.36, max: 60 },
    { id: 'rate',   icon: '🔫', name: 'Rapid Fire', desc: '+6% fire rate',             base: 60, growth: 1.42, max: 25 },
    { id: 'armor',  icon: '🛡️', name: 'Armor',      desc: '+4% chance to block a hit', base: 80, growth: 1.5,  max: 12 },
    { id: 'income', icon: '💰', name: 'Bounty',     desc: '+10% coins',                base: 70, growth: 1.45, max: 30 }
  ];

  BB.upgradeCost = function (u, lvl) {
    return Math.round(u.base * Math.pow(u.growth, lvl) / 5) * 5;
  };

  // Player stats derived from the saved upgrade levels.
  BB.stats = function (save) {
    const up = save.up;
    return {
      squad: CFG.BASE_SQUAD + up.squad,
      dmg: CFG.BASE_DMG * (1 + 0.12 * up.dmg),
      rate: CFG.BASE_RATE * (1 + 0.06 * up.rate),
      armor: Math.min(0.6, 0.04 * up.armor),
      income: 1 + 0.1 * up.income
    };
  };

  // lat = sideways chase speed, dmg = soldiers killed on contact, anim = leg-swing speed while charging
  // boom = blast radius when it dies: a bloater takes its neighbours with it, and they can chain
  BB.ENEMY = [
    { name: 'walker',  hp: 20,  speed: 3.8, lat: 3.0, scale: 1.0,  dmg: 1, coin: 1, anim: 9,  color: 0x5f8a45, skin: 0xa9c77a },
    { name: 'runner',  hp: 10,  speed: 8.5, lat: 5.0, scale: 0.85, dmg: 1, coin: 1, anim: 17, color: 0x8a5fc0, skin: 0xdcc6ee },
    { name: 'brute',   hp: 150, speed: 3.0, lat: 2.2, scale: 1.9,  dmg: 3, coin: 6, anim: 6,  color: 0xa5382c, skin: 0xd09a78 },
    { name: 'bloater', hp: 34,  speed: 3.3, lat: 2.4, scale: 1.3,  dmg: 2, coin: 1, anim: 7,  color: 0xc9541a, skin: 0xffc27a, boom: 3.3 }
  ];

  // One biome every two levels, each with its own look (world.js THEMES, same order) and its own kaiju.
  // glow / eye are HDR colours: above 1.0 on purpose so they bloom.
  BB.BIOMES = [
    { name: 'SUNNY STRAIT',      boss: { name: 'BRINEJAW',   title: 'the Harbor Eater',   body: 0x3c4a44, belly: 0x93a184, spike: 0x7fe9ff, glow: [0.1, 1.15, 1.6],  eye: [3.4, 0.25, 0.2], hex: 0x7fe9ff } },
    { name: 'SUNSET SOUND',      boss: { name: 'DUSKMAW',    title: 'Devourer of Evenings', body: 0x5a3442, belly: 0xd09a72, spike: 0xffa64a, glow: [1.7, 0.7, 0.1],   eye: [3.2, 1.6, 0.2],  hex: 0xffa64a } },
    { name: 'FROSTBITE BAY',     boss: { name: 'RIMEFANG',   title: 'the Glacier King',   body: 0x577a92, belly: 0xdcefff, spike: 0xd8fbff, glow: [0.6, 1.4, 1.8],   eye: [0.6, 2.6, 3.4],  hex: 0xbff6ff } },
    { name: 'MIDNIGHT CROSSING', boss: { name: 'UMBRAX',     title: 'the Midnight Tide',  body: 0x2c2a4c, belly: 0x736eb0, spike: 0xc77dff, glow: [1.1, 0.3, 1.8],   eye: [3.0, 0.4, 3.2],  hex: 0xc77dff } },
    { name: 'STORMFRONT',        boss: { name: 'VOLTHIDE',   title: 'the Stormbringer',   body: 0x34433f, belly: 0x90a49a, spike: 0xfff07a, glow: [1.7, 1.5, 0.25],  eye: [3.2, 3.0, 0.4],  hex: 0xfff07a } },
    { name: 'CINDER SEA',        boss: { name: 'CINDERKING', title: 'Lord of Ash',        body: 0x2c1b1d, belly: 0x8a4226, spike: 0xff5a1e, glow: [1.9, 0.45, 0.05], eye: [3.6, 1.4, 0.1],  hex: 0xff6a2a } }
  ];
  BB.biomeOf = function (level) { return Math.floor((level - 1) / 2) % BB.BIOMES.length; };

  // The first two levels are hand-ordered so every mechanic gets introduced; later ones are random.
  const SCRIPT = {
    1: ['gate', 'corridor', 'horde', 'crates', 'kaiju', 'gate'],
    2: ['gate', 'horde', 'shoot', 'corridor', 'crates', 'horde', 'gate']
  };

  BB.makeLevel = function (level) {
    const rng = BB.mulberry32(level * 7919 + 1013);
    const R = function (a, b) { return a + rng() * (b - a); };
    const RI = function (a, b) { return Math.floor(R(a, b + 1)); };
    const pick = function (arr) { return arr[Math.floor(rng() * arr.length)]; };
    // A second, independent stream for decisions added after launch (sliding gates...). Drawing
    // them from `rng` would shift every later roll and silently reshuffle all existing levels.
    const rng2 = BB.mulberry32(level * 104729 + 71);

    const hpScale = 1 + (level - 1) * 0.18;                // enemy toughness
    const diff = Math.min(1.4, 0.8 + level * 0.03);        // horde size factor
    const dps1 = CFG.BASE_DMG * CFG.BASE_RATE * hpScale;   // damage/sec we expect one soldier to deal here
    const runnerShare = level >= 2 ? Math.min(0.3, 0.06 + level * 0.02) : 0;
    const bloatShare = level >= 3 ? Math.min(0.13, 0.04 + level * 0.01) : 0;

    const L = {
      level: level,
      hpScale: hpScale,
      theme: BB.biomeOf(level),
      gates: [], crates: [], enemies: [], dividers: []
    };

    // `est` tracks how big a competent player's squad should be at the current point.
    // Hordes, barrel HP and the boss are all sized relative to it.
    let est = CFG.BASE_SQUAD + Math.min(level - 1, 16) * 0.6;
    let d = 46;

    // sl = { amp, sp, ph }: the line between a pair of gates slides from side to side, so the
    // good gate keeps growing and shrinking and you have to time your run at it.
    function gate(gd, x0, x1, s, sl) {
      L.gates.push({
        d: gd, x0: x0, x1: x1, op: s.op, value: s.value,
        shootable: !!s.shootable, per: s.per || 0, cap: s.cap || 0, slim: !!s.slim,
        left: x0 <= -CFG.HALF_W + 0.01, slide: sl ? sl.amp : 0, sp: sl ? sl.sp : 0, ph: sl ? sl.ph : 0
      });
    }

    function crate(cd, x, hp, reward) {
      const c = { d: cd, x: x, hp: Math.max(20, Math.round(hp / 10) * 10), reward: reward, amount: 0, r: reward === 'kaiju' ? 1.35 : 0.95, est: est };
      if (reward === 'troops') c.amount = RI(3, 5) + Math.round(est * 0.3);
      if (reward === 'coins') c.amount = 20 + level * 8;
      L.crates.push(c);
    }

    // Fill a rectangle with enemies, row by row. Returns the depth it used.
    function horde(d0, count, x0, x1, runners) {
      const perRow = Math.max(1, Math.floor((x1 - x0) / 0.95));
      let placed = 0, row = 0;
      while (placed < count) {
        const n = Math.min(perRow, count - placed);
        for (let i = 0; i < n; i++) {
          const ed = d0 + row * 1.05 + R(-0.25, 0.25), ex = x0 + (x1 - x0) * (i + 0.5) / n + R(-0.22, 0.22);
          const u = rng();   // one roll decides the type, so adding a type never changes the layout
          L.enemies.push({ d: ed, x: ex, type: u < runners ? 1 : (u < runners + bloatShare ? 3 : 0), est: est });
        }
        placed += n;
        row++;
      }
      return row * 1.05;
    }

    function brutes(d0, n) {
      for (let i = 0; i < n; i++) L.enemies.push({ d: d0 + R(0, 2), x: -4 + 8 * (i + 0.5) / n, type: 2, est: est });
    }

    // --- segment builders: each places content at `d` and advances it ---

    function segGate(i) {
      const good = function () { return RI(2, 3) + Math.round(est * R(0.25, 0.5)); };
      // The opening gate never has a losing side: a slip in the first five seconds should not end a run.
      const k = i === 0 ? rng() * 0.65 : rng();
      let a, b;
      if (k < 0.35)      { a = { op: 'add', value: good() }; b = { op: 'add', value: Math.max(1, Math.round(good() * 0.5)) }; }
      else if (k < 0.65) { a = { op: 'mul', value: 2 };      b = { op: 'add', value: good() }; }
      else if (k < 0.85) { a = { op: 'add', value: good() }; b = { op: 'add', value: -RI(2, 2 + Math.round(est * 0.3)) }; }
      else               { a = { op: 'mul', value: 2 };      b = { op: 'mul', value: 0.5 }; }
      if (rng() < 0.5) { const t = a; a = b; b = t; }
      const sl = (level >= 4 && i > 0 && rng2() < 0.34) ? { amp: 1.9 + rng2() * 0.8, sp: 1.5 + rng2() * 0.7, ph: rng2() * 6.283 } : null;
      gate(d, -CFG.HALF_W, 0, a, sl);
      gate(d, 0, CFG.HALF_W, b, sl);
      const ap = function (v) { return v.op === 'mul' ? est * v.value : est + v.value; };
      est = Math.max(1, Math.max(ap(a), ap(b)) * 0.85 + est * 0.15);
      d += 30;
    }

    // The signature choice: a walled lane of "+1" gates, or the other lane with loot and a fight.
    function segCorridor() {
      const side = rng() < 0.5 ? -1 : 1;
      const n = RI(8, 14);
      const len = 20 + n * 3;
      L.dividers.push({ d0: d, d1: d + len });
      for (let i = 0; i < n; i++) {
        gate(d + 10 + i * 3, side > 0 ? 0.3 : -CFG.HALF_W, side > 0 ? CFG.HALF_W : -0.3, { op: 'add', value: 1, slim: true });
      }
      const lx0 = side > 0 ? -5.4 : 0.7, lx1 = side > 0 ? -0.7 : 5.4, cx = (lx0 + lx1) / 2;
      crate(d + 16, cx, est * dps1 * R(1.3, 2.0), pick(level >= 4 ? ['rate', 'dmg', 'multi', 'drone', 'shield'] : ['rate', 'dmg', 'multi', 'rate', 'dmg']));
      horde(d + 22, Math.round(est * R(0.8, 1.2) * diff), lx0, lx1, runnerShare);
      if (rng() < 0.5) crate(d + len - 8, cx + R(-1, 1), est * dps1 * R(1.0, 1.6), pick(['coins', 'troops']));
      est += n * 0.75;
      d += len + 14;
    }

    function segHorde(i) {
      // the very first fight of a level is a warm-up
      const count = Math.min(150, Math.round(est * R(0.8, 1.3) * diff * (i <= 1 ? 0.7 : 1)));
      let x0 = -5.3, x1 = 5.3;
      if (rng() < 0.4) { if (rng() < 0.5) x1 = -0.3; else x0 = 0.3; }
      const depth = horde(d + 6, count, x0, x1, runnerShare);
      if (level >= 4 && i > 1 && rng() < 0.6) brutes(d + 10 + depth, 1 + Math.floor(level / 6) + (rng() < 0.3 ? 1 : 0));
      est *= 0.92;
      d += 32 + depth;
    }

    // Barrels are optional loot, never a wall: there is always a lane you can run through untouched.
    function segCrates() {
      const xs = pick([[-3.2, 3.2], [-3.2, 3.2], [0], [-3.6], [3.6]]);
      // the newer power-ups join the pool from level 3, once the basics have been seen
      const pool = level >= 3
        ? ['troops', 'rate', 'dmg', 'coins', 'nuke', 'multi', 'troops', 'freeze', 'shield', 'drone', 'freeze']
        : ['troops', 'rate', 'dmg', 'coins', 'nuke', 'multi', 'troops', 'coins'];
      for (let i = 0; i < xs.length; i++) crate(d + 6, xs[i], est * dps1 * R(0.6, 1.5), pick(pool));
      horde(d + 16, Math.round(est * R(0.6, 1.0) * diff), -5.3, 5.3, runnerShare);
      d += 40;
    }

    // One gate starts negative but every bullet that hits it pushes its number up.
    function segShoot() {
      const start = -(RI(3, 6) + Math.round(est * 0.15));
      const gain = -start + 4 + est * 0.5;
      const risky = { op: 'add', value: start, shootable: true, per: Math.max(8, est * dps1 * 2.6 / gain), cap: Math.round(est * 0.7) + 6 };
      const safe = { op: 'add', value: RI(1, 3) };
      if (rng() < 0.5) { gate(d, -CFG.HALF_W, 0, risky); gate(d, 0, CFG.HALF_W, safe); }
      else             { gate(d, -CFG.HALF_W, 0, safe);  gate(d, 0, CFG.HALF_W, risky); }
      est += 3 + est * 0.3;
      d += 34;
    }

    // A caged kaiju followed by a horde far too big to shoot through on your own.
    function segKaiju() {
      // The horde stands well back, so the cage is a clear, unobstructed target for a few seconds.
      crate(d + 4, R(-2, 2), est * dps1 * R(0.7, 1.0), 'kaiju');
      const count = Math.min(220, Math.round(est * R(2.6, 3.8) * diff) + 20);
      const depth = horde(d + 42, count, -5.3, 5.3, runnerShare * 0.5);
      est *= 0.95;
      d += 58 + depth;
    }

    const SEG = { gate: segGate, corridor: segCorridor, horde: segHorde, crates: segCrates, shoot: segShoot, kaiju: segKaiju };

    let order = SCRIPT[level];
    if (!order) {
      order = ['gate'];
      const n = Math.min(14, 5 + Math.floor(level * 0.8));
      let last = 'gate', kaijuUsed = false;
      for (let i = 1; i < n - 1; i++) {
        const w = {
          gate: last === 'gate' ? 1 : 3,
          horde: last === 'horde' ? 0.5 : 3,
          crates: 2,
          corridor: last === 'corridor' ? 0 : 2,
          shoot: 1.5,
          kaiju: (!kaijuUsed && i >= 2) ? 1.3 : 0
        };
        let total = 0, k;
        for (k in w) total += w[k];
        let r = rng() * total, chosen = 'horde';
        for (k in w) { r -= w[k]; if (r <= 0) { chosen = k; break; } }
        if (chosen === 'kaiju') kaijuUsed = true;
        order.push(chosen);
        last = chosen;
      }
      order.push('gate');
    }
    L.plan = [];   // [segment name, start distance] - handy when balancing or debugging a level
    for (let i = 0; i < order.length; i++) { L.plan.push(order[i] + '@' + Math.round(d)); SEG[order[i]](i); }

    L.length = d + 14;   // the squad halts here and the boss comes to it
    L.boss = {
      d: L.length + 42,
      hp: Math.round((est * dps1 * 9 + 300 * hpScale) / 10) * 10,
      minions: 4 + Math.min(10, level),
      est: est,
      info: BB.BIOMES[L.theme].boss
    };

    const byD = function (a, b) { return a.d - b.d; };
    L.gates.sort(byD);
    L.crates.sort(byD);
    L.enemies.sort(byD);
    return L;
  };
})(window.BB);
