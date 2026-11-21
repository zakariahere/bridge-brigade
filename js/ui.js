// DOM layer: menus, HUD, floating combat text. The 3D canvas sits underneath all of it.
(function (BB) {
  'use strict';

  const UI = BB.UI = {};
  const $ = function (id) { return document.getElementById(id); };
  const pos = { x: 0, y: 0, visible: true };
  const cache = {};
  const el = {};
  const TIER_NAMES = ['COMBO', 'NICE!', 'FIERCE!', 'SAVAGE!', 'UNSTOPPABLE!'];
  let pulse = 0, hintT = 0, resetArmed = 0, comboPulse = 0, countId = 0;
  const timers = [];

  // Touching the DOM is the slow part, so only write when the value actually changed.
  function text(node, key, value) {
    if (cache[key] !== value) { cache[key] = value; node.textContent = value; }
  }
  function show(node, on) { node.classList.toggle('hidden', !on); }
  function hex(n) { return '#' + ('000000' + n.toString(16)).slice(-6); }
  function starRow(n) { return '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n); }
  function later(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function cancelTimers() { while (timers.length) clearTimeout(timers.pop()); cancelAnimationFrame(countId); }

  UI.init = function () {
    ['hud', 'menu', 'pause', 'result', 'floaters', 'flash', 'banner', 'hint', 'upgrades', 'frost', 'cine', 'combo'].forEach(function (id) { el[id] = $(id); });
    el.level = $('hud-level');
    el.progress = $('hud-progress');
    el.coins = $('hud-coins');
    el.buffs = $('hud-buffs');
    el.bossBar = $('boss-bar');
    el.bossFill = $('boss-fill');
    el.bossName = $('boss-name');
    el.badge = $('squad-badge');
    el.menuCoins = $('menu-coins');
    el.menuStars = $('menu-stars');
    el.playLevel = $('play-level');
    el.biome = $('lvl-biome');
    el.lvlStars = $('lvl-stars');
    el.prev = $('btn-prev');
    el.fwd = $('btn-fwd');
    el.sfx = $('btn-sfx');
    el.music = $('btn-music');
    el.reset = $('btn-reset');
    el.next = $('btn-next');
    el.comboN = $('combo-n');
    el.comboL = $('combo-l');
    el.comboBar = $('combo-bar');
    el.cineName = $('cine-name');
    el.cineTitle = $('cine-title');
    el.resStars = $('res-stars');
    el.resCoins = $('res-coins');

    const click = function (id, fn) {
      $(id).addEventListener('click', function () { BB.Audio.init(); BB.Audio.click(); fn(); });
    };
    click('btn-play', function () { BB.Game.start(); });
    click('btn-prev', function () { BB.Game.select(-1); });
    click('btn-fwd', function () { BB.Game.select(1); });
    click('btn-pause', function () { BB.Game.pause(); });
    click('btn-resume', function () { BB.Game.resume(); });
    click('btn-restart', function () { BB.Game.start(); });
    click('btn-quit', function () { BB.Game.toMenu(); });
    click('btn-next', function () { BB.Game.start(); });
    click('btn-menu', function () { BB.Game.toMenu(); });
    click('btn-sfx', function () {
      const s = BB.Save.data;
      s.sfx = !s.sfx;
      BB.Audio.setSfx(s.sfx);
      BB.Save.save();
      UI.refreshMenu();
    });
    click('btn-music', function () {
      const s = BB.Save.data;
      s.music = !s.music;
      BB.Audio.setMusic(s.music);
      BB.Save.save();
      UI.refreshMenu();
    });
    el.fx = $('btn-fx');
    el.hurt = $('hurt');
    if (!BB.Post.supported) el.fx.classList.add('hidden');   // nothing to toggle on a GPU that cannot do it
    click('btn-fx', function () {
      const s = BB.Save.data;
      s.fx = !s.fx;
      BB.Post.enabled = s.fx;
      BB.Save.save();
      UI.refreshMenu();
    });
    // Reset wipes the save, so it needs a second click within three seconds.
    click('btn-reset', function () {
      const now = performance.now();
      // resetArmed is 0 until the first click; without that check, a click in the first three
      // seconds after page load (when `now` itself is under 3000) would count as the confirmation.
      if (resetArmed > 0 && now - resetArmed < 3000) {
        resetArmed = 0;
        BB.Save.reset();
        BB.Game.toMenu();
        el.reset.textContent = 'reset progress';
      } else {
        resetArmed = now;
        el.reset.textContent = 'click again to wipe your save';
        setTimeout(function () { if (resetArmed) { resetArmed = 0; el.reset.textContent = 'reset progress'; } }, 3000);
      }
    });

    el.upgrades.addEventListener('click', function (e) {
      const btn = e.target.closest('.buy');
      if (!btn || btn.disabled) return;
      BB.Audio.init();
      const save = BB.Save.data, id = btn.dataset.up;
      const u = BB.UPGRADES.filter(function (x) { return x.id === id; })[0];
      const lvl = save.up[id], cost = BB.upgradeCost(u, lvl);
      if (lvl >= u.max || save.coins < cost) return;
      save.coins -= cost;
      save.up[id] = lvl + 1;
      BB.Save.save();
      BB.Audio.buy();
      BB.Game.refreshStats();
      UI.refreshMenu();
    });
  };

  UI.refreshMenu = function () {
    const save = BB.Save.data, sel = BB.Game.sel;
    text(el.menuCoins, 'menuCoins', BB.fmt(save.coins));
    text(el.menuStars, 'menuStars', String(BB.totalStars(save)));
    text(el.playLevel, 'playLevel', 'LEVEL ' + sel);
    text(el.biome, 'biome', BB.BIOMES[BB.biomeOf(sel)].name);
    text(el.lvlStars, 'lvlStars', sel < save.level ? starRow(BB.starsOf(save, sel)) : 'NEW');
    el.lvlStars.classList.toggle('fresh', sel >= save.level);
    el.prev.disabled = sel <= 1;
    el.fwd.disabled = sel >= save.level;
    el.sfx.classList.toggle('off', !save.sfx);
    el.music.classList.toggle('off', !save.music);
    el.fx.classList.toggle('off', !save.fx);
    el.upgrades.innerHTML = BB.UPGRADES.map(function (u) {
      const lvl = save.up[u.id], maxed = lvl >= u.max, cost = BB.upgradeCost(u, lvl);
      return '<div class="upg">' +
        '<span class="ico">' + u.icon + '</span>' +
        '<span class="name">' + u.name + '<small>Lv ' + lvl + '</small></span>' +
        '<span class="desc">' + u.desc + '</span>' +
        '<button class="buy" data-up="' + u.id + '"' + (maxed || save.coins < cost ? ' disabled' : '') + '>' +
        (maxed ? 'MAX' : '<span class="coin-ico"></span>' + BB.fmt(cost)) + '</button></div>';
    }).join('');
  };

  // Everything that only makes sense mid-run goes back to its resting state.
  function clearOverlays() {
    cancelTimers();
    el.floaters.replaceChildren();
    el.banner.className = '';
    el.frost.classList.remove('on');
    el.combo.className = '';
    el.bossBar.classList.remove('rage');
    UI.cine(null);
    cache.frz = false;
    cache.combo = -1;
    cache.tier = -1;
  }

  UI.showMenu = function () {
    show(el.hud, false); show(el.pause, false); show(el.result, false); show(el.menu, true);
    clearOverlays();
    UI.refreshMenu();
  };

  UI.showHUD = function (G) {
    show(el.menu, false); show(el.pause, false); show(el.result, false); show(el.hud, true);
    show(el.bossBar, false);
    clearOverlays();
    text(el.level, 'level', 'LEVEL ' + G.level.level);
    cache.boss = -1;
    UI.setBuffs(G);
    if (G.level.level <= 2) { hintT = 5; el.hint.classList.add('show'); }
    else { hintT = 0; el.hint.classList.remove('show'); }
  };

  UI.showPause = function (on) { show(el.pause, on); };
  UI.showBoss = function (on, name) {
    show(el.bossBar, on);
    if (name) el.bossName.textContent = '☠ ' + name + ' ☠';
  };
  UI.enrage = function (on) { el.bossBar.classList.toggle('rage', on); };

  // Letterbox bars slide in and the boss gets its name card; pass null to put the HUD back.
  UI.cine = function (info) {
    el.cine.classList.toggle('on', !!info);
    el.hud.classList.toggle('cine', !!info);
    if (!info) return;
    el.cineName.textContent = info.name;
    el.cineTitle.textContent = info.title;
    el.cine.style.setProperty('--boss', hex(info.hex));
  };

  UI.showResult = function (r) {
    show(el.hud, false);
    show(el.result, true);
    clearOverlays();
    el.result.classList.toggle('win', r.win);
    const title = $('res-title');
    title.textContent = r.win ? 'VICTORY!' : 'OVERRUN!';
    title.classList.toggle('lose', !r.win);
    $('res-sub').textContent = r.win
      ? 'Level ' + r.level + ' cleared · clear bonus +' + BB.fmt(r.bonus) + (r.starBonus ? ' · new stars +' + BB.fmt(r.starBonus) : '')
      : 'Level ' + r.level + ' · you made it ' + r.progress + '% of the way';
    $('res-kills').textContent = BB.fmt(r.kills);
    $('res-combo').textContent = '×' + BB.fmt(r.combo);
    $('res-surv').textContent = BB.fmt(r.survivors);
    $('res-peak').textContent = BB.fmt(r.peak);
    el.next.textContent = r.win ? 'NEXT LEVEL' : 'TRY AGAIN';

    // the stars pop in one after another, each with its own chime
    show(el.resStars, r.win);
    const stars = el.resStars.children;
    for (let i = 0; i < 3; i++) {
      stars[i].classList.remove('on');
      if (i < r.stars) later(350 + i * 380, (function (n) { return function () { stars[n].classList.add('on'); BB.Audio.star(n); }; })(i));
    }

    // ...and the coins count up instead of just appearing
    const t0 = performance.now();
    (function tick(now) {
      const k = Math.min(1, (now - t0) / 900), e = 1 - (1 - k) * (1 - k);
      el.resCoins.textContent = '+' + BB.fmt(r.total * e);
      if (k < 1) countId = requestAnimationFrame(tick);
    })(t0);
  };

  UI.setBuffs = function (G) {
    const run = G.run, out = [];
    if (run.rateMul > 1.001) out.push('🔫 ×' + run.rateMul.toFixed(2));
    if (run.dmgMul > 1.001) out.push('💥 ×' + run.dmgMul.toFixed(2));
    if (run.multi > 1) out.push('✨ ×' + run.multi);
    if (G.drones.length) out.push('🚁 ×' + G.drones.length);
    if (run.shield > 0) out.push('<i class="cool">🛡️ ' + BB.fmt(run.shield) + '</i>');
    if (run.freezeT > 0) out.push('<i class="cool">❄️ FROZEN</i>');
    el.buffs.innerHTML = out.map(function (t) { return '<span class="buff">' + t + '</span>'; }).join('');
  };

  // A new combo tier: the meter changes colour and shouts about it.
  UI.comboTier = function () { comboPulse = 1.6; };

  // A number that pops out of a point in the 3D world and drifts up the screen.
  UI.floater = function (msg, x, y, z, cls) {
    if (el.floaters.childElementCount > 40) return;
    BB.World.project(x, y, z, pos);
    const n = document.createElement('div');
    n.className = 'floater ' + (cls || '');
    n.textContent = msg;
    n.style.left = pos.x.toFixed(0) + 'px';
    n.style.top = pos.y.toFixed(0) + 'px';
    el.floaters.appendChild(n);
    setTimeout(function () { n.remove(); }, 900);
  };

  // Restarting a CSS animation needs the class removed, a forced reflow, then the class re-added.
  UI.banner = function (msg, cls) {
    el.banner.textContent = msg;
    el.banner.className = cls || '';
    void el.banner.offsetWidth;
    el.banner.classList.add('show');
  };

  UI.flash = function () {
    el.flash.classList.remove('go');
    void el.flash.offsetWidth;
    el.flash.classList.add('go');
  };

  UI.pulse = function () { pulse = 1; };

  // Red flash around the edges of the screen whenever the squad loses someone.
  UI.hurt = function () {
    el.hurt.classList.remove('go');
    void el.hurt.offsetWidth;
    el.hurt.classList.add('go');
  };

  UI.update = function (G, dt) {
    if (G.state === 'menu' || G.state === 'boot' || G.state === 'result') return;
    const s = G.squad, b = G.boss, run = G.run;

    // the head-count badge is a DOM element pinned to a point above the squad
    BB.World.project(s.x, 2.9, -s.d, pos);
    pulse = Math.max(0, pulse - dt * 4);
    el.badge.style.transform = 'translate(' + pos.x.toFixed(1) + 'px,' + pos.y.toFixed(1) + 'px) translate(-50%,-100%) scale(' + (1 + pulse * 0.3).toFixed(3) + ')';
    text(el.badge, 'badge', BB.fmt(s.count));
    const vis = s.count > 0 && G.cine <= 0 ? '1' : '0';
    if (cache.badgeVis !== vis) { cache.badgeVis = vis; el.badge.style.opacity = vis; }

    const prog = Math.round(BB.clamp(s.d / G.level.length, 0, 1) * 1000) / 10;
    if (cache.prog !== prog) { cache.prog = prog; el.progress.style.width = prog + '%'; }
    text(el.coins, 'coins', BB.fmt(run.coins));

    // combo meter: appears after a few kills in a row, drains while nothing is dying
    const on = run.combo >= 5;
    if (cache.comboOn !== on || cache.tier !== run.tier) {
      cache.comboOn = on;
      cache.tier = run.tier;
      el.combo.className = (on ? 'on ' : '') + 't' + run.tier;
      el.comboL.textContent = TIER_NAMES[run.tier] + (run.tier ? '  +' + run.tier * 10 + '% COINS' : '');
    }
    if (on) {
      if (cache.combo !== run.combo) {
        if (run.combo > cache.combo) comboPulse = Math.max(comboPulse, 0.5);
        cache.combo = run.combo;
        el.comboN.textContent = '×' + run.combo;
      }
      el.comboBar.style.transform = 'scaleX(' + BB.clamp(run.comboT / 2.6, 0, 1).toFixed(3) + ')';
    }
    if (comboPulse > 0 || cache.comboSc !== 1) {
      comboPulse = Math.max(0, comboPulse - dt * 5);
      const sc = 1 + Math.min(1, comboPulse) * 0.32;
      cache.comboSc = comboPulse > 0 ? sc : 1;
      el.comboN.style.transform = 'scale(' + sc.toFixed(3) + ')';
    }

    const frz = run.freezeT > 0;
    if (cache.frz !== frz) { cache.frz = frz; el.frost.classList.toggle('on', frz); UI.setBuffs(G); }

    if (b.active) {
      const f = Math.round(BB.clamp(b.hp / b.maxHp, 0, 1) * 1000) / 10;
      if (cache.boss !== f) { cache.boss = f; el.bossFill.style.width = f + '%'; }
    }
    if (hintT > 0) { hintT -= dt; if (hintT <= 0) el.hint.classList.remove('show'); }
  };
})(window.BB);
