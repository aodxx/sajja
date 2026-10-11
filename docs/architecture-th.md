# สถาปัตยกรรมและการออกแบบ (Architecture Notes)

## 1. ภาพรวม

```
[Android Chrome + PWA]                [GitHub]                      [Actions]
 index.html + Service Worker  ◄── deploy ──  repo: sajjja-app  ──►  deploy.yml  → Pages
 js/ (ES modules ไม่มี build)                                         (syntax+tests แล้ว publish app/)
 IndexedDB (docs store + kv)                repo: sajjja-data   ──►  validate-data.yml
        │                                   data/current.json        (mini-schema + integrity)
        ├── Export/Import JSON (.json/.enc.json)                ──►  backup-data.yml
        └── (ทางเลือก) GitHub Contents API: push/pull                    (artifact 90 วัน + เตือนสำรองขาดตอน)
```

- **Local-first, offline-first:** IndexedDB เป็น source of truth ของเครื่อง; ไม่มีเซิร์ฟเวอร์ ไม่มีฐานข้อมูลภายนอก
- Service Worker cache-first precache ทุกไฟล์ (~250KB ไม่รวม SheetJS ที่ lazy-load ครั้งแรกเฉพาะตอนใช้ Excel)
- แยก 2 repo: *app* (โค้ด public ได้ ไม่มีข้อมูลบุคคล) กับ *data* (ไฟล์สำรอง, ควร private และ/หรือเข้ารหัส)

## 2. การจัดการข้อมูล

ทุก record = `{ id, type:<collection>, ...fields, createdAt?, updatedAt, deletedAt? }` เก็บใน object store
เดียวแบบ keyPath `["type","id"]` + index `by-type` — ทำให้ merge ง่ายและ schema ชัดเจน

| collection | คือ | id |
|---|---|---|
| members | ทะเบียนสมาชิก | S001, S002... (auto) |
| txs | เดินบัญชีเงินสดทุกบาท (11 ชนิด ตาม `TX_KINDS`) | tx-<timestamp36>-<rand> |
| loans | สัญญากู้ (waiting/active/closed/void) | L001, L002... |
| settings | `cfg` (กติกา/ตัวเลขทุกตัวปรับได้) + `group` | คงที่ |
| users | กรรมการ + PIN hash (PBKDF2-SHA256, 120k รอบ) | treasurer / uxxx |
| audit | log ทุกการแก้ไข (actor/action/entity/refId/before/after/reason) | au-xxx |
| deleted | tombstone ของทุก collection (กัน import แล้วคืนชีพ) | (embedded ใน snapshot) |

**Soft delete เท่านั้น:** `deletedAt` = บัญชีปิดโดยสมบูรณ์ไม่ได้ลบ log; กู้คืนได้จากหน้า Audit
**การคำนวณแบบ derive ทั้งหมด** (ยอดสะสม สถานะ ตารางผ่อน ปันผล งบ) ไม่ stored → ไม่มี "ยอดค้างไม่ตรง"
เมื่อข้อมูลเปลี่ยน; ฟังก์ชันคำนวณแยกเป็น `calc.js` (pure) ทดสอบด้วย Node ได้ทันที —
ทีมพัฒนาต้องมี CI รัน `test-calc.mjs` ก่อน merge เสมอ

**Merge ข้ามอุปกรณ์ (Last-Write-Wins ต่อ id):** ทุก record มี `updatedAt`; import แบบ "รวม"
จะรับเฉพาะเวอร์ชันใหม่กว่า จึงปลอดภัยเมื่อ 2 เครื่อง (เช่นเหรัญญิก+เลขานุการ) บันทึกแยกกันแล้วมา sync
ภายหลังผ่าน LINE — แนวทางนี้ยอมรับว่า *ไม่* มี distributed conflict เชิงซับซ้อน (CRDT) ซึ่งไม่จำเป็นกับ 30 คน

## 3. ความปลอดภัย (ตามจริง ไม่พูดเกิน)

