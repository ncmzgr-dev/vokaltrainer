'use strict';
// Startwerte der Vokalmatrix: je Vokal und Preset [Zone 1, Zone 2].
// Praktische Hypothesen zum Ausprobieren. Jedes Feld ist pro Profil ueberschreibbar.

// examples sind grobe Orientierung, keine feste Zuordnung. helpers sind Einstiegssilben fuer die Muster.
const PRESETS = [
  { id: 'soft', name: 'Soft Mix', songs: 'Pop- und Soul-Balladen', examples: 'Sam Smith, Ed Sheeran', cry: 2, twang: 1,
    direction: 'Schmal und weich, Richtung ʊ, ʌ, ɪ', helpers: ['mum', 'gug', 'wee'] },
  { id: 'bright', name: 'Bright Mix', songs: 'Pop-Rock, AOR, Pop-Musical', examples: 'Steve Perry, Bruno Mars', cry: 1, twang: 2,
    direction: 'Schmal und hell, Richtung ɛ, ɪ', helpers: ['nay', 'nyah', 'neigh'] },
  { id: 'belt', name: 'Belt', songs: 'Rock, Soul-Shout, Musical-Belt', examples: 'Freddie Mercury, Adam Lambert', cry: 0, twang: 2,
    direction: 'Weit und sprechnah, Richtung æ, ɛ, ʌ', helpers: ['hey', 'yeah', 'wow'] },
  { id: 'legit', name: 'Legit', songs: 'Klassisches Musical, Klassik', examples: 'Josh Groban, Michael Ball', cry: 1, twang: 1,
    direction: 'Rund und tief, Richtung ɔ, o, ʊ', helpers: ['no', 'loo', 'mah'] },
];

const LEVELS = ['Wenig', 'Mittel', 'Viel'];
const CRY_CUES = [
  'Cry wenig: klar und sprechnah, ohne Schluchzen.',
  'Cry mittel: ein Hauch von Wimmern im Einsatz.',
  'Cry viel: weinerlich-weicher Einsatz, Kehle bleibt frei.',
];
const TWANG_CUES = [
  'Twang wenig: weich und abgerundet.',
  'Twang mittel: etwas Ring nach vorn, nichts quetschen.',
  'Twang viel: scharfer Hexen- oder Entenklang, ohne Druck.',
];

const GROUPS = [
  { id: 'all', name: 'Alle Vokale' },
  { id: 'mono', name: 'Einzelvokale' },
  { id: 'diph', name: 'Diphthonge' },
  { id: 'r', name: 'R-Verbindungen' },
];

const SLIDE_HINT = 'Gleitlaut erst ganz am Ende, gehalten wird der Zielvokal.';
const R_HINT = 'Zielvokal halten, das R erst am Ende kurz antippen.';

