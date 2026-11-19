/* =========================================================
   charts.js — dependency-free canvas bar charts
   Crisp on Retina (devicePixelRatio), theme-aware (reads CSS
   variables), and redraws on resize / theme change.
   ========================================================= */

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{labels:string[], series:{name:string, values:number[], color:string}[], stacked?:boolean, format?:(n:number)=>string}} cfg
 *   Series are drawn stacked (e.g. correct + incorrect = total reviews).
 */
export function barChart(canvas, cfg) {
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 180;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const text2 = css('--text-2'), border = css('--border');
    const font = `600 11px ${css('--font') || 'system-ui'}`;
    const padL = 30, padR = 6, padT = 12, padB = 22;
    const n = cfg.labels.length;
    const totals = cfg.labels.map((_, i) => cfg.series.reduce((s, ser) => s + (ser.values[i] || 0), 0));
    const max = niceMax(Math.max(1, ...totals));
    const plotW = w - padL - padR, plotH = h - padT - padB;

    // gridlines + y labels
    ctx.font = font; ctx.fillStyle = text2; ctx.strokeStyle = border; ctx.lineWidth = 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let g = 0; g <= 2; g++) {
      const v = (max / 2) * g, y = padT + plotH - (v / max) * plotH;
      ctx.globalAlpha = g === 0 ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(padL, Math.round(y) + .5); ctx.lineTo(w - padR, Math.round(y) + .5); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(fmtShort(v), padL - 6, y);
    }

    const slot = plotW / n, bw = Math.max(2, Math.min(28, slot * 0.66));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const every = Math.ceil(n / Math.max(1, Math.floor(plotW / 34)));
    for (let i = 0; i < n; i++) {
      const x = padL + slot * i + (slot - bw) / 2;
      let yBase = padT + plotH;
      cfg.series.forEach((ser, si) => {
        const v = ser.values[i] || 0; if (!v) return;
        const bh = (v / max) * plotH;
        ctx.fillStyle = ser.color;
        const top = si === cfg.series.length - 1 || !cfg.series.slice(si + 1).some(s2 => s2.values[i]);
        roundRect(ctx, x, yBase - bh, bw, bh, top ? Math.min(5, bw / 2) : 0);
        yBase -= bh;
      });
      if (i % every === 0 || i === n - 1) { ctx.fillStyle = text2; ctx.fillText(cfg.labels[i], x + bw / 2, padT + plotH + 6); }
    }
  };
  draw();
  const ro = new ResizeObserver(() => draw());
  ro.observe(canvas);
  canvas._redraw = draw;
  return () => ro.disconnect();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h);
  ctx.closePath(); ctx.fill();
}
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
function fmtShort(v) { return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : String(Math.round(v)); }
