<!-- lang:en -->
# Ubiquitous Language

Canonical term glossary for clone-space. When a term appears in **bold**, use it exactly as
written — in code identifiers, PR descriptions, issue titles, and conversation. A concept
missing here is a signal: either you are inventing language the project does not use, or there
is a real gap worth modelling.

`docs/agents/domain.md` defers to this file on any conflict.

> Writing this glossary in Thai follows the mixed vocabulary in `CLAUDE.md` — some terms stay
> English, some are Thai, and none are invented.

## Pipeline stages

The four stages are distinct and ordered. They are not synonyms for each other, and none of them
is "scraping".

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **capture** | The stage that drives a live page in a real browser and writes an **archive**. | scrape, crawl, download, save |
| **replay** | The stage that serves an **archive** offline and navigates the original URL so the page's own JavaScript runs again. | playback, restore, render |
| **extract** | The stage that runs against a **replay pass** and produces a **behavior graph**. | parse, analyse, scan |
| **serve** | The stage that exposes a **behavior graph** to a reader over MCP. | host, publish, expose |

## Artifacts

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **archive** | The on-disk artifact set one **capture run** produces. | dump, snapshot, backup, capture (as a noun) |
| **behavior graph** | The extracted semantic description of a page — animations with target, trigger, timing, easing and library, plus styles and listeners. | analysis, model, AST, DOM |
| **identity snapshot** | `identity.json` — one **fingerprint** per **wa: id** for one run. | id map, id list, DOM snapshot |
| **interaction transcript** | The recorded sequence of manual interactions performed during **capture**, stored so it could be replayed. | session, recording, trace |
| **fixture** | `test/fixtures/motion-site` — the controlled site whose contents are declared, used as **ground truth**. | test site, demo page, sample |
| **fixture manifest** | `fixture-manifest.json` — the single **source of truth** for what the **fixture** declares. | manifest (unqualified), spec, index |
| **tool manifest** | The MCP server's small (<50 KB) index that a reader loads before drilling down. | manifest (unqualified), catalogue |

## Element identity

The subdomain where a wrong word produces wrong code.

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **element identity** | The scheme by which one element is named and recognised across runs. | id scheme, addressing, selector |
| **wa: id** | `wa:<frame-key>:<sequence>` — a **handle** naming one element **within a single run**. | key, identifier, uuid, selector |
| **frame key** | The path identifying which document an element lives in; top frame is `0`, nesting extends it. | frame id, document id |
| **sequence** | The per-frame counter assigned in preorder at document start and by `MutationObserver` afterwards. | index, order, position |
| **fingerprint** | The structural description — tag, stable **attribute** subset, sibling ordinal, text hash, **โหนดแม่** — by which an element is recognised in a *different* run. | signature, hash, checksum |
| **fingerprint key** | The string two elements must share to be candidates for the same element. | hash, bucket |
| **ตัวจับคู่** | The component that decides which **replay** element is which **capture** element. | matcher, mapper, resolver |
| **match** | One resolved pair of **wa: ids**, capture side to replay side. | mapping, link |
| **identity-unresolved** | The explicit result meaning an element could not be identified, carrying its candidate list. | unknown, failed, null, skipped |
| **replay-only** | An element **replay** produced that **capture** never saw. | extra, orphan, noise |

## Verification

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **ground truth** | What the **fixture manifest** declares, against which any extracted result is judged. | expected, baseline, reference |
| **spike question** | A measurement that must be answered before an interface can be designed around it. | research, investigation, POC |
| **blocking** | Said of a **spike question** whose answer changes a v1 interface. | important, urgent, priority |
| **sweep** | The scripted scrolling during **capture** that triggers lazily-loaded content. | scroll, crawl, walk |
| **quiet window** | The custom settle detection used instead of `networkidle`, which never fires on a polling page. | idle, settled, ready |
| **ship gate** | `bun run verify` — lint, typecheck, unit tests, build — run before a merge. | CI, checks, pipeline |

## Relationships

