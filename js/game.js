/* Babysitter (phone version) - game logic. Tunable numbers live in js/config.js. */
/* ---------- phone mode ----------
   On a phone (or with ?mobile in the address), the scene is cropped to portrait, the game draws its own
   keyboard under it (so the phone's keyboard never covers the crib), and the pests are slower and fewer. */
const MOBILE = true || /[?&]mobile/.test(location.search) ||
  (matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 760 && !/[?&]desktop/.test(location.search));
if (MOBILE) {
  for (const m of ['night', 'day']) {
    const c = CONFIG[m];
    c.speed *= 0.72; c.spawnEvery *= 1.35; c.spawnEveryEnd *= 1.35;
    c.maxOnScreen = 3; c.maxOnScreenEnd = Math.round(c.maxOnScreenEnd * 0.7);
  }
  CONFIG.day.firstDayMax = 4;
  CONFIG.minSpawnEvery = 0.75;
  CONFIG.maxOnScreenCap = 7;
}

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const BABY = { x: 482, y: 410 };
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ---------- sound (tiny WebAudio blips) ---------- */
const sound = {
  ctx: null, on: true,
  init() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } },
  tone(freq, dur, type = 'sine', vol = 0.06, slide = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur);
  },
  noise(dur, vol = 0.18) {
    if (!this.on || !this.ctx) return;
    const n = Math.floor(this.ctx.sampleRate * dur), buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); g.gain.value = vol;
    s.buffer = buf; s.connect(g).connect(this.ctx.destination); s.start();
  },
  key() { this.tone(900, 0.03, 'triangle', 0.03); },
  bad() { this.tone(140, 0.12, 'square', 0.04); },
  hit() { this.noise(0.12); this.tone(220, 0.08, 'triangle', 0.05, -120); },
  hurt() { this.tone(520, 0.25, 'sawtooth', 0.035, -300); },
  win() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'triangle', 0.05), i * 110)); },
  lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, 'sawtooth', 0.035), i * 160)); },
  lock() { this.tone(1250, 0.05, 'sine', 0.03); },                                   // locked onto a pest
  bell() { this.tone(1318, 0.35, 'sine', 0.035); this.tone(659, 0.35, 'sine', 0.02); },  // card countdown
  whimper() {                                                                         // baby fusses when a pest gets close
    const now = performance.now(); if (now - (this.lastWhimper || 0) < 2500) return; this.lastWhimper = now;
    this.tone(760, 0.28, 'sine', 0.03, -260); setTimeout(() => this.tone(640, 0.3, 'sine', 0.025, -220), 260);
  },
  giggle() { [880, 990, 880, 1175].forEach((f, i) => setTimeout(() => this.tone(f, 0.09, 'triangle', 0.04, 60), i * 90)); },
};

/* ---------- recorded audio ----------
   The single-file build embeds each clip as base64 in a <script id="..."> tag at the end of the page.
   The GitHub build has no such tags and loads the same files from assets/audio/ instead. */
const AUDIO_FILES = {
  bgmData: 'assets/audio/bg_music.wav', cryData: 'assets/audio/end_baby_cry.wav',
  popData: 'assets/audio/reward_day_pop.wav', slapData: 'assets/audio/reward_night_slap.wav',
};
async function audioBytes(id) {
  const b64 = document.getElementById(id)?.textContent.trim();
  if (b64) return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
  try { const res = await fetch(AUDIO_FILES[id]); return res.ok ? await res.arrayBuffer() : null; } catch { return null; }
}

/* ---------- recorded sound effects ---------- */
const clips = {
  bufs: {},
  async get(id) {                       // decode once, then reuse
    if (this.bufs[id] || !sound.ctx) return this.bufs[id];
    try { const bytes = await audioBytes(id); if (!bytes) return null; this.bufs[id] = await sound.ctx.decodeAudioData(bytes); } catch { return null; }
    return this.bufs[id];
  },
  async play(id, vol = 0.8) {
    if (!sound.on) return; sound.init(); if (!sound.ctx) return;
    const buf = await this.get(id); if (!buf) return;
    const s = sound.ctx.createBufferSource(), g = sound.ctx.createGain();
    g.gain.value = vol; s.buffer = buf; s.connect(g).connect(sound.ctx.destination); s.start();
  },
};

/* ---------- background music: one looping track ---------- */
const music = {
  buf: null, src: null, gain: null, filter: null, cur: 'title', loading: null,
  // [volume, low-pass cutoff]: nights sound muffled and sleepy, days bright
  moods: { title: [0.26, 2400], night: [0.2, 1400], day: [0.3, 20000], pause: [0.06, 1000], over: [0.1, 1200], ending: [0.34, 20000] },
  load() {
    if (!this.loading) this.loading = (async () => {
      if (!sound.ctx) return;
      const bytes = await audioBytes('bgmData'); if (!bytes) return;
      this.buf = await sound.ctx.decodeAudioData(bytes);
    })().catch(() => {}).finally(() => { if (!this.buf) this.loading = null; });   // allow a retry if it failed
    return this.loading;
  },
  async start() {
    sound.init(); if (!sound.ctx) return;
    // resume() must run inside the click/key handler, so it is not awaited; a source started while
    // the context is still suspended simply begins playing the moment the context resumes
    if (sound.ctx.state === 'suspended') sound.ctx.resume().catch(() => {});
    await this.load(); if (!this.buf || this.src) return;
    const c = sound.ctx;
    this.filter = c.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 20000;
    this.gain = c.createGain(); this.gain.gain.value = 0;
    this.src = c.createBufferSource(); this.src.buffer = this.buf; this.src.loop = true;   // gapless loop
    this.src.connect(this.filter).connect(this.gain).connect(c.destination); this.src.start();
    this.mood(this.cur);
  },
  mood(m) {
    this.cur = m; if (!this.gain) return;
    const [vol, cutoff] = this.moods[m] || this.moods.title, t = sound.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(sound.on ? vol * CONFIG.musicVolume : 0, t, 0.35);
    this.filter.frequency.setTargetAtTime(cutoff, t, 0.35);
  },
};

/* ---------- game state ---------- */
const G = {
  screen: 'title',          // title | card | play | pause | over
  mode: 'night',            // night | day
  cycle: 1,                 // night/day pair number
  t: 0, spawnT: 0,
  sleep: 0, happy: 0,
  ents: [], fx: [], target: null,
  stats: { nights: 0, days: 0, hits: 0, keys: 0, good: 0 }, score: 0, boardFrom: 'scrTitle',
};

