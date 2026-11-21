// Shared namespace + small helpers used by every other file.
window.BB = window.BB || {};

(function (BB) {
  'use strict';

  BB.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  BB.lerp = function (a, b, t) { return a + (b - a) * t; };
  BB.rand = function (a, b) { return a + Math.random() * (b - a); };

  // Frame-rate independent smoothing: moves `cur` towards `target`, faster for a higher `rate`.
  BB.damp = function (cur, target, rate, dt) { return target + (cur - target) * Math.exp(-rate * dt); };

  // Seeded PRNG, so level N is laid out identically every time it is played.
  BB.mulberry32 = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // 1234 -> "1234", 12345 -> "12.3K", 2500000 -> "2.5M"
  BB.fmt = function (n) {
    n = Math.floor(n);
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K';
    return String(n);
  };

  const KEY = 'bridgeBrigade.v1';
  function defaults() {
    // stars: best rating (1-3) per cleared level, keyed by level number
    return { level: 1, coins: 0, kills: 0, sfx: true, music: true, fx: true, stars: {}, up: { squad: 0, dmg: 0, rate: 0, armor: 0, income: 0 } };
  }

  // A level cleared before ratings existed has no entry: clearing it is worth one star by definition.
  BB.starsOf = function (save, lv) { return save.stars[lv] || (lv < save.level ? 1 : 0); };
  BB.totalStars = function (save) {
    let n = save.level - 1;
    for (const k in save.stars) n += Math.max(0, save.stars[k] - 1);
    return n;
  };

  BB.Save = {
    data: defaults(),
    load: function () {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const stored = JSON.parse(raw);
          // Never trust what comes back from storage: copy only known fields and force them to
          // sane numbers, so a corrupt or hand-edited save cannot break the maths or the menu HTML.
          const d = defaults(), su = stored.up || {};
          const num = function (v, min) { v = Math.floor(Number(v)); return isFinite(v) && v >= min ? v : min; };
          d.level = num(stored.level, 1);
          d.coins = num(stored.coins, 0);
          d.kills = num(stored.kills, 0);
          d.sfx = stored.sfx !== false;
          d.music = stored.music !== false;
          d.fx = stored.fx !== false;
          for (const k in d.up) d.up[k] = num(su[k], 0);
          const ss = stored.stars && typeof stored.stars === 'object' ? stored.stars : {};
          for (const k in ss) {
            const lv = num(k, 0), st = Math.min(3, num(ss[k], 0));
            if (lv >= 1 && lv < d.level && st > 0) d.stars[lv] = st;   // only levels that were really cleared
          }
          this.data = d;
        }
      } catch (e) { /* private mode or corrupt save: fall back to defaults */ }
      return this.data;
    },
    save: function () {
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* storage unavailable */ }
    },
    reset: function () {
      const keep = { sfx: this.data.sfx, music: this.data.music, fx: this.data.fx };
      this.data = Object.assign(defaults(), keep);
      this.save();
    }
  };
})(window.BB);
