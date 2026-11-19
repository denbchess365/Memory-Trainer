/* =========================================================
   study.js — Study Mode (flashcards) and Quiz Mode (multiple choice)
   ========================================================= */
import * as db from './db.js';
import { schedule, stateFor, isDue, isNew, isWeak, describeInterval } from './srs.js';
import { renderMarkdown, plain } from './markdown.js';
import { esc, $, toast, fmtDuration, pct, shuffle, statePill, typing } from './ui.js';

export const MODES = {
  due: { label: 'Due cards', ico: '⏰' },
  all: { label: 'All cards', ico: '▤' },
  learning: { label: 'Learning cards', ico: '🌱' },
  weak: { label: 'Weak cards', ico: '⚠︎' },
  favorites: { label: 'Favorites', ico: '★' },
  new: { label: 'New cards', ico: '✦' },
  surprise: { label: 'Surprise Me', ico: '🎲' },
  missed: { label: 'Missed cards', ico: '↺' },
};

/**
 * Pick the cards for a session.
 * params: mode, deck (id), tag (name), ids (comma list, used by "study missed again")
 */
export function selectCards(allCards, params, settings) {
  const mode = params.get('mode') || 'due';
  const deck = params.get('deck');
  const tag = (params.get('tag') || '').toLowerCase();
  const ids = params.get('ids');
  let pool = allCards;
  if (deck) pool = pool.filter(c => c.deckId === deck);
  if (tag) pool = pool.filter(c => c.tags.some(t => t.toLowerCase() === tag));
  if (ids) { const set = new Set(ids.split(',')); pool = allCards.filter(c => set.has(c.id)); }

  const now = Date.now();
  let out;
  switch (mode) {
    case 'due': {
      // Reviews/learning that are due come first (most overdue first), then a capped number of new cards.
      const due = pool.filter(c => !isNew(c) && isDue(c, now)).sort((a, b) => a.srs.due - b.srs.due);
      const fresh = pool.filter(isNew).sort((a, b) => a.createdAt - b.createdAt).slice(0, settings.newPerSession || 9999);
      out = settings.shuffle ? [...shuffle(due), ...shuffle(fresh)] : [...due, ...fresh];
      break;
    }
    case 'learning': out = pool.filter(c => stateFor(c.srs) === 'learning'); break;
    case 'weak': out = pool.filter(isWeak); break;
    case 'favorites': out = pool.filter(c => c.favorite); break;
    case 'new': out = pool.filter(isNew); break;
    case 'surprise': out = shuffle([...pool]).slice(0, 20); break;
    default: out = [...pool];
  }
  if (mode !== 'due' && settings.shuffle) shuffle(out);
  const limit = +(params.get('limit') || (['due', 'weak'].includes(mode) ? settings.sessionSize : 0));
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

export function describeSource(params, decks) {
  const mode = MODES[params.get('mode') || 'due']?.label || 'Study';
  const deck = decks.find(d => d.id === params.get('deck'));
  const tag = params.get('tag');
  return [mode, deck && deck.name, tag && '#' + tag].filter(Boolean).join(' · ');
}

async function applyResult(card, correct, ms, mode) {
  card.srs = schedule(card.srs, correct);
  card.stats.correct += correct ? 1 : 0;
  card.stats.incorrect += correct ? 0 : 1;
  card.stats.totalMs += Math.min(ms, 5 * 60 * 1000);
  card.stats.lastResult = correct;
  await db.saveCard(card);
  await db.logAnswer(correct, ms);
}

async function finishSession(rec, deckIds) {
  rec.endedAt = Date.now();
  rec.durationMs = rec.endedAt - rec.startedAt;
  if (rec.total) await db.put('sessions', rec);
  const now = Date.now();
  for (const id of deckIds) { const d = await db.get('decks', id); if (d) { d.lastStudiedAt = now; await db.put('decks', d); } }
}

function emptyState(main, title, msg) {
  main.innerHTML = `<div class="empty"><div class="ico">🎉</div><h2>${esc(title)}</h2><p>${esc(msg)}</p>
    <div class="stack" style="max-width:360px;margin:16px auto 0">
      <a class="btn primary block" href="#/study">Choose another set</a>
      <a class="btn block" href="#/home">Home</a></div></div>`;
}

/* =========================================================
   STUDY MODE
   ========================================================= */
export async function renderStudy(main, params, ctx) {
  const { cards: all, decks } = await ctx.loadAll();
  const settings = ctx.settings;
  const cards = selectCards(all, params, settings);
  ctx.setTitle(describeSource(params, decks));
  if (!cards.length) return emptyState(main, 'Nothing to study here', params.get('mode') === 'due' ? 'No cards are due right now. Nice work — come back later, or study all cards.' : 'No cards match this selection yet.');

  const deckName = id => decks.find(d => d.id === id)?.name || '';
  const queue = cards.map(c => ({ card: c, repeat: false }));
  const rec = { id: db.uid(), mode: 'study', source: describeSource(params, decks), startedAt: Date.now(), total: 0, correct: 0, incorrect: 0, bestStreak: 0, avgMs: 0, durationMs: 0 };
  const missed = new Map();
  let i = 0, revealed = false, streak = 0, shownAt = Date.now(), totalMs = 0;
  ctx.immersive(true);

  const timer = setInterval(() => { const el = $('#sessTime'); if (el) el.textContent = fmtDuration(Date.now() - rec.startedAt); }, 1000);

  function draw() {
    const { card } = queue[i];
    const remaining = queue.length - i;
    main.innerHTML = `
      <div class="study-head" aria-label="Session progress">
        <div class="tile"><div class="v">${remaining}</div><div class="l">Remaining</div></div>
        <div class="tile"><div class="v">${pct(rec.correct, rec.total)}%</div><div class="l">Correct</div></div>
        <div class="tile"><div class="v" id="sessTime">${fmtDuration(Date.now() - rec.startedAt)}</div><div class="l">Time</div></div>
        <div class="tile"><div class="v">${streak}</div><div class="l">Streak</div></div>
        <div class="tile"><div class="v">${rec.bestStreak}</div><div class="l">Best streak</div></div>
        <div class="tile"><div class="v">${rec.total}</div><div class="l">Answered</div></div>
      </div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${queue.length}" aria-valuenow="${i}"><div style="width:${(i / queue.length) * 100}%"></div></div>
      <article class="flash pop" aria-live="polite">
        <div class="meta">
          ${statePill(stateFor(card.srs))}
          ${card.category ? `<span class="pill">${esc(card.category)}</span>` : ''}
          <span class="pill">${esc(deckName(card.deckId))}</span>
          ${queue[i].repeat ? '<span class="pill learning">Again</span>' : ''}
          <button class="fav-btn" id="favBtn" aria-pressed="${card.favorite}" aria-label="Favorite" title="Favorite (F)">${card.favorite ? '★' : '☆'}</button>
        </div>
        <div class="q">${esc(card.question)}</div>
        ${revealed ? `
          <div class="a md">${renderMarkdown(card.answer)}</div>
          ${card.notes ? `<div class="notes md">${renderMarkdown(card.notes)}</div>` : ''}
          ${card.tags.length ? `<div class="chips">${card.tags.map(t => `<span class="pill">#${esc(t)}</span>`).join('')}</div>` : ''}` : ''}
        <div class="spacer"></div>
        <div class="row small muted"><span class="grow">${revealed ? 'Did you get it right?' : 'Think of the answer, then reveal.'}</span>
          <button class="btn sm ghost" id="editBtn" title="Edit (E)">Edit</button></div>
      </article>
      ${revealed
        ? `<div class="answer-bar"><button class="btn bad big" id="wrongBtn">✕ Incorrect <span class="kbd hide-touch">1</span></button>
           <button class="btn good big" id="rightBtn">✓ Correct <span class="kbd hide-touch">2</span></button></div>`
        : `<div class="answer-bar single"><button class="btn primary big" id="revealBtn" autofocus>Reveal Answer <span class="kbd hide-touch">Space</span></button></div>`}
      <div class="row" style="margin-top:12px"><button class="btn ghost grow" id="endBtn">End session</button></div>`;
    $('#favBtn').onclick = toggleFav;
    $('#endBtn').onclick = end;
    $('#editBtn').onclick = async () => { await ctx.editCard(queue[i].card); draw(); };
    if (revealed) { $('#wrongBtn').onclick = () => answer(false); $('#rightBtn').onclick = () => answer(true); }
    else $('#revealBtn').onclick = reveal;
    // Keep focus on the primary action for keyboard + VoiceOver users
    (revealed ? $('#rightBtn') : $('#revealBtn')).focus({ preventScroll: true });
  }

  function reveal() { revealed = true; draw(); }
  async function toggleFav() {
    const c = queue[i].card; c.favorite = !c.favorite; await db.saveCard(c); draw();
  }
  let busy = false; // guards against double-taps / key repeat answering twice
  async function answer(correct) {
    if (busy || !revealed) return; busy = true;
    try { await doAnswer(correct); } finally { busy = false; }
  }
  async function doAnswer(correct) {
    const ms = Date.now() - shownAt; totalMs += ms;
    const { card, repeat } = queue[i];
    await applyResult(card, correct, ms, 'study');
    rec.total++; correct ? rec.correct++ : rec.incorrect++;
    streak = correct ? streak + 1 : 0; rec.bestStreak = Math.max(rec.bestStreak, streak);
    if (!correct) {
      missed.set(card.id, card);
      // Show a missed card again ~4 cards later (once) — short-term repetition helps it stick.
      if (settings.requeueWrong && !repeat) queue.splice(Math.min(queue.length, i + 4), 0, { card, repeat: true });
    }
    i++; revealed = false; shownAt = Date.now();
    if (i >= queue.length) return end();
    draw();
  }
  let ended = false;
  async function end() {
    if (ended) return; ended = true;
    clearInterval(timer);
    rec.avgMs = rec.total ? Math.round(totalMs / rec.total) : 0;
    await finishSession(rec, [...new Set(cards.map(c => c.deckId))]);
    report(main, rec, [...missed.values()], params, 'study');
  }

  const onKey = (e) => {
    if (typing(e) || $('#modal').open || e.metaKey || e.ctrlKey || e.altKey || i >= queue.length || !$('.flash')) return;
    const k = e.key.toLowerCase();
    if (!revealed && (k === ' ' || k === 'enter')) { e.preventDefault(); reveal(); }
    else if (revealed && (k === '1' || k === 'x' || k === 'arrowleft')) { e.preventDefault(); answer(false); }
    else if (revealed && (k === '2' || k === 'c' || k === 'arrowright' || k === 'enter' || k === ' ')) { e.preventDefault(); answer(true); }
    else if (k === 'f') toggleFav();
    else if (k === 'e') $('#editBtn')?.click();
  };
  document.addEventListener('keydown', onKey);
  ctx.setCleanup(() => { clearInterval(timer); document.removeEventListener('keydown', onKey); });
  draw();
}

/* =========================================================
   QUIZ MODE — 4-choice multiple choice
   ========================================================= */
function buildChoices(card, pool) {
  const norm = s => plain(s).toLowerCase();
  const correct = norm(card.answer);
  const seen = new Set([correct]);
  const pick = (list) => {
    const out = [];
    for (const c of shuffle([...list])) {
      const k = norm(c.answer);
      if (!k || seen.has(k)) continue;
      seen.add(k); out.push(c.answer);
      if (out.length >= 3) break;
    }
    return out;
  };
  // Prefer plausible distractors: same category → same deck → anything.
  let d = pick(pool.filter(c => c.id !== card.id && card.category && c.category === card.category));
  if (d.length < 3) d = d.concat(pick(pool.filter(c => c.id !== card.id && c.deckId === card.deckId))).slice(0, 3);
  if (d.length < 3) d = d.concat(pick(pool.filter(c => c.id !== card.id))).slice(0, 3);
  return shuffle([{ text: card.answer, correct: true }, ...d.map(t => ({ text: t, correct: false }))]);
}

export async function renderQuiz(main, params, ctx) {
  const { cards: all, decks } = await ctx.loadAll();
  const settings = ctx.settings;
  if (!params.get('mode')) params.set('mode', 'all');
  let cards = selectCards(all, params, settings);
  ctx.setTitle('Quiz · ' + describeSource(params, decks));
  const limit = +(params.get('limit') || 20);
  cards = cards.slice(0, limit);
  if (!cards.length) return emptyState(main, 'No cards for a quiz', 'Pick a different deck, tag or mode.');
  const uniqueAnswers = new Set(all.map(c => plain(c.answer).toLowerCase())).size;
  if (uniqueAnswers < 2) return emptyState(main, 'Need more cards', 'Quiz Mode needs at least 2 cards with different answers to build choices.');

  const rec = { id: db.uid(), mode: 'quiz', source: 'Quiz · ' + describeSource(params, decks), startedAt: Date.now(), total: 0, correct: 0, incorrect: 0, bestStreak: 0, avgMs: 0, durationMs: 0 };
  const missed = [];
  let i = 0, streak = 0, shownAt = 0, totalMs = 0, choices = [], picked = null;
  ctx.immersive(true);

  function draw() {
    const card = cards[i];
    if (picked === null) { choices = buildChoices(card, all); shownAt = Date.now(); }
    main.innerHTML = `
      <div class="study-head">
        <div class="tile"><div class="v">${i + 1}/${cards.length}</div><div class="l">Question</div></div>
        <div class="tile"><div class="v">${rec.correct}</div><div class="l">Score</div></div>
        <div class="tile"><div class="v">${pct(rec.correct, rec.total)}%</div><div class="l">Correct</div></div>
      </div>
      <div class="progress"><div style="width:${(i / cards.length) * 100}%"></div></div>
      <article class="flash pop" style="min-height:auto">
        <div class="meta">${card.category ? `<span class="pill">${esc(card.category)}</span>` : ''}<span class="pill">${esc(decks.find(d => d.id === card.deckId)?.name || '')}</span></div>
        <div class="q">${esc(card.question)}</div>
        ${picked !== null && card.notes ? `<div class="notes md">${renderMarkdown(card.notes)}</div>` : ''}
      </article>
      <div class="choices" role="group" aria-label="Answer choices">
        ${choices.map((c, n) => {
          let cls = '';
          if (picked !== null) { if (c.correct) cls = 'correct'; else if (n === picked) cls = 'wrong'; }
          return `<button class="btn choice ${cls}" data-n="${n}" ${picked !== null ? 'aria-disabled="true"' : ''}><span class="key">${n + 1}</span><span>${esc(plain(c.text))}</span></button>`;
        }).join('')}
      </div>
      ${picked !== null ? `
        <div class="feedback ${choices[picked].correct ? 'good' : 'bad'}" style="margin-top:12px" role="alert">${choices[picked].correct ? '✓ Correct' : '✕ Incorrect — answer: ' + esc(plain(card.answer))}</div>
        <div class="answer-bar single"><button class="btn primary big" id="nextBtn">${i + 1 < cards.length ? 'Next question' : 'See results'} <span class="kbd hide-touch">Enter</span></button></div>` : ''}
      <div class="row" style="margin-top:12px"><button class="btn ghost grow" id="endBtn">End quiz</button></div>`;
    main.querySelectorAll('.choice').forEach(b => b.onclick = () => choose(+b.dataset.n));
    $('#endBtn').onclick = end;
    if (picked !== null) { $('#nextBtn').onclick = next; $('#nextBtn').focus({ preventScroll: true }); }
  }

  async function choose(n) {
    if (picked !== null || quizEnded) return;
    picked = n;
    const ms = Date.now() - shownAt; totalMs += ms;
    const correct = choices[n].correct;
    rec.total++; correct ? rec.correct++ : rec.incorrect++;
    streak = correct ? streak + 1 : 0; rec.bestStreak = Math.max(rec.bestStreak, streak);
    if (!correct) missed.push(cards[i]);
    // Quiz answers also feed the spaced-repetition schedule (recognition is weaker than recall,
    // but a miss is a real signal the card needs work).
    await applyResult(cards[i], correct, ms, 'quiz');
    draw();
  }
  let quizEnded = false;
  function next() { if (picked === null) return; picked = null; i++; if (i >= cards.length) return end(); draw(); }
  async function end() {
    if (quizEnded) return; quizEnded = true;
    rec.avgMs = rec.total ? Math.round(totalMs / rec.total) : 0;
    await finishSession(rec, [...new Set(cards.map(c => c.deckId))]);
    report(main, rec, missed, params, 'quiz');
  }

  const onKey = (e) => {
    if (typing(e) || $('#modal').open || e.metaKey || e.ctrlKey || !$('.choices')) return;
    if (picked === null && /^[1-4]$/.test(e.key) && +e.key <= choices.length) { e.preventDefault(); choose(+e.key - 1); }
    else if (picked !== null && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); next(); }
  };
  document.addEventListener('keydown', onKey);
  ctx.setCleanup(() => document.removeEventListener('keydown', onKey));
  draw();
}

/* =========================================================
   END-OF-SESSION REPORT
   ========================================================= */
function report(main, rec, missed, params, kind) {
  const score = pct(rec.correct, rec.total);
  const msg = !rec.total ? 'No answers recorded.' : score >= 90 ? 'Outstanding!' : score >= 75 ? 'Solid work.' : score >= 50 ? 'Getting there — the misses will come back soon.' : 'Tough set. Spaced repetition will bring these back often.';
  const again = new URLSearchParams(params);
  const missedQ = new URLSearchParams({ mode: 'missed', ids: missed.map(c => c.id).join(',') });
  main.innerHTML = `
    <h2 class="center">${kind === 'quiz' ? 'Quiz complete' : 'Session complete'}</h2>
    <div class="big-score">${score}%</div>
    <p class="center muted">${esc(msg)}</p>
    <div class="tiles" style="margin-top:14px">
      <div class="tile"><div class="v">${rec.correct}/${rec.total}</div><div class="l">Correct</div></div>
      <div class="tile"><div class="v">${fmtDuration(rec.durationMs)}</div><div class="l">Session time</div></div>
      <div class="tile"><div class="v">${(rec.avgMs / 1000).toFixed(1)}s</div><div class="l">Avg response time</div></div>
      <div class="tile"><div class="v">${rec.bestStreak}</div><div class="l">Best streak</div></div>
    </div>
    ${missed.length ? `<h3>Missed (${missed.length})</h3><ul class="list">${missed.map(c => `
      <li><a class="list-item" href="#/card/${c.id}"><div class="main"><div class="title">${esc(c.question)}</div>
      <div class="sub">${esc(plain(c.answer))} · next ${describeInterval(c.srs)}</div></div><span class="chev">›</span></a></li>`).join('')}</ul>` : ''}
    <div class="stack" style="margin-top:18px">
      ${missed.length ? `<a class="btn primary big block" href="#/${kind}?${missedQ}">Retry missed cards</a>` : ''}
      <a class="btn block" href="#/${kind}?${again}">Go again</a>
      <a class="btn block" href="#/home">Done</a>
    </div>`;
  if (rec.total) toast(`Saved · ${rec.correct}/${rec.total} correct`);
}
