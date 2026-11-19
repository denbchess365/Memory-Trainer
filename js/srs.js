/* =========================================================
   srs.js — spaced repetition scheduler
   ---------------------------------------------------------
   A simplified SM-2 (the algorithm behind SuperMemo/Anki),
   adapted for two buttons: Correct / Incorrect.

   Each card carries:
     interval  days until next review (0 = still in short-term learning)
     ease      growth multiplier, starts at 2.5, min 1.3, max 3.0
     reps      consecutive correct answers
     lapses    times the card was forgotten after being learned
     due       timestamp when the card should next be shown

   CORRECT:
     1st success  -> due in 10 minutes (confirm it stuck)   [learning step]
     2nd success  -> 1 day
     3rd success  -> 3 days
     afterwards   -> interval × ease  (e.g. 3 → 8 → 20 → 52 days…)
     ease +0.05 (cards you keep getting right space out faster)
   INCORRECT:
     interval resets to 0, reps reset to 0, due in 1 minute,
     ease −0.2 (the card will grow more slowly from now on),
     lapses +1 if it had already graduated (interval ≥ 1).

   STATE is derived from interval so it is always consistent:
     New       never answered
     Learning  interval < 7 days
     Review    7–20 days
     Mastered  ≥ 21 days
   "Weak" is not a state but a filter: lapses ≥ 2, ease < 2.0,
   or accuracy < 60% after 3+ attempts.

   A small random "fuzz" (±5%) is added to long intervals so
   cards created together don't all come due on the same day.
   ========================================================= */

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
export const MASTERED_DAYS = 21;
export const REVIEW_DAYS = 7;

export function stateFor(srs) {
  if (!srs || (srs.reps === 0 && srs.lastReviewed === 0)) return 'new';
  if (srs.interval >= MASTERED_DAYS) return 'mastered';
  if (srs.interval >= REVIEW_DAYS) return 'review';
  return 'learning';
}

/** Returns a NEW srs object; never mutates the input. */
export function schedule(srs, correct, now = Date.now()) {
  const s = { ...srs };
  s.lastReviewed = now;
  if (correct) {
    s.reps += 1;
    if (s.reps === 1 && s.interval === 0) { s.interval = 0; s.due = now + 10 * MIN; }
    else if (s.interval < 1) { s.interval = 1; }
    else if (s.interval < 3) { s.interval = 3; }
    else { s.interval = Math.min(3650, Math.round(s.interval * s.ease * fuzz())); }
    if (s.interval >= 1) s.due = startOfDay(now) + s.interval * DAY + 4 * 60 * MIN; // due at 4am local on that day
    s.ease = Math.min(3.0, +(s.ease + 0.05).toFixed(2));
  } else {
    if (s.interval >= 1) s.lapses += 1;
    s.reps = 0;
    s.interval = 0;
    s.ease = Math.max(1.3, +(s.ease - 0.2).toFixed(2));
    s.due = now + 1 * MIN;
  }
  s.state = stateFor(s);
  return s;
}

function fuzz() { return 0.95 + Math.random() * 0.1; }
function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }

export function isDue(card, now = Date.now()) { return (card.srs?.due ?? 0) <= now; }
export function isNew(card) { return stateFor(card.srs) === 'new'; }
export function isWeak(card) {
  const st = card.stats || {}; const tries = (st.correct || 0) + (st.incorrect || 0);
  return (card.srs?.lapses || 0) >= 2 || ((card.srs?.ease ?? 2.5) < 2.0 && tries > 0) ||
    (tries >= 3 && st.correct / tries < 0.6);
}
/** Cards due before end of today (what the home screen calls "due today"). */
export function isDueToday(card) {
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return (card.srs?.due ?? 0) <= end.getTime();
}

export function describeInterval(srs) {
  const due = srs.due - Date.now();
  if (due <= 0) return 'due now';
  if (due < 60 * MIN) return `in ${Math.max(1, Math.round(due / MIN))} min`;
  if (due < DAY) return `in ${Math.round(due / (60 * MIN))} h`;
  const d = Math.round(due / DAY);
  return d < 60 ? `in ${d} day${d === 1 ? '' : 's'}` : `in ${Math.round(d / 30)} months`;
}