/* ---------- gauge ---------- */
// On phones the meter is a rainbow arching over the crib; on computers it's a ring above the baby.
const R = MOBILE ? 132 : 46;
function arcPoint(deg) { const a = deg * Math.PI / 180; return [R * Math.cos(a), R * Math.sin(a)]; }
function arcPath(frac) {
  frac = Math.max(0.001, Math.min(1, frac));
  const start = MOBILE ? 180 : 120, sweep = (MOBILE ? 180 : 300) * frac;
  const [x1, y1] = arcPoint(start), [x2, y2] = arcPoint(start + sweep);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 ${sweep > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}
if (MOBILE) {
  $('gauge').setAttribute('transform', 'translate(482 404)');
  for (const g of ['gradNight', 'gradDay']) { $(g).setAttribute('x1', -R); $(g).setAttribute('x2', R); }
  for (const id of ['gTrack', 'gFill']) $(id).setAttribute('stroke-width', 13);
  // two soft inner bands make the arch read as a rainbow
  for (const [r, op] of [[R - 14, 0.28], [R - 24, 0.16]]) {
    const band = el('path', { d: `M${-r} 0 A${r} ${r} 0 0 1 ${r} 0`, fill: 'none', stroke: 'url(#gradDay)', 'stroke-width': 6, 'stroke-linecap': 'round', opacity: op });
    $('gauge').insertBefore(band, $('gTrack'));
  }
  $('gNum').setAttribute('y', -84); $('gNum').setAttribute('font-size', 19);
  $('gUnit').setAttribute('y', -66); $('gUnit').setAttribute('font-size', 10);
  $('gLeft').setAttribute('x', -R); $('gLeft').setAttribute('y', 24); $('gLeft').setAttribute('font-size', 12);
  $('gRight').setAttribute('x', R); $('gRight').setAttribute('y', 24); $('gRight').setAttribute('font-size', 12);
}
$('gTrack').setAttribute('d', arcPath(1));

/* ---------- scene setup per mode ---------- */
function setFace(name) {
  for (const f of ['sleep', 'fuss', 'cry', 'sob', 'smile', 'laugh']) $('face-' + f).setAttribute('display', f === name ? 'inline' : 'none');
  $('zzz').setAttribute('display', name === 'sleep' && G.mode === 'night' ? 'inline' : 'none');
}
function paintMode() {
  const night = G.mode === 'night';
  $('bgNight').setAttribute('display', night ? 'inline' : 'none');
  $('bgDay').setAttribute('display', night ? 'none' : 'inline');
  const ink = night ? '#f5f1e8' : '#1d2b3a';
  for (const id of ['hudLabel', 'hudClock', 'gNum', 'gUnit']) $(id).setAttribute('fill', ink);
  $('gTrack').setAttribute('stroke', night ? '#1d2b3a' : '#8fb2c2');
  $('gFill').setAttribute('stroke', 'url(#gradDay)');
  
  $('gLeft').textContent = night ? 'AWAKE' : 'CRY';
  $('gLeft').setAttribute('fill', '#e2453c');
  $('gRight').textContent = night ? 'ASLEEP' : 'HAPPY';
  $('gRight').setAttribute('fill', night ? '#b5d334' : '#6f8a12');
  $('hudBarBg').setAttribute('fill', night ? '#1d2b3a' : '#8fb2c2');
  $('typeHint').textContent = night ? 'type the buzz to swat' : 'type the noise to stop it';
  setFace(night ? 'sleep' : 'laugh');
}

/* ---------- 注音 (Zhuyin) mode ---------- */
const ZH = { on: false };
// Standard Zhuyin keyboard: symbol -> key
const ZY_KEY = { 'ㄅ':'1','ㄆ':'q','ㄇ':'a','ㄈ':'z','ㄉ':'2','ㄊ':'w','ㄋ':'s','ㄌ':'x','ㄍ':'e','ㄎ':'d','ㄏ':'c','ㄐ':'r','ㄑ':'f','ㄒ':'v',
  'ㄓ':'5','ㄔ':'t','ㄕ':'g','ㄖ':'b','ㄗ':'y','ㄘ':'h','ㄙ':'n','ㄧ':'u','ㄨ':'j','ㄩ':'m','ㄚ':'8','ㄛ':'i','ㄜ':'k','ㄝ':',',
  'ㄞ':'9','ㄟ':'o','ㄠ':'l','ㄡ':'.','ㄢ':'0','ㄣ':'p','ㄤ':';','ㄥ':'/','ㄦ':'-','ˊ':'6','ˇ':'3','ˋ':'4','˙':'7' };
// Zhuyin for every character the mode uses
const ZY = { 嗞:'ㄗ', 嘶:'ㄙ', 咿:'ㄧ', 唧:'ㄐㄧ', 咬:'ㄧㄠˇ', 癢:'ㄧㄤˇ', 餓:'ㄜˋ', 起:'ㄑㄧˇ', 床:'ㄔㄨㄤˊ', 你:'ㄋㄧˇ', 囉:'ㄌㄨㄛ˙', 吃:'ㄔ', 宵:'ㄒㄧㄠ', 夜:'ㄧㄝˋ', 咻:'ㄒㄧㄡ', 呼:'ㄏㄨ', 包:'ㄅㄠ', 裹:'ㄍㄨㄛˇ', 淇:'ㄑㄧˊ', 淋:'ㄌㄧㄣˊ', 吱:'ㄓ', 沙:'ㄕㄚ', 叩:'ㄎㄡˋ', 信:'ㄒㄧㄣˋ', 倒:'ㄉㄠˋ', 垃:'ㄌㄜˋ', 圾:'ㄙㄜˋ', 冰:'ㄅㄧㄥ', 哇:'ㄨㄚ', 耶:'ㄧㄝ', 哈:'ㄏㄚ', 乖:'ㄍㄨㄞ', 好:'ㄏㄠˇ', 噓:'ㄒㄩ', 拍:'ㄆㄞ', 睡:'ㄕㄨㄟˋ', 嗡:'ㄨㄥ', 不:'ㄅㄨˋ', 哭:'ㄎㄨ', 覺:'ㄐㄧㄠˋ', 抱:'ㄅㄠˋ',
  夢:'ㄇㄥˋ', 晚:'ㄨㄢˇ', 安:'ㄢ', 寶:'ㄅㄠˇ', 秀:'ㄒㄧㄡˋ', 搖:'ㄧㄠˊ', 靜:'ㄐㄧㄥˋ', 吵:'ㄔㄠˇ', 砰:'ㄆㄥ', 叭:'ㄅㄚ',
  喵:'ㄇㄧㄠ', 汪:'ㄨㄤ', 咚:'ㄉㄨㄥ', 敲:'ㄑㄧㄠ', 嗶:'ㄅㄧˋ', 叮:'ㄉㄧㄥ', 轟:'ㄏㄨㄥ', 隆:'ㄌㄨㄥˊ', 鬧:'ㄋㄠˋ', 鑽:'ㄗㄨㄢˋ',
  響:'ㄒㄧㄤˇ', 碰:'ㄆㄥˋ', 噹:'ㄉㄤ', 吠:'ㄈㄟˋ', 嗚:'ㄨ' };
const TONES = 'ˊˇˋ˙';
// '睡覺' -> [{sym:'ㄕ',key:'g'}, ... {sym:'ˋ',key:'4'}, ...]; a syllable with no tone mark ends with the space bar
function zySyms(word) {
  const out = [];
  for (const ch of word) {
    const zy = ZY[ch] || '';
    for (const sym of zy) out.push({ sym, key: ZY_KEY[sym] });
    if (!TONES.includes(zy.slice(-1))) out.push({ sym: ' ', key: ' ' });
  }
  return out;
}
const keysOf = w => ZH.on ? zySyms(w).map(k => k.key).join('') : w;
const sv = (sp, field) => (ZH.on && CONFIG.zhuyin.specials[sp?.id]?.[field]) || sp?.[field];
function setZhuyin(on) {
  ZH.on = on; store.set('babysitter-zhuyin', on); if (MOBILE) { buildPad(); updatePad(); }
  $('btnZhuyin').setAttribute('aria-pressed', String(on));
  $('zhLabel').textContent = `注音模式 Zhuyin Mode · ${on ? 'On' : 'Off'}`;
  $('zhNote').hidden = !on;
  if (G.screen === 'title') titleHintText();
}
function titleHintText() {
  const best = store.get('babysitter-best2');
  $('titleHint').textContent = best ? `Your best: ${best.score}` : (MOBILE ? '' : 'Keyboard needed');
}

/* ---------- entities ---------- */
function tier() { return Math.min(G.cycle, 3) - 1; }
function wordPool() {
  const w = ZH.on ? CONFIG.zhuyin.words[G.mode] : CONFIG[G.mode].words, t = tier();
  // mostly current tier, some easier words mixed in
  return Math.random() < 0.65 ? w[t] : w[Math.max(0, t - 1)].concat(w[0]);
}
// a character's sound family for this round: [early rounds, later rounds]
function soundsFor(sp) {
  const tiers = sv(sp, 'sounds'); if (!tiers) return null;
  return tiers[Math.min(tiers.length - 1, Math.floor(Math.max(0, G.cycle - (sp.from || 1)) / 2))];
}
function pickWord(pool) {
  const busy = new Set(G.ents.map(e => e.word[0]));
  let word, tries = 0;
  do { word = pick(pool || wordPool()); tries++; } while ((busy.has(keysOf(word)[0]) || G.ents.some(e => e.labels[e.wi] === word)) && tries < 12);
  return word;
}
function spawn() {
  const cfg = CONFIG[G.mode];
  const prog = Math.min(1, G.t / cfg.seconds);
  let maxNow = Math.round(cfg.maxOnScreen + (cfg.maxOnScreenEnd - cfg.maxOnScreen) * prog) + (G.cycle - 1);
  if (G.cycle === 1 && cfg.firstDayMax) maxNow = Math.min(maxNow, cfg.firstDayMax);
  maxNow = Math.min(maxNow, CONFIG.maxOnScreenCap);
  if (G.ents.length >= maxNow) return;

  // maybe a special enemy (each one unlocks on its round)
  let sp = null;
  for (const s of cfg.specials.filter(s => G.cycle >= s.from).sort(() => Math.random() - 0.5)) {
    if (Math.random() < s.chance && !(s.near && G.ents.some(e => e.sp === s))) { sp = s; break; }
  }
  let words;
  if (sp?.chain) words = [...sv(sp, 'chain')];
  else if (sp?.words === 2) { const a = pick(soundsFor(sp)); words = [a, a]; }   // tiger mosquito: the same buzz twice
  else if (sp) words = [pickWord(soundsFor(sp))];
  else {
    // a plain mosquito or noise; some mosquitoes talk instead of buzzing
    const t = CONFIG.night.talk;
    if (G.mode === 'night' && G.cycle >= t.from && Math.random() < t.chance) {
      const lines = ZH.on ? CONFIG.zhuyin.talk : t.lines;
      words = [pickWord(lines[Math.min(lines.length - 1, G.cycle - t.from)])];
      return placeAndMake(words, { id: 'talker', talk: true });
    }
    words = [pickWord()];
  }
  return placeAndMake(words, sp);
}
function placeAndMake(words, sp) {

  if (sp?.floor) {                                   // walks in along the floor from one side
    const left = Math.random() < 0.5, x = left ? -40 : 1000;
    makeEnt(words, x, 540, sp);
    if (sp.pair) makeEnt([pickWord(soundsFor(sp))], x + (left ? -80 : 80), 540, sp);
    return;
  }
  if (sp?.cross) {                                   // drives across the top of the screen, never toward the crib
    const left = Math.random() < 0.5;
    const e = makeEnt(words, left ? -80 : 1040, rand(135, 175), sp);
    e.dir = left ? 1 : -1; e.baseY = e.y;
    return;
  }
  let x, y;
  if (sp?.near) {
    const a = rand(200, 340) * Math.PI / 180;                 // just outside the red ring, above the crib
    x = 480 + Math.cos(a) * 225; y = 455 + Math.sin(a) * 165;
  } else {
    const side = pick(G.mode === 'day' ? ['top', 'top', 'left', 'right'] : ['top', 'left', 'right']);
    if (side === 'top') { x = rand(60, 900); if (x > 370 && x < 590) x += x < 480 ? -230 : 230; y = -30; }  // keep clear of the clock
    else if (side === 'left') { x = -40; y = rand(90, 470); }
    else { x = 1000; y = rand(90, 470); }
  }
  makeEnt(words, x, y, sp);
}
function makeEnt(words, x, y, sp) {
  const cfg = CONFIG[G.mode], night = G.mode === 'night';
  const sc = sp?.scale || 1;
  const keys = words.map(keysOf);                     // what the player types
  const e = {
    labels: words, words: keys, wi: 0, word: keys[0], typed: 0, x, y, sp, sc, phase: rand(0, 6.28),
    speed: cfg.speed * CONFIG.ramp.speed ** (G.cycle - 1) * rand(0.85, 1.2) * (sp?.speed || 1) * (keys[0].length > 5 ? 0.85 : 1),
    danger: false, g: el('g', {}, $('ents')),
    dir: x < BABY.x ? 1 : -1, sniffT: rand(0.8, 1.6), sniffing: false, auraT: sp?.aura?.every || 0, emitT: 1,
  };
  if (night) {
    e.ring = el('circle', { r: 30 * sc, fill: 'none', stroke: '#b5d334', 'stroke-width': 4, display: 'none' }, e.g);
    e.body = el('g', {}, e.g);
    if (sp?.sprite && sp.id !== 'tiger') { e.glow = el('circle', { r: 26 * sc, fill: '#e2453c', opacity: 0.3, display: 'none' }, e.g); e.g.insertBefore(e.glow, e.body); }
    e.sprite = el('use', { href: sp?.sprite || '#mosq' }, e.body);
    e.textY = sp?.floor ? -26 : 42 + (sc - 1) * 26;
    e.text = el('text', { y: e.textY, 'font-size': 19, 'text-anchor': 'middle' }, e.g);
  } else {
    e.waves = el('g', { fill: 'none', 'stroke-width': 3, 'stroke-linecap': 'round' }, e.g);
    for (let k = 0; k < 3; k++) el('path', { d: `M${-8 - k * 9} ${-12 - k * 6} q${10 + k * 4} ${12 + k * 6} 0 ${24 + k * 12}`, opacity: (0.6 - k * 0.17).toFixed(2) }, e.waves);
    e.box = el('rect', { fill: 'none', stroke: '#6f8a12', 'stroke-width': 3, rx: 13, display: 'none' }, e.g);
    e.iconY = -20 - (sc - 1) * 16;
    e.icon = el('use', { href: '#ic-' + (sp?.icon || (ZH.on ? CONFIG.zhuyin.icons : cfg.icons)[words[0]] || 'speaker') }, e.g);
    e.textY = 16;
    e.text = el('text', { y: e.textY, 'font-size': 16, 'text-anchor': 'middle', 'letter-spacing': 1.5 }, e.g);
  }
  if (sp?.talk) {   // talking pests get a speech bubble behind their words
    e.bubble = el('g', {}, e.g); e.g.insertBefore(e.bubble, e.text);
    e.bRect = el('rect', { rx: 12, fill: '#f5f1e8', stroke: '#1d2b3a', 'stroke-width': 2 }, e.bubble);
    e.bTail = el('path', { fill: '#f5f1e8', stroke: '#1d2b3a', 'stroke-width': 2, 'stroke-linejoin': 'round' }, e.bubble);
  }
  e.tA = el('tspan', {}, e.text); e.tB = el('tspan', {}, e.text);
  if (ZH.on) {   // Zhuyin is the big line; the characters sit small underneath
    e.text.setAttribute('class', 'zy'); e.text.setAttribute('font-size', night ? 23 : 20); e.text.setAttribute('letter-spacing', 1);
    // the keys to press on a standard keyboard, e.g. ㄗㄨㄢˋ -> y j 0 4  (␣ = space bar)
    e.sub = el('text', { y: e.textY + 17, 'font-size': 13, 'text-anchor': 'middle', 'letter-spacing': 2.5 }, e.g);
    e.sA = el('tspan', {}, e.sub); e.sB = el('tspan', {}, e.sub);
  }
  e.pips = el('text', { y: e.textY + (ZH.on ? 30 : 15), 'font-size': 11, 'text-anchor': 'middle', 'letter-spacing': 3, fill: night ? '#f2c84b' : '#c7362e' }, e.g);
  renderWord(e);
  G.ents.push(e);
  return e;
}
function renderWord(e) {
  const night = G.mode === 'night';
  const base = e.danger ? '#e2453c' : (night && !e.bubble ? '#f5f1e8' : '#1d2b3a');
  let w;
  if (ZH.on) {
    const syms = zySyms(e.labels[e.wi]).map(k => k.sym);
    w = syms.join('');
    e.tA.textContent = syms.slice(0, e.typed).join('');
    e.tB.textContent = syms.slice(e.typed).join('');
    e.tA.style.color = night ? '#b5d334' : '#6f8a12'; e.tB.style.color = base;   // chunky rounded strokes in the same color
    const keys = [...e.word].map(k => k === ' ' ? '␣' : k);
    e.sA.textContent = keys.slice(0, e.typed).join(''); e.sB.textContent = keys.slice(e.typed).join('');
    e.sA.setAttribute('fill', night ? '#b5d334' : '#6f8a12'); e.sB.setAttribute('fill', base); e.sB.setAttribute('opacity', 0.8);
  } else {
    w = night ? e.word : e.word.toUpperCase();
    e.tA.textContent = w.slice(0, e.typed);
    e.tB.textContent = w.slice(e.typed);
  }
  e.tA.setAttribute('fill', night && !e.bubble ? '#b5d334' : '#6f8a12');
  e.tB.setAttribute('fill', base);
  if (e.bubble) {   // size the bubble to the words
    const bb = e.text.getBBox(), pad = 8, x0 = bb.x - pad, y0 = bb.y - 4, wd = bb.width + pad * 2, ht = bb.height + 8;
    e.bRect.setAttribute('x', x0); e.bRect.setAttribute('y', y0); e.bRect.setAttribute('width', wd); e.bRect.setAttribute('height', ht);
    e.bTail.setAttribute('d', `M-6 ${y0 + 1} L0 ${y0 - 9} L6 ${y0 + 1} Z`);
    e.bRect.setAttribute('stroke', e.danger ? '#e2453c' : '#1d2b3a');
  }
  const left = e.words.length - e.wi - 1;               // words still to come after this one
  e.pips.textContent = left > 0 ? '●'.repeat(left) : '';
  const locked = G.target === e;
  if (night) {
    e.ring.setAttribute('display', locked ? 'inline' : 'none');
    if (e.glow) e.glow.setAttribute('display', e.danger ? 'inline' : 'none');
    else e.sprite.setAttribute('href', e.danger ? '#mosqRed' : (e.sp?.sprite || '#mosq'));
  } else {
    e.box.setAttribute('display', locked ? 'inline' : 'none');
    if (locked) {
      const wpx = ZH.on ? w.length * 15 + 24 : w.length * 12 + 24;
      e.box.setAttribute('x', -wpx / 2); e.box.setAttribute('y', -1); e.box.setAttribute('width', wpx); e.box.setAttribute('height', 24);
    }
    e.waves.setAttribute('stroke', base);
  }
}
function removeEnt(e) {
  e.g.remove();
  G.ents = G.ents.filter(x => x !== e);
  if (G.target === e) G.target = null;
  updateTypebar();
}

/* ---------- effects ---------- */
function burst(x, y, label) {
  const g = el('g', { transform: `translate(${x} ${y})` }, $('fx'));
  el('path', { d: 'M0 -40 L13 -22 L35 -29 L26 -9 L46 0 L26 9 L35 29 L13 22 L0 40 L-13 22 L-35 29 L-26 9 L-46 0 L-26 -9 L-35 -29 L-13 -22 Z', fill: '#f2c84b' }, g);
  const t = el('text', { y: 7, 'font-size': 19, 'text-anchor': 'middle', fill: '#1d2b3a' }, g); t.textContent = label;
  G.fx.push({ g, x, y, life: 0.55, max: 0.55, kind: 'burst', rot: rand(-12, 12) });
}
function popup(x, y, label, color) {
  const g = el('g', {}, $('fx'));
  const t = el('text', { 'font-size': 26, 'text-anchor': 'middle', fill: color }, g); t.textContent = label;
  G.fx.push({ g, x, y, life: 1, max: 1, kind: 'pop' });
}
function shakeBaby() {
  const b = $('baby'); b.classList.remove('shake'); void b.getBBox(); b.classList.add('shake');
}

/* ---------- typing ---------- */
function updateTypebar() {
  const e = G.target;
  if (!e) { $('typed').textContent = ''; return; }
  $('typed').setAttribute('class', ZH.on ? 'zy' : '');
  if (ZH.on) { $('typed').textContent = zySyms(e.labels[e.wi]).slice(0, e.typed).map(k => k.sym === ' ' ? '·' : k.sym).join('') + '|'; return; }
  const w = G.mode === 'night' ? e.word : e.word.toUpperCase();
  $('typed').textContent = w.slice(0, e.typed) + '|';
}
function typo() {
  G.stats.keys++;
  sound.bad();
  const t = $('typed'); t.classList.remove('badkey'); void t.getBBox(); t.classList.add('badkey');
  if (G.mode === 'night') { G.sleep -= CONFIG.night.typoCost; popup(600, 236, `-${CONFIG.night.typoCost}%`, '#e2453c'); }
  else { G.happy -= CONFIG.day.typoCost; popup(600, 236, `-${CONFIG.day.typoCost}%`, '#e2453c'); }
}
function typeChar(ch) {
  if (G.screen !== 'play') return;
  ch = ch.toLowerCase();
  if (!G.target) {
    const options = G.ents.filter(e => e.word[0] === ch);
    if (!options.length) return typo();
    options.sort((a, b) => Math.hypot(a.x - BABY.x, a.y - BABY.y) - Math.hypot(b.x - BABY.x, b.y - BABY.y));
    G.target = options[0];
    G.target.typed = 0;
    sound.lock();
  }
  const e = G.target;
  if (e.word[e.typed] !== ch) return typo();
  G.stats.keys++; G.stats.good++;
  e.typed++;
  sound.key();
  if (e.typed >= e.word.length) return defeat(e);
  renderWord(e); updateTypebar();
}
function releaseTarget() {
  if (!G.target) return;
  const e = G.target; e.typed = 0; G.target = null; renderWord(e); updateTypebar();
}
function defeat(e) {
  G.stats.hits++;
  G.score += CONFIG.points.word * G.cycle;
  const finalWord = e.wi >= e.words.length - 1;
  // every hit uses the recorded sound: the bubble pop by day, the hand slap at night
  if (G.mode === 'day') clips.play('popData', CONFIG.popVolume);
  else clips.play('slapData', CONFIG.slapVolume);
  if (G.mode === 'day') { G.happy = Math.min(100, G.happy + CONFIG.day.healPerNoise); popup(e.x, e.y - 50, `+${CONFIG.day.healPerNoise}%`, '#6f8a12'); }
  if (e.wi < e.words.length - 1) {                   // multi-word enemy: next word, knocked back a little
    e.wi++; e.word = e.words[e.wi]; e.typed = 0;
    const d = Math.hypot(e.x - BABY.x, e.y - BABY.y) || 1;
    e.x += (e.x - BABY.x) / d * 40; e.y += (e.y - BABY.y) / d * 40;
    burst(e.x, e.y, G.mode === 'night' ? 'SWAT!' : 'BONK!');
    G.target = null;                                  // type the next word's first letter to lock on again
    renderWord(e); updateTypebar();
    return;
  }
  burst(e.x, e.y, G.mode === 'night' ? 'SLAP!' : 'POW!');
  G.target = null;
  removeEnt(e);
  if (sv(e.sp, 'puppies')) {
    const pool = [...sv(e.sp, 'puppies')].sort(() => Math.random() - 0.5);
    makeEnt([pool[0]], e.x - 40, e.y - 10, CONFIG.day.puppy);
    makeEnt([pool[1]], e.x + 40, e.y - 10, CONFIG.day.puppy);
  }
}

/* ---------- flow ---------- */
function show(id) {
  document.body.classList.toggle('on-title', ['scrTitle', 'scrOver', 'scrBoard', 'scrPause'].includes(id));
  for (const s of ['scrTitle', 'scrCard', 'scrPause', 'scrOver', 'scrBoard']) $(s).hidden = s !== id;
  const playing = id === null;
  $('btnPause').hidden = !(playing || id === 'scrPause');
}
function clearField() {
  G.ents.forEach(e => e.g.remove()); G.ents = [];
  G.fx.forEach(f => f.g.remove()); G.fx = [];
  G.target = null; updateTypebar();
}
function goTitle() {
  music.mood('title');
  resetBaby();
  G.screen = 'title'; G.mode = 'night';
  clearField(); paintMode(); setFace('sleep');
  $('hud').setAttribute('display', 'none'); $('typebar').setAttribute('display', 'none'); $('dangerRing').setAttribute('display', 'none');
  titleHintText();
  show('scrTitle');
  $('btnStart').focus({ preventScroll: true });
}
function newGame() {
  sound.init();
  G.cycle = 1; G.score = 0; G.stats = { nights: 0, days: 0, hits: 0, keys: 0, good: 0 };
  startMode('night');
}
let cardTimer = null;
function startMode(mode) {
  music.mood(mode);
  hideIdle();   // the title-screen mosquitoes never follow into a level
  resetBaby();
  G.mode = mode; G.screen = 'card';
  clearField(); paintMode();
  G.t = 0; G.spawnT = 0.6;
  G.sleep = CONFIG.night.sleepStart; G.happy = CONFIG.day.happyStart;
  $('hud').setAttribute('display', 'inline'); $('typebar').setAttribute('display', 'inline'); $('dangerRing').setAttribute('display', 'inline');
  drawHud();
  const night = mode === 'night';
  $('cardEyebrow').textContent = `${night ? 'Night' : 'Day'} ${G.cycle} of ${CONFIG.finalDay}`;
  // one dot per day of the week: green = done, big yellow = today, outline = still to come
  $('cardDots').replaceChildren(...Array.from({ length: CONFIG.finalDay }, (_, i) =>
    Object.assign(document.createElement('i'), { className: i + 1 < G.cycle ? 'done' : i + 1 === G.cycle ? 'now' : '' })));
  // a title can have two lines: [first line, second line]
  const title = night ? (G.cycle === 1 ? ['Keep the baby asleep'] : G.cycle === CONFIG.finalDay ? ['Last night!', 'Keep the baby sleeping well'] : ['Night again!', 'Keep the baby sleeping well'])
                      : (G.cycle === CONFIG.finalDay ? ['Last day!', 'Keep the baby laughing'] : ['Good Morning!', 'Keep the baby laughing']);
  $('cardTitle').replaceChildren(...title.flatMap((line, i) => i ? [document.createElement('br'), line] : [line]));
  $('cardBody').textContent = night
    ? 'Type to hit mosquitoes until 6:00 AM.'
    : 'Type to prevent noise until noon.';
  // Every round introduces a character: the basic pest on round 1, then that round's new enemy
  const fresh = CONFIG[mode].specials.find(s => s.from === G.cycle);
  const basic = night ? { name: 'Mosquito', info: 'Flies at the crib. Type its buzz to swat it.', sprite: '#mosq' }
                      : { name: 'Noise', info: 'Floats toward the crib. Type it to stop it.', icon: 'hammer' };
  const intro = fresh || (G.cycle === 1 ? basic : null);
  $('cardNew').hidden = !intro;
  if (intro) {
    const head = document.createElement('div'); head.className = 'new-head';
    head.append(Object.assign(document.createElement('span'), { className: 'new-tag', textContent: 'NEW' }), intro.name);
    // the character itself, drawn from the same sprite the game uses
    const art = el('svg', { class: 'new-art', viewBox: '-34 -34 68 68', 'aria-hidden': 'true' });
    const isNight = night && !intro.icon;
    const big = { tiger: 1.25, zippy: 1.1, roach: 1.3, mouse: 1.3, garbage: 1.35, icecream: 1.35 }[intro.id] || (isNight ? 1.45 : 1.7);
    el('use', { href: isNight ? (intro.sprite || '#mosq') : '#ic-' + intro.icon, transform: `translate(0 ${isNight && !intro.floor ? 6 : 0}) scale(${big})`,
                opacity: intro.blink ? 0.5 : 1 }, art);
    const info = G.cycle === 1 && ZH.on
      ? (night ? 'Zhuyin Mode: press the keys under each symbol, ㄍㄨㄞ = e j 9 + space' : 'Zhuyin Mode: press the keys under each symbol, ㄔㄠˇ = t l 3')
      : intro.info;
    $('cardNew').replaceChildren(head, art, Object.assign(document.createElement('span'), { className: 'new-info', textContent: info }));
  }
  show('scrCard');
  let n = CONFIG.transitionSeconds + (fresh ? 1 : 0);
  $('cardCount').textContent = n;
  clearInterval(cardTimer);
  cardTimer = setInterval(() => {
    n--;
    if (n > 0) { $('cardCount').textContent = n; sound.bell(); return; }
    clearInterval(cardTimer);
    G.screen = 'play'; show(null); focusKb(); last = performance.now();
  }, 900);
}
function endMode(won) {
  G.screen = 'card';
  if (G.mode === 'night') {
    if (won) { G.stats.nights++; G.score += CONFIG.points.level * G.cycle; sound.win(); setFace('sleep'); setTimeout(() => startMode('day'), 900); }
    else { setFace('cry'); shakeBaby(); gameOver('The baby woke up'); }
  } else {
    if (won) {
      G.stats.days++; G.score += CONFIG.points.level * G.cycle; sound.win(); sound.giggle(); setFace('laugh');
      if (G.cycle >= CONFIG.finalDay) { G.ents.forEach(e => e.g.remove()); G.ents = []; G.target = null; updateTypebar(); return startEnding(); }
      G.cycle++; setTimeout(() => startMode('night'), 1200);
    }
    else { setFace('cry'); shakeBaby(); gameOver('The baby started crying'); }
  }
  G.ents.forEach(e => e.g.remove()); G.ents = []; G.target = null; updateTypebar();
}
function gameOver(title, won = false) {
  music.mood(won ? 'ending' : 'over');
  G.screen = 'over'; G.won = won;
  if (!won) clips.play('cryData', CONFIG.cryVolume);   // the baby cries when you lose
  const s = G.stats;
  $('overEyebrow').textContent = won ? 'The first week · complete' : `${G.mode === 'night' ? 'Night' : 'Day'} ${G.cycle} of ${CONFIG.finalDay} · ${clockText()}`;
  $('overTitle').textContent = title;
  // winners get a certificate instead of the big score line
  $('cert').hidden = !won; $('report').hidden = won; $('overHead').hidden = won; $('overTitle').hidden = false;
  $('overEyebrow').hidden = !won; $('earned').hidden = !won;

  if (won) {
    $('certScore').textContent = G.score.toLocaleString('en-US');
    $('certDate').textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    $('certBody').textContent = `kept the baby asleep for ${CONFIG.finalDay} nights and laughing for ${CONFIG.finalDay} days.`;
  }
  $('stScore').textContent = G.score.toLocaleString('en-US');
  $('stNights').textContent = s.nights; $('stDays').textContent = s.days; $('stHits').textContent = s.hits;
  $('stAcc').textContent = s.keys ? Math.round(100 * s.good / s.keys) + '%' : '–';
  const best = store.get('babysitter-best2') || { score: 0 };
  showTitle(G.score, Math.max(best.score, LB.myBest()), won);
  if (G.score > best.score) store.set('babysitter-best2', { score: G.score });
  $('stBest').textContent = Math.max(best.score, G.score, LB.myBest()).toLocaleString('en-US');
  $('nick').value = store.get('babysitter-nick') || '';
  updateCertName();
  G.saved = false;
  if (LB.mode === 'web') loadWebBoard();
  if (LB.mode === 'local') loadLocalBoard();
  showSaveArea();
  // returning players with a saved name: post a new best automatically
  setTimeout(() => { if (G.screen === 'over') { show('scrOver'); $('nick').focus({ preventScroll: true }); $('nick').select(); } }, 700);
}
function pause(on) {
  if (on && G.screen === 'play') { G.screen = 'pause'; music.mood('pause'); show('scrPause'); $('btnResume').focus({ preventScroll: true }); }
  else if (!on && G.screen === 'pause') { G.screen = 'play'; music.mood(G.mode); show(null); focusKb(); last = performance.now(); }
}

/* ---------- HUD ---------- */
function clockText() {
  const c = CONFIG[G.mode], frac = Math.min(1, G.t / c.seconds);
  const mins = Math.floor((c.startHour + (c.endHour - c.startHour) * frac) * 60);
  let h = Math.floor(mins / 60) % 24, m = mins % 60;
  const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}
function levelWord(levels, v) { for (const [min, word] of levels) if (v >= min) return word; return levels[levels.length - 1][1]; }
function drawHud() {
  const night = G.mode === 'night', c = CONFIG[G.mode];
  $('hudLabel').textContent = night ? `NIGHT ${G.cycle}/${CONFIG.finalDay} · SURVIVE UNTIL 6:00 AM` : `DAY ${G.cycle}/${CONFIG.finalDay} · KEEP BABY HAPPY UNTIL NOON`;
  $('hudClock').textContent = clockText();
  $('hudBar').setAttribute('width', (120 * Math.min(1, G.t / c.seconds)).toFixed(1));
  if (night) {
    $('gFill').setAttribute('d', arcPath(G.sleep / 100));
    $('gNum').textContent = levelWord(CONFIG.night.levels, G.sleep);
    $('gUnit').textContent = `SLEEP ${Math.max(0, Math.round(G.sleep))}%`;
  } else {
    $('gFill').setAttribute('d', arcPath(G.happy / 100));
    $('gNum').textContent = levelWord(CONFIG.day.levels, G.happy);
    $('gUnit').textContent = `HAPPY ${Math.max(0, Math.round(G.happy))}%`;
  }
}

/* ---------- ending: the baby climbs out of the crib ---------- */
const babyHome = { parent: null, next: null };
let babyOut = null;
function buildBabyOut() {
  const b = $('baby');
  babyHome.parent = b.parentNode; babyHome.next = b.nextSibling;
  babyOut = el('g', { id: 'babyOut' });
  const skin = '#f4a99a';
  babyOut.legL = el('rect', { x: 458, y: 480, width: 18, height: 28, rx: 9, fill: skin }, babyOut);
  babyOut.legR = el('rect', { x: 488, y: 480, width: 18, height: 28, rx: 9, fill: skin }, babyOut);
  babyOut.armL = el('g', {}, babyOut); el('rect', { x: 432, y: 446, width: 15, height: 36, rx: 7.5, fill: skin }, babyOut.armL);
  babyOut.armR = el('g', {}, babyOut); el('rect', { x: 517, y: 446, width: 15, height: 36, rx: 7.5, fill: skin }, babyOut.armR);
  el('rect', { x: 444, y: 436, width: 76, height: 58, rx: 26, fill: '#f5f1e8' }, babyOut);
  el('circle', { cx: 482, cy: 468, r: 9, fill: '#b5d334' }, babyOut);
  b.parentNode.insertBefore(babyOut, b);       // starts behind the blanket and crib rails
  babyOut.appendChild(b);                       // the head rides on the body
}
function resetBaby() {
  if (!babyOut) return;
  const b = $('baby');
  babyHome.parent.insertBefore(b, babyHome.next);
  b.removeAttribute('transform');
  babyOut.remove(); babyOut = null;
  $('babyHand').setAttribute('display', 'inline');
}
function startEnding() {
  music.mood('ending');
  G.screen = 'ending'; G.endT = 0; G.endFx = {};
  show(null); $('btnPause').hidden = true;
  $('hud').setAttribute('display', 'none'); $('typebar').setAttribute('display', 'none'); $('dangerRing').setAttribute('display', 'none');
  setFace('laugh'); $('babyHand').setAttribute('display', 'none');
  buildBabyOut();
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => sound.tone(f, 0.22, 'triangle', 0.06), 300 + i * 140));
}
const ease = k => k < 0 ? 0 : k > 1 ? 1 : k * k * (3 - 2 * k);
function stepEnding(dt) {
  const t = (G.endT += dt);
  let x = 0, y = 0, armUp = 0, wave = 0;
  if (t < 1.1) {                                  // climb up behind the rail
    y = -100 * ease(t / 1.1); armUp = 1; wave = Math.sin(t * 14);
  } else if (t < 1.9) {                           // over the right post
    if (babyOut.parentNode !== $('scene')) $('scene').insertBefore(babyOut, $('zzz'));
    const k = ease((t - 1.1) / 0.8); x = 200 * k; y = -100 - Math.sin(k * Math.PI) * 45; armUp = 1;
  } else if (t < 2.4) {                           // drop to the floor
    const k = (t - 1.9) / 0.5; x = 200; y = -100 + 160 * k * k; armUp = 0.5;
    if (k >= 1 && !G.endFx.land) { G.endFx.land = 1; sound.tone(180, 0.1, 'triangle', 0.06); }
  } else if (t < 3.4) {                           // crawl away happily
    const k = (t - 2.4); x = 200 + 70 * k; y = 60 - Math.abs(Math.sin(k * 9)) * 6; wave = Math.sin(k * 12) * 0.5;
  } else {                                        // jump for joy
    const k = t - 3.4; x = 270; y = 60 - Math.abs(Math.sin(k * 5.5)) * 55; armUp = 1; wave = Math.sin(k * 16);
    if (!G.endFx.c1) { G.endFx.c1 = 1; confetti(752, 380); sound.win(); }
    if (k > 0.6 && !G.endFx.c2) { G.endFx.c2 = 1; confetti(620, 300); confetti(880, 320); }
  }
  babyOut.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  const a = 180 * armUp;
  babyOut.armL.setAttribute('transform', `rotate(${(a + wave * 15).toFixed(1)} 440 450)`);
  babyOut.armR.setAttribute('transform', `rotate(${(-a - wave * 15).toFixed(1)} 524 450)`);
  const leg = t > 2.4 && t < 3.4 ? Math.sin(t * 18) * 3 : 0;
  babyOut.legL.setAttribute('transform', `translate(0 ${leg.toFixed(1)})`); babyOut.legR.setAttribute('transform', `translate(0 ${(-leg).toFixed(1)})`);
  if (t > 5.2) { G.screen = 'over'; gameOver('You survived the first week!', true); }
}
function confetti(x, y) {
  const colors = ['#b5d334', '#f2c84b', '#e2453c', '#f5f1e8', '#8fd0f0'];
  for (let i = 0; i < 26; i++) {
    const g = el('rect', { width: 8, height: 12, rx: 2, fill: pick(colors) }, $('fx'));
    G.fx.push({ g, x, y, vx: rand(-220, 220), vy: rand(-420, -160), rot: rand(0, 360), spin: rand(-500, 500), life: 2.2, max: 2.2, kind: 'confetti' });
  }
}
/* ---------- titles: a name for every score range, with the next one to aim for ---------- */
function titleFor(score) {
  const t = CONFIG.titles; let i = 0;
  while (i + 1 < t.length && score >= t[i + 1][0]) i++;
  return { name: t[i][1], next: t[i + 1] || null };
}
function showTitle(score, prevBest, won) {
  const { name, next } = titleFor(score), box = $('earned'); box.replaceChildren();
  const span = (cls, txt) => { const e = document.createElement('span'); e.className = cls; e.textContent = txt; box.append(e); };
  if (prevBest > 0 && score > prevBest) span('nb', 'New best!');
  const badge = document.createElement('span'); badge.className = 'badge';
  const lead = document.createElement('small'); lead.textContent = /^[aeiou]/i.test(name) ? "You're an" : "You're a";
  const t = document.createElement('span'); t.className = 't'; t.textContent = name;
  badge.append(lead, t); box.append(badge);
  if (next) { span('nx', `Next: ${next[1]}`); box.lastChild.append(document.createElement('br'), `at ${next[0].toLocaleString('en-US')}`); }
  else if (!won) span('nx', 'The highest title!');
  $('certTitle').textContent = name;
  $('rRank').textContent = name; $('rLead').textContent = /^[aeiou]/i.test(name) ? "You're an" : "You're a";
  $('rNext').textContent = next ? `Next: ${next[1]} at ${next[0].toLocaleString('en-US')}` : 'The highest title!';
  $('rNew').hidden = !(prevBest > 0 && score > prevBest);
}
function updateCertName() { $('certName').textContent = $('rName').textContent = $('nick').value.trim() || 'Our Babysitter'; }

