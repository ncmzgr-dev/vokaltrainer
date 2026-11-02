'use strict';
// Darstellung der Lautschrift: nur Woerter, Zeichen mit Beispielwort oder nur Zeichen. Laedt vor app.js.

const NOTATIONS = [
  { value: 'words', label: 'Nur Wörter' },
  { value: 'both', label: 'Zeichen + Wort' },
  { value: 'ipa', label: 'Nur Zeichen' },
];

const notation = () => state.settings.notation;

// Beispielwort eines Zeichens in einer Sprache. Fehlt ein genaues Wort, steht ≈ vor dem naechstbesten.
function exampleWord(sym, lang) {
  const i = IPA[sym];
  if (!i) return '';
  if (i[lang]) return i[lang];
  return lang === 'de' && i.nearDe ? `≈ ${i.nearDe}` : '';
}

// Wort in der gewaehlten Sprache. Ohne Entsprechung springt die andere Sprache mit Hinweis ein.
function soundWord(sym) {
  const lang = state.settings.exampleDe ? 'de' : 'en';
  const word = exampleWord(sym, lang);
  if (word) return word;
  return lang === 'de' ? `engl. ${exampleWord(sym, 'en')}` : `dt. ${exampleWord(sym, 'de')}`;
}

// Zerlegt einen Zielvokal wie „ɪ–e schmal“ in Zeichen und Zusatz. Eigene Eintraege ohne Lautzeichen bleiben Text.
function parseSound(text) {
  const [head = '', ...rest] = String(text).trim().split(/\s+/);
  const chars = [...head].filter((c) => c !== '–');
  return { head, chars, extra: rest.join(' '), known: chars.length > 0 && chars.every((c) => IPA[c]) };
}

const soundWords = (text) => {
  const { chars, head, known } = parseSound(text);
  return known ? chars.map(soundWord).join('–').replace(/≈ /g, chars.length > 1 ? '≈' : '≈ ') : head;
};

// Zielvokal als Block fuer Listen und Tabellen.
function soundHtml(text) {
  const sym = `<span class="ipa">${esc(text)}</span>`;
  const { known, extra } = parseSound(text);
  if (!known || notation() === 'ipa') return sym;
  if (notation() === 'words') return `<span class="snd-word">${esc(soundWords(text))}${extra ? ` ${esc(extra)}` : ''}</span>`;
  return `<span class="snd">${sym}<span class="snd-word">${esc(soundWords(text))}</span></span>`;
}

// Zielvokal fuer den Lauftext einer Anleitung.
function soundInline(text) {
  const { known, extra } = parseSound(text);
  const sym = `<span class="ipa">${esc(text)}</span>`;
  if (!known || notation() === 'ipa') return sym;
  if (notation() === 'words') return `„${esc(soundWords(text))}“${extra ? ` ${esc(extra)}` : ''}`;
  return `${sym} („${esc(soundWords(text))}“)`;
}

// Der gesungene Vokal. Das englische Wort ist echt gesungener Text, das deutsche nur eine Klanghilfe.
const vowelSymbol = (v) => (notation() === 'words' ? '' : `<span class="ipa">${v.ipa}</span>`);
const vowelExample = (v, word = v.word) => (state.settings.exampleDe && VOWEL_DE[v.id] ? VOWEL_DE[v.id] : word);
const vowelWord = (v, word = v.word) => (state.settings.exampleDe && VOWEL_DE[v.id] ? `${word} · ${VOWEL_DE[v.id]}` : word);

function vowelInline(v) {
  if (notation() === 'ipa') return `<span class="ipa">${v.ipa}</span>`;
  const word = `„${esc(vowelExample(v))}“`;
  return notation() === 'words' ? word : `<span class="ipa">${v.ipa}</span> (${word})`;
}

function vowelOption(v) {
  return notation() === 'words' ? vowelWord(v) : `${v.ipa} wie ${vowelWord(v)}`;
}

// Grosse Zeile in der Uebung: Zeichen gross, Wort darunter. Ohne Zeichen wird das Wort selbst zur Ueberschrift.
function bigSound(symbol, word, accent) {
  const cls = accent ? ' accent' : '';
  if (notation() === 'words' && word) return `<span class="big-word${cls}">${esc(word)}</span>`;
  const big = `<span class="big-ipa${cls}">${esc(symbol)}</span>`;
  return notation() === 'ipa' || !word ? big : `<span class="snd">${big}<span class="snd-word">${esc(word)}</span></span>`;
}

// Macht Lautzeichen in Hinweistexten lesbar. Die Buchstaben i, e, a, o, u und y klingen im Text wie geschrieben.
function glossProse(text) {
  if (notation() === 'ipa') return text;
  return text.replace(/[ɪʏøɛœæɝʌɑɔʊ]/g, (c) => (notation() === 'words' ? `„${soundWord(c)}“` : `${c} („${soundWord(c)}“)`));
}

function likeWord(sym) {
  const word = soundWord(sym);
  if (word.startsWith('≈ ')) return `ungefähr „${word.slice(2)}“`;
  if (word.startsWith('dt. ')) return `deutsch „${word.slice(4)}“`;
  if (word.startsWith('engl. ')) return `englisch „${word.slice(6)}“`;
  return `„${word}“`;
}

function exampleSwitch() {
  return `<label class="switch"><span>Englisch</span><input type="checkbox" name="example-de" aria-label="Deutsche Beispielwörter"${state.settings.exampleDe ? ' checked' : ''}><i aria-hidden="true"></i><span>Deutsch</span></label>`;
}

function notationControls(prefix) {
  return `<div class="notation">
    ${radios(`${prefix}-notation`, NOTATIONS, notation())}
    ${exampleSwitch()}
  </div>`;
}
