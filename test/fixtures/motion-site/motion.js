// Browser code. Everything here is a case the fixture declares in
// fixture-manifest.json, or one of the identity hard cases. Plain JS on purpose: this
// runs as a real third-party-shaped subresource, not as part of the Bun build.

// --- waapi-slide -------------------------------------------------------------
// Element.animate(), so document.getAnimations() has something WAAPI-native to find
// that no CSS rule declares.
(() => {
  const el = document.querySelector("[data-fixture-id='waapi-slide']");
  if (!el) return;
  el.animate(
    [
      { transform: "translateX(0)", opacity: 1 },
      { transform: "translateX(180px)", opacity: 0.35 },
    ],
    { duration: 1800, iterations: Infinity, direction: "alternate", easing: "ease-in-out" },
  );
})();

// --- carousel-main -----------------------------------------------------------
// Hand-written rather than a library: the canonical "did replay actually work" case is
// worth owning, and a library would make a failure ambiguous between our capture and
// the library's own bootstrapping.
(() => {
  const root = document.querySelector("[data-fixture-id='carousel-main']");
  if (!root) return;

  const track = root.querySelector(".carousel__track");
  const slides = root.querySelectorAll(".carousel__slide");
  let index = 0;

  function show(next) {
    index = (next + slides.length) % slides.length;
    track.style.transform = `translateX(${-index * 100}%)`;
  }

  root.querySelectorAll(".carousel__btn").forEach((btn) => {
    btn.addEventListener("click", () => show(index + Number(btn.dataset.dir)));
  });

  // Autoplay, so a replay that never fires timers is visibly wrong rather than merely
  // untested.
  setInterval(() => show(index + 1), 2600);
})();

// --- lazy-hero-panel ---------------------------------------------------------
// IntersectionObserver-gated. The URL is in data-lazy-src, so nothing is requested
// until the capture sweep scrolls this into view.
(() => {
  const img = document.querySelector("[data-fixture-id='lazy-hero-panel']");
  if (!img) return;

  const io = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.src = entry.target.dataset.lazySrc;
      observer.unobserve(entry.target);
    }
  });
  io.observe(img);
})();

// --- dynamic-late-block ------------------------------------------------------
// The host is in the served HTML; its content is not. A snapshot taken before this
// fires and one taken after are different documents.
(() => {
  const host = document.querySelector("[data-fixture-id='dynamic-late-block']");
  if (!host) return;

  setTimeout(() => {
    const block = document.createElement("p");
    block.className = "late";
    block.textContent = "inserted 600ms after load";
    host.append(block);
  }, 600);
})();

// --- identity: shadow-dom ----------------------------------------------------
// An open shadow root with its own animated element, so identity injection has to
// patch attachShadow rather than walking the light DOM only.
(() => {
  class ShadowCard extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = `
        <style>
          @keyframes spin { to { transform: rotate(360deg); } }
          .mark { width: 28px; height: 28px; background: #3d5afe; animation: spin 2s linear infinite; }
        </style>
        <div class="mark" part="mark"></div>
      `;
      // A listener that exists ONLY inside the shadow root. Spike Q1 asks whether one
      // getEventListeners call with pierce:true reaches it; without this there is
      // nothing for "pierce" to have pierced and the answer would be vacuous.
      root.querySelector(".mark").addEventListener("click", () => {
        root.querySelector(".mark").classList.toggle("mark--on");
      });
    }
  }
  customElements.define("shadow-card", ShadowCard);
})();

// --- identity: delayed-insertion --------------------------------------------
// Late enough that an initial preorder walk cannot have seen it: identity has to come
// from a MutationObserver.
(() => {
  const host = document.querySelector("[data-identity-case='delayed-insertion']");
  if (!host) return;

  setTimeout(() => {
    const el = document.createElement("span");
    el.className = "flicker";
    host.append(el);
  }, 1200);
})();

// --- identity: delete-and-reinsert -------------------------------------------
// The hardest case. The element leaves the tree and comes back looking identical.
// Reconciliation must not quietly hand it a new id, and must be able to say
// identity-unresolved instead of guessing.
(() => {
  const host = document.querySelector("[data-identity-case='delete-and-reinsert']");
  if (!host) return;

  const original = host.querySelector(".flicker");
  if (!original) return;

  setInterval(() => {
    if (original.isConnected) {
      original.remove();
    } else {
      host.append(original);
    }
  }, 1500);
})();