/* ---------- leaderboard (shared through the page's database on claude.ai) ----------
   Each player has one document, scores/<their id>, holding a list of their games.
   The board shows every game from every player, best first. */
const LB = {
  mode: null,        // 'claude' (the page's own database), 'web' (Supabase) or 'local' (this device + rivals)
  db: null, uid: null, ready: false, writeBlocked: false, total: 0,
  rows: [],          // every game on the board, best first
  myGames: [],       // this player's saved games
  lastKey: null,     // the game saved most recently, to highlight it
  myBest() { return this.myGames.reduce((m, g) => Math.max(m, g.score), 0); },
};
const KEEP_PER_PLAYER = 25;
async function initBoard() {
  try {
    const web = CONFIG.onlineBoard;
    if (web?.url && web?.anonKey) return initWebBoard();
    if (!window.claude?.use) return initLocalBoard();
    const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
    if (!db || !user) return initLocalBoard();
    LB.uid = await user.id();
    LB.db = db; LB.ready = true; LB.mode = 'claude';
    db.collection('scores').limit(1000).onSnapshot(snap => {
      const all = [];
      for (const d of snap.docs) {
        const games = gamesOf(d.id, d.data());
        if (d.id === LB.uid) LB.myGames = games;
        all.push(...games);
      }
      LB.rows = all.sort((a, b) => b.score - a.score || a.at - b.at);
      renderBoard(); if (G.screen === 'over') showSaveArea();
    }, () => { LB.ready = false; renderBoard(); });
  } catch { return initLocalBoard(); }
  renderBoard();
}
/* --- local mode: no server. Your games are saved in this browser and ranked against the made-up rivals in CONFIG. --- */
const LOCAL_KEY = 'babysitter-local-games';
function initLocalBoard() { LB.mode = 'local'; LB.uid = 'me'; LB.ready = true; loadLocalBoard(); }
function loadLocalBoard() {
  const mine = gamesOf('me', { games: store.get(LOCAL_KEY) || [] });
  const rivals = CONFIG.rivals.map((r, i) => ({ ...cleanGame('rival' + i, { ...r, at: i }), key: 'rival' + i, rival: true }));
  LB.myGames = mine;
  LB.rows = [...mine, ...rivals].sort((a, b) => b.score - a.score || a.at - b.at);
  renderBoard(); if (G.screen === 'over') showSaveArea();
}
function nextRival(score) {   // the weakest rival still ahead of this score
  return CONFIG.rivals.filter(r => r.score > score).sort((a, b) => a.score - b.score)[0] || null;
}
/* --- web mode: a Supabase table, read and written with plain fetch. No sign-in; each browser gets a random player id. --- */
function webHeaders(extra = {}) {
  const k = CONFIG.onlineBoard.anonKey;
  // Legacy anon keys are JWTs and also go in Authorization; new sb_publishable_ keys only need apikey.
  const h = { apikey: k, ...extra };
  if (k.startsWith('eyJ')) h.Authorization = 'Bearer ' + k;
  return h;
}
const webUrl = q => CONFIG.onlineBoard.url.replace(/\/$/, '') + '/rest/v1/scores' + q;
const totalFrom = res => Number((res.headers.get('content-range') || '').split('/')[1]) || 0;
function initWebBoard() {
  let id = store.get('babysitter-player');
  if (!id) { id = 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('babysitter-player', id); }
  LB.uid = id; LB.mode = 'web'; LB.ready = true;
  return loadWebBoard();
}
async function loadWebBoard() {
  try {
    const res = await fetch(webUrl('?select=id,player,name,score,nights,days,won,zh,created_at&order=score.desc,created_at.asc&limit=100'),
      { headers: webHeaders({ Prefer: 'count=exact' }) });
    if (!res.ok) throw new Error(res.status);
    const rows = await res.json();
    LB.total = totalFrom(res) || rows.length;
    LB.rows = rows.map(r => ({ ...cleanGame(r.player, { ...r, at: Date.parse(r.created_at) }), key: 'w' + r.id }));
    LB.myGames = LB.rows.filter(r => r.id === LB.uid);
    LB.offline = false;
  } catch { LB.offline = true; }
  renderBoard(); if (G.screen === 'over') showSaveArea();
}
async function webRank(score) {   // how many saved games beat this score, across the whole table
  try {
    const res = await fetch(webUrl(`?select=id&score=gt.${Math.floor(score)}`), { headers: webHeaders({ Prefer: 'count=exact', Range: '0-0' }) });
    const all = await fetch(webUrl('?select=id'), { headers: webHeaders({ Prefer: 'count=exact', Range: '0-0' }) });
    return { rank: totalFrom(res) + 1, total: totalFrom(all) };
  } catch { return null; }
}
function cleanGame(id, g = {}) {   // shared data is other people's input: coerce every field
  return { id, name: String(g.name || 'Anonymous').slice(0, 14), score: Math.max(0, Number(g.score) || 0),
           nights: Number(g.nights) || 0, days: Number(g.days) || 0, won: g.won === true, zh: g.zh === true, at: Number(g.at) || 0, key: id + ':' + (Number(g.at) || 0) };
}
function gamesOf(id, d = {}) {
  if (Array.isArray(d.games)) return d.games.slice(0, 100).map(g => cleanGame(id, g));
  return d.score != null ? [cleanGame(id, d)] : [];      // older single-score format
}
function rankOf(score, savedKey) {
  const others = LB.rows.filter(r => r.key !== savedKey);
  return { rank: others.filter(r => r.score > score).length + 1, total: others.length + 1 };
}
function showSaveArea() {
  const line = $('rankLine');
  // the name box shows after every game, so each player can type their own name
  $('saveForm').hidden = false;
  const canSave = LB.ready && LB.uid && !LB.writeBlocked;
  $('btnSave').hidden = !canSave;
  $('nick').disabled = G.saved;
  $('btnSave').textContent = G.saved ? 'Saved' : 'Save score';
  $('btnSave').disabled = G.saved;
  if (!canSave) {
    line.textContent = LB.writeBlocked ? 'You can view the leaderboard, but only invited players can post scores.' : '';
    return;
  }
  const say = (rank, total) => {
    line.textContent = MOBILE
      ? (G.saved ? `You're #${rank} of ${total}!` : `#${rank} of ${total} · save to join`)
      : G.saved
      ? `You're the #${rank} babysitter out of ${total}.`
      : `This game ranks #${rank} out of ${total}. Save it to join the board.`;
  };
  if (LB.mode === 'web') {
    const ask = G.score, saved = G.saved;
    webRank(ask).then(r => { if (r && G.score === ask && G.saved === saved) say(r.rank, saved ? r.total : r.total + 1); });
    return;
  }
  const { rank, total } = rankOf(G.score, G.saved ? LB.lastKey : null);
  say(rank, total);
}
async function saveScore() {
  if (!LB.ready || !LB.uid || G.saving || G.saved) return;
  const name = $('nick').value.trim().replace(/\s+/g, ' ').slice(0, 14) || 'Anonymous';
  store.set('babysitter-nick', name);
  const game = { name, score: G.score, nights: G.stats.nights, days: G.stats.days, won: !!G.won, zh: ZH.on, at: Date.now() };
  // keep this player's best games (plus the new one), newest name on each
  const games = [...LB.myGames.map(({ name, score, nights, days, won, zh, at }) => ({ name, score, nights, days, won, zh, at })), game]
    .sort((a, b) => b.score - a.score).slice(0, KEEP_PER_PLAYER);
  G.saving = true; $('btnSave').disabled = true;
  if (LB.mode === 'local') {
    store.set(LOCAL_KEY, games);
    LB.lastKey = 'me:' + game.at; G.saved = true; G.saving = false;
    loadLocalBoard(); showSaveArea();
    return;
  }
  if (LB.mode === 'web') {
    try {
      const res = await fetch(webUrl(''), { method: 'POST', headers: webHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify({ player: LB.uid, name, score: G.score, nights: G.stats.nights, days: G.stats.days, won: !!G.won, zh: ZH.on }) });
      if (!res.ok) throw new Error(res.status);
      const [row] = await res.json();
      LB.lastKey = 'w' + row.id; G.saved = true;
      await loadWebBoard();
    } catch { $('rankLine').textContent = 'Could not save right now. Check your connection and try again.'; }
    G.saving = false; $('btnSave').disabled = G.saved;
    showSaveArea(); renderBoard();
    return;
  }
  try {
    await LB.db.doc('scores/' + LB.uid).set({ games, best: games[0].score, at: game.at });
    LB.myGames = games.map(g => cleanGame(LB.uid, g));
    LB.lastKey = LB.uid + ':' + game.at; G.saved = true;
  } catch (err) {
    if (err?.code === 'invalid_argument') LB.writeBlocked = true;
    else $('rankLine').textContent = 'Could not save right now. Try again in a moment.';
  }
  G.saving = false;
  showSaveArea(); renderBoard();
}
function renderBoard() {
  const list = $('boardList'); list.replaceChildren();
  const note = $('boardNote');
  if (!LB.ready) { note.textContent = 'The online leaderboard is not set up for this copy of the game.'; return; }
  if (LB.offline && !LB.rows.length) { note.textContent = 'Could not reach the leaderboard. Check your connection.'; return; }
  if (!LB.rows.length) { note.textContent = 'No scores yet. Be the first babysitter on the board.'; return; }
  LB.rows.slice(0, 10).forEach((r, i) => {
    const li = document.createElement('li'); if (r.key === LB.lastKey) li.className = 'me'; else if (r.rival) li.className = 'rival';
    const cell = (cls, txt) => { const s = document.createElement('span'); s.className = cls; s.textContent = txt; li.append(s); };
    cell('r', '#' + (i + 1)); cell('n', r.name); cell('d', (r.rival ? 'Rival · ' : '') + (r.zh ? '注音 · ' : '') + (r.won ? '★ First week' : `${r.nights}N · ${r.days}D`)); cell('s', r.score.toLocaleString('en-US'));
    list.append(li);
  });
  const last = LB.rows.findIndex(r => r.key === LB.lastKey);
  const count = LB.mode === 'web' ? LB.total : LB.rows.length;
  note.textContent = last >= 10 ? `Your last game is #${last + 1} of ${count}.` : `${count} game${count === 1 ? '' : 's'} on the board.`;
  if (LB.mode === 'local') note.textContent = (last >= 10 ? `Your last game is #${last + 1}. ` : '') + 'Scores are saved on this device. Rivals are made-up babysitters to beat.';
}
function openBoard(from) { G.boardFrom = from; if (LB.mode === 'web') loadWebBoard(); renderBoard(); show('scrBoard'); $('btnBoardBack').focus({ preventScroll: true }); }

