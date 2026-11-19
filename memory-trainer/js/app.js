/* =========================================================
   app.js — app shell, router and views
   Hash routes (work on GitHub Pages / any static host, no server rewrites):
     #/home  #/decks  #/deck/:id  #/card/:id  #/card/new?deck=
     #/study?mode=&deck=&tag=  #/quiz?...  #/search  #/tags
     #/stats  #/settings  #/quickadd  #/help
   ========================================================= */
import * as db from './db.js';
import { stateFor, isDueToday, isWeak, isNew, describeInterval } from './srs.js';
import { renderMarkdown, plain } from './markdown.js';
import { esc, $, $$, toast, modal, confirmDialog, promptDialog, fmtWhen, fmtDuration, pct, saveFile, pickFile, stamp, statePill, typing, isIOS, isStandalone } from './ui.js';
import { renderStudy, renderQuiz, MODES } from './study.js';
import { renderStats, studyStreak } from './stats.js';
import { SAMPLE_DECK } from './sample-deck.js';

const APP_VERSION = '1.0.0';
const main = $('#main');
let settings = { ...db.DEFAULT_SETTINGS };
let cleanup = null;

/* ---------- context passed to views ---------- */
const ctx = {
  get settings() { return settings; },
  setTitle(t) { $('#pageTitle').textContent = t; document.title = t === 'Memory Trainer' ? t : `${t} · Memory Trainer`; },
  setCleanup(fn) { cleanup = fn; },
  immersive(on) { document.body.classList.toggle('immersive', on); },
  async loadAll() {
    const [decks, cards] = await Promise.all([db.getAll('decks'), db.getAll('cards')]);
    decks.sort((a, b) => a.name.localeCompare(b.name));
    return { decks, cards };
  },
  editCard: (card) => editCardModal(card),
};

/* =========================================================
   ROUTER
   ========================================================= */
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'home';
  const [path, qs] = raw.split('?');
  return { parts: path.split('/').map(decodeURIComponent), params: new URLSearchParams(qs || '') };
}

const TAB_ROUTES = ['home', 'decks', 'search', 'stats', 'settings'];

async function route() {
  if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
  ctx.immersive(false);
  const { parts, params } = parseHash();
  const [name, arg] = parts;
  $$('#tabbar a').forEach(a => a.toggleAttribute('aria-current', false));
  const tab = TAB_ROUTES.includes(name) ? name : (name === 'deck' || name === 'card') ? 'decks' : name === 'tags' ? 'search' : null;
  if (tab) $(`#tabbar a[data-tab="${tab}"]`).setAttribute('aria-current', 'page');
  $('#backBtn').hidden = TAB_ROUTES.includes(name);
  window.scrollTo(0, 0);
  try {
    switch (name) {
      case 'home': await viewHome(); break;
      case 'decks': await viewDecks(); break;
      case 'deck': await viewDeck(arg); break;
      case 'card': await viewCard(arg, params); break;
      case 'study': params.get('mode') ? await renderStudy(main, params, ctx) : await viewStudyPicker(params, 'study'); break;
      case 'quiz': params.get('mode') ? await renderQuiz(main, params, ctx) : await viewStudyPicker(params, 'quiz'); break;
      case 'search': await viewSearch(params); break;
      case 'tags': await viewTags(); break;
      case 'stats': await renderStats(main, ctx); break;
      case 'settings': await viewSettings(); break;
      case 'quickadd': await viewQuickAdd(params); break;
      case 'help': viewHelp(); break;
      default: location.hash = '#/home';
    }
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="empty"><div class="ico">⚠︎</div><h2>Something went wrong</h2><p>${esc(err.message || err)}</p><a class="btn" href="#/home">Home</a></div>`;
  }
  main.focus({ preventScroll: true });
}

window.addEventListener('hashchange', route);
// Re-render when a link points at the page we're already on (e.g. "Go again").
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); route(); }
});
$('#backBtn').onclick = () => { if (history.length > 1) history.back(); else location.hash = '#/home'; };
$('#quickAddBtn').onclick = () => { location.hash = '#/quickadd'; };

/* =========================================================
   HOME
   ========================================================= */
async function viewHome() {
  ctx.setTitle('Memory Trainer');
  const { decks, cards } = await ctx.loadAll();
  const daily = await db.getAll('daily');
  const today = daily.find(d => d.date === db.dayKey()) || { reviews: 0, correct: 0 };
  const sessions = (await db.getAll('sessions')).sort((a, b) => b.startedAt - a.startedAt);
  const last = sessions[0];
  const dueReviews = cards.filter(c => !isNew(c) && isDueToday(c)).length;
  const newCount = cards.filter(isNew).length;
  const dueTotal = dueReviews + Math.min(newCount, settings.newPerSession);
  const recent = [...decks].sort((a, b) => (b.lastStudiedAt || b.updatedAt) - (a.lastStudiedAt || a.updatedAt)).slice(0, 4);
  const dismissed = localStorage.getItem('mt-install-dismissed');

  main.innerHTML = `
    ${isIOS() && !isStandalone() && !dismissed ? `<div class="banner" id="installBanner"><strong>Install on your iPhone:</strong> tap the Share button <span aria-hidden="true">⎋</span> in Safari, then <strong>Add to Home Screen</strong>. It then works fully offline.
      <div class="row" style="margin-top:8px"><a class="btn sm" href="#/help">How-to</a><button class="btn sm ghost" id="dismissInstall">Dismiss</button></div></div>` : ''}
    <div class="tiles">
      <div class="tile accent"><div class="v">${dueTotal}</div><div class="l">Due today${newCount ? ` <span class="hint">(${dueReviews} review + ${Math.min(newCount, settings.newPerSession)} new)</span>` : ''}</div></div>
      <div class="tile"><div class="v">${today.reviews}</div><div class="l">Studied today</div></div>
      <div class="tile"><div class="v">${studyStreak(daily)}🔥</div><div class="l">Study streak (days)</div></div>
      <div class="tile"><div class="v">${last ? pct(last.correct, last.total) + '%' : '—'}</div><div class="l">Last session${last ? ` · ${last.correct}/${last.total}` : ''}</div></div>
    </div>

    <a class="btn primary big block" style="margin-top:14px" href="#/study?mode=due">${dueTotal ? `Study ${dueTotal} due card${dueTotal === 1 ? '' : 's'}` : 'Nothing due — study anyway'}</a>

    <h2>Quick start</h2>
    <div class="quick-grid">
      <a class="btn" href="#/study?mode=surprise"><span class="ico">🎲</span>Surprise Me</a>
      <a class="btn" href="#/quiz?mode=all"><span class="ico">❓</span>Quiz</a>
      <a class="btn" href="#/study?mode=favorites"><span class="ico">★</span>Favorites</a>
      <a class="btn" href="#/study?mode=weak"><span class="ico">⚠︎</span>Weak cards</a>
      <a class="btn" href="#/study?mode=learning"><span class="ico">🌱</span>Learning</a>
      <a class="btn" href="#/quickadd"><span class="ico">＋</span>Quick Add</a>
      <a class="btn" href="#/tags"><span class="ico">#</span>Study by tag</a>
      <a class="btn" href="#/study"><span class="ico">⚙︎</span>Custom session</a>
    </div>

    <h2>Recent decks</h2>
    ${recent.length ? deckList(recent, cards) : `<div class="empty"><div class="ico">▤</div><p>No decks yet.</p><a class="btn primary" href="#/decks">Create a deck</a></div>`}
    <p class="small muted center" style="margin-top:20px">🔒 Your cards stay on this device. No accounts, no cloud, no tracking.</p>`;
  $('#dismissInstall')?.addEventListener('click', () => { localStorage.setItem('mt-install-dismissed', '1'); $('#installBanner').remove(); });
}

function deckList(decks, cards) {
  return `<ul class="list">${decks.map(d => {
    const dc = cards.filter(c => c.deckId === d.id);
    const due = dc.filter(isDueToday).length;
    const mastered = dc.filter(c => stateFor(c.srs) === 'mastered').length;
    return `<li><a class="list-item" href="#/deck/${d.id}"><span class="swatch" style="background:${esc(d.color)}"></span>
      <div class="main"><div class="title">${esc(d.name)}</div><div class="sub">${dc.length} card${dc.length === 1 ? '' : 's'} · ${due} due · ${mastered} mastered</div></div>
      <span class="chev">›</span></a></li>`;
  }).join('')}</ul>`;
}

/* =========================================================
   DECKS
   ========================================================= */
async function viewDecks() {
  ctx.setTitle('Decks');
  const { decks, cards } = await ctx.loadAll();
  main.innerHTML = `
    <div class="row"><button class="btn primary grow" id="newDeck">＋ New deck</button><button class="btn" id="importBtn">Import</button></div>
    <div style="margin-top:14px">${decks.length ? deckList(decks, cards) : `<div class="empty"><div class="ico">▤</div><p>Create your first deck — e.g. Security+, Azure, Networking.</p></div>`}</div>`;
  $('#newDeck').onclick = async () => {
    const name = await promptDialog('New deck', 'Deck name', '', { ok: 'Create', placeholder: 'e.g. Security+' });
    if (!name) return;
    const d = db.newDeck(name); await db.put('decks', d);
    location.hash = `#/deck/${d.id}`;
  };
  $('#importBtn').onclick = importFlow;
}

