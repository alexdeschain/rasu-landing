/* ============================================================
   РАСУ — UI interactions
   - Sticky header state on scroll
   - Mobile burger menu
   - Scroll-reveal (IntersectionObserver)
   - Animated stat counters
   - Scroll progress -> 3D roof lift (bridge to scene.js)
   - Contact form validation + demo success
   ============================================================ */

import { setScrollProgress, sceneActive, isMobileMode, startAutoOpen } from './scene.js';

const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.addEventListener('DOMContentLoaded', () => {
  initHeader();
  initBurger();
  initReveal();
  initCounters();
  initScrollScene();
  initForm();
  initYear();
});

/* ============================================================
   Header: add .scrolled after a small offset
   ============================================================ */
function initHeader() {
  const header = document.getElementById('header');
  if (!header) return;
  const onScroll = () => {
    if (window.scrollY > 40) header.classList.add('scrolled');
    else header.classList.remove('scrolled');
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

/* ============================================================
   Burger / mobile nav
   ============================================================ */
function initBurger() {
  const burger = document.getElementById('burger');
  const nav = document.getElementById('nav');
  if (!burger || !nav) return;

  const close = () => {
    nav.classList.remove('open');
    burger.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Открыть меню');
  };
  const toggle = () => {
    const open = nav.classList.toggle('open');
    burger.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  };

  burger.addEventListener('click', toggle);
  // Close after clicking any nav link
  nav.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
  // Close on Escape
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

/* ============================================================
   Scroll reveal with stagger
   ============================================================ */
function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (!els.length) return;

  if (prefersReduced || !('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('visible'));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      // Stagger items that share a parent group
      const group = el.closest('.cards, .stats, .about__points, .product__features');
      if (group) {
        const siblings = Array.from(group.querySelectorAll('.reveal'));
        const idx = siblings.indexOf(el);
        if (idx > -1) el.style.setProperty('--reveal-delay', (idx * 0.08) + 's');
      }
      el.classList.add('visible');
      io.unobserve(el);
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

  els.forEach((el) => io.observe(el));
}

/* ============================================================
   Animated counters (run once when visible)
   ============================================================ */
function initCounters() {
  const nums = document.querySelectorAll('.stat__num[data-count]');
  if (!nums.length) return;

  const run = (el) => {
    const target = parseFloat(el.dataset.count) || 0;
    const suffix = el.dataset.suffix || '';
    if (prefersReduced) { el.textContent = target + suffix; return; }

    const duration = 1600;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      el.textContent = Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = target + suffix;
    };
    requestAnimationFrame(step);
  };

  if (!('IntersectionObserver' in window)) {
    nums.forEach(run);
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) { run(entry.target); io.unobserve(entry.target); }
    });
  }, { threshold: 0.4 });
  nums.forEach((n) => io.observe(n));
}

/* ============================================================
   Hero disassembly driver — two distinct modes
   --------------------------------------------------------------
   DESKTOP (>768px): scroll-pinned. The hero is a tall TRACK; its
   .hero__sticky child is pinned (CSS position: sticky). The scrolled
   distance through the track maps to 0..1 and feeds the 3D scene, which
   disassembles the workshop. Once progress hits 1 the sticky releases and
   the page scrolls on normally. A bouncing chevron hints "scroll".

   MOBILE (≤768px, touch / narrow): NO pin. The hero is one screen
   (~100svh, set via the `mobile-scene` class on <html>). The disassembly
   is a self-playing, time-based tween started by a TAP on the scene/hint
   (scene.js → startAutoOpen). After it plays the page just scrolls normally
   to #about. A prominent "tap to start" button advertises the interaction.

   Both modes degrade: with prefers-reduced-motion or no live WebGL scene,
   the pin/tween is skipped, the track collapses to one viewport (CSS), and
   the hint/tap button is hidden — scrolling stays normal and unstuck.

   The active mode is re-derived on resize, so a portrait↔landscape flip
   across the 768px breakpoint switches behaviour without a reload.
   ============================================================ */
