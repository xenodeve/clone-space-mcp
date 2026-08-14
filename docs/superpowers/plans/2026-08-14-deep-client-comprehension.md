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

## 0. The goal, in one sentence

**Archive a web page so its client side is still alive rather than merely still present — then let
an agent walk into it and explain how anything works, citing a real line.**

Two statements of this exist in the repository and they are the same goal at different sharpness.

`CLAUDE.md` says **what must be possible**:

> Archive a live web page so that it **replays offline with real fidelity** — carousels,
> GSAP/ScrollTrigger, CSS animation genuinely run, not a frozen skeleton — and so an **AI agent can
> consume it** and explain how the page is built and where the motion is. The measure of done is
> not "the HTML was saved": disconnect the network → capture → replay and watch the motion actually
> run → extract a behavior graph → serve it and have an agent answer *"what makes the hero move?"*
> correctly, **citing file and line**.

The criterion in §1 says **how anyone can tell it is true**. The difference matters: the first is
checked by questions somebody thought to ask, which bounds it by that person's imagination. The
second needs no question authored at all — if the clone behaves as the original does, completeness
follows rather than being asserted.

### Why this is a different instrument, not a better scraper

A scraper keeps the **result** — markdown, a hydrated DOM, a screenshot. All three are one frame,
already frozen.

This keeps **the conditions under which the page can run again**, and then asks the page while it
is running. That is not a quality difference; it is a difference in what is answerable at all, and
two measurements from 2026-08-14 show where the line falls:

- **82,613 characters of GLSL** recovered from `www.chaingpt.org` — assembled at runtime, present in
  no archived file, unobtainable by anything that reads files.
- `gl.shaderSource` traced to **`three@0.151.2/build/three.module.js:18723:4`** — a runtime event
  resolved to an original source line.

Neither is possible if what you kept was the result.

### What is not reached

All three parts of the goal — *what moves*, *how it works*, *which line* — are demonstrated, and
all three are demonstrated **only over what a single scroll-through triggers**. `click 242 ·
keydown 214 · mouseenter 72` were observed as registrations and never once as behaviour.

So the ceiling on the word *everything* currently sits below where the goal puts it. That is the
reason slice 3 exists and the reason slice 0 precedes it: without the falsifier, a clone that is
green over scrolling looks the same as a clone that is complete.

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

**Server-side is explicitly out of scope**, by the developer's decision. The precise form of what
that leaves is not *"everything that decides the screen is shipped to the browser"* — a server can
decide the variant, the feature flags, the permission state and the initial markup, and send only
the result. The claim that holds is narrower and is the one this plan uses:

> Everything required to reproduce **the observed client-visible execution for a captured server
> state** must be present or observable at the client boundary.

For the same reason the criterion in this section is **behavioural completeness for the captured
scenarios**, not "the client codebase is complete". §4.3 and §7 bound it that way regardless, and
a §1 that claimed more would simply be in tension with them.

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
| Names survive even where source does not | `names[]` lists 7,397–9,006 and **5,775–7,005 (78%) are referenced by a mapping**; the share of mapping segments carrying a name is **24.7% on `www.chaingpt.org` against 70.4% on `labs`** | archived maps |
| Property names observed surviving minification | 6,390–10,791 distinct, **in these captured builds** — property mangling exists and elsewhere this number would fall | script bodies |

**Hooking at the browser API layer is library-agnostic and that is why it holds.** `THREE` was not
a global on `www.chaingpt.org` — the page loads `three.module.min.js` as an ES module — and every
shader was still captured, because everything must pass through WebGL eventually.

**Report the referenced count and the segment share, never the listed total.** A `names[]` entry is
an original identifier, but 22% of them are referenced by no mapping this can resolve, and the
segment share — the number that decides whether a given runtime position gets a name at all —
differs by nearly 3× between two sites measured the same day. A single headline number hides that.

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
counts as equal**.

**Coverage is a vector, not a score, and it is published beside the verdict** — a single number
would average away exactly the dimension that is weak:

