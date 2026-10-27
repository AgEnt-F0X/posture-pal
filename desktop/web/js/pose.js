// pose.js — posture engine: camera (MediaPipe pose + face mesh) or demo mode,
// slouch decision logic, overlay drawing.
//
// Head/neck signals come from the Face Landmarker's 3D transformation matrix
// (real head pitch in degrees + face-to-camera distance), which is far more
// tolerant of camera placement than pixel-gap heuristics. Torso signals
// (shoulder drop, side lean) come from the Pose Landmarker's landmarks.

// Landmark indices (MediaPipe Pose, 33 points)
const NOSE = 0, LEAR = 7, REAR = 8,
  LSH = 11, RSH = 12, LEL = 13, REL = 14, LWR = 15, RWR = 16,
  LHIP = 23, RHIP = 24;

const CONNECTIONS = [
  [LSH, RSH], [LSH, LEL], [LEL, LWR], [RSH, REL], [REL, RWR],
  [LSH, LHIP], [RSH, RHIP], [LHIP, RHIP],
  [LEAR, NOSE], [NOSE, REAR], [LEAR, LSH], [REAR, RSH],
];

const SUSTAIN_MS = 3000;          // a violation must persist this long to alert
const SMOOTH_WINDOW = 8;          // frames averaged for stability
const CALIB_PHASE_MS = 3000;      // per calibration phase (upright, then slouch)
const DRIFT_CONFIRM_MS = 5000;    // shoulder changes must persist to count as setup drift
const DRIFT_ALERT_COOLDOWN_MS = 120000;

// ---- pure helpers ----------------------------------------------------------

function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function medianOf(samples, key) {
  const vals = samples.map(x => x[key]).filter(v => v != null);
  return vals.length ? median(vals) : null;
}

// Torso metrics from pose landmarks. `pitch`/`prox` here are coarse ear-based
// fallbacks, only used when the face model is unavailable; normally the engine
// overwrites them with face-mesh values.
export function postureMetrics(lm) {
  const lsh = lm[LSH], rsh = lm[RSH];
  const shoulderW = Math.abs(rsh.x - lsh.x);
  if (shoulderW < 0.02) return null; // edge-on view, metrics unreliable
  const shoulderMid = midpoint(lsh, rsh);
  const lVis = lm[LEAR].visibility ?? 1, rVis = lm[REAR].visibility ?? 1;
  const bothEars = lVis > 0.4 && rVis > 0.4;
  const earMid = bothEars ? midpoint(lm[LEAR], lm[REAR])
    : midpoint(lVis >= rVis ? lm[LEAR] : lm[REAR], lm[NOSE]);
  const drop = (shoulderMid.y - earMid.y) / shoulderW;
  const tilt = bothEars ? Math.abs(lm[LEAR].y - lm[REAR].y) / shoulderW : 0;
  const pitch = bothEars ? (lm[NOSE].y - earMid.y) / shoulderW : null;
  const prox = bothEars ? Math.abs(lm[REAR].x - lm[LEAR].x) / shoulderW : null;
  const facing = bothEars && Math.abs(lm[NOSE].x - earMid.x) / shoulderW < 0.18;
  return { drop, tilt, pitch, prox, facing, shoulderMid, shoulderW };
}

// Head pose from the Face Landmarker's 4x4 facial transformation matrix
// (column-major). The rotation's third column maps the canonical face's
// forward vector; its Y component goes negative as the head tips down, so
// pitch is positive-looking-down and in degrees. Translation Z ≈ distance.
export function faceFromMatrix(data) {
  const fwdY = data[9], fwdZ = data[10];
  const pitchDeg = Math.asin(Math.max(-1, Math.min(1, -fwdY))) * 180 / Math.PI;
  const yawDeg = Math.atan2(data[8], Math.abs(fwdZ) < 1e-6 ? 1e-6 : fwdZ) * 180 / Math.PI;
  const dist = Math.abs(data[14]);
  return { pitchDeg, yawDeg, dist };
}

