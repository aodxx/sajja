# เงินสัจจะชุมชน — ระบบบริหารกลุ่มออมทรัพย์หมู่บ้าน (PWA)

Static Web App 100% (HTML/CSS/JS ไม่มี framework, ไม่มี backend) ทำงานออฟไลน์เต็มรูปแบบ
ข้อมูลอยู่ในเครื่องผู้ใช้ (IndexedDB) สำเนา/ย้ายเครื่องผ่านไฟล์ JSON (เข้ารหัส AES-GCM ได้)
Deploy ด้วย GitHub Pages + GitHub Actions — ฟรีทั้งหมด

## โครงสร้าง

```
.
├── app/                    # ตัวแอป → publish ไป GitHub Pages (โฟลเดอร์นี้คือ site root)
│   ├── index.html          # โครง + login PIN
│   ├── manifest.webmanifest# ติดตั้งเป็นแอปบน Android ("เพิ่มสู่หน้าจอหลัก")
│   ├── sw.js               # Service Worker cache-first → ออฟไลน์ 100%
│   ├── css/app.css         # UI ปุ่มใหญ่ ตัวหนา สำหรับทุกวัย
│   ├── js/
│   │   ├── app.js          # router, boot, สิทธิ์ (เหรัญญิก/เลขานุการ/ผู้ตรวจสอบ)
│   │   ├── db.js           # IndexedDB + Soft Delete + Audit + Merge (LastWriteWins)
│   │   ├── calc.js         # สูตรเงินทั้งหมด (ส่งแล้ว/ค้าง/ล่าช้า, ผ่อน flat 2%, ปันผล, งบดุล...)
│   │   ├── crypto.js       # PBKDF2-PIN, เข้ารหัสไฟล์สำรอง AES-GCM
│   │   ├── fileio.js       # Export/Import, XLSX ผ่าน SheetJS, CSV(BOM), PDFผ่านหน้าจอพิมพ์
│   │   ├── sync.js         # เลือกได้: GitHub Contents API (token) หรือไฟล์
│   │   └── ui-*.js         # หน้าจอ: dashboard/members/savings/loans/welfare/dividend/reports/audit/settings
│   ├── vendor/xlsx.full.min.js  # SheetJS (โหลดแบบ lazy ครั้งแรกเมื่อใช้ Excel)
│   └── data/sample-data.json    # ข้อมูลตัวอย่าง 5 สมาชิก โหลดได้ 1 ปุ่ม
├── schema/                 # JSON Schema (member / transaction / loan / snapshot)
├── data/                   # ← ถ้าคุณใช้ repo นี้เป็น "คลังข้อมูล": วางไฟล์สำรองลง data/
├── scripts/
│   ├── validate.mjs        # mini-JSON-Schema + ตรวจความสอดคล้องบัญชี (CI ใช้งานตัวนี้)
│   ├── test-calc.mjs       # 11 หมวดทดสอบสูตรเงิน (CI ใช้งาน)
│   ├── seed.mjs            # สร้างใหม่ซึ่งข้อมูลตัวอย่าง
│   └── make-manual.py      # แปลง docs/manual-th.md → PDF คู่มือ
├── docs/manual-th.md/.pdf  # คู่มือผู้ใช้ภาษาไทย (≤10 หน้า)
└── .github/workflows/
    ├── deploy.yml          # push app/ → ตรวจ syntax + รันเทสต์ → GitHub Pages
    ├── validate-data.yml   # push data/ → ตรวจ schema + regression tests
    └── backup-data.yml     # push data/ ทุกครั้ง + cron → artifact history + เตือนเมื่อสำรองขาดเกิน 14 วัน
```

## เริ่มต้นใช้ใน 5 ขั้นตอน (ผู้ดูแลที่ถนัด GitHub)

1. **สร้าง repository** (แนะนำ `sajja`) ใส่โค้ดทั้งหมดของโฟลเดอร์นี้ลง `main`
2. **เปิด Pages**: Settings → Pages → Source: **GitHub Actions** (ไม่ต้องตั้งค่าอื่น — workflow จัดให้)
3. push แล้วรอ ~1 นาที ได้ลิงก์ `https://<user>.github.io/sajja/` (Actions แท็บจะขึ้น ✅ deploy)
4. ส่งลิงก์ให้เหรัญญิก → เปิด Chrome → ⋮ → **"เพิ่มสู่หน้าจอหลัก"** → ตั้งค่ากลุ่ม + PIN ครั้งแรก
   (กดปุ่ม "ลองโหลดข้อมูลตัวอย่าง" เพื่อทดลองก่อนใช้งานได้)
5. **repo ข้อมูล** (แยกจากโค้ด) เช่น `sajja-data` สร้างโฟลเดอร์ `data/` — เหรัญญิกอัปโหลดไฟล์สำรองขึ้นที่นี่
   ถ้าอยากให้ private ได้: ใช้ GitHub Pro หรือเปิด public + **เปิดโหมดเข้ารหัสทุกไฟล์** (แอปเข้ารหัส AES-GCM ก่อนออกไฟล์เสมอ — บน GitHub จึงเป็น ciphertext อย่างเดียว)

