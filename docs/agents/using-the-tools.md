<!-- lang:en -->
# Using the tools

What a T4 team member calls, in what order, what comes back — and, in equal detail, **what it cannot
answer.** Every number here was measured; where a limit is stated, the measurement that found it is
named beside it.

## The four tools, in order

| Tool | Runtime | Answers |
|---|---|---|
| `capture_page` | Node | archive this URL |
| `replay_page` | Node | does the archive run offline |
| `extract_behaviour` | Node | what moves, what drives it, **which line** |
| `inspect_archive` | Bun | what is in the archive, and is it complete |

The order is not a suggestion. `extract_behaviour` runs the page in a replay, because a GSAP
timeline is written down nowhere in the archive — it exists only once the page's own JavaScript has
built it. Reading the HAR could recover the source text that *might* create motion; running the page
recovers the motion that *did*.

## Before pointing it at anything: what it will not do

**`capture_page` does not redact response bodies** (ADR 0009). It redacts credentials in requests,
not the contents of what came back. **Do not point it at an authenticated page, an internal tool, or
anything behind a login.** The archive is a full copy of what the browser received.

**The interaction driver refuses to activate** anything it judges consequential, and records the
rule and the fact that tripped it: cross-origin, downloads, new browsing contexts, file pickers,
navigation, form submission, and controls whose text reads as authentication or destruction —
English and Thai. Hover, focus and scroll are still driven on a refused element, because none of
them can submit or navigate.

**Two things the policy cannot catch, and no structural rule can:** a `type="button"` whose handler
calls `requestSubmit()`, and an `href="#x"` whose handler issues a `DELETE`. Their consequence lives
entirely in JavaScript that no discovered attribute describes. Treat an unfamiliar site as
production and capture a staging copy where one exists.

