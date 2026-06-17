/* ============================================================
   РАСУ — UI interactions
   - Sticky header state on scroll
   - Mobile burger menu
   - Scroll-reveal (IntersectionObserver)
   - Animated stat counters
   - Scroll progress -> 3D roof lift (bridge to scene.js)
   - Contact form validation + demo success
   ============================================================ */

import { setScrollProgress } from './scene.js';

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
   Scroll -> 3D roof lift + hide scroll hint
   Progress is 0 at hero top, 1 once we have scrolled one
   viewport height down (the hero unveils as you scroll).
   ============================================================ */
function initScrollScene() {
  const hero = document.getElementById('hero');
  const hint = document.getElementById('scroll-hint');
  if (!hero) return;

  let ticking = false;
  const update = () => {
    ticking = false;
    const vh = window.innerHeight || 1;
    // Distance scrolled into the hero, normalised over ~85% of a viewport.
    const scrolled = window.scrollY;
    const progress = Math.max(0, Math.min(1, scrolled / (vh * 0.85)));
    setScrollProgress(progress);

    if (hint) hint.classList.toggle('hidden', progress > 0.06);
  };

  const onScroll = () => {
    if (!ticking) {
      window.requestAnimationFrame(update);
      ticking = true;
    }
  };
  update();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
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
