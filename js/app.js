// app.js — screens, session loop, wiring everything together.

import { PostureEngine, faceFromMatrix } from './pose.js';
import { createPlant, stageForMinutes } from './plant.js';
import { Stats, BADGES } from './stats.js';
import { Alerter, requestNotifyPermission } from './alerts.js';

const $ = id => document.getElementById(id);

const els = {
  screens: {
    welcome: $('screen-welcome'),
    calibrate: $('screen-calibrate'),
    monitor: $('screen-monitor'),
    summary: $('screen-summary'),
  },
  sceneBg: $('scene-bg'),
  sceneStage: $('scene-stage'),
  sceneLayerDawn: $('scene-layer-dawn'),
  sceneLayerDay: $('scene-layer-day'),
  sceneLayerGolden: $('scene-layer-golden'),
  sceneDust: $('scene-dust'),
  scenePlant: $('scene-plant'),

  startBtn: $('start-btn'), startHint: $('start-hint'), startError: $('start-error'),
  welcomeCameraRow: $('welcome-camera-row'), welcomeCamera: $('welcome-camera'), refreshCamsBtn: $('refresh-cams-btn'),
  demoToggle: $('demo-toggle'),
  settingsBtn: $('settings-btn'), settingsModal: $('settings-modal'),
  closeSettingsBtn: $('close-settings-btn'), resetStatsBtn: $('reset-stats-btn'),
  setSensitivity: $('set-sensitivity'), sensitivityVal: $('sensitivity-val'),
  setGoal: $('set-goal'), setSound: $('set-sound'), setNotify: $('set-notify'),
  setAi: $('set-ai'), setAiKey: $('set-ai-key'), aiCoach: $('ai-coach'), aiCoachText: $('ai-coach-text'),
  setAiTips: $('set-ai-tips'), coachStatus: $('coach-status'),
  calibCount: $('calib-count'), calibTitle: $('calib-title'), calibSub: $('calib-sub'),
  video: $('video'), overlay: $('overlay'),
  monitorFrame: document.querySelector('#screen-monitor .camera-frame'),
  calibFrame: document.querySelector('#screen-calibrate .camera-frame'),
  statusPill: $('status-pill'), demoChip: $('demo-chip'),
  statusLabel: $('status-label'), statusIcon: $('status-icon'),
  alignFill: $('align-fill'), calibStep: $('calib-step'), calibProgressFill: $('calib-progress-fill'),
  cameraSelectWrap: $('camera-select-wrap'), cameraSelect: $('camera-select'),
  sessionClock: $('session-clock'), recalibrateBtn: $('recalibrate-btn'), endBtn: $('end-btn'),
  plantHolder: $('plant'), plantCaption: $('plant-caption'), stageFill: $('stage-fill'), stageHint: $('stage-hint'),
  statScore: $('stat-score'), statGood: $('stat-good'), statStreak: $('stat-streak'),
  chart: $('chart'), badges: $('badges'),
  welcomePlant: $('welcome-plant'), summaryPlant: $('summary-plant'),
  sumScore: $('sum-score'), sumTime: $('sum-time'), sumGood: $('sum-good'), sumStreak: $('sum-streak'),
  summaryBadges: $('summary-badges'), summaryMessage: $('summary-message'), summaryTitle: $('summary-title'),
  againBtn: $('again-btn'), homeBtn: $('home-btn'),
  nudge: $('nudge'), toast: $('toast'),
};

const stats = new Stats();
const alerter = new Alerter(els.nudge, $('nudge-text'), () => stats.settings);

const plant = createPlant(els.plantHolder);
const welcomePlant = createPlant(els.welcomePlant);
const summaryPlant = createPlant(els.summaryPlant);
const scenePlant = createPlant(els.scenePlant);

let engine = null;
let tickTimer = null;
let workerTimer = null;
let sessionSec = 0;
let sessionGoodSec = 0;
let sessionViolationSec = {};
let lastStatus = 'none';
let calibrated = false;
let lastBadgeKey = '';

// ---- SceneBackground controller --------------------------------------------
const USE_DIP = true;
let currentSceneStage = 1;
let currentScenePosture = 'good';
let dipTimeout = null;