// ---- posture decision logic -------------------------------------------------
// Four violations, checked in priority order: slouch (torso/head drops), neck
// (head pitches down), close (face drifts toward the camera), lean (side tilt).
// After two-phase calibration we know the user's own upright AND slouched
// anchors, so thresholds sit at the midpoint between them. If the slouched
// anchor came out too similar (user didn't really slouch), we fall back to
// fixed ratio-based thresholds. Either way, a violation must persist
// SUSTAIN_MS to be confirmed and clears with hysteresis.

export class PostureDetector {
  constructor() {
    this.buffer = [];
    this.baseline = null;      // upright anchors {drop, tilt, pitch, prox}
    this.thresholds = null;
    this.sensitivity = 0.12;
    this.active = null;        // confirmed violation id
    this.pending = null;       // {id, since}
  }

  setSensitivityPct(pct) {
    this.sensitivity = Math.min(25, Math.max(5, pct)) / 100;
    if (this.upright && this.slouch) this.setAnchors(this.upright, this.slouch);
  }

  setAnchors(upright, slouch) {
    this.upright = upright;
    this.slouch = slouch;
    this.baseline = upright;
    this.thresholds = this._buildThresholds(upright, slouch);
  }

  _buildThresholds(up, sl) {
    const s = this.sensitivity;
    const T = {};
    const anchorGap = (a, b, min) => a != null && b != null && Math.abs(a - b) >= min;

    // slouch: drop falls below the midpoint of the user's own range
    if (anchorGap(up.drop, sl.drop, 0.12)) {
      const mid = (up.drop + sl.drop) / 2, gap = Math.abs(up.drop - sl.drop);
      T.drop = { enter: v => v < mid, exit: v => v > mid + gap * 0.35 };
    } else {
      T.drop = { enter: v => v / up.drop < 1 - s, exit: v => v / up.drop >= 1 - s * 0.6 };
    }
    // neck: head pitch (degrees) rises above the midpoint
    if (anchorGap(up.pitch, sl.pitch, 4)) {
      const mid = (up.pitch + sl.pitch) / 2, gap = Math.abs(up.pitch - sl.pitch);
      T.pitch = { enter: v => v != null && v > mid, exit: v => v == null || v < mid - gap * 0.35 };
    } else {
      T.pitch = {
        enter: v => v != null && v > up.pitch + 4 + s * 50,
        exit: v => v == null || v <= up.pitch + 2 + s * 30,
      };
    }
    // close: face distance falls below the midpoint
    if (anchorGap(up.prox, sl.prox, 6)) {
      const mid = (up.prox + sl.prox) / 2, gap = Math.abs(up.prox - sl.prox);
      T.dist = { enter: v => v != null && v < mid, exit: v => v == null || v > mid + gap * 0.35 };
    } else {
      const k = Math.max(0.10, s);
      T.dist = {
        enter: v => v != null && v < up.prox * (1 - k),
        exit: v => v == null || v >= up.prox * (1 - k * 0.6),
      };
    }
    // side lean: one ear lower than the other, vs upright
    T.tilt = { enter: v => Math.abs(v - up.tilt) > 0.12, exit: v => Math.abs(v - up.tilt) <= 0.08 };
    return T;
  }

