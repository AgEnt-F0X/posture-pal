# Posture Pal — Desktop app

A self-contained Windows build: no Python, no browser, no `npm start`. Double-click
`PosturePal.exe` and it runs as a program with a system tray icon.

## Run it

1. Go to `dist/PosturePal-win32-x64/`
2. Double-click **PosturePal.exe** (pin it to the taskbar or make a shortcut — the whole
   folder is the app, keep files together)

First launch: Windows may show a **SmartScreen / unknown publisher** warning (the exe isn't
code-signed) — click *More info → Run anyway*. Allow camera access when prompted.

## What it does differently from the browser version

- **Real background operation** — close the window and Posture Pal keeps watching from the
  tray (look for the 🌱 icon near the clock). Background throttling is disabled, so posture
  checks keep running at full rate; the worker fallback from the web version still exists.
- **Native Windows notifications** when your posture or neck goes wrong while you're in
  another window — delivered as tray balloons (enable 🔔 in the app's Settings; on first
  launch the app also adds itself to the Start Menu so Windows toasts work properly).
- **Run at Windows startup** — right-click the tray icon → tick *Run at Windows startup*.
- **Quit** only via tray icon → Quit (closing the window just hides it).
- Everything else is identical: same on-device detection, calibration, plant, streaks,
  AI coach — settings live in the same localStorage, scoped to this app.

## Rebuilding

```
npm install         # electron + packager (dev only)
node gen-icons.js   # regenerate tray/app icons
node sync-web.js    # copy the web app (index.html, js, models…) into desktop/web
npm start           # run from source
npm run smoke       # boot test: prints SMOKE OK and exits
```

> This folder ships a prebuilt `dist/PosturePal-win32-x64/`. It was assembled manually
> (the packager's zip extractor hangs in some sandboxed environments); if you rebuild on
> a normal machine, `npm run package` produces the same layout.

## Notes

- ~300 MB on disk (bundled Chromium runtime + pose/face models). Portable — no installer,
  no registry entries. Delete the folder to uninstall (tray → Quit first).
- The app serves its own files on `127.0.0.1` (loopback only) because the camera API needs
  an http origin — nothing is reachable from the network.
- The .exe file icon is Electron's default (icon stamping needs rcedit, unavailable here);
  the window, taskbar and tray all show the seedling icon.
