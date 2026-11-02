'use strict';

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);
const isSharp = (m) => NOTE_NAMES[m % 12].length > 1;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
const $ = (id) => document.getElementById(id);
const vowelById = (id) => VOWELS.find((v) => v.id === id);
const presetById = (id) => PRESETS.find((p) => p.id === id);
const DAY = 86400000;

/* ---------- Einstellungen (localStorage) ---------- */

const STORE_KEY = 'vokaltrainer.v1';
const DEFAULT_SESSION = { preset: 'soft', zone: 'z2', minutes: 10, group: 'all', drone: false, warmup: true, pattern: 'slide' };
const DEFAULT_SETTINGS = { volume: 60, timbre: 'bright', deviceId: '', autoplay: true, introDone: false, livePitch: false, notation: 'both', exampleDe: false };
const MAX_LOG = 200;
let storageOk = true;

function defaultLevels() {
  const levels = {};
  PRESETS.forEach((p) => { levels[p.id] = { cry: p.cry, twang: p.twang }; });
  return levels;
}

function newProfile(name) {
  return {
    id: uid(), name, voice: 'tenor',
    zones: { z1: [...VOICES.tenor.z1], z2: [...VOICES.tenor.z2] },
    levels: defaultLevels(), overrides: {}, ratings: {}, log: [], songs: [], blind: [],
    session: { ...DEFAULT_SESSION },
  };
}

// Aeltere Daten bleiben erhalten, neue Felder bekommen Startwerte.
function upgradeProfile(p) {
  return {
    ...newProfile(p.name || 'Profil'), ...p,
    levels: { ...defaultLevels(), ...p.levels },
    session: { ...DEFAULT_SESSION, ...p.session },
    log: p.log || [],
    songs: p.songs || [],
    blind: p.blind || [],
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && Array.isArray(saved.profiles) && saved.profiles.length) {
      return { ...saved, profiles: saved.profiles.map(upgradeProfile), settings: { ...DEFAULT_SETTINGS, ...saved.settings } };
    }
  } catch (e) { storageOk = false; }
  const first = newProfile('Profil 1');
  return { profiles: [first, newProfile('Profil 2')], activeId: first.id, settings: { ...DEFAULT_SETTINGS } };
}

const state = loadState();
Sound.configure(state.settings);
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { storageOk = false; }
}
const profile = () => state.profiles.find((p) => p.id === state.activeId) || state.profiles[0];

/* ---------- Takes (IndexedDB) ---------- */

const MAX_TAKES = 8;
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('vokaltrainer', 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('takes')) d.createObjectStore('takes', { keyPath: 'id' }).createIndex('slot', 'slot');
        if (!d.objectStoreNames.contains('songAudio')) d.createObjectStore('songAudio', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const d = req.result;
        d.onclose = () => { dbPromise = null; };
        d.onversionchange = () => { d.close(); dbPromise = null; };
        resolve(d);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}
const asPromise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
// Safari kann die Verbindung im Hintergrund schliessen, ohne es zu melden. Dann einmal neu oeffnen.
async function dbStore(name, mode) {
  try {
    return (await db()).transaction(name, mode).objectStore(name);
  } catch (e) {
    dbPromise = null;
    return (await db()).transaction(name, mode).objectStore(name);
  }
}
async function takesFor(slot) {
  const rows = await asPromise((await dbStore('takes')).index('slot').getAll(slot));
  return rows.sort((a, b) => b.at - a.at);
}
async function putTake(take) {
  await asPromise((await dbStore('takes', 'readwrite')).put(take));
}
async function deleteTake(id) {
  await asPromise((await dbStore('takes', 'readwrite')).delete(id));
  Sound.forget(id);
}
async function allTakes() {
  return asPromise((await dbStore('takes')).getAll());
}
async function pruneTakes(slot) {
  const rows = (await takesFor(slot)).filter((t) => !t.isRef);
  for (const t of rows.slice(MAX_TAKES)) await deleteTake(t.id);
}

/* ---------- Matrix-Logik ---------- */

const cellKey = (vowelId, preset, zone) => `${vowelId}|${preset}|${zone}`;
function target(vowel, preset, zone) {
  const o = profile().overrides[cellKey(vowel.id, preset, zone)];
  return (o && o.to) || vowel.m[preset][zone === 'z1' ? 0 : 1];
}
function zoneNotes(zone) {
  const [lo, hi] = profile().zones[zone];
  const out = [];
  for (let m = lo; m <= hi; m++) out.push(m);
  return out;
}
const zoneLabel = (zone) => {
  const [lo, hi] = profile().zones[zone];
  return `${noteName(lo)}–${noteName(hi)}`;
};
const ZONE_NAMES = { z1: 'Passaggio', z2: 'Obere Zone' };
const vowelCount = (minutes) => Math.round(minutes / 2);

function noteRating(key, midi) {
  const r = profile().ratings[key];
  return r && r.notes ? r.notes[midi] : undefined;
}

// Der erste Ton der Zone, der noch nicht sitzt. Sitzen alle, bleibt es der hoechste.
function startNote(key, zone) {
  const notes = zoneNotes(zone);
  const open = notes.find((m) => {
    const n = noteRating(key, m);
    return !n || n.r !== 3;
  });
  return open === undefined ? notes[notes.length - 1] : open;
}

// Wartezeit bis zur naechsten Wiederholung: Kippt sofort, Geht nach einem Tag, Sitzt nach vier Tagen.
const DUE_DAYS = { 1: 0, 2: 1, 3: 4 };

function queueRank(v, preset, zone) {
  const key = cellKey(v.id, preset, zone);
  const r = profile().ratings[key];
  if (!r) return [0, 0, 0];
  const hasOpenNotes = zoneNotes(zone).some((m) => {
    const n = noteRating(key, m);
    return !n || n.r !== 3;
  });
  const climbing = r.r === 3 && hasOpenNotes;
  const waiting = !climbing && Date.now() - r.at < DUE_DAYS[r.r] * DAY ? 1 : 0;
  return [waiting, climbing ? 2.5 : r.r, r.at];
}

// Kippt zuerst, aber hoechstens die halbe Session, damit sie nicht nur aus Problemstellen besteht.
// Danach Faellige: unbewertet, Geht, Sitzt. Bei Gleichstand das am laengsten nicht Geuebte.
function buildQueue() {
  const { preset, zone, group, minutes } = profile().session;
  const count = vowelCount(minutes);
  const ranked = VOWELS
    .filter((v) => group === 'all' || v.group === group)
    .map((v, i) => ({ v, i, s: queueRank(v, preset, zone) }))
    .sort((a, b) => a.s[0] - b.s[0] || a.s[1] - b.s[1] || a.s[2] - b.s[2] || a.i - b.i);
  const hard = ranked.filter((x) => x.s[1] === 1);
  const rest = ranked.filter((x) => x.s[1] !== 1);
  const hardCount = Math.min(hard.length, Math.max(Math.ceil(count / 2), count - rest.length));
  return [...hard.slice(0, hardCount), ...rest.slice(0, count - hardCount)].map((x) => x.v.id);
}

function describeTarget(to) {
  const [sym, ...rest] = String(to).trim().split(/\s+/);
  const parts = [...sym].filter((c) => IPA[c]);
  if (!parts.length) return '';
  const wordsOnly = notation() === 'words';
  const named = parts.map((c) => (wordsOnly ? likeWord(c) : `${c} wie ${likeWord(c)}`));
  const main = named.length > 1 ? `Zwischen ${named.join(' und ')}` : `${wordsOnly ? 'Wie ' : ''}${named[0]}`;
  const tip = parts.length === 1 ? ` ${glossProse(IPA[parts[0]].tip)}.` : '';
  const extra = rest.map((w) => DESCRIPTORS[w]).filter(Boolean).join(' ');
  return `${main}.${tip}${extra ? ` ${extra}` : ''}`;
}

/* ---------- Vokaltrapez ---------- */

function chartPoint(sym) {
  const c = CHART[sym];
  return c ? [34 + c[0] * 252, 18 + c[1] * 150] : null;
}
function targetPoint(text) {
  const syms = [...String(text).split(' ')[0]].map(chartPoint).filter(Boolean);
  if (!syms.length) return null;
  const n = syms.length;
  return [syms.reduce((s, c) => s + c[0], 0) / n, syms.reduce((s, c) => s + c[1], 0) / n];
}
// Durchgezogen: Weg zur aktiven Zone. Gestrichelt: Gesamtweg ueber beide Zonen.
function chartSvg(vowel, preset, zone) {
  const to = target(vowel, preset, zone);
  const from = chartPoint(vowel.start);
  const end = targetPoint(to);
  const other = targetPoint(target(vowel, preset, zone === 'z1' ? 'z2' : 'z1'));
  const stops = (zone === 'z1' ? [from, end, other] : [from, other, end]).filter(Boolean);
  const path = stops.map((p) => p.join(',')).join(' ');
  const labels = Object.keys(CHART).map((s) => {
    const [x, y] = chartPoint(s);
    if (notation() === 'words') return `<circle cx="${x}" cy="${y}" r="${s === vowel.start ? 4 : 1.5}" class="${s === vowel.start ? 'ch-from-dot' : 'ch-dot'}"/>`;
    const cls = s === vowel.start ? 'ch-from' : 'ch-sym';
    return `<text x="${x}" y="${y + 4}" class="${cls}" text-anchor="middle">${s}</text>`;
  }).join('');
  const moved = end && Math.hypot(end[0] - from[0], end[1] - from[1]) > 6;
  const tags = notation() === 'ipa' ? '' : `${moved || !end ? chartTag(from, vowelExample(vowel), 'muted') : ''}${end && parseSound(to).known ? chartTag(end, soundWords(to), 'accent') : ''}`;
  let line = '';
  if (end && Math.hypot(end[0] - from[0], end[1] - from[1]) > 6) {
    const d = Math.hypot(end[0] - from[0], end[1] - from[1]);
    const ux = (end[0] - from[0]) / d;
    const uy = (end[1] - from[1]) / d;
    line = `<line x1="${from[0] + ux * 11}" y1="${from[1] + uy * 11}" x2="${end[0] - ux * 11}" y2="${end[1] - uy * 11}" class="ch-arrow" marker-end="url(#arrowhead)"/>`;
  }
  const ring = end ? `<circle cx="${end[0]}" cy="${end[1]}" r="11" class="ch-target"/>` : '';
  const dot = other ? `<circle cx="${other[0]}" cy="${other[1]}" r="8" class="ch-other"/>` : '';
  return `<svg class="chart" viewBox="0 0 320 190" role="img" aria-label="Vokaltrapez: von ${esc(vowel.ipa)} nach ${esc(to)}">
    <defs><marker id="arrowhead" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8Z" class="ch-head"/></marker></defs>
    <polygon points="34,18 286,18 286,168 117,168" class="ch-shape"/>
    <text x="50" y="12" class="ch-axis">vorn</text>
    <text x="286" y="12" class="ch-axis" text-anchor="end">hinten</text>
    <text x="4" y="22" class="ch-axis">zu</text>
    <text x="90" y="182" class="ch-axis">offen</text>
    <polyline points="${path}" class="ch-path"/>
    ${dot}${ring}${line}${labels}${tags}
  </svg>`;
}

