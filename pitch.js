'use strict';
// Tonhoehe live und als Kurve pro Take. Keine Formanten und kein Urteil, nur der Abstand zum Zielton.

const Pitch = (() => {
  const MIN_HZ = 70;
  const MAX_HZ = 1200;
  const MIN_CLARITY = .8;
  const PEAK_RATIO = .9;

  // Halbiert die Abtastrate. Das spart Rechenzeit und reicht fuer Singstimmen.
  function decimate(samples) {
    const out = new Float32Array(samples.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = (samples[2 * i] + samples[2 * i + 1]) / 2;
    return out;
  }

  // McLeod-Verfahren: sucht die Periode, deshalb bleibt es stabil, wenn H2 lauter ist als H1.
  function detect(samples, sampleRate) {
    const x = sampleRate > 32000 ? decimate(samples) : samples;
    const sr = sampleRate > 32000 ? sampleRate / 2 : sampleRate;
    const n = x.length;
    const maxLag = Math.min(Math.floor(sr / MIN_HZ), (n >> 1) - 1);
    const minLag = Math.max(2, Math.floor(sr / MAX_HZ));
    const nsdf = new Float32Array(maxLag + 2);
    for (let tau = 0; tau <= maxLag + 1; tau++) {
      let acf = 0;
      let energy = 0;
      for (let j = 0; j < n - tau; j++) {
        acf += x[j] * x[j + tau];
        energy += x[j] * x[j] + x[j + tau] * x[j + tau];
      }
      nsdf[tau] = energy > 0 ? (2 * acf) / energy : 0;
    }
    let i = 1;
    while (i <= maxLag && nsdf[i] > 0) i += 1;
    const peaks = [];
    let best = 0;
    while (i <= maxLag) {
      while (i <= maxLag && nsdf[i] <= 0) i += 1;
      let peak = -1;
      let value = 0;
      while (i <= maxLag && nsdf[i] > 0) {
        if (nsdf[i] > value) { value = nsdf[i]; peak = i; }
        i += 1;
      }
      if (peak >= minLag) {
        peaks.push(peak);
        best = Math.max(best, value);
      }
    }
    const chosen = peaks.find((p) => nsdf[p] >= best * PEAK_RATIO);
    if (chosen === undefined || nsdf[chosen] < MIN_CLARITY) return null;
    const a = nsdf[chosen - 1];
    const b = nsdf[chosen];
    const c = nsdf[chosen + 1];
    const curve = a - 2 * b + c;
    const shift = curve !== 0 ? (a - c) / (2 * curve) : 0;
    return { hz: sr / (chosen + shift), clarity: b };
  }

  const midi = (hz) => 69 + 12 * Math.log2(hz / 440);

  // Lage im gehaltenen Teil: Der Einsatz faellt weg, der Median bleibt bei Vibrato stabil.
  function heldStats(track, target) {
    if (track.length < 8) return null;
    const cents = track.slice(Math.floor(track.length * .3)).map((p) => (p[1] - target) * 100).sort((a, b) => a - b);
    const at = (q) => cents[Math.floor((cents.length - 1) * q)];
    return { median: Math.round(at(.5)), spread: Math.round((at(.75) - at(.25)) / 2) };
  }

  return { detect, midi, heldStats };
})();

const signedCents = (c) => `${c > 0 ? '+' : c < 0 ? '−' : '±'}${Math.abs(c)} Cent`;

/* ---------- Live-Anzeige ---------- */

const TRAIL_MS = 6000;
let pitchTimer = null;
let pitchTrail = [];
let pendingJump = null;

function pitchWanted() {
  if (!run || run.finished || run.phase === 'warmup') return false;
  if (run.rec === 'on') return true;
  return state.settings.livePitch && run.step < STEPS.length && stepId() !== 'spoken';
}

function syncPitch() {
  const wanted = pitchWanted();
  const panel = $('pitch-panel');
  if (panel) panel.hidden = !wanted;
  if (wanted && !pitchTimer) pitchTimer = setInterval(pitchTick, 50);
  if (!wanted && pitchTimer) {
    clearInterval(pitchTimer);
    pitchTimer = null;
  }
}

// Ein einzelner Oktavsprung ist meist ein Messfehler. Erst der zweite Wert in Folge zaehlt.
function acceptPitch(m, now) {
  const last = pitchTrail[pitchTrail.length - 1];
  if (last && now - last[0] < 200 && Math.abs(m - last[1]) > 7) {
    if (pendingJump === null || Math.abs(pendingJump - m) > 1) {
      pendingJump = m;
      return false;
    }
  }
  pendingJump = null;
  return true;
}

function pitchTick() {
  if (!pitchWanted()) { syncPitch(); return; }
  const now = performance.now();
  const frame = Sound.frame();
  let m = null;
  if (frame) {
    const hit = Pitch.detect(frame.data, frame.sampleRate);
    if (hit) {
      const candidate = Pitch.midi(hit.hz);
      if (acceptPitch(candidate, now)) m = candidate;
    }
  }
  if (m !== null) {
    pitchTrail.push([now, m]);
    if (recSession && recSession.track) recSession.track.push([Math.round(now - recSession.startedAt), Math.round(m * 100) / 100]);
  }
  while (pitchTrail.length && now - pitchTrail[0][0] > TRAIL_MS) pitchTrail.shift();
  drawPitch(now);
  const read = $('pitch-read');
  if (read) {
    if (!frame) read.textContent = 'Das Mikrofon ist noch nicht aktiv.';
    else if (m === null) read.textContent = 'Kein Ton erkannt.';
    else read.textContent = `${noteName(Math.round(m))}, ${signedCents(Math.round((m - run.midi) * 100))} zum Ziel ${noteName(run.midi)}`;
  }
}

function drawPitch(now) {
  const canvas = $('pitch-canvas');
  if (!canvas || !canvas.clientWidth) return;
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * ratio)) {
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
  }
  const ctx2d = canvas.getContext('2d');
  ctx2d.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx2d.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  const seq = refSeq(stepId(), run.midi, currentCell().vowel) || [];
  const low = Math.min(run.midi - 5, ...seq.map((s) => s.from)) - 1;
  const high = run.midi + 2;
  const y = (m) => 6 + ((high - m) / (high - low)) * (h - 12);
  const x = (t) => 34 + (1 - (now - t) / TRAIL_MS) * (w - 42);
  ctx2d.font = `11px ${color('--ui')}`;
  ctx2d.textBaseline = 'middle';
  for (let m = low; m <= high; m++) {
    ctx2d.strokeStyle = color('--line');
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.moveTo(34, y(m));
    ctx2d.lineTo(w - 8, y(m));
    ctx2d.stroke();
    if ((m - run.midi) % 3 === 0) {
      ctx2d.fillStyle = color('--muted');
      ctx2d.fillText(noteName(m), 2, y(m));
    }
  }
  ctx2d.strokeStyle = color('--ink');
  ctx2d.lineWidth = 1.5;
  ctx2d.beginPath();
  ctx2d.moveTo(34, y(run.midi));
  ctx2d.lineTo(w - 8, y(run.midi));
  ctx2d.stroke();
  ctx2d.strokeStyle = color('--series-1');
  ctx2d.lineWidth = 2;
  ctx2d.lineJoin = 'round';
  ctx2d.beginPath();
  pitchTrail.forEach(([t, m], i) => {
    const gap = i === 0 || t - pitchTrail[i - 1][0] > 200;
    if (gap) ctx2d.moveTo(x(t), y(m));
    else ctx2d.lineTo(x(t), y(m));
  });
  ctx2d.stroke();
  const last = pitchTrail[pitchTrail.length - 1];
  if (last && now - last[0] < 200) {
    ctx2d.fillStyle = color('--series-1');
    ctx2d.beginPath();
    ctx2d.arc(x(last[0]), y(last[1]), 4, 0, 2 * Math.PI);
    ctx2d.fill();
  }
}