async function viewDeck(id) {
  const deck = await db.get('decks', id);
  if (!deck) { location.hash = '#/decks'; return; }
  ctx.setTitle(deck.name);
  const cards = (await db.cardsInDeck(id)).sort((a, b) => a.createdAt - b.createdAt);
  const counts = { new: 0, learning: 0, review: 0, mastered: 0 };
  cards.forEach(c => counts[stateFor(c.srs)]++);
  const due = cards.filter(isDueToday).length;
  const weak = cards.filter(isWeak).length;
  const favs = cards.filter(c => c.favorite).length;
  const q = `deck=${encodeURIComponent(id)}`;

  main.innerHTML = `
    ${deck.description ? `<p class="muted">${esc(deck.description)}</p>` : ''}
    <div class="grid-3" style="margin-bottom:12px">
      <div class="tile"><div class="v">${cards.length}</div><div class="l">Cards</div></div>
      <div class="tile"><div class="v">${due}</div><div class="l">Due</div></div>
      <div class="tile"><div class="v">${counts.mastered}</div><div class="l">Mastered</div></div>
    </div>
    <div class="legend" style="margin-bottom:12px">${statePill('new')} ${counts.new} ${statePill('learning')} ${counts.learning} ${statePill('review')} ${counts.review} ${statePill('mastered')} ${counts.mastered}</div>
    <a class="btn primary big block" href="#/study?mode=due&${q}">Study due (${due})</a>
    <div class="grid-2" style="margin-top:10px">
      <a class="btn" href="#/study?mode=all&${q}">All cards</a>
      <a class="btn" href="#/quiz?mode=all&${q}">Quiz</a>
      <a class="btn" href="#/study?mode=learning&${q}">Learning (${counts.learning})</a>
      <a class="btn" href="#/study?mode=weak&${q}">Weak (${weak})</a>
      <a class="btn" href="#/study?mode=favorites&${q}">★ Favorites (${favs})</a>
      <a class="btn" href="#/quickadd?deck=${encodeURIComponent(id)}">＋ Quick add</a>
    </div>
    <details class="card" style="margin-top:14px"><summary>Deck options</summary>
      <div class="grid-2" style="margin-top:8px">
        <button class="btn" data-act="rename">Rename</button>
        <button class="btn" data-act="describe">Description</button>
        <button class="btn" data-act="duplicate">Duplicate</button>
        <button class="btn" data-act="export">Export deck</button>
        <button class="btn" data-act="reset">Reset progress</button>
        <button class="btn danger" data-act="delete">Delete deck</button>
      </div>
    </details>
    <h2>Cards (${cards.length})</h2>
    <div class="row"><input type="search" id="filter" class="grow" placeholder="Filter this deck…" aria-label="Filter cards" style="flex:1">
      <a class="btn primary" href="#/card/new?deck=${encodeURIComponent(id)}" aria-label="Add card">＋</a></div>
    <div id="cardList" style="margin-top:10px"></div>`;

  const renderList = (term = '') => {
    const t = term.toLowerCase();
    const list = t ? cards.filter(c => [c.question, c.answer, c.notes, c.category, c.tags.join(' ')].join(' ').toLowerCase().includes(t)) : cards;
    $('#cardList').innerHTML = list.length ? cardRows(list.slice(0, 300)) + (list.length > 300 ? `<p class="small muted center">Showing 300 of ${list.length} — use Search to narrow.</p>` : '')
      : `<div class="empty"><p>${cards.length ? 'No matches.' : 'No cards yet. Tap ＋ or use Quick Add.'}</p></div>`;
    wireFavToggles($('#cardList'));
  };
  $('#filter').oninput = (e) => renderList(e.target.value);
  renderList();

  main.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
    const act = b.dataset.act;
    if (act === 'rename') {
      const name = await promptDialog('Rename deck', 'Deck name', deck.name);
      if (name) { deck.name = name; await db.saveDeck(deck); route(); }
    } else if (act === 'describe') {
      const d = await promptDialog('Deck description', 'Description (optional)', deck.description || '');
      if (d !== null) { deck.description = d; await db.saveDeck(deck); route(); }
    } else if (act === 'duplicate') {
      const copy = await db.duplicateDeck(id); toast('Deck duplicated'); location.hash = `#/deck/${copy.id}`;
    } else if (act === 'export') {
      const data = await db.exportDeck(id);
      await saveFile(`${slug(deck.name)}-${stamp()}.json`, JSON.stringify(data, null, 2));
    } else if (act === 'reset') {
      if (!await confirmDialog('Reset progress?', `All ${cards.length} cards in "${deck.name}" go back to New. Cards themselves are kept.`, { ok: 'Reset', danger: true })) return;
      for (const c of cards) { const fresh = db.newCard(c.deckId); c.srs = fresh.srs; c.stats = fresh.stats; }
      await db.saveCards(cards.map(c => ({ ...c, updatedAt: Date.now() }))); toast('Progress reset'); route();
    } else if (act === 'delete') {
      if (!await confirmDialog('Delete deck?', `"${deck.name}" and its ${cards.length} cards will be permanently deleted. Consider exporting it first.`, { ok: 'Delete', danger: true })) return;
      await db.deleteDeck(id); toast('Deck deleted'); location.hash = '#/decks';
    }
  });
}

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck'; }