function setSceneStage(stageNum) {
  stageNum = Math.max(1, Math.min(5, stageNum));
  if (stageNum === currentSceneStage) return;

  const prev = currentSceneStage;
  currentSceneStage = stageNum;

  // golden's room is offset, so dip through near-black between golden (4-5) and non-golden (1-3)
  const isGolden = stageNum >= 4;
  const wasGolden = prev >= 4;
  if (USE_DIP && (isGolden !== wasGolden) && els.sceneBg) {
    els.sceneBg.classList.add('scene-dipping');
    clearTimeout(dipTimeout);
    dipTimeout = setTimeout(() => {
      if (els.sceneBg) els.sceneBg.dataset.stage = String(stageNum);
      setTimeout(() => {
        if (els.sceneBg) els.sceneBg.classList.remove('scene-dipping');
      }, 150);
    }, 150);
  } else if (els.sceneBg) {
    els.sceneBg.dataset.stage = String(stageNum);
  }
}

function setScenePosture(posture) {
  if (posture === currentScenePosture) return;
  currentScenePosture = posture;
  if (els.sceneBg) els.sceneBg.dataset.posture = posture;
}

// Lazy-load day and golden scenes after initial paint without layout shift
function initSceneImages() {
  const day = new Image();
  day.src = 'assets/scene-day.webp';
  day.decode().then(() => {
    if (els.sceneLayerDay) els.sceneLayerDay.src = 'assets/scene-day.webp';
  }).catch(() => {
    if (els.sceneLayerDay) els.sceneLayerDay.src = 'assets/scene-day.webp';
  });

  const golden = new Image();
  golden.src = 'assets/scene-golden.webp';
  golden.decode().then(() => {
    if (els.sceneLayerGolden) els.sceneLayerGolden.src = 'assets/scene-golden.webp';
  }).catch(() => {
    if (els.sceneLayerGolden) els.sceneLayerGolden.src = 'assets/scene-golden.webp';
  });
}

// Pointer parallax: stage shifts 4-8px opposite mouse movement (desktop only)
function initSceneParallax() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isPointerFine = window.matchMedia('(pointer: fine)').matches;
  if (reduceMotion || !isPointerFine || !els.sceneStage) return;

  let rafId = null;
  window.addEventListener('pointermove', e => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const nx = (e.clientX / window.innerWidth - 0.5) * 2;
      const ny = (e.clientY / window.innerHeight - 0.5) * 2;
      els.sceneStage.style.setProperty('--parallax-x', `${(-nx * 6).toFixed(1)}px`);
      els.sceneStage.style.setProperty('--parallax-y', `${(-ny * 4).toFixed(1)}px`);
    });
  }, { passive: true });
}

// Dust motes pause when tab is hidden
function initDustController() {
  document.addEventListener('visibilitychange', () => {
    if (!els.sceneDust) return;
    els.sceneDust.classList.toggle('paused', document.hidden);
  });
}

// D-key debug helper: cycles stage 1-5 and good/bad posture without a webcam
const DEBUG_STATES = [
  { stage: 1, posture: 'good' },
  { stage: 2, posture: 'good' },
  { stage: 3, posture: 'good' },
  { stage: 4, posture: 'good' },
  { stage: 5, posture: 'good' },
  { stage: 1, posture: 'violation' },
  { stage: 2, posture: 'violation' },
  { stage: 3, posture: 'violation' },
  { stage: 4, posture: 'violation' },
  { stage: 5, posture: 'violation' },
];
let debugStateIdx = 0;

function initDebugKey() {
  document.addEventListener('keydown', e => {
    if (e.key === 'd' || e.key === 'D') {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const st = DEBUG_STATES[debugStateIdx];
      debugStateIdx = (debugStateIdx + 1) % DEBUG_STATES.length;
      setSceneStage(st.stage);
      setScenePosture(st.posture);
      welcomePlant.setStage(st.stage - 1);
      welcomePlant.setDroop(st.posture === 'violation');
      plant.setStage(st.stage - 1);
      plant.setDroop(st.posture === 'violation');
      if (scenePlant) {
        scenePlant.setStage(st.stage - 1);
        scenePlant.setDroop(st.posture === 'violation');
      }
    }
  });
}

const STATUS_TEXT = {
  good: 'Sitting tall',
  slouch: 'Slouching',
  neck: 'Tech neck',
  close: 'Too close',
  lean: 'Leaning sideways',
  none: 'No one in frame',
};

