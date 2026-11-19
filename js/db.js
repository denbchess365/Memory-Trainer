/* =========================================================
   db.js — local storage layer (IndexedDB) + data model
   ---------------------------------------------------------
   WHERE YOUR DATA LIVES
   Everything is stored in your browser's IndexedDB database
   named "memory-trainer", on this device only, scoped to the
   site's origin (e.g. https://you.github.io). Nothing is sent
   anywhere: there is no server, no analytics, no sync.
   Deleting the app / clearing website data deletes it, which
   is why Backup exists.

   DATA MODEL (object stores)
   --------------------------
   decks     { id, name, description, color, createdAt, updatedAt, lastStudiedAt }
   cards     { id, deckId, question, answer, notes, category, tags[], favorite,
               srs: { state, interval, ease, reps, lapses, due, lastReviewed },
               stats: { correct, incorrect, totalMs, lastResult },
               createdAt, updatedAt }
   tags      { name (key, lowercase), label, createdAt }
   sessions  { id, mode, source, startedAt, endedAt, total, correct, incorrect,
               bestStreak, avgMs, durationMs }
   daily     { date (key, "YYYY-MM-DD" local), reviews, correct, timeMs }
   meta      { key, value }   — settings, lastBackupAt, schemaVersion, etc.

   DESIGN DECISIONS
   - IDs are random strings (crypto.randomUUID) instead of auto-increment
     numbers so that exports from two devices can be merged without
     collisions.
   - Every record has updatedAt so imports can resolve conflicts by
     "newest wins" — no record is ever deleted by an import.
   - SRS state is embedded in the card (not a separate store): a card and
     its schedule are always read/written together, so one store = one
     transaction = no orphaned schedules.
   - Daily activity is pre-aggregated per day (not one row per answer)
     so the stats dashboard stays fast with years of history, and so
     merges are idempotent (we keep the max of each counter per day).
   - Tags are stored on the card as an array (fast filtering) and also
     mirrored in a small "tags" store so the tag list survives even if
     the last card using it is edited, and to keep original casing.
   ========================================================= */

const DB_NAME = 'memory-trainer';
const DB_VERSION = 1;
export const SCHEMA_VERSION = 1;

let dbPromise = null;

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('decks')) db.createObjectStore('decks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cards')) {
        const s = db.createObjectStore('cards', { keyPath: 'id' });
        s.createIndex('deckId', 'deckId');
      }
      if (!db.objectStoreNames.contains('tags')) db.createObjectStore('tags', { keyPath: 'name' });
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('startedAt', 'startedAt');
      }
      if (!db.objectStoreNames.contains('daily')) db.createObjectStore('daily', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => console.warn('IndexedDB upgrade blocked by another open tab');
  });
  return dbPromise;
}

function reqP(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}
function txDone(tx) {
  return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}

async function store(name, mode = 'readonly') {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}
export async function getAll(name) { return reqP((await store(name)).getAll()); }
export async function get(name, key) { return reqP((await store(name)).get(key)); }
export async function put(name, value) { return reqP((await store(name, 'readwrite')).put(value)); }
export async function del(name, key) { return reqP((await store(name, 'readwrite')).delete(key)); }

export async function putMany(name, values) {
  const db = await openDB();
  const tx = db.transaction(name, 'readwrite');
  const s = tx.objectStore(name);
  for (const v of values) s.put(v);
  return txDone(tx);
}

/* ---------- Meta / settings ---------- */
export async function getMeta(key, fallback = null) {
  const r = await get('meta', key);
  return r ? r.value : fallback;
}
export async function setMeta(key, value) { return put('meta', { key, value }); }

export const DEFAULT_SETTINGS = {
  theme: 'auto',            // auto | light | dark
  fontScale: 1,             // 1, 1.15, 1.3
  requeueWrong: true,       // show missed cards again later in the same session
  sessionSize: 30,          // max cards per study session (0 = unlimited)
  newPerSession: 15,        // cap on brand-new cards mixed into a "due" session
  remindersEnabled: false,
  reminderTime: '19:00',
  shuffle: true,
};
export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await getMeta('settings', {})) };
}
export async function saveSettings(s) { return setMeta('settings', s); }