```
equivalence: PASS
coverage:
  scroll               100%
  interaction           38%
  listener_execution    21%
  canvas_realms        100%
  webgl_programs       100%
  visual_checkpoints    72%
```

Green means "equivalent for these scenarios and observed realms", never "equivalent for every
possible input". **A green verdict at low coverage is not a success of the clone; it is a small
claim, correctly reported.**

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
| 7 | **Symbol recovery** | Generated symbol identity; original-name recovery from `names[]`; library-region correlation against published builds; runtime semantic aliases — each with its own provenance level | A bundle with no map leaving the agent at `chunk-29f3a.js:1:4902`; and, worse, an inferred name presented as an original one | 5, 6 |
| 8 | **Evidence graph** | The join, queryable in one hop | Eight working subsystems whose outputs cannot answer the question | all |

**Slice 7 was in "not decided" in the first draft and is promoted here**, because the four naming
sources turned out to be measurable rather than speculative and three of them return *facts*: the
`names[]` table, the property names that survive minification, and a published library build that
can be matched exactly. Left unslice, it becomes a nice-to-have — and for agent comprehension on a
site with no maps it is closer to the whole product.

**Slice 8's node types are not only the ones listed above.** The join has to carry `scenario`,
`interaction`, `runtime event`, `symbol`, `visual checkpoint` and `network transaction` as first
class, or the query that motivates the entire plan cannot be walked:

```
region → shader → uniform → runtime writer → pointermove listener → symbol → source
```

That is the shape of *"why does this hero distort when I move the mouse"*, and every hop in it is
an edge some earlier slice produced.

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
| `runtime-generated` | the artefact exists only at runtime | the 82 KB of GLSL |

**`runtime-generated` is a chain, not a dead end.** The artefact itself has no original coordinate
— but the *generation event* does, and that is what the graph stores:

```
Shader #S19          runtime-generated
  generated_by       three.module.min.js:12:326662
  resolved_to        three.module.js:18723:4        original-source
```

Saying provenance "terminates" at the JavaScript call understates what was already measured: the
call that assembled the GLSL resolves to an original line like anything else.

`www.firecrawl.dev` declares 69 sourcemaps and 404s 51 of 52 requested. **A tool whose value
depends on maps existing is useless on a large share of production sites**, so the three levels are
the contract, not a degradation path bolted on later.

Slice 7 adds a second, orthogonal axis for *names* — `original-name` (from `names[]`) ·
`structurally-recovered` (matched against a published library build) · `runtime-semantic` (inferred
from observed behaviour) · `static-semantic` (inferred from surviving property names) ·
`model-hypothesis`. **An inferred name is never rewritten into the position of an original one.**

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
the 242 click listeners. The criterion in §1 is only as true as the driver is complete. The gate
must therefore publish its coverage vector next to its verdict, and a coverage number that is not
rising is the signal that the criterion is being over-claimed.

**The instrumentation can change what it observes, and the gate cannot see it.** Live-instrumented
against replay-instrumented compares two pages that both carry the hooks — so a hook set that
shifts rAF phase, call ordering or microtask timing produces agreement between two pages that
neither user loads. The control the gate needs is therefore a third run: **instrumented against
uninstrumented on the same side**, with a stated perturbation budget.

Measured on `www.chaingpt.org`, replayed twice from one archive, with hooks on `shaderSource`,
`getContext` and `addEventListener` — 1,510 listener registrations intercepted:

| | uninstrumented | instrumented |
|---|---|---|
| `load` | 4,171 ms | 3,361 ms |
| rAF frames in one second | 61 | 60 |
| motion, settled | `12 / 190 / 38` | `12 / 190 / 38` |

**The effect is below run-to-run noise here — the instrumented run was the faster one.** That is a
baseline, not a dismissal: the hook set is meant to grow to WebAudio, observers and mutation, and
wrapping `requestAnimationFrame` is the one addition with a mechanism for real distortion. The
budget exists so that growth is measured rather than assumed harmless.

---

## 8. What this plan does not decide

