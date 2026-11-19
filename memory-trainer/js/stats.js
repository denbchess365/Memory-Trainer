/* =========================================================
   stats.js — statistics dashboard + streak helpers
   ========================================================= */
import * as db from './db.js';
import { stateFor } from './srs.js';
import { barChart } from './charts.js';
import { esc, $, $$, pct, fmtDuration, fmtWhen } from './ui.js';

/** Consecutive days with at least one review, ending today (or yesterday, so the streak
 *  isn't shown as broken before you've studied today). */
export function studyStreak(daily) {
  const set = new Set(daily.filter(d => d.reviews > 0).map(d => d.date));
  const d = new Date();
  if (!set.has(db.dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(db.dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function buckets(daily, kind) {
  const map = new Map(daily.map(d => [d.date, d]));
  const labels = [], correct = [], wrong = [];
  const today = new Date(); today.setHours(12, 0, 0, 0);
  if (kind === 'daily') {
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const r = map.get(db.dayKey(d)) || { reviews: 0, correct: 0 };
      labels.push(i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'narrow' }) + d.getDate());
      correct.push(r.correct); wrong.push(r.reviews - r.correct);
    }
  } else if (kind === 'weekly') {
    // weeks start Monday
    const start = new Date(today); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    for (let w = 11; w >= 0; w--) {
      const ws = new Date(start); ws.setDate(ws.getDate() - w * 7);
      let c = 0, t = 0;
      for (let k = 0; k < 7; k++) { const d = new Date(ws); d.setDate(d.getDate() + k); const r = map.get(db.dayKey(d)); if (r) { c += r.correct; t += r.reviews; } }
      labels.push(w === 0 ? 'This wk' : `${ws.getMonth() + 1}/${ws.getDate()}`);
      correct.push(c); wrong.push(t - c);
    }
  } else {
    for (let m = 11; m >= 0; m--) {
      const ms = new Date(today.getFullYear(), today.getMonth() - m, 1);
      const prefix = `${ms.getFullYear()}-${String(ms.getMonth() + 1).padStart(2, '0')}`;
      let c = 0, t = 0;
      for (const r of daily) if (r.date.startsWith(prefix)) { c += r.correct; t += r.reviews; }
      labels.push(ms.toLocaleDateString(undefined, { month: 'short' }));
      correct.push(c); wrong.push(t - c);
    }
  }
  return { labels, correct, wrong };
}

export async function renderStats(main, ctx) {
  ctx.setTitle('Statistics');
  const { cards, decks } = await ctx.loadAll();
  const daily = await db.getAll('daily');
  const sessions = (await db.getAll('sessions')).sort((a, b) => b.startedAt - a.startedAt);

  const counts = { new: 0, learning: 0, review: 0, mastered: 0 };
  for (const c of cards) counts[stateFor(c.srs)]++;
  const totalReviews = daily.reduce((s, d) => s + d.reviews, 0);
  const totalCorrect = daily.reduce((s, d) => s + d.correct, 0);
  const totalTime = daily.reduce((s, d) => s + d.timeMs, 0);
  const activeDays = daily.filter(d => d.reviews > 0).length;
  const favs = cards.filter(c => c.favorite).length;
  const n = cards.length || 1;

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const seg = [['new', '--primary'], ['learning', '--warn'], ['review', '--text-2'], ['mastered', '--good']];

  main.innerHTML = `
    <div class="tiles grid-auto">
      <div class="tile accent"><div class="v">${cards.length}</div><div class="l">Total cards</div></div>
      <div class="tile"><div class="v">${decks.length}</div><div class="l">Total decks</div></div>
      <div class="tile"><div class="v">${counts.mastered}</div><div class="l">Cards mastered</div></div>
      <div class="tile"><div class="v">${counts.learning}</div><div class="l">Cards learning</div></div>
      <div class="tile"><div class="v">${pct(totalCorrect, totalReviews)}%</div><div class="l">Review accuracy</div></div>
      <div class="tile"><div class="v">${studyStreak(daily)}🔥</div><div class="l">Study streak (days)</div></div>
      <div class="tile"><div class="v">${totalReviews}</div><div class="l">Total reviews</div></div>
      <div class="tile"><div class="v">${fmtDuration(totalTime)}</div><div class="l">Time studied</div></div>
    </div>

    <h2>Card states</h2>
    <div class="card">
      <div class="stack-bar" role="img" aria-label="New ${counts.new}, Learning ${counts.learning}, Review ${counts.review}, Mastered ${counts.mastered}">
        ${seg.map(([k, v]) => counts[k] ? `<div style="width:${(counts[k] / n) * 100}%;background:var(${v})"></div>` : '').join('')}
      </div>
      <div class="legend">${seg.map(([k, v]) => `<span><i style="background:var(${v})"></i>${k[0].toUpperCase() + k.slice(1)} ${counts[k]}</span>`).join('')}<span>★ Favorites ${favs}</span></div>
    </div>

    <h2>Activity</h2>
    <div class="card">
      <div class="seg-tabs" role="tablist">
        <button role="tab" data-k="daily" aria-selected="true">Daily</button>
        <button role="tab" data-k="weekly" aria-selected="false">Weekly</button>
        <button role="tab" data-k="monthly" aria-selected="false">Monthly</button>
      </div>
      <div class="chart-wrap"><canvas id="chart" role="img" aria-label="Reviews over time"></canvas></div>
      <div class="legend"><span><i style="background:var(--good)"></i>Correct</span><span><i style="background:var(--bad)"></i>Incorrect</span><span id="chartSum"></span></div>
      <p class="small muted" style="margin-top:8px">${activeDays} active day${activeDays === 1 ? '' : 's'} all-time.</p>
    </div>

    <h2>Decks</h2>
    ${decks.length ? `<ul class="list">${decks.map(d => {
      const dc = cards.filter(c => c.deckId === d.id); const m = dc.filter(c => stateFor(c.srs) === 'mastered').length;
      return `<li><a class="list-item" href="#/deck/${d.id}"><span class="swatch" style="background:${esc(d.color)}"></span>
        <div class="main"><div class="title">${esc(d.name)}</div><div class="sub">${dc.length} cards · ${pct(m, dc.length)}% mastered</div>
        <div class="progress" style="margin:6px 0 0"><div style="width:${pct(m, dc.length)}%;background:var(--good)"></div></div></div></a></li>`;
    }).join('')}</ul>` : '<p class="muted">No decks yet.</p>'}

    <h2>Recent sessions</h2>
    ${sessions.length ? `<ul class="list">${sessions.slice(0, 10).map(s => `<li><div class="list-item"><div class="main">
      <div class="title">${esc(s.source || s.mode)}</div>
      <div class="sub">${fmtWhen(s.startedAt)} · ${s.correct}/${s.total} (${pct(s.correct, s.total)}%) · ${fmtDuration(s.durationMs || 0)}${s.avgMs ? ` · ${(s.avgMs / 1000).toFixed(1)}s avg` : ''}</div></div></div></li>`).join('')}</ul>` : '<p class="muted">No sessions yet — start studying!</p>'}
  `;

  let stop = null;
  const show = (kind) => {
    $$('.seg-tabs button', main).forEach(b => b.setAttribute('aria-selected', b.dataset.k === kind));
    const b = buckets(daily, kind);
    if (stop) stop();
    stop = barChart($('#chart'), { labels: b.labels, series: [{ name: 'Correct', values: b.correct, color: css('--good') }, { name: 'Incorrect', values: b.wrong, color: css('--bad') }] });
    const tot = b.correct.reduce((a, x) => a + x, 0) + b.wrong.reduce((a, x) => a + x, 0);
    $('#chartSum').textContent = `· ${tot} reviews in this view`;
  };
  $$('.seg-tabs button', main).forEach(b => b.onclick = () => show(b.dataset.k));
  show('daily');
  ctx.setCleanup(() => stop && stop());
}