/* ---------- Kurve pro Take ---------- */

let curveHover = null;

// Die Breite folgt dem Container, damit die Beschriftung auch auf dem Handy lesbar bleibt.
function curveMarkup(series, target, width) {
  const W = Math.max(300, Math.min(760, width || 640));
  const H = 190;
  const L = 38;
  const R = 68;
  const T = 10;
  const B = 24;
  const aligned = series.map((s) => {
    const t0 = s.track[0][0];
    return { ...s, points: s.track.map(([t, m]) => [(t - t0) / 1000, m]) };
  });
  const values = aligned.flatMap((s) => s.points.map((p) => p[1]));
  let low = Math.floor(values.reduce((a, b) => Math.min(a, b), target) - .4);
  let high = Math.ceil(values.reduce((a, b) => Math.max(a, b), target) + .4);
  if (high - low < 4) { high += 1; low -= 1; }
  const duration = Math.max(1, ...aligned.map((s) => s.points[s.points.length - 1][0]));
  const px = (t) => L + (t / duration) * (W - L - R);
  const py = (m) => T + ((high - m) / (high - low)) * (H - T - B);
  const every = high - low > 12 ? 2 : 1;
  let grid = '';
  for (let m = low; m <= high; m++) {
    if ((m - low) % every) continue;
    grid += `<line x1="${L}" x2="${W - R}" y1="${py(m)}" y2="${py(m)}" class="cv-grid"/><text x="${L - 5}" y="${py(m) + 3.5}" text-anchor="end" class="cv-tick">${noteName(m)}</text>`;
  }
  const stepSec = duration > 12 ? 5 : duration > 6 ? 2 : 1;
  let ticks = '';
  for (let t = 0; t <= duration; t += stepSec) ticks += `<text x="${px(t)}" y="${H - 7}" text-anchor="middle" class="cv-tick">${t} s</text>`;
  const paths = aligned.map((s) => {
    let d = '';
    s.points.forEach(([t, m], i) => {
      const gap = i === 0 || t - s.points[i - 1][0] > .2;
      d += `${gap ? 'M' : 'L'}${px(t).toFixed(1)} ${py(m).toFixed(1)}`;
    });
    return `<path d="${d}" class="cv-line ${s.cls}"/>`;
  }).join('');
  const labelYs = [py(target)];
  const labels = aligned.map((s) => {
    const end = s.points[s.points.length - 1];
    let ly = py(end[1]);
    labelYs.forEach((o) => { if (Math.abs(o - ly) < 13) ly = o + 13; });
    labelYs.push(ly);
    return `<text x="${W - R + 6}" y="${ly + 3.5}" class="cv-label">${s.short}</text>`;
  }).join('');
  curveHover = { aligned, duration, W, L, R, target };
  const legend = series.length > 1
    ? `<div class="curve-legend small">${series.map((s) => `<span><i class="sw ${s.cls}"></i>${s.name}</span>`).join('')}<span><i class="sw sw-target"></i>Zielton</span></div>`
    : '';
  return `${legend}<div class="curve-wrap" id="curve-wrap">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tonkurve zum Zielton ${noteName(target)}">
      ${grid}${ticks}
      <line x1="${L}" x2="${W - R}" y1="${py(target)}" y2="${py(target)}" class="cv-target"/>
      <text x="${W - R + 6}" y="${py(target) + 3.5}" class="cv-label">Ziel ${noteName(target)}</text>
      ${paths}${labels}
      <line id="curve-x" x1="0" x2="0" y1="${T}" y2="${H - B}" class="cv-cross" visibility="hidden"/>
    </svg>
    <div class="curve-tip small" id="curve-tip" hidden></div>
  </div>`;
}

