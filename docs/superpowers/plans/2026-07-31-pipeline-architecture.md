<!-- lang:en -->
# Pipeline architecture — the design and why it is this way

**Status:** LIVING · **Date:** 2026-07-31

> **This file owns design and reasoning. It does not own status.**
> For what is open, what gates what, and what to do next → **[`docs/OPEN-WORK-LEDGER.md`](../../OPEN-WORK-LEDGER.md)**.
> For a single decision in full → **[`docs/adr/`](../../adr/README.md)**.
> For where the decisions came from → `Obsidian-CloneSpaceMcp/planning-provenance.md`.

---

## 1. Definition of done

Not "the HTML was saved". This sequence, **with the network disconnected**:

**capture** a GSAP-heavy page → **replay** it and watch the motion actually run → **extract** a
**behavior graph** → **serve** it and have an agent answer *"what makes the hero move?"* correctly,
citing file and line.

Every phase's exit criterion is checked against `test/fixtures/motion-site`, never against a real
page. On a real page *"the extractor found 12 animations"* is unfalsifiable — 12-of-12 and
12-of-30 are indistinguishable. The **fixture manifest** is the **ground truth** that makes the
criteria checkable.

## 2. The load-bearing commitment

**Replay navigates the original URL, with the original document HTML, so the page's own
JavaScript re-executes.**

The archive is served through `routeFromHAR(har, { notFound: 'abort' })`.

**Rejected: serializing the hydrated DOM as the executable bootstrap.** It breaks hydration, and
entry animations have already finished by the time a snapshot is taken, so they never play. During
planning the agents arguing for it conceded the outcome themselves — *"Interactivity: Nonexistent"*.

Two consequences that are contracts, not knobs:

- **`notFound: 'abort'`.** A request that leaks to the live network silently poisons extraction:
  the archive appears to work while depending on something it does not contain.
- **`serviceWorkers: 'block'` at both capture and replay.** HAR routing does not cover requests a
  service worker intercepts.

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
| **capture** | Headful Chromium · `recordHar({mode:'full', content:'attach'})` · adaptive **sweep** · records an **interaction transcript** · saves original HTML, serialized DOM, screenshots, sourcemaps | No `waitUntil:'networkidle'` — an analytics or polling page never settles. Use a **quiet window** instead |
| **replay** | `routeFromHAR(..., {notFound:'abort'})`, navigate the original URL | Isolated and offline. Zero unexpected requests is a pass/fail criterion, not a goal |
| **extract** | Animations with target, trigger, timing, easing, library · computed styles · matched CSS · bound listeners · un-minification · frame ladders | Runs at replay time so it is re-runnable; raw evidence is retained so a better extractor never forces a re-capture |
| **serve** | MCP with progressive disclosure: a **tool manifest** under 50 KB, then drill-down | The MCP layer owns no logic — see §7 |

## 4. Element identity — the foundation

Full decision: **[ADR 0002](../../adr/0002-element-identity-wa-ids-with-fingerprint-reconciliation.md)**.

Everything downstream references these ids, so this is the most expensive thing to get wrong: the
**behavior graph**, screenshots, styles, and every capture-to-replay comparison.

`wa:<frame-key>:<sequence>`, assigned by **the same injected module** on capture and on every
replay pass.

**A `wa:` id is a handle within one run, never a key across two.** Replay rebuilds the DOM by
re-executing the page's JavaScript, so the counter lands elsewhere. Only a **fingerprint** crosses
the run boundary, and the **ตัวจับคู่** decides the rest — **transitive** through matched
**โหนดแม่**, never by emission order.

**An element that cannot be identified is reported as `identity-unresolved`, never guessed.** A
ตัวจับคู่ confident enough to always answer answers wrongly for delete-and-reinsert, and that wrong
answer becomes mis-attributed animation data three stages later with nothing left to signal it.

## 5. Performance rules

**Measured** — from `docs/reports/2026-07-30-cdp-spike.md`, against the fixture:

| Rule | Evidence |
|---|---|
| One `getEventListeners({depth:-1, pierce:true})` per target is enough; no per-node round-trips | `pierce:false` → 2 click listeners, `pierce:true` → 4. Gain of exactly +2, matching the shadow root and the iframe |
| No computed-property allowlist needed in v1 | `DOMSnapshot.captureSnapshot` with 40 properties: **1.381 MB at 6160 nodes**, 237 B/node marginal → ~0.7 MB at 3000 |
| CDP can read a cross-origin stylesheet the page cannot | `SecurityError` in-page; 593 bytes returned through `CSS.getStyleSheetText` |