/* ---------- main loop ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (G.screen === 'play') step(dt);
  if (MOBILE && now - (pad.at || 0) > 120) { pad.at = now; updatePad(); }
  if (G.screen === 'title') titleIdle(now / 1000);
  if (G.screen === 'ending') stepEnding(dt);
  stepFx(dt);
  requestAnimationFrame(frame);
}
function step(dt) {
  const night = G.mode === 'night', cfg = CONFIG[G.mode];
  G.t += dt;
  G.spawnT -= dt;
  if (G.spawnT <= 0) {
    spawn();
    const prog = Math.min(1, G.t / cfg.seconds);
    const every = cfg.spawnEvery + (cfg.spawnEveryEnd - cfg.spawnEvery) * prog;   // more pests as time goes on
    G.spawnT = Math.max(CONFIG.minSpawnEvery, every * CONFIG.ramp.spawn ** (G.cycle - 1)) * rand(0.75, 1.25);
  }

  let anyDanger = false;
  for (const e of [...G.ents]) {
    const sp = e.sp;
    const dx = BABY.x - e.x, dy = BABY.y - e.y, d = Math.hypot(dx, dy);
    const ux = dx / d, uy = dy / d;
    e.phase += dt * (night ? 3.2 : 2) * (sp?.wobble || 1);
    let inRing, reached = false;
    if (sp?.cross) {                                  // trucks drive past; they never reach the crib
      e.x += e.dir * e.speed * dt; e.y = e.baseY + Math.sin(e.phase * 2) * 3;
      if (sp.drain) G.happy -= sp.drain * dt;         // the garbage truck's song
      if (sp.emit && (e.emitT -= dt) <= 0) {          // ice cream truck lets kids out
        e.emitT = sp.emit.every;
        makeEnt([pickWord(sv(CONFIG.day.kid, 'sounds')[0])], e.x, e.y + 40, CONFIG.day.kid);
      }
      if (e.x < -120 || e.x > 1080) { removeEnt(e); continue; }
      inRing = false;
    } else if (sp?.floor) {                           // roach and mouse run along the floor
      let spd = e.speed;
      if (sp.sniff && (e.sniffT -= dt) <= 0) { e.sniffing = !e.sniffing; e.sniffT = e.sniffing ? rand(0.6, 1.1) : rand(1.2, 2.2); }
      if (e.sniffing) spd *= 0.05;
      if (sp.panic && G.target === e) spd = e.speed * sp.panic;   // locked on: it panics
      e.dir = e.x < 482 ? 1 : -1;
      e.x += e.dir * spd * dt;
      e.y = 540 - Math.abs(Math.sin(e.phase * 3)) * (e.sniffing ? 1 : 3);
      inRing = Math.abs(e.x - 482) < 260;
      reached = Math.abs(e.x - 482) < 165;
    } else {
      let spd = e.speed;
      if (sp?.stopGo) spd *= Math.sin(e.phase * 0.9) > 0.2 ? 2.4 : 0.12;   // fly: hover, then dart
      const wob = Math.sin(e.phase) * (night ? 38 : 14) * (sp?.wobble || 1);
      e.x += (ux * spd - uy * wob) * dt;
      e.y += (uy * spd + ux * wob) * dt;
      inRing = ((e.x - 480) / 180) ** 2 + ((e.y - 455) / 125) ** 2 < 1;
      reached = Math.hypot(BABY.x - e.x, BABY.y - e.y) < 42;
    }
    if (sp?.aura && (e.auraT -= dt) <= 0) {           // mail carrier keeps ringing
      e.auraT = sp.aura.every; G.happy -= sp.aura.cost;
      popup(e.x, e.y - 50, `${sp.aura.label} -${sp.aura.cost}%`, '#e2453c'); sound.tone(1320, 0.12, 'triangle', 0.04);
    }
    if (inRing !== e.danger) { e.danger = inRing; renderWord(e); if (inRing) sound.whimper(); }
    anyDanger ||= inRing;
    if (night) {
      if (sp?.floor) e.body.setAttribute('transform', `scale(${e.dir * e.sc} ${e.sc})`);
      else {
        const ang = Math.atan2(uy, ux) * 180 / Math.PI + 90 + Math.sin(e.phase * 2) * 10;
        e.body.setAttribute('transform', `rotate(${ang.toFixed(1)}) scale(${e.sc})`);
      }
      if (e.sp?.blink) {   // shadow mosquito: its buzz fades in and out until you lock on
        const vis = G.target === e ? 1 : 0.06 + 0.94 * Math.max(0, Math.sin(G.t * 1.7 + e.phase * 0.2));
        e.text.setAttribute('opacity', vis.toFixed(2)); e.sub?.setAttribute('opacity', vis.toFixed(2)); e.body.setAttribute('opacity', (0.45 + vis * 0.55).toFixed(2));
      }
    } else {
      e.waves.setAttribute('transform', `rotate(${(Math.atan2(uy, ux) * 180 / Math.PI).toFixed(1)}) translate(${26 + e.word.length * 5} 0)`);
    }
    if (!night) e.icon.setAttribute('transform', sp?.cross
      ? `translate(0 ${e.iconY}) scale(${e.dir * e.sc} ${e.sc})`
      : `translate(0 ${e.iconY}) rotate(${(Math.sin(e.phase * 3) * 8).toFixed(1)}) scale(${e.sc})`);
    e.g.setAttribute('transform', `translate(${e.x.toFixed(1)} ${e.y.toFixed(1)})`);

    if (reached) {
      sound.hurt(); shakeBaby();
      if (night) { G.sleep -= cfg.biteCost; popup(560, 236, `-${cfg.biteCost}%`, '#e2453c'); }
      else { G.happy -= cfg.hitCost; popup(560, 236, `-${cfg.hitCost}%`, '#e2453c'); }
      removeEnt(e);
    }
  }

  if (night) {
    G.sleep += (anyDanger ? -cfg.drainPerSec : cfg.recoverPerSec) * dt;
    G.sleep = Math.min(100, G.sleep);
    setFace(anyDanger || G.sleep < 40 ? 'fuss' : 'sleep');
    $('dangerRing').setAttribute('opacity', anyDanger ? 0.85 : 0.45);
    drawHud();
    if (G.sleep <= 0) { G.sleep = 0; drawHud(); return endMode(false); }
    if (G.t >= cfg.seconds) return endMode(true);
  } else {
    if (anyDanger) G.happy -= cfg.drainPerSec * dt;
    G.happy = Math.max(0, Math.min(100, G.happy));
    setFace(G.happy >= 75 ? 'laugh' : G.happy >= 50 ? 'smile' : G.happy >= 25 ? 'sob' : 'cry');
    $('dangerRing').setAttribute('opacity', anyDanger ? 0.85 : 0.45);
    drawHud();
    if (G.happy <= 0) return endMode(false);
    if (G.t >= cfg.seconds) return endMode(true);
  }
}
function stepFx(dt) {
  for (const f of [...G.fx]) {
    f.life -= dt;
    const k = 1 - f.life / f.max;
    if (f.kind === 'confetti') {
      f.vy += 600 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.spin * dt;
      f.g.setAttribute('transform', `translate(${f.x.toFixed(1)} ${f.y.toFixed(1)}) rotate(${f.rot.toFixed(0)})`);
      f.g.setAttribute('opacity', Math.min(1, f.life).toFixed(2));
    } else if (f.kind === 'burst') {
      const s = k < 0.25 ? 0.6 + k * 2.4 : 1.2 - (k - 0.25) * 0.4;
      f.g.setAttribute('transform', `translate(${f.x} ${f.y}) rotate(${f.rot}) scale(${s.toFixed(3)})`);
      f.g.setAttribute('opacity', Math.max(0, f.life / f.max * 1.6).toFixed(2));
    } else {
      f.g.setAttribute('transform', `translate(${f.x} ${(f.y - k * 30).toFixed(1)})`);
      f.g.setAttribute('opacity', Math.max(0, 1 - k * k).toFixed(2));
    }
    if (f.life <= 0) { f.g.remove(); G.fx = G.fx.filter(x => x !== f); }
  }
}

/* Title screen: two mosquitoes circle the crib while the baby sleeps */
const idle = [];
function titleIdle(t) {
  if (!idle.length) {
    for (const [cx, cy, rx, ry, sp, word] of [[230, 330, 110, 60, 0.7, 'bzz'], [740, 320, 120, 55, -0.6, 'hmm']]) {
      const g = el('g', {}, $('ents')), b = el('g', {}, g); el('use', { href: '#mosq' }, b);
      const tx = el('text', { y: 42, 'font-size': 18, 'text-anchor': 'middle', fill: '#f5f1e8' }, g); tx.textContent = word;
      idle.push({ g, b, cx, cy, rx, ry, sp });
    }
  }
  for (const m of idle) {
    m.g.setAttribute('display', G.screen === 'title' ? 'inline' : 'none');
    const a = t * m.sp, x = m.cx + Math.cos(a) * m.rx, y = m.cy + Math.sin(a * 2) * m.ry;
    const vx = -Math.sin(a) * m.rx * m.sp, vy = Math.cos(a * 2) * 2 * m.ry * m.sp;
    m.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    m.b.setAttribute('transform', `rotate(${(Math.atan2(vy, vx) * 180 / Math.PI + 90).toFixed(1)})`);
  }
}
function hideIdle() { idle.forEach(m => m.g.setAttribute('display', 'none')); }

