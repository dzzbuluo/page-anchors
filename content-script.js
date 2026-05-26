(function () {
  'use strict';

  // Guard: prevent double injection (manifest + background injector)
  if (document.querySelector('.pa-strip')) return;

  /* ==============================================
     State: module-level, session-only, no storage
     ============================================== */
  const state = {
    anchors: [],       // { id, scrollPercentage, label, createdAt }
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

    // Common scroll container selectors used by SPAs
    const selectors = [
      '#app', '#root', '#__next', '#__nuxt',
      '.app', '.main', '.main-content', '.content',
      'main', '[role="main"]', 'article',
      '.page', '.scroll-container', '.chat',
      '.layout', '.container', '.wrapper',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const style = window.getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 10) {
        return el;
      }
    }

    // Fallback: scan for any element with overflow-y: auto/scroll that has content
    const candidates = docEl.querySelectorAll('*');
    for (const el of candidates) {
      const style = window.getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 100) {
        return el;
      }
    }

    return docEl;
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

      this._scrollContainer = findScrollContainer();
      this.createDOM();
      this.measureScrollbar();
      this.positionStrip();
      this.bindEvents();
      this.observeHeight();
      this.render();

      // SPAs (DeepSeek, Bilibili, etc.) render their scrollable containers
      // asynchronously after document_idle. Retry detection a few times.
      this._lazyDetectContainer();
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

    destroy() {
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
      this.strip.style.right = sw > 0 ? sw + 'px' : '0px';
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

      const percentage = scrollTop / maxScroll;

      const anchor = {
        id: state.nextId++,
        scrollPercentage: Math.round(percentage * 10000) / 10000,
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

      const scrollHeight = this._getScrollHeight();
      const clientHeight = this._getClientHeight();
      const maxScroll = Math.max(0, scrollHeight - clientHeight);
      const targetScroll = anchor.scrollPercentage * maxScroll;

      this._smoothScrollTo(targetScroll, 300);
    }

    /* ---- Rendering ---- */

    render() {
      this.strip.classList.toggle('pa-strip-empty', state.anchors.length === 0);
      this.strip.classList.toggle('pa-has-anchors', state.anchors.length > 0);

      // Remove old dots
      this.strip.querySelectorAll('.pa-dot').forEach((el) => el.remove());

      const stripHeight = window.innerHeight;
      const topPadding = 14;
      const usableHeight = stripHeight - topPadding - 4;

      if (usableHeight <= 0) return;

      state.anchors.forEach((anchor) => {
        const dot = document.createElement('div');
        dot.className = 'pa-dot';
        dot.dataset.id = anchor.id;

        const topPos = topPadding + anchor.scrollPercentage * usableHeight;
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
