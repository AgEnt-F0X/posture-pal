// alerts.js — nudge banner, soft chime, optional desktop notification.

const BANNER_VISIBLE_MS = 5000;

const VIOLATIONS = {
  slouch: { title: 'Slouching', fix: 'Roll your shoulders back and lift your chest.' },
  neck: { title: 'Tech neck', fix: 'Raise the screen to eye level and tuck your chin.' },
  close: { title: 'Too close', fix: 'Sit back so your head floats over your shoulders.' },
  lean: { title: 'Leaning sideways', fix: 'Square your shoulders to the screen.' },
};

const VIOLATION_ICONS = {
  slouch: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15v-3a7 7 0 0 1 14 0v3"/><path d="M3 15h4v3H3ZM13 15h4v3h-4Z"/></svg>',
  neck: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="5" r="2.6"/><path d="M10 8v5"/><path d="M6 16c0-2 1.8-3 4-3s4 1 4 3"/></svg>',
  close: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l6 6-6 6"/><path d="M4 10h13"/></svg>',
  lean: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16 L14 4"/><path d="M4 16h6"/><path d="M14 4h-5M14 4v5"/></svg>',
};

export class Alerter {
  constructor(bannerEl, textEl, getSettings) {
    this.banner = bannerEl;
    this.textEl = textEl;
    this.getSettings = getSettings;
    this.audioCtx = null;
    this.hideTimer = null;
  }

  violation(id) {
    const v = VIOLATIONS[id] ?? { title: 'Posture check', fix: 'Take a breath and reset your position.' };
    const s = this.getSettings();
    const iconEl = this.banner.querySelector('.nudge-icon');
    this.textEl.innerHTML = `<strong>${v.title}.</strong><span> ${v.fix}</span>`;

    // Show on-screen banner and reset countdown bar
    this.banner.classList.remove('hidden');
    const bar = this.banner.querySelector('.nudge-bar');
    if (bar) {
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = '';
    }
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.banner.classList.add('hidden'), BANNER_VISIBLE_MS);

    // The OS-level popup is what reaches you in another window; the on-screen
    // banner covers the case where the app is visible. Chime only when the
    // tab is focused, a hidden tab's audio is usually muted anyway.
    const backgrounded = document.hidden || !document.hasFocus();
    if (s.sound && !backgrounded) this._chime();
    if (s.notify && backgrounded) {
      // Desktop app: tray balloon via the Electron bridge (works for portable
      // exes, which Windows otherwise silently drops web toasts from).
      const body = `${v.title}. ${v.fix}`;
      if (window.posturepalDesktop?.notify) {
        window.posturepalDesktop.notify('Posture Pal', body);
      } else if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('Posture Pal', { body, tag: 'posturepal' });
        } catch { /* some browsers restrict */ }
      }
    }
  }

  _showBanner(text) {
    this.textEl.textContent = text;
    this.banner.classList.remove('hidden');
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.banner.classList.add('hidden'), BANNER_VISIBLE_MS);
  }

  hide() {
    clearTimeout(this.hideTimer);
    this.banner.classList.add('hidden');
  }

  // Gentle two-note chime; AudioContext is created lazily after a user gesture.
  _chime() {
    try {
      this.audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
      const notes = [659.25, 783.99]; // E5 → G5
      notes.forEach((freq, i) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = this.audioCtx.currentTime + i * 0.18;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        osc.connect(gain).connect(this.audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.55);
      });
    } catch { /* audio unavailable — silent nudge is fine */ }
  }
}

export async function requestNotifyPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}
