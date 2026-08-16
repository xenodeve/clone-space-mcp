<!-- lang:en -->

# Recorded equivalence verdicts — 2026-08-17

#171 acceptance criterion 7: *"`www.chaingpt.org`, `labs.chaingpt.org` and `www.firecrawl.dev` each produce a recorded verdict with its coverage."*

Every run below is `node scripts/equivalence.ts <url>` on this machine, 2026-08-17. The exit code is the process's own, read with `echo $?` on an unpiped invocation — the first attempt read it through a pipe and got `tail`'s status instead, which measured nothing.

**These are recordings, not a baseline to defend.** The same URL is below twice with two different verdicts, minutes apart, and that is the finding rather than a flaw in the run.

## `https://www.firecrawl.dev/` — FAIL, exit 1

```
equivalence FAIL  https://www.firecrawl.dev/

residual (2)   dom.canvases.afterInteraction  dom.elements.afterInteraction
unstable (0)
baseline    live 3  replay 3

coverage
  scroll              100%
  motion_settled        0%
  stable_fields       100%
  interaction          63%
  listener_execution    0%
```

Read the coverage before the verdict: `motion_settled 0%` says the page had **not** stopped moving when the digest was taken, and `interaction 63%` says a third of the planned actions never ran. A `FAIL` at that coverage is a narrow claim, and the two residual fields are both `afterInteraction` — the surface the run covered least.

## `https://www.chaingpt.org/` — INCOMPLETE, exit 2

```
equivalence INCOMPLETE  https://www.chaingpt.org/

residual (0)
unstable (2)   interaction.performed  motion.settled
baseline    live 3  replay 3

coverage
  scroll              100%
  motion_settled        0%
  stable_fields        90%
  interaction         100%
  listener_execution    0%
```

Nothing differs that anything failed to explain — and nothing was proven equal either. Two fields could not be measured twice the same way, so `stable_fields` is 90% rather than 100%. **This is the case a boolean gate would have reported as success.**

## `https://labs.chaingpt.org/` — PASS, then FAIL, minutes apart

First run:

```
equivalence PASS  https://labs.chaingpt.org/
residual (0)
unstable (0)
baseline    live 3  replay 3
```

Second run, same URL, same machine, nothing changed:

```
equivalence FAIL  https://labs.chaingpt.org/
residual (1)   layout.scrollHeight
unstable (0)
baseline    live 3  replay 3
```

**This is #182 reproduced by the command in its first hour of existing**, and the residual is #187's field.

The line worth reading twice is **`unstable (0)` in the failing run**. The stability control had **three live and three replay passes** and still called `layout.scrollHeight` stable — because on that site it settles at one of two values and three replay passes can land on the same one. So the difference went to the residual as the clone's fault, on a field the clone did not decide.

That is the open half of #187's criterion 5, now with a recorded instance rather than an argument: **the gate's treatment of `layout.scrollHeight` currently depends on whether three passes happened to agree.** `baselinePasses` (#203) publishes the count so a reader can see the basis; whether a `different` verdict should require both sides to have been measured at least twice is the decision that remains, and it contradicts a test written the other way on purpose.

## The perturbation control — the hooks move `dom.elements`

`bun run equivalence https://www.chaingpt.org/ --measure-perturbation` drives the live page one
extra time with the observation layer installed and compares it against the plain pass:

```
equivalence INCOMPLETE  https://www.chaingpt.org/

residual (0)
unstable (1)   interaction.performed
baseline    live 3  replay 3
perturbed (2)  dom.elements  dom.elements.afterInteraction
```

**`dom.elements` is not in `unstable`**, so it held across three live and three replay passes and
moved *only* when the hooks were installed. The attribution is the whole point of driving the same
side twice: run-to-run noise would have shown up in the baseline, and it did not.

**This qualifies what #171's body recorded.** That entry measured the perturbation as *"load
4,171 ms vs 3,361 ms, 61 vs 60 rAF frames per second, motion settling identically — below
run-to-run noise, which is a baseline to defend rather than a reason to skip the control."* Those
are timing figures, and they are not wrong. **They simply did not look at the element count**, which
is one of the fields the gate compares.

