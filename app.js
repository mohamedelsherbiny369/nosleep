'use strict';

/* ═══ helpers ═══ */
const $ = (id) => document.getElementById(id);
const els = {
  body: document.body,
  pillText: $('pillText'),
  countdown: $('countdown'),
  progressFill: $('progressFill'),
  elapsedRow: $('elapsedRow'),
  elapsedTime: $('elapsedTime'),
  btnStart: $('btnStart'),
  btnPause: $('btnPause'),
  btnStop: $('btnStop'),
  btnReset: $('btnReset'),
  btnPip: $('btnPip'),
  logoBtn: $('logoBtn'),
  presetsRow: $('presetsRow'),
  btnCustom: $('btnCustom'),
  btnUntil: $('btnUntil'),
  customArea: $('customArea'),
  untilArea: $('untilArea'),
  customInput: $('customInput'),
  untilInput: $('untilInput'),
  toast: $('toast'),
  toastText: $('toastText'),
  toastClose: $('toastClose'),
  splash: $('splash'),
  timesupFlash: $('timesupFlash'),
};

function fmt(totalSec) {
  totalSec = Math.max(0, Math.ceil(totalSec));
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return h + ':' + m + ':' + s;
}

/* ═══ travelling light ═══
   Every base edge is cloned ONCE (under-stroke + core) into a single
   group. The clone reuses the SAME path data, so the light always
   travels inside its own drawn line — it can never float off it.
   One set of particles serves both themes: CSS transitions their
   stroke colour on toggle, and render() adjusts their playbackRate
   (18s a lap OFF, 8s ON) without restarting the animation. */
(function buildTravel() {
  const NS = 'http://www.w3.org/2000/svg';
  const edges = document.querySelectorAll('#edges .edge');
  const g = $('travel');
  edges.forEach((edge, i) => {
    const d = edge.getAttribute('d');
    const seam = edge.classList.contains('seam');
    const delay = -((i * 2.39) % 16).toFixed(2) + 's';
    ['t-under', 't-core'].forEach((kind) => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('pathLength', '100');
      p.setAttribute('class', kind + (seam ? ' t-seam' : ''));
      p.style.animationDelay = delay;
      g.appendChild(p);
    });
  });
})();

/* ═══ state ═══ */
const S = {
  mode: 'off',          // 'off' | 'indef' | 'timer'
  paused: false,
  done: false,
  armedSec: 0,
  armedSource: null,    // 'preset' | 'custom' | 'until'
  totalSec: 0,
  remainingMs: 0,
  endAt: 0,
  elapsedBase: 0,
  elapsedStart: 0,
  wakeLock: null,
};

function elapsedMs(now) {
  let ms = S.elapsedBase;
  if (S.mode !== 'off' && !S.paused && S.elapsedStart) ms += now - S.elapsedStart;
  return ms;
}

/* ═══ wake lock ═══ */
async function acquireWake(userInitiated) {
  if (!('wakeLock' in navigator)) {
    if (userInitiated) showToast('Wake Lock is not supported in this browser. The timer will run visually but the screen may still sleep.');
    return;
  }
  try {
    S.wakeLock = await navigator.wakeLock.request('screen');
    S.wakeLock.addEventListener('release', () => { S.wakeLock = null; });
  } catch (e) { /* page not visible or request denied — stay silent */ }
}
function releaseWake() {
  if (S.wakeLock) { try { S.wakeLock.release(); } catch (e) {} S.wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.mode !== 'off' && !S.paused) acquireWake(false);
});

/* ═══ toast ═══ */
let toastTimer = null;
function showToast(msg) {
  if (msg) els.toastText.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 6000);
}
els.toastClose.addEventListener('click', () => els.toast.classList.remove('show'));

/* ═══ session transitions — ONE exit path ═══ */
function beginElapsed(now) { S.elapsedBase = 0; S.elapsedStart = now; }

function startIndef() {
  const now = performance.now();
  S.mode = 'indef'; S.paused = false; S.done = false;
  beginElapsed(now);
  acquireWake(true);
  render();
}

function startTimer() {
  if (!S.armedSec) return;
  const now = performance.now();
  S.mode = 'timer'; S.paused = false; S.done = false;
  S.totalSec = S.armedSec;
  S.remainingMs = S.armedSec * 1000;
  S.endAt = now + S.remainingMs;
  beginElapsed(now);
  acquireWake(true);
  render();
}