// pair: Woerter, die trotz Modifikation unterscheidbar bleiben sollen. glide: Endlaut bei Diphthongen und R.
const VOWELS = [
  { id: 'i', ipa: 'i', start: 'i', group: 'mono', word: 'see', words: ['see', 'free', 'dream', 'believe'],
    phrase: ['I', 'still', 'be', 'lieve'], pair: 'sheep ↔ ship',
    note: 'Kiefer nicht klemmen. Hoch darf sich das i etwas öffnen.',
    m: { soft: ['i', 'ɪ'], bright: ['i', 'ɪ–e'], belt: ['ɪ', 'e–ɛ'], legit: ['i–y', 'ɪ gerundet'] } },
  { id: 'I', ipa: 'ɪ', start: 'ɪ', group: 'mono', word: 'sit', words: ['sit', 'give', 'live', 'this'],
    phrase: ['Let', 'me', 'live', 'with', 'this'], pair: 'ship ↔ sheep',
    note: 'Bleibt locker und kurz wie in „Mitte“, wird nicht zu i.',
    m: { soft: ['ɪ', 'ɪ–ʊ'], bright: ['ɪ', 'ɪ–ɛ'], belt: ['ɪ–ɛ', 'ɛ'], legit: ['ɪ', 'ʏ'] } },
  { id: 'E', ipa: 'ɛ', start: 'ɛ', group: 'mono', word: 'bed', words: ['bed', 'said', 'again', 'forget'],
    phrase: ['I', 'will', 'not', 'for', 'get'], pair: 'bed ↔ bad',
    note: 'Bleibt von æ unterscheidbar: bed und bad klingen verschieden.',
    m: { soft: ['ɛ', 'ɪ–œ'], bright: ['ɛ', 'ɛ schmal'], belt: ['ɛ', 'æ'], legit: ['ɛ–œ', 'œ'] } },
  { id: 'ae', ipa: 'æ', start: 'æ', group: 'mono', word: 'cat', words: ['cat', 'back', 'stand', 'man'],
    phrase: ['I', 'won\'t', 'look', 'back'], pair: 'bad ↔ bed',
    note: 'Deutsche Falle: wird schnell zu ɛ. Zunge flach und vorn lassen.',
    m: { soft: ['æ–ɛ', 'ɛ'], bright: ['æ schmal', 'ɛ–æ'], belt: ['æ', 'æ–a weit'], legit: ['ɛ–æ', 'ɛ–a'] } },
  { id: 'A', ipa: 'ɑ', start: 'ɑ', group: 'mono', word: 'father', words: ['father', 'top', 'stop', 'heart'],
    phrase: ['Please', 'don\'t', 'ev', 'er', 'stop'], pair: 'cop ↔ cup',
    note: 'Bleibt offen und amerikanisch, nicht zu einem runden o.',
    m: { soft: ['ɑ–ʌ', 'ʌ–ʊ'], bright: ['ɑ–ʌ', 'ʌ hell'], belt: ['ɑ', 'ɑ–æ weit'], legit: ['ɑ–ɔ', 'ɔ'] } },
  { id: 'O', ipa: 'ɔ', start: 'ɔ', group: 'mono', word: 'law', words: ['law', 'all', 'call', 'fall'],
    phrase: ['Now', 'you', 'know', 'it', 'all'], pair: 'caught ↔ coat',
    note: 'Lippen nur leicht runden, sonst wird es zu o.',
    m: { soft: ['ɔ', 'ʊ–o'], bright: ['ɔ–ʌ', 'ʌ schmal'], belt: ['ɔ–ɑ', 'ɑ'], legit: ['ɔ', 'o'] } },
  { id: 'U', ipa: 'ʊ', start: 'ʊ', group: 'mono', word: 'book', words: ['book', 'look', 'good', 'could'],
    phrase: ['Take', 'a', 'good', 'long', 'look'], pair: 'full ↔ fool',
    note: 'Kurz und entspannt, nicht zum langen u werden lassen.',
    m: { soft: ['ʊ', 'ʊ'], bright: ['ʊ', 'ʊ–ʌ'], belt: ['ʊ–ʌ', 'ʌ'], legit: ['ʊ', 'ʊ–o'] } },
  { id: 'u', ipa: 'u', start: 'u', group: 'mono', word: 'you', words: ['you', 'true', 'move', 'through'],
    phrase: ['All', 'I', 'need', 'is', 'you'], pair: 'fool ↔ full',
    note: 'Lippen nicht zuspitzen. Hoch öffnet sich das u Richtung ʊ.',
    m: { soft: ['u–ʊ', 'ʊ'], bright: ['u–ʊ', 'ʊ'], belt: ['ʊ', 'ʊ–ʌ'], legit: ['u', 'ʊ gerundet'] } },
  { id: 'V', ipa: 'ʌ', start: 'ʌ', group: 'mono', word: 'love', words: ['love', 'up', 'run', 'enough'],
    phrase: ['All', 'I', 'want', 'is', 'love'], pair: 'cup ↔ cop',
    note: 'Deutsche Falle: wird schnell zu a. Kürzer und zentraler halten.',
    m: { soft: ['ʌ', 'ʊ–ʌ'], bright: ['ʌ', 'ʌ schmal'], belt: ['ʌ', 'ɑ–ʌ weit'], legit: ['ʌ–ɔ', 'ɔ–ʌ'] } },
  { id: 'Er', ipa: 'ɝ', start: 'ɝ', group: 'mono', word: 'her', words: ['her', 'hurt', 'word', 'world'],
    phrase: ['This', 'is', 'how', 'it', 'hurts'], pair: 'bird ↔ bud',
    note: 'Deutsche Falle: klingt wie ö. Hoch die R-Färbung zurücknehmen und spät schließen.',
    m: { soft: ['ʌ–œ', 'œ–ʊ'], bright: ['ɝ locker', 'ʌ–œ'], belt: ['ɝ–ʌ', 'ʌ'], legit: ['œ', 'œ–ʊ'] } },
  { id: 'eI', ipa: 'eɪ', start: 'e', glide: 'ɪ', group: 'diph', word: 'say', words: ['say', 'day', 'away', 'stay'],
    phrase: ['Please', 'don\'t', 'go', 'a', 'way'], pair: 'late ↔ let',
    note: 'Deutsche Falle: reines e ohne Gleitlaut. ' + SLIDE_HINT,
    m: { soft: ['e', 'e–ɪ'], bright: ['e', 'e–ɛ'], belt: ['e–ɛ', 'ɛ'], legit: ['e', 'e–ø'] } },
  { id: 'oU', ipa: 'oʊ', start: 'o', glide: 'ʊ', group: 'diph', word: 'go', words: ['go', 'know', 'home', 'alone'],
    phrase: ['I', 'can\'t', 'let', 'you', 'go'], pair: 'coat ↔ caught',
    note: 'Deutsche Falle: reines o ohne Gleitlaut. ' + SLIDE_HINT,
    m: { soft: ['o', 'ʊ'], bright: ['o', 'o–ʌ'], belt: ['o–ɔ', 'ɔ–ʌ'], legit: ['o', 'o'] } },
  { id: 'aI', ipa: 'aɪ', start: 'a', glide: 'ɪ', group: 'diph', word: 'my', words: ['my', 'night', 'time', 'life'],
    phrase: ['This', 'is', 'my', 'whole', 'life'], pair: 'like ↔ lack',
    note: SLIDE_HINT,
    m: { soft: ['a–ʌ', 'ʌ'], bright: ['a', 'ʌ–a hell'], belt: ['a', 'a–æ weit'], legit: ['a–ɑ', 'ɑ–ɔ'] } },
  { id: 'aU', ipa: 'aʊ', start: 'a', glide: 'ʊ', group: 'diph', word: 'now', words: ['now', 'down', 'out', 'around'],
    phrase: ['I', 'need', 'you', 'right', 'now'], pair: 'town ↔ ton',
    note: SLIDE_HINT,
    m: { soft: ['a–ʌ', 'ʌ–ʊ'], bright: ['a', 'ʌ–a'], belt: ['a', 'a–æ weit'], legit: ['ɑ', 'ɑ–ɔ'] } },
  { id: 'OI', ipa: 'ɔɪ', start: 'ɔ', glide: 'ɪ', group: 'diph', word: 'boy', words: ['boy', 'voice', 'joy', 'choice'],
    phrase: ['Lift', 'up', 'your', 'voice'], pair: 'boy ↔ buy',
    note: SLIDE_HINT,
    m: { soft: ['ɔ', 'ʊ–o'], bright: ['ɔ–ʌ', 'ʌ schmal'], belt: ['ɔ–ɑ', 'ɑ'], legit: ['ɔ', 'o'] } },
  { id: 'Ir', ipa: 'ɪr', start: 'ɪ', glide: 'r', group: 'r', word: 'here', words: ['here', 'near', 'fear', 'clear'],
    phrase: ['I', 'want', 'you', 'right', 'here'], pair: 'here ↔ hair',
    note: R_HINT,
    m: { soft: ['ɪ', 'ɪ–ʊ'], bright: ['ɪ', 'ɪ–ɛ'], belt: ['ɪ–ɛ', 'ɛ'], legit: ['ɪ', 'ʏ'] } },
  { id: 'Er2', ipa: 'ɛr', start: 'ɛ', glide: 'r', group: 'r', word: 'there', words: ['there', 'care', 'where', 'share'],
    phrase: ['I', 'will', 'still', 'be', 'there'], pair: 'hair ↔ here',
    note: R_HINT,
    m: { soft: ['ɛ', 'ɛ–œ'], bright: ['ɛ', 'ɛ schmal'], belt: ['ɛ', 'æ–ɛ'], legit: ['ɛ–œ', 'œ'] } },
  { id: 'Ar', ipa: 'ɑr', start: 'ɑ', glide: 'r', group: 'r', word: 'heart', words: ['heart', 'far', 'start', 'dark'],
    phrase: ['Deep', 'in', 'side', 'my', 'heart'], pair: 'heart ↔ hurt',
    note: R_HINT,
    m: { soft: ['ɑ–ʌ', 'ʌ–ʊ'], bright: ['ɑ–ʌ', 'ʌ hell'], belt: ['ɑ', 'ɑ–æ weit'], legit: ['ɑ–ɔ', 'ɔ'] } },
  { id: 'Or', ipa: 'ɔr', start: 'ɔ', glide: 'r', group: 'r', word: 'more', words: ['more', 'door', 'before', 'for'],
    phrase: ['I', 'can\'t', 'take', 'much', 'more'], pair: 'more ↔ mar',
    note: R_HINT,
    m: { soft: ['ɔ', 'ʊ–o'], bright: ['ɔ–ʌ', 'ʌ schmal'], belt: ['ɔ–ɑ', 'ɑ'], legit: ['ɔ', 'o'] } },
  { id: 'aIr', ipa: 'aɪr', start: 'a', glide: 'r', group: 'r', word: 'fire', words: ['fire', 'higher', 'desire', 'tired'],
    phrase: ['We', 'are', 'set', 'on', 'fire'], pair: 'fire ↔ far',
    note: R_HINT,
    m: { soft: ['a–ʌ', 'ʌ'], bright: ['a', 'ʌ–a hell'], belt: ['a', 'a–æ weit'], legit: ['a–ɑ', 'ɑ–ɔ'] } },
];

