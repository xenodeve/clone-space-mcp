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

/**
 * Compile a shader **from inside this module**, so the observation layer's stack names a position
 * in the minified bundle and the sourcemap can carry it back here.
 *
 * Deliberately not called at module scope: `index.html` loads this module and its ground truth —
 * no WebGL, no canvas — is what several capability tests assert. Only the page that opts in calls
 * it.
 */
export function compileFixtureShader(canvas: HTMLCanvasElement): boolean {
  const gl = canvas.getContext("webgl");
  if (!gl) return false;
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  if (!vertex) return false;
  gl.shaderSource(vertex, "attribute vec2 p; void main(){ gl_Position = vec4(p,0,1); }");
  gl.compileShader(vertex);
  return true;
}

bindHeroParallax();