So the conclusion the body drew — that the perturbation is small enough to work around — holds for
the quantities it measured and does not extend to the digest. A later slice that instruments **both**
sides would be comparing `dom.elements` values that the instrument itself moved on at least one
real site.

`https://example.com/` reports `perturbed (0)` on the same command, which is the control's own
control: a page with no scripts gives the hooks nothing to disturb.

## What none of these say

`listener_execution` is **0% in every run**. v1 drives no listeners, and a green verdict here is a claim about navigation and scrolling and about nothing else. Reading any row above as *"the clone is faithful"* would be reading past the coverage vector, which is the whole reason it is a vector.

<!-- lang:th -->

# verdict ของด่านสมมูลที่บันทึกไว้ — 2026-08-17

เกณฑ์การยอมรับข้อ 7 ของ #171: *"`www.chaingpt.org` · `labs.chaingpt.org` · `www.firecrawl.dev` แต่ละตัวให้ verdict ที่บันทึกไว้พร้อมความครอบคลุมของมัน"*

ทุกการรันข้างล่างคือ `node scripts/equivalence.ts <url>` บนเครื่องนี้ วันที่ 2026-08-17 · exit code เป็นของ process เอง อ่านด้วย `echo $?` จากการเรียกที่ไม่ผ่าน pipe — ครั้งแรกผมอ่านผ่าน pipe แล้วได้สถานะของ `tail` ซึ่งไม่ได้วัดอะไรเลย

**เหล่านี้คือการบันทึก ไม่ใช่ baseline ที่ต้องรักษา** · URL เดียวกันอยู่ข้างล่างสองครั้งด้วย verdict สองแบบ ห่างกันไม่กี่นาที และนั่นคือสิ่งที่ค้นพบ ไม่ใช่ข้อบกพร่องของการรัน

## `https://www.firecrawl.dev/` — FAIL · exit 1

ผลอยู่ในบล็อกภาษาอังกฤษด้านบน

อ่านความครอบคลุมก่อน verdict: `motion_settled 0%` บอกว่าหน้าเว็บ**ยัง**ไม่หยุดเคลื่อนไหวตอนเก็บ digest และ `interaction 63%` บอกว่าหนึ่งในสามของ action ที่วางแผนไว้ไม่ได้รัน · `FAIL` ที่ความครอบคลุมระดับนั้นเป็นคำกล่าวที่แคบ และฟิลด์ใน residual ทั้งสองเป็น `afterInteraction` ซึ่งเป็นพื้นผิวที่การรันครอบคลุมน้อยที่สุด

## `https://www.chaingpt.org/` — INCOMPLETE · exit 2

ผลอยู่ในบล็อกภาษาอังกฤษด้านบน

ไม่มีอะไรต่างที่อธิบายไม่ได้ — และก็ไม่มีอะไรถูกพิสูจน์ว่าเท่ากันเช่นกัน · สองฟิลด์วัดซ้ำแบบเดิมไม่ได้ `stable_fields` จึงเป็น 90% ไม่ใช่ 100% · **นี่คือกรณีที่ด่านแบบ boolean จะรายงานว่าสำเร็จ**

## `https://labs.chaingpt.org/` — PASS แล้ว FAIL ห่างกันไม่กี่นาที

ผลทั้งสองรอบอยู่ในบล็อกภาษาอังกฤษด้านบน

**นี่คือ #182 ที่ถูกจำลองซ้ำโดยคำสั่งนี้ในชั่วโมงแรกที่มันมีอยู่** และ residual คือฟิลด์ของ #187

บรรทัดที่ควรอ่านสองรอบคือ **`unstable (0)` ในรอบที่ FAIL** · ตัวควบคุมความเสถียรมี **live 3 และ replay 3 pass** และยังเรียก `layout.scrollHeight` ว่าเสถียร — เพราะบนเว็บนั้นมันลงเอยที่หนึ่งในสองค่า และ replay 3 pass ลงที่ค่าเดียวกันได้ · ความต่างจึงตกไปอยู่ใน residual ในฐานะความผิดของ clone บนฟิลด์ที่ clone ไม่ได้เป็นคนตัดสิน