// MIDI-Bereiche der Zonen je Stimmlage. Die Matrix ist auf Tenor abgestimmt.
const VOICES = {
  tenor: { name: 'Tenor', z1: [64, 68], z2: [69, 72] },
  bariton: { name: 'Bariton', z1: [62, 66], z2: [67, 70] },
  eigen: { name: 'Eigene Zonen', z1: [64, 68], z2: [69, 72] },
};

// Die ids bleiben stabil, weil gespeicherte Takes daran haengen.
const STEPS = [
  { id: 'spoken', name: 'Sprechen' },
  { id: 'slide', name: 'Muster' },
  { id: 'word', name: 'Wort' },
  { id: 'phrase', name: 'Phrase' },
];

// offsets in Halbtoenen relativ zum Zielton, der letzte Hochpunkt liegt immer auf dem Zielton.
const PATTERNS = [
  { id: 'slide', name: 'Slide', text: 'Gleite ohne Stufen nach oben.' },
  { id: 'arp', name: 'Dreiklang', text: 'Dreiklang hinauf bis zum Zielton und zurück.', offsets: [-12, -8, -5, 0, -5, -8, -12], top: 3, dur: .5 },
  { id: 'five', name: 'Quintlauf', text: 'Fünf Töne hinauf und zurück.', offsets: [-7, -5, -3, -2, 0, -2, -3, -5, -7], top: 4, dur: .4 },
  { id: 'oct', name: 'Oktave', text: 'Sprung von der tiefen Oktave direkt auf den Zielton.', offsets: [-12, 0], top: 1, dur: .9 },
];