- A **capture run** produces exactly one **archive**.
- An **archive** contains exactly one **identity snapshot**, one HAR, and at most one **interaction transcript**.
- A **replay pass** reads exactly one **archive** and re-executes the original JavaScript.
- **extract** runs against a **replay pass**, never against **capture**, so it is deterministic and re-runnable.
- **extract** produces one **behavior graph**, whose every node references a **wa: id**.
- The **ตัวจับคู่** compares two **identity snapshots** and produces **matches**, **identity-unresolved** entries, and **replay-only** ids — never a guess.
- A **wa: id** is unique within one run and meaningless across two; only a **fingerprint** crosses that boundary.

## Example dialogue

> **Dev:** "The **archive** has 340 elements and **replay** produced 340. Can I just join them on **wa: id**?"

> **Domain expert:** "No — a **wa: id** is a **handle**, not a key. **replay** re-executes the page's own JavaScript, so the **sequence** counter lands somewhere else. Join on **fingerprint key** and let the **ตัวจับคู่** resolve the rest."

> **Dev:** "Then what happens to the three identical `<li>`? Their **fingerprints** must collide."

> **Domain expert:** "Sibling ordinal separates those. The one that genuinely collides is delete-and-reinsert — the element left and an identical one came back, so **replay** logged two candidates. That comes back as **identity-unresolved** with both candidates listed."

> **Dev:** "Can't the **ตัวจับคู่** just pick the first one? It's right most of the time."

> **Domain expert:** "That is the failure this design exists to prevent. A wrong **match** becomes mis-attributed animation data in the **behavior graph** three stages later, with nothing left to signal it. **identity-unresolved** is the feature."

> **Dev:** "Understood. And if the extractor reports 12 animations, how do I know that's all of them?"

> **Domain expert:** "Against a real page you don't. That is why every exit criterion is checked against the **fixture** — the **fixture manifest** is the **ground truth**, so 12-of-12 and 12-of-30 are distinguishable."

## Flagged ambiguities

- **"snapshot"** was used for three unrelated things: the CDP call `DOMSnapshot.captureSnapshot`, the **identity snapshot**, and the `SNAPSHOT` doc status. **Never use it unqualified.** Say `DOMSnapshot.captureSnapshot` for the CDP call, **identity snapshot** for `identity.json`, and `SNAPSHOT` only as a doc status.
- **"manifest"** was used for two unrelated artifacts. **fixture manifest** is what the **fixture** declares; **tool manifest** is what the MCP server serves first. Unqualified "manifest" is a defect.
- **"id"** was read as a cross-run key. It is not: a **wa: id** is a **handle** within one run. Reading it as a key produces a **ตัวจับคู่** that compares strings and reports total failure on a good **archive**.
- **"capture"** was used as both a stage and a noun for its output. The stage is **capture**; its output is an **archive**.
- **"archive"** was used as a verb. The verb is **capture**.
- **"pure"** — write `pure function` in English. A Thai calque for it communicates nothing; see the glossary in `CLAUDE.md`.
<!-- lang:end -->

<!-- lang:th -->
# Ubiquitous Language — คำศัพท์มาตรฐาน

อภิธานศัพท์หลักของ clone-space เมื่อคำใดปรากฏเป็น **ตัวหนา** ให้ใช้ตรงตามนั้นเป๊ะ — ทั้งใน identifier ของโค้ด
คำอธิบาย PR หัวข้อ issue และบทสนทนา แนวคิดที่หายไปจากที่นี่คือสัญญาณ: ไม่คุณกำลังประดิษฐ์คำที่โปรเจกต์ไม่ได้ใช้
ก็มีช่องว่างจริงที่ควรเอามาสร้างแบบจำลอง

`docs/agents/domain.md` ยึดตามไฟล์นี้เมื่อขัดกัน

> การเขียนอภิธานศัพท์นี้เป็นภาษาไทยเป็นไปตาม glossary ผสมใน `CLAUDE.md` — บางคำคงเป็นอังกฤษ บางคำเป็นไทย
> และไม่มีคำไหนถูกประดิษฐ์ขึ้นเอง