**Argued, not yet measured** — treat as design intent until an implementation exists:

- Bulk DOM and computed styles via `DOMSnapshot.captureSnapshot`; batch with
  `DOM.pushNodesByBackendIdsToFrontend`; reserve `CSS.getMatchedStylesForNode` for a 60–200 node
  shortlist.
- High-volume in-page traces accumulate on `window.__x` and are read **once** — not
  `Runtime.addBinding` per event.
- Adaptive sweep: advance 0.75–0.9 viewport, wait 2 rAF + 40–100 ms, extend on new activity, stop
  after 3 consecutive empty checkpoints; add positions from `ScrollTrigger.getAll()` and clustered
  `IntersectionObserver` targets.
- `Profiler.startPreciseCoverage` distorts timing and needs its own replay pass.

## 6. Exit criteria

The definition of done per phase. **Status lives in the ledger.**

| Phase | Passes when |
|---|---|
| **P0** fixture + blocking spikes | The fixture serves and declares its contents; Q1–Q3 answered with measured numbers |
| **P1** element identity | **100%** id reconciliation across capture→replay on the fixture, covering all five identity hard cases |
| **P2** capture | All artifacts present, plus the interaction transcript and sourcemaps |
| **P3** replay | Network off · zero unexpected requests · motion runs |
| **P4** extract | Finds every animation the **fixture manifest** declares |
| **P5** serve | **tool manifest** under 50 KB, and the drill-down tools answer correctly |

Three of six spike questions were **blocking** because each changed a v1 interface. Q4
(`routeFromHAR` concurrency) and Q5 (sweep yield) cannot be measured before their implementations
exist; Q6 (sourcemap census across real sites) gates nothing.

## 7. The MCP layering constraint

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

## 8. Scope

A lean v1 is roughly three weeks. A full one — SSIM ≥ 0.98 checkpoint gates, several motion
adapters, network audit, Windows CI — is nine to thirteen. **Lean was chosen, but the contracts
were adopted from the outset**, because contracts are what is expensive to change: the identity
scheme, archive and behavior-graph schemas versioned **separately**, retained raw evidence, and an
explicit `identity-unresolved`.

**Cut from v1:**

| Cut | Why it is safe to cut |
|---|---|
| Replaying the interaction transcript | **Record it** — that part is irreversible if skipped. Do not gate on replaying it |
| Full frame ladders | A before/after pair is enough |
| SPA route graphs | A second bounded context; not needed to prove fidelity |
| Canvas / WebGL semantics | No path to it that does not become its own project |
| Coverage pass | `Profiler` distorts timing; deferred with its own replay pass |
| Un-minification without a published map | Guesswork dressed as evidence |
| Concurrent replay contexts | An optimisation before there is anything to optimise |

## 9. Where this will slip

**The extract phase** — unanimously, across all four agents in the planning rounds. Detecting that
an animation *exists* is much easier than detecting what **triggers** it, and GSAP/ScrollTrigger
state has to be interrogated through library-specific hooks rather than read off the DOM.

## 10. Hard to reverse vs cheap to change

| Hard to reverse | Cheap to change |
|---|---|
| The identity scheme | Sweep thresholds |
| Archive directory layout and schema versioning | Snapshot property allowlist |
| `notFound:'abort'` as a contract | Shortlist heuristics |
| The interaction transcript event format | MCP tool names |
| Sourcemaps fetched at capture only | Concurrency defaults |
<!-- lang:end -->

<!-- lang:th -->
# สถาปัตยกรรมของ pipeline — การออกแบบ และทำไมถึงเป็นแบบนี้

**สถานะ:** LIVING · **วันที่:** 2026-07-31

> **ไฟล์นี้เป็นเจ้าของการออกแบบและเหตุผล ไม่ได้เป็นเจ้าของสถานะ**
> อะไรเปิดอยู่ อะไรกั้นอะไร และต้องทำอะไรต่อ → **[`docs/OPEN-WORK-LEDGER.md`](../../OPEN-WORK-LEDGER.md)**
> การตัดสินใจรายข้อแบบเต็ม → **[`docs/adr/`](../../adr/README.md)**
> การตัดสินใจเหล่านั้นมาจากไหน → `Obsidian-CloneSpaceMcp/planning-provenance.md`

---

## 1. นิยามว่าเสร็จ

ไม่ใช่ "เซฟ HTML ได้" แต่คือลำดับนี้ **ตอนที่ตัดเน็ตออก**:

**capture** หน้าที่ใช้ GSAP หนัก → **replay** แล้วเห็น animation ทำงานจริง → **extract** ออกมาเป็น
**behavior graph** → **serve** ให้ agent ตอบว่า *"อะไรทำให้ hero ขยับ"* ได้ถูก พร้อมอ้างไฟล์และบรรทัด

เกณฑ์ผ่านของทุกเฟสถูกตรวจกับ `test/fixtures/motion-site` ไม่ใช่กับหน้าเว็บจริง เพราะบนหน้าจริง
*"extractor เจอ animation 12 ตัว"* พิสูจน์ว่าผิดไม่ได้ — แยก 12 จาก 12 กับ 12 จาก 30 ไม่ออก
**fixture manifest** คือ **ground truth** ที่ทำให้เกณฑ์เหล่านั้นตรวจสอบได้

## 2. ข้อผูกพันที่รับน้ำหนักทั้งระบบ

**replay เปิด URL เดิม ด้วย HTML เดิม เพื่อให้ JavaScript ของหน้านั้นรันซ้ำ**

archive ถูกเสิร์ฟผ่าน `routeFromHAR(har, { notFound: 'abort' })`

**ปฏิเสธ: การ serialize DOM ที่ hydrate แล้วมาเป็นตัวตั้งต้นที่ execute ได้** มัน break hydration และ
entry animation ก็จบไปแล้วตั้งแต่ตอนถ่าย snapshot มันจึงไม่มีวันเล่นอีก ตอนวางแผน agent ฝ่ายที่เสนอวิธีนี้
ยอมรับผลลัพธ์เอง — *"Interactivity: Nonexistent"*

ผลที่ตามมาสองข้อ ซึ่งเป็นสัญญา ไม่ใช่ปุ่มปรับ:

- **`notFound: 'abort'`** request ที่หลุดออกเน็ตจริงจะวางยา extraction แบบเงียบๆ: archive จะดูเหมือนใช้ได้
  ทั้งที่จริงมันพึ่งของที่ไม่ได้อยู่ในตัวมันเอง
- **`serviceWorkers: 'block'` ทั้งตอน capture และ replay** HAR routing ไม่ครอบ request ที่ service worker ดักไว้

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
| **capture** | Chromium แบบมีหน้าต่าง · `recordHar({mode:'full', content:'attach'})` · **sweep** แบบ adaptive · บันทึก **interaction transcript** · เก็บ HTML ต้นฉบับ, DOM ที่ serialize แล้ว, ภาพหน้าจอ, sourcemap | ห้ามใช้ `waitUntil:'networkidle'` — หน้าที่มี analytics หรือ poll ไม่มีวันนิ่ง ใช้ **quiet window** แทน |
| **replay** | `routeFromHAR(..., {notFound:'abort'})` เปิด URL เดิม | แยกตัวและออฟไลน์ การมี request หลุดออกไปเป็นศูนย์คือเกณฑ์ผ่าน/ไม่ผ่าน ไม่ใช่เป้าหมาย |
| **extract** | animation พร้อมเป้าหมาย, trigger, timing, easing, ไลบรารี · computed style · CSS ที่แมตช์ · listener ที่ผูกไว้ · การถอด minify · frame ladder | ทำงานตอน replay จึงรันซ้ำได้ และเก็บหลักฐานดิบไว้เพื่อไม่ให้ extractor ที่ดีกว่าบังคับให้ capture ใหม่ |
| **serve** | MCP แบบ progressive disclosure: **tool manifest** ต่ำกว่า 50 KB แล้วค่อยเจาะลึก | ชั้น MCP ไม่เป็นเจ้าของ logic — ดู §7 |

## 4. Element identity — ฐานราก

การตัดสินใจฉบับเต็ม: **[ADR 0002](../../adr/0002-element-identity-wa-ids-with-fingerprint-reconciliation.md)**

ทุกอย่างที่อยู่ถัดไปอ้าง id เหล่านี้ มันจึงเป็นสิ่งที่พลาดแล้วแพงที่สุด — ทั้ง **behavior graph**, ภาพหน้าจอ,
style และการเทียบ capture กับ replay ทุกครั้ง

`wa:<frame-key>:<sequence>` กำหนดโดย **โมดูลที่ inject ตัวเดียวกัน** ทั้งตอน capture และทุกรอบ replay