const RATINGS = [
  { id: 1, name: 'Kippt', mark: '✕', hint: 'Bricht weg oder drückt' },
  { id: 2, name: 'Geht', mark: '∼', hint: 'Klappt mit Aufwand' },
  { id: 3, name: 'Sitzt', mark: '✓', hint: 'Frei und wiederholbar' },
];

// Position im Vokaltrapez: x vorn bis hinten, y geschlossen bis offen.
const CHART = {
  i: [.02, .02], y: [.1, .02], 'ɪ': [.2, .18], 'ʏ': [.3, .18], e: [.12, .35], 'ø': [.24, .35],
  'ɛ': [.26, .62], 'œ': [.38, .62], 'æ': [.3, .82], a: [.38, 1], 'ɝ': [.57, .46], 'ʌ': [.76, .62],
  'ɑ': [.97, 1], 'ɔ': [.97, .62], o: [.97, .35], 'ʊ': [.8, .18], u: [.98, .02],
};

// Lautschrift im Klartext. en und de sind genaue Beispielwoerter und dienen auch der Hoerprobe.
// nearDe ist eine nur ungefaehre Entsprechung fuer die Anzeige. hint ist die Merkhilfe fuer neue Zeichen.
const IPA = {
  i: { de: 'Biene', en: 'see', tip: 'Lang und gespannt' },
  y: { de: 'über', tip: 'Zunge wie bei i, Lippen rund' },
  'ɪ': { de: 'Mitte', en: 'sit', tip: 'Kurz und locker', hint: 'Ein kleines großes I: kurzes i' },
  'ʏ': { de: 'Hütte', tip: 'Zunge wie bei ɪ, Lippen rund', hint: 'Ein kleines großes Y: kurzes ü' },
  e: { de: 'Beet', tip: 'Geschlossenes e' },
  'ø': { de: 'schön', tip: 'Zunge wie bei e, Lippen rund', hint: 'Ein durchgestrichenes o: langes ö' },
  'ɛ': { de: 'Bett', en: 'bed', tip: 'Offenes e', hint: 'Wie das Euro-Zeichen: offenes e' },
  'œ': { de: 'können', tip: 'Zunge wie bei ɛ, Lippen rund', hint: 'o und e verschmolzen: offenes ö' },
  'æ': { nearDe: 'Bär', en: 'cat', tip: 'Zwischen „Bett“ und „Mann“, Zunge flach und vorn', hint: 'a und e verschmolzen: klingt auch dazwischen' },
  a: { de: 'Mann', tip: 'Helles a' },
  'ɝ': { en: 'her', tip: 'Zunge zurück, Lippen locker, kein ö', hint: 'Eine gespiegelte 3 mit Haken: Der Haken ist das R' },
  'ʌ': { nearDe: 'Kamm', en: 'love', tip: 'Wie „Kamm“, nur kürzer und zentraler', hint: 'Ein umgedrehtes v: kurzes, dunkles a' },
  'ɑ': { nearDe: 'Vater', en: 'father', tip: 'Offen und hinten, dunkler als „Vater“', hint: 'Das runde a aus der Handschrift: dunkles a' },
  'ɔ': { de: 'Sonne', en: 'law', tip: 'Offen, wenig Rundung', hint: 'Ein o mit Lücke: offenes o' },
  o: { de: 'Boot', tip: 'Geschlossen und rund' },
  'ʊ': { de: 'Mutter', en: 'book', tip: 'Kurz und locker', hint: 'Ein Hufeisen, ein u mit Öffnung: kurzes u' },
  u: { de: 'Buch', en: 'you', tip: 'Lang und rund' },
};

