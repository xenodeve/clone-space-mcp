<!-- lang:en -->
# Pipeline architecture — the design and why it is this way

**Status:** LIVING · **Date:** 2026-07-31 · **Last hardened:** 2026-07-31 (#21, after a multi-agent review round)

> **This file owns design and reasoning. It does not own status.**
> For what is open, what gates what, and what to do next → **[`docs/OPEN-WORK-LEDGER.md`](../../OPEN-WORK-LEDGER.md)**.
> For a single decision in full → **[`docs/adr/`](../../adr/README.md)**.
> For where the decisions came from → `Obsidian-CloneSpaceMcp/planning-provenance.md`.

---

## 1. Definition of done

Not "the HTML was saved". This sequence, **with the network disconnected**:

**capture** a GSAP-heavy page → **replay** it and watch the motion actually run → **extract** a
**behavior graph** → **serve** it and have an agent answer *"what makes the hero move?"* correctly.

**Citation degrades honestly.** Where the site published a sourcemap and capture fetched it, the
answer cites original file and line. Where it did not, the answer cites bundle position and an
inferred symbol, **and the archive says which case it is** (§6.4). An archive that cannot support a
file-and-line citation must report that, not return something that reads like a failure to find
the animation. Guessing an original filename is not a fallback — it is a fabricated citation.

Every phase's exit criterion is checked against `test/fixtures/motion-site`, never against a real
page. On a real page *"the extractor found 12 animations"* is unfalsifiable — 12-of-12 and
12-of-30 are indistinguishable. The **fixture manifest** is the **ground truth** that makes the
criteria checkable.

## 2. The load-bearing commitment

**Replay navigates the original URL, with the original document HTML, so the page's own
JavaScript re-executes.** The archive is served through `routeFromHAR(har, { notFound: 'abort' })`.

**Rejected: serializing the hydrated DOM as the executable bootstrap.** It breaks hydration, and
entry animations have already finished by the time a snapshot is taken, so they never play. During
planning the agents arguing for it conceded the outcome themselves — *"Interactivity: Nonexistent"*.

Two consequences that are contracts, not knobs:

- **`notFound: 'abort'` — and it covers HTTP only.** A request that leaks to the live network
  silently poisons extraction: the archive appears to work while depending on something it does not
  contain. **`routeFromHAR` does not intercept WebSocket** (that is `routeWebSocket`) and does not
  model SSE stream timing, so today those channels would reach the live network rather than abort
  cleanly. The fix is **not** a mock layer — a fake socket is a fabricated recording. The fix is to
  detect the channel, refuse to claim fidelity, and say so in the archive's capability flags (§6.4).
- **`serviceWorkers: 'block'` at both capture and replay.** HAR routing does not cover requests a
  service worker intercepts. Pages where a service worker is load-bearing — asset decryption, MSW,
  SW-routed WASM — will not initialise, and that is a **reported incapability**, not a silent failure.

## 3. The four stages

They are distinct and ordered. None of them is "scraping" — see `UBIQUITOUS_LANGUAGE.md`.

```
capture ──▶ archive ──▶ replay ──▶ extract ──▶ behavior graph ──▶ serve
   │                       ▲          │
   │                       └──────────┘
   │        extract runs against replay, not capture, so it is
   │        deterministic and re-runnable without a new capture
   │
   └─ sourcemaps must be fetched HERE. The page never requests `.map`
      itself, so missing them at capture makes them unobtainable forever.
```

| Stage | What it does | Settled rules |
|---|---|---|
| **capture** | Headful Chromium · `recordHar({mode:'full', content:'attach'})` · adaptive **sweep** · records an **interaction transcript** · saves original HTML, serialized DOM, screenshots, sourcemaps · writes every artifact in §6 | No `waitUntil:'networkidle'` — an analytics or polling page never settles. Use a **quiet window**, bounded by an explicit budget (§6.10) |
| **replay** | `routeFromHAR(..., {notFound:'abort'})`, navigate the original URL, in the pinned environment (§6.2) | Isolated and offline. Zero unexpected requests is a pass/fail criterion, and every one that does occur is classified (§6.5) |
| **extract** | Animations with target, trigger, timing, easing, library · computed styles · matched CSS · bound listeners · un-minification | Runs at replay time so it is re-runnable; raw evidence is retained so a better extractor never forces a re-capture |
| **serve** | MCP with progressive disclosure: a **tool manifest** under 50 KB, then drill-down | The MCP layer owns no logic — see §8 |

## 4. Element identity — the foundation

Full decision: **[ADR 0002](../../adr/0002-element-identity-wa-ids-with-fingerprint-reconciliation.md)**.

Everything downstream references these ids, so this is the most expensive thing to get wrong.

`wa:<frame-key>:<sequence>`, assigned by **the same injected module** on capture and on every
replay pass.

**A `wa:` id is a handle within one run, never a key across two.** Replay rebuilds the DOM by
re-executing the page's JavaScript, so the counter lands elsewhere. Only a **fingerprint** crosses
the run boundary, and the **ตัวจับคู่** decides the rest — **transitive** through matched
**โหนดแม่**, never by emission order.

**An element that cannot be identified is reported as `identity-unresolved`, never guessed.** A
ตัวจับคู่ confident enough to always answer answers wrongly for delete-and-reinsert, and that wrong
answer becomes mis-attributed animation data three stages later with nothing left to signal it.

### The current implementation is brittle (#20)

`fingerprintKey()` joins `siblingOrdinal` and `textHash` into the bucket key as **equality**
components. One unrelated node inserted above a target shifts its ordinal, the key no longer
matches, and an element carrying a unique stable **attribute** is reported `missing` with zero
candidates — while the very node it should have matched appears in `replayOnly`. The result
contradicts itself, and on a framework page this happens constantly.

Stable evidence must **generate** candidates; ordinal and text must **rank** them. The refusal to
guess stays: a clear winner matches, a tie is still `identity-unresolved`. **The frame key has the
same defect** — it uses occurrence index among same-URL siblings, so reordered `about:blank`,
`srcdoc` or repeated-widget frames swap namespaces silently.

### Not every animation target is an Element

Pseudo-elements, SVG, CSS custom properties, `window`/`document`, plain JS objects, and graphics
resources cannot be named by a `wa:` handle. The behavior graph needs a **versioned `TargetRef`
union** — element · pseudo-element · document · JS object · graphics resource · opaque — decided
before the graph schema ships, because widening it later invalidates every graph already produced.

## 5. Performance rules

**Measured** — from `docs/reports/2026-07-30-cdp-spike.md`, against the fixture:

| Rule | Evidence |
|---|---|
| One `getEventListeners({depth:-1, pierce:true})` per target is enough; no per-node round-trips | `pierce:false` → 2 click listeners, `pierce:true` → 4. Gain of exactly +2, matching the shadow root and the iframe |
| No computed-property allowlist needed in v1 | `DOMSnapshot.captureSnapshot` with 40 properties: **1.381 MB at 6160 nodes**, 237 B/node marginal → ~0.7 MB at 3000 |
| CDP can read a cross-origin stylesheet the page cannot | `SecurityError` in-page; 593 bytes returned through `CSS.getStyleSheetText`. **Scope:** classic linked sheets only — `adoptedStyleSheets` and constructed CSSOM are a different path and untested |

**Argued, not yet measured** — design intent until an implementation exists:

- Bulk DOM and computed styles via `DOMSnapshot.captureSnapshot`; batch with
  `DOM.pushNodesByBackendIdsToFrontend`; reserve `CSS.getMatchedStylesForNode` for a 60–200 node
  shortlist.
- High-volume in-page traces accumulate on `window.__x` — **bounded**, never read-once-unbounded
  (§6.7). Not `Runtime.addBinding` per event.
- Adaptive sweep: advance 0.75–0.9 viewport, wait 2 rAF + 40–100 ms, extend on new activity, stop
  after 3 consecutive empty checkpoints; add positions from `ScrollTrigger.getAll()` and clustered
  `IntersectionObserver` targets. **Window scrolling is not enough** — nested and horizontal
  scrollers load only when their own container moves (§6.11).
- `Profiler.startPreciseCoverage` distorts timing and needs its own replay pass.

## 6. Archive contracts

Found in the 2026-07-31 review round. **Every one of these changes what a capture run must write**,
so each is free to state now and forces a re-capture of every existing archive if added later.
That asymmetry is the whole reason they are here before P2 rather than in a backlog.

| # | Contract | Why retrofitting is expensive |
|---|---|---|
| 6.1 | **Redaction policy.** `content:'attach'` stores `Authorization` headers, cookies and request bodies | An archive that already leaked a credential cannot be un-leaked. Ranked first by `codex` |
| 6.2 | **`environment.json`** — viewport, devicePixelRatio, locale, timezone, `prefers-reduced-motion`, `prefers-color-scheme`, UA and browser build, font environment, origin-scoped storage | Each of these changes the DOM that gets built. A replay that does not pin them reconciles two different pages and blames the ตัวจับคู่ |
| 6.3 | **Checkpoint coherence** — every artifact carries a `checkpointId`, a frame/document epoch, and a monotonic timestamp | `DOMSnapshot`, listeners, library state, styles and screenshots are separate probes taken while the page mutates. Without an epoch the archive can describe a page that never existed, and nothing downstream can detect it |
| 6.4 | **Capability flags** — **shipped** as `capabilities.json` (ADR 0006, #59–#64): `serviceWorkerDependent` · `webSocketDependent` · `closedShadowRootPresent` · `sourcemapDeclared`, each tri-state. Renamed from *no sourcemap*, which described the archive rather than the page. **OOPIF moved to §6.9**, which owns target inventory and needs a browser-level CDP session `captureHar` does not have | Without them `extract` returns an empty graph that reads as success. Adding them after the tool manifest ships breaks every consumer |
| 6.5 | **Request normalization + unexpected-request taxonomy** — PRD #84: capture records an explicit, default-empty volatile-query-key policy; `network.har` remains the only request source of truth; replay derives its index in memory. A unique normalized match may rewrite into `routeFromHAR`; ambiguity, a redacted POST body, or no candidate aborts and is classified. The pinned Playwright path must be proved before implementation (#85 / ADR 0007) | Playwright matches HAR strictly on URL and method, and compares POST bodies, so a nonce or timestamp aborts a logically identical request. Guessing broad volatile keys can instead serve the wrong response. Retrofitting either policy changes which archived response replay is allowed to select |
| 6.6 | **Versioned `TargetRef` union** (§4) | Widening the target type invalidates every behavior graph already produced |
| 6.7 | **Bounded traces** — byte and event caps, sequence-numbered chunks flushed to the host, backpressure, an explicit **dropped-event counter** | An unbounded buffer exhausts the renderer. A silent ring buffer is worse: it destroys evidence without saying so, and the loss is undetectable afterwards |
| 6.8 | **Transactional integrity** — write to a temporary location, hash artifacts, record producer and schema versions, publish a commit marker only after validation | A crash mid-capture otherwise leaves something that reads as complete |
| 6.9 | **Target inventory** — OOPIFs, popups, dedicated and shared workers, worklets, with attach/detach/navigation epochs | The archive layout has to be multi-target from the start; bolting it onto a single-document shape is a rewrite |
| 6.10 | **Capture termination budget** — wall-clock, byte, node, height and event budgets, plus `capture-incomplete` reasons | Infinite scroll and polling extend a quiet window forever. Without a recorded reason, a truncated capture is indistinguishable from a complete one |
| 6.11 | **The transcript records its scroll container**, not just page coordinates | Nested and horizontal scrollers cannot be expressed otherwise, and the transcript format is hard to reverse (§11) |

## 7. Exit criteria

The definition of done per phase. **Status lives in the ledger.**

| Phase | Passes when |
|---|---|
| **P0** fixture + blocking spikes | The fixture serves and declares its contents; Q1–Q3 answered with measured numbers |
| **P1** element identity | **100%** id reconciliation across capture→replay on the fixture, covering all five identity hard cases, **and** the brittleness case in #20 |
| **P2** capture | All artifacts present, including every contract in §6 |
| **P3** replay | Network off · zero unexpected requests, each classified · motion runs |
| **P4** extract | Finds every animation the **fixture manifest** declares |
| **P5** serve | **tool manifest** under 50 KB, and the drill-down tools answer correctly |

Three of six spike questions were **blocking** because each changed a v1 interface. Q4
(`routeFromHAR` concurrency) and Q5 (sweep yield) cannot be measured before their implementations
exist; Q6 (sourcemap census across real sites) gates nothing, but it does size the §1 degradation.

## 8. The MCP layering constraint

Adopted before any MCP code exists, because it costs nothing now and cannot be retrofitted (#8).

```
src/archive/      read an archive → plain data
src/serve/tools/  pure function: (archive, params) → result     ← every layer calls these
src/serve/mcp.ts  registration and error mapping. Nothing else.
```

Any behaviour that lands in `mcp.ts` becomes testable only through a live agent. Keeping it out
buys four layers for free: `bun test` calling the functions directly, a CLI harness, one real
client↔server round trip, and a static HTML **inspector** that shows how complete an archive is
*before* an agent reads it.

## 9. Scope

A lean v1 is roughly three weeks. A full one — SSIM ≥ 0.98 checkpoint gates, several motion
adapters, network audit, Windows CI — is nine to thirteen. **Lean was chosen, but the contracts
were adopted from the outset**, because contracts are what is expensive to change: everything in
§6, the identity scheme, archive and behavior-graph schemas versioned **separately**, retained raw
evidence, and an explicit `identity-unresolved`.

**Cut from v1:**

| Cut | Why it is safe to cut |
|---|---|
| Replaying the interaction transcript | **Record it** — that part is irreversible if skipped. Do not gate on replaying it |
| Auto-simulated clicks and hovers during the sweep | Blind interaction can navigate, submit, purchase, delete or log out. It is a separate product with its own consent model, not a small addition |
| Full frame ladders | Easing is read from the declaration — `getComputedTiming()`, `getKeyframes()`, GSAP's `ease`, the computed timing function — not sampled. Ladders verify the visual result, which is a weaker need |
| SPA route graphs | A second bounded context; not needed to prove fidelity |
| Canvas / WebGL semantics | No path to it that does not become its own project. Requires only that `TargetRef` can express an opaque target and an explicit semantic gap |
| Coverage pass | `Profiler` distorts timing; deferred with its own replay pass |
| Un-minification without a published map | Guesswork dressed as evidence |
| Concurrent replay contexts | An optimisation before there is anything to optimise |

## 10. Where this will slip

**The extract phase** — unanimously, across all four agents in the planning rounds. Detecting that
an animation *exists* is much easier than detecting what **triggers** it.

The review round sharpened why: **a listener inventory is not trigger causality.** Delegated
listeners live on a framework root, not on the animated element, so a point-in-time
`getEventListeners` result cannot prove which event invoked which callback and created which
animation. The behavior graph needs a causal chain — input/event → callback/source → animation
creation or style write — and that is a harder problem than enumeration.

## 11. Hard to reverse vs cheap to change

| Hard to reverse | Cheap to change |
|---|---|
| The identity scheme, including the fingerprint's attribute subset | Sweep thresholds |
| Archive directory layout and schema versioning | Snapshot property allowlist |
| Everything in §6 | Shortlist heuristics |
| `notFound:'abort'` as a contract | MCP tool names |
| The interaction transcript event format | Concurrency defaults |
| Sourcemaps fetched at capture only | Which library adapters exist |

## 12. Rejected in review — recorded so they are not re-proposed

| Proposal | Rejected because |
|---|---|
| A WebSocket/SSE mock layer | It weakens the HTTP abort contract, and a fake socket is a fabricated recording. Report the unsupported channel instead (§6.4) |
| Computed CSS path in the fingerprint | A structural path — already rejected in ADR 0002's alternatives, for the duplicate-sibling and delete-reinsert cases it cannot express |
| A heuristic AST un-minifier | It cannot recover an unpublished original filename and line. It produces an inferred symbol presented as a citation, which is worse than saying the map is absent |
| Global clock and RNG mocking, as a fix for identity | Both reviewers rejected the mechanism: `wa:` sequence drift is designed away by fingerprint reconciliation and proven by test. Freezing the clock also alters the animation being archived. Keep it as an optional per-page replay knob, and record the frozen value in `environment.json` when used |
<!-- lang:end -->

<!-- lang:th -->
# สถาปัตยกรรมของ pipeline — การออกแบบ และทำไมถึงเป็นแบบนี้

**สถานะ:** LIVING · **วันที่:** 2026-07-31 · **แก้ให้แข็งขึ้นล่าสุด:** 2026-07-31 (#21 หลังรอบรีวิวหลาย agent)

> **ไฟล์นี้เป็นเจ้าของการออกแบบและเหตุผล ไม่ได้เป็นเจ้าของสถานะ**
> อะไรเปิดอยู่ อะไรกั้นอะไร และต้องทำอะไรต่อ → **[`docs/OPEN-WORK-LEDGER.md`](../../OPEN-WORK-LEDGER.md)**
> การตัดสินใจรายข้อแบบเต็ม → **[`docs/adr/`](../../adr/README.md)**
> การตัดสินใจเหล่านั้นมาจากไหน → `Obsidian-CloneSpaceMcp/planning-provenance.md`

---

## 1. นิยามว่าเสร็จ

ไม่ใช่ "เซฟ HTML ได้" แต่คือลำดับนี้ **ตอนที่ตัดเน็ตออก**:

**capture** หน้าที่ใช้ GSAP หนัก → **replay** แล้วเห็น animation ทำงานจริง → **extract** ออกมาเป็น
**behavior graph** → **serve** ให้ agent ตอบว่า *"อะไรทำให้ hero ขยับ"* ได้ถูก

**การอ้างอิงลดระดับอย่างซื่อสัตย์** ที่ใดที่เว็บเผยแพร่ sourcemap ไว้และ capture ดึงมาได้ คำตอบจะอ้างไฟล์และบรรทัดต้นฉบับ
ที่ใดที่ไม่มี คำตอบจะอ้างตำแหน่งใน bundle บวก symbol ที่อนุมานเอา **และ archive ต้องบอกว่าเป็นกรณีไหน** (§6.4)
archive ที่รองรับการอ้างไฟล์และบรรทัดไม่ได้ ต้องรายงานเรื่องนั้น ไม่ใช่คืนของที่อ่านแล้วเหมือนหา animation ไม่เจอ
การเดาชื่อไฟล์ต้นฉบับไม่ใช่ทางถอย มันคือการอ้างอิงที่กุขึ้นมา

เกณฑ์ผ่านของทุกเฟสถูกตรวจกับ `test/fixtures/motion-site` ไม่ใช่กับหน้าเว็บจริง เพราะบนหน้าจริง
*"extractor เจอ animation 12 ตัว"* พิสูจน์ว่าผิดไม่ได้ — แยก 12 จาก 12 กับ 12 จาก 30 ไม่ออก
**fixture manifest** คือ **ground truth** ที่ทำให้เกณฑ์เหล่านั้นตรวจสอบได้

## 2. ข้อผูกพันที่รับน้ำหนักทั้งระบบ

**replay เปิด URL เดิม ด้วย HTML เดิม เพื่อให้ JavaScript ของหน้านั้นรันซ้ำ** archive ถูกเสิร์ฟผ่าน
`routeFromHAR(har, { notFound: 'abort' })`

**ปฏิเสธ: การ serialize DOM ที่ hydrate แล้วมาเป็นตัวตั้งต้นที่ execute ได้** มัน break hydration และ
entry animation ก็จบไปแล้วตั้งแต่ตอนถ่าย snapshot มันจึงไม่มีวันเล่นอีก ตอนวางแผน agent ฝ่ายที่เสนอวิธีนี้
ยอมรับผลลัพธ์เอง — *"Interactivity: Nonexistent"*

ผลที่ตามมาสองข้อ ซึ่งเป็นสัญญา ไม่ใช่ปุ่มปรับ:

- **`notFound: 'abort'` และมันครอบแค่ HTTP** request ที่หลุดออกเน็ตจริงจะวางยา extraction แบบเงียบๆ: archive
  จะดูเหมือนใช้ได้ ทั้งที่จริงมันพึ่งของที่ไม่ได้อยู่ในตัวมันเอง **`routeFromHAR` ไม่ดัก WebSocket**
  (นั่นคือ `routeWebSocket`) และไม่จำลองจังหวะของ stream แบบ SSE ดังนั้นตอนนี้ช่องทางเหล่านั้นจะวิ่งออกเน็ตจริง
  แทนที่จะ abort อย่างสะอาด ทางแก้**ไม่ใช่** mock layer — socket ปลอมคือการบันทึกที่กุขึ้น
  ทางแก้คือตรวจจับช่องทางนั้น ปฏิเสธที่จะอ้างความสมจริง และบอกไว้ใน capability flag ของ archive (§6.4)
- **`serviceWorkers: 'block'` ทั้งตอน capture และ replay** HAR routing ไม่ครอบ request ที่ service worker ดักไว้
  หน้าที่ service worker รับน้ำหนักอยู่ — การถอดรหัส asset, MSW, WASM ที่ route ผ่าน SW — จะเริ่มทำงานไม่ได้
  และนั่นคือ **ความไม่สามารถที่ถูกรายงาน** ไม่ใช่ความล้มเหลวแบบเงียบ

## 3. สี่ stage

ทั้งสี่แยกจากกันและมีลำดับ ไม่มีอันไหนที่เป็น "scraping" — ดู `UBIQUITOUS_LANGUAGE.md`

```
capture ──▶ archive ──▶ replay ──▶ extract ──▶ behavior graph ──▶ serve
   │                       ▲          │
   │                       └──────────┘
   │        extract ทำงานกับ replay ไม่ใช่ capture มันจึง deterministic
   │        และรันซ้ำได้โดยไม่ต้อง capture ใหม่
   │
   └─ sourcemap ต้องดึงตรงนี้ หน้าเว็บไม่เคยขอ `.map` เอง
      พลาดตอน capture = ไม่มีทางได้มันอีกเลย
```

| Stage | ทำอะไร | กฎที่ตกผลึกแล้ว |
|---|---|---|
| **capture** | Chromium แบบมีหน้าต่าง · `recordHar({mode:'full', content:'attach'})` · **sweep** แบบ adaptive · บันทึก **interaction transcript** · เก็บ HTML ต้นฉบับ, DOM ที่ serialize แล้ว, ภาพหน้าจอ, sourcemap · เขียน artifact ทุกอย่างใน §6 | ห้ามใช้ `waitUntil:'networkidle'` — หน้าที่มี analytics หรือ poll ไม่มีวันนิ่ง ใช้ **quiet window** ที่มีงบจำกัดชัดเจน (§6.10) |
| **replay** | `routeFromHAR(..., {notFound:'abort'})` เปิด URL เดิม ในสภาพแวดล้อมที่ตรึงไว้ (§6.2) | แยกตัวและออฟไลน์ การมี request หลุดออกไปเป็นศูนย์คือเกณฑ์ผ่าน/ไม่ผ่าน และทุกตัวที่เกิดขึ้นต้องถูกจัดหมวด (§6.5) |
| **extract** | animation พร้อมเป้าหมาย, trigger, timing, easing, ไลบรารี · computed style · CSS ที่แมตช์ · listener ที่ผูกไว้ · การถอด minify | ทำงานตอน replay จึงรันซ้ำได้ และเก็บหลักฐานดิบไว้เพื่อไม่ให้ extractor ที่ดีกว่าบังคับให้ capture ใหม่ |
| **serve** | MCP แบบ progressive disclosure: **tool manifest** ต่ำกว่า 50 KB แล้วค่อยเจาะลึก | ชั้น MCP ไม่เป็นเจ้าของ logic — ดู §8 |

## 4. Element identity — ฐานราก

การตัดสินใจฉบับเต็ม: **[ADR 0002](../../adr/0002-element-identity-wa-ids-with-fingerprint-reconciliation.md)**

ทุกอย่างที่อยู่ถัดไปอ้าง id เหล่านี้ มันจึงเป็นสิ่งที่พลาดแล้วแพงที่สุด

`wa:<frame-key>:<sequence>` กำหนดโดย **โมดูลที่ inject ตัวเดียวกัน** ทั้งตอน capture และทุกรอบ replay

**`wa:` id เป็น handle ภายในรอบเดียว ไม่ใช่กุญแจข้ามสองรอบ** replay สร้าง DOM ใหม่ด้วยการรัน JavaScript
ของหน้านั้นซ้ำ ตัวนับจึงไปหยุดที่อื่น มีแต่ **fingerprint** ที่ข้ามเส้นแบ่งระหว่างรอบได้ แล้ว **ตัวจับคู่**
ตัดสินที่เหลือ — แบบ **transitive** ผ่าน **โหนดแม่** ที่จับคู่ได้แล้ว ไม่ใช่ตามลำดับการปล่อยข้อมูล

**element ที่ระบุตัวไม่ได้ ต้องรายงานเป็น `identity-unresolved` ไม่ใช่เดา** ตัวจับคู่ ที่มั่นใจพอจะตอบเสมอ
จะตอบผิดกับเคสลบแล้วแทรกกลับ และคำตอบผิดนั้นกลายเป็นข้อมูล animation ที่โยงผิดตัวอีกสาม stage ถัดไป
โดยไม่เหลืออะไรให้ส่งสัญญาณเตือน

### implementation ปัจจุบันเปราะ (#20)

`fingerprintKey()` เอา `siblingOrdinal` และ `textHash` ไป join เป็นกุญแจ bucket ในฐานะส่วนประกอบ
**เงื่อนไขเท่ากัน** โหนดที่ไม่เกี่ยวข้องหนึ่งตัวแทรกอยู่เหนือเป้าหมายทำให้ลำดับของมันเลื่อน กุญแจจึงไม่ตรงอีก
และ element ที่มี **attribute** ไม่ซ้ำและไม่เปลี่ยน ถูกรายงานเป็น `missing` โดยไม่มี candidate เลย
ขณะที่โหนดที่มันควรจับคู่ด้วยกลับไปโผล่ใน `replayOnly` ผลลัพธ์ขัดแย้งกันเอง และบนหน้า framework
เรื่องนี้เกิดตลอดเวลา

หลักฐานที่เสถียรต้อง **สร้าง** candidate ส่วนลำดับและข้อความต้อง **จัดอันดับ** มัน กฎห้ามเดายังอยู่:
ผู้ชนะที่ชัดเจนจึงจับคู่ คะแนนเสมอยังคงเป็น `identity-unresolved` **frame key มีข้อบกพร่องเดียวกัน** —
มันใช้ลำดับการปรากฏในกลุ่มพี่น้องที่ URL เดียวกัน เฟรม `about:blank`, `srcdoc` หรือ widget ที่ซ้ำกัน
ซึ่งสลับลำดับ จะสลับ namespace กันเงียบๆ

### เป้าหมายของ animation ไม่ได้เป็น Element เสมอ

pseudo-element, SVG, CSS custom property, `window`/`document`, JS object ธรรมดา และ graphics resource
ตั้งชื่อด้วย handle แบบ `wa:` ไม่ได้ behavior graph จึงต้องมี **`TargetRef` แบบ union ที่มี version** —
element · pseudo-element · document · JS object · graphics resource · opaque — ตัดสินก่อนที่ schema
ของ graph จะออกไป เพราะการขยายมันทีหลังทำให้ graph ทุกอันที่ผลิตไปแล้วใช้ไม่ได้

## 5. กฎ performance

**วัดมาแล้ว** — จาก `docs/reports/2026-07-30-cdp-spike.md` วัดกับ fixture:

| กฎ | หลักฐาน |
|---|---|
| เรียก `getEventListeners({depth:-1, pierce:true})` ครั้งเดียวต่อหนึ่ง target พอ ไม่ต้องไปกลับทีละโหนด | `pierce:false` → click listener 2 ตัว, `pierce:true` → 4 ตัว ผลต่างพอดี +2 ตรงกับ shadow root และ iframe |
| ไม่ต้องมี allowlist ของ computed property ใน v1 | `DOMSnapshot.captureSnapshot` กับ 40 property: **1.381 MB ที่ 6160 โหนด** ส่วนเพิ่ม 237 ไบต์ต่อโหนด → ราว 0.7 MB ที่ 3000 |
| CDP อ่าน stylesheet ข้าม origin ที่หน้าเว็บอ่านไม่ได้ | ในหน้าเว็บโยน `SecurityError` แต่ `CSS.getStyleSheetText` คืน 593 ไบต์ **ขอบเขต:** เฉพาะ sheet ที่ link แบบคลาสสิก ส่วน `adoptedStyleSheets` และ constructed CSSOM เป็นคนละทางและยังไม่ได้ทดสอบ |

**ถกกันมา ยังไม่ได้วัด** — เป็นเจตนาการออกแบบจนกว่าจะมี implementation:

- ดึง DOM และ computed style เป็นก้อนด้วย `DOMSnapshot.captureSnapshot` · จัดกลุ่มด้วย
  `DOM.pushNodesByBackendIdsToFrontend` · สงวน `CSS.getMatchedStylesForNode` ไว้ให้ shortlist 60–200 โหนด
- trace ในหน้าที่มีปริมาณสูงสะสมบน `window.__x` — **แบบมีขอบเขต** ไม่ใช่อ่านครั้งเดียวแบบไม่จำกัด (§6.7)
  และไม่ใช่ `Runtime.addBinding` ต่อหนึ่ง event
- sweep แบบ adaptive: เลื่อนทีละ 0.75–0.9 viewport, รอ 2 rAF + 40–100 ms, ต่อเวลาเมื่อมีความเคลื่อนไหวใหม่,
  หยุดหลังจุดตรวจว่างติดกัน 3 ครั้ง · เพิ่มตำแหน่งจาก `ScrollTrigger.getAll()` และกลุ่มเป้าหมายของ
  `IntersectionObserver` **การเลื่อนระดับ window อย่างเดียวไม่พอ** — scroller ที่ซ้อนกันและแนวนอน
  โหลดเมื่อ container ของตัวเองเลื่อนเท่านั้น (§6.11)
- `Profiler.startPreciseCoverage` ทำให้ timing เพี้ยน ต้องมีรอบ replay ของตัวเอง

## 6. สัญญาของ archive

พบในรอบรีวิว 2026-07-31 **ทุกข้อเปลี่ยนสิ่งที่ capture run ต้องเขียนออกมา** แต่ละข้อจึงฟรีถ้าระบุตอนนี้
และบังคับให้ต้อง capture archive ที่มีอยู่ทั้งหมดใหม่ถ้าเพิ่มทีหลัง ความไม่สมมาตรนี้คือเหตุผลทั้งหมด
ที่มันอยู่ตรงนี้ก่อน P2 แทนที่จะอยู่ใน backlog

| # | สัญญา | ทำไมแก้ทีหลังถึงแพง |
|---|---|---|
| 6.1 | **นโยบาย redact** `content:'attach'` เก็บ `Authorization` header, cookie และ request body | archive ที่ทำ credential หลุดไปแล้ว เรียกคืนไม่ได้ `codex` จัดเป็นอันดับหนึ่ง |
| 6.2 | **`environment.json`** — viewport, devicePixelRatio, locale, timezone, `prefers-reduced-motion`, `prefers-color-scheme`, UA และเวอร์ชันเบราว์เซอร์, สภาพแวดล้อมฟอนต์, storage ที่แยกตาม origin | แต่ละข้อเปลี่ยน DOM ที่ถูกสร้าง การ replay ที่ไม่ตรึงค่าเหล่านี้คือการจับคู่หน้าสองหน้าที่ต่างกัน แล้วไปโทษ ตัวจับคู่ |
| 6.3 | **ความสอดคล้องของ checkpoint** — ทุก artifact พก `checkpointId`, epoch ของ frame/document และ timestamp แบบ monotonic | `DOMSnapshot`, listener, state ของไลบรารี, style และภาพหน้าจอเป็น probe คนละตัวที่เก็บขณะหน้ายัง mutate ถ้าไม่มี epoch archive จะบรรยายหน้าที่ไม่เคยมีอยู่จริงได้ และไม่มีอะไรข้างหลังตรวจจับได้ |
| 6.4 | **capability flag** — **ส่งแล้ว** ในรูป `capabilities.json` (ADR 0006, #59–#64): `serviceWorkerDependent` · `webSocketDependent` · `closedShadowRootPresent` · `sourcemapDeclared` แต่ละตัวเป็น tri-state เปลี่ยนชื่อจาก *ไม่มี sourcemap* ซึ่งเป็นคำพูดเรื่อ archive ไม่ใช่หน้าเว็บ **OOPIF ย้ายไป §6.9** ซึ่งเป็นเจ้าของบัญชีรายชื่อ target และต้องมี CDP session ระดับ browser ที่ `captureHar` ไม่มี | ถ้าไม่มี `extract` จะคืน graph ว่างที่อ่านแล้วเหมือนสำเร็จ การเพิ่มทีหลังจาก tool manifest ออกไปแล้วทำให้ผู้ใช้ทุกรายพัง |
| 6.5 | **การ normalize request และการจัดหมวด request ที่ไม่คาดคิด** — PRD #84: capture บันทึก volatile-query-key policy แบบ explicit ที่ default เป็นว่าง; `network.har` ยังคงเป็น request source of truth เพียงตัวเดียว; replay สร้าง index ใน memory ถ้ามี normalized match ที่ unique อาจ rewrite เข้า `routeFromHAR`; ความกำกวม, POST body ที่ถูก redact หรือไม่มี candidate ต้อง abort และถูกจัดหมวด ต้องพิสูจน์ path ของ Playwright ที่ pin ไว้ก่อน implementation (#85 / ADR 0007) | Playwright จับคู่ HAR แบบเข้มด้วย URL และ method และเปรียบเทียบ POST body ดังนั้น nonce หรือ timestamp ทำให้ request ที่เป็นตัวเดียวกันในเชิงตรรกะถูก abort ส่วนการเดา volatile key ที่กว้างอาจส่ง response ผิด การใส่ policy ย้อนหลังไม่ว่าแบบไหนก็เปลี่ยนว่า replay ได้รับอนุญาตให้เลือก archived response ตัวใด |
| 6.6 | **`TargetRef` แบบ union ที่มี version** (§4) | การขยายชนิดของเป้าหมายทำให้ behavior graph ทุกอันที่ผลิตไปแล้วใช้ไม่ได้ |
| 6.7 | **trace ที่มีขอบเขต** — จำกัดไบต์และ event, chunk ที่มีเลขลำดับส่งไปยัง host, backpressure, **ตัวนับ event ที่ถูกทิ้ง** อย่างชัดเจน | buffer แบบไม่จำกัดทำให้ renderer หมดหน่วยความจำ ส่วน ring buffer แบบเงียบยิ่งแย่กว่า มันทำลายหลักฐานโดยไม่บอก และการสูญหายนั้นตรวจย้อนไม่ได้ |
| 6.8 | **ความสมบูรณ์แบบ transaction** — เขียนลงที่ชั่วคราว, hash artifact, บันทึกเวอร์ชันของผู้ผลิตและ schema, เผยแพร่ commit marker หลังตรวจผ่านเท่านั้น | มิฉะนั้นการพังกลาง capture จะทิ้งของที่อ่านแล้วดูเหมือนสมบูรณ์ |
| 6.9 | **บัญชีรายชื่อ target** — OOPIF, popup, worker แบบ dedicated และ shared, worklet พร้อม epoch ของ attach/detach/navigate | ผัง archive ต้องรองรับหลาย target ตั้งแต่แรก การไปยัดเข้ากับรูปแบบเอกสารเดียวคือการเขียนใหม่ |
| 6.10 | **งบสิ้นสุดของ capture** — งบเวลาจริง ไบต์ จำนวนโหนด ความสูง และ event บวกเหตุผลของ `capture-incomplete` | infinite scroll และการ poll ยืด quiet window ไปได้ไม่รู้จบ ถ้าไม่มีเหตุผลบันทึกไว้ capture ที่ถูกตัดจบจะแยกไม่ออกจากอันที่สมบูรณ์ |
| 6.11 | **transcript บันทึก scroll container ของมัน** ไม่ใช่แค่พิกัดระดับหน้า | scroller ที่ซ้อนกันและแนวนอนแสดงออกด้วยวิธีอื่นไม่ได้ และรูปแบบของ transcript ย้อนกลับยาก (§11) |

## 7. เกณฑ์ผ่าน

นิยามว่าเสร็จของแต่ละเฟส **สถานะอยู่ใน ledger**

| เฟส | ผ่านเมื่อ |
|---|---|
| **P0** fixture + spike ที่บล็อก | fixture เสิร์ฟได้และประกาศเนื้อหาตัวเอง · Q1–Q3 ตอบพร้อมตัวเลขที่วัดได้ |
| **P1** element identity | จับคู่ id ได้ **100%** ข้าม capture→replay บน fixture ครบเคสยากของ identity ทั้งห้า **และ** เคสความเปราะใน #20 |
| **P2** capture | artifact ครบทุกอย่าง รวมถึงทุกสัญญาใน §6 |
| **P3** replay | ตัดเน็ต · request ที่หลุดออกไปเป็นศูนย์ และทุกตัวถูกจัดหมวด · animation ทำงาน |
| **P4** extract | เจอ animation ครบทุกตัวที่ **fixture manifest** ประกาศไว้ |
| **P5** serve | **tool manifest** ต่ำกว่า 50 KB และ drill-down tool ตอบถูก |

spike question สามในหกข้อ **บล็อก** เพราะแต่ละข้อเปลี่ยน interface ของ v1 ส่วน Q4 (`routeFromHAR`
concurrency) และ Q5 (ผลของ sweep) วัดไม่ได้ก่อนที่ implementation ของมันจะมีอยู่ ส่วน Q6 (สำรวจ sourcemap
บนเว็บจริง) ไม่ได้กั้นอะไร แต่มันบอกขนาดของการลดระดับใน §1

## 8. ข้อบังคับเรื่อง layering ของ MCP

รับมาก่อนที่จะมีโค้ด MCP สักบรรทัด เพราะตอนนี้ไม่มีต้นทุน และเติมทีหลังไม่ได้ (#8)

```
src/archive/      อ่าน archive → ข้อมูลดิบ
src/serve/tools/  pure function: (archive, params) → result     ← ทุกชั้นเรียกตรงนี้
src/serve/mcp.ts  ลงทะเบียนและแปลง error เท่านั้น ไม่มีอย่างอื่น
```

พฤติกรรมใดก็ตามที่ไปตกอยู่ใน `mcp.ts` จะทดสอบได้ทางเดียวคือผ่าน agent จริง การกันมันออกไปทำให้ได้สี่ชั้น
มาฟรีๆ: `bun test` เรียกฟังก์ชันตรงๆ, CLI harness, การวิ่ง client↔server ครบรอบจริงหนึ่งครั้ง และ
**inspector** หน้า HTML แบบ static ที่แสดงว่า archive สมบูรณ์แค่ไหน *ก่อน* ที่ agent จะอ่าน

## 9. ขอบเขต

v1 แบบ lean ใช้เวลาราวสามสัปดาห์ ส่วนแบบเต็ม — เกณฑ์จุดตรวจ SSIM ≥ 0.98, motion adapter หลายตัว,
การตรวจ network, CI บน Windows — ใช้เก้าถึงสิบสามสัปดาห์ **เลือกแบบ lean แต่รับสัญญาไว้ตั้งแต่ต้น**
เพราะสัญญาคือของที่แก้ทีหลังแพง: ทุกอย่างใน §6, ระบบ identity, การทำ version ของ archive schema
และ behavior graph schema **แยกกัน**, การเก็บหลักฐานดิบไว้ และการมี `identity-unresolved` อย่างชัดเจน

**ตัดออกจาก v1:**

| ตัดอะไร | ทำไมตัดได้ปลอดภัย |
|---|---|
| การเล่น interaction transcript ซ้ำ | **บันทึกมันไว้** — ส่วนนั้นข้ามแล้วย้อนไม่ได้ แต่ไม่ต้องเอาการเล่นซ้ำมาเป็นเกณฑ์ |
| การจำลอง click และ hover อัตโนมัติระหว่าง sweep | การกดแบบไม่รู้ปลายทางอาจพาไปหน้าอื่น ส่งฟอร์ม สั่งซื้อ ลบข้อมูล หรือออกจากระบบ มันเป็นผลิตภัณฑ์แยกที่มีเรื่องความยินยอมของตัวเอง ไม่ใช่ส่วนเสริมเล็กๆ |
| frame ladder แบบเต็ม | easing อ่านได้จากการประกาศ — `getComputedTiming()`, `getKeyframes()`, `ease` ของ GSAP, computed timing function — ไม่ใช่จากการสุ่มเฟรม ladder มีไว้ยืนยันผลทางสายตา ซึ่งเป็นความจำเป็นที่อ่อนกว่า |
| SPA route graph | เป็น bounded context ที่สอง ไม่จำเป็นต่อการพิสูจน์ความสมจริง |
| ความหมายของ canvas / WebGL | ไม่มีทางเข้าถึงมันโดยไม่กลายเป็นโปรเจกต์ของตัวเอง ต้องการเพียงให้ `TargetRef` แสดงเป้าหมายแบบ opaque และช่องว่างเชิงความหมายได้ |
| coverage pass | `Profiler` ทำ timing เพี้ยน เลื่อนไปพร้อมรอบ replay ของตัวเอง |
| การถอด minify โดยไม่มี map ที่เผยแพร่ | การเดาที่แต่งตัวเป็นหลักฐาน |
| replay context พร้อมกันหลายตัว | การ optimize ก่อนที่จะมีอะไรให้ optimize |

## 10. จุดที่ตารางเวลาจะบาน

**เฟส extract** — agent ทั้งสี่ตัวในรอบวางแผนเห็นตรงกันหมด การตรวจว่ามี animation *อยู่* ง่ายกว่าการตรวจว่า
**อะไรเป็นตัว trigger** มาก

รอบรีวิวทำให้เห็นชัดขึ้นว่าทำไม: **บัญชี listener ไม่ใช่ความเป็นเหตุเป็นผลของ trigger** listener แบบ delegate
อยู่ที่ root ของ framework ไม่ใช่ที่ element ที่ขยับ ผลของ `getEventListeners` ณ จุดเวลาหนึ่งจึงพิสูจน์ไม่ได้ว่า
event ไหนเรียก callback ไหนแล้วสร้าง animation ไหน behavior graph ต้องการห่วงโซ่เชิงเหตุผล —
input/event → callback/source → การสร้าง animation หรือการเขียน style — ซึ่งเป็นปัญหาที่ยากกว่าการไล่รายชื่อ

## 11. ของที่ย้อนยาก เทียบกับของที่แก้ง่าย

| ย้อนยาก | แก้ง่าย |
|---|---|
| ระบบ identity รวมถึงชุด attribute ของ fingerprint | ค่า threshold ของ sweep |
| ผังโฟลเดอร์ของ archive และการทำ version ของ schema | allowlist ของ property ใน snapshot |
| ทุกอย่างใน §6 | heuristic ของ shortlist |
| `notFound:'abort'` ในฐานะสัญญา | ชื่อ tool ของ MCP |
| รูปแบบ event ของ interaction transcript | ค่า concurrency เริ่มต้น |
| การดึง sourcemap เฉพาะตอน capture | มี adapter ของไลบรารีไหนบ้าง |

## 12. ปฏิเสธในรอบรีวิว บันทึกไว้เพื่อไม่ให้ถูกเสนอกลับมาอีก

| ข้อเสนอ | ปฏิเสธเพราะ |
|---|---|
| mock layer สำหรับ WebSocket/SSE | มันทำให้สัญญา abort ของ HTTP อ่อนลง และ socket ปลอมคือการบันทึกที่กุขึ้น ให้รายงานว่าช่องทางนั้นไม่รองรับแทน (§6.4) |
| computed CSS path ใน fingerprint | เป็น structural path ซึ่งถูกปฏิเสธไปแล้วในหัวข้อ alternatives ของ ADR 0002 เพราะเคส sibling ที่ซ้ำกันและเคสลบแล้วแทรกกลับที่มันแสดงออกไม่ได้ |
| ตัวถอด minify ด้วย AST แบบ heuristic | มันกู้ชื่อไฟล์และบรรทัดต้นฉบับที่ไม่ได้เผยแพร่ไม่ได้ มันผลิต symbol ที่อนุมานเอาแล้วเสนอเป็นการอ้างอิง ซึ่งแย่กว่าการบอกตรงๆ ว่าไม่มี map |
| การ mock clock และ RNG แบบทั่วทั้งระบบ ในฐานะทางแก้เรื่อง identity | ผู้รีวิวทั้งสองปฏิเสธกลไกนี้: การเลื่อนของ `wa:` sequence ถูกออกแบบให้ไม่มีผลด้วยการจับคู่ด้วย fingerprint และมี test พิสูจน์แล้ว การ freeze นาฬิกายังเปลี่ยน animation ที่กำลัง archive อยู่ด้วย เก็บไว้เป็นปุ่มของ replay ต่อหน้าเว็บแบบเลือกใช้ และถ้าใช้ต้องบันทึกค่าที่ freeze ไว้ใน `environment.json` |
<!-- lang:end -->