- ~~The scenario language for slice 3~~ — **decided: hybrid.** Candidate actions are *discovered*
  from the page (listeners, roles, links, buttons, tab order, `cursor: pointer`, canvas,
  scrollable containers) and a *scenario* is authored on top of them, naming intent and
  checkpoints. Neither half alone works: discovery without authorship is the click-everything
  autopilot the pipeline plan already cut, and authorship without discovery cannot know what a
  page offers. The shape:

  ```yaml
  scenario: hero_exploration
  steps:
    - navigate: /
    - wait_for: stable
    - pointer:  { target: hero_canvas, trajectory: center_sweep }
    - scroll:   { target: section_2, progress: [0, .25, .5, .75, 1] }
    - hover:    { target: portfolio_card_1 }
  checkpoints: [hero_initial, hero_mouse_center, section2_mid_scroll]
  ```

  What stays open is narrower: whether the discovery half proposes scenarios an operator accepts,
  or only supplies the vocabulary an author writes against.
- Whether the evidence graph is an archive artefact or computed on demand at serve time.
- ~~The de-minification fallback~~ — **promoted to slice 7**, with its own provenance axis. What
  stays open inside it: whether `model-hypothesis` is permitted at all, and if so whether it may
  ever be shown without the observation that produced it.
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

## 0. เป้าหมาย ในประโยคเดียว

**เก็บหน้าเว็บมาให้ฝั่ง client ของมันยังมีชีวิตอยู่ ไม่ใช่แค่ยังมีร่าง — แล้วให้ agent เดินเข้าไปในนั้น
แล้วอธิบายได้ว่าอะไรทำงานยังไง โดยอ้างถึงบรรทัดจริง**

คำกล่าวสองฉบับของเรื่องนี้มีอยู่ในรีโป และมันคือเป้าหมายเดียวกันที่คมไม่เท่ากัน

`CLAUDE.md` บอกว่า **อะไรต้องทำได้**

> เก็บหน้าเว็บที่มีชีวิตไว้ เพื่อให้มัน **replay แบบออฟไลน์ด้วยความสมจริงจริง** — carousel ·
> GSAP/ScrollTrigger · CSS animation ทำงานจริง ไม่ใช่โครงกระดูกแช่แข็ง — และเพื่อให้ **AI agent
> เอาไปใช้ได้** และอธิบายได้ว่าหน้าถูกสร้างยังไงและ motion อยู่ตรงไหน · การวัดว่าเสร็จไม่ใช่
> "HTML ถูกเซฟแล้ว": ถอดสายเน็ต → capture → replay แล้วดู motion วิ่งจริง → extract กราฟพฤติกรรม →
> serve แล้วให้ agent ตอบว่า *"อะไรทำให้ hero ขยับ"* ได้ถูกต้อง **โดยอ้างไฟล์และบรรทัด**

เกณฑ์ใน §1 บอกว่า **ใครจะรู้ได้ยังไงว่ามันจริง** · ความต่างนี้สำคัญ: ฉบับแรกถูกตรวจด้วยคำถามที่ใครสักคน
นึกจะถาม ซึ่งจำกัดมันไว้ด้วยจินตนาการของคนคนนั้น · ฉบับที่สองไม่ต้องมีใครเขียนคำถามเลย — ถ้าโคลนทำตัว
เหมือนต้นฉบับ ความครบถ้วนก็ตามมาเอง แทนที่จะถูกกล่าวอ้าง

### ทำไมมันเป็นเครื่องมือคนละชนิด ไม่ใช่ scraper ที่ดีกว่า

scraper เก็บ **ผลลัพธ์** — markdown · DOM ที่ hydrate แล้ว · screenshot · ทั้งสามอย่างคือหนึ่งเฟรม
ที่แช่แข็งไปแล้ว

