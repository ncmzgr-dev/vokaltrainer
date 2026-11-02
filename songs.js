'use strict';
// Song-Werkbank: Songs mit Stil und schwierigen Stellen, Vergleich mit dem Original, UltraStar-Import.

/* ---------- Vokal-Vorschlag ---------- */

// Haeufige Songwoerter, deren Schreibweise in die Irre fuehrt. Das Ergebnis ist immer nur ein Vorschlag.
const WORD_VOWELS = {};
Object.entries({
  i: 'me we be she he see need believe free dream please people feel real',
  I: 'it is in if this his give live been sing thing will still with him',
  E: 'said again head dead bread breath friend ever never every let get yes',
  ae: 'have that man hand stand back can at as and am sad last ask dance',
  A: 'father on got not want stop top hot',
  O: 'all call fall saw law walk talk small always wrong long song strong gone lost thought caught',
  U: 'good look book could would should took stood put full',
  u: 'you do to who two through true blue too move lose soon moon new knew view room',
  V: 'love come some done one won what was from of up run us just enough touch but blood above cut',
  Er: 'her hurt word world work heard learn earth first turn burn were girl bird sir',
  eI: 'they say way day away stay make take break great pain rain name change face place wait',
  oU: 'go no so know show low slow grow oh home alone only own soul hold old cold road though don\'t won\'t broke hope open',
  aI: 'i my i\'m time night light right life fly sky why by die try cry high mind find eyes like smile inside',
  aU: 'now down out how about around sound ground found town loud proud',
  OI: 'boy joy voice choice toy noise enjoy',
  Ir: 'here near fear clear hear ear tear year dear appear disappear',
  Er2: 'there where care share air hair bear wear their stare dare fair prayer square',
  Ar: 'heart far star start dark are car apart hard arm guitar',
  Or: 'more door before for or four your pour floor shore war born storm morning',
  aIr: 'fire higher desire tired inspire liar',
}).forEach(([id, words]) => words.split(' ').forEach((w) => { WORD_VOWELS[w] = id; }));

const SPELLING_RULES = [
  [/(ire|yre|igher)$/, 'aIr'],
  [/(ear|eer|ere)$/, 'Ir'],
  [/(air|are)$/, 'Er2'],
  [/ar[a-z]?$/, 'Ar'],
  [/(or|ore|oor|our|oar|orn|ord|ort)$/, 'Or'],
  [/(er|ir|ur)[a-z]*$/, 'Er'],
  [/igh|y$|ie$|i[a-z]e$/, 'aI'],
  [/oy|oi/, 'OI'],
  [/ay|ai|ei|a[a-z]e$/, 'eI'],
  [/ou|ow$|own$/, 'aU'],
  [/oa|o[a-z]e$|o$|old$/, 'oU'],
  [/oo|ue$|ew$|u[a-z]e$/, 'u'],
  [/ee|ea|e[a-z]e$|e$/, 'i'],
  [/a/, 'ae'], [/e/, 'E'], [/i/, 'I'], [/o/, 'A'], [/u/, 'V'],
];

