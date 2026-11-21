// All sound is synthesised with WebAudio: no audio files to ship or load.
(function (BB) {
  'use strict';

  let ctx = null, sfxBus = null, musicBus = null, noiseBuf = null;
  let sfxOn = true, musicOn = true;
  let step = 0, nextTime = 0, combo = 0, comboAt = 0;
  const last = {};

  // Browsers only allow audio after a user gesture, so this is called from the first click/tap.
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = sfxOn ? 1 : 0;
    sfxBus.connect(comp);
    musicBus = ctx.createGain();
    musicBus.gain.value = musicOn ? 1 : 0;
    musicBus.connect(comp);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;

    nextTime = ctx.currentTime + 0.1;
    setInterval(scheduleMusic, 90);
  }

  // Rate-limit a sound so hundreds of hits per second don't turn into a wall of noise.
  function ok(name, ms) {
    if (!ctx || !sfxOn) return false;
    const t = performance.now();
    if (t - (last[name] || 0) < ms) return false;
    last[name] = t;
    return true;
  }

  function tone(type, f0, f1, dur, vol, delay, bus, at) {
    const t = (at || ctx.currentTime) + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus || sfxBus);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  function noise(dur, vol, freq, q, delay, type, bus, at) {
    const t = (at || ctx.currentTime) + (delay || 0);
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type || 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(bus || sfxBus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.03);
  }

  // --- music: a 16-step sequencer, scheduled slightly ahead of the clock ---
  // The same sequencer plays three moods: a gentle menu loop, the running theme (Am - F - C - G),
  // and a faster, heavier boss theme (Am - Am - F - E) with a four-on-the-floor kick.
  const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  const BOSS_CHORDS = [[57, 60, 64], [57, 60, 64], [53, 57, 60], [52, 56, 59]];
  const BPM = { menu: 98, run: 112, boss: 140 };
  let mood = 'menu';
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function scheduleMusic() {
    if (!ctx || ctx.state !== 'running') return;
    const sixteenth = 60 / (BPM[mood] || 112) / 4;
    if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05;
    while (nextTime < ctx.currentTime + 0.3) {
      if (musicOn && mood !== 'quiet') {
        const s = step % 16, bar = Math.floor(step / 16) % 4, t = nextTime;
        if (mood === 'boss') {
          const ch = BOSS_CHORDS[bar];
          if (s % 4 === 0) { tone('sine', 130, 38, 0.16, 0.34, 0, musicBus, t); noise(0.03, 0.05, 3000, 1, 0, 'highpass', musicBus, t); }   // kick
          if (s % 8 === 4) noise(0.12, 0.07, 1700, 0.8, 0, 'bandpass', musicBus, t);                                                       // snare
          if (s % 2 === 1) noise(0.03, 0.022, 8000, 1.4, 0, 'highpass', musicBus, t);                                                      // off-beat hat
          if (s % 2 === 0) tone('sawtooth', mtof(ch[0] - 24 + (s % 8 === 6 ? 12 : 0)), 0, sixteenth * 1.7, 0.05, 0, musicBus, t);          // driving bass
          tone('square', mtof(ch[s % 3] + (s % 4 === 3 ? 12 : 0)), 0, sixteenth * 0.9, 0.012, 0, musicBus, t);                             // arpeggio
          if (s === 0) tone('sawtooth', mtof(ch[2] + 12), 0, sixteenth * 7, 0.016, 0, musicBus, t);                                        // a held note on top
        } else {
          const ch = CHORDS[bar], soft = mood === 'menu';
          if (s % 4 === 0) tone('triangle', mtof(ch[0] - 24), 0, sixteenth * 3.4, 0.11, 0, musicBus, t);
          if (s % 2 === 0) tone('square', mtof(ch[(s / 2) % 3] + (s % 8 === 6 ? 12 : 0)), 0, sixteenth * 1.5, soft ? 0.01 : 0.014, 0, musicBus, t);
          if (!soft && s % 4 === 2) noise(0.04, 0.02, 7000, 1.2, 0, 'highpass', musicBus, t);
          if (!soft && s % 8 === 4) noise(0.09, 0.035, 1800, 0.8, 0, 'bandpass', musicBus, t);
          if (soft && s === 0) tone('sine', mtof(ch[2] + 12), 0, sixteenth * 10, 0.022, 0, musicBus, t);   // a slow bell over the menu
        }
      }
      nextTime += sixteenth;
      step++;
    }
  }

  BB.Audio = {
    init: init,
    setSfx: function (on) { sfxOn = on; if (sfxBus) sfxBus.gain.value = on ? 1 : 0; },
    setMusic: function (on) { musicOn = on; if (musicBus) musicBus.gain.value = on ? 1 : 0; },
    // menu | run | boss | quiet (nothing: the win/lose jingle gets the stage to itself)
    setMood: function (m) { mood = m; },

    pop: function () { if (ok('pop', 70)) { noise(0.22, 0.26, 420, 0.7, 0, 'lowpass'); tone('sine', 190, 50, 0.22, 0.26); tone('square', 520, 140, 0.08, 0.05); } },
    shield: function () { if (ok('shield', 200)) { tone('sine', 300, 1200, 0.35, 0.1); [392, 587, 784].forEach(function (f, i) { tone('triangle', f, 0, 0.18, 0.07, 0.1 + i * 0.08); }); } },
    shieldHit: function () { if (ok('shHit', 70)) { tone('sine', 1250, 620, 0.12, 0.09); noise(0.05, 0.05, 5200, 2); } },
    shieldBreak: function () { if (ok('shBrk', 200)) { tone('sawtooth', 900, 120, 0.35, 0.1); noise(0.3, 0.12, 3000, 0.8, 0, 'highpass'); } },
    freeze: function () { if (ok('freeze', 300)) { tone('sine', 2400, 600, 0.6, 0.08); tone('triangle', 1800, 300, 0.7, 0.06, 0.05); noise(0.7, 0.1, 6000, 0.9, 0, 'highpass'); } },
    drone: function () { if (ok('drone', 200)) { tone('sawtooth', 140, 280, 0.35, 0.07); tone('square', 880, 0, 0.06, 0.05, 0.3); tone('square', 1175, 0, 0.1, 0.05, 0.38); } },
    // each combo tier answers with a brighter little arpeggio
    combo: function (tier) {
      if (!ok('combo', 120)) return;
      const base = 587 * Math.pow(2, tier * 2 / 12);
      [0, 4, 7, 12].forEach(function (semi, i) { tone('square', base * Math.pow(2, semi / 12), 0, 0.1, 0.055, i * 0.05); });
    },
    // the low brass blast that announces the boss
    braam: function () { if (ok('braam', 600)) { tone('sawtooth', 55, 49, 1.6, 0.22); tone('sawtooth', 82.5, 73, 1.6, 0.14); tone('square', 110, 98, 1.3, 0.05); noise(1.4, 0.12, 180, 0.5, 0, 'lowpass'); } },
    charge: function () { if (ok('charge', 300)) { tone('sawtooth', 120, 900, 1.2, 0.06); tone('sine', 240, 1800, 1.2, 0.05); } },
    beam: function () { if (ok('beam', 200)) { tone('sawtooth', 1400, 180, 0.45, 0.12); noise(0.45, 0.2, 2400, 0.7); } },
    fireball: function () { if (ok('fireball', 300)) [0, 0.3, 0.6].forEach(function (d) { noise(0.35, 0.1, 700, 0.8, d); tone('sine', 420, 160, 0.3, 0.07, d); }); },
    firework: function () {
      if (!ok('fw', 110)) return;
      noise(0.25, 0.1, 3200 + Math.random() * 2000, 1.2);
      tone('sine', 900 + Math.random() * 500, 300, 0.2, 0.04);
      noise(0.3, 0.05, 7000, 2, 0.12, 'highpass');   // the crackle afterwards
    },
    star: function (n) { if (ok('star' + n, 100)) { const f = [784, 988, 1319][n] || 784; tone('sine', f, 0, 0.3, 0.12); tone('triangle', f * 2, 0, 0.35, 0.05, 0.03); } },

    shoot: function () { if (ok('shoot', 60)) tone('square', 820 + Math.random() * 220, 260, 0.05, 0.022); },
    hit: function () { if (ok('hit', 45)) noise(0.03, 0.045, 2600, 2); },
    kill: function () { if (ok('kill', 55)) { tone('triangle', 300, 90, 0.09, 0.07); noise(0.05, 0.04, 900, 1); } },
    // Each "+1" in a row plays a semitone higher than the last: free juice for the gate corridor.
    plus: function () {
      if (!ok('plus', 35)) return;
      const now = performance.now();
      combo = now - comboAt < 700 ? Math.min(combo + 1, 16) : 0;
      comboAt = now;
      tone('triangle', 520 * Math.pow(2, combo / 12), 0, 0.09, 0.11);
    },
    gateGood: function () { if (ok('gg', 60)) { tone('sine', 660, 0, 0.1, 0.13); tone('sine', 990, 0, 0.16, 0.13, 0.08); } },
    gateBad: function () { if (ok('gb', 60)) tone('sawtooth', 300, 110, 0.28, 0.1); },
    tick: function () { if (ok('tick', 50)) tone('sine', 1400, 0, 0.03, 0.05); },
    crate: function () { if (ok('crate', 60)) { noise(0.22, 0.2, 520, 0.8); tone('triangle', 180, 60, 0.2, 0.14); } },
    powerup: function () { if (ok('pu', 100)) [523, 659, 784, 1047].forEach(function (f, i) { tone('square', f, 0, 0.12, 0.06, i * 0.07); }); },
    hurt: function () { if (ok('hurt', 80)) tone('sawtooth', 220, 100, 0.13, 0.09); },
    boom: function () { if (ok('boom', 150)) { noise(0.7, 0.45, 220, 0.6, 0, 'lowpass'); tone('sine', 120, 30, 0.55, 0.4); } },
    roar: function () { if (ok('roar', 300)) { tone('sawtooth', 110, 52, 0.9, 0.18); tone('sawtooth', 117, 48, 0.9, 0.14); noise(0.8, 0.1, 420, 0.7); } },
    // arrives a beat after the lightning flash, like the real thing
    thunder: function () { if (ok('thunder', 2500)) { noise(1.8, 0.3, 130, 0.5, 0.4, 'lowpass'); tone('sine', 62, 30, 1.3, 0.22, 0.4); } },
    stomp: function () { if (ok('stomp', 150)) { tone('sine', 90, 34, 0.26, 0.4); noise(0.16, 0.16, 160, 0.8, 0, 'lowpass'); } },
    win: function () { if (ok('win', 500)) [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone('square', f, 0, 0.2, 0.07, i * 0.11); }); },
    lose: function () { if (ok('lose', 500)) [392, 330, 262, 196].forEach(function (f, i) { tone('sawtooth', f, 0, 0.26, 0.07, i * 0.17); }); },
    click: function () { if (ok('click', 30)) tone('square', 600, 820, 0.04, 0.05); },
    buy: function () { if (ok('buy', 60)) { tone('sine', 880, 0, 0.08, 0.1); tone('sine', 1320, 0, 0.14, 0.1, 0.07); } },
    coin: function () { if (ok('coin', 70)) tone('sine', 1250, 1800, 0.06, 0.045); }
  };
})(window.BB);