ตัวนี้เก็บ **เงื่อนไขที่ทำให้หน้ารันใหม่ได้** แล้วไปถามหน้าที่กำลังรันอยู่ · นั่นไม่ใช่ความต่างเชิงคุณภาพ
แต่เป็นความต่างว่าอะไรตอบได้บ้างตั้งแต่แรก และการวัดสองอย่างจาก 2026-08-14 แสดงว่าเส้นแบ่งอยู่ตรงไหน

- **GLSL 82,613 ตัวอักษร** กู้มาจาก `www.chaingpt.org` — ประกอบขึ้นตอนรัน ไม่มีอยู่ในไฟล์ไหนใน archive
  และเครื่องมือที่อ่านไฟล์อย่างเดียวเอามาไม่ได้
- `gl.shaderSource` สืบย้อนไปถึง **`three@0.151.2/build/three.module.js:18723:4`** — เหตุการณ์ตอนรัน
  ที่คลายไปหาบรรทัดต้นฉบับ

ทั้งสองอย่างเป็นไปไม่ได้ถ้าสิ่งที่เก็บไว้คือผลลัพธ์

### สิ่งที่ยังไปไม่ถึง

ทั้งสามท่อนของเป้าหมาย — *อะไรขยับ* · *ทำงานยังไง* · *บรรทัดไหน* — สาธิตได้แล้ว และทั้งสามท่อนสาธิตได้
**เฉพาะบนสิ่งที่การเลื่อนหน้าครั้งเดียวกระตุ้น** เท่านั้น · `click 242 · keydown 214 · mouseenter 72`
ถูกสังเกตในฐานะการลงทะเบียน และไม่เคยถูกสังเกตในฐานะพฤติกรรมแม้แต่ครั้งเดียว

เพดานของคำว่า *ทั้งหมด* จึงยังอยู่ต่ำกว่าที่เป้าหมายวางไว้ · นั่นคือเหตุผลที่สไลซ์ 3 มีอยู่ และเหตุผลที่
สไลซ์ 0 มาก่อนมัน: ถ้าไม่มีตัวหักล้าง โคลนที่เขียวบนการเลื่อนหน้าจะหน้าตาเหมือนโคลนที่สมบูรณ์ทุกประการ

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

**ฝั่งเซิร์ฟเวอร์อยู่นอกขอบเขตโดยชัดแจ้ง** ตามการตัดสินของผู้พัฒนา · รูปที่แม่นของสิ่งที่เหลืออยู่ไม่ใช่
*"ทุกอย่างที่ตัดสินว่าหน้าจอแสดงอะไรถูกส่งมาที่เบราว์เซอร์"* — เซิร์ฟเวอร์ตัดสิน variant · feature flag ·
สถานะสิทธิ์ · markup ตั้งต้น แล้วส่งมาแค่*ผลลัพธ์*ได้ · คำกล่าวที่ยืนได้แคบกว่านั้นและคือคำกล่าวที่แผนนี้ใช้

> ทุกสิ่งที่จำเป็นต่อการสร้าง**การรันฝั่ง client ที่สังเกตเห็นได้ สำหรับสถานะเซิร์ฟเวอร์ที่ถูก capture ไว้**
> ต้องมีอยู่หรือสังเกตได้ที่เส้นแบ่งฝั่ง client

ด้วยเหตุผลเดียวกัน เกณฑ์ในหัวข้อนี้คือ **ความสมบูรณ์เชิงพฤติกรรมสำหรับ scenario ที่ capture ไว้**
ไม่ใช่ "codebase ฝั่ง client สมบูรณ์" · §4.3 กับ §7 จำกัดมันไว้แบบนั้นอยู่แล้ว และ §1 ที่อ้างมากกว่านั้น
ก็จะขัดกับสองหัวข้อนั้นเปล่า ๆ

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
| ชื่อรอดแม้ในที่ที่ซอร์สไม่รอด | `names[]` ระบุ 7,397–9,006 และ **5,775–7,005 (78%) ถูกอ้างโดย mapping จริง** · สัดส่วน segment ที่พกชื่อคือ **24.7% บน `www.chaingpt.org` เทียบกับ 70.4% บน `labs`** | แมปใน archive |
| ชื่อ property ที่สังเกตว่ารอดการย่อส่วน | 6,390–10,791 ตัวที่ต่างกัน **ใน build ที่ capture มาเหล่านี้** — property mangling มีอยู่จริง และที่อื่นตัวเลขนี้จะลดลง | เนื้อสคริปต์ |