function cardRows(list, decks) {
  return `<ul class="list">${list.map(c => `
    <li class="row" style="gap:0">
      <a class="list-item" href="#/card/${c.id}" style="flex:1">
        <div class="main"><div class="title">${esc(c.question)}</div>
          <div class="sub">${esc(plain(c.answer))}</div>
          <div class="sub">${statePill(stateFor(c.srs))} ${decks ? esc(decks.find(d => d.id === c.deckId)?.name || '') + ' · ' : ''}${c.category ? esc(c.category) + ' · ' : ''}${c.tags.map(t => '#' + esc(t)).join(' ')}</div></div>
      </a>
      <button class="fav-btn" data-fav="${c.id}" aria-pressed="${c.favorite}" aria-label="Favorite">${c.favorite ? '★' : '☆'}</button>
    </li>`).join('')}</ul>`;
}

function wireFavToggles(root) {
  root.querySelectorAll('[data-fav]').forEach(b => b.onclick = async () => {
    const c = await db.get('cards', b.dataset.fav); c.favorite = !c.favorite; await db.saveCard(c);
    b.setAttribute('aria-pressed', c.favorite); b.textContent = c.favorite ? '★' : '☆';
  });
}

/* =========================================================
   CARD EDITOR (page + dialog share one form)
   ========================================================= */
