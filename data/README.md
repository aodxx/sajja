# โฟลเดอร์ "คลังข้อมูล" (เมื่อใช้ repo นี้เป็น data store)

วางไฟล์สำรองที่แอปสร้างไว้ที่นี่ เช่น `current-2026-10-31.enc.json` (หรือ `current.json`)

- อัปโหลดผ่านเว็บ github.com โดย เหรัญญิก (login ปกติ) — ไม่ต้องเก็บ token ในมือถือ
- ทุก push → Actions: validate (schema+integrity) และเก็บ artifact ย้อนหลัง 90 วัน
- ไฟล์ `.enc.json` เข้ารหัส AES-GCM จากเครื่องแล้ว — GitHub/Public ก็ปลอดภัย (จำ passphrase ให้ดี)
- อย่าแก้ไขไฟล์ในโฟลเดอร์นี้ด้วยมือ —ให้แอปเป็นฝั่งเขียนเท่านั้น (กันข้อมูลเพี้ยน audit)
