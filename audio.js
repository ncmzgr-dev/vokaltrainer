'use strict';
// Referenztoene, Mikrofonaufnahme und Wiedergabe der Takes.

const Sound = (() => {
  const HARMONICS = {
    bright: [1, .55, .3, .16, .09, .05, .03],
    soft: [1, .22, .07, .02],
  };
  const MAX_DECODED = 12;
  const TARGET_RMS = .12;
  const MAX_GAIN = 6;
  const VOWEL_GAIN = 2;

  let context = null;
  let stream = null;
  let streamDevice = '';
  let micSource = null;
  let analyser = null;
  let recorder = null;
  let pendingMic = null;
  let stopCount = 0;
  let volume = .6;
  let timbre = 'bright';
  const waves = {};
  const voices = new Set();
  const decoded = new Map();

  const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

  function ctx() {
    if (!context) context = new (window.AudioContext || window.webkitAudioContext)();
    // iOS meldet nach Unterbrechungen auch den Zustand interrupted.
    if (context.state !== 'running') context.resume();
    return context;
  }

  function waveFor(name) {
    if (!waves[name]) {
      const imag = new Float32Array([0, ...HARMONICS[name]]);
      waves[name] = ctx().createPeriodicWave(new Float32Array(imag.length), imag);
    }
    return waves[name];
  }

  function configure(opts) {
    if (opts.volume !== undefined) volume = opts.volume / 100;
    if (opts.timbre && HARMONICS[opts.timbre]) timbre = opts.timbre;
  }

  // seq: [{from, to, dur, attack}] in MIDI und Sekunden. attack setzt den Ton neu an. share daempft den Ton, etwa zum Mitlaufen.
  function playSeq(seq, share = 1) {
    const c = ctx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    const level = Math.max(.0002, .33 * volume * share);
    osc.setPeriodicWave(waveFor(timbre));
    osc.connect(gain).connect(c.destination);
    const start = c.currentTime + .03;
    let t = start;
    gain.gain.setValueAtTime(.0001, t);
    seq.forEach((seg, i) => {
      osc.frequency.setValueAtTime(hz(seg.from), t);
      if (seg.to !== seg.from) osc.frequency.exponentialRampToValueAtTime(hz(seg.to), t + seg.dur);
      if (i === 0 || seg.attack) {
        gain.gain.setValueAtTime(.0001, t);
        gain.gain.linearRampToValueAtTime(level, t + .035);
      }
      const next = seq[i + 1];
      if (next && next.attack) {
        gain.gain.setValueAtTime(level, t + seg.dur - .05);
        gain.gain.linearRampToValueAtTime(.0001, t + seg.dur - .005);
      }
      t += seg.dur;
    });
    gain.gain.setValueAtTime(level, t - .1);
    gain.gain.linearRampToValueAtTime(.0001, t);
    osc.start(start);
    osc.stop(t + .02);
    return track(osc);
  }

  // Synthetischer Vokal: Saegezahn durch drei Formantfilter. Mit to wandern die Formanten vom Start zum Ziel.
  function buildVowel(c, dest, midi, from, to, start, dur, level) {
    const bandwidths = [90, 110, 170];
    const weights = [1, .55, .3];
    const end = start + dur;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = hz(midi);
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = 5.5;
    depth.gain.value = hz(midi) * .012;
    lfo.connect(depth).connect(osc.frequency);
    const out = c.createGain();
    from.forEach((f, i) => {
      const band = c.createBiquadFilter();
      const weight = c.createGain();
      band.type = 'bandpass';
      band.Q.value = f / bandwidths[i];
      band.frequency.setValueAtTime(f, start);
      if (to) {
        band.frequency.setValueAtTime(f, start + dur * .15);
        band.frequency.linearRampToValueAtTime(to[i], start + dur * .85);
      }
      weight.gain.value = weights[i];
      osc.connect(band).connect(weight).connect(out);
    });
    // Vokale mit einer Harmonischen direkt auf F1 waeren sonst viel lauter als andere.
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -24;
    limiter.ratio.value = 12;
    limiter.attack.value = .005;
    limiter.release.value = .1;
    out.connect(limiter).connect(dest);
    out.gain.setValueAtTime(.0001, start);
    out.gain.linearRampToValueAtTime(level, start + .07);
    out.gain.setValueAtTime(level, end - .12);
    out.gain.linearRampToValueAtTime(.0001, end);
    osc.start(start);
    lfo.start(start);
    osc.stop(end + .02);
    lfo.stop(end + .02);
    return osc;
  }

  function playVowel(midi, from, to, dur = 2.2) {
    const c = ctx();
    return track(buildVowel(c, c.destination, midi, from, to, c.currentTime + .03, dur, Math.max(.0002, VOWEL_GAIN * volume)));
  }

  function track(node) {
    const voice = { node };
    voice.done = new Promise((resolve) => {
      node.onended = () => { voices.delete(voice); resolve(); };
    });
    voices.add(voice);
    return voice;
  }

  function stopAll() {
    stopCount += 1;
    voices.forEach((v) => { try { v.node.stop(); } catch (e) { /* schon beendet */ } });
    voices.clear();
  }

  // Findet den gesungenen Bereich und die Verstaerkung, damit Takes beim Vergleich gleich laut sind.
  function analyse(buffer) {
    const data = buffer.getChannelData(0);
    const frame = Math.max(1, Math.round(buffer.sampleRate * .02));
    const frames = [];
    let absPeak = 0;
    for (let i = 0; i + frame <= data.length; i += frame) {
      let sum = 0;
      for (let j = i; j < i + frame; j++) {
        sum += data[j] * data[j];
        absPeak = Math.max(absPeak, Math.abs(data[j]));
      }
      frames.push(Math.sqrt(sum / frame));
    }
    const loudest = frames.reduce((m, v) => Math.max(m, v), 0);
    const gate = Math.max(loudest * .1, .002);
    const first = frames.findIndex((v) => v >= gate);
    if (first < 0) return { buffer, start: 0, end: buffer.duration, gain: 1 };
    let last = frames.length - 1;
    while (last > first && frames[last] < gate) last -= 1;
    const active = frames.slice(first, last + 1);
    const rms = Math.sqrt(active.reduce((s, v) => s + v * v, 0) / active.length);
    const framesPerSecond = buffer.sampleRate / frame;
    return {
      buffer,
      start: Math.max(0, first / framesPerSecond - .05),
      end: Math.min(buffer.duration, (last + 1) / framesPerSecond + .12),
      gain: Math.min(TARGET_RMS / rms, MAX_GAIN, .98 / absPeak),
    };
  }

  async function decode(take) {
    const hit = decoded.get(take.id);
    if (hit) {
      decoded.delete(take.id);
      decoded.set(take.id, hit);
      return hit;
    }
    const buffer = await ctx().decodeAudioData(await take.blob.arrayBuffer());
    const item = analyse(buffer);
    decoded.set(take.id, item);
    if (decoded.size > MAX_DECODED) decoded.delete(decoded.keys().next().value);
    return item;
  }

  function forget(id) {
    decoded.delete(id);
  }

  async function playTake(take) {
    const c = ctx();
    const turn = stopCount;
    const { buffer, start, end, gain } = await decode(take);
    // Wurde waehrend des Dekodierens gestoppt, darf der Take nicht mehr anlaufen.
    if (turn !== stopCount) return { done: Promise.resolve() };
    const src = c.createBufferSource();
    const amp = c.createGain();
    src.buffer = buffer;
    amp.gain.value = gain;
    src.connect(amp).connect(c.destination);
    src.start(0, start, Math.max(.05, end - start));
    return track(src);
  }

  // Spielt einen Ausschnitt aus einem Audio-Element. rate ungleich 1 aendert Tonhoehe und Tempo zusammen.
  function playClip(el, start, end, rate = 1) {
    const voice = {};
    voice.done = new Promise((resolve) => {
      let timer = null;
      let over = false;
      const finish = () => {
        // Ein abgebrochenes play() meldet sich spaeter und darf den naechsten Ausschnitt nicht anhalten.
        if (over) return;
        over = true;
        clearInterval(timer);
        el.pause();
        el.playbackRate = 1;
        ['ended', 'error', 'pause'].forEach((name) => el.removeEventListener(name, finish));
        voices.delete(voice);
        resolve();
      };
      voice.node = { stop: finish };
      el.addEventListener('ended', finish);
      el.addEventListener('error', finish);
      el.preservesPitch = rate === 1;
      el.webkitPreservesPitch = rate === 1;
      el.playbackRate = rate;
      el.currentTime = start;
      el.play().then(() => {
        if (over) return;
        // iOS ignoriert die Startposition, solange die Datei noch nicht geladen ist.
        if (Math.abs(el.currentTime - start) > 1) el.currentTime = start;
        // Erst hier, weil ein vorheriges Anhalten sein pause-Ereignis noch nachliefern kann.
        el.addEventListener('pause', finish);
        timer = setInterval(() => { if (el.currentTime >= end) finish(); }, 30);
      }).catch(finish);
    });
    voices.add(voice);
    return voice;
  }

  // Gleichzeitige Anfragen teilen sich eine. Wird das Mikrofon vorher geschlossen, endet sie ohne offenen Stream.
  function openMic(deviceId = '') {
    if (stream && stream.active && streamDevice === deviceId) return Promise.resolve();
    if (pendingMic && pendingMic.deviceId === deviceId) return pendingMic.promise;
    closeMic();
    const request = { deviceId };
    pendingMic = request;
    request.promise = requestMic(request).finally(() => {
      if (pendingMic === request) pendingMic = null;
    });
    return request.promise;
  }

  async function requestMic(request) {
    if (!window.isSecureContext) throw new Error('insecure');
    if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('unsupported');
    // Browser-Filter wuerden den Stimmklang verfaelschen.
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (request.deviceId) audio.deviceId = { exact: request.deviceId };
    let opened;
    try {
      opened = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (e) {
      if (!request.deviceId || !['OverconstrainedError', 'NotFoundError'].includes(e.name)) throw e;
      delete audio.deviceId;
      opened = await navigator.mediaDevices.getUserMedia({ audio });
    }
    if (pendingMic !== request) {
      opened.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = opened;
    streamDevice = request.deviceId;
    const c = ctx();
    analyser = c.createAnalyser();
    analyser.fftSize = 2048;
    micSource = c.createMediaStreamSource(stream);
    micSource.connect(analyser);
  }

  function closeMic() {
    pendingMic = null;
    if (micSource) micSource.disconnect();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    micSource = null;
    stream = null;
    analyser = null;
  }

  async function listMics() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  function startRec() {
    stopRec();
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
      .find((t) => MediaRecorder.isTypeSupported(t));
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 128000 });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const finished = new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || type }));
    });
    rec.start();
    recorder = rec;
    return finished;
  }

  function stopRec() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorder = null;
  }

  // Rueckgabe: { rms, peak } des aktuellen Mikrofonsignals, 0 bis 1.
  function level() {
    if (!analyser) return { rms: 0, peak: 0 };
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    let peak = 0;
    for (const v of data) {
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    return { rms: Math.sqrt(sum / data.length), peak };
  }

  function frame() {
    if (!analyser) return null;
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    return { data, sampleRate: context.sampleRate };
  }

  // Rueckgabe false, wenn das Geraet keine Stimme fuer die Sprache hat.
  function speak(text, lang = 'en') {
    if (!window.speechSynthesis) return false;
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
    if (!voice) return false;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = .85;
    speechSynthesis.speak(u);
    return true;
  }

  // Chrome laedt die Stimmen erst nach der ersten Abfrage.
  if (window.speechSynthesis) speechSynthesis.getVoices();

  return { ctx, configure, playSeq, playVowel, buildVowel, playTake, playClip, forget, stopAll, openMic, closeMic, listMics, startRec, stopRec, level, frame, speak };
})();
