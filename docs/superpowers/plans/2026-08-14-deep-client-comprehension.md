<!-- lang:en -->
# Deep client-side comprehension — the plan and why it is this way

**Status:** PROPOSED · **Date:** 2026-08-14 · **Source:** a three-lineage brainstorm round
(`gpt-5.6-sol` medium via codex · `Gemini 3.1 Pro (High)` via antigravity · `cursor-grok-4.5-high`)
synthesised against measurements taken the same day on three real sites.

> **This file owns design and reasoning. It does not own status.**
> For what is open → **[`docs/OPEN-WORK-LEDGER.md`](../../OPEN-WORK-LEDGER.md)**.
> It extends [`2026-07-31-pipeline-architecture.md`](2026-07-31-pipeline-architecture.md); where the
> two disagree, that file wins on anything it already decided.

---

## 1. Definition of done, in the developer's own words

> การที่สามารถ Clone มาแล้วทำให้มันใช้งานแบบ Offline ได้เหมือนกับ Online ทุกประการสำหรับ Code ฝั่ง
> Client (ไม่นับฝั่ง Server) มันจะเป็นการทำให้ Codebase Client สมบูรณ์ไปโดยปริยาย

**The acceptance criterion is equivalence, not a checklist.** If the offline clone behaves as the
online site does for client-side code, the client codebase is complete *by construction* and an
agent can answer anything about it — because it holds live executable code rather than markdown, a
screenshot, or dead source.

This is a stronger criterion than the one it replaced. A checklist is written by whoever writes it,
so it can only test what that person thought to ask; equivalence tests what the site actually does.
It had already caught a defect before it was adopted: a one-shot live-vs-replay comparison on
2026-08-14 found `www.chaingpt.org` matching exactly and `www.firecrawl.dev` apparently not — see
§3 for how that second reading turned out.

**Server-side is explicitly out of scope**, by the developer's decision. Everything that decides
what the screen shows and how it moves is shipped to the browser by definition, so the exclusion
removes no capability from the goal.

---

## 2. What is proven, measured on real sites

| Claim | Evidence | Where |
|---|---|---|
| The behaviour graph exists and is substantial | 271 nodes from `labs.chaingpt.org`; 150 from `www.chaingpt.org` | `src/extract/behaviour.ts` |
| Motion re-runs from the archive with the network off | live `12 / 190 / 38` vs replay `12 / 190 / 38` on `www.chaingpt.org` | replay + a plain-Playwright live probe |
| Instrumenting the replay recovers what no file contains | **82,613 chars of GLSL**, 3 vertex + 3 fragment, from `www.chaingpt.org` | `addInitScript` hooks on `shaderSource` |
| The interaction surface is enumerable | click 242 · keydown 214 · mouseenter 72 · mouseleave 72 · swipe 53 | hook on `addEventListener` |
| A runtime observation traces to an original source line | `gl.shaderSource` → `three.module.min.js:12:326662` → `/npm/three@0.151.2/build/three.module.js:18723:4` | stack capture + archived map, VLQ decoded by hand |
| Original source is already in the archive | 221 files / 2.1 MB on `labs`; 233 files / 3.6 MB on `www.chaingpt.org` | `sourcesContent` in archived maps |
| Names survive even where source does not | 7,397–9,006 original identifiers in `names[]`; 6,390–10,791 property names survive minification | archived maps + script bodies |

**Hooking at the browser API layer is library-agnostic and that is why it holds.** `THREE` was not
a global on `www.chaingpt.org` — the page loads `three.module.min.js` as an ES module — and every
shader was still captured, because everything must pass through WebGL eventually.

---

## 3. What was refuted, and the rule it produced

Three claims carried into this plan were wrong. All three were single observations promoted to
facts, and each was refuted by *measuring the same thing twice*.