**การ hook ที่ชั้น API ของเบราว์เซอร์ไม่ผูกกับไลบรารี และนั่นคือเหตุผลที่มันทนทาน** · `THREE` ไม่ได้เป็น global บน
`www.chaingpt.org` เพราะหน้าโหลด `three.module.min.js` เป็น ES module — และ shader ยังถูกจับได้ครบ
เพราะสุดท้ายทุกอย่างต้องผ่าน WebGL

**รายงานจำนวนที่ถูกอ้างและสัดส่วน segment ห้ามรายงานยอดรวมที่ระบุไว้** · entry ใน `names[]` เป็น identifier
ต้นฉบับก็จริง แต่ 22% ของมันไม่ถูกอ้างโดย mapping ที่เราคลายได้เลย และสัดส่วน segment — ตัวเลขที่ตัดสินว่า
ตำแหน่งหนึ่งตอนรันจะได้ชื่อหรือไม่ — ต่างกันเกือบสามเท่าระหว่างสองเว็บที่วัดวันเดียวกัน · ตัวเลขหัวเรื่องตัวเดียวกลบเรื่องนั้น

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

ทุกฟิลด์ลงเอยเป็น `equal` · `allowed` · `different` · `unobserved` และ **`unobserved` ไม่เคยนับเป็น equal**

**ความครอบคลุมเป็นเวกเตอร์ ไม่ใช่คะแนน และถูกเผยแพร่เคียงข้างคำตัดสิน** — ตัวเลขเดียวจะเฉลี่ยกลบมิติที่อ่อนที่สุดพอดี

```
equivalence: PASS
coverage:
  scroll               100%
  interaction           38%
  listener_execution    21%
  canvas_realms        100%
  webgl_programs       100%
  visual_checkpoints    72%
```

เขียวแปลว่า "สมมูลสำหรับ scenario เหล่านี้และ realm ที่สังเกต" ไม่เคยแปลว่า "สมมูลสำหรับทุก input ที่เป็นไปได้" ·
**คำตัดสินเขียวที่ความครอบคลุมต่ำไม่ใช่ความสำเร็จของโคลน มันคือคำกล่าวเล็ก ๆ ที่รายงานอย่างถูกต้อง**

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
| 7 | **การกู้คืนสัญลักษณ์** | อัตลักษณ์ของสัญลักษณ์ในไฟล์ที่ generate · การกู้ชื่อเดิมจาก `names[]` · การจับคู่บริเวณกับ build ของไลบรารีที่เผยแพร่ · ชื่อพ้องเชิงความหมายจากการสังเกตตอนรัน — แต่ละอย่างมีระดับการสืบย้อนของตัวเอง | bundle ที่ไม่มีแมปทิ้ง agent ไว้ที่ `chunk-29f3a.js:1:4902` · และที่แย่กว่าคือชื่อที่อนุมานถูกนำเสนอเป็นชื่อต้นฉบับ | 5 · 6 |
| 8 | **กราฟหลักฐาน** | ตัวเชื่อม ค้นได้ในก้าวเดียว | ระบบย่อยแปดตัวที่ทำงานถูกทุกตัวแต่ผลลัพธ์ตอบคำถามไม่ได้ | ทั้งหมด |

**สไลซ์ 7 อยู่ใน "ไม่ได้ตัดสิน" ในร่างแรกและถูกเลื่อนขั้นมาที่นี่** เพราะแหล่งตั้งชื่อสี่ชั้นกลายเป็นสิ่งที่วัดได้
ไม่ใช่การคาดเดา และสามในสี่ชั้นคืน*ข้อเท็จจริง*: ตาราง `names[]` · ชื่อ property ที่รอดการย่อส่วน ·
และ build ของไลบรารีที่เผยแพร่ซึ่งจับคู่ได้ตรง ๆ · ถ้าไม่ทำเป็นสไลซ์ มันจะกลายเป็นของมีก็ดี — และสำหรับ
ความเข้าใจของ agent บนเว็บที่ไม่มีแมป มันเกือบจะเป็นตัวผลิตภัณฑ์ทั้งหมด

