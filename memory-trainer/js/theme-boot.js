// Runs synchronously in <head> so the correct theme is set before the page paints.
// The theme choice is mirrored to localStorage (tiny, synchronous) because IndexedDB is async
// and would cause a light/dark flash on startup.
(function () {
  var pref = 'auto';
  try { pref = localStorage.getItem('mt-theme') || 'auto'; } catch (e) { /* private mode */ }
  var dark = pref === 'dark' || (pref === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try {
    var big = localStorage.getItem('mt-fontscale');
    if (big) document.documentElement.style.setProperty('--font-scale', big);
  } catch (e) {}
})();