## Stage ของ pipeline

ทั้งสี่ stage แยกจากกันและมีลำดับ ไม่ใช่คำพ้องของกันและกัน และไม่มี stage ไหนที่เป็น "scraping"

| คำ | นิยาม | คำพ้องที่ห้ามใช้ |
| --- | --- | --- |
| **capture** | stage ที่ขับหน้าเว็บจริงในเบราว์เซอร์จริงแล้วเขียน **archive** ออกมา | scrape, crawl, download, save |
| **replay** | stage ที่เสิร์ฟ **archive** แบบออฟไลน์และเปิด URL เดิม เพื่อให้ JavaScript ของหน้านั้นทำงานอีกครั้ง | playback, restore, render |
| **extract** | stage ที่ทำงานกับ **replay pass** แล้วผลิต **behavior graph** | parse, analyse, scan |
| **serve** | stage ที่เปิด **behavior graph** ให้ผู้อ่านเข้าถึงผ่าน MCP | host, publish, expose |

## Artifact

| คำ | นิยาม | คำพ้องที่ห้ามใช้ |
| --- | --- | --- |
| **archive** | ชุด artifact บนดิสก์ที่ **capture run** หนึ่งครั้งผลิตออกมา | dump, snapshot, backup, capture (ในฐานะคำนาม) |
| **behavior graph** | คำบรรยายเชิงความหมายของหน้าเว็บที่สกัดออกมา — animation พร้อมเป้าหมาย, trigger, timing, easing และไลบรารี บวกกับ style และ listener | analysis, model, AST, DOM |
| **identity snapshot** | `identity.json` — **fingerprint** หนึ่งชุดต่อหนึ่ง **wa: id** ของการรันหนึ่งรอบ | id map, id list, DOM snapshot |
| **interaction transcript** | ลำดับการโต้ตอบด้วยมือที่ถูกบันทึกไว้ระหว่าง **capture** เก็บไว้เผื่อนำมาเล่นซ้ำ | session, recording, trace |
| **fixture** | `test/fixtures/motion-site` — เว็บที่ควบคุมได้ซึ่งประกาศเนื้อหาของตัวเองไว้ ใช้เป็น **ground truth** | test site, demo page, sample |
| **fixture manifest** | `fixture-manifest.json` — **source of truth** เพียงแหล่งเดียวว่า **fixture** ประกาศอะไรไว้ | manifest (ลอยๆ), spec, index |
| **tool manifest** | ดัชนีขนาดเล็ก (ต่ำกว่า 50 KB) ของ MCP server ที่ผู้อ่านโหลดก่อนจะเจาะลงรายละเอียด | manifest (ลอยๆ), catalogue |

## Element identity

subdomain ที่ใช้คำผิดแล้วจะได้โค้ดผิด

| คำ | นิยาม | คำพ้องที่ห้ามใช้ |
| --- | --- | --- |
| **element identity** | ระบบที่ใช้ตั้งชื่อ element และจดจำมันข้ามรอบการรัน | id scheme, addressing, selector |
| **wa: id** | `wa:<frame-key>:<sequence>` — **handle** ที่ตั้งชื่อ element หนึ่งตัว **ภายในการรันรอบเดียว** | key, identifier, uuid, selector |
| **frame key** | เส้นทางที่ระบุว่า element อยู่ในเอกสารใด เฟรมบนสุดคือ `0` การซ้อนกันจะต่อเพิ่ม | frame id, document id |
| **sequence** | ตัวนับต่อหนึ่งเฟรม กำหนดแบบ preorder ตอนเอกสารเริ่ม และกำหนดโดย `MutationObserver` หลังจากนั้น | index, order, position |
| **fingerprint** | คำบรรยายเชิงโครงสร้าง — tag, ชุด **attribute** ที่ไม่เปลี่ยน, ลำดับในหมู่พี่น้อง, hash ของข้อความ, **โหนดแม่** — ที่ใช้จดจำ element ในการรัน*คนละรอบ* | signature, hash, checksum |
| **fingerprint key** | สตริงที่ element สองตัวต้องมีตรงกันจึงจะเป็นตัวเลือกของ element เดียวกันได้ | hash, bucket |
| **ตัวจับคู่** | ส่วนที่ตัดสินว่า element ฝั่ง **replay** ตัวไหนคือ element ฝั่ง **capture** ตัวไหน | matcher, mapper, resolver |
| **match** | คู่ **wa: id** ที่จับคู่สำเร็จหนึ่งคู่ ฝั่ง capture ต่อฝั่ง replay | mapping, link |
| **identity-unresolved** | ผลลัพธ์ที่ระบุชัดว่าระบุตัว element ไม่ได้ พร้อมพกรายการตัวเลือกไปด้วย | unknown, failed, null, skipped |
| **replay-only** | element ที่ **replay** ผลิตออกมา แต่ **capture** ไม่เคยเห็น | extra, orphan, noise |