function pauseSession() {
  if (S.mode === 'off' || S.paused) return;
  const now = performance.now();
  if (S.mode === 'timer') S.remainingMs = Math.max(0, S.endAt - now);
  S.elapsedBase = elapsedMs(now);
  S.elapsedStart = 0;
  S.paused = true;
  releaseWake();
  render();
}

function resumeSession() {
  if (!S.paused) return;
  const now = performance.now();
  if (S.mode === 'timer') S.endAt = now + S.remainingMs;
  S.elapsedStart = now;
  S.paused = false;
  acquireWake(true);
  render();
}

/* The single OFF exit: every path that ends a session goes through here.
   Theme fully reverts, wake lock releases, elapsed stops and resets. */
function applyOffState() {
  S.mode = 'off';
  S.paused = false;
  S.elapsedBase = 0;
  S.elapsedStart = 0;
  S.remainingMs = 0;
  releaseWake();
}

function stopSession() {           // Stop: end session, keep the armed pick
  applyOffState();
  S.done = false;
  render();
}

function resetAll() {              // Reset: end session, clear the armed pick
  applyOffState();
  S.done = false;
  S.armedSec = 0;
  S.armedSource = null;
  els.customInput.value = '';
  els.untilInput.value = '';
  closeInputs();
  render();
}

let pipDoneUntil = 0;
function finishTimer() {
  applyOffState();
  S.done = true;
  /* flash bursts out of the logo and expands to fill the whole screen */
  const f = els.timesupFlash;
  const r = els.logoBtn.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  f.style.left = cx + 'px';
  f.style.top = cy + 'px';
  const far = Math.max(
    Math.hypot(cx, cy), Math.hypot(innerWidth - cx, cy),
    Math.hypot(cx, innerHeight - cy), Math.hypot(innerWidth - cx, innerHeight - cy));
  /* disc radius = 60 * fs; fs sized so the radius is ~1.33x the farthest
     corner — the glow's soft zone reaches every edge of the screen */
  f.style.setProperty('--fs', Math.ceil(far / 45) + 2);
  f.classList.remove('flashing');
  void f.offsetWidth;                          // restart the animation
  f.classList.add('flashing');
  setTimeout(() => f.classList.remove('flashing'), 3200);
  pipDoneUntil = Date.now() + 3400;            // the mini bar flashes harder
  render();
}

/* ═══ render ═══ */
function render() {
  const now = performance.now();
  const on = S.mode !== 'off';
  els.body.classList.toggle('theme-on', on);
  els.body.classList.toggle('theme-off', !on);
  els.body.classList.toggle('is-paused', S.paused);

  /* travelling light speed: same particles, faster lap while ON.
     playbackRate changes are continuous — the particle never jumps. */
  const rate = on ? 2.25 : 1;
  document.querySelectorAll('#travel path').forEach((p) => {
    p.getAnimations().forEach((a) => { a.playbackRate = rate; });
  });

  /* pill — single text node, swapped instantly */
  let pill;
  if (S.done) pill = "TIME'S UP — SLEEP ALLOWED";
  else if (!on) pill = 'SLEEP ALLOWED';
  else if (S.paused) pill = S.mode === 'timer' ? 'PAUSED — ' + fmt(S.remainingMs / 1000) + ' LEFT' : 'PAUSED';
  else if (S.mode === 'indef') pill = 'NO SLEEP — SCREEN STAYS AWAKE';
  else pill = 'NO SLEEP — ' + fmt(S.remainingMs / 1000) + ' LEFT';
  els.pillText.textContent = pill;

  /* countdown */
  let cd;
  if (S.done) cd = '00:00:00';
  else if (S.mode === 'timer') cd = fmt(S.remainingMs / 1000);
  else if (!on && S.armedSec) cd = fmt(S.armedSec);
  else cd = '00:00:00';
  els.countdown.textContent = cd;

  /* elapsed */
  els.elapsedRow.classList.toggle('show', on);
  els.elapsedTime.textContent = fmt(elapsedMs(now) / 1000);

  /* progress */
  const ratio = (S.mode === 'timer' && S.totalSec)
    ? Math.min(1, Math.max(0, 1 - S.remainingMs / (S.totalSec * 1000)))
    : 0;
  els.progressFill.style.transform = 'scaleX(' + ratio + ')';

  /* buttons */
  els.btnStart.disabled = !((!on && S.armedSec > 0) || S.paused);
  els.btnStart.textContent = S.paused ? 'Resume' : 'Start';
  els.btnStart.classList.toggle('attention', !on && S.armedSec > 0);
  els.btnPause.disabled = !(on && !S.paused);
  els.btnStop.disabled = !on;
  els.btnReset.disabled = !(on || S.armedSec > 0);

  /* presets: selectable only while idle; selection reflects the armed pick */
  els.presetsRow.querySelectorAll('.preset-btn').forEach((b) => { b.disabled = on; });
  els.presetsRow.querySelectorAll('[data-minutes]').forEach((b) => {
    b.classList.toggle('selected', S.armedSource === 'preset' && Number(b.dataset.minutes) * 60 === S.armedSec);
  });
  els.btnCustom.classList.toggle('selected', S.armedSource === 'custom');
  els.btnUntil.classList.toggle('selected', S.armedSource === 'until');

  renderPip();
}