/* ---------- input ---------- */
function focusKb() {
  if (MOBILE) return;   // phone mode has its own keyboard
  // On touch devices, a focused hidden input brings up the on-screen keyboard.
  if (matchMedia('(pointer: coarse)').matches) $('kb').focus({ preventScroll: true });
}
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target === $('nick')) return;   // typing a name, not playing
  if (G.screen === 'board' || !$('scrBoard').hidden) { if (e.key === 'Escape') { e.preventDefault(); show(G.boardFrom); } return; }
  if (e.key === 'Escape') { e.preventDefault(); if (G.screen === 'play') pause(true); else if (G.screen === 'pause') pause(false); return; }
  if (G.screen === 'title' && e.key === 'Enter') { e.preventDefault(); hideIdle(); return newGame(); }
  if (G.screen === 'over' && e.key === 'Enter') { e.preventDefault(); return newGame(); }
  if (G.screen !== 'play') return;
  if (e.key === 'Backspace') { e.preventDefault(); return releaseTarget(); }
  // Read the physical key position, so it works whether the player's input method is English or Zhuyin
  const k = physicalKey(e);
  if (k && (ZH.on ? /^[a-z0-9\-;,./ ]$/.test(k) : /^[a-z]$/.test(k))) { e.preventDefault(); typeChar(k); return; }
  if (e.key === 'Process' || e.isComposing) imeWarn();
});
$('kb').addEventListener('input', e => {
  const v = e.target.value; e.target.value = '';
  for (const raw of v) {   // phone keyboards may send Zhuyin symbols themselves
    const ch = ZY_KEY[raw] || raw.toLowerCase();
    if (ZH.on ? /[a-z0-9\-;,./ ]/.test(ch) : /[a-z]/.test(ch)) typeChar(ch);
  }
});
$('stage').addEventListener('pointerdown', () => { if (G.screen === 'play') focusKb(); });
const CODE_KEY = { Minus: '-', Semicolon: ';', Comma: ',', Period: '.', Slash: '/', Space: ' ' };
function physicalKey(e) {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (CODE_KEY[e.code]) return CODE_KEY[e.code];
  if (ZY_KEY[e.key]) return ZY_KEY[e.key];               // a Zhuyin symbol typed directly
  return e.key.length === 1 ? e.key.toLowerCase() : null;
}
let imeWarnAt = 0;
function imeWarn() {   // a Chinese input method swallows the keys
  if (G.screen !== 'play' || performance.now() - imeWarnAt < 2500) return;
  imeWarnAt = performance.now(); popup(480, 180, 'Switch to English input', '#e2453c');
}
/* ---------- the game's own keyboard (phone mode) ---------- */
const PAD_EN = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const PAD_ZH = ['1234567890-', 'qwertyuiop', 'asdfghjkl;', 'zxcvbnm,./'];
const KEY_ZY = Object.fromEntries(Object.entries(ZY_KEY).map(([sym, k]) => [k, sym]));
const pad = { keys: {}, built: null, lastHint: '' };
function buildPad() {
  const zh = ZH.on, mode = zh ? 'zh' : 'en';
  if (pad.built === mode) return;
  pad.built = mode; pad.keys = {}; pad.lastHint = '';
  const box = $('pad'); box.replaceChildren(); box.classList.toggle('zh', zh);
  const key = (k, label, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pad-key ' + cls; b.textContent = label; b.dataset.k = k;
    pad.keys[k] = b; return b;
  };
  for (const row of zh ? PAD_ZH : PAD_EN) {
    const r = document.createElement('div'); r.className = 'pad-row';
    for (const k of row) r.append(key(k, zh ? KEY_ZY[k] || k : k));
    box.append(r);
  }
  const last = document.createElement('div'); last.className = 'pad-row';
  if (zh) last.append(key(' ', 'space · 一聲', 'wide'));
  last.append(key('back', '⌫ let go', 'wide'));
  box.append(last);
}
function padPress(k, btn) {
  unlockAudio();
  btn.classList.add('down'); setTimeout(() => btn.classList.remove('down'), 90);
  if (G.screen !== 'play') return;
  if (k === 'back') releaseTarget(); else typeChar(k);
  navigator.vibrate?.(8);
  updatePad();
}
$('pad').addEventListener('pointerdown', e => {
  const b = e.target.closest('.pad-key'); if (!b) return;
  e.preventDefault(); padPress(b.dataset.k, b);
});
function updatePad() {   // the next key of the locked pest lights up; first keys of other pests glow softly
  if (!MOBILE) return;
  buildPad();
  let hint = '', soft = new Set();
  if (G.screen === 'play') {
    if (G.target) hint = G.target.word[G.target.typed] || '';
    else for (const e of G.ents) if (e.x > 205 && e.x < 755 && e.y > 0) soft.add(e.word[0]);
  }
  const sig = hint + '|' + [...soft].sort().join('');
  if (sig === pad.lastHint) return;
  pad.lastHint = sig;
  for (const [k, b] of Object.entries(pad.keys)) { b.classList.toggle('hint', k === hint); b.classList.toggle('soft', !hint && soft.has(k)); }
}