  push(m, now) {
    this.buffer.push(m);
    if (this.buffer.length > SMOOTH_WINDOW) this.buffer.shift();
    if (!this.thresholds) return { status: 'good', raw: m };

    const drop = median(this.buffer.map(x => x.drop));
    const tilt = median(this.buffer.map(x => x.tilt));
    const pitch = medianOf(this.buffer, 'pitch');
    const prox = medianOf(this.buffer, 'prox');

    const checks = [
      { id: 'slouch', enter: () => this.thresholds.drop.enter(drop), exit: () => this.thresholds.drop.exit(drop) },
      { id: 'neck', enter: () => this.thresholds.pitch.enter(pitch), exit: () => this.thresholds.pitch.exit(pitch) },
      { id: 'close', enter: () => (m.facing ?? true) && this.thresholds.dist.enter(prox), exit: () => !(m.facing ?? true) || this.thresholds.dist.exit(prox) },
      { id: 'lean', enter: () => this.thresholds.tilt.enter(tilt), exit: () => this.thresholds.tilt.exit(tilt) },
    ];

    if (this.active) {
      const c = checks.find(c => c.id === this.active);
      if (c.exit()) { this.active = null; this.pending = null; }
    }
    if (!this.active) {
      const hit = checks.find(c => c.enter());
      if (hit) {
        if (!this.pending || this.pending.id !== hit.id) this.pending = { id: hit.id, since: now };
        if (now - this.pending.since >= SUSTAIN_MS) { this.active = hit.id; this.pending = null; }
      } else {
        this.pending = null;
      }
    }
    return { status: this.active ?? 'good', raw: { drop, tilt, pitch, prox, dropRatio: drop / this.baseline.drop } };
  }
}

// ---- overlay drawing -------------------------------------------------------

function drawOverlay(canvas, landmarks, status) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks) return;
  const color = status === 'slouch' || status === 'neck' || status === 'close' ? '#f87171'
    : status === 'lean' ? '#fbbf24' : '#4ade80';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, canvas.width / 320);
  ctx.lineCap = 'round';
  const P = i => ({ x: landmarks[i].x * canvas.width, y: landmarks[i].y * canvas.height });
  for (const [a, b] of CONNECTIONS) {
    const pa = P(a), pb = P(b);
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  }
  const r = Math.max(3, canvas.width / 160);
  for (const i of [NOSE, LEAR, REAR, LSH, RSH, LEL, REL, LWR, RWR, LHIP, RHIP]) {
    const p = P(i);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  }
}

// ---- demo mode: synthetic person -------------------------------------------
// Scripted 72s loop hitting every violation: upright → slouch → upright →
// tech neck → upright → lean → upright → too close → upright. Produces both
// pose landmarks and a synthetic face transformation matrix.

class DemoSource {
  constructor() {
    this.t0 = performance.now();
    this.canvasSize = { w: 640, h: 480 };
  }

  frame(now) {
    const t = ((now - this.t0) / 1000) % 72;
    let dropFactor = 1, earTilt = 0, pitchDeg = 6, dist = 60;
    if (t >= 12 && t < 21) dropFactor = 0.62;                          // slouch
    else if (t >= 31 && t < 41) { pitchDeg = 24; dropFactor = 0.9; }   // tech neck
    else if (t >= 49 && t < 55) earTilt = 0.09;                        // side lean
    else if (t >= 59 && t < 67) dist = 44;                             // too close
    const jitter = () => (Math.random() - 0.5) * 0.004;

    const W = 0.20;
    const baseDrop = 0.75 * dropFactor;
    const lsx = 0.40 + jitter(), rsx = 0.60 + jitter();
    const shy = 0.52 + jitter();
    const earMidY = shy - baseDrop * W;
    const lm = [];
    lm[NOSE] = { x: (lsx + rsx) / 2, y: earMidY + 0.04, z: 0, visibility: 1 };
    lm[LEAR] = { x: 0.47, y: earMidY - earTilt * 0.6 + jitter(), z: 0, visibility: 1 };
    lm[REAR] = { x: 0.53, y: earMidY + earTilt * 0.6 + jitter(), z: 0, visibility: 1 };
    lm[LSH] = { x: lsx, y: shy, z: 0, visibility: 1 };
    lm[RSH] = { x: rsx, y: shy, z: 0, visibility: 1 };
    lm[LEL] = { x: lsx - 0.07, y: shy + 0.16, z: 0, visibility: 1 };
    lm[REL] = { x: rsx + 0.07, y: shy + 0.16, z: 0, visibility: 1 };
    lm[LWR] = { x: lsx - 0.05, y: shy + 0.30, z: 0, visibility: 1 };
    lm[RWR] = { x: rsx + 0.05, y: shy + 0.30, z: 0, visibility: 1 };
    lm[LHIP] = { x: lsx + 0.02, y: 0.86, z: 0, visibility: 1 };
    lm[RHIP] = { x: rsx - 0.02, y: 0.86, z: 0, visibility: 1 };

    // face matrix: R = Ry(0°) · Rx(pitch), translation (0, 0, -dist)
    const a = pitchDeg * Math.PI / 180;
    const ca = Math.cos(a), sa = Math.sin(a);
    const face = new Array(16).fill(0);
    face[0] = 1;
    face[5] = ca; face[6] = sa;
    face[9] = -sa; face[10] = ca;
    face[14] = -dist; face[15] = 1;
    return { lm, face };
  }
}