// Deutsche Klanghilfe zu den gesungenen Vokalen. Fuer ɝ gibt es keine brauchbare Entsprechung.
const VOWEL_DE = {
  i: 'Biene', I: 'Mitte', E: 'Bett', ae: '≈ Bär', A: '≈ Vater', O: 'Sonne', U: 'Mutter', u: 'Buch', V: '≈ Kamm',
  eI: '≈ Beet', oU: '≈ Boot', aI: 'Mai', aU: 'Haus', OI: 'Heu', Ir: '≈ Bier', Er2: '≈ Bär', Ar: '≈ Bart', Or: '≈ Ohr', aIr: '≈ Feier',
};

// Grobe maennliche Formantwerte F1, F2, F3 in Hz fuer die synthetischen Hoerbeispiele.
const FORMANTS = {
  i: [290, 2250, 2950], y: [280, 1800, 2300], 'ɪ': [400, 1950, 2600], 'ʏ': [400, 1500, 2300],
  e: [450, 2050, 2650], 'ø': [440, 1500, 2300], 'ɛ': [550, 1800, 2500], 'œ': [580, 1400, 2400],
  'æ': [680, 1700, 2450], a: [750, 1300, 2500], 'ɝ': [480, 1350, 1700], 'ʌ': [620, 1200, 2500],
  'ɑ': [720, 1100, 2500], 'ɔ': [570, 850, 2450], o: [470, 950, 2400], 'ʊ': [440, 1050, 2300], u: [310, 870, 2250],
};