// Beschriftung im Trapez: unter dem Punkt, damit oben die Achsen frei bleiben. Ganz unten rueckt sie darueber.
function chartTag([x, y], text, cls) {
  const anchor = x < 110 ? 'start' : x > 230 ? 'end' : 'middle';
  const ly = y > 150 ? y - 16 : y + 24;
  return `<text x="${x}" y="${ly}" text-anchor="${anchor}" class="ch-tag ${cls}">${esc(text)}</text>`;
}

function glideBar(vowel, to) {
  if (!vowel.glide) return '';
  const words = notation() !== 'ipa' && parseSound(to).known;
  const hold = words ? soundWords(to) : to.split(' ')[0];
  const end = words && IPA[vowel.glide] ? soundWord(vowel.glide) : vowel.glide;
  return `<div>
    <div class="glide" role="img" aria-label="Fast die ganze Note auf ${esc(hold)}, ${esc(end)} erst ganz am Ende">
      <span class="hold">${esc(hold)} halten</span><span class="end">${esc(end)}</span>
    </div>
  </div>`;
}

/* ---------- Ansichten ---------- */

const app = $('app');
let view = 'ueben';
let run = null;
let matrixZone = 'z2';
let historyZone = null;
let statusText = '';
let optionsOpen = false;
let timerId = null;

// Ein Knopf gleicher Aufgabe bekommt nach dem Neuaufbau den Fokus zurueck.
function focusSelector(el) {
  if (!el || el === document.body || !app.contains(el)) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.dataset.action) {
    const extra = Object.keys(el.dataset).filter((k) => k !== 'action')
      .map((k) => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join('');
    return `[data-action="${el.dataset.action}"]${extra}`;
  }
  if (el.name) return `input[name="${CSS.escape(el.name)}"][value="${CSS.escape(el.value)}"]`;
  return null;
}