// ---- vision bundle loading (local first, CDN fallback) ---------------------

let visionBundlePromise = null;
function loadVisionBundle() {
  if (!visionBundlePromise) {
    visionBundlePromise = import('../vendor/vision_bundle.mjs')
      .catch(() => import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'));
  }
  return visionBundlePromise;
}

// ---- main engine -----------------------------------------------------------

export class PostureEngine {
  // Lists available video inputs. Labels are only populated after camera
  // permission has been granted, so call this once a stream is live.
  static async listCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(d => d.kind === 'videoinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
    } catch { return []; }
  }

  constructor({ video, canvas, demo, onState, onError, onCameraLost, onSetupDrift }) {
    this.video = video;
    this.canvas = canvas;
    this.demo = demo;
    this.onState = onState;
    this.onError = onError;
    this.onCameraLost = onCameraLost;
    this.onSetupDrift = onSetupDrift;
    this.detector = new PostureDetector();
    this.landmarker = null;
    this.faceLandmarker = null;
    this.demoSource = null;
    this.stream = null;
    this.raf = null;
    this.running = false;
    this.deviceId = null; // preferred camera, used when starting
    this.lastVideoTime = -1;
    this.lastDetect = 0;
    this.lastTs = 0;
    this.calibrating = null;
    this.driftRef = null;
    this.driftBadSince = null;
    this.lastDriftAlert = 0;
    this.ticker = null;        // worker that drives detection while the tab is hidden
    this.lastDetectWall = 0;
  }

  // Web Worker timers aren't throttled when the tab is hidden (rAF is), so
  // this ticker keeps posture checks (and therefore notifications) running
  // while the user works in other windows.
  _startHiddenTicker() {
    try {
      const code = `let id=null;onmessage=e=>{if(e.data==='start'&&!id)id=setInterval(()=>postMessage(1),1000);if(e.data==='stop'){clearInterval(id);id=null;}};`;
      this.ticker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
      this.ticker.onmessage = () => {
        if (this.running && document.hidden) this._detectOnce(performance.now());
      };
      this.ticker.postMessage('start');
    } catch { this.ticker = null; }
  }

  _stopHiddenTicker() {
    if (this.ticker) {
      try { this.ticker.postMessage('stop'); this.ticker.terminate(); } catch { /* already gone */ }
      this.ticker = null;
    }
  }

  async start() {
    if (this.demo) {
      this.demoSource = new DemoSource();
      this.canvas.width = this.demoSource.canvasSize.w;
      this.canvas.height = this.demoSource.canvasSize.h;
      this.running = true;
      this._startHiddenTicker();
      this._loop();
      return;
    }
    const { FilesetResolver, PoseLandmarker, FaceLandmarker } = await loadVisionBundle();
    const fileset = await FilesetResolver.forVisionTasks('vendor/wasm');
    const make = (Ctor, model, extra) => Ctor.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: model, delegate: 'GPU' },
      runningMode: 'VIDEO',
      ...extra,
    });
    try {
      this.landmarker = await make(PoseLandmarker, 'models/pose_landmarker_lite.task', { numPoses: 1 });
    } catch {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: 'models/pose_landmarker_lite.task', delegate: 'CPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
    }
    // Face model is optional — without it the neck/close checks degrade to
    // the coarse ear-based fallbacks rather than disappearing entirely.
    try {
      this.faceLandmarker = await make(FaceLandmarker, 'models/face_landmarker.task', {
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      });
    } catch {
      this.faceLandmarker = null;
    }
    const baseVideo = { width: { ideal: 640 }, height: { ideal: 480 } };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: this.deviceId ? { ...baseVideo, deviceId: { exact: this.deviceId } } : baseVideo,
        audio: false,
      });
    } catch (e) {
      if (!this.deviceId) throw e;
      // preferred camera no longer connected — fall back to the default one
      this.deviceId = null;
      this.stream = await navigator.mediaDevices.getUserMedia({ video: baseVideo, audio: false });
    }
    this.video.srcObject = this.stream;
    await new Promise(res => { this.video.onloadedmetadata = res; });
    await this.video.play();
    this.stream.getVideoTracks()[0].addEventListener('ended', () => this.onCameraLost?.());
    this.canvas.width = this.video.videoWidth || 640;
    this.canvas.height = this.video.videoHeight || 480;
    this.running = true;
    this._startHiddenTicker();
    this._loop();
  }

  stop() {
    this.running = false;
    this._stopHiddenTicker();
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    this.video.srcObject = null;
  }

  currentDeviceId() {
    const track = this.stream?.getVideoTracks()[0];
    return track?.getSettings().deviceId ?? null;
  }

  setSensitivityPct(pct) { this.detector.setSensitivityPct(pct); }

  // Swap to a different camera mid-session. Caller should recalibrate afterwards
  // (the new camera has a different angle, so the posture anchors are stale).
  async switchCamera(deviceId) {
    if (this.demo) throw new Error('Not available in demo mode');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = stream;
    this.deviceId = deviceId;
    this.video.srcObject = stream;
    await new Promise(res => { this.video.onloadedmetadata = res; });
    await this.video.play();
    stream.getVideoTracks()[0].addEventListener('ended', () => this.onCameraLost?.());
    this.canvas.width = this.video.videoWidth || this.canvas.width;
    this.canvas.height = this.video.videoHeight || this.canvas.height;
    this.resetDetection();
  }

  // Clear stale decision state (after tab switches, camera swaps, resume).
  resetDetection() {
    this.detector.buffer = [];
    this.detector.pending = null;
    this.detector.active = null;
    this.driftBadSince = null;
    this.lastVideoTime = -1;
  }

  // Some browsers pause the video element while the tab is hidden; nudge it back.
  resume() {
    this.video.play?.().catch(() => {});
  }

  // Two-phase calibration: "sit tall" (upright anchors), then "slouch like
  // you mean it" (bad anchors). Thresholds land at the midpoint of the two.
  calibrate(onTick, onDone, onPhase) {
    this.calibrating = {
      startedAt: performance.now(), phase: 1,
      upright: [], slouch: [], onTick, onDone, onPhase, lastShown: null,
    };
  }

  _finishCalibPhase(c, samples) {
    return {
      drop: median(samples.map(x => x.drop)),
      tilt: median(samples.map(x => x.tilt)),
      pitch: medianOf(samples, 'pitch'),
      prox: medianOf(samples, 'prox'),
    };
  }

  _emitCalib(now) {
    const c = this.calibrating;
    if (!c) return;
    const elapsed = now - c.startedAt;
    const end = c.phase * CALIB_PHASE_MS;
    const remaining = Math.max(0, Math.ceil((end - elapsed) / 1000));
    if (remaining !== c.lastShown) { c.lastShown = remaining; c.onTick(remaining); }
    if (elapsed >= end) {
      if (c.phase === 1) {
        c.uprightAnchors = this._finishCalibPhase(c, c.upright);
        c.phase = 2;
        c.lastShown = null;
        c.onPhase?.(2);
      } else {
        const slouch = this._finishCalibPhase(c, c.slouch);
        this.detector.setAnchors(c.uprightAnchors, slouch);
        this.driftRef = {
          y: median(c.upright.map(x => x.shoulderMid?.y ?? 0.5)),
          w: median(c.upright.map(x => x.shoulderW ?? 0.2)),
        };
        this.calibrating = null;
        c.onDone(this.detector.baseline);
      }
    }
  }

  _checkDrift(m, now) {
    if (!this.driftRef || !m || this.calibrating) return;
    const dy = Math.abs(m.shoulderMid.y - this.driftRef.y);
    const wr = m.shoulderW / (this.driftRef.w || 1);
    const bad = dy > 0.18 || wr > 1.3 || wr < 0.72;
    if (bad) {
      this.driftBadSince ??= now;
      if (now - this.driftBadSince > DRIFT_CONFIRM_MS && now - this.lastDriftAlert > DRIFT_ALERT_COOLDOWN_MS) {
        this.lastDriftAlert = now;
        this.driftBadSince = null;
        this.onSetupDrift?.();
      }
    } else {
      this.driftBadSince = null;
    }
  }

  _loop() {
    if (!this.running) return;
    this.raf = requestAnimationFrame(() => this._loop());
    this._detectOnce(performance.now());
  }

  // One detection frame. Normally driven by rAF (visible tab); while the tab
  // is hidden, rAF pauses, so a worker ticker calls this ~1×/second instead —
  // workers aren't throttled, and muted video keeps decoding when hidden.
  _detectOnce(now) {
    this.lastDetectWall = Date.now();
    let landmarks = null;
    let faceMatrix = null;
    if (this.demo) {
      if (now - this.lastDetect < 66) return; // ~15 fps
      this.lastDetect = now;
      const f = this.demoSource.frame(now);
      landmarks = f.lm;
      faceMatrix = f.face;
    } else {
      if (this.video.readyState < 2) return;
      if (this.video.currentTime === this.lastVideoTime || now - this.lastDetect < 80) return;
      this.lastVideoTime = this.video.currentTime;
      this.lastDetect = now;
      let ts = Math.max(Math.round(now), this.lastTs + 1);
      this.lastTs = ts;
      let res;
      try {
        res = this.landmarker.detectForVideo(this.video, ts);
      } catch (e) {
        this.onError?.('Pose detection failed: ' + e.message);
        return;
      }
      landmarks = res.landmarks?.[0] ?? null;
      if (landmarks) {
        const vis = i => landmarks[i].visibility ?? 1;
        if (vis(LSH) < 0.4 || vis(RSH) < 0.4) landmarks = null; // shoulders out of frame
      }
      if (this.faceLandmarker) {
        try {
          const fres = this.faceLandmarker.detectForVideo(this.video, ts);
          faceMatrix = fres.facialTransformationMatrixes?.[0]?.data ?? null;
        } catch { /* face model hiccup — ear fallbacks cover it */ }
      }
    }

    let m = landmarks ? postureMetrics(landmarks) : null;
    if (m && faceMatrix) {
      const face = faceFromMatrix(faceMatrix);
      m.pitch = face.pitchDeg;
      m.prox = face.dist;
      m.facing = Math.abs(face.yawDeg) < 30;
    }

    if (this.calibrating) {
      if (m) {
        const store = this.calibrating.phase === 1 ? this.calibrating.upright : this.calibrating.slouch;
        store.push(m);
      }
      this._emitCalib(now);
      drawOverlay(this.canvas, landmarks, 'good');
      return;
    }

    this._checkDrift(m, now);

    let status = 'none';
    let metricsOut = null;
    if (m) {
      const r = this.detector.push(m, now);
      status = r.status;
      metricsOut = r.raw;
    } else {
      this.detector.buffer = [];
      this.detector.pending = null;
      this.detector.active = null;
    }
    drawOverlay(this.canvas, landmarks, status);
    this.onState({ status, landmarks, metrics: metricsOut });
  }
}