const DESCRIPTORS = {
  schmal: 'Mundwinkel nicht breit ziehen, Raum eher schmal.',
  hell: 'Klang nach vorn und hell halten.',
  weit: 'Mund weit öffnen, Kiefer fallen lassen.',
  gerundet: 'Lippen leicht runden.',
  locker: 'R-Färbung nur andeuten.',
};

const TERMS = [
  ['Cry', 'Weicher, leicht weinerlicher Einsatz. Hilft, hohe Töne leicht zu halten.'],
  ['Twang', 'Scharfer, heller Klang wie Ente oder Hexe. Trägt, ohne Druck zu brauchen.'],
  ['Passaggio', 'Der Übergang, in dem Vokale zu kippen beginnen. Hier beginnt die Modifikation.'],
  ['Obere Zone', 'Der hohe Fokusbereich. Hier verändern sich die Vokale am stärksten.'],
  ['Bester Take', 'Deine eigene Aufnahme als Vergleichsziel. Markiere nur, was frei und gut klingt.'],
  ['Cent', 'Ein Hundertstel Halbton. Die Tonkurve zeigt, wie weit du neben dem Zielton liegst. Vibrato ist dabei normal.'],
];

const SHORTCUTS = [
  ['Leertaste oder Bild ab', 'Aufnahme starten oder stoppen'],
  ['T', 'Ton spielen'],
  ['B', 'Besten Take hören'],
  ['N', 'Neuesten Take hören'],
  ['V', 'Im Wechsel vergleichen'],
  ['O', 'Originalstelle hören (bei Songs)'],
  ['Z', 'Zielvokal hören'],
  ['S oder Esc', 'Wiedergabe stoppen'],
  ['↑ ↓', 'Zielton wechseln'],
  ['← →', 'Schritt zurück oder weiter'],
  ['1 2 3', 'Bewerten: Kippt, Geht, Sitzt'],
  ['?', 'Diese Hilfe öffnen'],
];

// b ist der unterste Ton des Passaggios. Einsingen und Abkuehlen bleiben darunter oder knapp darueber.
const WARMUP = [
  { id: 'lips', name: 'Lippenroller als Sirene', text: 'Lippen locker flattern lassen und dem Ton folgen. Zwei- bis dreimal.',
    seq: (b) => [{ from: b - 12, to: b, dur: 2.5 }, { from: b, to: b - 12, dur: 2.5 }] },
  { id: 'hum', name: 'Summen auf „m“', text: 'Fünf Töne hinauf und zurück. Vorn in der Maske spüren, zweimal.',
    seq: (b) => [0, 2, 4, 5, 7, 5, 4, 2, 0].map((o) => ({ from: b - 12 + o, to: b - 12 + o, dur: .42, attack: true })) },
  { id: 'ng', name: 'Slide auf „ng“', text: 'Wie am Ende von „sing“. Weich durch den Übergang gleiten, zweimal.',
    seq: (b) => [{ from: b - 7, to: b + 3, dur: 2.5 }, { from: b + 3, to: b - 7, dur: 2.5 }] },
];

const COOLDOWN = { id: 'cool', name: 'Abwärts summen', text: 'Weich auf „m“ nach unten gleiten, zwei- bis dreimal. Danach etwas trinken.',
  seq: (b) => [{ from: b - 5, to: b - 17, dur: 5 }] };