function render() {
  const selector = focusSelector(document.activeElement);
  const nav = $('nav');
  const running = !!run && !run.finished;
  nav.hidden = !!run;
  document.body.classList.toggle('running', running);
  document.body.dataset.notation = notation();
  nav.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
  const sel = $('profile-select');
  sel.innerHTML = state.profiles.map((p) => `<option value="${p.id}"${p.id === state.activeId ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  sel.disabled = !!run;
  if (run) app.innerHTML = run.finished ? summaryView() : practiceView();
  else if (view === 'songs') app.innerHTML = songsView();
  else if (view === 'matrix') app.innerHTML = matrixView();
  else if (view === 'verlauf') app.innerHTML = historyView();
  else if (view === 'profil') { app.innerHTML = profileView(); fillStorageInfo(); }
  else app.innerHTML = setupView();
  if (running && run.phase !== 'warmup' && run.step < STEPS.length) {
    refreshTakes();
    updateRecUi();
  }
  if (!run && view === 'songs') afterSongsRender();
  syncPitch();
  if (!storageOk) app.insertAdjacentHTML('afterbegin', '<p class="banner">Dieser Browser-Modus speichert nichts dauerhaft. Öffne den Trainer in einem normalen Fenster.</p>');
  const next = selector && document.querySelector(selector);
  if (next) next.focus({ preventScroll: true });
}

function openDialog(html) {
  const dlg = $('dialog');
  dlg.innerHTML = html;
  if (!dlg.open) dlg.showModal();
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

function radios(name, items, value) {
  return `<div class="seg" role="radiogroup">${items.map((it) => `
    <label class="seg-item"><input type="radio" name="${name}" value="${it.value}"${String(it.value) === String(value) ? ' checked' : ''}><span>${esc(it.label)}</span></label>`).join('')}</div>`;
}

function setupView() {
  const p = profile();
  const s = p.session;
  const queue = buildQueue();
  const rated = VOWELS.filter((v) => p.ratings[cellKey(v.id, s.preset, s.zone)]).length;
  return `
  <section class="stack">
    <div class="intro">
      <h1>Ein Stil, die schwierigen Vokale zuerst</h1>
      <p class="muted">Wähle den Stil deines Songs. Der Trainer zeigt pro Vokal, wohin er sich in der Zone bewegt, und führt dich vom Sprechen bis zur Phrase.</p>
    </div>
    ${state.settings.introDone ? '' : `<div class="intro-card">
      <p><b>Erster Start:</b> Prüfe einmal Mikrofon und Kopfhörer. Das dauert eine Minute.</p>
      <div class="row">
        <button class="primary" data-action="check">Technik prüfen</button>
        <button class="ghost" data-action="intro-done">Ausblenden</button>
      </div>
    </div>`}
    <div>
      <h2 class="label">Song-Stil</h2>
      <div class="preset-grid">
        ${PRESETS.map((pr) => presetCard(pr, p, s.preset)).join('')}
      </div>
      <p class="small muted preset-detail">${glossProse(presetById(s.preset).direction)}. Etwa wie ${presetById(s.preset).examples}.</p>
    </div>
    <div class="setup-row">
      <div>
        <h2 class="label">Zone</h2>
        ${radios('s-zone', ['z1', 'z2'].map((z) => ({ value: z, label: `${ZONE_NAMES[z]} ${zoneLabel(z)}` })), s.zone)}
      </div>
      <div>
        <h2 class="label">Dauer</h2>
        ${radios('s-minutes', [5, 10, 15].map((m) => ({ value: m, label: `${m} Min.` })), s.minutes)}
      </div>
      <div>
        <h2 class="label"><label for="s-group">Auswahl</label></h2>
        <select id="s-group">${GROUPS.map((g) => `<option value="${g.id}"${g.id === s.group ? ' selected' : ''}>${g.name}</option>`).join('')}</select>
      </div>
    </div>
    <div class="queue-box">
      <div class="queue-head">
        <h2 class="label">Heute dran (${queue.length})</h2>
        <span class="muted small">${rated} von ${VOWELS.length} Vokalen in dieser Kombination bewertet</span>
      </div>
      ${notationControls('s')}
      <ul class="queue">
        ${queue.map((id) => {
    const v = vowelById(id);
    const r = p.ratings[cellKey(id, s.preset, s.zone)];
    return `<li>${vowelSymbol(v)}<span class="muted small">${vowelWord(v)}</span><span class="to">${soundHtml(target(v, s.preset, s.zone))}</span>${ratingMark(r)}</li>`;
  }).join('')}
      </ul>
    </div>
    <div class="start-bar">
      <button class="primary big" data-action="start"${queue.length ? '' : ' disabled'}>Session starten</button>
      <label class="check"><input type="checkbox" id="s-warmup"${s.warmup ? ' checked' : ''}> Mit Einsingen</label>
    </div>
  </section>`;
}

function meter(level, label) {
  return `<span class="meter" aria-label="${label}: ${LEVELS[level]}"><span class="small muted">${label}</span>${[0, 1, 2].map((i) => `<i class="${i <= level ? 'on' : ''}"></i>`).join('')}</span>`;
}

function presetCard(pr, p, active) {
  const lv = p.levels[pr.id];
  return `<label class="preset${pr.id === active ? ' active' : ''}">
    <input type="radio" name="s-preset" value="${pr.id}"${pr.id === active ? ' checked' : ''}>
    <strong>${pr.name}</strong>
    <span class="small muted">${pr.songs}</span>
    <span class="small muted preset-more">Etwa wie ${pr.examples}</span>
    <span class="small ipa-inline preset-more">${glossProse(pr.direction)}</span>
    <span class="meters">${meter(lv.cry, 'Cry')}${meter(lv.twang, 'Twang')}</span>
  </label>`;
}

function ratingMark(r) {
  if (!r) return '<span class="mark none" title="Noch nicht bewertet">·</span>';
  const def = RATINGS.find((x) => x.id === r.r);
  return `<span class="mark r${r.r}" title="${def.name}">${def.mark}</span>`;
}

/* --- Uebung --- */

const currentPattern = () => PATTERNS.find((x) => x.id === profile().session.pattern) || PATTERNS[0];

function refSeq(step, midi, vowel) {
  if (step === 'slide') {
    const pattern = currentPattern();
    if (!pattern.offsets) {
      return [{ from: midi - 5, to: midi - 5, dur: .8 }, { from: midi - 5, to: midi, dur: 2.6 }, { from: midi, to: midi, dur: 1.2 }];
    }
    return pattern.offsets.map((o, i) => ({
      from: midi + o, to: midi + o, attack: true,
      dur: i === pattern.top ? pattern.dur * 3 : pattern.dur,
    }));
  }
  if (step === 'word') return [{ from: midi, to: midi, dur: 3 }];
  if (step === 'phrase') {
    const spot = currentSpot();
    const count = spot && spot.line ? 5 : vowel.phrase.length;
    return [-7, -5, -3, -1, 0].slice(-count).map((o, i) => (
      { from: midi + o, to: midi + o, dur: i === count - 1 ? 2 : .55, attack: true }
    ));
  }
  return null;
}

function currentCell() {
  const vowel = vowelById(run.queue[run.index]);
  return { vowel, to: target(vowel, run.preset, run.zone), key: cellKey(vowel.id, run.preset, run.zone) };
}
const stepId = () => (STEPS[run.step] ? STEPS[run.step].id : null);
// Eine Song-Stelle hat eigene Takes, nutzt aber Zielvokal und Bewertung des Matrix-Felds.
const currentSpot = () => (run && run.spots ? run.spots[run.index] : null);
const slotFor = (key, step) => {
  const spot = currentSpot();
  return spot ? `${profile().id}|spot:${spot.id}|${step}` : `${profile().id}|${key}|${step}`;
};

// Song-Stellen lassen sich von bis zu drei Halbtoenen darunter an den echten Ton herantasten.
function runNotes() {
  const spot = currentSpot();
  if (!spot) return zoneNotes(run.zone);
  const top = sungMidi(run.song, spot);
  return [top - 3, top - 2, top - 1, top];
}

function enterSpot(spot) {
  run.midi = sungMidi(run.song, spot);
  run.zone = zoneFor(run.midi);
  run.word = spot.word;
}

function stepInstruction(vowel, to) {
  const word = `<b>${esc(run.word || vowel.word)}</b>`;
  const target = soundInline(to);
  const note = noteName(run.midi);
  switch (stepId()) {
    case 'spoken':
      return `Sprich ${word} normal. Zieh den Vokal dann langsam zu ${target}. Übertreibe erst und nimm so weit zurück, bis das Wort klar verständlich bleibt.`;
    case 'slide': {
      const pattern = currentPattern();
      const way = pattern.offsets ? `von ${noteName(run.midi + pattern.offsets[0])} bis ${note}` : `von ${noteName(run.midi - 5)} nach ${note}`;
      return `Singe ${word} ${way}. ${pattern.text} Wandle den Vokal unterwegs allmählich von ${vowelInline(vowel)} zu ${target}.`;
    }
    case 'word':
      return `Setze ${word} direkt auf ${note} an und halte den Ton. Der Zielvokal steht vom Einsatz an. Zur Probe: einmal mit Originalvokal, einmal modifiziert.`;
    default:
      if (currentSpot() && currentSpot().line) return `Singe die Textstelle so, wie sie im Song steht, mit ${word} auf ${note}. Dort steht der Zielvokal, davor singst du fast normal. Die Töne sind nur eine Annäherung.`;
      return `Singe die Phrase aufsteigend bis ${note}. Die letzte Silbe trägt den Zielvokal, davor singst du fast normal.`;
  }
}

function runBar(label) {
  const pr = presetById(run.preset);
  return `<div class="run-bar">
    <button class="ghost" data-action="end-run">Beenden</button>
    <span class="small muted run-label">${label} · ${pr.name}<span class="wide-only"> · ${ZONE_NAMES[run.zone]}</span></span>
    <span class="small tabular" id="elapsed">${clockText()}</span>
  </div>`;
}

function clockText() {
  const elapsed = Date.now() - run.startedAt;
  return run.minutes ? `${clock(elapsed)} / ${run.minutes}:00` : clock(elapsed);
}

function updateClock() {
  const el = $('elapsed');
  if (!el || !run) return;
  el.textContent = clockText();
  el.classList.toggle('over', !!run.minutes && Date.now() - run.startedAt >= run.minutes * 60000);
}

function warmupView() {
  return `
  <section class="practice stack">
    ${runBar('Einsingen')}
    <div class="intro">
      <h1>Einsingen</h1>
      <p class="muted">Etwa zwei Minuten, locker und ohne Druck. Spiele den Ton und folge ihm.</p>
    </div>
    <ul class="warm-list">
      ${WARMUP.map((w) => `<li><div><strong>${w.name}</strong><span class="small muted">${w.text}</span></div>
        <button class="secondary" data-action="warm-tone" data-id="${w.id}">Ton spielen</button></li>`).join('')}
    </ul>
    <p class="status small" id="status" aria-live="polite">${esc(statusText)}</p>
    <div class="row"><button class="primary big" data-action="warm-done">Zu den Vokalen</button></div>
  </section>`;
}

function practiceView() {
  if (run.phase === 'warmup') return warmupView();
  const { vowel, to, key } = currentCell();
  const p = profile();
  const lv = p.levels[run.preset];
  const override = p.overrides[key];
  const ratingStep = run.step >= STEPS.length;
  const plain = describeTarget(to);
  const spot = currentSpot();
  const words = spot ? [spot.word] : vowel.words;
  return `
  <section class="practice">
    ${runBar(spot ? `Stelle ${run.index + 1} von ${run.queue.length}: ${esc(run.song.title)}` : `Vokal ${run.index + 1} von ${run.queue.length}`)}
    <div class="practice-grid">
      <div class="target-panel target-head">
        <div class="target-line">
          ${bigSound(vowel.ipa, vowelExample(vowel, spot ? spot.word : vowel.word))}
          <span class="arrow" aria-hidden="true">→</span>
          ${bigSound(to, parseSound(to).known ? soundWords(to) : '', true)}
        </div>
        ${plain ? `<p class="target-plain">${plain}</p>` : ''}
        <div class="words">
          ${words.map((w) => `<button class="word${(run.word || vowel.word) === w ? ' active' : ''}" data-action="word" data-word="${esc(w)}">${esc(w)}</button>`).join('')}
        </div>
        <div class="row hear" role="group" aria-label="Hörbeispiele">
          <span class="small muted">Hören</span>
          <button class="ghost small" data-action="speak">Aussprache</button>
          <button class="ghost small" data-action="hear-target">Ziel</button>
          <button class="ghost small" data-action="hear-path">Weg</button>
        </div>
        ${exampleSwitch()}
      </div>
      <div class="work-panel">
        <ol class="stepper">
          ${STEPS.map((s, i) => `<li><button data-action="step" data-step="${i}" class="${i === run.step ? 'active' : i < run.step ? 'done' : ''}">${s.name}</button></li>`).join('')}
          <li><button data-action="step" data-step="${STEPS.length}" class="${ratingStep ? 'active' : ''}">Bewerten</button></li>
        </ol>
        ${ratingStep ? ratingPanel(vowel, key) : workPanel(vowel, to)}
      </div>
      <div class="target-panel target-detail">
        ${chartSvg(vowel, run.preset, run.zone)}
        ${glideBar(vowel, to)}
        <ul class="cues small">
          <li>${CRY_CUES[lv.cry]}</li>
          <li>${TWANG_CUES[lv.twang]}</li>
          <li>${glossProse(esc(vowel.note))}</li>
          <li>Bleibt unterscheidbar: ${vowel.pair}.</li>
          ${override && override.note ? `<li class="own"><b>Deine Notiz:</b> ${esc(override.note)}</li>` : ''}
        </ul>
        <div class="row"><button class="ghost small" data-action="help">Zeichen und Begriffe</button></div>
      </div>
    </div>
  </section>`;
}

function workPanel(vowel, to) {
  const step = stepId();
  const hasRef = step !== 'spoken';
  const key = cellKey(vowel.id, run.preset, run.zone);
  const s = profile().session;
  const pr = presetById(run.preset);
  const pattern = step === 'slide' ? radios('pattern', PATTERNS.map((x) => ({ value: x.id, label: x.name })), s.pattern) : '';
  const helpers = step === 'slide'
    ? `<div class="words"><span class="small muted">Starthilfe</span>${pr.helpers.map((h) => `<button class="word${run.word === h ? ' active' : ''}" data-action="word" data-word="${h}">${h}</button>`).join('')}</div>`
    : '';
  const spot = currentSpot();
  const syllables = `<p class="phrase">${vowel.phrase.map((syl, i) => (i === vowel.phrase.length - 1 ? `<b>${esc(syl)}</b>` : esc(syl))).join(' · ')}</p>`;
  const phrase = step === 'phrase' ? (spot && spot.line ? `<p class="phrase">${esc(spot.line)}</p>` : syllables) : '';
  const keys = hasRef
    ? `<div class="keys" role="group" aria-label="Zielton">${runNotes().map((m) => {
      const n = noteRating(key, m);
      return `<button class="key${isSharp(m) ? ' sharp' : ''}${m === run.midi ? ' active' : ''}" data-action="note" data-midi="${m}">${n ? ratingMark(n) : ''}<span>${noteName(m)}</span></button>`;
    }).join('')}</div>` : '';
  const set = state.settings;
  const kind = step === 'word'
    ? `<div class="kind-pick small"><span class="muted">Diese Aufnahme ist</span>${radios('take-kind', [{ value: 'mod', label: 'Modifiziert' }, { value: 'orig', label: 'Originalvokal' }], run.takeKind)}</div>`
    : '';
  return `
    ${pattern}
    <p class="instruction" id="instruction">${stepInstruction(vowel, to)}</p>
    ${kind}
    ${helpers}
    ${phrase}
    ${keys}
    <div class="dock">
      ${spot && hasClip(run.song, spot) ? '<button class="secondary" data-action="play-orig">Original<kbd>O</kbd></button>' : ''}
      ${hasRef ? '<button class="secondary" data-action="tone">Ton<kbd>T</kbd></button>' : ''}
      <button class="rec" id="rec-btn" data-action="rec"></button>
      <button class="primary" data-action="step" data-step="${run.step + 1}">${run.step === STEPS.length - 1 ? 'Bewerten' : 'Weiter'}<kbd>→</kbd></button>
    </div>
    <div class="level" id="level-wrap" hidden><div class="level-bar" id="level-bar"></div><span class="small tabular" id="level-text"></span></div>
    <p class="status small" id="status" aria-live="polite">${esc(statusText)}</p>
    ${hasRef ? `<div class="pitch" id="pitch-panel" hidden>
      <canvas id="pitch-canvas" role="img" aria-label="Verlauf der gesungenen Tonhöhe zum Zielton"></canvas>
      <p class="small tabular" id="pitch-read"></p>
    </div>` : ''}
    <div class="ab" id="compare" hidden>
      <h3 class="label">Vergleichen</h3>
      <button class="secondary" data-action="play-a" id="btn-a">Bester<kbd>B</kbd></button>
      <button class="secondary" data-action="play-b" id="btn-b">Neuester<kbd>N</kbd></button>
      <button class="secondary" data-action="play-ab" id="btn-ab">Im Wechsel<kbd>V</kbd></button>
      <button class="secondary" data-action="play-contrast" id="btn-contrast" hidden>Original gegen modifiziert</button>
      <button class="ghost" data-action="stop">Stopp</button>
      <div id="curve"></div>
    </div>
    <ul class="takes" id="takes"></ul>
    <p class="small muted" id="takes-hint" hidden>Mit ☆ markierst du deinen besten Take. Ihn kannst du später mit neuen Takes vergleichen.</p>
    <details class="options" id="options"${optionsOpen ? ' open' : ''}>
      <summary>Ton und Aufnahme einstellen</summary>
      <div class="options-body">
        ${hasRef ? `<label class="check"><input type="checkbox" id="tone-loop"${run.loop ? ' checked' : ''}> Ton wiederholen</label>
        <label class="check"><input type="checkbox" id="drone"${s.drone ? ' checked' : ''}> Ton läuft bei der Aufnahme mit (nur mit Kopfhörer)</label>
        <label class="check"><input type="checkbox" id="live-pitch"${set.livePitch ? ' checked' : ''}> Tonhöhe auch ohne Aufnahme zeigen</label>` : ''}
        <label class="check"><input type="checkbox" name="set-autoplay"${set.autoplay ? ' checked' : ''}> Take nach der Aufnahme direkt abspielen</label>
        ${toneControls('opt')}
        <div class="field-inline"><span>Lautschrift anzeigen</span>${radios('opt-notation', NOTATIONS, notation())}</div>
        <div class="row"><button class="ghost small" data-action="check">Technik prüfen</button></div>
      </div>
    </details>`;
}

function toneControls(prefix) {
  const set = state.settings;
  return `<label class="field-inline">Lautstärke des Tons
      <input type="range" name="set-volume" min="0" max="100" value="${set.volume}">
    </label>
    <div class="field-inline"><span>Klang des Tons</span>
      ${radios(`${prefix}-timbre`, [{ value: 'bright', label: 'Hell' }, { value: 'soft', label: 'Weich' }], set.timbre)}
    </div>`;
}

function ratingPanel(vowel, key) {
  const n = noteRating(key, run.midi);
  const next = neighborNote(1);
  const last = run.index === run.queue.length - 1;
  return `
    <p class="instruction">Wie sitzt <b>${esc(run.word || vowel.word)}</b> auf ${noteName(run.midi)}? Das Urteil bestimmt, wann der Vokal wieder drankommt und mit welchem Ton er startet.</p>
    <div class="rate-grid">
      ${RATINGS.map((x) => `<button class="rate r${x.id}${n && n.r === x.id ? ' active' : ''}" data-action="rate" data-rate="${x.id}"><span class="mark r${x.id}">${x.mark}</span><strong>${x.name}</strong><span class="small muted">${x.hint}</span></button>`).join('')}
    </div>
    ${next ? `<div class="row"><button class="secondary" data-action="rate-up">Sitzt, gleich weiter auf ${noteName(next)}</button></div>` : ''}
    <p class="small muted">Bei Kratzen, Schmerz oder Heiserkeit brich ab und bewerte mit Kippt.</p>
    <div class="step-nav">
      <button class="ghost" data-action="step" data-step="${STEPS.length - 1}">Zurück</button>
      <button class="ghost" data-action="next-vowel">${last ? 'Ohne Bewertung beenden' : 'Überspringen'}</button>
    </div>`;
}

function summaryView() {
  const done = run.rated;
  return `
  <section class="stack summary">
    <h1>Session beendet</h1>
    <p class="muted">${clock(run.endedAt - run.startedAt)} Minuten, ${done.length} ${done.length === 1 ? 'Vokal' : 'Vokale'} bewertet.</p>
    <ul class="queue">
      ${done.map((d) => {
    const v = vowelById(d.id);
    return `<li>${vowelSymbol(v)}<span class="muted small">${esc(d.word || v.word)} auf ${noteName(d.midi)}</span><span class="to">${soundHtml(d.to || target(v, run.preset, run.zone))}</span>${ratingMark({ r: d.r })}</li>`;
  }).join('') || '<li class="muted small">Keine Bewertung abgegeben.</li>'}
    </ul>
    <ul class="warm-list">
      <li><div><strong>Zum Abschluss: ${COOLDOWN.name}</strong><span class="small muted">${COOLDOWN.text}</span></div>
      <button class="secondary" data-action="warm-tone" data-id="${COOLDOWN.id}">Ton spielen</button></li>
    </ul>
    <p class="status small" id="status" aria-live="polite"></p>
    <div class="row">
      <button class="primary big" data-action="close-summary">Fertig</button>
      <button class="ghost" data-action="start-again">Noch eine Runde</button>
    </div>
  </section>`;
}

/* --- Matrix --- */

function matrixView() {
  const p = profile();
  const total = VOWELS.length * PRESETS.length;
  const rated = VOWELS.reduce((sum, v) => sum + PRESETS.filter((pr) => p.ratings[cellKey(v.id, pr.id, matrixZone)]).length, 0);
  const groups = GROUPS.filter((g) => g.id !== 'all');
  return `
  <section class="stack">
    <div class="matrix-head">
      <div>
        <h1>Vokalmatrix</h1>
        <p class="muted small">Tippe ein Feld an, um den Zielvokal zu ändern oder direkt zu üben. Alle Werte sind Startpunkte zum Überschreiben.</p>
      </div>
      <div>
        ${radios('m-zone', ['z1', 'z2'].map((z) => ({ value: z, label: `${ZONE_NAMES[z]} ${zoneLabel(z)}` })), matrixZone)}
        ${notationControls('m')}
        <p class="small muted legend">${rated} von ${total} bewertet · ${RATINGS.map((r) => `<span class="mark r${r.id}">${r.mark}</span> ${r.name}`).join(' · ')}</p>
        ${notation() === 'ipa' ? '' : '<p class="small muted">≈ heißt ungefähr. „dt.“ und „engl.“ stehen dort, wo es in der gewählten Sprache kein passendes Wort gibt.</p>'}
      </div>
    </div>
    <div class="table-wrap">
      <table class="matrix">
        <thead><tr><th scope="col">Vokal</th>${PRESETS.map((pr) => `<th scope="col">${pr.name}</th>`).join('')}</tr></thead>
        ${groups.map((g) => `<tbody>
          <tr class="group-row"><th colspan="5" scope="colgroup">${g.name}</th></tr>
          ${VOWELS.filter((v) => v.group === g.id).map((v) => `<tr>
            <th scope="row">${vowelSymbol(v)} <span class="small muted">${vowelWord(v)}</span></th>
            ${PRESETS.map((pr) => {
    const k = cellKey(v.id, pr.id, matrixZone);
    const r = p.ratings[k];
    const edited = p.overrides[k] && p.overrides[k].to;
    return `<td><button class="cell${r ? ` r${r.r}` : ''}" data-action="cell" data-vowel="${v.id}" data-preset="${pr.id}">${soundHtml(target(v, pr.id, matrixZone))}${edited ? '<span class="edited" title="Von dir geändert">•</span>' : ''}${ratingMark(r)}</button></td>`;
  }).join('')}
          </tr>`).join('')}
        </tbody>`).join('')}
      </table>
    </div>
  </section>`;
}

function openCell(vowelId, presetId) {
  const v = vowelById(vowelId);
  const pr = presetById(presetId);
  const k = cellKey(vowelId, presetId, matrixZone);
  const o = profile().overrides[k] || {};
  const to = target(v, pr.id, matrixZone);
  const noteMarks = zoneNotes(matrixZone).map((m) => {
    const n = noteRating(k, m);
    return `${noteName(m)} ${n ? ratingMark(n) : '<span class="mark none">·</span>'}`;
  }).join(' · ');
  openDialog(`<form method="dialog" class="stack" id="cell-form" data-enter="cell-save" data-key="${esc(k)}" data-vowel="${v.id}" data-preset="${pr.id}">
    <h2>${vowelSymbol(v)} ${vowelWord(v)}</h2>
    <p class="muted small">${pr.name} · ${ZONE_NAMES[matrixZone]} ${zoneLabel(matrixZone)} · Startwert ${soundInline(v.m[pr.id][matrixZone === 'z1' ? 0 : 1])}</p>
    <label class="field">Zielvokal<input id="cell-to" class="ipa" value="${esc(to)}" maxlength="24"></label>
    <p class="small" id="cell-plain">${describeTarget(to)}</p>
    <p class="small muted">Das Feld nutzt Lautschrift. Tippe unten einen Klang an, ein Strich dazwischen heißt „zwischen beiden“.</p>
    <div class="ipa-keys">${Object.keys(CHART).map((s) => `<button type="button" data-action="ipa" data-sym="${s}" aria-label="${s} wie ${esc(soundWord(s))}"><span class="ipa">${s}</span><span class="key-word">${esc(soundWord(s))}</span></button>`).join('')}<button type="button" data-action="ipa" data-sym="–">–</button></div>
    <label class="field">Eigene Notiz<textarea id="cell-note" rows="2" maxlength="300">${esc(o.note || '')}</textarea></label>
    <p class="small muted">Stand je Ton: ${noteMarks}</p>
    <div class="dialog-actions">
      <button type="button" class="ghost" data-action="cell-reset">Zurücksetzen</button>
      <button type="button" class="ghost" data-action="close-dialog">Abbrechen</button>
      <button type="button" class="secondary" data-action="cell-save">Speichern</button>
      <button type="button" class="primary" data-action="cell-practice">Jetzt üben</button>
    </div>
  </form>`);
}

function saveCell() {
  const form = $('cell-form');
  const k = form.dataset.key;
  const to = $('cell-to').value.trim();
  const note = $('cell-note').value.trim();
  const base = vowelById(form.dataset.vowel).m[form.dataset.preset][matrixZone === 'z1' ? 0 : 1];
  const overrides = profile().overrides;
  if ((to && to !== base) || note) overrides[k] = { to: to && to !== base ? to : '', note };
  else delete overrides[k];
  save();
}

/* --- Verlauf --- */

function historyView() {
  const p = profile();
  const zone = historyZone || p.session.zone;
  const log = p.log || [];
  const now = Date.now();
  const week = log.filter((l) => now - l.at < 7 * DAY);
  const minutes = (rows) => Math.round(rows.reduce((s, l) => s + l.ms, 0) / 60000);
  const days = new Set(week.map((l) => new Date(l.at).toDateString())).size;
  const rows = PRESETS.map((pr) => {
    const counts = { 1: 0, 2: 0, 3: 0, open: 0 };
    VOWELS.forEach((v) => {
      const r = p.ratings[cellKey(v.id, pr.id, zone)];
      if (r) counts[r.r] += 1; else counts.open += 1;
    });
    return `<tr><th scope="row">${pr.name}</th><td><span class="mark r3">✓</span> ${counts[3]}</td><td><span class="mark r2">∼</span> ${counts[2]}</td><td><span class="mark r1">✕</span> ${counts[1]}</td><td class="muted">${counts.open} offen</td></tr>`;
  }).join('');
  const hard = [];
  PRESETS.forEach((pr) => VOWELS.forEach((v) => {
    const r = p.ratings[cellKey(v.id, pr.id, zone)];
    if (r && r.r === 1) hard.push({ v, pr, at: r.at });
  }));
  hard.sort((a, b) => a.at - b.at);
  return `
  <section class="stack">
    <h1>Verlauf</h1>
    <div class="stats">
      <div class="stat"><strong>${minutes(week)} Min.</strong><span class="small muted">in den letzten 7 Tagen</span></div>
      <div class="stat"><strong>${days} von 7</strong><span class="small muted">Tagen geübt</span></div>
      <div class="stat"><strong>${log.length}</strong><span class="small muted">Sessions insgesamt, ${minutes(log)} Min.</span></div>
    </div>
    <div>
      <div class="queue-head"><h2 class="label">Stand je Stil</h2></div>
      ${radios('h-zone', ['z1', 'z2'].map((z) => ({ value: z, label: `${ZONE_NAMES[z]} ${zoneLabel(z)}` })), zone)}
      <div class="table-wrap"><table class="hist"><tbody>${rows}</tbody></table></div>
    </div>
    <div>
      <h2 class="label">Kippt gerade</h2>
      ${hard.length ? `<ul class="todo-list">${hard.slice(0, 8).map((h) => `<li><button class="todo" data-action="practice-one" data-vowel="${h.v.id}" data-preset="${h.pr.id}" data-zone="${zone}">${vowelSymbol(h.v)}<span class="small muted">${vowelWord(h.v)} · ${h.pr.name}</span><span class="to">${soundHtml(target(h.v, h.pr.id, zone))}</span></button></li>`).join('')}</ul>`
    : '<p class="small muted">Nichts in dieser Zone. Felder mit der Bewertung Kippt erscheinen hier zum direkten Üben.</p>'}
    </div>
    ${blindSection()}
    <div>
      <h2 class="label">Letzte Sessions</h2>
      ${log.length ? `<ul class="log">${log.slice(-10).reverse().map((l) => `<li>
        <span class="small tabular">${new Date(l.at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} · ${clock(l.ms)} · ${l.song ? `${esc(l.song)} · ` : ''}${presetById(l.preset).name} · ${ZONE_NAMES[l.zone]}</span>
        <span class="small">${l.rated.map((d) => `${vowelSymbol(vowelById(d.id))} <span class="muted">${vowelById(d.id).word}</span> ${ratingMark({ r: d.r })}`).join(' ') || '<span class="muted">Ohne Bewertung</span>'}</span>
      </li>`).join('')}</ul>` : '<p class="small muted">Noch keine Session. Nach der ersten erscheint sie hier.</p>'}
    </div>
  </section>`;
}

/* --- Profil --- */

function noteOptions(selected) {
  let out = '';
  for (let m = 48; m <= 84; m++) out += `<option value="${m}"${m === selected ? ' selected' : ''}>${noteName(m)}</option>`;
  return out;
}

function profileView() {
  const p = profile();
  const custom = p.voice === 'eigen';
  return `
  <section class="stack profile">
    <h1>Profil</h1>
    <div class="form-grid">
      <label class="field">Name<input id="p-name" value="${esc(p.name)}" maxlength="30"></label>
      <label class="field">Stimmlage
        <select id="p-voice">${Object.entries(VOICES).map(([id, v]) => `<option value="${id}"${id === p.voice ? ' selected' : ''}>${v.name}</option>`).join('')}</select>
      </label>
    </div>
    <p class="small muted">Die Matrix ist auf Tenor abgestimmt. Bei anderen Stimmen verschieben sich die Übergänge, passe dann Zonen und Zielvokale an.</p>
    <div class="zone-grid">
      ${['z1', 'z2'].map((z) => `<fieldset ${custom ? '' : 'disabled'}><legend>${ZONE_NAMES[z]}</legend>
        <label class="field small">Von<select id="p-${z}-lo">${noteOptions(p.zones[z][0])}</select></label>
        <label class="field small">Bis<select id="p-${z}-hi">${noteOptions(p.zones[z][1])}</select></label>
      </fieldset>`).join('')}
    </div>
    <div>
      <h2 class="label">Cry und Twang je Stil</h2>
      <div class="table-wrap"><table class="levels">
        <thead><tr><th scope="col">Stil</th><th scope="col">Cry</th><th scope="col">Twang</th></tr></thead>
        <tbody>${PRESETS.map((pr) => `<tr><th scope="row">${pr.name}</th>
          ${['cry', 'twang'].map((kind) => `<td>${radios(`lv-${pr.id}-${kind}`, LEVELS.map((l, i) => ({ value: i, label: l })), p.levels[pr.id][kind])}</td>`).join('')}
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div>
      <h2 class="label">Lautschrift anzeigen</h2>
      ${notationControls('p')}
    </div>
    <div>
      <h2 class="label">Technik</h2>
      <div class="controls"><button class="secondary" data-action="check">Mikrofon und Ton prüfen</button></div>
    </div>
    <div>
      <h2 class="label">Daten</h2>
      <p class="small muted" id="storage-info">Aufnahmen bleiben nur auf diesem Gerät.</p>
      <div class="controls">
        <button class="secondary" data-action="export">Profil exportieren</button>
        <label class="secondary file-btn">Profil importieren<input type="file" id="p-import" accept="application/json,.json"></label>
        <button class="ghost" data-action="add-profile">Neues Profil</button>
        <button class="ghost danger" data-action="delete-profile"${state.profiles.length < 2 ? ' disabled' : ''}>Profil löschen</button>
      </div>
      <p class="small muted">Der Export enthält Einstellungen, Bewertungen, Verlauf, Songs und Matrix-Änderungen, aber keine Aufnahmen.</p>
    </div>
    <div>
      <h2 class="label">Komplett-Backup</h2>
      <p class="small muted">Sichert alle Profile, Aufnahmen und Audiodateien dieses Browsers in einer Datei. Beim Einspielen kommt nur hinzu, was fehlt. Vorhandenes bleibt unverändert.</p>
      <div class="controls">
        <button class="secondary" data-action="backup-make">Backup speichern</button>
        <label class="secondary file-btn">Backup einspielen<input type="file" id="backup-file"></label>
      </div>
      <p class="small muted" id="backup-msg" aria-live="polite"></p>
    </div>
  </section>`;
}

async function fillStorageInfo() {
  try {
    const takes = await allTakes();
    const mine = takes.filter((t) => t.slot.startsWith(profile().id + '|'));
    const mb = mine.reduce((s, t) => s + t.blob.size, 0) / 1048576;
    const el = $('storage-info');
    if (el) el.textContent = `${mine.length} Aufnahmen (${mb.toFixed(1)} MB) liegen nur auf diesem Gerät.`;
  } catch (e) { /* Hinweistext bleibt stehen */ }
}

/* --- Hilfe --- */

function openHelp() {
  openDialog(`<div class="stack">
    <h2>Zeichen und Begriffe</h2>
    <p class="small">Du musst keine Lautschrift können. Unter „Nur Wörter“ kommt die App ohne Zeichen aus. Wer sie lernen möchte, schaltet auf „Zeichen + Wort“ und später auf „Nur Zeichen“.</p>
    ${notationControls('h')}
    <p class="small muted">Nur ${Object.values(IPA).filter((i) => i.hint).length} Zeichen sind neu, die anderen klingen fast wie geschrieben. ≈ heißt ungefähr.</p>
    <div class="row"><button class="secondary" data-action="quiz-start">Zeichen üben, etwa eine Minute</button></div>
    <div class="table-wrap"><table class="help-table">
      <thead><tr><th scope="col">Zeichen</th><th scope="col">Englisch</th><th scope="col">Deutsch</th><th scope="col">Merkhilfe und Mundgefühl</th><th scope="col">Hören</th><th scope="col">Eigene Probe</th></tr></thead>
      <tbody>${Object.entries(IPA).map(([sym, i]) => `<tr>
        <th scope="row"><span class="ipa">${sym}</span></th><td>${exampleWord(sym, 'en') || '–'}</td><td>${exampleWord(sym, 'de') || '–'}</td><td class="muted">${i.hint ? `<b>${i.hint}.</b> ` : ''}${glossProse(i.tip)}.</td>
        <td class="sample-cell"><button class="ghost small" data-action="hear" data-sym="${sym}">Wort</button> <button class="ghost small" data-action="hear-synth" data-sym="${sym}">Synth</button></td>
        <td class="sample-cell" data-sym="${sym}"></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="small muted" id="help-msg">„Wort“ nutzt die Sprachausgabe, „Synth“ einen künstlichen Vokal. Beides ist nur eine Annäherung. Am besten nimmst du gesungene Proben selbst auf oder lässt sie von jemandem aufnehmen, dem du vertraust.</p>
    <h2>Begriffe</h2>
    <dl class="small">${TERMS.map(([t, d]) => `<dt><b>${t}</b></dt><dd class="muted" style="margin:0 0 6px">${d}</dd>`).join('')}</dl>
    <h2>Kurzbefehle beim Üben</h2>
    <p class="small muted">Viele Fußpedale senden Bild ab oder Leertaste und lassen sich so zum Aufnehmen nutzen.</p>
    <div class="table-wrap"><table class="help-table"><tbody>${SHORTCUTS.map(([k, d]) => `<tr><th scope="row"><kbd>${k}</kbd></th><td>${d}</td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">Kurzbefehle wirken nicht, solange ein Eingabefeld aktiv ist.</p>
    <div class="dialog-actions"><button class="primary" data-action="close-dialog">Schließen</button></div>
  </div>`);
  fillSamples();
}

/* --- Technik-Check --- */

let checkActive = false;

const micErrorText = (e) => MIC_ERRORS[e.message] || MIC_ERRORS[e.name] || `Aufnahme nicht möglich: ${e.message}`;

function openCheck() {
  const set = state.settings;
  openDialog(`<div class="stack">
    <h2>Technik prüfen</h2>
    <p class="small"><b>1. Mikrofon.</b> Sing oder sprich kurz. Der Balken sollte beim Singen bis etwa zwei Drittel reichen.</p>
    <div class="row"><button class="secondary" data-action="check-mic" id="check-mic">Mikrofon aktivieren</button></div>
    <label class="field" id="check-device-wrap" hidden>Mikrofon<select id="check-device"></select></label>
    <div class="check-bar"><i id="check-bar"></i></div>
    <p class="small muted" id="check-msg" aria-live="polite">Der Browser fragt beim ersten Mal nach der Erlaubnis.</p>
    <p class="small"><b>2. Kopfhörer.</b> Nutze kabelgebundene Kopfhörer. Bluetooth verzögert den Ton zu stark zum Mitsingen.</p>
    <div class="row"><button class="secondary" data-action="check-tone">Testton spielen</button></div>
    ${toneControls('chk')}
    <label class="check"><input type="checkbox" name="set-autoplay"${set.autoplay ? ' checked' : ''}> Take nach der Aufnahme direkt abspielen</label>
    <p class="small muted">Halte beim Vergleichen immer denselben Abstand zum Mikrofon.</p>
    <div class="dialog-actions"><button class="primary" data-action="close-dialog">Fertig</button></div>
  </div>`);
}

async function fillDevices() {
  const mics = await Sound.listMics();
  const wrap = $('check-device-wrap');
  const sel = $('check-device');
  if (!wrap || !sel || !mics.length) return;
  sel.innerHTML = `<option value="">Standard des Systems</option>${mics.filter((m) => m.deviceId && m.deviceId !== 'default').map((m, i) => `<option value="${esc(m.deviceId)}"${m.deviceId === state.settings.deviceId ? ' selected' : ''}>${esc(m.label || `Mikrofon ${i + 1}`)}</option>`).join('')}`;
  wrap.hidden = false;
}

function checkLoop() {
  if (!checkActive) return;
  if (!$('dialog').open) { stopCheck(); return; }
  const { rms, peak } = Sound.level();
  const bar = $('check-bar');
  const msg = $('check-msg');
  if (bar) {
    bar.style.width = `${Math.min(100, Math.sqrt(rms) * 150)}%`;
    bar.classList.toggle('hot', peak > .98);
  }
  if (msg) {
    if (peak > .98) msg.textContent = 'Zu laut. Geh etwas weiter vom Mikrofon weg.';
    else if (rms < .003) msg.textContent = 'Noch kein Signal. Sing oder sprich etwas lauter.';
    else msg.textContent = 'Das Mikrofon empfängt dich.';
  }
  requestAnimationFrame(checkLoop);
}

// Eine laufende Session behaelt das Mikrofon.
function releaseMic() {
  if (!run || run.finished) Sound.closeMic();
}

function stopCheck() {
  if (!checkActive) return;
  checkActive = false;
  releaseMic();
  // Nach einer Unterbrechung laesst sich das Mikrofon im offenen Dialog neu aktivieren.
  const again = $('check-mic');
  if (!again) return;
  again.hidden = false;
  $('check-bar').style.width = '0';
  $('check-msg').textContent = 'Das Mikrofon ist aus. Aktiviere es bei Bedarf erneut.';
}

/* ---------- Ablauf der Uebung ---------- */

let wakeLock = null;
async function keepAwake() {
  if (!run || run.finished || document.hidden || wakeLock || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) { /* Bildschirm darf dann schlafen */ }
}
function releaseAwake() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

function startRun(queue, preset, zone, minutes, withWarmup, songRun) {
  const first = cellKey(queue[0], preset, zone);
  run = {
    queue, preset, zone, minutes, index: 0, step: 0, word: null,
    phase: withWarmup ? 'warmup' : 'vowels',
    midi: songRun ? 0 : startNote(first, zone), loop: false, rec: 'idle', takeKind: 'mod',
    startedAt: Date.now(), rated: [], finished: false, ...songRun,
  };
  if (songRun) enterSpot(songRun.spots[0]);
  statusText = '';
  clearInterval(timerId);
  timerId = setInterval(updateClock, 1000);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  keepAwake();
  pitchTrail = [];
  if (state.settings.livePitch) Sound.openMic(state.settings.deviceId).catch(() => {});
  render();
  window.scrollTo(0, 0);
}

// Laeuft auch beim Verlassen der App, das System kann sie danach ohne Vorwarnung schliessen.
function logRun() {
  const ms = Date.now() - run.startedAt;
  if (!run.rated.length && ms <= 60000) return;
  if (!run.logEntry) {
    run.logEntry = { at: run.startedAt, preset: run.preset, zone: run.zone, song: run.song ? run.song.title : undefined };
    const p = profile();
    p.log = [...p.log, run.logEntry].slice(-MAX_LOG);
  }
  Object.assign(run.logEntry, { ms, rated: run.rated });
  save();
}

function endRun() {
  if (run.rec === 'on') stopRecording();
  stopPlayback();
  Sound.closeMic();
  clearInterval(timerId);
  releaseAwake();
  run.endedAt = Date.now();
  run.finished = true;
  logRun();
  render();
  window.scrollTo(0, 0);
}

function closeRun() {
  stopPlayback();
  run = null;
  render();
  window.scrollTo(0, 0);
}

function leaveStep() {
  if (run.rec === 'on') stopRecording();
  stopPlayback();
  statusText = '';
  run.takeKind = 'mod';
  // Eine Starthilfe gilt nur im Muster-Schritt.
  const spot = currentSpot();
  if (run.word && presetById(run.preset).helpers.includes(run.word)) run.word = spot ? spot.word : null;
}

function goToStep(index) {
  leaveStep();
  run.step = Math.max(0, Math.min(STEPS.length, index));
  render();
  const panel = document.querySelector('.work-panel');
  if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: 'start' });
}

function nextVowel() {
  leaveStep();
  if (run.index >= run.queue.length - 1) { endRun(); return; }
  run.index += 1;
  run.step = 0;
  const spot = currentSpot();
  if (spot) {
    enterSpot(spot);
  } else {
    run.word = null;
    run.midi = startNote(currentCell().key, run.zone);
  }
  render();
  window.scrollTo(0, 0);
}

function saveRating(r) {
  const { key, vowel, to } = currentCell();
  const at = Date.now();
  const old = profile().ratings[key] || {};
  const spot = currentSpot();
  const item = spot ? spot.id : vowel.id;
  profile().ratings[key] = { r, at, notes: { ...old.notes, [run.midi]: { r, at } } };
  if (spot) spot.rating = { r, at, midi: run.midi };
  run.rated = run.rated.filter((d) => (d.spot || d.id) !== item)
    .concat({ id: vowel.id, r, midi: run.midi, to, ...(spot ? { spot: spot.id, word: spot.word } : {}) });
  save();
}

function neighborNote(step) {
  const notes = runNotes();
  return notes[notes.indexOf(run.midi) + step];
}

function changeNote(midi) {
  if (run.rec !== 'idle') return;
  run.midi = midi;
  stopPlayback();
  statusText = '';
  render();
  playTone();
}

/* --- Wiedergabe --- */

let playToken = 0;
function stopPlayback() {
  playToken += 1;
  Sound.stopAll();
}
function setStatus(text) {
  statusText = text;
  const el = $('status');
  if (el) el.textContent = text;
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function playTone() {
  const { vowel } = currentCell();
  stopPlayback();
  const token = playToken;
  const seq = refSeq(stepId(), run.midi, vowel);
  if (!seq) return;
  do {
    setStatus(`Ton: ${noteName(run.midi)}`);
    await Sound.playSeq(seq).done;
    if (token !== playToken) return;
    if (run && run.loop) await pause(500);
  } while (token === playToken && run && run.loop);
  if (token === playToken) setStatus('');
}

async function playWarm(id) {
  const item = id === COOLDOWN.id ? COOLDOWN : WARMUP.find((w) => w.id === id);
  stopPlayback();
  const token = playToken;
  setStatus(`Ton: ${item.name}`);
  await Sound.playSeq(item.seq(profile().zones.z1[0])).done;
  if (token === playToken) setStatus('');
}

async function currentTakes() {
  const { key } = currentCell();
  return takesFor(slotFor(key, stepId()));
}

async function playTakeNow(take, label) {
  stopPlayback();
  const token = playToken;
  setStatus(label);
  try {
    await (await Sound.playTake(take)).done;
  } catch (e) {
    if (token === playToken) setStatus('Dieser Take lässt sich nicht abspielen.');
    return;
  }
  if (token === playToken) setStatus('');
}

async function playBest() {
  const best = (await currentTakes()).find((t) => t.isRef);
  if (best) await playTakeNow(best, 'Spielt: bester Take');
  else if (stepId() !== 'spoken') await playTone();
  else setStatus('Markiere zuerst einen Take als besten.');
}

// Originalvokal-Takes dienen nur dem Kontrast und zaehlen nicht als neuester Take.
const isCompareTake = (t) => !t.isRef && t.kind !== 'orig';

async function playNewest() {
  const take = (await currentTakes()).find(isCompareTake);
  if (take) await playTakeNow(take, 'Spielt: neuester Take');
}

// Muss direkt im Tastendruck starten, sonst blockiert iOS die Wiedergabe.
function playOriginal() {
  const spot = currentSpot();
  if (!spot || !hasClip(run.song, spot)) return;
  stopPlayback();
  const token = playToken;
  setStatus('Spielt: Original');
  Sound.playClip(songPlayer, spot.start, spot.end, pitchRate(run.song)).done.then(() => {
    if (token === playToken) setStatus('');
  });
}

async function playCompare() {
  const takes = await currentTakes();
  const best = takes.find((t) => t.isRef);
  const newest = takes.find(isCompareTake);
  if (!newest) return;
  const { vowel } = currentCell();
  const seq = refSeq(stepId(), run.midi, vowel);
  const spot = currentSpot();
  const clip = spot && hasClip(run.song, spot);
  if (!clip && !best && !seq) { setStatus('Markiere zuerst einen Take als besten.'); return; }
  stopPlayback();
  await playAlternating(
    clip ? 'Spielt: Original' : best ? 'Spielt: bester Take' : 'Spielt: Ton',
    async () => (clip ? Sound.playClip(songPlayer, spot.start, spot.end, pitchRate(run.song)) : best ? Sound.playTake(best) : Sound.playSeq(seq)),
    'Spielt: neuester Take',
    () => Sound.playTake(newest),
  );
}

// Spielt zwei Quellen im Wechsel, bis jemand stoppt. Ein defekter Take beendet die Schleife mit einem Hinweis.
async function playAlternating(firstLabel, first, secondLabel, second) {
  const token = playToken;
  try {
    while (token === playToken) {
      setStatus(firstLabel);
      await (await first()).done;
      if (token !== playToken) return;
      await pause(450);
      if (token !== playToken) return;
      setStatus(secondLabel);
      await (await second()).done;
      if (token !== playToken) return;
      await pause(450);
    }
  } catch (e) {
    if (token === playToken) setStatus('Dieser Take lässt sich nicht abspielen.');
  }
}

async function playOne(id) {
  const take = (await currentTakes()).find((t) => t.id === id);
  if (!take) return;
  const time = new Date(take.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  await playTakeNow(take, `Spielt: ${noteName(take.midi)} von ${time}`);
}

async function refreshTakes() {
  const list = $('takes');
  if (!list) return;
  const slotStep = run.step;
  const slotIndex = run.index;
  let takes = [];
  try { takes = await currentTakes(); } catch (e) {
    list.innerHTML = '<li class="small">Aufnahmen können in diesem Fenster nicht gespeichert werden.</li>';
    return;
  }
  if (!run || run.finished || run.step !== slotStep || run.index !== slotIndex) return;
  const newest = takes.find(isCompareTake);
  const best = takes.find((t) => t.isRef);
  const contrast = $('btn-contrast');
  if (contrast) contrast.hidden = !(takes.some((t) => t.kind === 'orig') && takes.some((t) => t.kind !== 'orig'));
  const compare = $('compare');
  if (compare) compare.hidden = !takes.length;
  const btnA = $('btn-a');
  const btnB = $('btn-b');
  const btnAB = $('btn-ab');
  if (btnA) {
    btnA.firstChild.textContent = best || stepId() === 'spoken' ? 'Bester' : 'Ton';
    btnA.disabled = !best && stepId() === 'spoken';
  }
  if (btnB) btnB.disabled = !newest;
  const spot = currentSpot();
  const clip = spot && hasClip(run.song, spot);
  if (btnAB) btnAB.disabled = !newest || (!best && !clip && stepId() === 'spoken');
  renderCurve(takes.filter((t) => t.kind !== 'orig'));
  list.innerHTML = takes.map((t) => {
    const refLabel = t.isRef ? 'Markierung als bester Take lösen' : 'Als besten Take markieren';
    return `<li class="${t.isRef ? 'is-ref' : ''}">
    <button class="ghost small icon" data-action="play-take" data-id="${t.id}" aria-label="Take abspielen" title="Abspielen">▶&#xFE0E;</button>
    <span class="small tabular">${new Date(t.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · ${noteName(t.midi)} · ${clock(t.ms)}</span>
    ${t.isRef ? '<span class="badge">Bester</span>' : ''}
    ${t.kind === 'orig' ? '<span class="badge">Original</span>' : ''}
    <span class="take-actions">
      ${t.kind === 'orig' ? '' : `<button class="ghost small icon" data-action="ref-take" data-id="${t.id}" aria-label="${refLabel}" title="${refLabel}">${t.isRef ? '★' : '☆'}</button>`}
      <button class="ghost small icon" data-action="del-take" data-id="${t.id}" aria-label="Take löschen" title="Löschen">✕</button>
    </span>
  </li>`;
  }).join('');
  const hint = $('takes-hint');
  if (hint) hint.hidden = !!best || !takes.some((t) => t.kind !== 'orig');
}

/* --- Aufnahme --- */

let recSession = null;

const MIC_ERRORS = {
  insecure: 'Das Mikrofon braucht eine sichere Adresse. Öffne den Trainer über https oder auf diesem Rechner über localhost.',
  unsupported: 'Dieser Browser kann nicht aufnehmen. Nutze einen aktuellen Chrome, Edge, Firefox oder Safari.',
  NotAllowedError: 'Das Mikrofon ist blockiert. Erlaube den Zugriff in den Website-Einstellungen des Browsers.',
  NotFoundError: 'Kein Mikrofon gefunden. Schließe eines an und versuche es erneut.',
  NotReadableError: 'Das Mikrofon wird gerade von einer anderen App belegt. Schließe sie und versuche es erneut.',
};

function updateRecUi() {
  syncPitch();
  const btn = $('rec-btn');
  if (!btn || !run) return;
  btn.classList.toggle('on', run.rec === 'on');
  btn.classList.toggle('wait', run.rec === 'countin');
  btn.innerHTML = { idle: 'Aufnehmen<kbd>Leertaste</kbd>', countin: 'Einsatz …', on: 'Stoppen<kbd>Leertaste</kbd>' }[run.rec];
  const wrap = $('level-wrap');
  if (wrap) wrap.hidden = run.rec !== 'on';
  document.querySelectorAll('.key').forEach((k) => { k.disabled = run.rec !== 'idle'; });
}

function endCountIn(thisRun) {
  if (thisRun === run && run.rec === 'countin') {
    run.rec = 'idle';
    updateRecUi();
  }
}

async function startRecording() {
  stopPlayback();
  const token = playToken;
  const thisRun = run;
  const { vowel, key } = currentCell();
  const step = stepId();
  const slot = slotFor(key, step);
  const midi = run.midi;
  const kind = step === 'word' ? run.takeKind : 'mod';
  const word = run.word || vowel.word;
  run.rec = 'countin';
  updateRecUi();
  try {
    setStatus('Mikrofon wird geöffnet …');
    await Sound.openMic(state.settings.deviceId);
  } catch (e) {
    endCountIn(thisRun);
    setStatus(micErrorText(e));
    return;
  }
  if (token !== playToken || run !== thisRun) { endCountIn(thisRun); return; }
  const seq = refSeq(step, midi, vowel);
  if (seq) {
    setStatus(`Einsatzton: ${noteName(seq[0].from)}. Danach singen.`);
    // Haengt der Audio-Kontext, darf der Einsatz die Aufnahme nicht blockieren.
    await Promise.race([Sound.playSeq([{ from: seq[0].from, to: seq[0].from, dur: 1 }]).done, pause(1600)]);
    if (token !== playToken || run !== thisRun) { endCountIn(thisRun); return; }
  }
  let finished;
  try {
    finished = Sound.startRec();
  } catch (e) {
    endCountIn(thisRun);
    setStatus(micErrorText(e));
    return;
  }
  const session = { startedAt: performance.now(), peak: 0, track: [] };
  recSession = session;
  pitchTrail = [];
  run.rec = 'on';
  setStatus('Aufnahme läuft');
  updateRecUi();
  if (seq && profile().session.drone) Sound.playSeq(seq, .5);
  session.limit = setTimeout(() => { if (recSession === session) stopRecording(); }, 30000);
  meterLoop(session);
  const blob = await finished;
  clearTimeout(session.limit);
  // Endet das Mikrofon von selbst, etwa bei einem Anruf, steht die Oberflaeche noch auf Aufnahme.
  if (recSession === session) stopRecording();
  const ms = Math.round(performance.now() - session.startedAt);
  if (ms < 400 || !blob.size) {
    if (run === thisRun && !run.finished) setStatus('Das war zu kurz für einen Take.');
    return;
  }
  const take = { id: uid(), slot, midi, at: Date.now(), ms, blob, isRef: false, pitch: session.track, kind, word };
  try {
    await putTake(take);
    await pruneTakes(slot);
  } catch (e) {
    if (run === thisRun) setStatus('Der Take konnte nicht gespeichert werden. Prüfe den freien Speicher.');
    return;
  }
  if (run !== thisRun || run.finished) return;
  const sameSlot = stepId() && slotFor(currentCell().key, stepId()) === slot;
  if (!sameSlot) return;
  const hot = session.peak > .98;
  setStatus(hot ? 'Gespeichert. Das Signal war übersteuert, geh etwas weiter weg.' : 'Gespeichert.');
  await refreshTakes();
  if (state.settings.autoplay && !hot && run === thisRun && run.rec === 'idle') {
    await playTakeNow(take, 'Spielt: neuester Take');
  }
}

function meterLoop(session) {
  if (recSession !== session) return;
  const { rms, peak } = Sound.level();
  session.peak = Math.max(session.peak, peak);
  const bar = $('level-bar');
  const text = $('level-text');
  if (bar) {
    bar.style.width = `${Math.min(100, Math.sqrt(rms) * 150)}%`;
    bar.classList.toggle('hot', peak > .98);
  }
  if (text) text.textContent = clock(performance.now() - session.startedAt);
  requestAnimationFrame(() => meterLoop(session));
}

function stopRecording() {
  recSession = null;
  Sound.stopAll();
  Sound.stopRec();
  if (run) {
    run.rec = 'idle';
    setStatus('Wird gespeichert …');
    updateRecUi();
  }
}

function toggleRecording() {
  if (run.rec === 'on') stopRecording();
  else if (run.rec === 'countin') {
    stopPlayback();
    endCountIn(run);
    setStatus('');
    // Eine haengende Mikrofon-Anfrage darf den naechsten Versuch nicht blockieren.
    if (!Sound.frame()) Sound.closeMic();
  } else startRecording();
}

/* ---------- Ereignisse ---------- */

const actions = {
  start() {
    const s = profile().session;
    const queue = buildQueue();
    if (queue.length) startRun(queue, s.preset, s.zone, s.minutes, s.warmup);
  },
  'start-again'() {
    if (run.spots) startSpots(run.song, run.spots, false);
    else if (run.minutes) startRun(buildQueue(), run.preset, run.zone, run.minutes, false);
    else startRun(run.queue, run.preset, run.zone, 0, false);
  },
  'end-run': endRun,
  'close-summary': closeRun,
  'warm-tone': (el) => playWarm(el.dataset.id),
  'warm-done'() {
    stopPlayback();
    statusText = '';
    run.phase = 'vowels';
    render();
    window.scrollTo(0, 0);
  },
  step: (el) => goToStep(Number(el.dataset.step)),
  word(el) {
    run.word = el.dataset.word;
    document.querySelectorAll('.word').forEach((b) => b.classList.toggle('active', b === el));
    const ins = $('instruction');
    const { vowel, to } = currentCell();
    if (ins) ins.innerHTML = stepInstruction(vowel, to);
  },
  speak() {
    const { vowel } = currentCell();
    if (!Sound.speak(run.word || vowel.word, 'en')) setStatus('Auf diesem Gerät ist keine englische Stimme installiert. Chrome und Edge bringen sie meist mit.');
  },
  note: (el) => changeNote(Number(el.dataset.midi)),
  tone: playTone,
  rec: toggleRecording,
  'play-a': playBest,
  'play-b': playNewest,
  'play-ab': playCompare,
  'play-orig': playOriginal,
  stop() { stopPlayback(); setStatus(''); },
  'play-take': (el) => playOne(el.dataset.id),
  async 'ref-take'(el) {
    const takes = await currentTakes();
    for (const t of takes) {
      const isRef = t.id === el.dataset.id ? !t.isRef : false;
      if (isRef !== t.isRef) await putTake({ ...t, isRef });
    }
    refreshTakes();
  },
  async 'del-take'(el) {
    stopPlayback();
    await deleteTake(el.dataset.id);
    setStatus('');
    refreshTakes();
  },
  rate(el) {
    saveRating(Number(el.dataset.rate));
    nextVowel();
  },
  'rate-up'() {
    const next = neighborNote(1);
    saveRating(3);
    leaveStep();
    run.midi = next;
    run.step = STEPS.findIndex((s) => s.id === 'word');
    render();
    window.scrollTo(0, 0);
  },
  'next-vowel': nextVowel,
  cell: (el) => openCell(el.dataset.vowel, el.dataset.preset),
  ipa(el) {
    const input = $('cell-to');
    const at = input.selectionStart ?? input.value.length;
    input.value = input.value.slice(0, at) + el.dataset.sym + input.value.slice(input.selectionEnd ?? at);
    input.focus();
    input.setSelectionRange(at + el.dataset.sym.length, at + el.dataset.sym.length);
    $('cell-plain').textContent = describeTarget(input.value);
  },
  'close-dialog'() {
    stopCheck();
    $('dialog').close();
  },
  'cell-save'() {
    saveCell();
    $('dialog').close();
    render();
  },
  'cell-reset'() {
    delete profile().overrides[$('cell-form').dataset.key];
    save();
    $('dialog').close();
    render();
  },
  'cell-practice'() {
    saveCell();
    const form = $('cell-form');
    const { vowel, preset } = form.dataset;
    $('dialog').close();
    startRun([vowel], preset, matrixZone, 0, false);
  },
  'practice-one': (el) => startRun([el.dataset.vowel], el.dataset.preset, el.dataset.zone, 0, false),
  help: openHelp,
  hear(el) {
    // Zuerst das Wort in der gewaehlten Sprache, das andere springt ein, wenn es keines gibt.
    const i = IPA[el.dataset.sym];
    const order = state.settings.exampleDe ? ['de', 'en'] : ['en', 'de'];
    const ok = order.some((lang) => i[lang] && Sound.speak(i[lang], lang));
    if (!ok) $('help-msg').textContent = 'Auf diesem Gerät fehlt eine passende Stimme für diese Hörprobe. Chrome und Edge bringen englische Stimmen meist mit.';
  },
  check: openCheck,
  'intro-done'() {
    state.settings.introDone = true;
    save();
    render();
  },
  async 'check-mic'() {
    const msg = $('check-msg');
    try {
      await Sound.openMic(state.settings.deviceId);
    } catch (e) {
      msg.textContent = micErrorText(e);
      return;
    }
    // Ohne Signalquelle wurde das Mikrofon waehrend der Anfrage wieder geschlossen.
    if (!Sound.frame()) return;
    if (!checkActive) {
      checkActive = true;
      checkLoop();
    }
    $('check-mic').hidden = true;
    fillDevices();
  },
  'check-tone'() {
    stopPlayback();
    Sound.playSeq([{ from: 69, to: 69, dur: 1.5 }]);
  },
  export() {
    const p = profile();
    const blob = new Blob([JSON.stringify({ vokaltrainer: 1, profile: p }, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `vokaltrainer-${p.name.replace(/[^\w-]+/g, '_')}.json`);
  },
  'add-profile'() {
    const p = newProfile(`Profil ${state.profiles.length + 1}`);
    state.profiles.push(p);
    state.activeId = p.id;
    save();
    render();
  },
  'delete-profile'() {
    openDialog(`<div class="stack">
      <h2>Profil „${esc(profile().name)}“ löschen?</h2>
      <p class="small muted">Bewertungen, Verlauf, Matrix-Änderungen und alle Aufnahmen dieses Profils gehen auf diesem Gerät verloren.</p>
      <div class="dialog-actions">
        <button class="ghost" data-action="close-dialog">Abbrechen</button>
        <button class="primary danger-fill" data-action="delete-confirm">Endgültig löschen</button>
      </div></div>`);
  },
  async 'delete-confirm'() {
    const { id, songs } = profile();
    $('dialog').close();
    state.profiles = state.profiles.filter((p) => p.id !== id);
    state.activeId = state.profiles[0].id;
    save();
    render();
    try {
      for (const t of await allTakes()) if (t.slot.startsWith(id + '|')) await deleteTake(t.id);
      for (const s of songs) await deleteSongAudio(s.id);
    } catch (e) { /* ohne Speicher gibt es nichts zu loeschen */ }
  },
};

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-view]');
  if (nav) {
    stopPlayback();
    view = nav.dataset.view;
    render();
    return;
  }
  const el = e.target.closest('[data-action]');
  if (el && !el.disabled && actions[el.dataset.action]) {
    // iOS gibt Audio nur im Tastendruck frei, viele Wiedergaben starten aber erst nach einem await.
    Sound.ctx();
    actions[el.dataset.action](el);
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.name === 'set-volume') {
    state.settings.volume = Number(t.value);
    Sound.configure({ volume: state.settings.volume });
  }
  if (t.id === 'cell-to') $('cell-plain').textContent = describeTarget(t.value);
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  const p = profile();
  if (t.id === 'profile-select') { state.activeId = t.value; historyZone = null; save(); render(); return; }
  if (t.name === 's-preset') { p.session.preset = t.value; save(); render(); return; }
  if (t.name === 's-zone') { p.session.zone = t.value; save(); render(); return; }
  if (t.name === 's-minutes') { p.session.minutes = Number(t.value); save(); render(); return; }
  if (t.id === 's-group') { p.session.group = t.value; save(); render(); return; }
  if (t.id === 's-warmup') { p.session.warmup = t.checked; save(); return; }
  if (t.name === 'm-zone') { matrixZone = t.value; render(); return; }
  if (t.name === 'h-zone') { historyZone = t.value; render(); return; }
  if (t.name === 'pattern') {
    p.session.pattern = t.value;
    save();
    stopPlayback();
    const { vowel, to } = currentCell();
    $('instruction').innerHTML = stepInstruction(vowel, to);
    return;
  }
  if (t.id === 'live-pitch') {
    state.settings.livePitch = t.checked;
    save();
    if (t.checked) {
      Sound.ctx();
      try {
        await Sound.openMic(state.settings.deviceId);
      } catch (err) {
        state.settings.livePitch = false;
        t.checked = false;
        save();
        setStatus(micErrorText(err));
      }
    }
    syncPitch();
    return;
  }
  if (t.id === 'tone-loop') { run.loop = t.checked; if (!t.checked) stopPlayback(); return; }
  if (t.id === 'drone') { p.session.drone = t.checked; save(); return; }
  if (t.name === 'set-volume') { save(); return; }
  if ((t.name && t.name.endsWith('-notation')) || t.name === 'example-de') {
    if (t.name === 'example-de') state.settings.exampleDe = t.checked;
    else state.settings.notation = t.value;
    save();
    render();
    if ($('dialog').open && $('help-msg')) openHelp();
    return;
  }
  if (t.name === 'set-autoplay') { state.settings.autoplay = t.checked; save(); return; }
  if (t.name && t.name.endsWith('-timbre')) {
    state.settings.timbre = t.value;
    Sound.configure({ timbre: t.value });
    save();
    return;
  }
  if (t.id === 'check-device') {
    state.settings.deviceId = t.value;
    save();
    try {
      await Sound.openMic(t.value);
    } catch (err) {
      $('check-msg').textContent = micErrorText(err);
    }
    return;
  }
  if (t.id === 'p-name') { p.name = t.value.trim() || p.name; save(); render(); return; }
  if (t.id === 'p-voice') {
    p.voice = t.value;
    if (t.value !== 'eigen') p.zones = { z1: [...VOICES[t.value].z1], z2: [...VOICES[t.value].z2] };
    save(); render(); return;
  }
  const zone = t.id && t.id.match(/^p-(z[12])-(lo|hi)$/);
  if (zone) {
    const range = p.zones[zone[1]];
    range[zone[2] === 'lo' ? 0 : 1] = Number(t.value);
    if (range[0] > range[1]) range[zone[2] === 'lo' ? 1 : 0] = Number(t.value);
    save(); render(); return;
  }
  const lv = t.name && t.name.match(/^lv-(\w+)-(cry|twang)$/);
  if (lv) { p.levels[lv[1]][lv[2]] = Number(t.value); save(); return; }
  if (t.id === 'p-import' && t.files[0]) {
    try {
      const data = JSON.parse(await t.files[0].text());
      if (!data.profile || !data.profile.zones || !data.profile.levels) throw new Error('format');
      const imported = { ...upgradeProfile(data.profile), id: uid() };
      state.profiles.push(imported);
      state.activeId = imported.id;
      save();
      render();
    } catch (err) {
      t.value = '';
      $('storage-info').textContent = 'Diese Datei ist kein Vokaltrainer-Profil.';
    }
  }
});

// details meldet das Umschalten nicht als Klick.
document.addEventListener('toggle', (e) => {
  if (e.target.id === 'options') optionsOpen = e.target.open;
}, true);

$('dialog').addEventListener('close', stopCheck);

// Enter speichert, statt den Dialog ohne Speichern zu schliessen.
$('dialog').addEventListener('submit', (e) => e.preventDefault());
$('dialog').addEventListener('keydown', (e) => {
  const form = e.target.closest('form[data-enter]');
  if (e.key === 'Enter' && form && e.target.tagName === 'INPUT') {
    e.preventDefault();
    actions[form.dataset.enter]();
  }
});

// Textfelder brauchen die Tasten immer, andere Eingaben nur, wenn sie per Tastatur angesteuert wurden.
// Nach einem Klick auf ein Muster oder einen Haken muessen Leertaste und Pedal weiter aufnehmen.
let focusByPointer = false;
document.addEventListener('pointerdown', () => { focusByPointer = true; }, true);
const needsKeys = (el) => el.matches('textarea, select, input:not([type="radio"], [type="checkbox"], [type="range"])')
  || (!focusByPointer && el.matches('input, summary'));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') focusByPointer = false;
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if ($('dialog').open || needsKeys(e.target)) return;
  if (e.key === '?') { e.preventDefault(); openHelp(); return; }
  if (!run || run.finished || run.phase === 'warmup') return;
  const rating = run.step >= STEPS.length;
  const key = e.key.toLowerCase();
  const onKey = {
    ' ': () => { if (!rating) toggleRecording(); },
    pagedown: () => { if (!rating) toggleRecording(); },
    t: () => { if (!rating) playTone(); },
    b: () => { if (!rating) playBest(); },
    n: () => { if (!rating) playNewest(); },
    v: () => { if (!rating) playCompare(); },
    o: () => { if (!rating) playOriginal(); },
    z: () => actions['hear-target'](),
    s: () => { stopPlayback(); setStatus(''); },
    escape: () => { stopPlayback(); setStatus(''); },
    arrowright: () => goToStep(run.step + 1),
    arrowleft: () => goToStep(run.step - 1),
    arrowup: () => {
      const next = neighborNote(1);
      if (!rating && stepId() !== 'spoken' && next) changeNote(next);
    },
    arrowdown: () => {
      const prev = neighborNote(-1);
      if (!rating && stepId() !== 'spoken' && prev) changeNote(prev);
    },
  };
  if (rating && ['1', '2', '3'].includes(key)) {
    e.preventDefault();
    saveRating(Number(key));
    nextVowel();
    return;
  }
  if (onKey[key]) {
    e.preventDefault();
    // Sonst schaltet die Leertaste beim Loslassen zusaetzlich das Feld um.
    if (e.target.matches('input, summary')) e.target.blur();
    Sound.ctx();
    onKey[key]();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPlayback();
    if (run && run.rec === 'on') stopRecording();
    stopCheck();
    if (run) Sound.closeMic();
    if (run && !run.finished) logRun();
  } else {
    keepAwake();
    updateClock();
    if (run && !run.finished && state.settings.livePitch) Sound.openMic(state.settings.deviceId).catch(() => {});
  }
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* Offline-Modus ist optional */ });
}

render();
