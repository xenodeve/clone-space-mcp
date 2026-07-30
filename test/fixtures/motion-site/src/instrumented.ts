/**
 * The one module served minified with a published sourcemap.
 *
 * Its job is to be *unreadable after minification* and recoverable from the map, so the
 * extract phase has something real to un-minify. The identifiers below are deliberately
 * distinctive: if `computeHeroParallaxOffset` shows up in extracted output, the map was
 * genuinely applied; if only a mangled one-letter name shows up, it was not.
 */

const PARALLAX_CEILING_PX = 96;

export function computeHeroParallaxOffset(scrollY: number, depth: number): number {
  const raw = scrollY * depth;
  return Math.min(raw, PARALLAX_CEILING_PX);
}

export function applyHeroParallax(title: HTMLElement, scrollY: number): void {
  const offset = computeHeroParallaxOffset(scrollY, 0.18);
  title.style.setProperty("--parallax", `${offset}px`);
}

function bindHeroParallax(): void {
  const title = document.querySelector<HTMLElement>("[data-fixture-id='gsap-hero']");
  if (!title) return;

  let queued = false;
  addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        applyHeroParallax(title, scrollY);
      });
    },
    { passive: true },
  );
}

bindHeroParallax();
