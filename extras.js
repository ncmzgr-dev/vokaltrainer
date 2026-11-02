'use strict';
// Hoerbeispiele, eigene Proben pro Zeichen, Kontrast-Takes, Blindtest und Komplett-Backup.

/* ---------- Hoerbeispiele ---------- */

const SYNTH_NOTE = 60;

// Bereiche wie ɪ–ʊ klingen als Mittelwert der beiden Vokale.
function formantsFor(text) {
  const parts = [...String(text).trim().split(/\s+/)[0]].map((c) => FORMANTS[c]).filter(Boolean);
  if (!parts.length) return null;
  return [0, 1, 2].map((i) => parts.reduce((s, p) => s + p[i], 0) / parts.length);
}

const sampleSlot = (sym) => `${profile().id}|ipa:${sym}|sample`;

async function ownSample(sym) {
  try {
    return (await takesFor(sampleSlot(sym)))[0] || null;
  } catch (e) {
    return null;
  }
}

async function playSynth(midi, from, to, dur, label) {
  stopPlayback();
  const token = playToken;
  setStatus(label);
  await Sound.playVowel(midi, from, to, dur).done;
  if (token === playToken) setStatus('');
}

/* ---------- Eigene Proben im Hilfe-Dialog ---------- */

let sampleRec = null;

async function fillSamples() {
  for (const cell of document.querySelectorAll('.sample-cell[data-sym]')) {
    const { sym } = cell.dataset;
    const sample = await ownSample(sym);
    if (!cell.isConnected) return;
    const recording = sampleRec && sampleRec.sym === sym;
    cell.innerHTML = `<button class="ghost small" data-action="sample-rec" data-sym="${sym}">${recording ? 'Stopp' : sample ? 'Neu' : 'Aufnehmen'}</button>${sample ? ` <button class="ghost small" data-action="sample-play" data-sym="${sym}">Eigene</button>` : ''}`;
  }
}

async function startSample(sym) {
  stopPlayback();
  if (run && run.rec === 'on') stopRecording();
  const msg = $('help-msg');
  let finished;
  try {
    await Sound.openMic(state.settings.deviceId);
    // Wurde der Dialog inzwischen geschlossen, wird nichts mehr aufgenommen.
    if (!$('dialog').open) {
      releaseMic();
      return;
    }
    finished = Sound.startRec();
  } catch (e) {
    msg.textContent = micErrorText(e);
    return;
  }
  const session = { sym, startedAt: performance.now() };
  session.limit = setTimeout(() => { if (sampleRec === session) stopSample(); }, 10000);
  sampleRec = session;
  msg.textContent = `Aufnahme läuft: Singe ${sym} wie ${likeWord(sym)} locker und gehalten. Tippe danach auf Stopp.`;
  fillSamples();
  const blob = await finished;
  clearTimeout(session.limit);
  const ms = Math.round(performance.now() - session.startedAt);
  if (ms < 300 || !blob.size) return;
  const slot = sampleSlot(sym);
  try {
    for (const t of await takesFor(slot)) await deleteTake(t.id);
    await putTake({ id: uid(), slot, midi: 0, at: Date.now(), ms, blob, isRef: false });
  } catch (e) {
    if ($('help-msg')) $('help-msg').textContent = 'Die Probe konnte nicht gespeichert werden.';
    return;
  }
  if ($('help-msg')) $('help-msg').textContent = `Probe für ${sym} gespeichert. Sie erklingt künftig beim Knopf „Ziel hören“.`;
  fillSamples();
}

function stopSample() {
  if (!sampleRec) return;
  sampleRec = null;
  Sound.stopRec();
  releaseMic();
}