/* dynamic-only refresh (countdown / pill / elapsed / progress while running) */
function renderDynamic() {
  if (S.mode === 'timer' && !S.paused) {
    S.remainingMs = Math.max(0, S.endAt - performance.now());
    if (S.remainingMs <= 0) { finishTimer(); return; }
  }
  render();
}
setInterval(renderDynamic, 100);

/* ═══ controls ═══ */
els.logoBtn.addEventListener('click', () => {
  if (S.mode !== 'off') stopSession();
  else startIndef();
});

els.btnStart.addEventListener('click', () => {
  if (S.paused) resumeSession();
  else if (S.mode === 'off') startTimer();
});
els.btnPause.addEventListener('click', pauseSession);
els.btnStop.addEventListener('click', stopSession);
els.btnReset.addEventListener('click', resetAll);

els.presetsRow.querySelectorAll('[data-minutes]').forEach((b) => {
  b.addEventListener('click', () => {
    if (S.mode !== 'off') return;
    S.armedSec = Number(b.dataset.minutes) * 60;
    S.armedSource = 'preset';
    S.done = false;
    render();
  });
});

function closeInputs() {
  els.customArea.hidden = true;
  els.untilArea.hidden = true;
}
els.btnCustom.addEventListener('click', () => {
  if (S.mode !== 'off') return;
  const opening = els.customArea.hidden;
  closeInputs();
  els.customArea.hidden = !opening;
  if (opening) els.customInput.focus();
});
els.btnUntil.addEventListener('click', () => {
  if (S.mode !== 'off') return;
  const opening = els.untilArea.hidden;
  closeInputs();
  els.untilArea.hidden = !opening;
  if (opening) els.untilInput.focus();
});
els.customInput.addEventListener('input', () => {
  const v = Number(els.customInput.value);
  if (v >= 1 && v <= 720) {
    S.armedSec = Math.round(v) * 60;
    S.armedSource = 'custom';
    S.done = false;
    render();
  }
});
els.untilInput.addEventListener('change', () => {
  const val = els.untilInput.value;
  if (!val) return;
  const parts = val.split(':');
  const target = new Date();
  target.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
  if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
  S.armedSec = Math.round((target.getTime() - Date.now()) / 1000);
  S.armedSource = 'until';
  S.done = false;
  render();
});

/* ═══ PiP mini-window (F9): logo + timer + status, fully synced ═══ */
let pipWin = null;
const PIP_CSS = [
  'body{margin:0;background:#0b0b12;color:#f4f4f8;font-family:Inter,system-ui,sans-serif;display:flex;flex-direction:row;align-items:center;gap:10px;height:100vh;padding:0 12px;overflow:hidden}',
  '.pip-logo{position:relative;height:30px;background:none;border:none;cursor:pointer;padding:0;flex:none}',
  '.pip-logo img{height:100%;display:block;transition:opacity .7s}',
  '.pip-logo .on{position:absolute;inset:0;opacity:0}',
  'body.theme-on .pip-logo .on{opacity:1}',
  'body.theme-on .pip-logo .off{opacity:0}',
  '.pip-count{font-family:"JetBrains Mono",monospace;font-size:17px;font-variant-numeric:tabular-nums;letter-spacing:.03em;white-space:nowrap}',
  'body.theme-on .pip-count{color:#e9c6ff}',
  '.pip-dot{width:6px;height:6px;border-radius:50%;background:#c8c8d0;flex:none;margin-left:auto}',
  'body.theme-on .pip-dot{background:#c355f6;box-shadow:0 0 8px rgba(195,85,246,.9)}',
  'body.pip-done{animation:pipDone .55s ease-in-out 6}',
  '@keyframes pipDone{0%,100%{background:#0b0b12}50%{background:#e9e9f2}}',
  'body.pip-done .pip-count{animation:pipDoneFg .55s ease-in-out 6}',
  '@keyframes pipDoneFg{0%,100%{color:#f4f4f8}50%{color:#111118}}',
].join('\n');