นั่นคือครึ่งที่ยังเปิดอยู่ของเกณฑ์ข้อ 5 ของ #187 ตอนนี้มีกรณีที่บันทึกไว้แทนที่จะเป็นการโต้แย้ง: **การที่ด่านปฏิบัติกับ `layout.scrollHeight` อย่างไร ตอนนี้ขึ้นอยู่กับว่า 3 pass บังเอิญตรงกันหรือไม่** · `baselinePasses` (#203) เผยแพร่จำนวนนั้นให้คนอ่านเห็นฐาน · ส่วนว่า verdict `different` ควรต้องมีการวัดทั้งสองฝั่งอย่างน้อยสองครั้งหรือไม่ คือการตัดสินใจที่ยังเหลือ และมันขัดกับเทสต์ที่เขียนไว้ตรงข้ามอย่างตั้งใจ

## ตัวควบคุม perturbation — hooks ขยับ `dom.elements`

`bun run equivalence https://www.chaingpt.org/ --measure-perturbation` ขับหน้าสดเพิ่มอีกหนึ่งรอบโดยติดตั้ง
observation layer แล้วเทียบกับ pass ธรรมดา (ผลอยู่ในบล็อกภาษาอังกฤษด้านบน)

**`dom.elements` ไม่ได้อยู่ใน `unstable`** มันจึงนิ่งตลอด 3 live pass และ 3 replay pass และขยับ *เฉพาะ* ตอนติด
hook · การระบุสาเหตุได้คือเหตุผลทั้งหมดของการขับฝั่งเดียวกันสองครั้ง: noise ระหว่างรอบจะโผล่ใน baseline
และมันไม่ได้โผล่

**เรื่องนี้ทำให้สิ่งที่เนื้อหาของ #171 บันทึกไว้มีเงื่อนไข** · บันทึกนั้นวัด perturbation ไว้ว่า *"load 4,171 ms
เทียบ 3,361 ms · 61 เทียบ 60 rAF frame ต่อวินาที · motion นิ่งเหมือนกัน — ต่ำกว่า noise ระหว่างรอบ ซึ่งเป็น
baseline ที่ต้องรักษา ไม่ใช่เหตุผลที่จะข้ามตัวควบคุม"* · นั่นเป็นตัวเลขเชิงเวลา และมันไม่ผิด · **มันแค่ไม่ได้ดูจำนวน
element** ซึ่งเป็นหนึ่งในฟิลด์ที่ด่านเอามาเทียบ

ข้อสรุปที่เนื้อหานั้นได้ — ว่า perturbation เล็กพอจะหลบได้ — จึงเป็นจริงสำหรับปริมาณที่มันวัด และไม่ขยายไปถึง
digest · สไลซ์ถัดไปที่ติด instrument **ทั้งสองฝั่ง** จะกำลังเทียบค่า `dom.elements` ที่ตัว instrument เองขยับ
บนเว็บจริงอย่างน้อยหนึ่งเว็บ

`https://example.com/` รายงาน `perturbed (0)` ด้วยคำสั่งเดียวกัน ซึ่งเป็นตัวควบคุมของตัวควบคุมเอง: หน้าที่ไม่มี
สคริปต์เลยไม่มีอะไรให้ hook ไปรบกวน

## สิ่งที่ไม่มีรอบไหนพูด

`listener_execution` เป็น **0% ทุกรอบ** · v1 ไม่ได้ขับ listener เลย และ verdict เขียวตรงนี้เป็นคำกล่าวเกี่ยวกับการนำทางและการเลื่อน และไม่เกี่ยวกับอย่างอื่น · การอ่านแถวไหนข้างบนว่า *"clone สมจริง"* คือการอ่านข้าม coverage vector ไป ซึ่งเป็นเหตุผลทั้งหมดที่มันเป็นเวกเตอร์
