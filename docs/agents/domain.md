<!-- lang:en -->
# Domain Docs

How engineering skills should consume this repo's domain documentation when exploring.

## Layout: Single-context

One `CONTEXT.md` at the root will cover the whole codebase once it exists.

```
/
├── CONTEXT.md          ← domain glossary for the whole codebase (created lazily)
├── docs/adr/           ← architectural decision records
├── src/                ← capture · replay · extract · serve
└── test/fixtures/      ← the controlled motion-site, our known ground truth
```

(Revisit as multi-context — a root `CONTEXT-MAP.md` pointing at one `CONTEXT.md` per context,
plus context-scoped `docs/adr/` — once a second package/context is added. The MCP server is the
likeliest candidate to become one.)

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the system-context doc; the canonical term glossary is
  `UBIQUITOUS_LANGUAGE.md` (`CONTEXT.md` points at it and defers to it on any conflict).
- **`docs/adr/`** — read ADRs touching the area you're about to work in before proposing alternatives.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest
creating them upfront. They are created lazily when a term or decision actually resolves.

## Use the glossary's vocabulary

When your output names a domain concept (issue title, refactor proposal, hypothesis, test name),
use the term exactly as defined. Don't drift to synonyms the glossary avoids. If a concept isn't
in the glossary yet, that's a signal — either you're inventing language the project doesn't use
(reconsider) or there's a real gap (note it for `/domain-modeling`).

Terms this project is already precise about, and will need pinning down when the glossary is
written: **capture** vs **replay** vs **extract** (three distinct stages, not synonyms for
"scraping"), **archive** (the on-disk artifact set), **behavior graph** (the extracted semantic
output, not the DOM), and **element identity** (the `wa:` scheme — not a CSS selector).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly instead of silently overriding:

> _Contradicts ADR-<NNNN> (<one-line decision>) — but worth reopening because…_
<!-- lang:end -->

<!-- lang:th -->
# Domain Docs — ภาษาไทย

วิธีที่ skill ด้านวิศวกรรมควรใช้เอกสาร domain ของ repo นี้ตอนสำรวจโค้ด

## โครงสร้าง: context เดียว

`CONTEXT.md` หนึ่งไฟล์ที่ root จะครอบคลุมทั้ง codebase เมื่อมันถูกสร้างขึ้นมา

```
/
├── CONTEXT.md          ← อภิธานศัพท์ domain ของทั้ง codebase (สร้างแบบ lazy)
├── docs/adr/           ← บันทึกการตัดสินใจเชิงสถาปัตยกรรม
├── src/                ← capture · replay · extract · serve
└── test/fixtures/      ← motion-site แบบควบคุมได้ ซึ่งเป็น ground truth ที่เรารู้ค่าแน่นอน
```

(ค่อยทบทวนเป็นแบบหลาย context — `CONTEXT-MAP.md` ที่ root ชี้ไปยัง `CONTEXT.md` หนึ่งไฟล์ต่อหนึ่ง context
พร้อม `docs/adr/` แยกตาม context — เมื่อมี package/context ที่สองเกิดขึ้น ตัว MCP server มีโอกาสกลายเป็น
context ที่สองมากที่สุด)

## ก่อนสำรวจโค้ด ให้อ่านสิ่งเหล่านี้

- **`CONTEXT.md`** ที่ root ของ repo — เอกสาร system context โดยอภิธานศัพท์ที่เป็นทางการคือ
  `UBIQUITOUS_LANGUAGE.md` (`CONTEXT.md` ชี้ไปหามันและยอมมันเสมอเมื่อขัดกัน)
- **`docs/adr/`** — อ่าน ADR ที่เกี่ยวกับส่วนที่กำลังจะแก้ ก่อนจะเสนอทางเลือกอื่น

ถ้าไฟล์เหล่านี้ยังไม่มี ให้ **ดำเนินการต่อไปเงียบๆ** อย่าแจ้งว่ามันหายไป และอย่าเสนอให้สร้างล่วงหน้า
ไฟล์พวกนี้จะถูกสร้างแบบ lazy เมื่อมีคำศัพท์หรือการตัดสินใจที่ตกผลึกจริงๆ

## ใช้คำศัพท์ตามอภิธานศัพท์

เมื่อผลลัพธ์ของคุณเอ่ยถึงแนวคิดใน domain (หัวข้อ issue, ข้อเสนอ refactor, สมมติฐาน, ชื่อ test) ให้ใช้คำ
ตรงตามที่นิยามไว้ อย่าเลื่อนไปใช้คำพ้องที่อภิธานศัพท์เลี่ยง ถ้าแนวคิดนั้นยังไม่อยู่ในอภิธานศัพท์ นั่นคือสัญญาณ —
ไม่คุณกำลังคิดคำที่โปรเจกต์ไม่ได้ใช้ขึ้นมาเอง (ให้ทบทวนใหม่) ก็มีช่องว่างจริง (ให้จดไว้สำหรับ `/domain-modeling`)

คำที่โปรเจกต์นี้แม่นยำอยู่แล้วและต้องถูกตรึงไว้เมื่อเขียนอภิธานศัพท์: **capture** กับ **replay** กับ **extract**
(สาม stage ที่แยกจากกัน ไม่ใช่คำพ้องของ "scraping"), **archive** (ชุด artifact ที่อยู่บนดิสก์),
**behavior graph** (ผลลัพธ์เชิงความหมายที่สกัดออกมา ไม่ใช่ DOM) และ **element identity** (ระบบ `wa:` —
ไม่ใช่ CSS selector)

## แจ้งเมื่อขัดกับ ADR

ถ้าผลลัพธ์ของคุณขัดกับ ADR ที่มีอยู่ ให้พูดออกมาตรงๆ แทนที่จะเขียนทับเงียบๆ:

> _ขัดกับ ADR-<NNNN> (<การตัดสินใจหนึ่งบรรทัด>) — แต่ควรค่าแก่การรื้อกลับมาพิจารณาเพราะ…_
<!-- lang:end -->
