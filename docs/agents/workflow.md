<!-- lang:en -->
# Agent Workflow

How agents plan and implement in this repo, and which skills to invoke automatically.

## Development workflow

When planning or implementing a feature, follow this order:

1. **`/grill-me`** — stress-test the concept first (interview-style)
2. **`/grill-with-docs`** — challenge the plan against existing ADRs in `docs/adr/`
3. **Survey the change sites** — enumerate every place the change touches, before the plan exists
4. **`/to-prd`** — create a PRD from the grilled plan (one PRD per epic), carrying the survey as its change inventory
5. **`/to-issues`** — break the PRD into GitHub issues on `xenodeve/clone-space` with triage labels (one issue per deliverable)
6. **`/tdd`** — implement test-first, then make the tests pass

Hard ordering: **PRD → issues → PR**. Never open a PR without a referenced issue.

## Auto-triggered skills

| Trigger | Skill | Condition |
|---|---|---|
| Bug / error / stack trace | `/debug-mantra` | Start a debug session every time |
| After fixing a bug | `/post-mortem` | Record root cause + fix + validation |
| After writing or changing code | `/simplify` | Before committing — check over-engineering |
| Editing the fixture site's UI / CSS | `/impeccable` | Every time a component or CSS is touched |
| Before merge / ship | `/code-review` + `/scrutinize` | Correctness + outsider perspective |
| Touching a security boundary | `/security-review` | Every time code crosses auth/secret/token, or handles a captured page's untrusted content |
| After implementation | `/verify` | Confirm the feature works end to end |

## Verification mandate

Run `bun run verify` (lint → typecheck → test → build) before every ship. It is what the
`PreToolUse` gate runs itself before `gh pr merge`, and a fast prefix of the CI required checks.

**This project's unit tests cannot see what matters.** A passing assertion about a data structure
says nothing about whether a captured page actually replays with its motion intact. Every change
to `capture`, `replay`, or `extract` is verified against **`test/fixtures/motion-site`**, whose
declared animations are the known ground truth, with the network disconnected. Add a fixture case
whenever you add support for a new motion mechanism.

## Security boundary specific to this repo

A captured page is **untrusted input**: third-party JavaScript, arbitrary HTML, arbitrary network
responses. Anything that executes, parses, or serves captured content crosses a trust boundary and
gets `/security-review` — replay contexts stay isolated and offline (`notFound: 'abort'`), and the
MCP server never hands raw captured script to a caller as if it were repo code.
<!-- lang:end -->

<!-- lang:th -->
# Agent Workflow — ภาษาไทย

วิธีที่ agent วางแผนและลงมือทำใน repo นี้ และ skill ไหนที่ต้องเรียกอัตโนมัติ

## ลำดับการพัฒนา

เวลาวางแผนหรือลงมือทำฟีเจอร์ ให้ทำตามลำดับนี้:

1. **`/grill-me`** — ซักค้านแนวคิดให้แตกก่อน (แบบสัมภาษณ์)
2. **`/grill-with-docs`** — ท้าทายแผนกับ ADR ที่มีอยู่แล้วใน `docs/adr/`
3. **สำรวจจุดที่ต้องแก้ทั้งหมด** — ไล่ให้ครบทุกที่ที่การเปลี่ยนแปลงนี้แตะ ก่อนที่แผนจะถูกเขียน
4. **`/to-prd`** — แปลงแผนที่ผ่านการซักค้านเป็น PRD (หนึ่ง PRD ต่อหนึ่ง epic) โดยยกผลสำรวจมาเป็น change inventory ของมัน
5. **`/to-issues`** — แตก PRD ออกเป็น GitHub issue บน `xenodeve/clone-space` พร้อม triage label (หนึ่ง issue ต่อหนึ่ง deliverable)
6. **`/tdd`** — ลงมือแบบ test-first แล้วค่อยทำให้ test ผ่าน

ลำดับที่ห้ามข้าม: **PRD → issues → PR** ห้ามเปิด PR โดยไม่มี issue อ้างอิงเด็ดขาด

## Skill ที่ต้องเรียกอัตโนมัติ

| ตัวกระตุ้น | Skill | เงื่อนไข |
|---|---|---|
| Bug / error / stack trace | `/debug-mantra` | เริ่ม debug session ทุกครั้ง |
| หลังแก้ bug เสร็จ | `/post-mortem` | บันทึก root cause + วิธีแก้ + การพิสูจน์ |
| หลังเขียนหรือแก้โค้ด | `/simplify` | ก่อน commit — ตรวจว่า over-engineering หรือไม่ |
| แก้ UI / CSS ของ fixture site | `/impeccable` | ทุกครั้งที่แตะ component หรือ CSS |
| ก่อน merge / ship | `/code-review` + `/scrutinize` | ความถูกต้อง + มุมมองคนนอก |
| แตะ security boundary | `/security-review` | ทุกครั้งที่โค้ดข้าม auth/secret/token หรือจัดการเนื้อหาที่ไม่น่าเชื่อถือจากหน้าเว็บที่ capture มา |
| หลัง implement เสร็จ | `/verify` | ยืนยันว่าใช้งานได้จริงตั้งแต่ต้นจนจบ |

## ข้อบังคับเรื่องการพิสูจน์

รัน `bun run verify` (lint → typecheck → test → build) ก่อน ship ทุกครั้ง มันคือคำสั่งที่ `PreToolUse` gate
รันเองก่อน `gh pr merge` และเป็น prefix แบบเร็วของ CI required checks

**unit test ของโปรเจกต์นี้มองไม่เห็นสิ่งที่สำคัญจริง** assertion ที่ผ่านเรื่องโครงสร้างข้อมูลไม่ได้บอกอะไรเลยว่า
หน้าเว็บที่ capture มานั้น replay แล้ว animation ยังทำงานอยู่ไหม ทุกการเปลี่ยนแปลงใน `capture`, `replay` หรือ
`extract` ต้องพิสูจน์กับ **`test/fixtures/motion-site`** ซึ่ง animation ที่ประกาศไว้ในนั้นคือ ground truth ที่รู้ค่าแน่นอน
และต้องพิสูจน์ตอนตัดเน็ตออก เพิ่ม fixture case ทุกครั้งที่รองรับกลไก motion แบบใหม่

## Security boundary เฉพาะของ repo นี้

หน้าเว็บที่ capture มาคือ **input ที่ไม่น่าเชื่อถือ** — JavaScript ของบุคคลที่สาม, HTML อะไรก็ได้, network response
อะไรก็ได้ อะไรก็ตามที่ execute, parse หรือ serve เนื้อหาที่ capture มาถือว่าข้าม trust boundary และต้องผ่าน
`/security-review` — replay context ต้องแยกตัวและออฟไลน์เสมอ (`notFound: 'abort'`) และ MCP server ต้องไม่
ส่ง script ดิบที่ capture มาให้ผู้เรียกราวกับว่ามันเป็นโค้ดของ repo เอง
<!-- lang:end -->