## การพิสูจน์

| คำ | นิยาม | คำพ้องที่ห้ามใช้ |
| --- | --- | --- |
| **ground truth** | สิ่งที่ **fixture manifest** ประกาศไว้ ใช้เป็นเกณฑ์ตัดสินผลลัพธ์ที่สกัดออกมา | expected, baseline, reference |
| **spike question** | การวัดที่ต้องได้คำตอบก่อน จึงจะออกแบบ interface รอบมันได้ | research, investigation, POC |
| **blocking** | ใช้กับ **spike question** ที่คำตอบของมันเปลี่ยน interface ของ v1 | important, urgent, priority |
| **sweep** | การเลื่อนหน้าจอตามสคริปต์ระหว่าง **capture** เพื่อกระตุ้นเนื้อหาที่โหลดแบบ lazy | scroll, crawl, walk |
| **quiet window** | การตรวจว่าหน้านิ่งแล้วแบบที่เขียนเอง ใช้แทน `networkidle` ซึ่งไม่มีวันเกิดบนหน้าที่ poll ตลอด | idle, settled, ready |
| **ship gate** | `bun run verify` — lint, typecheck, unit test, build — รันก่อน merge | CI, checks, pipeline |

## ความสัมพันธ์

- **capture run** หนึ่งครั้งผลิต **archive** พอดีหนึ่งอัน
- **archive** หนึ่งอันบรรจุ **identity snapshot** พอดีหนึ่งอัน, HAR หนึ่งไฟล์ และ **interaction transcript** อย่างมากหนึ่งอัน
- **replay pass** หนึ่งครั้งอ่าน **archive** พอดีหนึ่งอัน และรัน JavaScript เดิมซ้ำ
- **extract** ทำงานกับ **replay pass** ไม่ใช่กับ **capture** มันจึง deterministic และรันซ้ำได้
- **extract** ผลิต **behavior graph** หนึ่งอัน ซึ่งทุกโหนดในนั้นอ้างถึง **wa: id**
- **ตัวจับคู่** เทียบ **identity snapshot** สองอัน แล้วผลิต **match**, รายการ **identity-unresolved** และ **wa: id** ที่เป็น **replay-only** ออกมา — ไม่เดาเด็ดขาด
- **wa: id** ไม่ซ้ำภายในการรันรอบเดียว และไม่มีความหมายข้ามสองรอบ มีแต่ **fingerprint** เท่านั้นที่ข้ามเส้นนั้นได้

## บทสนทนาตัวอย่าง

> **Dev:** "ใน **archive** มี element 340 ตัว แล้ว **replay** ก็ได้ 340 ตัว ผม join ด้วย **wa: id** เลยได้ไหม"

> **Domain expert:** "ไม่ได้ — **wa: id** เป็น **handle** ไม่ใช่กุญแจ **replay** รัน JavaScript ของหน้านั้นซ้ำ ตัวนับ **sequence** จึงไปหยุดที่อื่น ให้ join ด้วย **fingerprint key** แล้วปล่อยให้ **ตัวจับคู่** จัดการที่เหลือ"