- **"`waitUntil: 'load'` waits on analytics beacons."** `domcontentloaded` never fired either. The
  real cause was a HAR entry with `status: -1` that `routeFromHAR` matches and then neither fulfils
  nor aborts (#155).
- **"Replay never scrolls, so ScrollTrigger is invisible."** Once the stall was fixed, ScrollTrigger
  registered 8 and 38 on the two sites. The symptom was downstream of the stall.
- **"`firecrawl.dev` loses 14 WAAPI animations in replay."** Sampling six times over three seconds
  instead of once: live `0·14·6·3·4·4`, replay `0·11·6·3·4·4`. They track. The one-shot reading was
  a phase difference, not a loss.

> **A count sampled once is not a measurement of a page that is still moving.** The gate must
> compare at *normalised animation progress*, never at a wall-clock instant. This is the same
> failure in three costumes, and it is why §4 refuses count-equality as a pass condition.

---

## 4. The equivalence gate

### 4.1 What is compared

Not counts. A **digest** produced by the *same driver script and the same instrumentation build* on
both sides, in **one session** — capture, replay, compare — because comparing across days measures
the site's drift rather than the clone's fidelity.

- **Network attempt set** — method, normalised URL, body class, with every miss classified against
  the ADR 0007 taxonomy rather than hidden.
- **Behaviour multiset** — mechanism + a discriminating target + timing/easing/configuration. Today
  the *kind* of surface is right and the *discrimination* is not (§5, slice 2).
- **Reconciled DOM and computed styles** — matched through element identity, never array order.
  `unresolved` is a first-class outcome, not a soft ignore.
- **Listener registry** — type and target, as *registration* evidence, never as "behaved".
- **Canvas / WebGL / WebAudio call stream** — an ordered digest of operations, not pixels.
- **Visual milestones** — screenshots at scenario checkpoints, as an **oracle**, not the gate.

Every field resolves to `equal` · `allowed` · `different` · `unobserved`, and **`unobserved` never
counts as equal**. The gate reports equivalence *and achieved coverage*; green means "equivalent
for these scenarios and observed realms", never "equivalent for every possible input".

### 4.2 Differences that must be allowed, or the gate is red forever

Three were proposed; the panel found three more, each a distinct category.

| | Category |
|---|---|
| 1 | Requests the archive deliberately cannot serve — `notFound: 'abort'`, redacted bodies, volatile-key normalisation |
| 2 | Time and randomness — wall-clock sample points, `Math.random`, rAF phase |
| 3 | Server-varied content — A/B, personalisation, live data |
| 4 | Environment state — cookies, `localStorage`, viewport, system fonts |
| 5 | Capture-policy omissions already in the contract — the default-deny storage allowlist, blocked service workers, WebSocket/SSE the plan refuses to fake (§12 of the pipeline plan) |
| 6 | Browser and platform nondeterminism — task scheduling, compositor frame boundaries, font rasterisation, GPU float variation, codecs |

**Category 1 must not be allowed wholesale, and this is measured.** `www.chaingpt.org` cannot serve
`web-assets.chaingpt.org/assets/3d/Cannon_Exterior.hdr` — the environment map for its 3D scene —
plus three hero videos. The shaders compile, the draw calls fire, an API-level comparison passes,
and the scene renders without its lighting. An entry is allowed only when the endpoint is
explicitly out of scope **and** no downstream client-visible difference is measured.

Category 6 is bought down before it is tolerated: pin the Chromium build, GPU mode, fonts, viewport
and locale first, then tolerate only the residual.

**Never allowlisted, controlled to zero instead:** a different interaction transcript on the two
sides; instrumentation present on only one side; comparison at unrelated epochs.

### 4.3 False greens

1. **Count-only match** — `12/190/38` on both sides while targets, configuration and shader text diverge.
2. **Same incomplete driver on both sides** — scroll-only live against scroll-only replay is green about *scroll-reachable behaviour* and silent about the site.
3. **Registration read as behaviour** — 242 click listeners registered, none fired.
4. **Ghost execution** — identical GL calls, missing texture, black output. Measured; see §4.2.
5. **Soft-degraded JavaScript** — an unservable chunk sends the app down a fallback path; counts still match while the WebGL or auth path is dead. *The loud `abort` is not the dangerous case; this is.*
6. **Null-configuration equality** — `8 ≡ 8` ScrollTriggers with empty `start`/`end`/`scrub` on both sides.

**The gate's validity is bounded by the driver's coverage.** This is why interaction (slice 3) is
not a feature but the thing that raises the ceiling on what equivalence can mean.

---

## 5. The slices, in order

Slice 0 was missing from the first draft, and it is the correction that matters most: **build the
falsifier before the things it must falsify**, or the rest can only be ordered by taste.

| # | Slice | Delivers | De-risks | Depends on |
|---|---|---|---|---|
| **0** | **Differential harness** | One command: capture, replay under the same driver, diff, fail on unexplained residual | Building 1–7 with no way to tell whether they served the criterion | replay, identity reconcile, current extract |
| 1 | **Instrumentation, permanent** | Shaders, canvas, listeners, WebAudio, observers, navigation, errors — installed before app code, **on both sides**, with stacks in the event schema from day one | Ad-hoc probes; blindness to GL/audio/listener divergence | 0 |
| 2 | **Discriminating targets + ScrollTrigger configuration** | Selectors that resolve to exactly one element; `start`/`end`/`scrub`/`pin`/`toggleActions`; GSAP timeline parentage | Multiset collisions — 154 nodes comparing as `div`; nodes that cannot fail a comparison | 0, identity |
| 3 | **Bounded interaction** | Deterministic scenarios: hover, focus, keyboard, nested scroll, selected clicks — with an explicit refusal policy | The scroll-only ceiling; registration-without-fire | 0, 1, 2 |
| 4 | **Visual milestones** | Screenshots at checkpoints, region and full page | Ghost execution; font and layout failures the graph cannot name | 2, 3 |
| 5 | **Archive evidence index** | Queryable original sources, CSS, assets, shader strings, request evidence, identifier tables | 2.1–3.6 MB of original source sitting unread | `src/archive/read.ts` |
| 6 | **Runtime → source provenance** | Observation → stack frame → generated coordinate → original coordinate → bounded excerpt, with the generated coordinate preserved | Unsupported explanations; ambiguous attribution | 1, 5 |
| 7 | **Evidence graph** | The join: region ↔ element ↔ behaviour ↔ canvas/shader ↔ library ↔ asset ↔ source coordinate, queryable in one hop | Seven working subsystems whose outputs cannot answer the question | all |

**Ordering corrections against the first draft:** instrumentation before interaction, because it has
to see what interaction drives. Identity before any diff, because a comparison of indistinguishable
things is not a comparison. Provenance *designed into* the event schema early but *completed* after
the source index exists. Screenshots demoted from gate to oracle. Nothing is cut; interaction is
constrained rather than removed, and blind click-everything stays cut as it already was.

---

## 6. Provenance degrades honestly

The pipeline plan already decided this and it is restated because slice 6 is where it binds:
*guessing an original filename is not a fallback, it is a fabricated citation.*

Three levels, each carrying its confidence, and a level is never promoted:

| Level | When | Example |
|---|---|---|
| `original-source` | an archived map resolves the frame | `three@0.151.2/build/three.module.js:18723` |
| `generated-source` | no map, or no `sourcesContent` | `chunk-29f3a.js:1:4902` — the strongest available evidence, stated as such |
| `runtime-generated` | the artefact exists only at runtime | the 82 KB of GLSL — provenance terminates at the JavaScript call that assembled it |

`www.firecrawl.dev` declares 69 sourcemaps and 404s 51 of 52 requested. **A tool whose value
depends on maps existing is useless on a large share of production sites**, so the three levels are
the contract, not a degradation path bolted on later.

---

## 7. The two deepest risks

**A HAR is a transcript, not a stateful server — and this gets worse exactly as slice 3 succeeds.**
Interaction drives the same endpoint repeatedly with different bodies, cookies and application
state. `routeFromHAR` selects a response that is syntactically matchable but belongs to a different
state transition. The page loads, animations run, request counts match, and a coarse gate goes
green while the client sits in the wrong state. The gate must compare bodies and state transitions,
refuse ambiguous matches, and preserve ordering; state that cannot be archived safely is declared
an unsupported scenario rather than normalised away.

**Equivalence under a shared incomplete driver can rubber-stamp a partial clone.** A green gate on
a scroll-only driver is a true statement about scroll-reachable behaviour and says nothing about
the 242 click listeners. The criterion in §1 — *complete by construction* — is only as true as the
driver is complete. The gate must therefore publish its coverage next to its verdict, and a
coverage number that is not rising is the signal that the criterion is being over-claimed.

---

## 8. What this plan does not decide

- The scenario language for slice 3 — what a scenario file looks like, and who authors it.
- Whether the evidence graph is an archive artefact or computed on demand at serve time.
- The de-minification fallback for sites with no maps: whether identification against known library
  builds is in scope, and whether model-assisted naming is permitted at all. If it is, it is a
  fourth provenance level with its own confidence, never folded into the three above.
- Whether the fixture grows a WebGL/3D/interaction case, or a second fixture site is added for it.
<!-- lang:end -->

<!-- lang:th -->
# ความเข้าใจฝั่ง client แบบลึก — แผนและเหตุผลที่มันเป็นแบบนี้

**สถานะ:** PROPOSED · **วันที่:** 2026-08-14 · **ที่มา:** การระดมสมองสามสายพันธุ์
(`gpt-5.6-sol` medium ผ่าน codex · `Gemini 3.1 Pro (High)` ผ่าน antigravity · `cursor-grok-4.5-high`)
สังเคราะห์เทียบกับการวัดที่ทำในวันเดียวกันบนเว็บจริงสามแห่ง

> **ไฟล์นี้เป็นเจ้าของการออกแบบและเหตุผล ไม่ใช่เจ้าของสถานะ**
> สิ่งที่ยังเปิดอยู่ → **[`docs/OPEN-WORK-LEDGER.md`](../../OPEN-WORK-LEDGER.md)**
> มันต่อยอดจาก [`2026-07-31-pipeline-architecture.md`](2026-07-31-pipeline-architecture.md) · เมื่อสองไฟล์
> ขัดกัน ไฟล์นั้นชนะในทุกเรื่องที่มันตัดสินไปแล้ว

---

## 1. นิยามของคำว่าเสร็จ ด้วยถ้อยคำของผู้พัฒนาเอง

> การที่สามารถ Clone มาแล้วทำให้มันใช้งานแบบ Offline ได้เหมือนกับ Online ทุกประการสำหรับ Code ฝั่ง
> Client (ไม่นับฝั่ง Server) มันจะเป็นการทำให้ Codebase Client สมบูรณ์ไปโดยปริยาย

**เกณฑ์การยอมรับคือสมมูล ไม่ใช่รายการเช็ก** · ถ้าโคลนออฟไลน์ทำงานเหมือนเว็บออนไลน์สำหรับโค้ดฝั่ง client
แล้ว codebase ฝั่ง client ก็สมบูรณ์*โดยปริยาย* และ agent ตอบอะไรก็ได้เกี่ยวกับมัน เพราะมันถือโค้ดที่รันได้จริง
ไม่ใช่ markdown ไม่ใช่ screenshot ไม่ใช่ซอร์สที่ตายแล้ว

นี่เป็นเกณฑ์ที่แข็งแรงกว่าตัวที่มันแทนที่ · รายการเช็กถูกเขียนโดยคนที่เขียนมัน มันจึงทดสอบได้แค่สิ่งที่คนนั้นนึกจะถาม
ส่วนสมมูลทดสอบสิ่งที่เว็บทำจริง · มันจับข้อบกพร่องได้ก่อนถูกรับมาใช้ด้วยซ้ำ: การเทียบสดกับ replay ครั้งเดียวเมื่อ
2026-08-14 พบว่า `www.chaingpt.org` ตรงกันเป๊ะ ส่วน `www.firecrawl.dev` ดูเหมือนไม่ตรง — ดู §3 ว่าการอ่านครั้งที่สอง
ลงเอยยังไง

**ฝั่งเซิร์ฟเวอร์อยู่นอกขอบเขตโดยชัดแจ้ง** ตามการตัดสินของผู้พัฒนา · ทุกอย่างที่ตัดสินว่าหน้าจอแสดงอะไรและขยับยังไง
ถูกส่งมาที่เบราว์เซอร์โดยนิยาม การตัดออกจึงไม่ได้เอาความสามารถใดออกจากเป้าหมายเลย

---

## 2. สิ่งที่พิสูจน์แล้ว วัดบนเว็บจริง

| คำกล่าว | หลักฐาน | ที่ไหน |
|---|---|---|
| กราฟพฤติกรรมมีอยู่จริงและมีเนื้อ | 271 โหนดจาก `labs.chaingpt.org` · 150 จาก `www.chaingpt.org` | `src/extract/behaviour.ts` |
| motion รันใหม่จาก archive โดยถอดเน็ต | สด `12 / 190 / 38` เทียบ replay `12 / 190 / 38` บน `www.chaingpt.org` | replay กับ probe playwright เปล่า |
| การ instrument replay กู้สิ่งที่ไม่มีในไฟล์ไหนเลย | **GLSL 82,613 ตัวอักษร** · vertex 3 fragment 3 จาก `www.chaingpt.org` | hook `shaderSource` ผ่าน `addInitScript` |
| พื้นผิวการโต้ตอบนับได้ | click 242 · keydown 214 · mouseenter 72 · mouseleave 72 · swipe 53 | hook `addEventListener` |
| การสังเกตตอนรันคลายกลับไปหาบรรทัดต้นฉบับได้ | `gl.shaderSource` → `three.module.min.js:12:326662` → `/npm/three@0.151.2/build/three.module.js:18723:4` | จับ stack + แมปใน archive ถอด VLQ เขียนเอง |
| ซอร์สต้นฉบับอยู่ใน archive แล้ว | 221 ไฟล์ / 2.1 MB บน `labs` · 233 ไฟล์ / 3.6 MB บน `www.chaingpt.org` | `sourcesContent` ในแมปที่เก็บไว้ |
| ชื่อรอดแม้ในที่ที่ซอร์สไม่รอด | identifier เดิม 7,397–9,006 ตัวใน `names[]` · ชื่อ property 6,390–10,791 ตัวรอดการย่อส่วน | แมป + เนื้อสคริปต์ |

**การ hook ที่ชั้น API ของเบราว์เซอร์ไม่ผูกกับไลบรารี และนั่นคือเหตุผลที่มันทนทาน** · `THREE` ไม่ได้เป็น global บน
`www.chaingpt.org` เพราะหน้าโหลด `three.module.min.js` เป็น ES module — และ shader ยังถูกจับได้ครบ
เพราะสุดท้ายทุกอย่างต้องผ่าน WebGL

---

## 3. สิ่งที่ถูกหักล้าง และกฎที่มันผลิตออกมา

คำกล่าวสามข้อที่ถูกพาเข้ามาในแผนนี้ผิด · ทั้งสามข้อคือการสังเกตครั้งเดียวที่ถูกเลื่อนขั้นเป็นข้อเท็จจริง และแต่ละข้อ
ถูกหักล้างด้วย*การวัดสิ่งเดิมสองครั้ง*

- **"`waitUntil: 'load'` รอ beacon ของ analytics"** · `domcontentloaded` ก็ไม่เคยยิงเหมือนกัน · สาเหตุจริงคือ
  HAR entry ที่ `status: -1` ซึ่ง `routeFromHAR` จับคู่ได้แล้วไม่ทั้ง fulfil ไม่ทั้ง abort (#155)
- **"replay ไม่เคย scroll ScrollTrigger จึงมองไม่เห็น"** · พออาการค้างถูกแก้ ScrollTrigger ลงทะเบียน 8 และ 38 ตัว
  บนสองเว็บ · อาการนั้นเป็นผลพวงของการค้าง
- **"`firecrawl.dev` เสีย WAAPI 14 ตัวใน replay"** · สุ่มหกครั้งในสามวินาทีแทนที่จะสุ่มครั้งเดียว: สด `0·14·6·3·4·4`
  replay `0·11·6·3·4·4` · มันเดินตามกัน · การอ่านครั้งเดียวคือเฟสไม่ตรง ไม่ใช่การสูญหาย

> **จำนวนที่สุ่มครั้งเดียวไม่ใช่การวัดหน้าที่ยังขยับอยู่** · ด่านต้องเทียบที่*ความคืบหน้าของ animation ที่ทำให้เป็น
> มาตรฐานแล้ว* ไม่ใช่ที่จุดเวลาตามนาฬิกา · นี่คือความล้มเหลวเดียวกันในสามชุดแต่งกาย และเป็นเหตุผลที่ §4 ปฏิเสธ
> การที่จำนวนเท่ากันเป็นเงื่อนไขผ่าน

---

## 4. ด่านสมมูล

### 4.1 เทียบอะไร

ไม่ใช่จำนวน · แต่เป็น **digest** ที่ผลิตโดย *สคริปต์ขับตัวเดียวกันและ instrumentation รุ่นเดียวกัน* ทั้งสองฝั่ง
ใน **การรันเดียวกัน** — capture · replay · เทียบ — เพราะการเทียบข้ามวันคือการวัดว่าเว็บเขาเปลี่ยนไปแค่ไหน
ไม่ใช่วัดความตรงของโคลนเรา

- **ชุดคำขอที่พยายามยิง** — method · URL ที่ทำให้เป็นมาตรฐาน · ชนิดของ body พร้อมจำแนกทุกตัวที่พลาด
  ตามอนุกรมวิธานของ ADR 0007 แทนที่จะซ่อน
- **multiset ของพฤติกรรม** — กลไก + เป้าหมายที่แยกแยะได้ + timing/easing/คอนฟิก · วันนี้*ชนิด*ของพื้นผิวถูกแล้ว
  แต่*ความสามารถในการแยกแยะ*ยังไม่ถูก (§5 สไลซ์ 2)
- **DOM และ computed style ที่จับคู่แล้ว** — จับคู่ผ่านอัตลักษณ์ของ element ไม่ใช่ลำดับใน array ·
  `unresolved` เป็นผลลัพธ์ชั้นหนึ่ง ไม่ใช่การมองข้ามเบา ๆ
- **ทะเบียน listener** — ชนิดและเป้าหมาย ในฐานะหลักฐานของ*การลงทะเบียน* ไม่ใช่ของ "พฤติกรรม"
- **สายการเรียก canvas / WebGL / WebAudio** — digest ของ operation ตามลำดับ ไม่ใช่พิกเซล
- **หมุดหมายเชิงภาพ** — screenshot ที่จุดตรวจของ scenario ในฐานะ **oracle** ไม่ใช่ตัวชี้ขาด

ทุกฟิลด์ลงเอยเป็น `equal` · `allowed` · `different` · `unobserved` และ **`unobserved` ไม่เคยนับเป็น equal** ·
ด่านรายงานทั้งสมมูล*และความครอบคลุมที่ทำได้* · เขียวแปลว่า "สมมูลสำหรับ scenario เหล่านี้และ realm ที่สังเกต"
ไม่เคยแปลว่า "สมมูลสำหรับทุก input ที่เป็นไปได้"

### 4.2 ความต่างที่ต้องอนุญาต ไม่งั้นด่านจะแดงตลอดกาล

เสนอไว้สามข้อ · คณะพบเพิ่มอีกสาม แต่ละข้อเป็นคนละหมวด

| | หมวด |
|---|---|
| 1 | คำขอที่ archive ตั้งใจเสิร์ฟไม่ได้ — `notFound: 'abort'` · body ที่ถูก redact · การทำ volatile key ให้เป็นมาตรฐาน |
| 2 | เวลาและค่าสุ่ม — จุดสุ่มตามนาฬิกา · `Math.random` · เฟสของ rAF |
| 3 | เนื้อหาที่เซิร์ฟเวอร์เปลี่ยนเอง — A/B · personalisation · ข้อมูลสด |
| 4 | สถานะสภาพแวดล้อม — cookie · `localStorage` · viewport · ฟอนต์ระบบ |
| 5 | สิ่งที่นโยบาย capture ละไว้ตามสัญญาเดิม — storage allowlist แบบปฏิเสธเป็นค่าตั้งต้น · service worker ที่ถูกบล็อก · WebSocket/SSE ที่แผนปฏิเสธจะปลอม (§12 ของแผน pipeline) |
| 6 | ความไม่แน่นอนของเบราว์เซอร์และแพลตฟอร์ม — การจัดคิวงาน · ขอบเฟรมของ compositor · การ raster ฟอนต์ · ความแปรผันของ float บน GPU · codec |

**หมวด 1 ห้ามอนุญาตเหมารวม และข้อนี้วัดมาแล้ว** · `www.chaingpt.org` เสิร์ฟ
`web-assets.chaingpt.org/assets/3d/Cannon_Exterior.hdr` ไม่ได้ — คือ environment map ของฉาก 3D ของมัน —
บวกวิดีโอ hero อีกสามไฟล์ · shader คอมไพล์ครบ draw call ยิงครบ การเทียบระดับ API ผ่านสบาย และฉาก render
ออกมาโดยไม่มีแสงของมัน · entry หนึ่งจะถูกอนุญาตก็ต่อเมื่อ endpoint นั้นอยู่นอกขอบเขตโดยชัดแจ้ง **และ**
วัดแล้วว่าไม่มีความต่างปลายทางที่ client มองเห็น

หมวด 6 ถูกกดลงก่อนจะถูกทน: ตรึงรุ่น Chromium · โหมด GPU · ฟอนต์ · viewport · locale ก่อน แล้วค่อยทนเฉพาะส่วนที่เหลือ

**ห้ามใส่ allowlist เด็ดขาด ให้คุมให้เป็นศูนย์แทน:** transcript การโต้ตอบที่ต่างกันสองฝั่ง ·
instrumentation ที่มีอยู่ฝั่งเดียว · การเทียบที่คนละ epoch

### 4.3 เขียวปลอม

1. **ตรงกันเฉพาะจำนวน** — `12/190/38` ทั้งสองฝั่งขณะที่เป้าหมาย คอนฟิก และเนื้อ shader ต่างกัน
2. **driver ที่ไม่ครบเหมือนกันทั้งสองฝั่ง** — สดแบบ scroll อย่างเดียวเทียบกับ replay แบบ scroll อย่างเดียว เขียวเรื่อง*พฤติกรรมที่เข้าถึงได้ด้วยการเลื่อน* และเงียบเรื่องเว็บ
3. **อ่านการลงทะเบียนเป็นพฤติกรรม** — click listener 242 ตัวลงทะเบียน ไม่มีตัวไหนถูกยิง
4. **ghost execution** — GL call เหมือนกัน texture หาย ภาพออกมาดำ · วัดแล้ว ดู §4.2
5. **JavaScript ที่เสื่อมแบบเงียบ** — chunk ที่เสิร์ฟไม่ได้ทำให้แอปวิ่งไปเส้นทางสำรอง จำนวนยังตรงขณะที่เส้นทาง WebGL หรือ auth ตายไปแล้ว · *`abort` ที่ดังไม่ใช่เคสอันตราย เคสนี้ต่างหาก*
6. **เท่ากันด้วยคอนฟิกที่ว่าง** — ScrollTrigger `8 ≡ 8` โดย `start`/`end`/`scrub` ว่างทั้งสองฝั่ง

**ความสมเหตุสมผลของด่านถูกจำกัดด้วยความครอบคลุมของ driver** · นี่คือเหตุผลที่การโต้ตอบ (สไลซ์ 3) ไม่ใช่ฟีเจอร์
แต่คือสิ่งที่ยกเพดานว่าคำว่าสมมูลจะหมายถึงอะไรได้บ้าง

---

## 5. สไลซ์ตามลำดับ

สไลซ์ 0 ไม่มีอยู่ในร่างแรก และมันคือข้อแก้ที่สำคัญที่สุด: **สร้างตัวหักล้างก่อนสิ่งที่มันต้องหักล้าง**
ไม่งั้นที่เหลือเรียงลำดับได้ด้วยรสนิยมเท่านั้น

| # | สไลซ์ | ส่งมอบอะไร | ลดความเสี่ยงอะไร | ขึ้นกับอะไร |
|---|---|---|---|---|
| **0** | **ตัวเทียบเชิงผลต่าง** | คำสั่งเดียว: capture · replay ด้วย driver เดียวกัน · diff · ล้มเมื่อมีเศษที่อธิบายไม่ได้ | การสร้าง 1–7 โดยไม่มีทางบอกว่ามันรับใช้เกณฑ์หรือไม่ | replay · การจับคู่อัตลักษณ์ · extract ปัจจุบัน |
| 1 | **instrumentation ถาวร** | shader · canvas · listener · WebAudio · observer · การนำทาง · error — ติดตั้งก่อนโค้ดแอป **ทั้งสองฝั่ง** โดยมี stack อยู่ในสคีมาของเหตุการณ์ตั้งแต่วันแรก | probe เฉพาะกิจ · การมองไม่เห็นความต่างของ GL/audio/listener | 0 |
| 2 | **เป้าหมายที่แยกแยะได้ + คอนฟิก ScrollTrigger** | selector ที่ชี้ไปยัง element ตัวเดียว · `start`/`end`/`scrub`/`pin`/`toggleActions` · สายพันธุ์ของ timeline | การชนกันใน multiset — 154 โหนดเทียบกันเป็น `div` · โหนดที่ทำให้การเทียบล้มไม่ได้ | 0 · อัตลักษณ์ |
| 3 | **การโต้ตอบแบบมีขอบเขต** | scenario ที่แน่นอน: hover · focus · แป้นพิมพ์ · scroll ซ้อน · คลิกที่เลือกไว้ — พร้อมนโยบายการปฏิเสธที่ชัดเจน | เพดานของการ scroll อย่างเดียว · ลงทะเบียนแล้วไม่เคยยิง | 0 · 1 · 2 |
| 4 | **หมุดหมายเชิงภาพ** | screenshot ที่จุดตรวจ ทั้งเฉพาะบริเวณและเต็มหน้า | ghost execution · ความล้มเหลวของฟอนต์และ layout ที่กราฟเรียกชื่อไม่ได้ | 2 · 3 |
| 5 | **ดัชนีหลักฐานใน archive** | ซอร์สต้นฉบับ · CSS · asset · เนื้อ shader · หลักฐานคำขอ · ตารางชื่อ ที่ค้นได้ | ซอร์สต้นฉบับ 2.1–3.6 MB ที่นอนอยู่โดยไม่มีใครอ่าน | `src/archive/read.ts` |
| 6 | **การสืบย้อนจากตอนรันไปหาซอร์ส** | การสังเกต → เฟรมของ stack → พิกัดในไฟล์ที่ generate → พิกัดต้นฉบับ → ตัวอย่างที่มีขอบเขต โดยเก็บพิกัดของไฟล์ที่ generate ไว้ด้วย | คำอธิบายที่ไม่มีหลักฐานรอง · การระบุที่มาที่กำกวม | 1 · 5 |
| 7 | **กราฟหลักฐาน** | ตัวเชื่อม: บริเวณ ↔ element ↔ พฤติกรรม ↔ canvas/shader ↔ ไลบรารี ↔ asset ↔ พิกัดซอร์ส ค้นได้ในก้าวเดียว | ระบบย่อยเจ็ดตัวที่ทำงานถูกทุกตัวแต่ผลลัพธ์ตอบคำถามไม่ได้ | ทั้งหมด |

**ข้อแก้ลำดับเทียบกับร่างแรก:** instrumentation มาก่อนการโต้ตอบ เพราะมันต้องเห็นสิ่งที่การโต้ตอบขับ ·
อัตลักษณ์มาก่อน diff ใด ๆ เพราะการเทียบของที่แยกกันไม่ออกไม่ใช่การเทียบ · การสืบย้อนถูก*ออกแบบเข้าไป*ใน
สคีมาของเหตุการณ์ตั้งแต่ต้นแต่*ทำให้เสร็จ*หลังดัชนีซอร์สมีอยู่ · screenshot ถูกลดจากตัวชี้ขาดเป็น oracle ·
ไม่มีอะไรถูกตัด · การโต้ตอบถูกจำกัดไม่ใช่ถูกเอาออก และการคลิกมั่วยังคงถูกตัดเหมือนที่ถูกตัดไปแล้ว

---

## 6. การสืบย้อนที่เสื่อมอย่างซื่อสัตย์

แผน pipeline ตัดสินข้อนี้ไว้แล้ว และถูกกล่าวซ้ำเพราะสไลซ์ 6 คือจุดที่มันผูก:
*การเดาชื่อไฟล์ต้นฉบับไม่ใช่ทางถอย มันคือการอ้างอิงที่กุขึ้น*

สามระดับ แต่ละระดับพกความมั่นใจมาด้วย และระดับหนึ่งไม่เคยถูกเลื่อนขั้น

| ระดับ | เมื่อไร | ตัวอย่าง |
|---|---|---|
| `original-source` | แมปใน archive คลายเฟรมได้ | `three@0.151.2/build/three.module.js:18723` |
| `generated-source` | ไม่มีแมป หรือไม่มี `sourcesContent` | `chunk-29f3a.js:1:4902` — หลักฐานที่ดีที่สุดที่มี และระบุไว้ตรง ๆ ว่าเป็นแบบนั้น |
| `runtime-generated` | สิ่งประดิษฐ์นั้นมีอยู่เฉพาะตอนรัน | GLSL 82 KB — การสืบย้อนจบที่การเรียก JavaScript ที่ประกอบมันขึ้นมา |

`www.firecrawl.dev` ประกาศ sourcemap 69 ตัวและ 404 ไป 51 จาก 52 ที่ร้องขอ · **เครื่องมือที่มีค่าเฉพาะเมื่อมีแมป
จะไร้ประโยชน์บนเว็บ production ส่วนใหญ่** · สามระดับนี้จึงเป็นสัญญา ไม่ใช่ทางเสื่อมที่มาแปะทีหลัง

---

## 7. ความเสี่ยงสองข้อที่ลึกที่สุด

**HAR คือบันทึกการสนทนา ไม่ใช่เซิร์ฟเวอร์ที่มีสถานะ — และมันแย่ลงพอดีกับที่สไลซ์ 3 สำเร็จ**
การโต้ตอบยิง endpoint เดิมซ้ำ ๆ ด้วย body · cookie · สถานะของแอปที่ต่างกัน · `routeFromHAR` เลือก response
ที่จับคู่ได้ทางไวยากรณ์แต่เป็นของการเปลี่ยนสถานะอื่น · หน้าโหลด animation วิ่ง จำนวนคำขอตรง และด่านหยาบ ๆ
ขึ้นเขียวขณะที่ client นั่งอยู่ในสถานะผิด · ด่านต้องเทียบ body และการเปลี่ยนสถานะ ปฏิเสธการจับคู่ที่กำกวม
และรักษาลำดับไว้ · สถานะที่เก็บอย่างปลอดภัยไม่ได้ต้องถูกประกาศเป็น scenario ที่ไม่รองรับ แทนที่จะถูกทำให้
เป็นมาตรฐานจนหายไป

**สมมูลภายใต้ driver ที่ไม่ครบเหมือนกันทั้งสองฝั่ง สามารถประทับตราให้โคลนที่ไม่สมบูรณ์ได้**
ด่านที่เขียวบน driver ที่ scroll อย่างเดียวเป็นคำกล่าวที่จริงเกี่ยวกับพฤติกรรมที่เข้าถึงได้ด้วยการเลื่อน และ
ไม่พูดอะไรเลยเกี่ยวกับ click listener 242 ตัว · เกณฑ์ใน §1 — *สมบูรณ์โดยปริยาย* — จริงได้เท่าที่ driver ครบเท่านั้น ·
ด่านจึงต้องเผยแพร่ความครอบคลุมของมันเคียงข้างคำตัดสิน และตัวเลขความครอบคลุมที่ไม่ขยับคือสัญญาณว่าเกณฑ์
กำลังถูกอ้างเกินจริง

---

## 8. สิ่งที่แผนนี้ไม่ได้ตัดสิน

- ภาษาของ scenario สำหรับสไลซ์ 3 — ไฟล์ scenario หน้าตาเป็นยังไง และใครเขียนมัน
- กราฟหลักฐานเป็น artifact ใน archive หรือคำนวณตอน serve
- ทางถอยของการ de-minify สำหรับเว็บที่ไม่มีแมป: การระบุตัวเทียบกับ build ของไลบรารีที่รู้จักอยู่ในขอบเขตไหม
  และการให้โมเดลช่วยตั้งชื่อได้รับอนุญาตหรือไม่ · ถ้าได้ มันคือระดับการสืบย้อนที่สี่ที่มีความมั่นใจของตัวเอง
  ไม่ใช่การพับรวมเข้าไปในสามระดับข้างบน
- fixture จะโตขึ้นให้มีเคส WebGL/3D/การโต้ตอบ หรือจะเพิ่ม fixture site ตัวที่สองสำหรับเรื่องนี้
<!-- lang:end -->