els.btnPip.addEventListener('click', async () => {
  if (!('documentPictureInPicture' in window)) {
    showToast('Pop out is not supported in this browser.');
    return;
  }
  if (pipWin) { pipWin.close(); return; }
  try {
    pipWin = await documentPictureInPicture.requestWindow({ width: 236, height: 56 });
  } catch (e) { return; }
  const doc = pipWin.document;
  const style = doc.createElement('style');
  style.textContent = PIP_CSS;
  doc.head.appendChild(style);
  doc.body.innerHTML =
    '<button class="pip-logo" id="pipLogo" aria-label="Toggle keep-awake">' +
    '<img class="off" src="assets/logo-white.svg" alt="">' +
    '<img class="on" src="assets/logo-purple.svg" alt=""></button>' +
    '<div class="pip-count" id="pipCount">00:00:00</div>' +
    '<span class="pip-dot" id="pipDot"></span>';
  doc.getElementById('pipLogo').addEventListener('click', () => els.logoBtn.click());
  pipWin.addEventListener('pagehide', () => { pipWin = null; });
  renderPip();
});

function renderPip() {
  if (!pipWin) return;
  const doc = pipWin.document;
  doc.body.className = document.body.className + (Date.now() < pipDoneUntil ? ' pip-done' : '');
  const c = doc.getElementById('pipCount');
  if (c) {
    /* the bar shows ONE number: the countdown when a timer runs,
       otherwise the count-up of how long the screen has been awake */
    c.textContent = S.mode === 'timer'
      ? els.countdown.textContent
      : (S.mode !== 'off' ? els.elapsedTime.textContent : '00:00:00');
  }
}

/* ═══ splash: lines draw in, the logo ignites at centre, then the SAME
   logo flies to the page logo's exact spot while the black fades away ═══ */
function dismissSplash() {
  const sp = els.splash;
  if (!sp || sp.dataset.done) return;
  sp.dataset.done = '1';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    sp.classList.add('done');
    document.body.classList.remove('pre-splash');
    setTimeout(() => sp.remove(), 550);
    return;
  }
  const logo = sp.querySelector('.splash-logo');
  const target = els.logoBtn.getBoundingClientRect();
  const r = logo.getBoundingClientRect();
  logo.style.animation = 'none';
  logo.style.width = r.width + 'px';
  /* REAL style flush (getBoundingClientRect works on SVG elements;
     offsetWidth does not exist on them — reading it flushed nothing,
     so the transition and the transform landed in the same style
     event and the flight teleported instead of animating) */
  void logo.getBoundingClientRect();
  const dx = (target.left + target.width / 2) - (r.left + r.width / 2);
  const dy = (target.top + target.height / 2) - (r.top + r.height / 2);
  const sc = target.width / r.width;
  logo.style.transition = 'transform .8s cubic-bezier(.25,.7,.25,1)';
  sp.classList.add('bye');
  /* the transform goes on in the NEXT frame — a separate style event
     from the transition definition, so the flight always animates */
  requestAnimationFrame(() => {
    logo.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + sc + ')';
  });
  /* the page logo is revealed in the same instant the intro overlay
     goes away: one logo, at rest scale, exactly where the flight
     landed — no overlap window, no swap */
  setTimeout(() => {
    document.body.classList.remove('pre-splash');
    sp.remove();
  }, 1250);
}
if (els.splash) {
  /* stagger the intro's line-draw so the chamber draws itself in */
  els.splash.querySelectorAll('.splash-edges .edge').forEach((p, i) => {
    p.style.animationDelay = (i * 35) + 'ms';
  });
  els.splash.addEventListener('click', dismissSplash);
  /* dismiss only once webfonts have landed: a late font swap moves the
     page logo's position, and flying to a pre-swap position made the
     landing jump on real connections (the test sandbox has no fonts,
     so it could never reproduce this). Hard cap so a hung font can
     never trap the intro. */
  const t0 = performance.now();
  const arm = () => setTimeout(dismissSplash, Math.max(0, 1750 - (performance.now() - t0)));
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(arm);
    setTimeout(() => { if (!els.splash.dataset.done) dismissSplash(); }, 3200);
  } else {
    arm();
  }
}

/* ═══ init ═══ */
render();