> **Dev:** "แล้ว `<li>` สามตัวที่เหมือนกันล่ะ **fingerprint** ของมันต้องชนกันแน่ๆ"

> **Domain expert:** "ลำดับในหมู่พี่น้องแยกพวกนั้นออกได้ ตัวที่ชนกันจริงคือเคสลบแล้วแทรกกลับ — element ออกไปแล้วตัวที่เหมือนกันเป๊ะกลับเข้ามา **replay** จึงบันทึกตัวเลือกไว้สองตัว เคสนั้นจะกลับมาเป็น **identity-unresolved** พร้อมรายการตัวเลือกทั้งสอง"

> **Dev:** "ให้ **ตัวจับคู่** เลือกตัวแรกไปเลยไม่ได้เหรอ ส่วนใหญ่มันก็ถูก"

> **Domain expert:** "นั่นคือความล้มเหลวที่การออกแบบนี้มีไว้ป้องกัน **match** ที่ผิดจะกลายเป็นข้อมูล animation ที่ถูกโยงผิดตัวใน **behavior graph** อีกสาม stage ถัดไป โดยไม่เหลืออะไรให้ส่งสัญญาณเตือน **identity-unresolved** คือฟีเจอร์"

> **Dev:** "เข้าใจแล้ว แล้วถ้า extractor รายงานว่าเจอ animation 12 ตัว ผมจะรู้ได้ยังไงว่านั่นคือทั้งหมด"

> **Domain expert:** "ถ้าเป็นหน้าเว็บจริงคุณไม่มีทางรู้ นั่นคือเหตุผลที่เกณฑ์ผ่านทุกข้อถูกตรวจกับ **fixture** — **fixture manifest** คือ **ground truth** ดังนั้น 12 จาก 12 กับ 12 จาก 30 จึงแยกออกจากกันได้"

## คำกำกวมที่ต้องระวัง

- **"snapshot"** ถูกใช้กับสามสิ่งที่ไม่เกี่ยวกันเลย: คำสั่ง CDP `DOMSnapshot.captureSnapshot`, **identity snapshot** และสถานะเอกสาร `SNAPSHOT` **ห้ามใช้คำนี้ลอยๆ เด็ดขาด** ให้พูดว่า `DOMSnapshot.captureSnapshot` สำหรับคำสั่ง CDP, **identity snapshot** สำหรับ `identity.json` และใช้ `SNAPSHOT` เฉพาะในฐานะสถานะเอกสารเท่านั้น
- **"manifest"** ถูกใช้กับ artifact สองอย่างที่ไม่เกี่ยวกัน **fixture manifest** คือสิ่งที่ **fixture** ประกาศไว้ ส่วน **tool manifest** คือสิ่งที่ MCP server เสิร์ฟให้ก่อน การพูดว่า "manifest" ลอยๆ ถือเป็นข้อผิดพลาด
- **"id"** เคยถูกอ่านว่าเป็นกุญแจข้ามรอบ ซึ่งไม่ใช่: **wa: id** เป็น **handle** ภายในรอบเดียว การอ่านว่าเป็นกุญแจจะได้ **ตัวจับคู่** ที่เทียบสตริงแล้วรายงานว่าล้มเหลวทั้งหมด ทั้งที่ **archive** ดีอยู่
- **"capture"** ถูกใช้ทั้งในฐานะ stage และในฐานะคำนามของผลลัพธ์ ตัว stage คือ **capture** ส่วนผลลัพธ์คือ **archive**
- **"archive"** ถูกใช้เป็นคำกริยา คำกริยาที่ถูกคือ **capture**
- **"pure"** — ให้เขียนว่า `pure function` เป็นภาษาอังกฤษ คำแปลไทยที่ประดิษฐ์ขึ้นสื่อสารอะไรไม่ได้ ดู glossary ใน `CLAUDE.md`
<!-- lang:end -->
