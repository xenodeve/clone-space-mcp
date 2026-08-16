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

## The perturbation control — and a claim it withdrew within the hour

`bun run equivalence <url> --measure-perturbation` drives the live page one extra time with the
observation layer installed and compares that drive against the plain ones.

**The first version of this section said the hooks move `dom.elements`. That claim is withdrawn.**

The first run reported:

```
unstable (1)   interaction.performed
perturbed (2)  dom.elements  dom.elements.afterInteraction
```

and the attribution rested on `dom.elements` being absent from `unstable` — it had held across three
live and three replay passes, so the hooked drive differing looked like the hooks' doing.

**It compared the hooked drive against the first plain pass only.** A delegated review named the
scenario before any of this merged: a field reading `1, 2, 1` across three plain drives and `2` under
hooks is a value the page produces unaided, and blaming the hooks for it turns run-to-run noise into
a finding. Comparing against **every** plain pass — a field is perturbed only when the hooked reading
matches none of them — is the fix. The same site, re-measured immediately after:

```
unstable (3)   dom.elements  dom.elements.afterInteraction  motion.settled
perturbed (0)
```

The same two fields are now in `unstable`: on this run they moved across the plain baseline itself.
So the earlier `perturbed (2)` was almost certainly the baseline's own noise, and it looked
attributable only because three passes happened to agree that time.

**What is left standing:** the control runs, reports, and distinguishes *measured and clean* from
*not measured*. `https://example.com/` reports `perturbed (0)` as its own control — a page with no
scripts gives the hooks nothing to disturb. **It has not yet found a perturbation that survives
comparison against every plain pass**, which is a different and much smaller statement than the one
this section made an hour earlier.

**What #171's body recorded still stands and is still narrow.** Its baseline was *"load 4,171 ms vs
3,361 ms, 61 vs 60 rAF frames per second, motion settling identically — below run-to-run noise."*
Those are timing figures; they never looked at the digest. This control now looks at the digest and
has found nothing yet. Neither result licenses instrumenting both sides — **absence of a finding
across two runs is not a budget**.

**A known limit, not acted on.** The instrumented drive reuses the interaction plan discovered on
the plain side. That keeps the two comparable, which is the gate's own rule — *the same driver on
both sides* — but it means a perturbation that changes **which elements are discoverable** is
invisible to this control. Discovering a second plan and diffing the plans is a separate measurement.

## The network attempt set — the field that found a difference on its first run

#171's v1 scope names it and the digest did not have it:

> In: the field digest this repo can already produce — behaviour multiset, **network attempt set
> with its ADR 0007 classification**, and the motion counts.

**Without it the gate could return `PASS` on a clone that fetched an entirely different set of
things**, which is the opposite of what this project claims. The issue names the concrete case:
`www.chaingpt.org` cannot serve `Cannon_Exterior.hdr`, its 3D scene's environment map, so an
API-level comparison passes while the scene renders unlit.

`network.requests` and `network.origins` are counts of the distinct resources and origins the page
asked for, read from `performance.getEntriesByType("resource")` **through the same seam on both
sides**, normalized by ADR 0007 with the caller's volatile keys and no invented policy. Two counts
rather than one: a clone fetching the same number of things from a different place is a different
failure from one fetching a different number.

On the first real run, `https://www.chaingpt.org/`:

```
equivalence FAIL  https://www.chaingpt.org/

residual (1)
  network.origins  live 27  replay 28
unstable (1)   motion.settled
baseline    live 3  replay 3
```

**A `FAIL` on a surface the gate had never looked at**, on a site that had returned `INCOMPLETE`
minutes earlier with every other field agreeing. `network.origins` is **not** in `unstable`, so the
three live drives agreed at 27 and the three replays agreed at 28: the difference reproduces.

**The direction is the interesting part and it is not diagnosed.** The replay reaches *more* origins
than the live drive, not fewer. Two readings are available and this run does not choose between
them: the archive is built by its own capture drive, so it can legitimately hold an origin the three
compared live drives did not request; or the replay is reaching something the live page does not.
**Naming it as "the clone fetches too much" would be the same jump this document had to withdraw one
section earlier.** It is a reproducible difference on a surface that had no coverage at all, which is
what the field was added for.

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

