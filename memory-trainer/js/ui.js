/* =========================================================
   ui.js — small shared UI helpers (no framework)
   ========================================================= */
import { escapeHTML } from './markdown.js';

export const esc = escapeHTML;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer = null;
export function toast(msg, { action, onAction, ms = 2800 } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  el.hidden = false;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; onAction && onAction(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? Math.max(ms, 8000) : ms);
}

/** Open the shared <dialog>. `build(dialog, close)` fills it; resolves with whatever close() receives. */
export function modal(build) {
  return new Promise(resolve => {
    const dlg = $('#modal');
    let done = false;
    const close = (v) => { if (done) return; done = true; dlg.close(); resolve(v); };
    dlg.innerHTML = '';
    build(dlg, close);
    dlg.oncancel = (e) => { e.preventDefault(); close(null); };
    dlg.onclick = (e) => { if (e.target === dlg) close(null); }; // tap backdrop to dismiss
    dlg.showModal();
    const f = dlg.querySelector('[autofocus], input, textarea, select, button.primary');
    if (f) setTimeout(() => f.focus(), 30);
  });
}

export function confirmDialog(title, message, { ok = 'OK', danger = false } = {}) {
  return modal((d, close) => {
    d.innerHTML = `<h2 id="modalTitle">${esc(title)}</h2><p>${esc(message)}</p>
      <div class="dialog-actions"><button class="btn" data-x>Cancel</button><button class="btn ${danger ? 'bad' : 'primary'}" data-ok>${esc(ok)}</button></div>`;
    d.querySelector('[data-x]').onclick = () => close(false);
    d.querySelector('[data-ok]').onclick = () => close(true);
  }).then(v => !!v);
}

export function promptDialog(title, label, value = '', { ok = 'Save', placeholder = '' } = {}) {
  return modal((d, close) => {
    d.innerHTML = `<h2 id="modalTitle">${esc(title)}</h2>
      <form method="dialog"><label for="pd">${esc(label)}</label>
      <input id="pd" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" autofocus>
      <div class="dialog-actions"><button type="button" class="btn" data-x>Cancel</button><button type="submit" class="btn primary">${esc(ok)}</button></div></form>`;
    d.querySelector('[data-x]').onclick = () => close(null);
    d.querySelector('form').onsubmit = (e) => { e.preventDefault(); const v = d.querySelector('#pd').value.trim(); close(v || null); };
  });
}

export function fmtDuration(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
export function fmtWhen(ts) {
  if (!ts) return 'never';
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined, hour: 'numeric', minute: '2-digit' });
}
export function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
export function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/**
 * Save a file to the device. On iPhone home-screen apps, the share sheet is the
 * reliable path ("Save to Files"); elsewhere a normal download is used.
 */
export async function saveFile(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  if (isIOS() && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return true; }
    } catch (e) {
      if (e && e.name === 'AbortError') return false; // user cancelled the share sheet
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

/** Ask the user to pick a file and return its text. */
export function pickFile(accept = 'application/json,.json') {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.style.display = 'none';
    input.onchange = async () => { const f = input.files[0]; input.remove(); resolve(f ? await f.text() : null); };
    document.body.appendChild(input); input.click();
  });
}

export function stamp() {
  const d = new Date(); const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function statePill(state) {
  const label = { new: 'New', learning: 'Learning', review: 'Review', mastered: 'Mastered' }[state] || state;
  return `<span class="pill ${state}">${label}</span>`;
}

/** True if a keyboard event is happening while the user is typing in a field. */
export function typing(e) {
  const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}
