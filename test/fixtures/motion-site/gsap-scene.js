// GSAP cases, kept in their own file so a failure here is unambiguous: if this file
// runs and motion.js does not, the fixture is still half alive and the capture output
// says so.

/* global gsap, ScrollTrigger */
(() => {
  if (typeof gsap === "undefined") {
    console.error("fixture: gsap did not load — the GSAP cases are absent from this run");
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  // --- gsap-hero -------------------------------------------------------------
  // A named timeline with three tweens, so gsap.globalTimeline.getChildren() has real
  // structure to report rather than a single anonymous tween.
  const hero = gsap.timeline({ id: "hero-intro", repeat: -1, yoyo: true, defaults: { duration: 0.8 } });
  hero
    .from("[data-fixture-id='gsap-hero']", { y: 24, opacity: 0, ease: "power3.out" })
    .to("[data-fixture-id='gsap-hero']", { letterSpacing: "0.04em", ease: "sine.inOut" })
    .to("[data-fixture-id='gsap-hero']", { color: "#3d5afe", ease: "none" });

  // --- gsap-scroll-panel -----------------------------------------------------
  // Deliberately below a 160vh spacer: this must NOT run on load. A capture that never
  // scrolls will miss it entirely, which is exactly what the adaptive sweep is for.
  gsap.to("[data-fixture-id='gsap-scroll-panel']", {
    scrollTrigger: {
      id: "panel-reveal",
      trigger: "[data-fixture-id='gsap-scroll-panel']",
      start: "top 80%",
      end: "bottom 30%",
      scrub: true,
    },
    scaleX: 0.35,
    transformOrigin: "left center",
    ease: "none",
  });
})();
