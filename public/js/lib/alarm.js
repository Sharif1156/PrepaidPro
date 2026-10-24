/**
 * Low-balance reminders: when to repeat, and the warning tone.
 *
 * Reminder schedule (minutes after the previous reminder):
 *   1st reminder  -> as soon as the balance is found low
 *   2nd           -> 5 min later
 *   3rd           -> 10 min after the 2nd
 *   4th           -> 20 min after the 3rd
 *   5th and on    -> every 60 min
 * It stops by itself once a refresh shows the balance above the limit
 * (the meter was recharged), or when the user presses Stop.
 */

export const REMINDER_GAPS_MIN = [5, 10, 20];
export const REMINDER_REPEAT_MIN = 60;

/** Minutes to wait after the `sentCount`-th reminder before sending the next one. */
export function nextGapMinutes(sentCount) {
  const index = Math.max(0, Math.floor(sentCount) - 1);
  return REMINDER_GAPS_MIN[index] ?? REMINDER_REPEAT_MIN;
}

export function nextReminderAt(sentCount, now = Date.now()) {
  return now + nextGapMinutes(sentCount) * 60_000;
}

/**
 * Pure decision step, shared by the app and the tests.
 * Returns what to do for one meter, given its saved reminder entry.
 *   { action: 'none' | 'send' | 'clear', entry }
 */
export function decide({ entry, balance, threshold, now = Date.now() }) {
  const low = typeof balance === 'number' && balance <= threshold;
  if (!low) return { action: entry ? 'clear' : 'none', entry: null };
  if (!entry) {
    return { action: 'send', entry: { count: 1, nextAt: nextReminderAt(1, now), muted: false } };
  }
  if (entry.muted || now < entry.nextAt) return { action: 'none', entry };
  const count = (entry.count || 1) + 1;
  return { action: 'send', entry: { ...entry, count, nextAt: nextReminderAt(count, now) } };
}

/* --------------------------------- the tone -------------------------------- */

let audio = null;

function context() {
  if (audio) return audio;
  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null;
  try {
    audio = new Ctor();
  } catch {
    audio = null;
  }
  return audio;
}

/**
 * Browsers only allow sound after the person has touched the page once.
 * Call this on the first tap/click so later alarms are allowed to play.
 */
export function unlockAudio() {
  const ctx = context();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

/**
 * A two-tone "siren" warning: high-low-high-low, twice, about 2.5 seconds.
 * Generated in code, so there is no audio file to download.
 * Returns true when the browser let it play.
 */
export function playAlarm({ volume = 0.35 } = {}) {
  const ctx = context();
  if (!ctx) return false;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (ctx.state !== 'running') return false;

  const start = ctx.currentTime + 0.05;
  const beep = 0.28;
  const pattern = [980, 700, 980, 700, 980, 700, 980, 700];
  pattern.forEach((frequency, index) => {
    const at = start + index * (beep + 0.04) + (index >= 4 ? 0.25 : 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume * 0.5, at + 0.02);
    gain.gain.setValueAtTime(volume * 0.5, at + beep - 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + beep);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + beep + 0.02);
  });
  try {
    navigator.vibrate?.([250, 120, 250, 120, 500]);
  } catch {
    /* not supported */
  }
  return true;
}