**`wa:` id เป็น handle ภายในรอบเดียว ไม่ใช่กุญแจข้ามสองรอบ** replay สร้าง DOM ใหม่ด้วยการรัน JavaScript
ของหน้านั้นซ้ำ ตัวนับจึงไปหยุดที่อื่น มีแต่ **fingerprint** ที่ข้ามเส้นแบ่งระหว่างรอบได้ แล้ว **ตัวจับคู่**
ตัดสินที่เหลือ — แบบ **transitive** ผ่าน **โหนดแม่** ที่จับคู่ได้แล้ว ไม่ใช่ตามลำดับการปล่อยข้อมูล

**element ที่ระบุตัวไม่ได้ ต้องรายงานเป็น `identity-unresolved` ไม่ใช่เดา** ตัวจับคู่ ที่มั่นใจพอจะตอบเสมอ
จะตอบผิดกับเคสลบแล้วแทรกกลับ และคำตอบผิดนั้นกลายเป็นข้อมูล animation ที่โยงผิดตัวอีกสาม stage ถัดไป
โดยไม่เหลืออะไรให้ส่งสัญญาณเตือน

## 5. กฎ performance

**วัดมาแล้ว** — จาก `docs/reports/2026-07-30-cdp-spike.md` วัดกับ fixture:

| กฎ | หลักฐาน |
|---|---|
| เรียก `getEventListeners({depth:-1, pierce:true})` ครั้งเดียวต่อหนึ่ง target พอ ไม่ต้องไปกลับทีละโหนด | `pierce:false` → click listener 2 ตัว, `pierce:true` → 4 ตัว ผลต่างพอดี +2 ตรงกับ shadow root และ iframe |
| ไม่ต้องมี allowlist ของ computed property ใน v1 | `DOMSnapshot.captureSnapshot` กับ 40 property: **1.381 MB ที่ 6160 โหนด** ส่วนเพิ่ม 237 ไบต์ต่อโหนด → ราว 0.7 MB ที่ 3000 |
| CDP อ่าน stylesheet ข้าม origin ที่หน้าเว็บอ่านไม่ได้ | ในหน้าเว็บโยน `SecurityError` แต่ `CSS.getStyleSheetText` คืน 593 ไบต์ |

**ถกกันมา ยังไม่ได้วัด** — ถือเป็นเจตนาการออกแบบจนกว่าจะมี implementation:

- ดึง DOM และ computed style เป็นก้อนด้วย `DOMSnapshot.captureSnapshot` · จัดกลุ่มด้วย
  `DOM.pushNodesByBackendIdsToFrontend` · สงวน `CSS.getMatchedStylesForNode` ไว้ให้ shortlist 60–200 โหนด
- trace ในหน้าที่มีปริมาณสูงให้สะสมไว้บน `window.__x` แล้วอ่าน **ครั้งเดียว** ไม่ใช่ `Runtime.addBinding`
  ต่อหนึ่ง event
- sweep แบบ adaptive: เลื่อนทีละ 0.75–0.9 viewport, รอ 2 rAF + 40–100 ms, ต่อเวลาเมื่อมีความเคลื่อนไหวใหม่,
  หยุดหลังจุดตรวจว่างติดกัน 3 ครั้ง · เพิ่มตำแหน่งจาก `ScrollTrigger.getAll()` และกลุ่มเป้าหมายของ
  `IntersectionObserver`
- `Profiler.startPreciseCoverage` ทำให้ timing เพี้ยน ต้องมีรอบ replay ของตัวเอง

## 6. เกณฑ์ผ่าน

นิยามว่าเสร็จของแต่ละเฟส **สถานะอยู่ใน ledger**

| เฟส | ผ่านเมื่อ |
|---|---|
| **P0** fixture + spike ที่บล็อก | fixture เสิร์ฟได้และประกาศเนื้อหาตัวเอง · Q1–Q3 ตอบพร้อมตัวเลขที่วัดได้ |
| **P1** element identity | จับคู่ id ได้ **100%** ข้าม capture→replay บน fixture ครบเคสยากของ identity ทั้งห้า |
| **P2** capture | artifact ครบทุกอย่าง บวก interaction transcript และ sourcemap |
| **P3** replay | ตัดเน็ต · request ที่หลุดออกไปเป็นศูนย์ · animation ทำงาน |
| **P4** extract | เจอ animation ครบทุกตัวที่ **fixture manifest** ประกาศไว้ |
| **P5** serve | **tool manifest** ต่ำกว่า 50 KB และ drill-down tool ตอบถูก |