// icon shape changes with state so status is not colour-only
const STATUS_ICON = {
  good: '<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="4" fill="currentColor"/></svg>',
  slouch: '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.5 13 12.5H1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 6v3.4M7 11.2v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  neck: '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.5 13 12.5H1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 6v3.4M7 11.2v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.5 13 12.5H1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 6v3.4M7 11.2v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  lean: '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.5 13 12.5H1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 6v3.4M7 11.2v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  none: '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

// ---- AI coach (optional, free Gemini key) ----------------------------------
// One request per session summary. Detection itself never uses the network.

const AI_MODEL = 'gemini-2.0-flash';

async function runAiCoach(report) {
  const s = stats.settings;
  if (!s.aiEnabled || !s.aiKey.trim() || report.sessionSec < 60) {
    els.aiCoach.classList.add('hidden');
    return;
  }
  els.aiCoach.classList.remove('hidden');
  els.aiCoachText.textContent = 'Coach is thinking…';
  const viol = Object.entries(report.violationSec)
    .filter(([, sec]) => sec > 0)
    .map(([id, sec]) => `${id}: ${Math.round(sec / 60)} min`)
    .join(', ') || 'none';
  const prompt =
    `You are a friendly posture coach. A user just finished a webcam posture session. ` +
    `Stats: duration ${Math.round(report.sessionSec / 60)} min, posture score ${report.pct}%, ` +
    `time sitting tall ${Math.round(report.goodSec / 60)} min, problem time by type: ${viol}. ` +
    `Current local time: ${new Date().getHours()}:00-ish. ` +
    `Write 2-3 short, warm, encouraging sentences: name their biggest pattern from the numbers ` +
    `and give one concrete fix for their desk setup or habit. Plain text only, no headings, no lists, no emojis.`;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${encodeURIComponent(s.aiKey.trim())}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: ctrl.signal,
      },
    );
    clearTimeout(timeout);
    if (!res.ok) {
      els.aiCoachText.textContent = res.status === 400 || res.status === 403
        ? 'AI coach: the API key was rejected. Check it in Settings.'
        : `AI coach is unavailable right now (API error ${res.status}).`;
      return;
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('')?.trim();
    els.aiCoachText.textContent = text || 'AI coach: the model returned no advice this time.';
  } catch (err) {
    els.aiCoachText.textContent = err.name === 'AbortError'
      ? 'AI coach timed out. Check your internet connection.'
      : 'AI coach could not be reached (network error).';
  }
}

// how often each violation may re-nudge while it persists
const ALERT_COOLDOWN_MS = { slouch: 20000, neck: 20000, close: 25000, lean: 15000 };
const lastAlertAt = {};

function maybeAlert(id) {
  const now = performance.now();
  if (now - (lastAlertAt[id] ?? -Infinity) >= ALERT_COOLDOWN_MS[id]) {
    lastAlertAt[id] = now;
    alerter.violation(id);
  }
}

// ---------- helpers ----------

function showScreen(name) {
  for (const [key, el] of Object.entries(els.screens)) el.classList.toggle('active', key === name);
  if (els.sceneBg) els.sceneBg.dataset.screen = name;
}

function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

// toasts stack in the corner, each with a thin timer line
function showToast(text, ms = 3800) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  const line = document.createElement('span');
  line.className = 'toast-line';
  line.style.setProperty('--toast-ms', `${ms}ms`);
  el.appendChild(line);
  els.toast.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  }, ms);
}