async function cardFormHTML(card, decks) {
  const all = await db.getAll('cards');
  const cats = [...new Set(all.map(c => c.category).filter(Boolean))].sort();
  const tags = (await db.getAll('tags')).map(t => t.label).sort((a, b) => a.localeCompare(b));
  return `
    <label for="f-deck">Deck</label>
    <select id="f-deck">${decks.map(d => `<option value="${d.id}" ${d.id === card.deckId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
    <label for="f-q">Question</label>
    <textarea id="f-q" rows="3" required>${esc(card.question)}</textarea>
    <label for="f-a">Answer <span class="hint">(Markdown OK)</span></label>
    <textarea id="f-a" rows="3" required>${esc(card.answer)}</textarea>
    <label for="f-n">Notes <span class="hint">(optional · Markdown: **bold**, \`code\`, - lists, \`\`\`blocks\`\`\`)</span></label>
    <textarea id="f-n" rows="4">${esc(card.notes)}</textarea>
    <details><summary>Preview notes</summary><div class="card md" id="f-prev"></div></details>
    <label for="f-c">Category <span class="hint">(optional)</span></label>
    <input id="f-c" type="text" list="cat-list" value="${esc(card.category)}" autocomplete="off">
    <datalist id="cat-list">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <label for="f-t">Tags <span class="hint">(comma separated)</span></label>
    <input id="f-t" type="text" value="${esc(card.tags.join(', '))}" autocomplete="off" autocapitalize="words">
    ${tags.length ? `<div class="chips" style="margin-top:8px" id="tagSuggest">${tags.slice(0, 24).map(t => `<button type="button" class="chip" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}
    <div class="switch" style="margin-top:10px"><label for="f-fav" style="margin:0">★ Favorite</label><input id="f-fav" type="checkbox" ${card.favorite ? 'checked' : ''}></div>`;
}

function wireCardForm(root) {
  const prev = () => { const p = root.querySelector('#f-prev'); if (p) p.innerHTML = renderMarkdown(root.querySelector('#f-n').value) || '<span class="muted">Nothing to preview</span>'; };
  root.querySelector('#f-n').addEventListener('input', prev); prev();
  root.querySelectorAll('[data-tag]').forEach(b => b.onclick = () => {
    const inp = root.querySelector('#f-t'); const cur = db.normalizeTags(inp.value);
    if (!cur.some(t => t.toLowerCase() === b.dataset.tag.toLowerCase())) cur.push(b.dataset.tag);
    inp.value = cur.join(', ');
  });
}

function readCardForm(root, card) {
  card.deckId = root.querySelector('#f-deck').value;
  card.question = root.querySelector('#f-q').value.trim();
  card.answer = root.querySelector('#f-a').value.trim();
  card.notes = root.querySelector('#f-n').value.trim();
  card.category = root.querySelector('#f-c').value.trim();
  card.tags = db.normalizeTags(root.querySelector('#f-t').value);
  card.favorite = root.querySelector('#f-fav').checked;
  return card;
}

async function viewCard(id, params) {
  const { decks } = await ctx.loadAll();
  if (!decks.length) { toast('Create a deck first'); location.hash = '#/decks'; return; }
  const isNewCard = id === 'new';
  const card = isNewCard ? db.newCard(params.get('deck') || decks[0].id) : await db.get('cards', id);
  if (!card) { location.hash = '#/decks'; return; }
  ctx.setTitle(isNewCard ? 'New card' : 'Edit card');
  main.innerHTML = `<form id="cardForm" class="card">${await cardFormHTML(card, decks)}
    ${!isNewCard ? `<p class="small muted" style="margin-top:12px">${statePill(stateFor(card.srs))} Next review ${describeInterval(card.srs)} · interval ${card.srs.interval}d · ease ${card.srs.ease} · ✓${card.stats.correct} ✕${card.stats.incorrect} · lapses ${card.srs.lapses}</p>` : ''}
    <div class="stack" style="margin-top:14px">
      <button class="btn primary big" type="submit">${isNewCard ? 'Add card' : 'Save'}</button>
      ${isNewCard ? '<button class="btn" type="button" id="saveAnother">Add & create another</button>' : `
      <div class="grid-2"><button class="btn" type="button" id="resetBtn">Reset progress</button><button class="btn danger" type="button" id="delBtn">Delete card</button></div>`}
    </div></form>`;
  const form = $('#cardForm');
  wireCardForm(form);
  const save = async (another) => {
    readCardForm(form, card);
    if (!card.question || !card.answer) { toast('Question and answer are required'); return; }
    await db.saveCard(card);
    toast(isNewCard ? 'Card added' : 'Saved');
    if (another) { location.hash = `#/card/new?deck=${card.deckId}&t=${Date.now()}`; }
    else history.length > 1 ? history.back() : (location.hash = `#/deck/${card.deckId}`);
  };
  form.onsubmit = (e) => { e.preventDefault(); save(false); };
  $('#saveAnother')?.addEventListener('click', () => save(true));
  $('#delBtn')?.addEventListener('click', async () => {
    if (!await confirmDialog('Delete card?', 'This card will be permanently deleted.', { ok: 'Delete', danger: true })) return;
    await db.del('cards', card.id); toast('Card deleted'); history.back();
  });
  $('#resetBtn')?.addEventListener('click', async () => {
    const fresh = db.newCard(card.deckId); card.srs = fresh.srs; card.stats = fresh.stats; await db.saveCard(card); toast('Progress reset'); route();
  });
  const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(false); } };
  document.addEventListener('keydown', onKey);
  ctx.setCleanup(() => document.removeEventListener('keydown', onKey));
}

async function editCardModal(card) {
  const { decks } = await ctx.loadAll();
  const formHTML = await cardFormHTML(card, decks);
  return modal((d, close) => {
    d.innerHTML = `<h2 id="modalTitle">Edit card</h2><form>${formHTML}
      <div class="dialog-actions"><button type="button" class="btn" data-x>Cancel</button><button type="submit" class="btn primary">Save</button></div></form>`;
    const form = d.querySelector('form');
    wireCardForm(form);
    d.querySelector('[data-x]').onclick = () => close(false);
    form.onsubmit = async (e) => {
      e.preventDefault(); readCardForm(form, card);
      if (!card.question || !card.answer) { toast('Question and answer are required'); return; }
      await db.saveCard(card); toast('Saved'); close(true);
    };
  });
}

/* =========================================================
   QUICK ADD — rapid entry + bulk paste
   ========================================================= */
async function viewQuickAdd(params) {
  ctx.setTitle('Quick Add');
  let { decks } = await ctx.loadAll();
  const lastDeck = params.get('deck') || localStorage.getItem('mt-last-deck');
  let added = 0;
  main.innerHTML = `
    <form id="qa" class="card" autocomplete="off">
      <label for="qa-deck">Deck</label>
      <select id="qa-deck">${decks.map(d => `<option value="${d.id}" ${d.id === lastDeck ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}<option value="__new">＋ New deck…</option></select>
      <label for="qa-q">Question</label>
      <textarea id="qa-q" rows="2" placeholder="What port does DNS use?" autofocus></textarea>
      <label for="qa-a">Answer</label>
      <textarea id="qa-a" rows="2" placeholder="53"></textarea>
      <details id="qa-more"><summary>Notes, category & tags</summary>
        <label for="qa-n">Notes</label><textarea id="qa-n" rows="2" placeholder="TCP and UDP"></textarea>
        <label for="qa-c">Category</label><input id="qa-c" type="text">
        <label for="qa-t">Tags <span class="hint">(kept for the next card)</span></label><input id="qa-t" type="text" placeholder="Networking, Ports">
      </details>
      <button class="btn primary big block" type="submit" style="margin-top:12px">Save & next <span class="kbd hide-touch">⌘/Ctrl+Enter</span></button>
      <p class="small muted center" id="qa-count" style="margin-top:8px" aria-live="polite">Tip: Return in the answer box saves too.</p>
    </form>

    <h2>Bulk add</h2>
    <div class="card">
      <p class="small muted">Paste one card per line. Works with Quizlet exports (tab between term and definition). Separator:</p>
      <div class="chips" id="sepChips">
        <button type="button" class="chip" data-sep="tab" aria-pressed="true">Tab</button>
        <button type="button" class="chip" data-sep="|" aria-pressed="false">|</button>
        <button type="button" class="chip" data-sep=" - " aria-pressed="false">" - "</button>
        <button type="button" class="chip" data-sep=";" aria-pressed="false">;</button>
        <button type="button" class="chip" data-sep="," aria-pressed="false">,</button>
      </div>
      <textarea id="bulk" rows="6" style="margin-top:10px" placeholder="What port does SSH use? | 22&#10;What port does RDP use? | 3389"></textarea>
      <p class="small muted" id="bulkInfo">0 cards detected. A 3rd column becomes notes.</p>
      <button class="btn block" id="bulkBtn" disabled>Add cards</button>
    </div>`;

  const sel = $('#qa-deck');
  const ensureDeck = async () => {
    if (sel.value !== '__new' && sel.value) return sel.value;
    const name = await promptDialog('New deck', 'Deck name', '', { ok: 'Create' });
    if (!name) { sel.value = decks[0]?.id || ''; return null; }
    const d = db.newDeck(name); await db.put('decks', d); decks.push(d);
    sel.insertAdjacentHTML('afterbegin', `<option value="${d.id}">${esc(d.name)}</option>`); sel.value = d.id;
    return d.id;
  };
  if (!decks.length) sel.value = '__new';
  sel.onchange = () => { if (sel.value === '__new') ensureDeck(); };

  const save = async () => {
    const q = $('#qa-q').value.trim(), a = $('#qa-a').value.trim();
    if (!q || !a) { toast('Question and answer are required'); (q ? $('#qa-a') : $('#qa-q')).focus(); return; }
    const deckId = await ensureDeck(); if (!deckId) return;
    await db.saveCard(db.newCard(deckId, { question: q, answer: a, notes: $('#qa-n').value.trim(), category: $('#qa-c').value.trim(), tags: db.normalizeTags($('#qa-t').value) }));
    localStorage.setItem('mt-last-deck', deckId);
    added++;
    $('#qa-q').value = ''; $('#qa-a').value = ''; $('#qa-n').value = '';
    $('#qa-count').textContent = `✓ ${added} card${added === 1 ? '' : 's'} added this session`;
    $('#qa-q').focus();
  };
  $('#qa').onsubmit = (e) => { e.preventDefault(); save(); };
  $('#qa-a').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } });
  $('#qa-q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#qa-a').focus(); } });
  const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); } };
  document.addEventListener('keydown', onKey);
  ctx.setCleanup(() => document.removeEventListener('keydown', onKey));

  let sep = 'tab';
  const parse = () => $('#bulk').value.split(/\r?\n/).map(l => {
    if (!l.trim()) return null;
    const parts = sep === 'tab' ? l.split('\t') : l.split(sep);
    if (parts.length < 2) return null;
    const [q, a, ...rest] = parts.map(p => p.trim());
    return q && a ? { question: q, answer: a, notes: rest.join(sep === 'tab' ? ' ' : sep).trim() } : null;
  }).filter(Boolean);
  const update = () => { const n = parse().length; $('#bulkInfo').textContent = `${n} card${n === 1 ? '' : 's'} detected. A 3rd column becomes notes.`; $('#bulkBtn').disabled = !n; $('#bulkBtn').textContent = n ? `Add ${n} cards` : 'Add cards'; };
  $('#bulk').oninput = update;
  $$('#sepChips .chip').forEach(c => c.onclick = () => { sep = c.dataset.sep; $$('#sepChips .chip').forEach(x => x.setAttribute('aria-pressed', x === c)); update(); });
  $('#bulk').addEventListener('paste', () => setTimeout(() => {
    // auto-detect separator on paste
    const v = $('#bulk').value; const pick = v.includes('\t') ? 'tab' : v.includes('|') ? '|' : v.includes(' - ') ? ' - ' : v.includes(';') ? ';' : null;
    if (pick) $(`#sepChips [data-sep="${pick}"]`).click(); else update();
  }, 0));
  $('#bulkBtn').onclick = async () => {
    const deckId = await ensureDeck(); if (!deckId) return;
    const tags = db.normalizeTags($('#qa-t').value);
    const list = parse().map(p => db.newCard(deckId, { ...p, tags }));
    await db.saveCards(list); localStorage.setItem('mt-last-deck', deckId);
    toast(`Added ${list.length} cards`); $('#bulk').value = ''; update();
  };
}