spike question สามในหกข้อ **บล็อก** เพราะแต่ละข้อเปลี่ยน interface ของ v1 ส่วน Q4 (`routeFromHAR`
concurrency) และ Q5 (ผลของ sweep) วัดไม่ได้ก่อนที่ implementation ของมันจะมีอยู่ ส่วน Q6 (สำรวจ sourcemap
บนเว็บจริง) ไม่ได้กั้นอะไรเลย

## 7. ข้อบังคับเรื่อง layering ของ MCP

รับมาก่อนที่จะมีโค้ด MCP สักบรรทัด เพราะตอนนี้ไม่มีต้นทุน และเติมทีหลังไม่ได้ (#8)

```
src/archive/      อ่าน archive → ข้อมูลดิบ
src/serve/tools/  pure function: (archive, params) → result     ← ทุกชั้นเรียกตรงนี้
src/serve/mcp.ts  ลงทะเบียนและแปลง error เท่านั้น ไม่มีอย่างอื่น
```

พฤติกรรมใดก็ตามที่ไปตกอยู่ใน `mcp.ts` จะทดสอบได้ทางเดียวคือผ่าน agent จริง การกันมันออกไปทำให้ได้สี่ชั้น
มาฟรีๆ: `bun test` เรียกฟังก์ชันตรงๆ, CLI harness, การวิ่ง client↔server ครบรอบจริงหนึ่งครั้ง และ
**inspector** หน้า HTML แบบ static ที่แสดงว่า archive สมบูรณ์แค่ไหน *ก่อน* ที่ agent จะอ่าน

## 8. ขอบเขต

v1 แบบ lean ใช้เวลาราวสามสัปดาห์ ส่วนแบบเต็ม — เกณฑ์จุดตรวจ SSIM ≥ 0.98, motion adapter หลายตัว,
การตรวจ network, CI บน Windows — ใช้เก้าถึงสิบสามสัปดาห์ **เลือกแบบ lean แต่รับสัญญาไว้ตั้งแต่ต้น**
เพราะสัญญาคือของที่แก้ทีหลังแพง: ระบบ identity, การทำ version ของ archive schema และ behavior graph
schema **แยกกัน**, การเก็บหลักฐานดิบไว้ และการมี `identity-unresolved` อย่างชัดเจน

**ตัดออกจาก v1:**

| ตัดอะไร | ทำไมตัดได้ปลอดภัย |
|---|---|
| การเล่น interaction transcript ซ้ำ | **บันทึกมันไว้** — ส่วนนั้นข้ามแล้วย้อนไม่ได้ แต่ไม่ต้องเอาการเล่นซ้ำมาเป็นเกณฑ์ |
| frame ladder แบบเต็ม | มีคู่ก่อน/หลังก็พอ |
| SPA route graph | เป็น bounded context ที่สอง ไม่จำเป็นต่อการพิสูจน์ความสมจริง |
| ความหมายของ canvas / WebGL | ไม่มีทางเข้าถึงมันโดยไม่กลายเป็นโปรเจกต์ของตัวเอง |
| coverage pass | `Profiler` ทำ timing เพี้ยน เลื่อนไปพร้อมรอบ replay ของตัวเอง |
| การถอด minify โดยไม่มี map ที่เผยแพร่ | การเดาที่แต่งตัวเป็นหลักฐาน |
| replay context พร้อมกันหลายตัว | การ optimize ก่อนที่จะมีอะไรให้ optimize |

## 9. จุดที่ตารางเวลาจะบาน

**เฟส extract** — agent ทั้งสี่ตัวในรอบวางแผนเห็นตรงกันหมด การตรวจว่ามี animation *อยู่* ง่ายกว่าการตรวจว่า
**อะไรเป็นตัว trigger** มาก และ state ของ GSAP/ScrollTrigger ต้องงัดออกมาผ่าน hook เฉพาะของไลบรารีนั้น
ไม่ใช่อ่านจาก DOM ได้ตรงๆ

## 10. ของที่ย้อนยาก เทียบกับของที่แก้ง่าย

| ย้อนยาก | แก้ง่าย |
|---|---|
| ระบบ identity | ค่า threshold ของ sweep |
| ผังโฟลเดอร์ของ archive และการทำ version ของ schema | allowlist ของ property ใน snapshot |
| `notFound:'abort'` ในฐานะสัญญา | heuristic ของ shortlist |
| รูปแบบ event ของ interaction transcript | ชื่อ tool ของ MCP |
| การดึง sourcemap เฉพาะตอน capture | ค่า concurrency เริ่มต้น |
<!-- lang:end -->