**ชนิดโหนดของสไลซ์ 8 ไม่ได้มีแค่ที่ระบุข้างบน** · ตัวเชื่อมต้องพก `scenario` · `interaction` ·
`runtime event` · `symbol` · `visual checkpoint` · `network transaction` เป็นชั้นหนึ่ง ไม่งั้นคำถามที่เป็น
แรงจูงใจของทั้งแผนก็เดินไม่ได้

```
บริเวณ → shader → uniform → ตัวเขียนตอนรัน → listener ของ pointermove → สัญลักษณ์ → ซอร์ส
```

นั่นคือรูปของ *"ทำไมพื้นหลัง hero ถึงบิดตอนขยับเมาส์"* และทุกก้าวในนั้นคือเส้นเชื่อมที่สไลซ์ก่อนหน้าผลิตขึ้น

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
| `runtime-generated` | สิ่งประดิษฐ์นั้นมีอยู่เฉพาะตอนรัน | GLSL 82 KB |

**`runtime-generated` เป็นโซ่ ไม่ใช่ทางตัน** · ตัวสิ่งประดิษฐ์เองไม่มีพิกัดต้นฉบับ — แต่*เหตุการณ์ที่สร้างมัน*มี
และนั่นคือสิ่งที่กราฟเก็บ

```
Shader #S19          runtime-generated
  generated_by       three.module.min.js:12:326662
  resolved_to        three.module.js:18723:4        original-source
```

การบอกว่าการสืบย้อน "จบ" ที่การเรียก JavaScript พูดน้อยกว่าสิ่งที่วัดได้แล้ว: การเรียกที่ประกอบ GLSL ขึ้นมา
คลายไปหาบรรทัดต้นฉบับได้เหมือนอย่างอื่น

`www.firecrawl.dev` ประกาศ sourcemap 69 ตัวและ 404 ไป 51 จาก 52 ที่ร้องขอ · **เครื่องมือที่มีค่าเฉพาะเมื่อมีแมป
จะไร้ประโยชน์บนเว็บ production ส่วนใหญ่** · สามระดับนี้จึงเป็นสัญญา ไม่ใช่ทางเสื่อมที่มาแปะทีหลัง

สไลซ์ 7 เพิ่มแกนที่สองซึ่งตั้งฉากกัน สำหรับ*ชื่อ* — `original-name` (จาก `names[]`) ·
`structurally-recovered` (จับคู่กับ build ของไลบรารีที่เผยแพร่) · `runtime-semantic` (อนุมานจากพฤติกรรมที่สังเกต) ·
`static-semantic` (อนุมานจากชื่อ property ที่รอด) · `model-hypothesis` ·
**ชื่อที่อนุมานไม่เคยถูกเขียนทับลงในตำแหน่งของชื่อต้นฉบับ**

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
ไม่พูดอะไรเลยเกี่ยวกับ click listener 242 ตัว · เกณฑ์ใน §1 จริงได้เท่าที่ driver ครบเท่านั้น ·
ด่านจึงต้องเผยแพร่เวกเตอร์ความครอบคลุมเคียงข้างคำตัดสิน และตัวเลขความครอบคลุมที่ไม่ขยับคือสัญญาณว่าเกณฑ์
กำลังถูกอ้างเกินจริง