/* =========================================================
   STUDY PICKER (custom session)
   ========================================================= */
async function viewStudyPicker(params, kind) {
  ctx.setTitle(kind === 'quiz' ? 'Start a quiz' : 'Custom session');
  const { decks } = await ctx.loadAll();
  const tags = (await db.getAll('tags')).map(t => t.label).sort((a, b) => a.localeCompare(b));
  const modes = kind === 'quiz' ? ['all', 'due', 'learning', 'weak', 'favorites', 'surprise'] : ['due', 'all', 'learning', 'weak', 'favorites', 'new', 'surprise'];
  main.innerHTML = `<form class="card" id="pick">
    <div class="seg-tabs" role="tablist" style="grid-template-columns:1fr 1fr">
      <button type="button" data-kind="study" aria-selected="${kind === 'study'}">Flashcards</button>
      <button type="button" data-kind="quiz" aria-selected="${kind === 'quiz'}">Multiple choice</button></div>
    <label for="p-mode">Cards</label>
    <select id="p-mode">${modes.map(m => `<option value="${m}">${MODES[m].ico} ${MODES[m].label}</option>`).join('')}</select>
    <label for="p-deck">Deck</label>
    <select id="p-deck"><option value="">All decks</option>${decks.map(d => `<option value="${d.id}" ${params.get('deck') === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
    <label for="p-tag">Tag</label>
    <select id="p-tag"><option value="">Any tag</option>${tags.map(t => `<option ${params.get('tag') === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    <label for="p-limit">Max cards <span class="hint">(0 = no limit)</span></label>
    <input id="p-limit" type="number" min="0" max="1000" inputmode="numeric" value="${kind === 'quiz' ? 20 : settings.sessionSize}">
    <button class="btn primary big block" type="submit" style="margin-top:14px">Start</button></form>`;
  $$('[data-kind]').forEach(b => b.onclick = () => { location.hash = `#/${b.dataset.kind}`; });
  $('#pick').onsubmit = (e) => {
    e.preventDefault();
    const p = new URLSearchParams({ mode: $('#p-mode').value });
    if ($('#p-deck').value) p.set('deck', $('#p-deck').value);
    if ($('#p-tag').value) p.set('tag', $('#p-tag').value);
    p.set('limit', $('#p-limit').value || '0');
    location.hash = `#/${kind}?${p}`;
  };
}

/* =========================================================
   SEARCH — instant filtering
   ========================================================= */
async function viewSearch(params) {
  ctx.setTitle('Search');
  const { decks, cards } = await ctx.loadAll();
  let field = 'all';
  main.innerHTML = `
    <input type="search" id="q" placeholder="Search questions, answers, notes…" aria-label="Search cards" value="${esc(params.get('q') || '')}" autofocus enterkeyhint="search">
    <div class="chips" style="margin:10px 0" id="fields">
      ${['all', 'question', 'answer', 'notes', 'category', 'tags'].map(f => `<button class="chip" data-f="${f}" aria-pressed="${f === 'all'}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}
    </div>
    <div class="row" style="margin-bottom:10px">
      <select id="sdeck" aria-label="Deck filter" style="flex:1"><option value="">All decks</option>${decks.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>
      <a class="btn" href="#/tags">Tags</a>
    </div>
    <p class="small muted" id="sinfo" aria-live="polite"></p>
    <div id="results"></div>`;
  const run = () => {
    const terms = $('#q').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const deck = $('#sdeck').value;
    const get = (c) => field === 'all' ? [c.question, c.answer, c.notes, c.category, c.tags.join(' ')].join(' \n ') : field === 'tags' ? c.tags.join(' ') : c[field];
    let list = deck ? cards.filter(c => c.deckId === deck) : cards;
    if (terms.length) list = list.filter(c => { const hay = String(get(c)).toLowerCase(); return terms.every(t => hay.includes(t)); });
    else if (!deck) list = [];
    $('#sinfo').textContent = terms.length || deck ? `${list.length} result${list.length === 1 ? '' : 's'}` : `${cards.length} cards across ${decks.length} decks. Start typing to filter.`;
    $('#results').innerHTML = list.length ? cardRows(list.slice(0, 200), decks) : '';
    wireFavToggles($('#results'));
  };
  $('#q').oninput = run; $('#sdeck').onchange = run;
  $$('#fields .chip').forEach(b => b.onclick = () => { field = b.dataset.f; $$('#fields .chip').forEach(x => x.setAttribute('aria-pressed', x === b)); run(); });
  run();
}

/* =========================================================
   TAGS
   ========================================================= */
async function viewTags() {
  ctx.setTitle('Tags');
  const { cards } = await ctx.loadAll();
  const map = new Map();
  for (const c of cards) for (const t of c.tags) {
    const k = t.toLowerCase(); const e = map.get(k) || { label: t, n: 0, due: 0 };
    e.n++; if (isDueToday(c)) e.due++; map.set(k, e);
  }
  const list = [...map.values()].sort((a, b) => b.n - a.n);
  main.innerHTML = list.length ? `<ul class="list">${list.map(t => `<li><div class="list-item">
      <div class="main"><div class="title">#${esc(t.label)}</div><div class="sub">${t.n} cards · ${t.due} due</div></div>
      <a class="btn sm" href="#/study?mode=due&tag=${encodeURIComponent(t.label)}">Due</a>
      <a class="btn sm" href="#/study?mode=all&tag=${encodeURIComponent(t.label)}">All</a>
      <a class="btn sm" href="#/quiz?mode=all&tag=${encodeURIComponent(t.label)}">Quiz</a></div></li>`).join('')}</ul>`
    : `<div class="empty"><div class="ico">#</div><p>No tags yet. Add tags like <em>Security, Microsoft, OT</em> when editing cards.</p></div>`;
}

/* =========================================================
   SETTINGS, BACKUP, PRIVACY
   ========================================================= */
async function viewSettings() {
  ctx.setTitle('Settings');
  const lastBackup = await db.getMeta('lastBackupAt', 0);
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  const est = await db.storageEstimate();
  const notifOK = 'Notification' in window;
  const s = settings;
  main.innerHTML = `
    <h2 style="margin-top:0">Appearance</h2>
    <div class="card">
      <label>Theme</label>
      <div class="seg-tabs" id="themeSeg">${['auto', 'light', 'dark'].map(t => `<button type="button" data-v="${t}" aria-selected="${s.theme === t}">${t === 'auto' ? 'System' : t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
      <label>Text size</label>
      <div class="seg-tabs" id="fontSeg">${[[1, 'Large'], [1.15, 'Larger'], [1.3, 'Largest']].map(([v, l]) => `<button type="button" data-v="${v}" aria-selected="${+s.fontScale === v}">${l}</button>`).join('')}</div>
    </div>

    <h2>Study</h2>
    <div class="card">
      <div class="switch"><label for="s-req" style="margin:0">Repeat missed cards later in the session</label><input type="checkbox" id="s-req" ${s.requeueWrong ? 'checked' : ''}></div>
      <div class="switch"><label for="s-shuf" style="margin:0">Shuffle cards</label><input type="checkbox" id="s-shuf" ${s.shuffle ? 'checked' : ''}></div>
      <label for="s-size">Max cards per due session <span class="hint">(0 = unlimited)</span></label>
      <input type="number" id="s-size" min="0" max="1000" inputmode="numeric" value="${s.sessionSize}">
      <label for="s-new">New cards per due session</label>
      <input type="number" id="s-new" min="0" max="500" inputmode="numeric" value="${s.newPerSession}">
    </div>

    <h2>Study reminders</h2>
    <div class="card">
      <div class="switch"><label for="s-rem" style="margin:0">Notify me when cards are due</label><input type="checkbox" id="s-rem" ${s.remindersEnabled ? 'checked' : ''} ${notifOK ? '' : 'disabled'}></div>
      <label for="s-time">Reminder time</label>
      <input type="time" id="s-time" value="${esc(s.reminderTime)}">
      <p class="small muted" style="margin-top:8px">${notifOK ? 'Browser notifications fire while the app is open or recently used. Without a push server (by design — no cloud), iOS can\'t wake a web app on a schedule. For a guaranteed daily nudge, add a calendar reminder:' : 'Notifications need the app installed to the Home Screen (iOS 16.4+). For a guaranteed daily nudge, add a calendar reminder:'}</p>
      <button class="btn block" id="icsBtn">📅 Add daily reminder to Calendar</button>
    </div>

    <h2>Backup & restore</h2>
    <div class="card">
      <p><strong>Last backup:</strong> <span id="lastBackup">${lastBackup ? fmtWhen(lastBackup) : 'never'}</span>${lastBackup && Date.now() - lastBackup > 14 * 864e5 ? ' <span class="pill learning">over 2 weeks ago</span>' : ''}</p>
      <div class="stack">
        <button class="btn primary big" id="backupBtn">⬇︎ Back up now</button>
        <button class="btn" id="restoreBtn">⬆︎ Restore from backup (merge)</button>
        <button class="btn danger" id="replaceBtn">Restore & replace everything</button>
      </div>
      <p class="small muted" style="margin-top:10px">On iPhone, choose <em>Save to Files</em> (iCloud Drive or On My iPhone). "Merge" never deletes anything: new cards are added and, for cards that exist in both, the most recently edited version wins.</p>
    </div>

    <h2>Import / export</h2>
    <div class="card"><div class="grid-2">
      <button class="btn" id="exportBtn">Export JSON</button>
      <button class="btn" id="importBtn">Import JSON</button></div>
      <p class="small muted" style="margin-top:8px">Export one deck from its deck page. Import also accepts a plain JSON array of <code>{"question","answer"}</code> objects. To bring cards from Quizlet, use Quick Add → Bulk add.</p>
    </div>

    <h2>Privacy & data</h2>
    <div class="card">
      <p>🔒 All data is stored <strong>only on this device</strong> in your browser's <strong>IndexedDB</strong> database (<code>memory-trainer</code>) for this website. There are no accounts, servers, analytics, telemetry, trackers or cloud storage — the app makes no network requests after it's installed, and a Content-Security-Policy blocks connections to other sites.</p>
      <p class="small muted">Persistent storage: <strong>${persisted ? 'granted' : 'not granted'}</strong>${est ? ` · using ${(est.usage / 1024).toFixed(0)} KB` : ''}. On iPhone, data for apps added to the Home Screen is kept; Safari may clear data for sites you don't install and don't visit for a while — so install it, and back up regularly. Deleting the Home Screen app deletes its data.</p>
      ${persisted ? '' : '<button class="btn block" id="persistBtn">Request persistent storage</button>'}
    </div>

    <h2>More</h2>
    <div class="stack">
      <button class="btn" id="sampleBtn">Load sample deck</button>
      <a class="btn" href="#/help">Install guide & keyboard shortcuts</a>
      <button class="btn danger" id="wipeBtn">Erase all data</button>
    </div>
    <p class="small muted center" style="margin-top:18px">Memory Trainer v${APP_VERSION} · works offline</p>`;

  const persist = async () => { await db.saveSettings(settings); };
  $$('#themeSeg button').forEach(b => b.onclick = async () => { settings.theme = b.dataset.v; applyTheme(); await persist(); $$('#themeSeg button').forEach(x => x.setAttribute('aria-selected', x === b)); });
  $$('#fontSeg button').forEach(b => b.onclick = async () => { settings.fontScale = +b.dataset.v; applyTheme(); await persist(); $$('#fontSeg button').forEach(x => x.setAttribute('aria-selected', x === b)); });
  $('#s-req').onchange = (e) => { settings.requeueWrong = e.target.checked; persist(); };
  $('#s-shuf').onchange = (e) => { settings.shuffle = e.target.checked; persist(); };
  $('#s-size').onchange = (e) => { settings.sessionSize = Math.max(0, +e.target.value || 0); persist(); };
  $('#s-new').onchange = (e) => { settings.newPerSession = Math.max(0, +e.target.value || 0); persist(); };
  $('#s-time').onchange = (e) => { settings.reminderTime = e.target.value || '19:00'; persist(); scheduleReminder(); };
  $('#s-rem').onchange = async (e) => {
    if (e.target.checked) {
      const p = await Notification.requestPermission();
      if (p !== 'granted') { e.target.checked = false; toast(isIOS() && !isStandalone() ? 'Install to Home Screen first, then enable reminders' : 'Notifications were not allowed'); return; }
    }
    settings.remindersEnabled = e.target.checked; await persist(); scheduleReminder();
    if (e.target.checked) toast('Reminders on');
  };
  $('#icsBtn').onclick = () => saveFile('memory-trainer-reminder.ics', buildICS(settings.reminderTime), 'text/calendar');
  $('#backupBtn').onclick = backupNow;
  $('#restoreBtn').onclick = () => importFlow(false);
  $('#replaceBtn').onclick = async () => {
    if (!await confirmDialog('Replace everything?', 'All current decks, cards and stats will be erased and replaced by the backup file. Back up first if unsure.', { ok: 'Choose file', danger: true })) return;
    importFlow(true);
  };
  $('#exportBtn').onclick = async () => saveFile(`memory-trainer-export-${stamp()}.json`, JSON.stringify(await db.exportAll(), null, 2));
  $('#importBtn').onclick = () => importFlow(false);
  $('#persistBtn')?.addEventListener('click', async () => { const ok = await db.requestPersistence(); toast(ok ? 'Persistent storage granted' : 'Browser declined — install to Home Screen and back up regularly'); route(); });
  $('#sampleBtn').onclick = async () => { await loadSample(); toast('Sample deck added'); };
  $('#wipeBtn').onclick = async () => {
    if (!await confirmDialog('Erase all data?', 'Every deck, card and statistic on this device will be permanently deleted. This cannot be undone.', { ok: 'Erase everything', danger: true })) return;
    await db.wipeAll(); toast('All data erased'); location.hash = '#/home';
  };
}

async function backupNow() {
  const data = await db.exportAll();
  const ok = await saveFile(`memory-trainer-backup-${stamp()}.json`, JSON.stringify(data, null, 2));
  if (ok) {
    await db.setMeta('lastBackupAt', Date.now());
    const el = $('#lastBackup'); if (el) el.textContent = fmtWhen(Date.now());
    toast(`Backup saved · ${data.cards.length} cards`);
  }
}

async function importFlow(replace = false) {
  const text = await pickFile();
  if (!text) return;
  let data;
  try { data = JSON.parse(text); } catch (e) { toast('That file is not valid JSON'); return; }
  try {
    const r = await db.importData(data, { replace: replace === true });
    toast(`Imported: ${r.decksAdded} new decks, ${r.cardsAdded} new cards, ${r.cardsUpdated} updated${r.cardsSkipped ? `, ${r.cardsSkipped} unchanged` : ''}`, { ms: 5000 });
    route();
  } catch (e) { toast(e.message || 'Import failed'); }
}

function buildICS(time) {
  const [hh, mm] = (time || '19:00').split(':');
  const d = new Date(); const p = n => String(n).padStart(2, '0');
  const dt = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(+hh)}${p(+mm)}00`;
  const nowUTC = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Memory Trainer//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:memory-trainer-daily-${Date.now()}@local`, `DTSTAMP:${nowUTC}`, `DTSTART:${dt}`, 'DURATION:PT15M', 'RRULE:FREQ=DAILY',
    'SUMMARY:Memory Trainer – study your due cards', 'DESCRIPTION:Open Memory Trainer from your Home Screen and study your due cards.',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Time to study', 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

/* =========================================================
   HELP / INSTALL
   ========================================================= */
function viewHelp() {
  ctx.setTitle('Help');
  main.innerHTML = `
    <h2 style="margin-top:0">Install on iPhone</h2>
    <ol class="card" style="padding-left:34px">
      <li>Open this page in <strong>Safari</strong> (iOS 16.4+ also allows Chrome/Edge via their Share menu).</li>
      <li>Tap the <strong>Share</strong> button (square with an arrow).</li>
      <li>Scroll and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
      <li>Launch <strong>Memory</strong> from your Home Screen. It runs full-screen and offline.</li>
    </ol>
    <h2>How scheduling works</h2>
    <div class="card small">
      <p>Each correct answer pushes a card further out: <strong>10 min → 1 day → 3 days → ×ease</strong> (≈2.5×, e.g. 8, 20, 50 days). A miss resets it to the start and slows its future growth.</p>
      <p>${statePill('new')} never answered · ${statePill('learning')} interval under 7 days · ${statePill('review')} 7–20 days · ${statePill('mastered')} 21+ days. <strong>Weak</strong> = missed 2+ times after learning, or under 60% accuracy.</p>
    </div>
    <h2>Keyboard shortcuts</h2>
    <div class="card small">
      <p><span class="kbd">Space</span>/<span class="kbd">Enter</span> reveal · <span class="kbd">2</span>/<span class="kbd">C</span>/<span class="kbd">→</span> correct · <span class="kbd">1</span>/<span class="kbd">X</span>/<span class="kbd">←</span> incorrect · <span class="kbd">F</span> favorite · <span class="kbd">E</span> edit</p>
      <p>Quiz: <span class="kbd">1</span>–<span class="kbd">4</span> choose · <span class="kbd">Enter</span> next</p>
      <p>Anywhere: <span class="kbd">N</span> quick add · <span class="kbd">/</span> search · <span class="kbd">S</span> study due · <span class="kbd">G</span> then <span class="kbd">H</span>/<span class="kbd">D</span>/<span class="kbd">T</span> home/decks/stats · <span class="kbd">?</span> this page · <span class="kbd">⌘/Ctrl+Enter</span> save card</p>
    </div>
    <h2>Markdown in notes</h2>
    <div class="card small md">${renderMarkdown('**bold**, *italic*, `inline code`\n- bullet lists\n1. numbered lists\n> quotes\n```\ncode blocks\n```\n[links](https://example.com)')}</div>`;
}

/* =========================================================
   THEME, REMINDERS, SAMPLE DATA, GLOBAL KEYS, SERVICE WORKER
   ========================================================= */
function applyTheme() {
  const dark = settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--font-scale', settings.fontScale);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0b1020' : '#4f46e5';
  try { localStorage.setItem('mt-theme', settings.theme); localStorage.setItem('mt-fontscale', settings.fontScale); } catch (e) {}
  document.querySelectorAll('canvas').forEach(c => c._redraw && c._redraw());
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => settings.theme === 'auto' && applyTheme());

let reminderTimer = null;
async function scheduleReminder() {
  clearTimeout(reminderTimer);
  if (!settings.remindersEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const [h, m] = settings.reminderTime.split(':').map(Number);
  const at = new Date(); at.setHours(h, m, 0, 0);
  const todayKey = db.dayKey();
  const fire = async () => {
    const cards = await db.getAll('cards');
    const due = cards.filter(c => !isNew(c) && isDueToday(c)).length;
    if (!due || localStorage.getItem('mt-notified') === db.dayKey()) return;
    localStorage.setItem('mt-notified', db.dayKey());
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body: `${due} card${due === 1 ? ' is' : 's are'} due. A few minutes keeps them fresh.`, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'mt-due' };
    if (reg) reg.showNotification('Memory Trainer', opts); else new Notification('Memory Trainer', opts);
  };
  if (Date.now() >= at.getTime()) { if (localStorage.getItem('mt-notified') !== todayKey) fire(); }
  else reminderTimer = setTimeout(fire, at.getTime() - Date.now());
}

async function loadSample() {
  const deck = db.newDeck(SAMPLE_DECK.name, { description: SAMPLE_DECK.description, color: '#4f46e5' });
  await db.put('decks', deck);
  const base = Date.now();
  await db.saveCards(SAMPLE_DECK.cards.map((c, i) => db.newCard(deck.id, { question: c.q, answer: c.a, notes: c.n, category: c.c, tags: c.t, favorite: !!c.fav, createdAt: base + i })));
  return deck;
}

let gPending = false;
document.addEventListener('keydown', (e) => {
  if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || $('#modal').open || document.body.classList.contains('immersive')) return;
  const k = e.key.toLowerCase();
  if (gPending) { gPending = false; const map = { h: 'home', d: 'decks', t: 'stats', s: 'settings' }; if (map[k]) location.hash = '#/' + map[k]; return; }
  if (k === 'g') { gPending = true; setTimeout(() => (gPending = false), 1200); }
  else if (k === 'n') { e.preventDefault(); location.hash = '#/quickadd'; }
  else if (k === '/') { e.preventDefault(); location.hash = '#/search'; }
  else if (k === 's') location.hash = '#/study?mode=due';
  else if (e.key === '?') location.hash = '#/help';
});

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('service-worker.js').then(reg => {
    const prompt = (w) => toast('An update is ready', { action: 'Reload', onAction: () => w.postMessage('skipWaiting') });
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w); });
    });
  }).catch(err => console.warn('SW registration failed', err));
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

/* ---------- boot ---------- */
(async function boot() {
  try {
    await db.openDB();
    settings = await db.getSettings();
    applyTheme();
    if (!(await db.getMeta('initialized', false))) {
      // First run: add the starter deck so every feature can be tried immediately.
      if (!(await db.getAll('decks')).length) await loadSample();
      await db.setMeta('initialized', true);
      await db.setMeta('schemaVersion', db.SCHEMA_VERSION);
      db.requestPersistence();
    }
    if (!location.hash) history.replaceState(null, '', '#/home');
    await route();
    scheduleReminder();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleReminder(); });
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="empty"><div class="ico">⚠︎</div><h2>Storage unavailable</h2><p>Memory Trainer needs IndexedDB. Private Browsing or restricted settings can block it.</p><p class="small muted">${esc(err.message || err)}</p></div>`;
  }
  registerSW();
})();
