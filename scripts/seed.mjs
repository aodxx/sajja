/* scripts/seed.mjs — สร้างข้อมูลตัวอย่าง: สมาชิก 5 คน + สัจจะ 8 เดือน + หุ้น + ออมปี
 * ค่าปรับ + กู้ 3 สัญญา (active/closed/waiting) + ชำระงวด + สวัสดิการ + ปันผลปี 2568
 * รัน: node scripts/seed.mjs  → writes data/sample-data.json + app/data/sample-data.json */
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash, randomBytes, pbkdf2Sync } from "node:crypto";

const NOW = new Date();
const pad = (x) => String(x).padStart(2, "0");
const ymOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const addM = (ym, k) => { let [y, m] = ym.split("-").map(Number); m += k; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1; return `${y}-${pad2(m)}`; };
const pad2 = (x) => String(x).padStart(2, "0");
const dOfMonth = (ym, day) => `${ym}-${pad2(Math.min(day, 28))}`;

const thisYM = ymOf(NOW);
const months = Array.from({ length: 14 }, (_, i) => addM(thisYM, i - 13)); // 13 เดือนก่อน → เดือนนี้

const members = [
  mk("S001", "สมจิตร ใจดี", "จิตร", 50, addM(thisYM, -13), "0811111111"),
  mk("S002", "ประเสริฐ ช่วยเรือง", "เสริฐ", 50, addM(thisYM, -13), "0822222222"),
  mk("S003", "วิไล พงษ์สุข", "วิ", 100, addM(thisYM, -9), "0833333333"),
  mk("S004", "ดำรงค์ ศรีบุญ", "ดำ", 30, addM(thisYM, -7), "0844444444"),
  mk("S005", "บุญมา แก้วกล้า", "มา", 50, addM(thisYM, -5), "0855555555"),
];
function mk(id, name, nick, monthly, joinedYM, phone) {
  return { id, code: id.slice(1), type: "members", name, nick, phone, monthly,
    joined: joinedYM + "-05", status: "active", updatedAt: new Date().toISOString() };
}

const txs = [];
let n = 0;
const tx = (o) => { const d = Object.assign({ id: "tx" + (++n).toString().padStart(4, "0"), type: "txs", note: "", updatedAt: new Date().toISOString() }, o); txs.push(d); return d; };

/* ---- สัจจะ: สมจิตรครบ, ประเสริฐขาด 1 (เดือน -4 → ค่าปรับจ่ายแล้ว), วิไลขาดเดือน -2 (ใบปรับยังไม่เก็บ),
      ดำรงค์ขาดเดือนนี้ยังไม่วัด, บุญมาเข้ากลุ่มช้า + ขาด 2 เดือนติด ---- */
for (const m of members) {
  const joinIdx = months.indexOf(String(m.joined).slice(0, 7));
  for (const ym of months.slice(joinIdx)) {
    const skip = (m.id === "S002" && ym === addM(thisYM, -4)) || (m.id === "S003" && ym === addM(thisYM, -2)) ||
      (m.id === "S005" && (ym === addM(thisYM, -2) || ym === addM(thisYM, -1))) || (m.id === "S004" && ym === thisYM);
    if (skip) continue;
    tx({ kind: "saja", member: m.id, ym, amount: m.monthly, at: dOfMonth(ym, 10) });
  }
}
/* ค่าปรับของเดือนที่เลยกำหนด: S002 (จ่ายแล้ว) S003 (ออกใบแล้วยังไม่จ่าย) S005 (ยังไม่ออกใบ) */
tx({ kind: "fine", member: "S002", fineYM: addM(thisYM, -4), amount: 20, at: dOfMonth(addM(thisYM, -3), 10), received: true, title: "ค่าปรับขาดส่ง" });
tx({ kind: "fine", member: "S003", fineYM: addM(thisYM, -2), amount: 20, at: dOfMonth(addM(thisYM, -1), 10), received: false });

/* ---- หุ้น ---- */
const shares = [["S001", 50], ["S002", 30], ["S003", 20], ["S004", 15], ["S005", 10]];
for (const [m, cnt] of shares) tx({ kind: "sharebuy", member: m, n: cnt, amount: cnt * 10, at: months[1] + "-15", ym: months[1] });
tx({ kind: "sharebuy", member: "S001", n: 20, amount: 200, at: months[10] + "-15", ym: months[10] });

/* ---- ออมรายปี ---- */
for (const m of ["S001", "S002", "S003", "S004"]) tx({ kind: "annualsave", member: m, amount: 120, at: months[0] + "-20", ym: months[0] });
for (const m of ["S001", "S002"]) tx({ kind: "annualsave", member: m, amount: 120, at: addM(thisYM, -10) + "-20", ym: addM(thisYM, -10) });