**`capture_page` refuses to publish an archive served from a private address** (#162) — loopback,
link-local (the whole of `fe80::/10`), private, unique-local, unspecified, or the CGNAT-shared
`100.64.0.0/10` a Tailscale peer answers from — unless you pass `allowPrivateNetwork`. The check
reads each HAR entry's `serverIPAddress`, which is the address a connection actually went to, so it
covers a subresource the page fetched itself as well as the URL you asked for. **The whole capture
is discarded, not the offending entry**, and one entry is enough: a public page with a single
leftover `http://127.0.0.1/…` beacon fails, and the fix is to re-run with the flag once you have
decided that reaching your own network is what you meant. Capturing this repo's fixture site, which
runs on localhost, needs the flag for the same reason.

**A WebSocket is covered by a weaker rule, and the gap that leaves is worth knowing.** Its HAR
entry carries no `serverIPAddress` at all, so the address check cannot see it (#185). A socket
whose URL host is already an **IP literal** — `ws://127.0.0.1/`, `wss://[fe80::1]/` — is refused on
that host. A socket to a **hostname** is not: resolving one at publish time would be a lookup at a
moment that is not the moment the socket opened, which is the thing this whole refusal exists
because it could not rely on. Frames are redacted for credential material either way.

## What "which line" actually returns

`extract_behaviour` reports each compiled shader with `origin` — where the runtime says the call
came from — and `original`, that same point carried back through a sourcemap **the archive
captured**. Measured on `https://www.chaingpt.org/`, 6 shaders, 6 cited:

```
origin    cdn.jsdelivr.net/npm/three@v0.151.3/build/three.module.min.js:12:326662
original  /npm/three@0.151.2/build/three.module.js:18723:5

  18721 | 	const shader = gl.createShader( type );
  18722 |
  18723 | 	gl.shaderSource( shader, string );
  18724 | 	gl.compileShader( shader );
```

`origin` names line 12 of a file with about fifteen lines. That is what a runtime position is worth
before this step.

**`original` is absent whenever the archive holds no usable map for that script, and that is
common.** Nothing is fetched to fill the gap: a map the capture did not take cannot be obtained
later, and going to the network would make an offline artifact quietly depend on the site still
being up. An absent citation is the honest answer; a fabricated one is not checkable, which defeats
the point of citing at all.

## The limits, measured

**A CSS transition is not in the behaviour graph.** The graph reports what
`document.getAnimations()` knows plus GSAP's own registries, and a transition enters
`getAnimations()` only while it is actually running. Replayed and scrolled to the bottom:

| | `www.firecrawl.dev` | `www.chaingpt.org` |
|---|---|---|
| nodes in the graph | 12 | 121 |
| `document.getAnimations()` | 12 | 12 |
| elements with a CSS transition | **318** | **1,028** |

The first two rows match exactly — the extractor misses nothing the browser tracks. The third is the
limit, and it is why every graph carries `unrepresented.cssTransitionElements`. **Read it.** A page
animated with Tailwind or Framer transitions will report a small node count and not be a still page.

**Interaction is bounded and the bounds are reported.** `truncated` says per kind how many actions
the caps dropped; on a real page that number is large. A plan reaching 32 actions on a site with 400
candidates is covering a fraction, and `coverage.interaction` in the equivalence gate reports what
was actually driven, not what was planned.

**A selector is a position, not an identity.** Measured on `www.firecrawl.dev`: the document grew by
~200 elements while a 32-action plan ran and 28 of 32 selectors stopped resolving. The driver
re-reads each element's facts and re-runs the policy before activating, so a stale target is a
recorded skip rather than a wrong click — but it is still a skip, and it shows up in the coverage.

## Reading a result honestly

- `termination.json` — `complete` on a quiet window, or `incomplete` with a reason. An archive that
  terminated on a budget is a partial page, and the graph extracted from it is partial too.
- `aborted` on a replay — requests the archive could not serve. A graph from a replay that could not
  serve everything describes a page that did not fully run.
- `dropped` on the observation summary — the in-page buffer overflowed. Non-zero means the summary
  is missing observations, and the count is how many.
- `unrepresented` on the graph — see above.
- `coverage` on an equivalence report — a vector, never a score. A green verdict at low coverage is a
  small claim correctly reported, not a large one.
- `baselinePasses` on an equivalence report — how many passes the stability control actually had on
  each side, e.g. `{ live: 3, replay: 0 }`. **A `FAIL` is only as good as the side that moves was
  measured.** A group of fewer than two passes cannot show a field varying, and the gate reads that
  as *stable* — so a live-only baseline certifies `layout.scrollHeight`, which is steady at 8544
  across live drives and reads 8486/8544/8486 across replays of one archive. `replay: 0` beside a
  residual means the accusation rests on no replay evidence at all.
- **A replay serves the archive faster than the network did, and some pages notice** (#187). A page
  that measures an element and freezes the result — without ordering that measurement against the
  resource its size depends on — can settle to a layout the live page never produced. Measured on
  `https://labs.chaingpt.org/`: 8544 live, 8486 on roughly one replay in three. `replayArchive`
  takes **`restoreTiming`**, which holds each response until the moment the archive says it
  finished; on the fixture that turns 12/12 divergent replays into 0/12, and on a 146-entry real
  site it took the replay from 825 ms to 4577 ms without failing to load. It is **off by default**,
  because it slows every replay to buy fidelity only pages that race actually need.

**Nothing in this list is decoration.** Each exists because a number without it was measured to read
as a larger claim than the run supported.

<!-- lang:th -->
# การใช้เครื่องมือ

สมาชิกทีม T4 เรียกอะไร ตามลำดับไหน ได้อะไรกลับมา — และในรายละเอียดที่เท่ากัน **มันตอบอะไรไม่ได้บ้าง**
ทุกตัวเลขในนี้ถูกวัดมาแล้ว และทุกที่ที่ระบุข้อจำกัด จะมีการวัดที่พบมันกำกับอยู่ข้าง ๆ

## เครื่องมือสี่ตัว ตามลำดับ

| เครื่องมือ | runtime | ตอบอะไร |
|---|---|---|
| `capture_page` | Node | เก็บ URL นี้เป็น archive |
| `replay_page` | Node | archive รันแบบออฟไลน์ได้ไหม |
| `extract_behaviour` | Node | อะไรเคลื่อนไหว อะไรขับมัน **บรรทัดไหน** |
| `inspect_archive` | Bun | ใน archive มีอะไร และมันสมบูรณ์ไหม |

ลำดับนี้ไม่ใช่ข้อเสนอแนะ · `extract_behaviour` รันหน้าเว็บใน replay เพราะ GSAP timeline ไม่ได้ถูกเขียนไว้ที่ไหนใน
archive เลย — มันมีตัวตนก็ต่อเมื่อ JavaScript ของหน้านั้นสร้างมันขึ้นมาแล้ว · การอ่าน HAR คืนได้แค่ตัวอักษรของโค้ดที่
*อาจจะ*สร้างการเคลื่อนไหว ส่วนการรันหน้าเว็บคืนการเคลื่อนไหวที่*เกิดขึ้นจริง*

## ก่อนจะชี้มันไปที่อะไร: สิ่งที่มันจะไม่ทำ

**`capture_page` ไม่ได้ redact เนื้อหาที่ตอบกลับมา** (ADR 0009) · มัน redact credential ในฝั่ง request ไม่ใช่เนื้อหาของสิ่งที่
ตอบกลับ · **อย่าชี้มันไปที่หน้าที่ต้องยืนยันตัวตน เครื่องมือภายใน หรืออะไรที่อยู่หลัง login** · archive คือสำเนาเต็มของสิ่งที่
เบราว์เซอร์ได้รับ

**driver การโต้ตอบปฏิเสธที่จะกระตุ้น**สิ่งที่มันตัดสินว่ามีผลตามมา และบันทึกกฎกับข้อเท็จจริงที่ทำให้ติดกฎไว้ด้วย:
ข้าม origin · การดาวน์โหลด · การเปิด browsing context ใหม่ · ตัวเลือกไฟล์ · การนำทาง · การส่งฟอร์ม · และตัวควบคุมที่
ข้อความอ่านได้ว่าเป็นการยืนยันตัวตนหรือการทำลาย — ทั้งภาษาอังกฤษและไทย · การ hover · focus · scroll ยังถูกขับบน
element ที่ถูกปฏิเสธ เพราะไม่มีอันไหนส่งฟอร์มหรือนำทางได้

**สองอย่างที่นโยบายจับไม่ได้ และไม่มีกฎเชิงโครงสร้างไหนจับได้:** `type="button"` ที่ handler เรียก `requestSubmit()`
และ `href="#x"` ที่ handler ยิง `DELETE` · ผลของมันอยู่ใน JavaScript ล้วน ๆ ซึ่งไม่มี attribute ที่ค้นพบข้อไหนอธิบายได้ ·
ให้ถือว่าเว็บที่ไม่คุ้นเคยคือ production และ capture สำเนา staging แทนถ้ามี

**`capture_page` ปฏิเสธที่จะเผยแพร่ archive ที่ถูกเสิร์ฟจากที่อยู่ภายใน** (#162) — loopback · link-local (ทั้งบล็อก
`fe80::/10`) · private · unique-local · unspecified หรือ `100.64.0.0/10` แบบ CGNAT-shared ที่ peer ของ Tailscale
ตอบมา — เว้นแต่จะส่ง `allowPrivateNetwork` · การตรวจอ่าน `serverIPAddress` ของแต่ละ entry ใน
HAR ซึ่งเป็นที่อยู่ที่การเชื่อมต่อไปถึงจริง มันจึงครอบคลุม subresource ที่หน้าเว็บเรียกเองพอ ๆ กับ URL ที่คุณสั่ง ·
**capture ทั้งชุดถูกทิ้ง ไม่ใช่แค่ entry ที่ผิด** และแค่ entry เดียวก็พอ: หน้าสาธารณะที่มี beacon ค้าง
`http://127.0.0.1/…` อยู่อันเดียวก็ล้ม และวิธีแก้คือรันใหม่พร้อม flag เมื่อคุณตัดสินใจแล้วว่าการเข้าถึงเครือข่ายของตัวเอง
คือสิ่งที่ตั้งใจ · การ capture เว็บ fixture ของ repo นี้ซึ่งรันบน localhost ก็ต้องใช้ flag ด้วยเหตุผลเดียวกัน

**WebSocket ถูกคุมด้วยกฎที่อ่อนกว่า และช่องว่างที่เหลือควรรู้ไว้** · entry ของมันใน HAR ไม่มี `serverIPAddress`
เลย การตรวจที่อยู่จึงมองไม่เห็นมัน (#185) · socket ที่ host ของ URL เป็น **IP ตรง ๆ** — `ws://127.0.0.1/` ·
`wss://[fe80::1]/` — จะถูกปฏิเสธจาก host นั้น · ส่วน socket ที่ชี้ไป **hostname** ไม่ถูกปฏิเสธ: การ resolve มัน
ตอน publish คือการค้นหา ณ ขณะที่ไม่ใช่ขณะที่ socket เปิด ซึ่งเป็นสิ่งที่การปฏิเสธทั้งหมดนี้มีอยู่เพราะพึ่งมันไม่ได้ ·
frame ถูก redact เรื่อง credential ทั้งสองทาง

## "บรรทัดไหน" คืนอะไรจริง ๆ

`extract_behaviour` รายงาน shader แต่ละตัวพร้อม `origin` — จุดที่ runtime บอกว่าการเรียกมาจากไหน — และ `original`
ซึ่งคือจุดเดียวกันที่ถูกพากลับผ่าน sourcemap **ที่ archive เก็บไว้** · วัดบน `https://www.chaingpt.org/` shader 6 ตัว อ้างได้ 6

```
origin    cdn.jsdelivr.net/npm/three@v0.151.3/build/three.module.min.js:12:326662
original  /npm/three@0.151.2/build/three.module.js:18723:5

  18721 | 	const shader = gl.createShader( type );
  18722 |
  18723 | 	gl.shaderSource( shader, string );
  18724 | 	gl.compileShader( shader );
```

`origin` ชี้บรรทัดที่ 12 ของไฟล์ที่มีราวสิบห้าบรรทัด · นั่นคือค่าของตำแหน่งตอนรันก่อนจะผ่านขั้นนี้

**`original` จะไม่มีเมื่อ archive ไม่มี map ที่ใช้ได้สำหรับ script นั้น และกรณีนั้นพบบ่อย** · ไม่มีการ fetch อะไรมาอุดช่องว่าง:
map ที่ตอน capture ไม่ได้เก็บไว้ก็หามาทีหลังไม่ได้ และการไปดึงจากเน็ตจะทำให้ artifact ออฟไลน์แอบไปขึ้นกับว่าเว็บนั้นยังอยู่
หรือเปล่า · การไม่มีการอ้างอิงคือคำตอบที่ตรงไปตรงมา ส่วนการอ้างอิงที่แต่งขึ้นตรวจสอบไม่ได้ ซึ่งทำลายเหตุผลของการอ้างอิงทั้งหมด

## ข้อจำกัด ที่วัดมาแล้ว

**CSS transition ไม่อยู่ในกราฟพฤติกรรม** · กราฟรายงานสิ่งที่ `document.getAnimations()` รู้ บวกกับ registry ของ GSAP
เอง และ transition จะเข้าไปอยู่ใน `getAnimations()` เฉพาะตอนที่กำลังวิ่งจริงเท่านั้น · replay แล้วเลื่อนถึงล่างสุด

| | `www.firecrawl.dev` | `www.chaingpt.org` |
|---|---|---|
| node ในกราฟ | 12 | 121 |
| `document.getAnimations()` | 12 | 12 |
| element ที่มี CSS transition | **318** | **1,028** |

สองแถวแรกตรงกันเป๊ะ — ตัวสกัดไม่พลาดอะไรที่เบราว์เซอร์ติดตามอยู่ · แถวที่สามคือข้อจำกัด และเป็นเหตุผลที่ทุกกราฟพก
`unrepresented.cssTransitionElements` ไปด้วย · **อ่านมันด้วย** · หน้าที่ animate ด้วย transition ของ Tailwind หรือ
Framer จะรายงาน node จำนวนน้อยโดยที่ไม่ได้เป็นหน้านิ่ง

**การโต้ตอบมีขอบเขต และขอบเขตถูกรายงาน** · `truncated` บอกว่าแต่ละชนิดถูกเพดานตัดไปกี่ action · บนหน้าจริงตัวเลข
นั้นใหญ่ · แผนที่ทำได้ 32 action บนเว็บที่มี candidate 400 ตัวคือการครอบคลุมเศษเสี้ยว และ `coverage.interaction`
ในด่านสมมูลรายงานสิ่งที่ถูกขับจริง ไม่ใช่สิ่งที่วางแผนไว้

**selector คือตำแหน่ง ไม่ใช่ตัวตน** · วัดบน `www.firecrawl.dev`: เอกสารโตขึ้นราว 200 element ระหว่างที่แผน 32 action
กำลังรัน และ selector 28 จาก 32 ตัวคลายไม่ได้ · driver อ่านข้อเท็จจริงของ element ใหม่และรันนโยบายซ้ำก่อนจะกระทำ
เป้าที่ค้างจึงเป็นการข้ามที่ถูกบันทึกไว้แทนที่จะเป็นการคลิกผิด — แต่มันก็ยังเป็นการข้าม และมันโผล่ในความครอบคลุม

## การอ่านผลลัพธ์อย่างตรงไปตรงมา

- `termination.json` — `complete` บน quiet window หรือ `incomplete` พร้อมเหตุผล · archive ที่จบเพราะชน budget คือ
  หน้าที่ไม่ครบ และกราฟที่สกัดจากมันก็ไม่ครบเช่นกัน
- `aborted` ของ replay — request ที่ archive เสิร์ฟไม่ได้ · กราฟจาก replay ที่เสิร์ฟได้ไม่ครบอธิบายหน้าที่ไม่ได้รันเต็ม
- `dropped` ของสรุปการสังเกต — บัฟเฟอร์ในหน้าเว็บล้น · ค่าที่ไม่เป็นศูนย์แปลว่าสรุปนี้ขาดการสังเกตไป และตัวเลขคือจำนวนที่ขาด
- `unrepresented` ของกราฟ — ดูข้างบน
- `coverage` ของรายงานสมมูล — เป็นเวกเตอร์ ไม่เคยเป็นคะแนน · verdict เขียวที่ความครอบคลุมต่ำคือคำกล่าวเล็กที่รายงาน
  อย่างถูกต้อง ไม่ใช่คำกล่าวใหญ่
- `baselinePasses` ของรายงานสมมูล — จำนวน pass ที่ตัวควบคุมความเสถียรมีจริงในแต่ละฝั่ง เช่น
  `{ live: 3, replay: 0 }` · **`FAIL` ดีได้เท่าที่ฝั่งที่ขยับถูกวัดเท่านั้น** · กลุ่มที่มี pass น้อยกว่าสองครั้งแสดงไม่ได้ว่าฟิลด์แกว่ง
  และด่านอ่านค่านั้นว่า *เสถียร* — baseline ที่วัดแต่ฝั่งสดจึงรับรอง `layout.scrollHeight` ซึ่งนิ่งที่ 8544 ตอนขับฝั่งสด
  แต่อ่านได้ 8486/8544/8486 ตอน replay archive ชุดเดียวกัน · `replay: 0` ที่อยู่ข้าง residual แปลว่าคำกล่าวหานั้นไม่มี
  หลักฐานฝั่ง replay รองรับเลย
- **replay เสิร์ฟ archive เร็วกว่าที่เครือข่ายเคยเสิร์ฟ และบางหน้าสังเกตเห็น** (#187) · หน้าที่วัด element แล้วแช่ผลไว้ —
  โดยไม่จัดลำดับการวัดนั้นกับทรัพยากรที่ขนาดของมันขึ้นอยู่กับ — ลงเอยเป็น layout ที่หน้าสดไม่เคยผลิตได้ · วัดบน
  `https://labs.chaingpt.org/`: ฝั่งสด 8544 ส่วน replay ได้ 8486 ราวหนึ่งในสามรอบ · `replayArchive` รับ
  **`restoreTiming`** ซึ่งหน่วงแต่ละ response ไว้จนถึงเวลาที่ archive บอกว่ามันเสร็จ · บน fixture มันเปลี่ยน replay ที่
  ต่างจากฝั่งสด 12/12 ให้เหลือ 0/12 และบนเว็บจริงที่มี 146 entry มันทำให้ replay ไปจาก 825 ms เป็น 4577 ms โดยไม่
  โหลดล้มเหลว · มัน **ปิดไว้เป็นค่าเริ่มต้น** เพราะมันทำให้ทุก replay ช้าลงเพื่อซื้อความสมจริงที่มีแต่หน้าที่แข่งกันเท่านั้นต้องการ

**ไม่มีอะไรในรายการนี้เป็นของประดับ** · แต่ละอย่างมีอยู่เพราะเคยวัดแล้วพบว่าตัวเลขที่ไม่มีมันกำกับถูกอ่านเป็นคำกล่าวที่ใหญ่
กว่าที่การรันนั้นรองรับ