## ตัวควบคุม perturbation — และข้ออ้างที่มันถอนคืนภายในชั่วโมงเดียว

`bun run equivalence <url> --measure-perturbation` ขับหน้าสดเพิ่มอีกรอบโดยติดตั้ง observation layer แล้ว
เทียบรอบนั้นกับรอบธรรมดา

**เนื้อหาส่วนนี้ฉบับแรกเขียนว่า hooks ขยับ `dom.elements` · ข้ออ้างนั้นถูกถอน**

รอบแรกรายงานผลตามบล็อกในส่วนภาษาอังกฤษ และการระบุสาเหตุอาศัยข้อเท็จจริงที่ `dom.elements` ไม่อยู่ใน
`unstable` — มันนิ่งตลอด 3 live pass และ 3 replay pass การที่รอบติด hook ต่างออกไปจึงดูเหมือนฝีมือของ hooks

**มันเทียบรอบติด hook กับ plain pass อันแรกอันเดียว** · รีวิวที่ delegate ระบุสถานการณ์นี้ก่อนอะไรจะ merge:
ฟิลด์ที่อ่านได้ `1, 2, 1` ตลอดสามรอบธรรมดา และได้ `2` ตอนติด hook คือค่าที่หน้าเว็บผลิตเองอยู่แล้ว การโทษ hooks
จึงเปลี่ยน noise ระหว่างรอบให้กลายเป็นข้อค้นพบ · ทางแก้คือเทียบกับ plain pass **ทุกอัน** — ฟิลด์จะถูกนับว่า
perturbed ก็ต่อเมื่อค่าตอนติด hook ไม่ตรงกับอันไหนเลย · เว็บเดียวกัน วัดซ้ำทันทีหลังจากนั้น (ผลอยู่ในบล็อกด้านบน)

สองฟิลด์เดิมตอนนี้อยู่ใน `unstable`: ในรอบนี้มันขยับข้าม baseline ธรรมดาเอง · ดังนั้น `perturbed (2)` ก่อนหน้านี้
แทบจะแน่นอนว่าเป็น noise ของ baseline เอง และมันดูระบุสาเหตุได้เพียงเพราะสาม pass บังเอิญตรงกันในครั้งนั้น

**สิ่งที่ยังยืนอยู่:** ตัวควบคุมทำงาน รายงานผล และแยก *วัดแล้วสะอาด* ออกจาก *ไม่ได้วัด* ได้ ·
`https://example.com/` รายงาน `perturbed (0)` เป็นตัวควบคุมของตัวมันเอง — หน้าที่ไม่มีสคริปต์ไม่มีอะไรให้ hook
รบกวน · **มันยังไม่เคยพบ perturbation ที่รอดจากการเทียบกับ plain pass ทุกอัน** ซึ่งเป็นคำกล่าวที่เล็กกว่าและต่างจาก
ที่ส่วนนี้เขียนไว้เมื่อชั่วโมงก่อนมาก

**สิ่งที่เนื้อหาของ #171 บันทึกไว้ยังยืนอยู่และยังแคบ** · baseline ของมันคือ *"load 4,171 ms เทียบ 3,361 ms ·
61 เทียบ 60 rAF frame ต่อวินาที · motion นิ่งเหมือนกัน — ต่ำกว่า noise ระหว่างรอบ"* · นั่นเป็นตัวเลขเชิงเวลา มันไม่
เคยดู digest · ตัวควบคุมนี้ดู digest แล้วและยังไม่พบอะไร · ทั้งสองผลไม่ได้อนุญาตให้ติด instrument ทั้งสองฝั่ง —
**การไม่พบอะไรในสองรอบไม่ใช่ budget**

**ข้อจำกัดที่รู้อยู่ และไม่ได้ลงมือแก้** · รอบที่ติด hook ใช้แผนการโต้ตอบที่ค้นพบจากฝั่งธรรมดาซ้ำ · นั่นทำให้สองรอบ
เทียบกันได้ ซึ่งเป็นกฎของด่านเอง — *ตัวขับเดียวกันทั้งสองฝั่ง* — แต่แปลว่า perturbation ที่เปลี่ยน**ว่า element ไหน
ค้นพบได้** จะมองไม่เห็นจากตัวควบคุมนี้ · การค้นแผนที่สองแล้ว diff แผนกันเป็นการวัดคนละอย่าง