// One-line coach tip during long sessions (only when the user opted in).
let liveTipInFlight = false;
async function fetchLiveTip() {
  const s = stats.settings;
  if (!s.aiEnabled || !s.aiTips || !s.aiKey.trim() || liveTipInFlight) return;
  liveTipInFlight = true;
  const problems = Object.entries(sessionViolationSec)
    .filter(([, sec]) => sec > 0).sort((a, b) => b[1] - a[1])
    .map(([id]) => id).join(', ') || 'none so far';
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${encodeURIComponent(s.aiKey.trim())}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are a friendly posture coach. Mid-session check-in: ${Math.round(sessionSec / 60)} minutes in, ` +
                `posture score ${stats.todayStats().scorePct}%, problems seen: ${problems}. ` +
                `Send ONE short tip (max 15 words) about their likeliest current issue. Plain text, no emojis, no punctuation at the end.`,
            }],
          }],
        }),
        signal: ctrl.signal,
      },
    );
    clearTimeout(timeout);
    if (!res.ok) return;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('')?.trim();
    if (text) showToast(`Coach: ${text}`, 6000);
  } catch { /* a missed tip is fine */ } finally {
    liveTipInFlight = false;
  }
}

function updateCoachStatus() {
  const s = stats.settings;
  els.coachStatus.classList.toggle('hidden', !(s.aiEnabled && s.aiKey.trim()));
  els.coachStatus.textContent = s.aiTips && s.aiEnabled && s.aiKey.trim()
    ? 'AI coach is on. A report comes when you end a session, plus a live tip every 5 minutes.'
    : 'AI coach is on. A report card appears when you end a session.';
}

const BADGE_ICONS = {
  'first-session': '<path d="M6 3h12l-1.5 17a2 2 0 0 1-2 1.8H9.5a2 2 0 0 1-2-1.8L6 3Z"/><path d="M12 9v6M10 12c1.2-.4 2-1.6 2-3 0 1.4.8 2.6 2 3"/>',
  'session30': '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 1.5"/><path d="M10 2h4M12 2v3"/>',
  'goal-day': '<circle cx="12" cy="9" r="6"/><circle cx="12" cy="9" r="2.5"/><path d="M8.5 14L7 21l5-2.5 5 2.5-1.5-7"/>',
  'score80': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  'streak3': '<path d="M12 3c1 4-4 6-4 10a4 4 0 0 0 8 0c0-1.5-.5-3-1.5-4.5C13 10.5 12.5 12 11.5 12 12.5 9 12.5 5.5 12 3Z"/>',
  'streak7': '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M4.9 19.1l2.2-2.2M16.9 7.1l2.2-2.2"/>',
};

function badgeIcon(id) {
  const path = BADGE_ICONS[id] || BADGE_ICONS['first-session'];
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

function renderBadges(container, earnedIds) {
  container.innerHTML = '';
  for (const b of BADGES) {
    const earned = earnedIds.includes(b.id) || stats.hasBadge(b.id);
    const el = document.createElement('span');
    el.className = 'badge' + (earned ? ' earned' : '');
    el.innerHTML = badgeIcon(b.id) + b.label;
    container.appendChild(el);
  }
}

function updateStatsPanel() {
  const t = stats.todayStats();
  els.statScore.textContent = `${t.scorePct}%`;
  els.statGood.textContent = fmt(t.goodSec);
  els.statStreak.textContent = stats.streak();
  [els.statScore, els.statGood, els.statStreak].forEach(retick);
  renderChart();
}

// small roll when a number changes
function retick(el) {
  if (!el) return;
  const v = el.textContent;
  if (el.dataset.v === v) return;
  el.dataset.v = v;
  el.classList.remove('tick');
  void el.offsetWidth;
  el.classList.add('tick');
}

let chartLabelsEl = null;

function renderChart() {
  const data = stats.chartData();
  els.chart.innerHTML = '';
  els.chart.append(...data.map(d => {
    const bar = document.createElement('div');
    bar.className = 'bar' + (d.isToday ? ' today' : '') + (d.minutes === 0 ? ' empty' : '');
    bar.style.height = `${Math.max(4, d.scorePct)}%`;
    bar.title = d.minutes === 0 ? 'No data' : `${d.minutes} min · ${d.scorePct}% good posture`;
    return bar;
  }));
  if (!chartLabelsEl) {
    chartLabelsEl = document.createElement('div');
    chartLabelsEl.className = 'chart-labels';
    els.chart.after(chartLabelsEl);
  }
  chartLabelsEl.innerHTML = '';
  chartLabelsEl.append(...data.map(d => {
    const s = document.createElement('span');
    s.textContent = d.label;
    return s;
  }));
}

const STAGE_MINS = [0, 5, 12, 20, 30];

function updatePlant() {
  const goodMin = stats.todayStats().goodSec / 60;
  const stage = stageForMinutes(goodMin);
  const caption = plant.setStage(stage);
  if (scenePlant) scenePlant.setStage(stage);
  setSceneStage(stage + 1);
  els.plantCaption.textContent = caption;
  const next = STAGE_MINS[stage + 1];
  if (next === undefined) {
    els.stageFill.style.width = '100%';
    els.stageHint.textContent = 'Max growth. Impressive.';
  } else {
    const cur = STAGE_MINS[stage];
    els.stageFill.style.width = `${Math.min(100, ((goodMin - cur) / (next - cur)) * 100)}%`;
    els.stageHint.textContent = `${Math.ceil(next - goodMin)} more good minutes to grow`;
  }
}

function moveVideo(toCalibrate) {
  (toCalibrate ? els.calibFrame : els.monitorFrame).prepend(els.video);
}

// Fill both camera pickers. The monitor picker only appears when there are 2+
// cameras (nothing to switch between otherwise); the welcome picker shows even
// one camera so you can confirm which one will be used. Labels only become
// readable after camera permission, so this is refreshed after sessions too.
async function refreshCameraPickers() {
  const cams = await PostureEngine.listCameras();
  const saved = stats.settings.cameraId;
  const fill = (sel, { allowSingle }) => {
    if (!cams.length || (cams.length < 2 && !allowSingle)) return false;
    sel.innerHTML = '';
    for (const c of cams) {
      const opt = document.createElement('option');
      opt.value = c.deviceId;
      opt.textContent = c.label;
      sel.appendChild(opt);
    }
    sel.value = saved && cams.some(c => c.deviceId === saved) ? saved : cams[0].deviceId;
    return true;
  };
  els.welcomeCameraRow.classList.toggle('hidden', !fill(els.welcomeCamera, { allowSingle: true }));
  els.cameraSelectWrap.classList.toggle('hidden', !engine || engine.demo || !fill(els.cameraSelect, { allowSingle: false }));
}

function pickCamera(deviceId) {
  stats.updateSettings({ cameraId: deviceId });
  if (engine && !engine.demo) engine.deviceId = deviceId;
}

async function switchCamera(deviceId) {
  if (!engine || engine.demo || engine.calibrating) return;
  try {
    await engine.switchCamera(deviceId);
    pickCamera(deviceId);
    els.welcomeCamera.value = deviceId;
    // a different camera means a different angle — the baseline is stale
    lastStatus = 'none';
    plant.setDroop(false);
    if (scenePlant) scenePlant.setDroop(false);
    alerter.hide();
    moveVideo(true);
    showScreen('calibrate');
    els.calibTitle.textContent = 'New camera. Sit up straight again';
    els.calibSub.textContent = 'A quick 3-second recalibration for the new view.';
    engine.calibrate(
      n => {
          els.calibCount.textContent = n > 0 ? n : '';
          if (n === 3) {
            for (const el of [els.calibCount, els.calibProgressFill]) {
              el.classList.remove(el === els.calibCount ? 'pop' : 'run');
              void el.offsetWidth;
              el.classList.add(el === els.calibCount ? 'pop' : 'run');
            }
          }
        },
      () => {
        calibrated = true;
        lastStatus = 'none';
        moveVideo(false);
        showScreen('monitor');
        showToast('Camera switched.');
      },
    );
  } catch (err) {
    showToast('Could not switch camera. It may be busy.');
    const cur = engine.currentDeviceId();
    if (cur) els.cameraSelect.value = cur;
  }
}

// ---------- session flow ----------

function stopSession() {
  if (workerTimer) { workerTimer.postMessage('stop'); workerTimer.terminate(); workerTimer = null; }
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  if (engine) { engine.stop(); engine = null; }
  alerter.hide();
}

// The session heartbeat runs in a Web Worker: worker timers aren't throttled
// when the tab is hidden, so the clock and stats stay accurate. While hidden,
// posture isn't detected (rendering pauses), so ticks count as 'none'.
function startTicking() {
  const tick = () => {
    sessionSec += 1;
    // While hidden, the worker ticker keeps detection alive (~1 fps); trust the
    // live status unless the engine's heartbeat has gone quiet (page frozen).
    const engineAlive = !engine || (Date.now() - (engine.lastDetectWall || 0)) < 10000;
    const effective = document.hidden && !engineAlive ? 'none' : lastStatus;
    if (effective === 'good') sessionGoodSec += 1;
    if (ALERT_COOLDOWN_MS[effective]) sessionViolationSec[effective] = (sessionViolationSec[effective] ?? 0) + 1;
    stats.recordTick(effective);
    els.sessionClock.textContent = fmt(sessionSec);
    if (sessionSec % 3 === 0) updateStatsPanel();
    if (sessionSec % 5 === 0) updatePlant();
    if (sessionSec % 300 === 0) fetchLiveTip();
    if (sessionSec % 10 === 0) {
      const key = BADGES.filter(b => stats.hasBadge(b.id)).join(',');
      if (key !== lastBadgeKey) { lastBadgeKey = key; renderBadges(els.badges, []); }
      const newBadges = stats.checkBadges(sessionSec);
      if (newBadges.length) { showToast(`${newBadges[0].label} earned`); renderBadges(els.badges, []); }
    }
  };
  try {
    const code = `let id=null;onmessage=e=>{if(e.data==='start'&&!id)id=setInterval(()=>postMessage(1),1000);if(e.data==='stop'){clearInterval(id);id=null;}};`;
    workerTimer = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    workerTimer.onmessage = tick;
    workerTimer.postMessage('start');
  } catch {
    tickTimer = setInterval(tick, 1000);
  }
}

function endSession() {
  stopSession();
  els.demoToggle.disabled = false;
  els.welcomeCamera.disabled = false;
  const pct = sessionSec ? Math.round((sessionGoodSec / sessionSec) * 100) : 0;
  stats.noteSessionLength(sessionSec);
  const newBadges = stats.checkBadges(sessionSec);
  if (newBadges.length) showToast(`${newBadges[0].label} earned`);

  els.sumScore.textContent = sessionSec ? `${pct}%` : '–';
  els.sumTime.textContent = fmt(sessionSec);
  els.sumGood.textContent = fmt(sessionGoodSec);
  els.sumStreak.textContent = `${stats.streak()}`;
  const stage = stageForMinutes(stats.todayStats().goodSec / 60);
  summaryPlant.setStage(stage);
  summaryPlant.setDroop(false);
  if (scenePlant) {
    scenePlant.setStage(stage);
    scenePlant.setDroop(false);
  }
  // Scene state matches the result (high score = golden 4-5, solid = day 3, low = dawn 1-2)
  const resultSceneStage = pct >= 80 ? 5 : pct >= 50 ? 3 : 1;
  setSceneStage(resultSceneStage);
  renderBadges(els.summaryBadges, newBadges.map(b => b.id));
  els.summaryTitle.textContent = 'Session complete';
  els.summaryMessage.textContent =
    pct >= 85 ? 'Spine of steel. Your plant is thriving on this.' :
    pct >= 60 ? 'Solid session. You spent most of it sitting tall.' :
    pct >= 40 ? 'Room to grow. Your plant believes in you.' :
    'Your plant was worried about you. Try a recalibration and sit closer to the screen.';
  showScreen('summary');
  runAiCoach({ sessionSec, pct, goodSec: sessionGoodSec, violationSec: { ...sessionViolationSec } });
}

function handleState({ status, metrics }) {
  // ambient tint + live alignment meter make the detection feel alive
  document.body.dataset.status = status;
  if (metrics?.dropRatio != null) {
    const a = Math.max(0, Math.min(1, metrics.dropRatio));
    els.alignFill.style.width = `${a * 100}%`;
    els.alignFill.dataset.low = a < 0.92 ? '1' : '0';
  }

  const isViolation = !!ALERT_COOLDOWN_MS[status];
  setScenePosture(isViolation ? 'violation' : 'good');

  if (status === lastStatus) {
    if (isViolation && calibrated) maybeAlert(status); // repeat reminder while it persists
    return;
  }
  lastStatus = status;

  els.statusLabel.textContent = STATUS_TEXT[status] ?? 'Checking';
  els.statusIcon.innerHTML = STATUS_ICON[status] ?? '';
  // restart the cross-fade
  els.statusLabel.style.animation = 'none';
  void els.statusLabel.offsetWidth;
  els.statusLabel.style.animation = '';
  els.statusPill.className = 'status-pill ' + status;
  plant.setDroop(status === 'slouch' || status === 'neck');
  if (scenePlant) scenePlant.setDroop(status === 'slouch' || status === 'neck');

  if (isViolation && calibrated) maybeAlert(status);
}

async function beginSession() {
  const demo = els.demoToggle.checked;
  els.startError.classList.add('hidden');
  els.startBtn.disabled = true;
  els.startBtn.classList.add('loading');
  els.demoToggle.disabled = true;
  els.welcomeCamera.disabled = true;
  // still inside the click's user-activation window — the right moment to ask
  if (!demo && stats.settings.notify && 'Notification' in window && Notification.permission === 'default') {
    requestNotifyPermission();
  }
  try {
    stopSession();
    sessionSec = 0;
    sessionGoodSec = 0;
    sessionViolationSec = {};
    lastStatus = 'none';
    calibrated = false;
    engine = new PostureEngine({
      video: els.video,
      canvas: els.overlay,
      demo,
      onState: handleState,
      onError: msg => { els.startError.textContent = msg; els.startError.classList.remove('hidden'); },
      onCameraLost: () => {
        lastStatus = 'none';
        els.statusLabel.textContent = 'Camera lost';
        els.statusPill.className = 'status-pill none';
        showToast('Camera disconnected. Plug it back in or restart the session.');
      },
      onSetupDrift: () => showToast('Setup changed? If you moved the camera or chair, hit Recalibrate.'),
    });
    if (!demo) engine.deviceId = stats.settings.cameraId ?? null;
    await engine.start();
    engine.setSensitivityPct(stats.settings.sensitivity);
    els.demoChip.classList.toggle('hidden', !demo);
    els.video.style.display = demo ? 'none' : '';

    const s = stats.settings;
    if (s.aiEnabled && s.aiKey.trim()) {
      showToast(s.aiTips ? 'AI coach on. Report when you end the session, live tips every 5 minutes.' : 'AI coach on. Your report card appears when you end the session.', 5000);
    }
    if (!demo && !s.notify && 'Notification' in window && Notification.permission !== 'granted') {
      setTimeout(() => showToast('Working in other windows? Turn on desktop notifications in Settings to get posture popups.', 6000), 1500);
    }

    if (demo) {
      els.cameraSelectWrap.classList.add('hidden');
      showScreen('monitor');
      engine.calibrate(() => {}, () => { calibrated = true; });
      showToast('Demo mode: a simulated person cycles through all four posture problems.');
      startTicking();
      updateStatsPanel();
      updatePlant();
      renderBadges(els.badges, []);
    } else {
      await refreshCameraPickers();
      moveVideo(true);
      showScreen('calibrate');
      els.calibStep.textContent = 'Step 1 of 2 · sit tall';
      els.calibTitle.textContent = 'Sit up straight and look at your screen';
      els.calibSub.textContent = 'We\'ll remember what "sitting tall" looks like for you.';
      engine.calibrate(
        n => {
          els.calibCount.textContent = n > 0 ? n : '';
          if (n === 3) {
            for (const el of [els.calibCount, els.calibProgressFill]) {
              el.classList.remove(el === els.calibCount ? 'pop' : 'run');
              void el.offsetWidth;
              el.classList.add(el === els.calibCount ? 'pop' : 'run');
            }
          }
        },
        () => {
          calibrated = true;
          moveVideo(false);
          showScreen('monitor');
          startTicking();
          updateStatsPanel();
          updatePlant();
          renderBadges(els.badges, []);
        },
        phase => {
          if (phase === 2) {
            els.calibStep.textContent = 'Step 2 of 2 · slouch on purpose';
            els.calibTitle.textContent = 'Now slouch like you usually do';
            els.calibSub.textContent = 'Slump and tuck your chin for three seconds. We learn your bad range.';
          }
        },
      );
    }
  } catch (err) {
    const msg = err?.name === 'NotAllowedError'
      ? 'Camera permission was denied. Allow camera access in your browser, or flip on Demo mode to try the app without a camera.'
      : `Couldn't start the camera (${err.message || err}). You can still explore with Demo mode.`;
    els.startError.textContent = msg;
    els.startError.classList.remove('hidden');
    showScreen('welcome');
  } finally {
    els.startBtn.disabled = false;
    els.startBtn.classList.remove('loading');
    if (!engine) { els.demoToggle.disabled = false; els.welcomeCamera.disabled = false; }
  }
}