/* ---------- Factories (single source of truth for record shape) ---------- */
export function newDeck(name, extra = {}) {
  const now = Date.now();
  return { id: uid(), name: name.trim() || 'Untitled deck', description: '', color: pickColor(name), createdAt: now, updatedAt: now, lastStudiedAt: 0, ...extra };
}
export function newCard(deckId, fields = {}) {
  const now = Date.now();
  return {
    id: uid(), deckId,
    question: '', answer: '', notes: '', category: '', tags: [], favorite: false,
    srs: { state: 'new', interval: 0, ease: 2.5, reps: 0, lapses: 0, due: now, lastReviewed: 0 },
    stats: { correct: 0, incorrect: 0, totalMs: 0, lastResult: null },
    createdAt: now, updatedAt: now,
    ...fields,
  };
}
const COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#2563eb', '#65a30d', '#0d9488'];
function pickColor(s = '') { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; }

export function normalizeTags(input) {
  const arr = Array.isArray(input) ? input : String(input || '').split(',');
  const seen = new Set(); const out = [];
  for (let t of arr) {
    t = String(t).trim().replace(/^#/, '');
    if (!t) continue;
    const k = t.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}

/* ---------- Decks ---------- */
export async function saveDeck(deck) { deck.updatedAt = Date.now(); await put('decks', deck); return deck; }

export async function deleteDeck(deckId) {
  const db = await openDB();
  const tx = db.transaction(['decks', 'cards'], 'readwrite');
  tx.objectStore('decks').delete(deckId);
  const idx = tx.objectStore('cards').index('deckId');
  const keys = await reqP(idx.getAllKeys(deckId));
  for (const k of keys) tx.objectStore('cards').delete(k);
  return txDone(tx);
}

export async function duplicateDeck(deckId) {
  const src = await get('decks', deckId);
  if (!src) return null;
  const copy = newDeck(src.name + ' (copy)', { description: src.description, color: src.color });
  const cards = await cardsInDeck(deckId);
  // Duplicated cards start fresh (new SRS state) — a copy is usually for re-learning or editing.
  const clones = cards.map(c => newCard(copy.id, {
    question: c.question, answer: c.answer, notes: c.notes, category: c.category,
    tags: [...c.tags], favorite: c.favorite,
  }));
  await put('decks', copy);
  await putMany('cards', clones);
  return copy;
}

export async function cardsInDeck(deckId) {
  const s = await store('cards');
  return reqP(s.index('deckId').getAll(deckId));
}

/* ---------- Cards ---------- */
export async function saveCard(card) {
  card.tags = normalizeTags(card.tags);
  card.updatedAt = Date.now();
  await put('cards', card);
  await upsertTags(card.tags);
  return card;
}
export async function saveCards(cards) {
  const now = Date.now();
  const tags = new Set();
  for (const c of cards) { c.tags = normalizeTags(c.tags); c.updatedAt = c.updatedAt || now; c.tags.forEach(t => tags.add(t)); }
  await putMany('cards', cards);
  await upsertTags([...tags]);
}
export async function upsertTags(list) {
  if (!list.length) return;
  const existing = new Set((await getAll('tags')).map(t => t.name));
  const add = list.filter(t => !existing.has(t.toLowerCase())).map(t => ({ name: t.toLowerCase(), label: t, createdAt: Date.now() }));
  if (add.length) await putMany('tags', add);
}

/* ---------- Activity ---------- */
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export async function logAnswer(correct, ms) {
  const key = dayKey();
  const row = (await get('daily', key)) || { date: key, reviews: 0, correct: 0, timeMs: 0 };
  row.reviews += 1; if (correct) row.correct += 1; row.timeMs += Math.min(ms, 5 * 60 * 1000);
  await put('daily', row);
}

/* ---------- Export / import / backup ---------- */
export async function exportAll() {
  const [decks, cards, tags, sessions, daily, meta] = await Promise.all(
    ['decks', 'cards', 'tags', 'sessions', 'daily', 'meta'].map(getAll));
  return {
    app: 'memory-trainer', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(),
    decks, cards, tags, sessions, daily,
    // only portable settings — not device-specific bookkeeping like lastBackupAt
    meta: meta.filter(m => m.key === 'settings'),
  };
}

export async function exportDeck(deckId) {
  const deck = await get('decks', deckId);
  const cards = await cardsInDeck(deckId);
  return { app: 'memory-trainer', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), decks: [deck], cards, tags: [], sessions: [], daily: [], meta: [] };
}

/**
 * Merge an export into the local database WITHOUT losing data.
 * Rules:
 *  - Records are matched by id. Unknown ids are added.
 *  - Same id on both sides: the one with the newer updatedAt wins.
 *  - Nothing local is ever deleted.
 *  - Cards whose deck is missing are attached to an "Imported" deck.
 *  - Daily activity: per-day max of each counter (idempotent — importing
 *    the same file twice doesn't double your stats).
 * Also accepts a plain array of {question, answer, ...} for convenience.
 */
export async function importData(data, { replace = false } = {}) {
  if (Array.isArray(data)) data = { decks: [], cards: data };
  if (!data || typeof data !== 'object' || !Array.isArray(data.cards || data.decks)) {
    throw new Error('This file is not a Memory Trainer export.');
  }
  if (replace) await wipeAll();

  const result = { decksAdded: 0, decksUpdated: 0, cardsAdded: 0, cardsUpdated: 0, cardsSkipped: 0 };
  const localDecks = new Map((await getAll('decks')).map(d => [d.id, d]));
  const localCards = new Map((await getAll('cards')).map(c => [c.id, c]));

  const decksOut = [];
  for (const raw of data.decks || []) {
    if (!raw || !raw.id || !raw.name) continue;
    const d = { ...newDeck(raw.name), ...raw };
    const cur = localDecks.get(d.id);
    if (!cur) { result.decksAdded++; decksOut.push(d); localDecks.set(d.id, d); }
    else if ((d.updatedAt || 0) > (cur.updatedAt || 0)) { result.decksUpdated++; decksOut.push(d); localDecks.set(d.id, d); }
  }

  let fallbackDeck = null;
  const cardsOut = [];
  for (const raw of data.cards || []) {
    if (!raw || (!raw.question && !raw.answer)) continue;
    let deckId = raw.deckId;
    if (!deckId || !localDecks.has(deckId)) {
      if (!fallbackDeck) { fallbackDeck = newDeck('Imported ' + new Date().toLocaleDateString()); decksOut.push(fallbackDeck); localDecks.set(fallbackDeck.id, fallbackDeck); result.decksAdded++; }
      deckId = fallbackDeck.id;
    }
    const base = newCard(deckId);
    const c = {
      ...base, ...raw, deckId,
      id: raw.id || base.id,
      tags: normalizeTags(raw.tags),
      srs: { ...base.srs, ...(raw.srs || {}) },
      stats: { ...base.stats, ...(raw.stats || {}) },
      question: String(raw.question ?? ''), answer: String(raw.answer ?? ''),
      notes: String(raw.notes ?? ''), category: String(raw.category ?? ''),
    };
    const cur = localCards.get(c.id);
    if (!cur) { result.cardsAdded++; cardsOut.push(c); }
    else if ((c.updatedAt || 0) > (cur.updatedAt || 0)) { result.cardsUpdated++; cardsOut.push(c); }
    else result.cardsSkipped++;
  }

  await putMany('decks', decksOut);
  await saveCards(cardsOut);
  if (Array.isArray(data.tags)) await upsertTags(data.tags.map(t => t.label || t.name).filter(Boolean));

  if (Array.isArray(data.sessions)) {
    const have = new Set((await getAll('sessions')).map(s => s.id));
    await putMany('sessions', data.sessions.filter(s => s && s.id && !have.has(s.id)));
  }
  if (Array.isArray(data.daily)) {
    const local = new Map((await getAll('daily')).map(d => [d.date, d]));
    const out = [];
    for (const d of data.daily) {
      if (!d || !d.date) continue;
      const cur = local.get(d.date) || { date: d.date, reviews: 0, correct: 0, timeMs: 0 };
      out.push({ date: d.date, reviews: Math.max(cur.reviews, d.reviews || 0), correct: Math.max(cur.correct, d.correct || 0), timeMs: Math.max(cur.timeMs, d.timeMs || 0) });
    }
    await putMany('daily', out);
  }
  if (replace && Array.isArray(data.meta)) {
    const s = data.meta.find(m => m.key === 'settings');
    if (s) await setMeta('settings', s.value);
  }
  return result;
}

export async function wipeAll() {
  const db = await openDB();
  const names = ['decks', 'cards', 'tags', 'sessions', 'daily'];
  const tx = db.transaction(names, 'readwrite');
  for (const n of names) tx.objectStore(n).clear();
  return txDone(tx);
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (e) { /* unsupported */ }
  return false;
}
export async function storageEstimate() {
  try { if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate(); } catch (e) {}
  return null;
}