/* ---- กู้ S001: 1,000฿ 10 งวด ปิดแล้ว (งวด 1-10 จ่ายครบ) ---- */
const loans = [];
function loan(id, member, name, principal, monthsN, startYM, status, purpose, guar, extra = {}) {
  const L = { id, type: "loans", member, name, principal, months: monthsN, feePct: 2, start: startYM + "-10",
    appliedAt: startYM + "-08", status, purpose, purposeTh: { sick: "เจ็บป่วย", study: "ค่าเล่าเรียน", other: "อื่นๆ", emergency: "ฉุกเฉิน(สวัสดิการ)" }[purpose] || "อื่นๆ", guarantorIds: guar, updatedAt: new Date().toISOString(), ...extra };
  loans.push(L); return L;
}
const L1 = loan("L001", "S001", "สมจิตร ใจดี", 1000, 10, months[1], "closed", "sick", ["S002", "S004"], { closedAt: months[11] + "-10" });
/* ---- กู้ S002: 1,000฿ 10 งวด active จ่ายแล้ว 4 งวดตรงเวลา + งวด 5 ยังไม่จ่าย (กำหนดวานนี้ = ⏰) ---- */
const L2 = loan("L002", "S002", "ประเสริฐ ช่วยเรือง", 1000, 10, addM(thisYM, -5), "active", "study", ["S001", "S003"]);
/* ---- กู้ S004: 1,200฿ รออนุมัติ (purpose emergency) ---- */
const L3 = loan("L003", "S004", "ดำรงค์ ศรีบุญ", 1200, 10, thisYM, "waiting", "emergency", ["S001", "S002"]);

for (const [L, payCount] of [[L1, 10], [L2, 4]]) {
  tx({ kind: "loan_out", member: L.member, loanId: L.id, amount: L.principal, at: L.start, ym: L.start.slice(0, 7), title: "จ่ายกู้ " + L.id });
  const per = round(L.principal / L.months), fee = round(L.principal * 0.02);
  for (let i = 1; i <= payCount; i++) {
    const ym = addM(L.start.slice(0, 7), i);
    const t = tx({ kind: "loan_repay", member: L.member, loanId: L.id, amount: round(per + fee), at: dOfMonth(ym, 10), ym, fee: fee, principal: per, title: "งวด " + i });
  }
}
/* ---- สวัสดิการ: งบอุดหนุน 1,000 + รับบริจาค 500 + ฌาปนกิจ 300 + เจ็บป่วย 3 คืน 300฿ ---- */
tx({ kind: "welfare_in", cat: "gov", amount: 1000, at: dOfMonth(addM(thisYM, -8), 12), ym: addM(thisYM, -8), title: "งบสนับสนุนจาก อบต." });
tx({ kind: "welfare_in", cat: "donation", amount: 500, at: dOfMonth(addM(thisYM, -6), 20), ym: addM(thisYM, -6), title: "งานกฐินกองทุน" });
tx({ kind: "welfare_out", cat: "S001", member: "S001", memberName: "สมจิตร ใจดี", amount: 300, at: dOfMonth(addM(thisYM, -3), 18), ym: addM(thisYM, -3), title: "🕯️ ฌาปนกิจ" });
tx({ kind: "welfare_out", cat: "S002", member: "S002", memberName: "ประเสริฐ ช่วยเรือง", amount: 300, nights: 3, at: dOfMonth(addM(thisYM, -2), 15), ym: addM(thisYM, -2), title: "🛏️ ค่าเสียโอกาสเจ็บป่วย" });

/* ---- settings + users + audit ---- */
const settings = [
  { id: "group", type: "settings", v: { name: "กลุ่มออมทรัพย์บ้านทุ่งสบาย (ข้อมูลตัวอย่าง)", village: "ต.ทุ่งสบาย อ.เมือง" }, updatedAt: new Date().toISOString() },
  { id: "cfg", type: "settings", v: {
      sajaMonthly: 50, sajaDueDay: 25, sharePrice: 10, annualTarget: 120, lateFine: 20,
      loanMinMonthsSaved: 3, loanBaseLimit: 1000, loanMaxMonths: 10, loanFeePct: 2,
      guarantorsMin: 2, sickNightPay: 100, sickMaxNightsYear: 10, dividendPctOfProfit: 50, openingCash: 500 }, updatedAt: new Date().toISOString() },
];
const salt = randomBytes(16).toString("base64");
const users = [
  { id: "treasurer", type: "users", name: "สมจิตร ใจดี", role: "treasurer", active: true,
    pin: { algo: "PBKDF2-SHA256-120k", salt, hash: pbkdf2Sync("1234", Buffer.from(salt, "base64"), 120000, 32, "sha256").toString("base64") },
    updatedAt: new Date().toISOString() },
  { id: "u-audit", type: "users", name: "พี่ผู้ตรวจสอบ — วิไล", role: "auditor", active: true,
    pin: { algo: "PBKDF2-SHA256-120k", salt, hash: pbkdf2Sync("9999", Buffer.from(salt, "base64"), 120000, 32, "sha256").toString("base64") },
    updatedAt: new Date().toISOString() },
];
const audit = [
  { id: "au-seed", type: "audit", entity: "-", ts: new Date().toISOString(), actor: "ตัวอย่าง", action: "create", refId: "-", reason: "โหลดชุดข้อมูลตัวอย่าง (ปุ่ม ลองใช้ ในหน้าแรก)" },
];

function round(x) { return Math.round(x * 100) / 100; }

const snap = {
  format: "sajja-data-v1",
  exportedAt: NOW.toISOString(),
  appVersion: "1.0.0",
  data: { members, txs, loans, users, settings, audit },
};
const out = JSON.stringify(snap, null, 1);
mkdirSync("data", { recursive: true });
mkdirSync("app/data", { recursive: true });
writeFileSync("data/sample-data.json", out);
writeFileSync("app/data/sample-data.json", out);
console.log("✅ wrote data/sample-data.json + app/data/sample-data.json (" + members.length + " members, " + txs.length + " tx, " + loans.length + " loans)");
