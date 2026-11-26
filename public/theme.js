/* DUSK & DEW storefront motion (GSAP 3.15). Progressive enhancement: every page works without this file.
   theme-init.js sets html.js early and arms a failsafe; this file sets window.__ddReady when GSAP is live. */
(function () {
  'use strict';

  var root = document.documentElement;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var gsap = window.gsap;
    if (!gsap) {
      root.classList.add('gsap-failed');
      root.classList.remove('intro-on');
      return;
    }
    var plugins = [window.ScrollTrigger, window.SplitText, window.DrawSVGPlugin, window.MotionPathPlugin].filter(Boolean);
    gsap.registerPlugin.apply(gsap, plugins);
    var ST = window.ScrollTrigger;
    var Split = window.SplitText;
    window.__ddReady = true;

    var body = document.body;
    var reduce = root.classList.contains('static');
    var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    var isHome = body.classList.contains('home');
    var q = function (sel, scope) { return (scope || document).querySelector(sel); };
    var qa = function (sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); };

    // Each module is isolated: one failing never takes the page down.
    function safe(name, fn) {
      try { fn(); } catch (err) { if (window.console) console.warn('[dd] ' + name + ' failed', err); }
    }

    if (ST) ST.config({ ignoreMobileResize: true });

    /* ---------- Header: glass once scrolled; light text over dark sections ---------- */
    var header = q('.site-header');
    var dark = { stage: false, marquee: false, ritual: false };
    function applyDark() { body.classList.toggle('on-dark', isHome && (dark.stage || dark.marquee || dark.ritual)); }
    function onScroll() { if (header) header.classList.toggle('scrolled', window.scrollY > 24); }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    /* ---------- Hero entrance ---------- */
    function playHero() {
      var title = q('[data-title]');
      var others = qa('[data-hide]').filter(function (el) { return el !== title; });
      if (title) {
        gsap.set(title, { autoAlpha: 1 });
        if (Split && !reduce) {
          Split.create(title, {
            type: 'lines,words',
            mask: 'lines',
            autoSplit: true,
            onSplit: function (self) {
              return gsap.from(self.words, { yPercent: 118, duration: 1.2, ease: 'expo.out', stagger: 0.07 });
            },
          });
        }
      }
      gsap.fromTo(others, { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 1, ease: 'power3.out', stagger: 0.14, delay: 0.35 });
      gsap.fromTo('[data-bottle]', { autoAlpha: 0, scale: 0.86 }, { autoAlpha: 1, scale: 1, duration: 1.4, ease: 'expo.out', stagger: 0.14, delay: 0.25 });
    }

    safe('intro', function () {
      var intro = q('[data-intro]');
      if (!intro) return;
      if (!root.classList.contains('intro-on') || reduce) {
        intro.style.display = 'none';
        root.classList.remove('intro-on');
        playHero();
        return;
      }
      var paths = qa('[data-draw]', intro);
      var tl = gsap.timeline({
        onComplete: function () {
          root.classList.remove('intro-on');
          try { sessionStorage.setItem('dd_intro', '1'); } catch (e) { /* ignore */ }
          intro.style.display = 'none';
        },
      });
      if (window.DrawSVGPlugin) tl.from(paths, { drawSVG: '0%', duration: 1.1, ease: 'power2.inOut', stagger: 0.2 });
      tl.from('.intro-word', { autoAlpha: 0, y: 14, letterSpacing: '0.9em', duration: 0.9, ease: 'power3.out' }, 0.35)
        .to(intro, { yPercent: -100, duration: 0.9, ease: 'expo.inOut' }, '+=0.25')
        .add(playHero, '-=0.5');
    });

    if (!isHome) {
      safe('page-enter', function () {
        if (!reduce) gsap.from('#main', { autoAlpha: 0, y: 16, duration: 0.8, ease: 'power3.out', clearProps: 'all' });
      });
    }

    if (!ST) return;

    /* ---------- The pinned day: dawn, noon, dusk, night ---------- */
    var mm = gsap.matchMedia();

    safe('stage', function () {
      var stage = q('[data-stage]');
      if (!stage || reduce) return;
      mm.add('(min-width: 1px)', function () {
        var skyDay = q('.sky-day'), skyDusk = q('.sky-dusk'), skyNight = q('.sky-night');
        var sun = q('[data-sun]'), moon = q('[data-moon]');
        var sunBox = q('span', sun);
        gsap.set([skyDay, skyDusk, skyNight], { opacity: 0 });
        gsap.set('[data-stars]', { opacity: 0 });
        gsap.set(sun, { '--core': '#f6d9a8', '--glow': 'rgba(222,160,100,0.5)' });

        var tl = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: {
            trigger: stage,
            start: 'top top',
            end: '+=250%',
            pin: true,
            scrub: 0.7,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            onUpdate: function (self) {
              dark.stage = self.progress > 0.45 && self.progress <= 1;
              applyDark();
            },
            onLeave: function () { dark.stage = false; applyDark(); },
            onLeaveBack: function () { dark.stage = false; applyDark(); },
          },
        });

        tl.to(skyDay, { opacity: 1, duration: 3 }, 0)
          .to(skyDusk, { opacity: 1, duration: 3 }, 3)
          .to(skyNight, { opacity: 1, duration: 3 }, 6)
          .to('[data-stars]', { opacity: 1, duration: 2 }, 6.5)
          .to(stage, { '--ink': '#faf4e6', '--ink-soft': '#eee1c8', duration: 1.4 }, 3.6)
          .to(sun, { '--core': '#e08a5a', '--glow': 'rgba(196,117,79,0.55)', duration: 2 }, 4);

        if (window.MotionPathPlugin) {
          tl.to(sun, {
            motionPath: { path: '#sun-path', align: '#sun-path', alignOrigin: [0.5, 0.5] },
            duration: 6.6,
          }, 0)
            .to(sun, { opacity: 0, duration: 0.8 }, 6)
            .fromTo(moon, { opacity: 0 }, { opacity: 1, duration: 1 }, 6.6)
            .to(moon, {
              motionPath: { path: '#moon-path', align: '#moon-path', alignOrigin: [0.5, 0.5] },
              duration: 3.4,
            }, 6.6);
        } else {
          tl.to(sun, { yPercent: -30, duration: 6 }, 0).to(sun, { opacity: 0, duration: 1 }, 6);
        }

        tl.to('[data-bottle]', { y: function (i) { return -70 - i * 50; }, rotate: function (i) { return [-9, 0, 9][i] || 0; }, duration: 9 }, 0)
          .to('[data-title]', { yPercent: -6, duration: 8 }, 1)
          .to('[data-hint]', { opacity: 0, duration: 0.6 }, 0)
          .to('.stage-actions .btn-dark', { scale: 1.06, duration: 1, yoyo: true, repeat: 1 }, 8);
        return function () { dark.stage = false; applyDark(); };
      });
    });

    /* ---------- Marquee: always moving, hurried by scrolling ---------- */
    safe('marquee', function () {
      var track = q('[data-track]');
      if (!track || reduce) return;
      var loop = gsap.to(track, { xPercent: -25, ease: 'none', duration: 38, repeat: -1 });
      var calm;
      ST.create({
        trigger: '[data-marquee]',
        start: 'top bottom',
        end: 'bottom 70px',
        onToggle: function (self) { dark.marquee = self.isActive; applyDark(); },
        onUpdate: function (self) {
          var boost = 1 + Math.min(6, Math.abs(self.getVelocity()) / 420);
          gsap.to(loop, { timeScale: self.direction * boost, duration: 0.25, overwrite: true });
          if (calm) calm.kill();
          calm = gsap.to(loop, { timeScale: self.direction, duration: 1.4, delay: 0.3, ease: 'power2.out' });
        },
      });
    });

    /* ---------- Statement: words light up as you read ---------- */
    safe('statement', function () {
      var el = q('[data-words]');
      if (!el || reduce || !Split) return;
      Split.create(el, {
        type: 'words',
        autoSplit: true,
        onSplit: function (self) {
          return gsap.fromTo(self.words, { opacity: 0.14 }, {
            opacity: 1,
            ease: 'none',
            stagger: 0.12,
            scrollTrigger: { trigger: el, start: 'top 82%', end: 'bottom 48%', scrub: 0.5 },
          });
        },
      });
    });

    /* ---------- Ritual: pinned horizontal journey (large screens), swipeable rail otherwise ---------- */
    safe('ritual', function () {
      var section = q('[data-ritual]');
      var pin = q('[data-ritual-pin]');
      var track = q('[data-ritual-track]');
      var bar = q('[data-ritual-bar]');
      if (!section || !pin || !track) return;

      ST.create({
        trigger: section,
        start: 'top 70px',
        end: 'bottom 70px',
        onToggle: function (self) { dark.ritual = self.isActive; applyDark(); },
      });

      if (reduce) return;
      mm.add('(min-width: 900px)', function () {
        section.classList.add('pinned');
        var distance = function () { return Math.max(0, track.scrollWidth - window.innerWidth); };
        var move = gsap.to(track, {
          x: function () { return -distance(); },
          ease: 'none',
          scrollTrigger: {
            trigger: pin,
            start: 'top top',
            end: function () { return '+=' + distance(); },
            pin: true,
            scrub: 0.6,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });
        if (bar) gsap.to(bar, { scaleX: 1, ease: 'none', scrollTrigger: { trigger: pin, start: 'top top', end: function () { return '+=' + distance(); }, scrub: true, invalidateOnRefresh: true } });
        qa('[data-step]').forEach(function (step) {
          var art = q('.step-media svg, .step-media img', step);
          if (!art) return;
          gsap.fromTo(art, { y: 36, rotate: -3 }, {
            y: -36, rotate: 3, ease: 'none',
            scrollTrigger: { trigger: step, containerAnimation: move, start: 'left right', end: 'right left', scrub: true },
          });
        });
        return function () { section.classList.remove('pinned'); };
      });
      mm.add('(max-width: 899px)', function () {
        gsap.from('[data-step]', {
          x: 70, autoAlpha: 0, duration: 0.9, ease: 'power3.out', stagger: 0.12,
          scrollTrigger: { trigger: track, start: 'top 85%', once: true },
        });
        if (bar) gsap.set(bar, { scaleX: 0 });
      });
    });

    /* ---------- Promises: rules draw themselves ---------- */
    safe('promises', function () {
      if (reduce) return;
      qa('[data-promise]').forEach(function (promise) {
        var line = q('[data-draw]', promise);
        var tl = gsap.timeline({ scrollTrigger: { trigger: promise, start: 'top 86%', once: true } });
        if (line && window.DrawSVGPlugin) tl.from(line, { drawSVG: '0%', duration: 1.4, ease: 'power3.out' });
        tl.from(qa('.promise-num, h3, p', promise), { y: 34, autoAlpha: 0, duration: 0.9, ease: 'power3.out', stagger: 0.12 }, 0.15);
      });
    });

    /* ---------- Reveals for everything else ---------- */
    safe('reveal', function () {
      var targets = qa('.reveal, .section-head, .ingredient-chips li, .card, .page-head > *');
      if (!targets.length) return;
      if (reduce) { gsap.set(targets, { opacity: 1 }); return; }
      gsap.set(targets, { autoAlpha: 0, y: 34 });
      ST.batch(targets, {
        start: 'top 90%',
        once: true,
        onEnter: function (batch) { gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.95, ease: 'power3.out', stagger: 0.09, overwrite: true }); },
      });
    });

    /* ---------- Pointer niceties (fine pointers only) ---------- */
    if (fine && !reduce) {
      safe('cursor', function () {
        var dot = document.createElement('div');
        dot.className = 'cursor';
        dot.setAttribute('aria-hidden', 'true');
        body.appendChild(dot);
        var mx = gsap.quickTo(dot, 'x', { duration: 0.25, ease: 'power3' });
        var my = gsap.quickTo(dot, 'y', { duration: 0.25, ease: 'power3' });
        window.addEventListener('pointermove', function (e) { mx(e.clientX); my(e.clientY); }, { passive: true });
        document.addEventListener('pointerover', function (e) {
          var hit = e.target.closest && e.target.closest('a, button, input, select, textarea, label, [data-magnet]');
          dot.classList.toggle('hover', !!hit);
        });
      });

      safe('magnet', function () {
        qa('[data-magnet]').forEach(function (el) {
          var x = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3' });
          var y = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3' });
          el.addEventListener('pointermove', function (e) {
            var r = el.getBoundingClientRect();
            x((e.clientX - (r.left + r.width / 2)) * 0.3);
            y((e.clientY - (r.top + r.height / 2)) * 0.4);
          });
          el.addEventListener('pointerleave', function () { x(0); y(0); });
        });
      });

      safe('tilt', function () {
        qa('.card').forEach(function (card) {
          gsap.set(card, { transformPerspective: 900 });
          var rx = gsap.quickTo(card, 'rotationX', { duration: 0.6, ease: 'power3' });
          var ry = gsap.quickTo(card, 'rotationY', { duration: 0.6, ease: 'power3' });
          card.addEventListener('pointermove', function (e) {
            var r = card.getBoundingClientRect();
            ry(((e.clientX - r.left) / r.width - 0.5) * 8);
            rx(-((e.clientY - r.top) / r.height - 0.5) * 8);
          });
          card.addEventListener('pointerleave', function () { rx(0); ry(0); });
        });
      });
    }

    // Fonts change layout: recalculate every trigger once they land.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ST.refresh(); });
    window.addEventListener('load', function () { ST.refresh(); });
  });
})();