// ---------- settings ----------

function openSettings() {
  const s = stats.settings;
  els.setSensitivity.value = s.sensitivity;
  els.sensitivityVal.textContent = `${s.sensitivity}%`;
  els.setGoal.value = s.goalMin;
  els.setSound.checked = s.sound;
  els.setNotify.checked = s.notify;
  els.setAi.checked = s.aiEnabled;
  els.setAiKey.value = s.aiKey ?? '';
  els.setAiTips.checked = s.aiTips;
  document.body.classList.add('modal-open'); // keep the modal above animated layers
  els.settingsModal.classList.remove('hidden');
}

function closeSettings() {
  document.body.classList.remove('modal-open');
  els.settingsModal.classList.add('hidden');
}

function wireSettings() {
  els.settingsBtn.addEventListener('click', openSettings);
  els.closeSettingsBtn.addEventListener('click', () => closeSettings());
  els.settingsModal.addEventListener('click', e => { if (e.target === els.settingsModal) closeSettings(); });

  els.setSensitivity.addEventListener('input', () => {
    const v = Number(els.setSensitivity.value);
    els.sensitivityVal.textContent = `${v}%`;
    stats.updateSettings({ sensitivity: v });
    engine?.setSensitivityPct(v);
  });
  els.setGoal.addEventListener('change', () => {
    stats.updateSettings({ goalMin: Math.max(5, Number(els.setGoal.value) || 25) });
  });
  els.setSound.addEventListener('change', () => stats.updateSettings({ sound: els.setSound.checked }));
  els.setNotify.addEventListener('change', async () => {
    if (els.setNotify.checked) {
      const ok = await requestNotifyPermission();
      if (!ok) els.setNotify.checked = false;
      stats.updateSettings({ notify: els.setNotify.checked });
    } else {
      stats.updateSettings({ notify: false });
    }
  });
  els.setAiKey.addEventListener('change', () => {
    stats.updateSettings({ aiKey: els.setAiKey.value.trim() });
    updateCoachStatus();
  });
  els.setAi.addEventListener('change', () => {
    if (els.setAi.checked && !els.setAiKey.value.trim()) els.setAiKey.focus();
    stats.updateSettings({ aiEnabled: els.setAi.checked });
    updateCoachStatus();
  });
  els.setAiTips.addEventListener('change', () => {
    stats.updateSettings({ aiTips: els.setAiTips.checked });
    updateCoachStatus();
  });
  els.resetStatsBtn.addEventListener('click', () => {
    stats.reset();
    updateStatsPanel();
    updatePlant();
    renderBadges(els.badges, []);
    showToast('All stats cleared.');
  });
}

