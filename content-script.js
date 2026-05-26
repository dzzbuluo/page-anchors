(function () {
  'use strict';

  // Guard: prevent re-execution (shared isolated world global)
  if (window.__paLoaded) return;
  window.__paLoaded = true;

  /* ==============================================
     State: module-level, session-only, no storage
     ============================================== */
  const state = {
    anchors: [],       // { id, scrollTop, label, createdAt }
    nextId: 1,
    scrollbarWidth: 0,
  };

  /* ==============================================
     Detect the main scroll container for the page.
     SPAs (DeepSeek, Bilibili, etc.) often use a
     custom scrollable div instead of the document.
     ============================================== */
  function findScrollContainer() {
    const docEl = document.documentElement;
    const body = document.body;

    // If the document itself scrolls → use it
    if (docEl.scrollHeight > docEl.clientHeight) return docEl;
    if (body && body.scrollHeight > body.clientHeight) {
      const bodyOverflow = window.getComputedStyle(body).overflowY;
      if (bodyOverflow === 'auto' || bodyOverflow === 'scroll') return body;
    }

    // Collect all scrollable containers and pick the best one.
    // When there are multiple (e.g. sidebar + main), prefer the one with the
    // most content (largest scrollHeight), which is usually the main area.
    let best = null;
    let bestScore = 0;

    function consider(el) {
      try {
        const style = window.getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight + 50) {
          let score = el.scrollHeight;
          // Downscore narrow containers at the left edge (likely sidebars)
          const rect = el.getBoundingClientRect();
          const isNarrowSidebar = rect.left < 60 && rect.width < window.innerWidth * 0.4;
          if (isNarrowSidebar) score *= 0.3;
          // Bonus for containers filling most of the viewport (likely main area)
          if (rect.width > window.innerWidth * 0.5) score *= 1.5;
          if (score > bestScore) {
            bestScore = score;
            best = el;
          }
        }
      } catch (_) {}
    }

    // Check common SPA container selectors first
    const selectors = [
      '#app', '#root', '#__next', '#__nuxt',
      '.app', '.main', '.main-content', '.content',
      '.page', '.scroll-container', '.chat',
      '.layout', '.container', '.wrapper',
      'main', '[role="main"]', 'article',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) consider(el);
    }

    // If a selector match already has plenty of content, use it immediately
    if (best && bestScore > window.innerHeight * 1.5) return best;

    // Fallback: scan all elements for scrollable containers
    const candidates = docEl.querySelectorAll('*');
    for (const el of candidates) {
      consider(el);
    }

    return best || docEl;
  }

  /* ==============================================
     AnchorStrip class
     ============================================== */
  class AnchorStrip {
    constructor() {
      this.strip = null;
      this.track = null;
      this.addBtn = null;
      this.tooltip = null;
      this.resizeObserver = null;
      this.initialized = false;
      this._clickTimers = new Map();
      this._scrollContainer = null;
    }

    /* ---- Lifecycle ---- */

    init() {
      if (this.initialized) return;
      this.initialized = true;
      try {
        this._scrollContainer = findScrollContainer();
        this.createDOM();
        this.measureScrollbar();
        this.positionStrip();
        this.bindEvents();
        this.observeHeight();
        this.render();

        this._lazyDetectContainer();
        this._autoDetectScrollContainer();
        this._protectStrip();
      } catch (e) {
        console.error('[PA] init error:', e);
      }
    }

    _lazyDetectContainer() {
      let retries = 0;
      const tryAgain = () => {
        const container = findScrollContainer();
        if (container !== this._scrollContainer) {
          this._scrollContainer = container;
          this.render();
        } else if (retries < 15) {
          retries++;
          setTimeout(tryAgain, 400);
        }
      };
      setTimeout(tryAgain, 600);
    }

    // When the user scrolls, detect which element actually scrolled and use it.
    // This handles sites where automatic container detection picks the wrong one.
    _autoDetectScrollContainer() {
      let detected = false;
      const onWheel = (e) => {
        if (detected) return;
        let el = e.target;
        while (el && el !== document.body && el !== document.documentElement) {
          if (el.scrollHeight > el.clientHeight + 50) {
            const style = window.getComputedStyle(el);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
              if (el !== this._scrollContainer) {
                this._scrollContainer = el;
                this.render();
              }
              detected = true;
              break;
            }
          }
          el = el.parentElement;
        }
      };
      document.addEventListener('wheel', onWheel, { passive: true, capture: true });
    }

    // Some SPAs unmount and re-render the DOM, removing our injected elements.
    // This observer re-inserts the strip and tooltip if they go missing.
    _protectStrip() {
      const check = () => {
        if (!document.body.contains(this.strip)) {
          document.body.appendChild(this.strip);
        }
        if (!document.body.contains(this.tooltip)) {
          document.body.appendChild(this.tooltip);
        }
      };

      // Poll at a low frequency rather than a MutationObserver to keep it simple
      this._protectInterval = setInterval(check, 2000);
    }

    destroy() {
      if (this._protectInterval) clearInterval(this._protectInterval);
      if (this.resizeObserver) this.resizeObserver.disconnect();
      if (this.strip && this.strip.parentNode) this.strip.parentNode.removeChild(this.strip);
      if (this.tooltip && this.tooltip.parentNode) this.tooltip.parentNode.removeChild(this.tooltip);
    }

    /* ---- Scroll helpers (work for both document & container) ---- */

    _getScrollTop() {
      return this._scrollContainer === document.documentElement
        ? window.scrollY
        : this._scrollContainer.scrollTop;
    }

    _getScrollHeight() {
      return this._scrollContainer === document.documentElement
        ? document.documentElement.scrollHeight
        : this._scrollContainer.scrollHeight;
    }

    _getClientHeight() {
      return this._scrollContainer === document.documentElement
        ? window.innerHeight
        : this._scrollContainer.clientHeight;
    }

    _scrollTo(y) {
      if (this._scrollContainer === document.documentElement) {
        window.scrollTo(0, y);
      } else {
        this._scrollContainer.scrollTo(0, y);
      }
    }

    _onScroll(fn) {
      if (this._scrollContainer === document.documentElement) {
        window.addEventListener('scroll', fn, { passive: true });
      } else {
        this._scrollContainer.addEventListener('scroll', fn, { passive: true });
      }
    }

    /* ---- DOM Construction ---- */

    createDOM() {
      // Strip
      this.strip = document.createElement('div');
      this.strip.className = 'pa-strip pa-strip-empty';

      // Track (faint vertical guide line)
      this.track = document.createElement('div');
      this.track.className = 'pa-track';
      this.strip.appendChild(this.track);

      // "+" add button
      this.addBtn = document.createElement('div');
      this.addBtn.className = 'pa-add-btn';
      this.addBtn.title = 'Add anchor (Alt+Click or Alt+Shift+A)';
      this.strip.appendChild(this.addBtn);

      // Tooltip (lives outside strip for positioning flexibility)
      this.tooltip = document.createElement('div');
      this.tooltip.className = 'pa-tooltip';
      document.body.appendChild(this.tooltip);

      // Append strip to page
      document.body.appendChild(this.strip);
    }

    /* ---- Scrollbar Detection & Positioning ---- */

    measureScrollbar() {
      state.scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    }

    positionStrip() {
      const sw = state.scrollbarWidth;
      const gap = 18;
      this.strip.style.right = (sw > 0 ? sw + gap : gap) + 'px';
    }

    /* ---- Event Binding ---- */

    bindEvents() {
      // Alt+Click on any page element → add anchor
      document.addEventListener(
        'click',
        (e) => {
          if (e.altKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.addAnchorAtCurrentScroll();
          }
        },
        { capture: true }
      );

      // Alt+Shift+A keyboard shortcut
      document.addEventListener('keydown', (e) => {
        if (e.altKey && e.shiftKey && (e.code === 'KeyA' || e.key === 'A')) {
          e.preventDefault();
          this.addAnchorAtCurrentScroll();
        }
      });

      // Ctrl+↑ / Ctrl+↓ → jump to nearest anchor above / below
      document.addEventListener('keydown', (e) => {
        if (!e.ctrlKey || e.altKey || e.metaKey) return;
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.jumpToNearest(-1);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.jumpToNearest(1);
        }
      });

      // "+" button
      this.addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.addAnchorAtCurrentScroll();
      });

      // Window resize → reposition strip
      window.addEventListener('resize', () => {
        this.measureScrollbar();
        this.positionStrip();
        this.render();
      });

      // Hide tooltip on scroll (container-aware)
      this._onScroll(() => {
        this.hideTooltip();
      });
    }

    /* ---- Dynamic Content ---- */

    observeHeight() {
      this.resizeObserver = new ResizeObserver(() => {
        this.measureScrollbar();
        this.positionStrip();
        this.render();
      });
      this.resizeObserver.observe(document.documentElement);
    }

    /* ---- Anchor CRUD ---- */

    addAnchorAtCurrentScroll() {
      const scrollTop = this._getScrollTop();
      const scrollHeight = this._getScrollHeight();
      const clientHeight = this._getClientHeight();
      const maxScroll = Math.max(0, scrollHeight - clientHeight);

      if (maxScroll < 1) return;

      const anchor = {
        id: state.nextId++,
        scrollTop: Math.round(scrollTop),
        label: 'Anchor ' + (state.anchors.length + 1),
        createdAt: Date.now(),
      };

      state.anchors.push(anchor);
      this.render();
    }

    removeAnchor(id) {
      if (this._clickTimers.has(id)) {
        clearTimeout(this._clickTimers.get(id));
        this._clickTimers.delete(id);
      }

      const idx = state.anchors.findIndex((a) => a.id === id);
      if (idx === -1) return;

      const dots = this.strip.querySelectorAll('.pa-dot');
      if (dots[idx]) {
        dots[idx].classList.add('pa-dot-removing');
        setTimeout(() => {
          state.anchors.splice(idx, 1);
          this.render();
        }, 200);
      } else {
        state.anchors.splice(idx, 1);
        this.render();
      }
    }

    jumpToAnchor(id) {
      const anchor = state.anchors.find((a) => a.id === id);
      if (!anchor) return;

      this.hideTooltip();

      const targetScroll = Math.min(anchor.scrollTop, this._getScrollHeight() - this._getClientHeight());
      this._smoothScrollTo(Math.max(0, targetScroll), 300);
    }

    // dir: -1 = above (Ctrl+↑), 1 = below (Ctrl+↓)
    jumpToNearest(dir) {
      const current = this._getScrollTop();
      const maxScroll = Math.max(0, this._getScrollHeight() - this._getClientHeight());
      let best = null;
      let bestDist = Infinity;

      // Include virtual anchors at page top and bottom
      const virtuals = [{ id: '__top', scrollTop: 0 }, { id: '__bottom', scrollTop: maxScroll }];

      for (const a of [...state.anchors, ...virtuals]) {
        const diff = a.scrollTop - current;
        if (dir < 0 && diff >= -1) continue; // looking above
        if (dir > 0 && diff <= 1) continue;  // looking below
        const dist = Math.abs(diff);
        if (dist < bestDist) {
          bestDist = dist;
          best = a;
        }
      }

      if (best) {
        if (best.id === '__top') {
          this._smoothScrollTo(0, 300);
        } else if (best.id === '__bottom') {
          this._smoothScrollTo(maxScroll, 300);
        } else {
          this.jumpToAnchor(best.id);
        }
      }
    }

    /* ---- Rendering ---- */

    render() {
      this.strip.classList.toggle('pa-strip-empty', state.anchors.length === 0);
      this.strip.classList.toggle('pa-has-anchors', state.anchors.length > 0);

      // Remove user dots only (fixed anchors persist)
      this.strip.querySelectorAll('.pa-dot-user').forEach((el) => el.remove());

      const stripHeight = window.innerHeight;
      const topPadding = 14;
      const usableHeight = stripHeight - topPadding - 4;

      if (usableHeight <= 0) return;

      const currentMaxScroll = Math.max(1, this._getScrollHeight() - this._getClientHeight());

      // Fixed anchor at the very top (↓ click → scroll to top)
      let topFixed = this.strip.querySelector('.pa-dot-fixed[data-id="__top"]');
      if (!topFixed) {
        topFixed = document.createElement('div');
        topFixed.className = 'pa-dot-fixed';
        topFixed.dataset.id = '__top';
        topFixed.title = 'Scroll to top';
        topFixed.style.top = '4px';
        topFixed.addEventListener('click', (e) => { e.stopPropagation(); this._smoothScrollTo(0, 300); });
        this.strip.appendChild(topFixed);
      }

      // Fixed anchor at the very bottom (↓ click → scroll to bottom)
      let bottomFixed = this.strip.querySelector('.pa-dot-fixed[data-id="__bottom"]');
      if (!bottomFixed) {
        bottomFixed = document.createElement('div');
        bottomFixed.className = 'pa-dot-fixed';
        bottomFixed.dataset.id = '__bottom';
        bottomFixed.title = 'Scroll to bottom';
        bottomFixed.style.bottom = '4px';
        bottomFixed.addEventListener('click', (e) => {
          e.stopPropagation();
          const max = Math.max(0, this._getScrollHeight() - this._getClientHeight());
          this._smoothScrollTo(max, 300);
        });
        this.strip.appendChild(bottomFixed);
      }

      state.anchors.forEach((anchor) => {
        const dot = document.createElement('div');
        dot.className = 'pa-dot pa-dot-user';
        dot.dataset.id = anchor.id;

        const percentage = Math.min(1, Math.max(0, anchor.scrollTop / currentMaxScroll));
        const topPos = topPadding + percentage * usableHeight;
        dot.style.top = Math.round(topPos) + 'px';

        // Click → jump (with short delay to disambiguate double-click)
        dot.addEventListener('click', (e) => {
          if (e.altKey) return;
          e.stopPropagation();
          if (e.detail > 1) return;

          if (this._clickTimers.has(anchor.id)) return;

          this._clickTimers.set(
            anchor.id,
            setTimeout(() => {
              this._clickTimers.delete(anchor.id);
              this.jumpToAnchor(anchor.id);
            }, 200)
          );
        });

        // Double-click → remove
        dot.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          if (this._clickTimers.has(anchor.id)) {
            clearTimeout(this._clickTimers.get(anchor.id));
            this._clickTimers.delete(anchor.id);
          }
          this.removeAnchor(anchor.id);
        });

        // Right-click → remove
        dot.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.removeAnchor(anchor.id);
        });

        // Tooltip
        dot.addEventListener('mouseenter', () => {
          const rect = dot.getBoundingClientRect();
          this.showTooltip(rect, anchor.label);
        });
        dot.addEventListener('mouseleave', () => {
          this.hideTooltip();
        });

        this.strip.appendChild(dot);
      });
    }

    /* ---- Tooltip ---- */

    showTooltip(dotRect, label) {
      const tip = this.tooltip;
      tip.textContent = label;
      tip.classList.add('pa-tooltip-visible');

      let left = dotRect.left - tip.offsetWidth - 8;
      let top = dotRect.top + dotRect.height / 2 - tip.offsetHeight / 2;

      if (left < 4) {
        left = dotRect.right + 8;
      }
      if (top < 2) top = 2;
      if (top + tip.offsetHeight > window.innerHeight - 2) {
        top = window.innerHeight - tip.offsetHeight - 2;
      }

      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }

    hideTooltip() {
      this.tooltip.classList.remove('pa-tooltip-visible');
    }

    /* ---- Smooth scroll (container-aware) ---- */

    _smoothScrollTo(targetY, duration) {
      const startY = this._getScrollTop();
      const distance = targetY - startY;

      if (Math.abs(distance) < 1) return;

      const startTime = performance.now();

      const tick = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);

        this._scrollTo(startY + distance * eased);

        if (progress < 1) {
          requestAnimationFrame(tick);
        }
      };

      requestAnimationFrame(tick);
    }
  }

  /* ==============================================
     Bootstrap
     ============================================== */
  const instance = new AnchorStrip();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => instance.init());
  } else {
    instance.init();
  }
})();
