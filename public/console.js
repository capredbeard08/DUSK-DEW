/* Founder Console behaviour: gentle entrance, count-up figures, command palette, drawer, unsaved-changes guard.
   Everything here is optional; the console works fully without it. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var gsap = window.gsap;
  function qa(sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); }

  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.getElementById('console-nav-toggle');

    /* Drawer: close on navigation, Escape, or backdrop; lock page scroll while open. */
    if (toggle) {
      toggle.addEventListener('change', function () { document.body.style.overflow = toggle.checked ? 'hidden' : ''; });
      qa('.console-nav a').forEach(function (a) { a.addEventListener('click', function () { toggle.checked = false; document.body.style.overflow = ''; }); });
    }

    /* Command palette: jump to any page (Ctrl/Cmd+K, or the search button). */
    var links = qa('.console-nav a').map(function (a) {
      var group = a.closest('.cgroup');
      return { href: a.getAttribute('href'), label: a.textContent.trim(), group: group ? group.querySelector('p').textContent : '' };
    });
    links.unshift({ href: '/admin/products/new', label: 'Add product', group: 'Action' });
    links.push({ href: '/', label: 'View storefront', group: 'Action' });

    var overlay = document.createElement('div');
    overlay.className = 'jump';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Jump to a page');
    overlay.innerHTML = '<div class="jump-box"><input type="search" placeholder="Jump to a page…" aria-label="Jump to a page" autocomplete="off"><ul class="jump-list"></ul></div>';
    document.body.appendChild(overlay);
    var input = overlay.querySelector('input');
    var list = overlay.querySelector('.jump-list');
    var selected = 0;
    var shown = [];

    function render() {
      var term = input.value.trim().toLowerCase();
      shown = links.filter(function (l) { return !term || (l.label + ' ' + l.group).toLowerCase().indexOf(term) !== -1; });
      selected = Math.min(selected, Math.max(0, shown.length - 1));
      list.innerHTML = '';
      if (!shown.length) { list.innerHTML = '<li class="jump-empty">No page matches that.</li>'; return; }
      shown.forEach(function (l, i) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = l.href;
        if (i === selected) a.className = 'sel';
        var name = document.createElement('span'); name.textContent = l.label;
        var grp = document.createElement('small'); grp.textContent = l.group;
        a.appendChild(name); a.appendChild(grp); li.appendChild(a); list.appendChild(li);
      });
    }
    function open() { overlay.classList.add('open'); input.value = ''; selected = 0; render(); input.focus(); }
    function close() { overlay.classList.remove('open'); }
    input.addEventListener('input', function () { selected = 0; render(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(shown.length - 1, selected + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(0, selected - 1); render(); }
      else if (e.key === 'Enter' && shown[selected]) { window.location.href = shown[selected].href; }
    });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); overlay.classList.contains('open') ? close() : open(); }
      else if (e.key === 'Escape') {
        if (overlay.classList.contains('open')) close();
        else if (toggle && toggle.checked) { toggle.checked = false; document.body.style.overflow = ''; }
      }
    });
    qa('[data-jump]').forEach(function (b) { b.addEventListener('click', open); });

    /* Unsaved-changes guard on editing forms. */
    var dirty = false;
    qa('.console-form').forEach(function (form) {
      form.addEventListener('input', function () { dirty = true; });
      form.addEventListener('submit', function () { dirty = false; });
    });
    window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

    if (!gsap || reduce) return;

    /* Entrance. */
    gsap.from('.console-top h1, .console-subtitle', { y: 14, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.08 });
    gsap.from('.stat, .panel, .table-wrap, .alert, .toolbar', { y: 22, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.05, delay: 0.1, clearProps: 'transform,opacity' });

    /* Count-up for the first number inside each headline figure, keeping its prefix, suffix and decimals. */
    qa('.stat-value').forEach(function (el) {
      var text = el.textContent;
      var m = text.match(/-?\d[\d,]*(\.\d+)?/);
      if (!m) return;
      var target = parseFloat(m[0].replace(/,/g, ''));
      if (!isFinite(target) || target === 0) return;
      var decimals = m[1] ? m[1].length - 1 : 0;
      var grouped = m[0].indexOf(',') !== -1;
      var start = text.slice(0, m.index);
      var end = text.slice(m.index + m[0].length);
      var counter = { v: 0 };
      gsap.to(counter, {
        v: target, duration: 1.4, ease: 'power3.out', delay: 0.25,
        onUpdate: function () {
          var n = counter.v.toFixed(decimals);
          if (grouped) { var p = n.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); n = p.join('.'); }
          el.textContent = start + n + end;
        },
        onComplete: function () { el.textContent = text; },
      });
    });
  });
})();