**instrumentation เปลี่ยนสิ่งที่มันสังเกตได้ และด่านมองไม่เห็นเรื่องนั้น** · การเทียบสดที่ instrument กับ replay
ที่ instrument คือการเทียบสองหน้าที่พก hook เหมือนกัน — ชุด hook ที่เลื่อนเฟส rAF · ลำดับการเรียก · หรือจังหวะ
microtask จึงผลิตความเห็นตรงกันระหว่างสองหน้าที่ไม่มีผู้ใช้คนไหนโหลด · ตัวควบคุมที่ด่านต้องมีคือการรันที่สาม:
**instrument เทียบกับไม่ instrument บนฝั่งเดียวกัน** พร้อม budget ของการรบกวนที่ระบุไว้

วัดบน `www.chaingpt.org` โดย replay จาก archive เดียวกันสองครั้ง มี hook บน `shaderSource` ·
`getContext` · `addEventListener` — ดักการลงทะเบียน listener 1,510 ครั้ง

| | ไม่ instrument | instrument แล้ว |
|---|---|---|
| `load` | 4,171 ms | 3,361 ms |
| เฟรม rAF ในหนึ่งวินาที | 61 | 60 |
| motion เมื่อนิ่งแล้ว | `12 / 190 / 38` | `12 / 190 / 38` |

**ผลกระทบอยู่ใต้สัญญาณรบกวนระหว่างรันในกรณีนี้ — รอบที่ instrument เป็นรอบที่เร็วกว่าด้วยซ้ำ** · นั่นคือ
ตัวเลขฐาน ไม่ใช่การปัดตก: ชุด hook ตั้งใจจะโตไปถึง WebAudio · observer · mutation และการห่อ
`requestAnimationFrame` คือส่วนเพิ่มที่มีกลไกทำให้เพี้ยนได้จริง · budget มีไว้เพื่อให้การเติบโตนั้นถูกวัด
แทนที่จะถูกสมมติว่าไม่เป็นไร

---

## 8. สิ่งที่แผนนี้ไม่ได้ตัดสิน

- ~~ภาษาของ scenario สำหรับสไลซ์ 3~~ — **ตัดสินแล้ว: แบบผสม** · action ที่เป็นตัวเลือกถูก*ค้นพบ*จากหน้า
  (listener · role · ลิงก์ · ปุ่ม · ลำดับ tab · `cursor: pointer` · canvas · container ที่เลื่อนได้) แล้ว
  *scenario* ถูกเขียนทับบนนั้น โดยระบุเจตนาและจุดตรวจ · ครึ่งเดียวไม่พอทั้งคู่: การค้นพบโดยไม่มีคนเขียนคือ
  autopilot คลิกทุกอย่างที่แผน pipeline ตัดไปแล้ว ส่วนการเขียนโดยไม่มีการค้นพบก็ไม่รู้ว่าหน้ามีอะไรให้เล่น · รูปร่าง

  ```yaml
  scenario: hero_exploration
  steps:
    - navigate: /
    - wait_for: stable
    - pointer:  { target: hero_canvas, trajectory: center_sweep }
    - scroll:   { target: section_2, progress: [0, .25, .5, .75, 1] }
    - hover:    { target: portfolio_card_1 }
  checkpoints: [hero_initial, hero_mouse_center, section2_mid_scroll]
  ```

  สิ่งที่ยังเปิดอยู่แคบกว่านั้น: ครึ่งที่ค้นพบจะเสนอ scenario ให้ผู้ปฏิบัติงานรับ หรือเพียงจัดหาคำศัพท์
  ให้คนเขียนใช้เท่านั้น
- กราฟหลักฐานเป็น artifact ใน archive หรือคำนวณตอน serve
- ~~ทางถอยของการ de-minify~~ — **เลื่อนขั้นเป็นสไลซ์ 7** พร้อมแกนการสืบย้อนของตัวเอง · สิ่งที่ยังเปิดอยู่
  ข้างในมัน: `model-hypothesis` ได้รับอนุญาตหรือไม่ และถ้าได้ มันแสดงโดยไม่มีการสังเกตที่ผลิตมันได้ไหม
- fixture จะโตขึ้นให้มีเคส WebGL/3D/การโต้ตอบ หรือจะเพิ่ม fixture site ตัวที่สองสำหรับเรื่องนี้
<!-- lang:end -->