function suggestVowel(text) {
  const t = String(text).toLowerCase().replace(/[^a-z']/g, '');
  if (!t) return null;
  if (WORD_VOWELS[t]) return WORD_VOWELS[t];
  const rule = SPELLING_RULES.find(([re]) => re.test(t));
  return rule ? rule[1] : null;
}

/* ---------- UltraStar ---------- */

// Format: Kopfzeilen mit #, Noten als ": Beat Laenge Tonhoehe Text", Zeilenwechsel mit -, Ende mit E.
function parseUltraStar(text) {
  const song = { title: '', artist: '', bpm: 0, gap: 0, audio: '', relative: false, notes: [] };
  let line = 0;
  let wordIndex = -1;
  let wordOpen = false;
  let syllable = '';
  let player = 1;
  const words = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw[0] === '#') {
      const m = /^#([^:]+):(.*)$/.exec(raw);
      if (!m) continue;
      const key = m[1].trim().toUpperCase();
      const value = m[2].trim();
      if (key === 'TITLE') song.title = value;
      else if (key === 'ARTIST') song.artist = value;
      else if (key === 'BPM') song.bpm = parseFloat(value.replace(',', '.')) || 0;
      else if (key === 'GAP') song.gap = parseFloat(value.replace(',', '.')) || 0;
      else if (key === 'MP3' || key === 'AUDIO') song.audio = value;
      else if (key === 'RELATIVE') song.relative = /yes/i.test(value);
      continue;
    }
    const kind = raw[0];
    if (kind === 'E') break;
    if (kind === 'P') { player = Number(raw.replace(/\D/g, '')) || player; continue; }
    if (player !== 1) continue;
    if (kind === '-') { line += 1; wordOpen = false; continue; }
    const m = /^[:*FRG]\s*(-?\d+)\s+(\d+)\s+(-?\d+) ?(.*)$/.exec(raw);
    if (!m) continue;
    const noteText = m[4];
    const held = noteText.trim() === '~' || noteText.trim() === '';
    if (!held) {
      if (!wordOpen || noteText.startsWith(' ')) {
        wordIndex += 1;
        words[wordIndex] = '';
      }
      words[wordIndex] += noteText.trim();
      syllable = noteText.trim();
      wordOpen = !noteText.endsWith(' ');
    }
    if (wordIndex < 0) continue;
    song.notes.push({
      beat: Number(m[1]), len: Number(m[2]), pitch: Number(m[3]),
      free: 'FRG'.includes(kind), text: noteText, syllable, wordIndex, line,
    });
  }
  song.notes.forEach((n) => { n.word = words[n.wordIndex].replace(/[^\p{L}']/gu, ''); });
  return song;
}

const beatSeconds = (song, beat) => song.gap / 1000 + (beat * 60) / (song.bpm * 4);

// UltraStar-Dateien sind oft nicht in der gesungenen Oktave notiert. Vorschlag: hoechster Ton bleibt knapp unter der Zonengrenze.
function suggestOctave(song, top) {
  const highest = song.notes.filter((n) => !n.free).reduce((m, n) => Math.max(m, n.pitch), -Infinity);
  return 12 * Math.floor((top - (60 + highest)) / 12);
}

function findSpots(song, shift, lo, hi, limit = 30) {
  const lines = new Map();
  song.notes.forEach((n) => {
    const l = lines.get(n.line) || { text: '', start: n.beat, end: n.beat + n.len };
    if (n.text.trim() !== '~') l.text += n.text;
    l.start = Math.min(l.start, n.beat);
    l.end = Math.max(l.end, n.beat + n.len);
    lines.set(n.line, l);
  });
  const seen = new Set();
  const hits = [];
  song.notes.forEach((n) => {
    const midi = 60 + n.pitch + shift;
    const key = `${n.word.toLowerCase()}|${midi}`;
    if (n.free || !n.word || midi < lo || midi > hi || seen.has(key)) return;
    seen.add(key);
    hits.push({ note: n, midi });
  });
  const chosen = hits.length > limit
    ? [...hits].sort((a, b) => b.midi - a.midi).slice(0, limit).sort((a, b) => a.note.beat - b.note.beat)
    : hits;
  return chosen.map(({ note, midi }) => {
    const l = lines.get(note.line);
    return {
      id: uid(), word: note.word, line: l.text.trim().replace(/\s+/g, ' ').replace(/~/g, ''), midi,
      vowelId: suggestVowel(note.syllable) || suggestVowel(note.word) || 'V', guessed: true,
      start: Math.max(0, beatSeconds(song, l.start) - .2), end: beatSeconds(song, l.end) + .2, rating: null,
    };
  });
}

async function readTextFile(file) {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (e) {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/* ---------- Song-Logik ---------- */

let openSongId = null;
let pendingImport = null;

const songById = (id) => profile().songs.find((s) => s.id === id);
const sungMidi = (song, spot) => spot.midi + song.transpose;
const zoneFor = (midi) => (midi >= profile().zones.z2[0] ? 'z2' : 'z1');
const hasClip = (song, spot) => !!song.hasAudio && spot.end > spot.start;

// Fuer den Vergleich hoert man das Original in der gesungenen Tonart. Ganze Oktaven bleiben unveraendert.
function pitchRate(song) {
  const semitones = ((song.transpose % 12) + 18) % 12 - 6;
  return 2 ** (semitones / 12);
}

function fmtTime(sec) {
  if (!(sec >= 0)) return '–';
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(1).padStart(4, '0')}`;
}

function newSong(title, preset) {
  return { id: uid(), title, artist: '', preset, transpose: 0, hasAudio: false, audioName: '', spots: [] };
}

function startSpots(song, spots, warmup) {
  startRun(spots.map((s) => s.vowelId), song.preset, 'z2', 0, warmup, { song, spots });
}

/* ---------- Original-Audio ---------- */

async function getSongAudio(id) {
  return asPromise((await dbStore('songAudio')).get(id));
}
async function putSongAudio(id, blob, name) {
  await asPromise((await dbStore('songAudio', 'readwrite')).put({ id, blob, name }));
}
// Ein importiertes Profil kann denselben Song mitsamt Audiodatei noch nutzen.
async function deleteSongAudio(id) {
  if (state.profiles.some((p) => p.songs.some((s) => s.id === id && s.hasAudio))) return;
  await asPromise((await dbStore('songAudio', 'readwrite')).delete(id));
}

// Ein einziges Element fuer Seite und Uebung: iOS gibt ein Element nach dem ersten Antippen dauerhaft frei.
const songPlayer = document.createElement('audio');
songPlayer.controls = true;
songPlayer.preload = 'metadata';
songPlayer.className = 'song-player';
let playerSongId = null;
let playerUrl = null;

async function loadPlayer(song) {
  if (playerSongId === song.id && (playerUrl || !song.hasAudio)) return;
  songPlayer.pause();
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  playerUrl = null;
  songPlayer.removeAttribute('src');
  playerSongId = song.id;
  if (!song.hasAudio) return;
  try {
    const rec = await getSongAudio(song.id);
    if (playerSongId !== song.id) return;
    if (rec) {
      playerUrl = URL.createObjectURL(rec.blob);
      songPlayer.src = playerUrl;
    } else {
      // Ein Profil-Import bringt keine Audiodatei mit.
      song.hasAudio = false;
      save();
      render();
    }
  } catch (e) { /* Ohne Datei bleibt der Player leer */ }
}

function afterSongsRender() {
  const song = songById(openSongId);
  if (!song) return;
  const slot = $('player-slot');
  if (slot && song.hasAudio) slot.appendChild(songPlayer);
  loadPlayer(song);
}

/* ---------- Ansichten ---------- */

function songsView() {
  const song = songById(openSongId);
  return song ? songDetailView(song) : songListView();
}

function songListView() {
  const songs = profile().songs;
  return `
  <section class="stack">
    <div class="intro">
      <h1>Songs</h1>
      <p class="muted">Ordne jeden Song einem Stil zu und sammle seine schwierigen Stellen. Daraus wird deine Übung, auf Wunsch im direkten Vergleich mit dem Original.</p>
    </div>
    <div class="controls">
      <button class="primary" data-action="add-song">Neuer Song</button>
      <label class="secondary file-btn">UltraStar-Datei importieren<input type="file" id="us-file" accept=".txt,text/plain"></label>
    </div>
    <p class="small muted" id="songs-msg" aria-live="polite"></p>
    ${songs.length ? `<ul class="song-list">${songs.map((s) => {
    const marks = s.spots.filter((x) => x.rating).map((x) => ratingMark(x.rating)).join('');
    return `<li><button class="song-row" data-action="open-song" data-id="${s.id}">
        <strong>${esc(s.title)}</strong>
        <span class="small muted">${esc(s.artist || 'Ohne Interpret')} · ${presetById(s.preset).name}</span>
        <span class="small">${s.spots.length} ${s.spots.length === 1 ? 'Stelle' : 'Stellen'} ${marks}</span>
      </button></li>`;
  }).join('')}</ul>` : '<p class="muted">Noch keine Songs. Lege einen an oder importiere eine UltraStar-Datei, dann findet der Trainer die hohen Stellen selbst.</p>'}
  </section>`;
}

function semitoneLabel(t) {
  if (t === 0) return 'Keine Verschiebung';
  return `${t > 0 ? '+' : ''}${t} ${Math.abs(t) === 1 ? 'Halbton' : 'Halbtöne'}`;
}

function transposeOptions(selected) {
  let out = '';
  for (let t = -12; t <= 12; t++) out += `<option value="${t}"${t === selected ? ' selected' : ''}>${semitoneLabel(t)}</option>`;
  return out;
}

function spotRow(song, spot) {
  const v = vowelById(spot.vowelId);
  const sung = sungMidi(song, spot);
  const to = target(v, song.preset, zoneFor(sung));
  return `<li class="spot">
    <div class="spot-main">
      <b>${esc(spot.word)}</b>
      <span class="ipa">${v.ipa}</span><span class="muted" aria-hidden="true">→</span><span class="ipa to">${esc(to)}</span>
      <span class="small muted tabular">${noteName(sung)}</span>
      ${spot.rating ? ratingMark(spot.rating) : ''}
      ${spot.guessed ? '<span class="small badge-soft" title="Der Vokal wurde aus der Schreibweise geschätzt">Vokal prüfen</span>' : ''}
    </div>
    ${spot.line ? `<p class="small muted">${esc(spot.line)}</p>` : ''}
    <div class="row spot-actions">
      <button class="secondary small-btn" data-action="practice-spot" data-id="${spot.id}">Üben</button>
      ${song.hasAudio ? `<button class="ghost small" data-action="spot-from" data-id="${spot.id}" id="from-${spot.id}">Von ${fmtTime(spot.start)}</button>
      <button class="ghost small" data-action="spot-to" data-id="${spot.id}" id="to-${spot.id}">Bis ${fmtTime(spot.end)}</button>
      <button class="ghost small" data-action="spot-hear" data-id="${spot.id}">Stelle hören</button>` : ''}
      <button class="ghost small" data-action="edit-spot" data-id="${spot.id}">Bearbeiten</button>
      <button class="ghost small" data-action="del-spot" data-id="${spot.id}">Löschen</button>
    </div>
  </li>`;
}

function songDetailView(song) {
  const pr = presetById(song.preset);
  return `
  <section class="stack song-detail">
    <div class="run-bar"><button class="ghost" data-action="back-songs">Alle Songs</button></div>
    <div class="form-grid">
      <label class="field">Titel<input id="song-title" value="${esc(song.title)}" maxlength="80"></label>
      <label class="field">Interpret<input id="song-artist" value="${esc(song.artist)}" maxlength="80"></label>
      <label class="field">Stil
        <select id="song-preset">${PRESETS.map((p) => `<option value="${p.id}"${p.id === song.preset ? ' selected' : ''}>${p.name}: ${p.songs}</option>`).join('')}</select>
      </label>
      <label class="field">Transposition
        <select id="song-transpose">${transposeOptions(song.transpose)}</select>
      </label>
    </div>
    <p class="small muted">${pr.direction}. Die Transposition verschiebt alle Stellen in deine Tonart.</p>
    <div class="row">
      <button class="primary big" data-action="practice-song"${song.spots.length ? '' : ' disabled'}>Alle Stellen üben</button>
    </div>
    <div>
      <h2 class="label">Schwierige Stellen</h2>
      ${song.spots.length ? `<ul class="spots">${song.spots.map((s) => spotRow(song, s)).join('')}</ul>` : '<p class="small muted">Noch keine Stelle. Trage das Wort und den Ton ein, an dem der Vokal kippt.</p>'}
      <div class="row spot-add"><button class="secondary" data-action="add-spot">Stelle hinzufügen</button></div>
    </div>
    <div>
      <h2 class="label">Original zum Vergleichen</h2>
      <p class="small muted">Eine eigene Audiodatei, die nur auf diesem Gerät bleibt. Spiele sie ab und setze mit „Von“ und „Bis“ die Grenzen einer Stelle auf die aktuelle Position.${song.audioName ? ` Laut Import heißt die Datei ${esc(song.audioName)}.` : ''}</p>
      <div class="controls">
        <label class="secondary file-btn">${song.hasAudio ? 'Andere Datei wählen' : 'Audiodatei wählen'}<input type="file" id="song-audio" accept="audio/*"></label>
        ${song.hasAudio ? '<button class="ghost" data-action="del-audio">Datei entfernen</button>' : ''}
      </div>
      <div id="player-slot"></div>
      <p class="small muted" id="audio-msg" aria-live="polite"></p>
    </div>
    <div class="row"><button class="ghost danger" data-action="delete-song">Song löschen</button></div>
  </section>`;
}

function openSpot(song, spot) {
  const midi = spot ? spot.midi : profile().zones.z2[0] - song.transpose;
  openDialog(`<form method="dialog" class="stack" id="spot-form" data-enter="spot-save" data-spot="${spot ? spot.id : ''}">
    <h2>${spot ? 'Stelle bearbeiten' : 'Neue Stelle'}</h2>
    <label class="field">Wort<input id="spot-word" value="${esc(spot ? spot.word : '')}" maxlength="40" autocomplete="off"></label>
    <label class="field">Textstelle (optional)<input id="spot-line" value="${esc(spot ? spot.line : '')}" maxlength="120" autocomplete="off"></label>
    <div class="form-grid">
      <label class="field">Ton im Original<select id="spot-midi">${noteOptions(midi)}</select></label>
      <label class="field">Vokal<select id="spot-vowel">${VOWELS.map((v) => `<option value="${v.id}"${spot && spot.vowelId === v.id ? ' selected' : ''}>${v.ipa} wie ${v.word}</option>`).join('')}</select></label>
    </div>
    <p class="small muted" id="spot-hint">${spot ? '' : 'Der Vokal wird beim Tippen aus dem Wort geschätzt. Prüfe den Vorschlag.'}</p>
    <div class="dialog-actions">
      <button type="button" class="ghost" data-action="close-dialog">Abbrechen</button>
      <button type="button" class="primary" data-action="spot-save">Speichern</button>
    </div>
  </form>`);
}

function openImport(parsed) {
  pendingImport = parsed;
  const shift = suggestOctave(parsed, profile().zones.z2[1]);
  const options = [-24, -12, 0, 12, 24, shift].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
  openDialog(`<div class="stack">
    <h2>${esc(parsed.title || 'Unbenannter Song')}</h2>
    <p class="small muted">${esc(parsed.artist || 'Ohne Interpret')} · ${parsed.notes.length} Noten</p>
    <div class="form-grid">
      <label class="field">Stil<select id="us-preset">${PRESETS.map((p) => `<option value="${p.id}"${p.id === profile().session.preset ? ' selected' : ''}>${p.name}: ${p.songs}</option>`).join('')}</select></label>
      <label class="field">Oktave<select id="us-shift">${options.map((o) => `<option value="${o}"${o === shift ? ' selected' : ''}>${semitoneLabel(o)}${o === shift ? ' (Vorschlag)' : ''}</option>`).join('')}</select></label>
    </div>
    <p class="small muted">UltraStar-Dateien stehen oft nicht in der gesungenen Oktave. Prüfe daher den höchsten Ton.</p>
    <label class="check"><input type="checkbox" id="us-z1"> Auch den Passaggio ${zoneLabel('z1')} aufnehmen</label>
    <p class="small" id="us-preview" aria-live="polite"></p>
    <div class="dialog-actions">
      <button class="ghost" data-action="close-dialog">Abbrechen</button>
      <button class="primary" data-action="us-confirm" id="us-confirm">Importieren</button>
    </div>
  </div>`);
  previewImport();
}

function importSpots() {
  const shift = Number($('us-shift').value);
  const { z1, z2 } = profile().zones;
  return findSpots(pendingImport, shift, $('us-z1').checked ? z1[0] : z2[0], z2[1]);
}

function previewImport() {
  const spots = importSpots();
  const highest = 60 + pendingImport.notes.filter((n) => !n.free).reduce((m, n) => Math.max(m, n.pitch), -Infinity) + Number($('us-shift').value);
  $('us-preview').textContent = `Höchster Ton ${noteName(highest)}. ${spots.length} ${spots.length === 1 ? 'Stelle' : 'Stellen'} in der Zone gefunden.`;
  $('us-confirm').disabled = !spots.length;
}

/* ---------- Ereignisse ---------- */

function currentDetailSpot(el) {
  const song = songById(openSongId);
  return { song, spot: song.spots.find((s) => s.id === el.dataset.id) };
}

async function deleteSpotTakes(spots) {
  const prefixes = spots.map((s) => `${profile().id}|spot:${s.id}|`);
  for (const t of await allTakes()) if (prefixes.some((p) => t.slot.startsWith(p))) await deleteTake(t.id);
}

Object.assign(actions, {
  'add-song'() {
    const song = newSong('Neuer Song', profile().session.preset);
    profile().songs.push(song);
    openSongId = song.id;
    save();
    render();
    const title = $('song-title');
    title.focus();
    title.select();
  },
  'open-song'(el) {
    openSongId = el.dataset.id;
    render();
    window.scrollTo(0, 0);
  },
  'back-songs'() {
    songPlayer.pause();
    openSongId = null;
    render();
    window.scrollTo(0, 0);
  },
  'practice-song'() {
    const song = songById(openSongId);
    startSpots(song, song.spots, profile().session.warmup);
  },
  'practice-spot'(el) {
    const { song, spot } = currentDetailSpot(el);
    startSpots(song, [spot], false);
  },
  'add-spot'() {
    openSpot(songById(openSongId), null);
  },
  'edit-spot'(el) {
    const { song, spot } = currentDetailSpot(el);
    openSpot(song, spot);
  },
  'spot-save'() {
    const song = songById(openSongId);
    const form = $('spot-form');
    const word = $('spot-word').value.trim();
    if (!word) {
      $('spot-hint').textContent = 'Trage zuerst das Wort ein.';
      $('spot-word').focus();
      return;
    }
    const fields = { word, line: $('spot-line').value.trim(), midi: Number($('spot-midi').value), vowelId: $('spot-vowel').value, guessed: false };
    const old = song.spots.find((s) => s.id === form.dataset.spot);
    if (old) Object.assign(old, fields);
    else song.spots.push({ id: uid(), start: 0, end: 0, rating: null, ...fields });
    save();
    $('dialog').close();
    render();
  },
  async 'del-spot'(el) {
    const { song, spot } = currentDetailSpot(el);
    song.spots = song.spots.filter((s) => s !== spot);
    save();
    render();
    try {
      await deleteSpotTakes([spot]);
    } catch (e) { /* ohne Speicher gibt es nichts zu loeschen */ }
  },
  'spot-from'(el) {
    const { spot } = currentDetailSpot(el);
    spot.start = songPlayer.currentTime;
    if (!(spot.end > spot.start)) {
      spot.end = spot.start + 4;
      $(`to-${spot.id}`).textContent = `Bis ${fmtTime(spot.end)}`;
    }
    el.textContent = `Von ${fmtTime(spot.start)}`;
    save();
  },
  'spot-to'(el) {
    const { spot } = currentDetailSpot(el);
    if (songPlayer.currentTime <= spot.start) {
      $('audio-msg').textContent = 'Das Ende muss hinter dem Anfang liegen. Spiele die Datei bis zum Ende der Stelle.';
      return;
    }
    spot.end = songPlayer.currentTime;
    el.textContent = `Bis ${fmtTime(spot.end)}`;
    $('audio-msg').textContent = '';
    save();
  },
  'spot-hear'(el) {
    const { spot } = currentDetailSpot(el);
    if (!(spot.end > spot.start)) {
      $('audio-msg').textContent = 'Setze zuerst Anfang und Ende dieser Stelle.';
      return;
    }
    stopPlayback();
    Sound.playClip(songPlayer, spot.start, spot.end);
  },
  async 'del-audio'() {
    const song = songById(openSongId);
    songPlayer.pause();
    song.hasAudio = false;
    playerSongId = null;
    save();
    render();
    try { await deleteSongAudio(song.id); } catch (e) { /* ohne Speicher gibt es nichts zu loeschen */ }
  },
  'delete-song'() {
    const song = songById(openSongId);
    openDialog(`<div class="stack">
      <h2>„${esc(song.title)}“ löschen?</h2>
      <p class="small muted">Stellen, Aufnahmen dazu und die Audiodatei gehen auf diesem Gerät verloren.</p>
      <div class="dialog-actions">
        <button class="ghost" data-action="close-dialog">Abbrechen</button>
        <button class="primary danger-fill" data-action="delete-song-confirm">Endgültig löschen</button>
      </div></div>`);
  },
  async 'delete-song-confirm'() {
    const song = songById(openSongId);
    $('dialog').close();
    songPlayer.pause();
    profile().songs = profile().songs.filter((s) => s !== song);
    openSongId = null;
    save();
    render();
    try {
      await deleteSongAudio(song.id);
      await deleteSpotTakes(song.spots);
    } catch (e) { /* ohne Speicher gibt es nichts zu loeschen */ }
  },
  'us-confirm'() {
    const spots = importSpots();
    const song = newSong(pendingImport.title || 'Unbenannter Song', $('us-preset').value);
    song.artist = pendingImport.artist;
    song.audioName = pendingImport.audio;
    song.spots = spots;
    profile().songs.push(song);
    openSongId = song.id;
    pendingImport = null;
    save();
    $('dialog').close();
    render();
    window.scrollTo(0, 0);
  },
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'spot-word' && !$('spot-form').dataset.spot) {
    const id = suggestVowel(e.target.value);
    if (id) $('spot-vowel').value = id;
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  const song = songById(openSongId);
  if (t.id === 'us-shift' || t.id === 'us-z1') { previewImport(); return; }
  if (t.id === 'us-file' && t.files[0]) {
    const msg = $('songs-msg');
    try {
      const parsed = parseUltraStar(await readTextFile(t.files[0]));
      if (parsed.relative) msg.textContent = 'Diese Datei nutzt das relative UltraStar-Format, das der Import noch nicht lesen kann.';
      else if (!parsed.bpm || !parsed.notes.some((n) => !n.free)) msg.textContent = 'In dieser Datei wurden keine UltraStar-Noten gefunden.';
      else { msg.textContent = ''; openImport(parsed); }
    } catch (err) {
      msg.textContent = 'Diese Datei lässt sich nicht lesen.';
    }
    t.value = '';
    return;
  }
  if (!song) return;
  if (t.id === 'song-title') { song.title = t.value.trim() || song.title; save(); return; }
  if (t.id === 'song-artist') { song.artist = t.value.trim(); save(); return; }
  if (t.id === 'song-preset') { song.preset = t.value; save(); render(); return; }
  if (t.id === 'song-transpose') { song.transpose = Number(t.value); save(); render(); return; }
  if (t.id === 'song-audio' && t.files[0]) {
    const file = t.files[0];
    t.value = '';
    try {
      await putSongAudio(song.id, file, file.name);
    } catch (err) {
      $('audio-msg').textContent = 'Die Datei konnte nicht gespeichert werden. Prüfe den freien Speicher.';
      return;
    }
    song.hasAudio = true;
    song.audioName = file.name;
    playerSongId = null;
    save();
    render();
  }
});