$('dialog').addEventListener('close', () => {
  stopSample();
  // Ein abgebrochener Blindtest spielt nicht weiter.
  if (blind) {
    stopPlayback();
    blind = null;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopSample();
});

/* ---------- Kontrast-Takes ---------- */

async function playContrast() {
  const takes = await currentTakes();
  const original = takes.find((t) => t.kind === 'orig');
  const modified = takes.find((t) => t.kind !== 'orig' && !t.isRef) || takes.find((t) => t.kind !== 'orig');
  if (!original || !modified) return;
  stopPlayback();
  await playAlternating('Spielt: Originalvokal', () => Sound.playTake(original), 'Spielt: modifiziert', () => Sound.playTake(modified));
}

/* ---------- Blindtest ---------- */

const BLIND_SIZE = 10;
let blind = null;

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Pro Feld oder Song-Stelle der neueste Wort-Take. Originalvokale zaehlen nicht.
function blindItem(take) {
  const parts = take.slot.split('|');
  if (parts[1].startsWith('spot:')) {
    if (parts[2] !== 'word') return null;
    const id = parts[1].slice(5);
    for (const song of profile().songs) {
      const spot = song.spots.find((s) => s.id === id);
      if (spot) return { take, word: spot.word, vowel: vowelById(spot.vowelId), preset: song.preset };
    }
    return null;
  }
  if (parts[4] !== 'word') return null;
  const vowel = vowelById(parts[1]);
  return vowel ? { take, word: take.word || vowel.word, vowel, preset: parts[2] } : null;
}

async function blindItems() {
  const prefix = `${profile().id}|`;
  const newest = new Map();
  for (const t of await allTakes()) {
    if (!t.slot.startsWith(prefix) || t.kind === 'orig') continue;
    const old = newest.get(t.slot);
    if (!old || old.at < t.at) newest.set(t.slot, t);
  }
  return shuffled([...newest.values()].map(blindItem).filter(Boolean)).slice(0, BLIND_SIZE);
}

function blindOptions(item) {
  const lower = item.word.toLowerCase();
  const near = item.vowel.pair.split(' ↔ ').filter((w) => w.toLowerCase() !== lower);
  const far = shuffled(VOWELS.filter((v) => v.id !== item.vowel.id).map((v) => v.word));
  const distractors = [...new Set([...near, ...far])].filter((w) => w.toLowerCase() !== lower).slice(0, 2);
  return shuffled([item.word, ...distractors]);
}

async function playBlindItem() {
  stopPlayback();
  try {
    await Sound.playTake(blind.items[blind.index].take);
  } catch (e) { /* Lässt sich der Take nicht abspielen, bleibt „Nicht verstanden“ */ }
}

function renderBlind() {
  const item = blind.items[blind.index];
  if (blind.done) {
    const missed = blind.answers.filter((a) => !a.ok);
    openDialog(`<div class="stack">
      <h2>${blind.answers.length - missed.length} von ${blind.answers.length} verstanden</h2>
      ${missed.length ? `<p class="small muted">Diese Wörter kamen nicht klar an. Nimm die Modifikation dort etwas zurück.</p>
      <ul class="cues small">${missed.map((a) => `<li><b>${esc(a.word)}</b>: gehört als ${esc(a.heard)}</li>`).join('')}</ul>` : '<p class="small muted">Alle Wörter kamen klar an.</p>'}
      <div class="dialog-actions"><button class="primary" data-action="blind-close">Fertig</button></div>
    </div>`);
    return;
  }
  const answered = blind.answer;
  openDialog(`<div class="stack">
    <h2>Welches Wort hörst du?</h2>
    <p class="small muted">Aufnahme ${blind.index + 1} von ${blind.items.length}. Die zweite Person hört, ohne vorher aufs Wort zu schauen.</p>
    <div class="row"><button class="secondary" data-action="blind-replay">Nochmal hören</button></div>
    <div class="blind-options">
      ${blind.options.map((w) => `<button class="${answered && w === item.word ? 'primary' : 'ghost'}" data-action="blind-pick" data-word="${esc(w)}"${answered ? ' disabled' : ''}>${esc(w)}</button>`).join('')}
      <button class="ghost" data-action="blind-pick" data-word=""${answered ? ' disabled' : ''}>Nicht verstanden</button>
    </div>
    ${answered ? `<p class="small" aria-live="polite">${answered.ok ? 'Richtig.' : `Gesungen war <b>${esc(item.word)}</b>.`}</p>
    <div class="dialog-actions"><button class="primary" data-action="blind-next">${blind.index === blind.items.length - 1 ? 'Ergebnis zeigen' : 'Weiter'}</button></div>` : ''}
  </div>`);
}

function blindSection() {
  const results = profile().blind;
  const last = results[results.length - 1];
  return `<div>
    <h2 class="label">Verständlichkeit</h2>
    <p class="small muted">Im Blindtest hört die zweite Person deine Wort-Takes und tippt, welches Wort gesungen wurde. So zeigt sich, ob die Modifikation zu weit geht.</p>
    ${last ? `<p class="small">Letzter Test am ${new Date(last.at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}: ${last.right} von ${last.total} verstanden${last.missed.length ? `, unklar waren ${last.missed.map(esc).join(', ')}` : ''}.</p>` : ''}
    <div class="row"><button class="secondary" data-action="blind-start">Blindtest starten</button></div>
    <p class="small muted" id="blind-msg" aria-live="polite"></p>
  </div>`;
}

/* ---------- Zeichen ueben ---------- */

const QUIZ_SIZE = 8;
let quiz = null;

function quizOptions(sym) {
  return shuffled([sym, ...shuffled(Object.keys(IPA).filter((s) => s !== sym)).slice(0, 2)]);
}

function renderQuiz() {
  if (quiz.index >= quiz.items.length) {
    openDialog(`<div class="stack">
      <h2>${quiz.right} von ${quiz.items.length} erkannt</h2>
      <p class="small muted">Wenige Runden reichen. Wenn dir die Zeichen vertraut sind, stell die Anzeige auf „Nur Zeichen“.</p>
      <div class="dialog-actions">
        <button class="ghost" data-action="help">Zurück zur Hilfe</button>
        <button class="primary" data-action="quiz-start">Noch eine Runde</button>
      </div></div>`);
    return;
  }
  const sym = quiz.items[quiz.index];
  const done = quiz.picked !== null;
  openDialog(`<div class="stack">
    <h2>Wie klingt dieses Zeichen?</h2>
    <p class="small muted">Zeichen ${quiz.index + 1} von ${quiz.items.length}</p>
    <p class="quiz-symbol ipa">${sym}</p>
    <div class="blind-options">
      ${quiz.options.map((s) => `<button class="${done && s === sym ? 'primary' : 'ghost'}" data-action="quiz-pick" data-sym="${s}"${done ? ' disabled' : ''}>${esc(soundWord(s))}</button>`).join('')}
    </div>
    ${done ? `<p class="small" aria-live="polite">${quiz.picked === sym ? 'Richtig.' : `Das Zeichen klingt wie ${esc(likeWord(sym))}.`} ${IPA[sym].hint}.</p>
    <div class="dialog-actions"><button class="primary" data-action="quiz-next">Weiter</button></div>` : ''}
  </div>`);
}

/* ---------- Komplett-Backup ---------- */

// Dateiaufbau: Kennung, 4 Byte Laenge, Manifest als JSON, danach alle Audiodaten am Stueck.
const BACKUP_MAGIC = 'VOKALTRAINER1';

async function allSongAudio() {
  return asPromise((await dbStore('songAudio')).getAll());
}

async function makeBackup() {
  const items = [];
  const blobs = [];
  const add = (store, { blob, ...meta }) => {
    items.push({ store, meta, type: blob.type, size: blob.size });
    blobs.push(blob);
  };
  (await allTakes()).forEach((t) => add('takes', t));
  (await allSongAudio()).forEach((a) => add('songAudio', a));
  const manifest = new TextEncoder().encode(JSON.stringify({ version: 1, createdAt: Date.now(), profiles: state.profiles, items }));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, manifest.length);
  return { blob: new Blob([BACKUP_MAGIC, length, manifest, ...blobs], { type: 'application/octet-stream' }), takes: items.filter((i) => i.store === 'takes').length, audio: items.filter((i) => i.store === 'songAudio').length };
}

// Vorhandenes bleibt immer unveraendert, es kommt nur hinzu, was fehlt.
async function restoreBackup(file) {
  const magicSize = BACKUP_MAGIC.length;
  const head = await file.slice(0, magicSize + 4).arrayBuffer();
  if (new TextDecoder().decode(head.slice(0, magicSize)) !== BACKUP_MAGIC) throw new Error('format');
  const manifestSize = new DataView(head).getUint32(magicSize);
  let offset = magicSize + 4;
  const manifest = JSON.parse(await file.slice(offset, offset + manifestSize).text());
  offset += manifestSize;
  // Eine abgeschnittene Datei wuerde sonst unvollstaendige Aufnahmen hinterlassen.
  if (offset + manifest.items.reduce((s, i) => s + i.size, 0) > file.size) throw new Error('format');
  const haveTakes = new Set((await allTakes()).map((t) => t.id));
  const haveAudio = new Set((await allSongAudio()).map((a) => a.id));
  const count = { takes: 0, audio: 0, profiles: 0 };
  for (const item of manifest.items) {
    const end = offset + item.size;
    const have = item.store === 'takes' ? haveTakes : haveAudio;
    if (!have.has(item.meta.id)) {
      const blob = new Blob([await file.slice(offset, end).arrayBuffer()], { type: item.type });
      await asPromise((await dbStore(item.store, 'readwrite')).put({ ...item.meta, blob }));
      if (item.store === 'takes') count.takes += 1;
      else count.audio += 1;
    }
    offset = end;
  }
  const allNow = await allTakes();
  const added = manifest.profiles.filter((p) => !state.profiles.some((own) => own.id === p.id)).map(upgradeProfile);
  count.profiles = added.length;
  if (added.length) {
    // Unberuehrte Startprofile wuerden auf einem neuen Geraet nur doppelte Namen erzeugen.
    state.profiles = [...state.profiles.filter((p) => !isBlankProfile(p, allNow)), ...added];
    if (!state.profiles.some((p) => p.id === state.activeId)) state.activeId = added[0].id;
  }
  save();
  return count;
}

function isBlankProfile(p, takes) {
  return /^Profil \d+$/.test(p.name) && !Object.keys(p.ratings).length && !Object.keys(p.overrides).length
    && !p.log.length && !p.songs.length && !p.blind.length && !takes.some((t) => t.slot.startsWith(`${p.id}|`));
}

/* ---------- Ereignisse ---------- */

Object.assign(actions, {
  async 'hear-target'() {
    const { to } = currentCell();
    const syms = [...to.split(' ')[0]].filter((c) => IPA[c]);
    const sample = syms.length === 1 ? await ownSample(syms[0]) : null;
    if (sample) {
      await playTakeNow(sample, 'Spielt: deine Probe');
      return;
    }
    const formants = formantsFor(to);
    if (formants) await playSynth(run.midi, formants, null, 2.2, 'Spielt: synthetisches Beispiel');
    else setStatus('Für diesen Eintrag gibt es kein Hörbeispiel.');
  },
  'hear-path'() {
    const { vowel, to } = currentCell();
    const from = FORMANTS[vowel.start];
    const end = formantsFor(to);
    if (from && end) playSynth(run.midi, from, end, 3.2, 'Spielt: Weg zum Zielvokal');
  },
  'hear-synth'(el) {
    stopPlayback();
    Sound.playVowel(SYNTH_NOTE, FORMANTS[el.dataset.sym], null, 1.6);
  },
  'sample-rec'(el) {
    if (sampleRec) stopSample();
    else startSample(el.dataset.sym);
  },
  async 'sample-play'(el) {
    const sample = await ownSample(el.dataset.sym);
    if (!sample) return;
    stopPlayback();
    try {
      await Sound.playTake(sample);
    } catch (e) {
      $('help-msg').textContent = 'Diese Probe lässt sich nicht abspielen.';
    }
  },
  'play-contrast': playContrast,
  'quiz-start'() {
    const items = shuffled(Object.keys(IPA).filter((s) => IPA[s].hint)).slice(0, QUIZ_SIZE);
    quiz = { items, index: 0, right: 0, picked: null, options: quizOptions(items[0]) };
    renderQuiz();
  },
  'quiz-pick'(el) {
    const sym = quiz.items[quiz.index];
    quiz.picked = el.dataset.sym;
    if (quiz.picked === sym) quiz.right += 1;
    const lang = state.settings.exampleDe && IPA[sym].de ? 'de' : IPA[sym].en ? 'en' : 'de';
    if (IPA[sym][lang]) Sound.speak(IPA[sym][lang], lang);
    renderQuiz();
  },
  'quiz-next'() {
    quiz.index += 1;
    quiz.picked = null;
    if (quiz.index < quiz.items.length) quiz.options = quizOptions(quiz.items[quiz.index]);
    renderQuiz();
  },
  async 'blind-start'() {
    const items = await blindItems();
    if (items.length < 2) {
      $('blind-msg').textContent = 'Nimm zuerst mindestens zwei Takes im Schritt „Wort“ auf.';
      return;
    }
    blind = { items, index: 0, answers: [], answer: null, done: false, options: blindOptions(items[0]) };
    renderBlind();
    playBlindItem();
  },
  'blind-replay': playBlindItem,
  'blind-pick'(el) {
    const item = blind.items[blind.index];
    const heard = el.dataset.word;
    const ok = heard.toLowerCase() === item.word.toLowerCase();
    blind.answer = { ok };
    blind.answers.push({ ok, word: item.word, heard: heard || 'nicht verstanden' });
    renderBlind();
  },
  'blind-next'() {
    if (blind.index === blind.items.length - 1) {
      stopPlayback();
      blind.done = true;
      const missed = blind.answers.filter((a) => !a.ok).map((a) => a.word);
      const p = profile();
      p.blind.push({ at: Date.now(), total: blind.answers.length, right: blind.answers.length - missed.length, missed });
      p.blind = p.blind.slice(-20);
      save();
      renderBlind();
      return;
    }
    blind.index += 1;
    blind.answer = null;
    blind.options = blindOptions(blind.items[blind.index]);
    renderBlind();
    playBlindItem();
  },
  'blind-close'() {
    stopPlayback();
    blind = null;
    $('dialog').close();
    render();
  },
  async 'backup-make'() {
    const msg = $('backup-msg');
    msg.textContent = 'Backup wird erstellt …';
    try {
      const { blob, takes, audio } = await makeBackup();
      downloadBlob(blob, `vokaltrainer-backup-${new Date().toISOString().slice(0, 10)}.vtb`);
      msg.textContent = `Backup mit ${takes} Aufnahmen und ${audio} Audiodateien erstellt (${(blob.size / 1048576).toFixed(1)} MB).`;
    } catch (e) {
      msg.textContent = 'Das Backup konnte nicht erstellt werden.';
    }
  },
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.name === 'take-kind') {
    run.takeKind = t.value;
    return;
  }
  if (t.id === 'backup-file' && t.files[0]) {
    const file = t.files[0];
    t.value = '';
    const msg = $('backup-msg');
    msg.textContent = 'Backup wird eingespielt …';
    try {
      const count = await restoreBackup(file);
      render();
      $('backup-msg').textContent = `Übernommen: ${count.takes} Aufnahmen, ${count.audio} Audiodateien, ${count.profiles} Profile. Vorhandenes bleibt unverändert.`;
    } catch (err) {
      msg.textContent = 'Diese Datei ist kein gültiges Backup.';
    }
  }
});
