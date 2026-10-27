# 🪴 Posture Pal

A webcam posture coach with a gamified twist: a little plant grows as you sit tall —
and wilts the second you slouch. Runs **100% in your browser**, **100% on your device**.
No API keys, no accounts, no uploads, no cost.

## Features

- **Live posture detection** — MediaPipe pose tracking (33 body landmarks) straight in the browser
- **Four posture violations** — slouching (head drops), tech neck (chin tucks down), drifting into the screen (head toward the camera), and side leaning — each with its own nudge
- **Camera switching** — pick any webcam from the welcome screen or mid-session from the monitor screen; switching auto-recalibrates for the new angle and your choice is remembered
- **Slouch & lean detection** — calibrated to *your* sitting position with a 3-second setup, with hysteresis and smoothing so it never flickers or nags
- **Gentle nudges** — on-screen banner, a soft two-note chime when focused, and an OS-level desktop notification when you're working in another window
- **Keeps watching in the background** — while you're in other windows, a worker timer keeps checking posture (~1×/second); note that browsers may still sleep a fully-hidden tab after a long time, so an always-on desktop build remains the bulletproof option
- **Plant mascot** — 5 growth stages driven by your good-posture minutes today; droops live when you slouch
- **Streaks & badges** — daily posture score, day streak 🔥, 6 badges, and a 7-day history chart
- **Demo mode** — a simulated person who slouches on cue, so you can show off the app without a webcam
- **Private by design** — the camera feed never leaves your laptop; stats live in your browser's localStorage

## Run it

**Option A — the desktop app (recommended):** open `desktop/dist/PosturePal-win32-x64/` and
double-click **PosturePal.exe**. It runs as a real program: system tray icon, keeps monitoring
in the background when you close the window, native Windows notifications, and an optional
*Run at Windows startup* toggle (tray right-click). See `desktop/README.md`.

**Option B — in the browser.** The camera API requires the page to be served over `localhost`
(opening the file directly won't work):

```bash
cd posture-pal
python -m http.server 8080
```

Then open **http://localhost:8080** in Chrome or Edge, click **Start session**, and allow the camera.

> Any static file server works — `npx serve`, VS Code Live Server, etc.
> Everything (the pose model, the WASM runtime) is bundled in this folder, so it also works offline.

## How the detection works

1. Two free on-device models run ~12×/second in your browser (WebAssembly, nothing uploaded):
   - **Pose Landmarker** — body landmarks for torso signals: shoulder drop (slouch) and side lean.
   - **Face Landmarker** — a 478-point face mesh whose 3D transform gives **real head pitch in degrees**
     (tech neck) and **face-to-camera distance** (drifting into the screen). Being a fitted 3D model,
     it's far more tolerant of camera placement than pixel comparisons.
2. **Two-phase calibration** teaches the app *your* range: first "sit tall" for 3 seconds, then
   "slouch like you usually do" for 3 seconds. Alert thresholds land at the midpoint of your own
   good/bad anchors (if the slouch anchor is too close to upright, it falls back to fixed thresholds).
3. **Camera-move detection**: if your shoulders suddenly shift or change size in the frame — you moved
   the laptop, tilted the lid, or swapped chairs — the app asks you to recalibrate instead of
   silently reporting nonsense.
4. A violation only fires after it persists **3 sustained seconds** (sensitivity tunable 5–25% in
   Settings), and it clears early once you return near baseline — hysteresis stops flicker and nagging.

> Honest limit: a single frontal webcam can't do clinical-grade measurement (that needs a side view).
> But head-pose-in-degrees plus personal calibration makes alerts reliably catch real slouching and
> tech neck without false alarms from normal head turns.

## AI coach (optional)

Posture detection is 100% on-device and needs no key. If you want it, the app can add an **AI coach
note** to each session summary — one free-tier Gemini call per session describing your pattern and a
concrete fix:

1. Grab a free API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Open Settings → **AI coach** → Step 1: paste the key; Step 2: tick the report checkbox. Optionally
   also tick **live tips** for a one-line coach tip every 5 minutes during long sessions.
3. End a session of a minute or more — the summary screen gets a coach note. When live tips are on,
   tips pop up as toasts during the session.

The key is stored only in your browser's localStorage and is used solely for coach notes/tips.
When the coach is on, the welcome screen shows an "AI coach is on" indicator so you always know.

## Demo script (for fairs / hackathons / class)

1. Open the app, flip on **Demo mode**, click **Start session**.
2. Point out the plant, the green "Sitting tall ✓" badge and the skeleton overlay.
3. ~14 s in, the simulated person slouches → the badge flips red, the plant visibly wilts,
   the nudge banner drops, the chime plays. *This is the moment the crowd gets it.*
4. It recovers on its own, then leans to one side — a second, different nudge.
5. End the session to show the summary card, badges and streak logic.
6. Then (optional) restart in camera mode and slouch on camera for the real thing.

## Project structure

```
posture-pal/
├── index.html                  # all screens: welcome → calibrate → monitor → summary
├── css/style.css               # dark theme
├── js/
│   ├── pose.js                 # camera + MediaPipe + slouch heuristic + demo simulator
│   ├── plant.js                # SVG plant mascot (growth stages + droop)
│   ├── stats.js                # localStorage: daily score, streaks, badges, chart
│   ├── alerts.js               # nudge banner, chime, desktop notifications
│   └── app.js                  # screen state machine + session loop + settings
├── models/pose_landmarker_lite.task   # pose model (~5.5 MB, bundled)
└── vendor/                     # MediaPipe tasks-vision runtime (bundled)
```

## Ideas for later

- Desktop wrapper (Electron/Tauri) for always-on background monitoring with system tray alerts
- Break reminders (20-20-20 rule) alongside posture nudges
- Team leaderboard mode for offices/classrooms
- Weekly report card export
