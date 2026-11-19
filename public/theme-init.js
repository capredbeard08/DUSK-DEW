/* Runs before first paint. Marks JS as available and arms a failsafe so that
   content can never stay hidden if the animation scripts fail to load. */
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) root.classList.add('static');
  try {
    if (!reduce && document.body === null && /^\/?$/.test(location.pathname) && !sessionStorage.getItem('dd_intro')) {
      root.classList.add('intro-on');
    }
  } catch (e) { /* storage blocked: skip the intro */ }
  window.setTimeout(function () {
    if (!window.__ddReady) {
      root.classList.add('gsap-failed');
      root.classList.remove('intro-on');
    }
  }, 4000);
})();