| เรื่อง | สิ่งที่ระบบทำ |ข้อจำกัดที่คณะกรรมการต้องรู้ |
|---|---|---|
|PIN | PBKDF2 120k รอบ, เทียบ constant-time, ไม่มี PIN เก็บตรง ๆ | กันคนทั่วไปแอบใช้ app on เครื่อง — ไม่ใช่ banking-grade; มือถือต้องตั้ง lock screen
|สำรองไฟล์ | เลือกเข้ารหัส AES-256-GCM (PBKDF2 210k รอบ, key จาก passphrase) บนเครื่องก่อนอัป GitHub | รหัสหาย = กู้ข้อมูลไม่ได้ (ย้ำ 2 ครั้งตอนตั้ง)
| repo เป็น public | ไฟล์ `.enc.json` ไม่มีใครอ่านข้อมูลได้ (GitHub เองก็เห็นแค่ ciphertext) | ถ้าใช้ token sync อัตโนมัติ: คนถือ token ลบ/ทับข้อมูลได้ (มี history/git history คืนค่าได้) — จึงปิดไว้เป็น default, v1 ใช้วิธี "ลากวางไฟล์บนเว็บ GitHub" ซึ่งไม่เก็บ token ในแอปเลย
| Audit | ทุก action บันทึก before/after + เหตุผล (บังคับตอนลบ) | auditor อ่านอย่างเดียว เปลี่ยน log ไม่ได้ (ในระบบเท่านั้น)
| Session | จำชื่อบุคคลล่าสุด แต่ PIN ต้องใส่ใหม่ทุกครั้งหลัง reload | ไม่มี "ลืม PIN" — กู้โดย import backup ไปเครื่องอื่น + สร้าง user ใหม่ (ออกแบบให้ปลอดภัยไว้ก่อน)

ข้อจำกัดที่พูดตรง ๆ: local-first = ข้อมูลจริงก้อนล่าสุดอยู่ในเครื่องเดียว → "กฎสำรองทุกสิ้นเดือน" สำคัญกว่า
มาตรการเทคนิคทั้งหมด ระบบจึงเตือนบน dashboard เมื่อเกิน 7 วันไม่มีการสำรอง

## 4. การขยายระบบในอนาคต

1. **เปิด sync อัตโนมัติ** เมื่อพร้อม: ผู้ตรวจสอบยืนยันว่า repo เป็น private → เหรัญญิกรับ Fine-grained PAT
   (contents: RW เฉพาะ repo data, อายุ ≤90 วัน) → เปิดสวิตช์ในหน้าสำรอง (โมดูล `sync.js` พร้อมใช้รวมอยู่
   แก้ conflict ด้วย 409+refetch+merge อัตโนมัติ สูงสุด 3 รอบ)
2. **เพิ่ม report** ตามแบบ อบต./กองทุนหมู่บ้าน: เพิ่ม builder ใน `ui-reports.js` + print template ใน fileio
3. **SMS/LINE แจ้งเตือนอัตโนมัติ**: ยังไม่มี — ต่อยอดจาก flow "ใกล้ครบกำหนด/ค้าง" ใน `loanAlerts()`
   โดยส่งออกผ่าน GitHub Actions `schedule` cron + LINE Notify (ยังฟรี) — ต้องย้าย snapshot (เข้ารหัส) ขึ้น repo ทุกสัปดาห์ก่อน
4. **สมาชิก >50 คน หรือหลายหมู่บ้าน**: snapshot ยัง merge ได้ (ขนาด <~2MB) แต่ถ้าต้องการ role ยิบย่อย /อนุมัติ online
   จากหลายคณะกรรมการพร้อมกัน ให้พิจารณาย้าย sync เป็น Cloudflare Workers + free tier ที่ 2 (เปลี่ยนเฉพาะ service layer)
5. **QR สลิปให้สมาชิก**: สลิป PDF ต่อคนต่อเดือนวางไฟล์บน GitHub Pages ให้เปิดดู (ต้องแลกกับไม่เข้ารหัส — ต้องทำ
   เป็นสลิปไม่ระบุยอดคงเหลือของคนอื่น)
6. **PWA auto-update**: ไล่ version `sajja-vN` ใน sw.js ทุกครั้งที่ deploy — ผู้ใช้เก่าเปิดเว็บแล้วได้ของใหม่ทันที

## 5. เหตุผลการตัดสินใจสำคัญ (trade-offs)

- **ไม่มี database ภายนอก** → ฟรี 100% ตามโจทย์ แต่แลกกับการไม่มี real-time multi-device → รับได้
  เพราะกลุ่มประชุมเดือนละครั้ง
- **PDF ผ่านหน้าจอพิมพ์** แทน jsPDF+font embedding: ฟอนต์ไทย/ตารางสวย 100% ทุกเครื่องไม่เพี้ยน,
  น้ำหนักไฟล์เป็น 0 — ครอบคลุมทั้ง "export PDF" ตามเกณฑ์
- **Excel ใช้ SheetJS (vendor local)** แทน SpreadsheetML ที่เขียนเอง: ไฟล์ `.xlsx` แท้ เปิดด้วยมือถือได้จริง
  lazy-load ครั้งแรก แล้ว SW caches → ใช้ต่อได้ตลอด
- **ค่าบำรุง flat 2% ของเงินต้น** ตามมติคณะกรรมการ (งวดเท่า ๆ กัน จำง่าย) และระบบรองรับการปรับเป็น
  ลดต้นได้ (แก้ฟังก์ชันเดียวใน calc.js + test)
