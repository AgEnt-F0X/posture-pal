// stats.js — localStorage persistence: daily posture time, streaks, badges, chart data.

const KEY = 'posturepal.v1';
const MAX_DAYS = 60; // keep ~2 months of history

const DEFAULT_SETTINGS = { sensitivity: 12, goalMin: 25, goalPct: 60, sound: true, notify: true, cameraId: null, aiEnabled: false, aiKey: '', aiTips: false };

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupted store — start fresh */ }
  return { v: 1, days: {}, badges: [], longestSessionSec: 0, settings: { ...DEFAULT_SETTINGS } };
}

export class Stats {
  constructor() {
    this.store = load();
    this.store.settings = { ...DEFAULT_SETTINGS, ...this.store.settings };
    this.store.days = this.store.days || {};
    this.store.badges = this.store.badges || [];
  }

  _save() {
    // prune old days so localStorage stays tiny
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - MAX_DAYS);
    const cutoffKey = todayKey(cutoff);
    for (const k of Object.keys(this.store.days)) {
      if (k < cutoffKey) delete this.store.days[k];
    }
    try { localStorage.setItem(KEY, JSON.stringify(this.store)); } catch { /* storage full/blocked */ }
  }

  get settings() { return { ...this.store.settings }; }

  updateSettings(patch) {
    Object.assign(this.store.settings, patch);
    this._save();
  }

  reset() {
    this.store = { v: 1, days: {}, badges: [], longestSessionSec: 0, settings: this.store.settings };
    this._save();
  }

  _today() {
    const k = todayKey();
    if (!this.store.days[k]) this.store.days[k] = { monitoredSec: 0, goodSec: 0 };
    return this.store.days[k];
  }

  // Called once per second of active monitoring; 'none' (nobody visible) doesn't count.
  recordTick(status) {
    if (status === 'none') return;
    const day = this._today();
    day.monitoredSec += 1;
    if (status === 'good') day.goodSec += 1;
    // save every 30 ticks rather than every second
    if (day.monitoredSec % 30 === 0) this._save();
  }

  noteSessionLength(sessionSec) {
    if (sessionSec > (this.store.longestSessionSec || 0)) {
      this.store.longestSessionSec = sessionSec;
      this._save();
    }
  }

  scorePct(day = this._today()) {
    if (!day || day.monitoredSec === 0) return 0;
    return Math.round((day.goodSec / day.monitoredSec) * 100);
  }

  todayStats() {
    const day = this._today();
    return { monitoredSec: day.monitoredSec, goodSec: day.goodSec, scorePct: this.scorePct(day) };
  }

  metGoal(day, settings = this.settings) {
    return !!day && day.monitoredSec >= settings.goalMin * 60 && this.scorePct(day) >= settings.goalPct;
  }

  streak() {
    let d = new Date();
    if (!this.metGoal(this.store.days[todayKey(d)])) d.setDate(d.getDate() - 1); // today not done yet — don't break the chain
    let n = 0;
    while (this.metGoal(this.store.days[todayKey(d)])) {
      n += 1;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  bestStreak() {
    const keys = Object.keys(this.store.days).filter(k => this.metGoal(this.store.days[k])).sort();
    let best = 0, run = 0, prev = null;
    for (const k of keys) {
      if (prev) {
        const [y, m, d] = prev.split('-').map(Number);
        const next = new Date(y, m - 1, d); next.setDate(next.getDate() + 1);
        run = todayKey(next) === k ? run + 1 : 1;
      } else run = 1;
      best = Math.max(best, run);
      prev = k;
    }
    return best;
  }

  // Last 7 days for the chart (oldest → today).
  chartData() {
    const out = [];
    const d = new Date();
    d.setDate(d.getDate() - 6);
    for (let i = 0; i < 7; i++) {
      const k = todayKey(d);
      const day = this.store.days[k];
      out.push({
        key: k,
        label: 'SMTWTFS'[d.getDay()],
        isToday: i === 6,
        scorePct: day ? this.scorePct(day) : 0,
        minutes: day ? Math.round(day.monitoredSec / 60) : 0,
      });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  hasBadge(id) { return this.store.badges.includes(id); }

  // Award any badge whose condition now holds; returns the newly earned ones.
  checkBadges(sessionSec = 0) {
    const earnedNow = [];
    const award = (id, cond) => {
      if (cond && !this.hasBadge(id)) { this.store.badges.push(id); earnedNow.push(BADGES.find(b => b.id === id)); }
    };
    const today = this._today();
    award('first-session', today.monitoredSec >= 60);
    award('goal-day', this.metGoal(today));
    award('score80', today.monitoredSec >= 600 && this.scorePct(today) >= 80);
    award('streak3', this.streak() >= 3);
    award('streak7', this.streak() >= 7);
    award('session30', Math.max(sessionSec, this.store.longestSessionSec) >= 1800);
    if (earnedNow.length) this._save();
    return earnedNow;
  }
}

export const BADGES = [
  { id: 'first-session', icon: '', label: 'First session' },
  { id: 'session30', icon: '', label: '30-minute session' },
  { id: 'goal-day', icon: '', label: 'Daily goal met' },
  { id: 'score80', icon: '', label: '80% posture day' },
  { id: 'streak3', icon: '', label: '3-day streak' },
  { id: 'streak7', icon: '', label: '7-day streak' },
];