function heldText(track, target) {
  const stats = Pitch.heldStats(track, target);
  if (!stats) return '';
  const where = Math.abs(stats.median) < 5 ? `genau auf ${noteName(target)}` : `${Math.abs(stats.median)} Cent ${stats.median < 0 ? 'unter' : 'über'} ${noteName(target)}`;
  return `Neuester Take: Im gehaltenen Teil liegst du ${where}, die Schwankung beträgt etwa ±${stats.spread} Cent.`;
}

function renderCurve(takes) {
  const box = $('curve');
  if (!box) return;
  const newest = takes.find((t) => !t.isRef);
  const best = takes.find((t) => t.isRef);
  const series = [];
  // Gesprochen wird frei, ohne Zielton. Eine Kurve dazu wuerde nur in die Irre fuehren.
  const pitched = stepId() !== 'spoken';
  if (pitched && best && best.pitch && best.pitch.length > 2) series.push({ name: 'Bester Take', short: 'Bester', cls: 'cv-2', track: best.pitch });
  if (pitched && newest && newest.pitch && newest.pitch.length > 2) series.push({ name: 'Neuester Take', short: 'Neuester', cls: 'cv-1', track: newest.pitch });
  if (!series.length) {
    box.innerHTML = '';
    curveHover = null;
    return;
  }
  const midi = (newest || best).midi;
  const text = stepId() === 'word' && newest && newest.pitch ? heldText(newest.pitch, midi) : '';
  box.innerHTML = `${curveMarkup(series, midi, box.clientWidth)}${text ? `<p class="small muted">${text}</p>` : ''}`;
}

function nearestPoint(points, t) {
  let best = points[0];
  for (const p of points) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
  return Math.abs(best[0] - t) < .3 ? best : null;
}

document.addEventListener('pointermove', (e) => {
  const wrap = e.target.closest && e.target.closest('#curve-wrap');
  const tip = $('curve-tip');
  const cross = $('curve-x');
  if (!tip || !cross || !curveHover) return;
  if (!wrap) {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
    return;
  }
  const { aligned, duration, W, L, R, target } = curveHover;
  const box = wrap.querySelector('svg').getBoundingClientRect();
  const px = ((e.clientX - box.left) / box.width) * W;
  const t = Math.max(0, Math.min(duration, ((px - L) / (W - L - R)) * duration));
  const rows = aligned.map((s) => {
    const p = nearestPoint(s.points, t);
    return p ? `${s.short}: ${noteName(Math.round(p[1]))}, ${signedCents(Math.round((p[1] - target) * 100))} zum Ziel` : `${s.short}: kein Ton`;
  });
  tip.innerHTML = [`${t.toFixed(1).replace('.', ',')} s`, ...rows].join('<br>');
  tip.hidden = false;
  const lineX = L + (t / duration) * (W - L - R);
  cross.setAttribute('x1', lineX);
  cross.setAttribute('x2', lineX);
  cross.setAttribute('visibility', 'visible');
  const share = (lineX / W) * box.width;
  tip.style.left = `${Math.min(share + 10, box.width - tip.offsetWidth - 2)}px`;
});