// ---------- static wiring ----------

function init() {
  // Returning to the tab: rendering was paused while hidden, so any in-flight
  // slouch/smoothing state is stale — reset it and nudge the video element.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && engine && !engine.demo) {
      lastStatus = 'none';
      engine.resetDetection();
      engine.resume();
      showToast('Welcome back. Monitoring resumed.');
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSettings();
  });

  els.demoToggle.addEventListener('change', () => {
    els.startHint.textContent = els.demoToggle.checked
      ? 'Demo mode: a simulated person appears, no camera needed.'
      : 'You will be asked for camera permission. That is all it uses.';
    els.welcomeCamera.disabled = els.demoToggle.checked;
  });
  els.welcomeCamera.addEventListener('change', () => pickCamera(els.welcomeCamera.value));
  els.refreshCamsBtn.addEventListener('click', refreshCameraPickers);
  els.startBtn.addEventListener('click', beginSession);
  els.endBtn.addEventListener('click', endSession);
  els.cameraSelect.addEventListener('change', () => {
    const id = els.cameraSelect.value;
    if (engine && !engine.demo && id) switchCamera(id);
  });
  els.againBtn.addEventListener('click', beginSession);
  els.homeBtn.addEventListener('click', () => { showScreen('welcome'); });
  els.recalibrateBtn.addEventListener('click', () => {
    if (!engine) return;
    engine.calibrate(
      n => { els.statusLabel.textContent = `Hold still. ${n > 0 ? n : 'Done'}`; },
      () => { calibrated = true; lastStatus = 'none'; showToast('Recalibrated. Sitting tall is the normal again.'); },
    );
  });
  wireSettings();

  // initialize SceneBackground subsystems
  initSceneImages();
  initSceneParallax();
  initDustController();
  initDebugKey();

  // welcome plant shows today's current growth
  welcomePlant.setDroop(false);
  const initStage = stageForMinutes(stats.todayStats().goodSec / 60);
  welcomePlant.setStage(initStage);
  if (scenePlant) {
    scenePlant.setDroop(false);
    scenePlant.setStage(initStage);
  }
  setSceneStage(initStage + 1);
  setScenePosture('good');

  updateStatsPanel();
  renderBadges(els.badges, []);
  refreshCameraPickers();
  updateCoachStatus();
  showScreen('welcome');
}

init();

// debug/testing hook — lets the UI be driven without a live camera loop
window.__posturepal = {
  handleState, endSession, stats,
  sessionSec: () => sessionSec,
  markCalibrated: () => { calibrated = true; },
  engine: () => engine,
  faceFromMatrix,
  forceSession: (sec, goodSec, violationSec) => {
    sessionSec = sec; sessionGoodSec = goodSec; sessionViolationSec = violationSec;
  },
  setSceneStage,
  setScenePosture,
  USE_DIP,
};