## network attempt set — ฟิลด์ที่เจอความต่างตั้งแต่รอบแรก

ขอบเขต v1 ของ #171 ระบุมันไว้ และ digest ไม่มีมัน (ยกข้อความมาในส่วน EN)

**ถ้าไม่มีมัน ด่านคืน `PASS` ให้ clone ที่ยิง request คนละชุดกันเลยได้** ซึ่งตรงข้ามกับสิ่งที่โปรเจกต์นี้อ้าง ·
issue ระบุเคสรูปธรรมไว้: `www.chaingpt.org` เสิร์ฟ `Cannon_Exterior.hdr` ซึ่งเป็น environment map ของฉาก
3D ไม่ได้ การเทียบระดับ API จึงผ่านขณะที่ฉากเรนเดอร์แบบไม่มีแสง

`network.requests` และ `network.origins` คือจำนวน resource และ origin ที่ไม่ซ้ำกันซึ่งหน้าเว็บร้องขอ อ่านจาก
`performance.getEntriesByType("resource")` **ผ่าน seam เดียวกันทั้งสองฝั่ง** ผ่านการ normalize ตาม ADR 0007
ด้วย volatile key ของผู้เรียกและไม่มีนโยบายที่ประดิษฐ์ขึ้นเอง · สองจำนวนไม่ใช่จำนวนเดียว: clone ที่ดึงของจำนวนเท่ากัน
จากคนละที่ เป็นความล้มเหลวคนละแบบกับ clone ที่ดึงของจำนวนต่างกัน

ผลรอบจริงรอบแรกบน `https://www.chaingpt.org/` อยู่ในบล็อกด้านบน

**เป็น `FAIL` บนพื้นผิวที่ด่านไม่เคยมองมาก่อน** บนเว็บที่เพิ่งได้ `INCOMPLETE` ไม่กี่นาทีก่อนหน้าโดยฟิลด์อื่นตรงกันหมด ·
`network.origins` **ไม่ได้**อยู่ใน `unstable` แปลว่า live สามรอบตรงกันที่ 27 และ replay สามรอบตรงกันที่ 28 ·
ความต่างเกิดซ้ำได้

**ทิศทางคือส่วนที่น่าสนใจ และยังไม่ได้วินิจฉัย** · replay แตะ origin *มากกว่า* ฝั่งสด ไม่ใช่น้อยกว่า · มีสองการอ่านที่
เป็นไปได้และรอบนี้ไม่ได้เลือกระหว่างสองอัน: archive ถูกสร้างโดยรอบ capture ของตัวเอง มันจึงถืออีก origin หนึ่งที่ live
สามรอบที่ถูกเทียบไม่ได้ร้องขอได้อย่างชอบธรรม · หรือ replay กำลังแตะบางอย่างที่หน้าสดไม่แตะ · **การเรียกมันว่า "clone
ดึงของเกิน" คือการกระโดดแบบเดียวกับที่เอกสารนี้ต้องถอนคืนในหัวข้อก่อนหน้า** · มันคือความต่างที่เกิดซ้ำได้บนพื้นผิวที่
ไม่เคยมีการคุมเลย ซึ่งเป็นเหตุผลที่ฟิลด์นี้ถูกเพิ่มเข้ามา

## สิ่งที่ไม่มีรอบไหนพูด

`listener_execution` เป็น **0% ทุกรอบ** · v1 ไม่ได้ขับ listener เลย และ verdict เขียวตรงนี้เป็นคำกล่าวเกี่ยวกับการนำทางและการเลื่อน และไม่เกี่ยวกับอย่างอื่น · การอ่านแถวไหนข้างบนว่า *"clone สมจริง"* คือการอ่านข้าม coverage vector ไป ซึ่งเป็นเหตุผลทั้งหมดที่มันเป็นเวกเตอร์