## กติกาข้อมูล (สำคัญมาก)

- `app/data/sample-data.json` = ตัวอย่างทดสอบ **ไม่ใช่ของจริง**
- ข้อมูลจริงอยู่บนเครื่องเหรัญญิกเพียงเครื่องเดียว + ไฟล์สำรอง; ห้ามแก้ไฟล์ข้อมูลผ่าน GitHub web ตรง ๆ
- ไฟล์สำรองที่อัปเข้า repo ข้อมูล = `current.json` (merge-safe: ทุก record มี id + updatedAt)
- ทุกการ import เป็นแบบ **merge Last-Write-Wins ต่อ record** — เครื่อง 2 เครื่องบันทึกแยกกันแล้วมารวมกันได้ไม่ชน

## การซิงก์ข้ามอุปกรณ์ (3 ระดับ เลือกตามความพร้อม)

| ระดับ | วิธี | ต้องมี token? |
|---|---|---|
| 1 มือ-ต่อ-มือ (เริ่มใช้) | Export ไฟล์ → ส่ง LINE/Google Drive → อีกเครื่อง Import "รวม" | ไม่ |
| 2 กึ่งอัตโนมัติ (แนะนำสิ้นเดือน) | Export ไฟล์ (เข้ารหัส) → ลากวางใส่ `data/` บน github.com ด้วยมือถือเอง (login ธรรมดา ไม่ต้องใช้ token ในแอป) → Actions ตรวจ+เก็บประวัติ | ไม่ |
| 3 อัตโนมัติเต็ม (ขั้นสูง) | เมนูสำรอง → วิธีที่ 3 ใส่ Fine-grained PAT (จำกัด repo data เดียว, contents:RW, หมดอายุ 90 วัน) → Push/Pull ในแอป | ใช่ |

คำเตือนข้อ 3: token ในเบราว์เซอร์ = ความเสี่ยงหลักของระบบ ใช้เฉพาะเครื่องเหรัญญิกเท่านั้น ห้ามแชร์;
ข้อมูลถูกเข้ารหัสก่อนอัปโหลดเสมอ ดังนั้น repo public ก็ยังไม่เห็นข้อมูลสมาชิก (แต่ถ้าทำได้ ใช้ private)

## พัฒนาต่อ / รันเทสต์ locally

```bash
node scripts/seed.mjs            # สร้างข้อมูลตัวอย่างซ้ำได้
node scripts/test-calc.mjs       # 11 หมวดเทสต์สูตร (สถานะส่ง, ค่าปรับ, FIFOผ่อน, ปันผล, งบดุล)
node scripts/validate.mjs schema/*.json data/*.json
python3 scripts/make-manual.py   # สร้างคู่มือ PDF ใหม่เมื่อแก้ docs/manual-th.md
cd app && python3 -m http.server 3000   # ลองแอป (SW ทำงานบน localhost)
```

## เกณฑ์การยอมรับที่ทดสอบผ่านแล้ว

- ✅ ออฟไลน์ 100%: ปิดเซิร์ฟเวอร์ทั้งก้อน → reload → ล็อกอิน PIN → บันทึก/ดูยอดได้ครบ (ทดสอบด้วย Chromium จริง)
- ✅ บันทึกออม 30 คน: ใช้ "เก็บครบทุกคน" แล้วแก้รายที่ไม่ส่ง (แตะครั้งเดียว + แก้รายคนที่ไม่ส่ง)
- ✅ สูตรปันผล/ผ่อน/งบดุล: ผ่าน unit tests 11 หมวด (flat 2%, FIFO fee→principal ปันผล 50% เศษปัดเข้ากองทุน)
- ✅ Export ผ่านไฟล์จริง: `.json`/`.enc.json`/`.xlsx`/`.csv` ดาวน์โหลดสำเร็จ + import merge คืนได้
- ✅ Deploy+validate ผ่าน GitHub Actions ใน deploy.yml เดียวกันได้

## ดูแลรักษา (ผู้ดูแลระบบกลุ่ม)

- ทุกเดือน: ดูแท็บ Actions ของทั้ง 2 repo — ควร ✅; ตรวจว่า backup-data.yml ไม่มี warning ข้อมูลไม่อัปเดตเกิน 14 วัน
- ทุกปี: ก่อน 31 ธ.ค. ทวน openingCash/กติกา, สำรองไฟล์เข้ารหัสเก็บนอกเครื่อง 1 ชุด, เปลี่ยน PIN ทั้งกรรมการ
- ถ้าแอปพัง/ไฟล์หาย: import ไฟล์สำรองล่าสุด → ทำต่อได้ (ข้อมูลหลังวันสำรองต้องจดจากสมุดกระดาษ)
- เวอร์ชันนิ่ง: ถ้าเปลี่ยน logic การเงิน ต้องรัน `test-calc.mjs` ให้ผ่านก่อน merge เสมอ Actions ทำให้อยู่)
