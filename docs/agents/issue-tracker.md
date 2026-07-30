<!-- lang:en -->
# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues on `xenodeve/clone-space-mcp`. Use the `gh` CLI
for all operations.

> **`gh` path/auth:** `gh` is installed at `C:\Program Files\GitHub CLI\gh.exe` but is **not** on
> this machine's process PATH — call it by absolute path. Authenticated as `xenodeve`, token
> scopes include `repo` and `workflow`.

## Language: bilingual bodies (English + Thai)

Every issue body, PRD body, and PR description must be **bilingual**:

- **Title**: English, conventional-commit style (e.g. `feat(capture): ...`).
- **Body**: each section in English, then a mirrored Thai version — a `## สรุปภาษาไทย` section
  covering the whole body, or `EN / TH` paired paragraphs per section for long docs.
- **Thai must mirror English exactly** — same detail, sentence count, bullets, tables. Never
  summarise or omit. "สรุป" does not mean "shorter".
- Code identifiers, filenames, log excerpts, and acceptance-criteria checkboxes stay English;
  the Thai explains them, never translates identifiers.
- Review-reply comments may be English-only; anything a teammate reads to decide gets both languages.

## Conventions

- **Create**: `gh issue create --title "..." --body "..."` (heredoc for multi-line bodies).
- **Read**: `gh issue view <n> --comments`.
- **List**: `gh issue list --state open --json number,title,body,labels,comments --jq '...'`.
- **Comment**: `gh issue comment <n> --body "..."`.
- **Label**: `gh issue edit <n> --add-label "..."` / `--remove-label "..."`.
- **Close (with REASON)**: `gh issue close <n> --comment "<reason + evidence>"`.

Infer the repo from `git remote -v` — `gh` does this automatically inside a clone.

## Branch naming

The `pre-push` guard reads the issue number from the **slug position** of the branch name, so
`feat/12-identity-scheme` references issue 12 and `chore/bump-bun-2` references nothing. A `#12`
in a commit message on the branch, or in the PR body, also counts.

## Skill phrase mapping

- "publish to the issue tracker" → create a GitHub issue.
- "fetch the relevant ticket" → `gh issue view <n> --comments`.
<!-- lang:end -->

<!-- lang:th -->
# Issue tracker: GitHub — ภาษาไทย

Issue และ PRD ของ repo นี้อยู่ในรูป GitHub issue บน `xenodeve/clone-space-mcp` ใช้ `gh` CLI สำหรับทุกการทำงาน

> **path/auth ของ `gh`:** `gh` ติดตั้งอยู่ที่ `C:\Program Files\GitHub CLI\gh.exe` แต่ **ไม่ได้** อยู่ใน
> process PATH ของเครื่องนี้ — ต้องเรียกด้วย absolute path ล็อกอินเป็น `xenodeve` โดย token มี scope
> `repo` และ `workflow` อยู่ด้วย

## ภาษา: เนื้อหาสองภาษา (อังกฤษ + ไทย)

ทุก issue body, PRD body และ PR description ต้องเป็น **สองภาษา**:

- **หัวข้อ**: ภาษาอังกฤษ สไตล์ conventional-commit (เช่น `feat(capture): ...`)
- **เนื้อหา**: แต่ละหัวข้อเป็นภาษาอังกฤษ แล้วตามด้วยฉบับภาษาไทยที่สะท้อนกัน — จะเป็นหัวข้อ `## สรุปภาษาไทย`
  ที่ครอบคลุมทั้งเนื้อหา หรือย่อหน้าคู่ `EN / TH` ต่อหัวข้อสำหรับเอกสารยาวก็ได้
- **ภาษาไทยต้องสะท้อนภาษาอังกฤษแบบตรงตัว** — รายละเอียดเท่ากัน จำนวนประโยคเท่ากัน bullet เท่ากัน ตารางเท่ากัน
  ห้ามย่อหรือตัดทิ้ง คำว่า "สรุป" ไม่ได้แปลว่า "สั้นลง"
- ชื่อ identifier ในโค้ด ชื่อไฟล์ ท่อน log และ checkbox ของ acceptance criteria ให้คงเป็นภาษาอังกฤษ
  ภาษาไทยมีไว้อธิบายสิ่งเหล่านั้น ไม่ใช่แปล identifier
- คอมเมนต์ตอบรีวิวเป็นภาษาอังกฤษล้วนได้ แต่อะไรก็ตามที่เพื่อนร่วมทีมต้องอ่านเพื่อ**ตัดสินใจ** ต้องมีทั้งสองภาษา

## ข้อตกลงการใช้งาน

- **สร้าง**: `gh issue create --title "..." --body "..."` (ใช้ heredoc สำหรับเนื้อหาหลายบรรทัด)
- **อ่าน**: `gh issue view <n> --comments`
- **ลิสต์**: `gh issue list --state open --json number,title,body,labels,comments --jq '...'`
- **คอมเมนต์**: `gh issue comment <n> --body "..."`
- **ติด label**: `gh issue edit <n> --add-label "..."` / `--remove-label "..."`
- **ปิด (พร้อมเหตุผล)**: `gh issue close <n> --comment "<เหตุผล + หลักฐาน>"`

`gh` เดา repo จาก `git remote -v` ให้เองเมื่ออยู่ใน clone

## การตั้งชื่อ branch

`pre-push` guard อ่านเลข issue จาก **ตำแหน่ง slug** ของชื่อ branch ดังนั้น `feat/12-identity-scheme` จึงอ้างถึง
issue 12 ส่วน `chore/bump-bun-2` ไม่ได้อ้างถึงอะไรเลย การใส่ `#12` ใน commit message บน branch นั้น
หรือใน PR body ก็นับเช่นกัน

## การแปลงคำที่ skill ใช้

- "publish to the issue tracker" → สร้าง GitHub issue
- "fetch the relevant ticket" → `gh issue view <n> --comments`
<!-- lang:end -->