['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { music.start(); clips.get('cryData'); clips.get('popData'); clips.get('slapData'); }, { once: true }));
// Phones only allow sound after a real tap (iPhone counts touchend and click, not touchstart), so keep trying until it runs.
try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}   // iPhone: play even when the ring switch is on silent
function unlockAudio() {
  if (!sound.on) return;
  sound.init(); if (!sound.ctx) return;
  if (sound.ctx.state !== 'running') sound.ctx.resume().catch(() => {});
  music.start(); clips.get('popData'); clips.get('slapData'); clips.get('cryData');
}
['touchend', 'click', 'pointerup', 'keydown'].forEach(ev => document.addEventListener(ev, unlockAudio, { passive: true }));
$('btnZhuyin').addEventListener('click', () => setZhuyin(!ZH.on));
$('btnStart').addEventListener('click', () => { hideIdle(); newGame(); });
$('btnAgain').addEventListener('click', newGame);
$('btnBoard1').addEventListener('click', () => openBoard('scrTitle'));
$('btnBoard2').addEventListener('click', () => openBoard('scrOver'));
$('btnBoardBack').addEventListener('click', () => show(G.boardFrom));
$('nick').addEventListener('input', updateCertName);
$('saveForm').addEventListener('submit', e => { e.preventDefault(); saveScore(); });
$('btnResume').addEventListener('click', () => pause(false));
$('btnPause').addEventListener('click', () => pause(true));
$('btnHome1').addEventListener('click', goTitle);
$('btnHome2').addEventListener('click', goTitle);
$('btnMute').addEventListener('click', () => {
  sound.on = !sound.on; sound.init(); music.start(); music.mood(music.cur);
  $('btnMute').textContent = sound.on ? 'Sound on' : 'Sound off';
  $('btnMute').setAttribute('aria-pressed', String(!sound.on));
  store.set('babysitter-sound', sound.on);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });

