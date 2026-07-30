<!-- lang:en -->
# Triage Labels

The skills speak in five canonical triage roles. This file maps them to the repo's label strings.

| Role | Label in our tracker | Meaning |
| ---- | -------------------- | ------- |
| `needs-triage`    | `needs-triage`    | Maintainer needs to evaluate this issue |
| `needs-info`      | `needs-info`      | Waiting on the reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an AFK agent |
| `ready-for-human` | `ready-for-human` | Requires human implementation |
| `wontfix`         | `wontfix`         | Will not be actioned |

## Component labels — one per issue

One per issue, matching the pipeline stage that owns it:

- `capture` — driving the live page, HAR recording, the sweep, sourcemap fetching
- `replay` — HAR routing, offline navigation, the isolated context
- `extract` — the behavior graph: animations, triggers, styles, listeners, un-minification
- `serve` — the MCP server and its progressive-disclosure manifest
- `identity` — the `wa:` element-identity scheme and cross-run reconciliation
- `fixture` — `test/fixtures/motion-site`, the known ground truth
- `infra` — CI, hooks, guards, tooling, repo operating layer

## Type and severity

- **Type** — one or more: `Bug`, `tech-debt`, `security`, `Optimization`, `Cleanup`, `Feature`, `Test`.
- **Severity** — one per Bug/Security: `critical`, `Major`, `Minor`.
- **Lifecycle** — `Latent` (exists in code, not yet manifested), `Dormant` (real but deprioritised).

## Conventions

- Every issue has ≥1 triage-state label and exactly one component label.
- `security` issues must be `critical` or `Major` — a `Minor` security label is not valid.
- A `Latent` bug that activates is upgraded to a full Bug issue with severity.
<!-- lang:end -->

<!-- lang:th -->
# Triage Labels — ภาษาไทย

Skill ต่างๆ พูดถึง triage role มาตรฐาน 5 แบบ ไฟล์นี้แม็ปมันเข้ากับชื่อ label จริงของ repo

| Role | Label ใน tracker ของเรา | ความหมาย |
| ---- | -------------------- | ------- |
| `needs-triage`    | `needs-triage`    | ผู้ดูแลต้องประเมิน issue นี้ก่อน |
| `needs-info`      | `needs-info`      | รอข้อมูลเพิ่มเติมจากผู้แจ้ง |
| `ready-for-agent` | `ready-for-agent` | ระบุครบถ้วนแล้ว พร้อมให้ agent ทำแบบ AFK |
| `ready-for-human` | `ready-for-human` | ต้องให้คนลงมือเอง |
| `wontfix`         | `wontfix`         | จะไม่ดำเนินการ |

## Component label — หนึ่งอันต่อหนึ่ง issue

หนึ่งอันต่อหนึ่ง issue ตรงกับ stage ของ pipeline ที่เป็นเจ้าของเรื่องนั้น:

- `capture` — การขับหน้าเว็บจริง, การอัด HAR, การ sweep, การดึง sourcemap
- `replay` — การ route จาก HAR, การเปิดหน้าแบบออฟไลน์, context ที่แยกตัว
- `extract` — behavior graph: animation, trigger, style, listener, การถอด minify
- `serve` — MCP server และ manifest แบบ progressive disclosure
- `identity` — ระบบ element identity `wa:` และการจับคู่ข้ามรอบการรัน
- `fixture` — `test/fixtures/motion-site` ซึ่งเป็น ground truth ที่รู้ค่าแน่นอน
- `infra` — CI, hooks, guards, เครื่องมือ, ชั้น operating layer ของ repo

## Type และ severity

- **Type** — หนึ่งอันหรือมากกว่า: `Bug`, `tech-debt`, `security`, `Optimization`, `Cleanup`, `Feature`, `Test`
- **Severity** — หนึ่งอันต่อหนึ่ง Bug/Security: `critical`, `Major`, `Minor`
- **Lifecycle** — `Latent` (มีอยู่ในโค้ดแล้วแต่ยังไม่แสดงอาการ), `Dormant` (เป็นเรื่องจริงแต่ลดความสำคัญไว้ก่อน)

## ข้อตกลง

- ทุก issue ต้องมี triage-state label อย่างน้อย 1 อัน และ component label พอดี 1 อัน
- issue ที่เป็น `security` ต้องเป็น `critical` หรือ `Major` เท่านั้น — `Minor` ร่วมกับ security ถือว่าไม่ถูกต้อง
- bug ที่เป็น `Latent` แล้วเริ่มแสดงอาการ ให้ยกระดับเป็น Bug issue เต็มรูปแบบพร้อมระบุ severity
<!-- lang:end -->