function initScrollScene() {
  const hero = document.getElementById('hero');
  const scrollHint = document.getElementById('scroll-hint');   // desktop chevron
  const tapHint = document.getElementById('tap-hint');         // mobile button
  if (!hero) return;

  const root = document.documentElement;

  // Live checks (not captured once) so late scene start / resize are honoured.
  const reduced = () => prefersReduced;
  const noScene = () => !sceneActive();
  const mobile = () => isMobileMode();

  /* ---- DESKTOP scroll-pin geometry ---- */
  let trackTop = 0;
  let travel = 1;   // px of pinned scroll distance (trackHeight - viewport)
  const measure = () => {
    const rect = hero.getBoundingClientRect();
    trackTop = rect.top + window.scrollY;            // track's document offset
    const vh = window.innerHeight || 1;
    travel = Math.max(1, hero.offsetHeight - vh);    // guard against /0
  };

  // Has the mobile tap been offered already (so we wire it once)?
  let tapWired = false;
  const fireTap = (e) => {
    if (e) e.preventDefault();
    startAutoOpen();
    if (tapHint) tapHint.classList.add('hidden');
  };
  const wireTap = () => {
    if (tapWired) return;
    tapWired = true;
    const scene = document.getElementById('scene-container');
    // Tapping the hint OR anywhere on the scene starts the reveal.
    if (tapHint) tapHint.addEventListener('click', fireTap);
    if (scene) scene.addEventListener('click', () => fireTap());
  };

  // Apply the body/root state for the CURRENT mode. Idempotent.
  const applyMode = () => {
    const isMobile = mobile();
    const disabled = reduced() || noScene();   // no interactive reveal at all
    root.classList.toggle('mobile-scene', isMobile);

    if (isMobile) {
      // Mobile owns the reveal via tap; never feed scroll progress.
      setScrollProgress(0);
      if (scrollHint) scrollHint.classList.add('hidden');
      // Show the tap button only when an interactive scene is actually live.
      if (tapHint) tapHint.classList.toggle('hidden', disabled);
      if (!disabled) wireTap();
    } else {
      // Desktop: chevron handled by the scroll updater; hide the tap button.
      if (tapHint) tapHint.classList.add('hidden');
    }
  };

  let ticking = false;
  const update = () => {
    ticking = false;
    // On mobile the scroll never drives the scene.
    if (mobile()) return;
    if (reduced() || noScene()) {
      setScrollProgress(0);
      if (scrollHint) scrollHint.classList.add('hidden');
      return;
    }
    // Progress = how far we are through the pinned region, clamped 0..1.
    const scrolled = window.scrollY - trackTop;
    const progress = Math.max(0, Math.min(1, scrolled / travel));
    setScrollProgress(progress);
    // Hide the "scroll to reveal" chevron as soon as the user engages.
    if (scrollHint) scrollHint.classList.toggle('hidden', progress > 0.04);
  };

  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(update);
    }
  };
  const onResize = () => { applyMode(); measure(); onScroll(); };

  applyMode();
  measure();
  update();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  // Late layout shifts (fonts, images) can move the track; re-measure once.
  window.addEventListener('load', onResize, { passive: true });
}

/* ============================================================
   Contact form: validation + demo success
   ============================================================ */
function initForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;
  const success = document.getElementById('form-success');

  const setError = (name, msg) => {
    const field = form.querySelector(`#${name}`)?.closest('.field');
    const errEl = form.querySelector(`[data-error-for="${name}"]`);
    if (field) field.classList.toggle('invalid', !!msg);
    if (errEl) errEl.textContent = msg || '';
  };

  const validators = {
    name: (v) => (!v.trim() ? 'Укажите ваше имя' : (v.trim().length < 2 ? 'Слишком короткое имя' : '')),
    email: (v) => {
      const t = v.trim();
      if (!t) return 'Укажите e-mail';
      // Spec, not example: non-space local @ non-space domain . tld
      const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return re.test(t) ? '' : 'Некорректный e-mail';
    },
    message: (v) => (!v.trim() ? 'Введите сообщение' : (v.trim().length < 10 ? 'Сообщение слишком короткое' : ''))
  };

  // Clear error on input
  Object.keys(validators).forEach((name) => {
    const input = form.querySelector(`#${name}`);
    if (input) input.addEventListener('input', () => setError(name, ''));
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let ok = true;
    let firstInvalid = null;
    Object.keys(validators).forEach((name) => {
      const input = form.querySelector(`#${name}`);
      const msg = validators[name](input ? input.value : '');
      setError(name, msg);
      if (msg) { ok = false; if (!firstInvalid) firstInvalid = input; }
    });

    if (!ok) { firstInvalid?.focus(); return; }

    // Demo: no backend — show success and reset.
    if (success) {
      success.hidden = false;
      success.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'nearest' });
    }
    form.reset();
    setTimeout(() => { if (success) success.hidden = true; }, 6000);
  });
}

/* ============================================================
   Footer year
   ============================================================ */
function initYear() {
  const y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());
}