/* ---------- boot ---------- */
(function boot() {
  if (MOBILE) {
    document.body.classList.add('mobile');
    $('scene').setAttribute('viewBox', '205 0 550 600');   // portrait crop around the crib
    buildPad();
  }
  const s = store.get('babysitter-sound');
  if (s === false) { sound.on = false; $('btnMute').textContent = 'Sound off'; $('btnMute').setAttribute('aria-pressed', 'true'); }
  setZhuyin(false);   // every visit starts in English; players switch Zhuyin on from the homepage
  goTitle();
  initBoard();
  // Music starts on the title screen. Browsers keep sound paused until the first click or key press,
  // so until then the hint under the buttons asks for one.
  // (waits for the whole page: the single-file build keeps its audio in tags after this script)
  const startMusic = () => { if (sound.on) { sound.init(); music.start(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startMusic); else startMusic();
  const hint = () => {
    const waiting = sound.on && sound.ctx && sound.ctx.state !== 'running';
    if (MOBILE) { $('titleHint').textContent = waiting ? 'Tap for sound' : ''; return; }
    $('titleHint').textContent = waiting ? 'Keyboard needed · Click anywhere for music' : 'Keyboard needed';
  };
  hint(); document.addEventListener('DOMContentLoaded', () => { hint(); sound.ctx?.addEventListener('statechange', hint); });
  requestAnimationFrame(frame);
})();
