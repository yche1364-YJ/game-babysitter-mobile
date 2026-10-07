/* =========================================================
   BABYSITTER — game settings. Change these to tune the game.
   ========================================================= */
const CONFIG = {
  night: {
    seconds: 45,            // real seconds a night lasts (12:00 AM -> 6:00 AM)
    startHour: 0, endHour: 6,
    sleepStart: 100,        // % asleep at the start of the night
    biteCost: 10,           // % lost when a mosquito reaches the baby
    typoCost: 2,            // % lost per wrong key
    drainPerSec: 4,         // % lost per second while a mosquito is inside the red ring
    recoverPerSec: 1,       // % regained per second while the ring is clear
    // Words shown in the ring, from most asleep (100%) down to awake (0%)
    levels: [[80, 'Deep sleep'], [60, 'Asleep'], [40, 'Restless'], [20, 'Stirring'], [0, 'Waking!']],
    // A new kind of mosquito joins every night from night 2 on ("from" = night number).
    specials: [
      { id: 'tiger', from: 2, chance: 0.2, name: 'Tiger mosquito', info: 'Big and slow. Takes two buzzes to swat.', words: 2, sounds: [['buzz'], ['buzzz']], speed: 0.6, scale: 1.5, sprite: '#mosqTiger' },
      { id: 'zippy', from: 3, chance: 0.22, name: 'Zippy mosquito', info: 'Tiny and fast. Swat it before it zips in.', sounds: [['zip'], ['zipzip']], speed: 2.1, scale: 0.7, wobble: 1.8 },
      { id: 'shadow', from: 4, chance: 0.2, name: 'Shadow mosquito', info: 'Its buzz fades in and out. Remember it.', blink: true, sounds: [['eee'], ['eeee']] },
      { id: 'fly', from: 5, chance: 0.2, name: 'Fly', info: 'Hovers, then darts. Hard to time.', sounds: [['vzz'], ['vzzt']], sprite: '#fly', stopGo: true, scale: 1.1 },
      { id: 'roach', from: 6, chance: 0.18, name: 'Cockroach', info: 'Scurries in along the floor, two at a time.', sounds: [['tik'], ['tiktik']], sprite: '#roach', floor: true, pair: true, speed: 1.4, scale: 1.1 },
      { id: 'mouse', from: 7, chance: 0.18, name: 'Mouse', info: 'Stops to sniff. Lock on and it panics and runs.', sounds: [['eek'], ['squeak']], sprite: '#mouse', floor: true, sniff: true, panic: 1.8, scale: 1.2 },
    ],
    // Mosquitoes get more frequent as the night goes on (start -> end of the night):
    spawnEvery: 1.6,        // seconds between mosquitoes at 12:00 AM
    spawnEveryEnd: 0.6,     // seconds between mosquitoes near 6:00 AM
    maxOnScreen: 4,         // how many can be on screen at the start
    maxOnScreenEnd: 10,     // ...and near the end
    speed: 34,              // mosquito speed in px/s (first night)
    // Mosquito buzzes: short ones on early nights, longer ones later
    words: [['bzz', 'zzz', 'hmm', 'zing'], ['bzz', 'zzz', 'hmm', 'zing', 'bzzt'], ['bzzz', 'zzzz', 'hmmm', 'zingzing', 'bzzt']],
    // From night 2, some mosquitoes talk instead (shown in a speech bubble)
    talk: {
      from: 2, chance: 0.33,
      lines: [['bite', 'itch', 'boo', 'yum'], ['wakeup', 'snack', 'tickle', 'hungry'], ['wakeup', 'peekaboo', 'playtime', 'getup', 'snack']],
    },
  },
  day: {
    seconds: 40,            // real seconds a day lasts (9:00 AM -> 12:00 PM). Keep the baby happy until noon.
    startHour: 9, endHour: 12,
    happyStart: 100,        // the baby starts the day laughing (100% happy)
    healPerNoise: 3,        // % regained per noise stopped
    hitCost: 10,            // % lost when a noise reaches the baby
    drainPerSec: 3,         // % lost per second while a noise is inside the red ring
    typoCost: 2,            // % lost per wrong key
    levels: [[80, 'Giggling'], [60, 'Happy'], [40, 'Fussy'], [20, 'Teary'], [0, 'Crying!']],
    // A new kind of noise joins every day from day 2 on ("from" = day number).
    specials: [
      { id: 'jackhammer', from: 2, chance: 0.16, name: 'Jackhammer', info: 'Three noises in a row before it stops.', chain: ['drrr', 'ratatat', 'bang'], icon: 'drill', speed: 0.5, scale: 1.5 },
      { id: 'dog', from: 3, chance: 0.2, name: "Neighbor's dog", info: 'Stop the bark and two puppies run out.', sounds: [['woof'], ['woof', 'grr']], icon: 'dog', scale: 1.2, puppies: ['yip', 'arf'] },
      { id: 'doorbell', from: 4, chance: 0.2, name: 'Doorbell', info: 'Rings right next to the crib. Be quick.', sounds: [['ding'], ['dingdong']], icon: 'bell', near: true, speed: 0.45 },
      { id: 'postman', from: 5, chance: 0.16, name: 'Mail carrier', info: 'Keeps ringing from far away. Every ring costs a little.', sounds: [['mail'], ['mail', 'parcel']], talk: true, icon: 'postman', speed: 0.55, scale: 1.3, aura: { every: 3, cost: 2, label: 'ring!' } },
      { id: 'garbage', from: 6, chance: 0.12, name: 'Garbage truck', info: 'Its song plays as it drives past. Stop it before it fades.', chain: ['dore', 'mifa', 'sola'], icon: 'garbage', cross: true, speed: 0.75, scale: 1.7, drain: 1.5 },
      { id: 'icecream', from: 7, chance: 0.12, name: 'Ice cream truck', info: 'Drives by and lets kids run out yelling.', chain: ['jingle', 'jangle'], icon: 'icecream', cross: true, speed: 0.9, scale: 1.7, emit: { every: 2.2 } },
    ],
    puppy: { id: 'puppy', icon: 'dog', scale: 0.7, speed: 1.4 },
    kid: { id: 'kid', icon: 'kid', scale: 0.8, speed: 1.2, talk: true, sounds: [['yay', 'yum', 'wee', 'icecream']] },
    spawnEvery: 1.5, spawnEveryEnd: 0.7,   // noises get more frequent as the day goes on
    maxOnScreen: 4, maxOnScreenEnd: 9,
    firstDayMax: 5,          // day 1 never has more than this many noises on screen
    speed: 34,
    words: [
      ['bang', 'beep', 'honk', 'woof', 'thud', 'ding', 'boom', 'arf'],
      ['drrr', 'clang', 'knock', 'vroom', 'whirr', 'crash', 'meow', 'bonk'],
      ['ratatat', 'screech', 'kaboom', 'rumble', 'clunk', 'drrrrr', 'honkhonk', 'clatter'],
    ],
    // Icon shown above each noise word (icons are drawn in the SVG <defs> as #ic-...)
    icons: {
      bang: 'hammer', thud: 'hammer', knock: 'hammer', bonk: 'hammer', clunk: 'hammer', clang: 'hammer',
      drrr: 'drill', whirr: 'drill', ratatat: 'drill', drrrrr: 'drill',
      honk: 'car', beep: 'car', vroom: 'car', screech: 'car', honkhonk: 'car', rumble: 'car',
      woof: 'dog', arf: 'dog', meow: 'cat', ding: 'bell',
      boom: 'speaker', kaboom: 'speaker', crash: 'bricks', clatter: 'bricks',
    },
  },
  // Each new night/day pair gets harder by these factors:
  ramp: { speed: 1.12, spawn: 0.86 },
  // Limits so the last rounds stay beatable (tuned so a very fast, accurate typist can just about finish)
  minSpawnEvery: 0.46,      // never spawn faster than this (seconds)
  maxOnScreenCap: 11,       // never more than this many pests at once
  transitionSeconds: 3,
  musicVolume: 1,           // 0 = silent, 1 = normal, 1.5 = louder
  cryVolume: 0.8,           // volume of the baby crying when you lose
  slapVolume: 0.35,         // volume of the SLAP! at night
  popVolume: 0.45,           // volume of the POW! bubble pop during the day
  finalDay: 7,
  // 注音模式: pests show Zhuyin, players type the keys of a standard Zhuyin keyboard (no tone mark = space)
  zhuyin: {
    words: {
      night: [['嗡', '嗞', '嘶', '咿', '唧'], ['嗡', '嗞', '嘶', '咿', '唧'], ['嗡嗡', '嗞嗞', '嘶嘶', '咿咿', '唧唧', '嗡嗞']],
      day: [
        ['吵', '砰', '叭', '喵', '汪', '咚'],
        ['叭叭', '汪汪', '咚咚', '敲敲', '嗶嗶', '叮咚'],
        ['轟隆', '吵鬧', '鑽', '響', '碰碰', '噹噹'],
      ],
    },
    talk: [['咬', '癢', '餓', '吵'], ['咬', '癢', '餓', '吵'], ['起床', '好餓', '咬你', '癢癢', '宵夜']],
    specials: {
      tiger: { sounds: [['嗡'], ['嗡嗡']] }, shadow: { sounds: [['嗚'], ['嗚嗚']] },
      zippy: { sounds: [['咻'], ['咻咻']] },
      jackhammer: { chain: ['鑽', '轟隆', '砰'] },
      dog: { sounds: [['汪'], ['汪汪']], puppies: ['嗚', '汪'] },
      doorbell: { sounds: [['叮'], ['叮咚']] },
      fly: { sounds: [['呼'], ['呼呼']] }, roach: { sounds: [['沙'], ['沙沙']] }, mouse: { sounds: [['吱'], ['吱吱']] },
      postman: { sounds: [['信'], ['包裹']] }, garbage: { chain: ['倒', '垃圾', '叮咚'] }, icecream: { chain: ['冰', '叮叮'] },
      kid: { sounds: [['哈', '耶', '冰淇淋']] },
    },
    icons: {
      吵: 'speaker', 吵鬧: 'speaker', 響: 'speaker', 砰: 'hammer', 咚: 'hammer', 咚咚: 'hammer', 敲敲: 'hammer', 碰碰: 'bricks',
      叭: 'car', 叭叭: 'car', 嗶嗶: 'car', 喵: 'cat', 汪: 'dog', 汪汪: 'dog', 吠: 'dog', 嗚: 'dog',
      叮: 'bell', 叮咚: 'bell', 噹噹: 'bell', 噹: 'bell', 鑽: 'drill', 轟隆: 'drill',
    },
  },              // survive this many nights and days to finish the game
  // Score: points per word stopped and per level survived, multiplied by the round number.
  points: { word: 10, level: 100 },
  // Online leaderboard for copies hosted outside Claude (e.g. GitHub Pages). Players never sign in.
  // Fill in your Supabase project's URL and its public "anon" key (see SUPABASE_SETUP.md). Leave empty to turn it off.
  onlineBoard: { url: '', anonKey: '' },
  // With no online board (e.g. GitHub Pages with onlineBoard left empty), scores are kept on this device
  // and these made-up babysitters sit on the board as rivals to race against.
  rivals: [
    { name: 'Big Sis Lulu',  score: 600,   nights: 1, days: 0 },
    { name: 'New Dad Ben',   score: 1500,  nights: 1, days: 1 },
    { name: 'Neighbor Amy',  score: 4000,  nights: 2, days: 2 },
    { name: 'Uncle Joe',     score: 9000,  nights: 3, days: 3 },
    { name: 'Nanny Rosa',    score: 16000, nights: 5, days: 4 },
    { name: 'Grandma Mei',   score: 27000, nights: 6, days: 5 },
    { name: 'Auntie Sky',    score: 45000, nights: 7, days: 7, won: true },
  ],
  // Titles earned by score (the highest one reached). Shown after every game and on the certificate.
  // Rough guide for a fast typist: 1,000 ≈ day 2, 4,000 ≈ day 3, 10,000 ≈ day 4, 20,000 ≈ day 5–6, 35,000 ≈ day 7.
  titles: [[0, 'Rookie Sitter'], [1000, 'Sleepy Helper'], [4000, 'Lullaby Pro'], [10000, 'Night Guardian'],
           [20000, 'Pro Babysitter'], [35000, 'Super Nanny']],
};
