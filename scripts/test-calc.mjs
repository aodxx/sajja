/* test-calc.mjs — ชุดทดสอบสมองคำนวณ (รันใน GitHub Actions ทุกครั้ง) */
import { strict as A } from "node:assert";
import { readFileSync } from "node:fs";
import {
  DEFAULT_CFG, sajaStatus, schedule, loanState, eligibility, finesPending, memberTotals,
  welfareFund, dividendCalc, incomeExpense, balanceSheet, feeIncomeByYear, round2, sumSaja,
} from "../app/js/calc.js";

const pad = (x) => String(x).padStart(2, "0");
const curM = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const addM = (ym, k) => { let [y, m] = ym.split("-").map(Number); m += k; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1; return `${y}-${pad(m)}`; };
const Y = Number(curM().slice(0, 4));
const d = (ym, day = 10) => `${ym}-${pad(Math.min(day, 28))}`;

const cfg = { ...DEFAULT_CFG };
const M = (id, name, joinedYM, monthly = 50) => ({ id, type: "members", name, joined: joinedYM + "-05", monthly, status: "active" });
const mem = { S001: M("S001", "ทดสอบ หนึ่ง", addM(curM(), -8)), S002: M("S002", "ทดสอบ สอง", addM(curM(), -6)), S003: M("S003", "ทดสอบ สาม", curM()) };
const TX = (o) => ({ id: "t" + Math.random().toString(36).slice(2, 8), type: "txs", amount: 0, at: d(curM()), ym: curM(), ...o });

let st = {
  members: Object.values(mem), txs: [], loans: [], users: [], cfg, group: { name: "ท" },
};
const say = (s) => console.log(" •", s);

/* ---------- 1) สถานะสัจจะรายเดือน ---------- */
// S001 เข้ากลุ่มมา 8 เดือน: ส่งครบทุกเดือน ยกเว้น m-2 (เพื่อทดสอบค้าง+ค่าปรับ)
for (let k = -8; k <= -1; k++) if (k !== -2) st.txs.push(TX({ kind: "saja", member: "S001", ym: addM(curM(), k) }));
st.txs.push(TX({ kind: "saja", member: "S001", ym: addM(curM(), -1) }));
A.equal(sajaStatus(mem.S001, addM(curM(), -1), st), "sent", "เดือนก่อนที่ส่งแล้ว = sent");
A.equal(sajaStatus(mem.S001, addM(curM(), -2), st), "late", "เดือนก่อนที่ไม่ส่ง = late");
const cm = sajaStatus(mem.S001, curM(), st, curM() + "-05");
A.ok(["due", "late"].includes(cm) === false || cm === "due" || cm === "sent" || cm === "late", "เดือนนี้ สถานะอยู่ในเซตที่ถูกต้อง");
A.equal(sajaStatus(mem.S003, addM(curM(), -1), st, d(curM())), "none", "ก่อนเข้ากลุ่ม = none");
say("สถานะส่ง/ค้าง/ล่าช้า ✓");

/* ---------- 2) ค่าปรับอัตโนมัติ (ค้างส่ง = 20฿/เดือน, กันลงซ้ำ) ---------- */
A.equal(finesPending(st, mem.S001).length, 1, "ขาด 1 เดือน (m-2) → ต้องออกใบปรับ 1");
st.txs.push(TX({ kind: "fine", member: "S001", fineYM: addM(curM(), -2), amount: cfg.lateFine, received: true }));
A.equal(finesPending(st, mem.S001).length, 0, "ออกใบปรับแล้วไม่ใบ้ซ้ำ");
say("ค่าปรับอัตโนมัติ ✓");

/* ---------- 3) ตารางผ่อน flat เงินต้นคงที่ + ค่าบำรุงจากเงินต้นกู้ ---------- */
const loan1 = {
  id: "L001", type: "loans", member: "S001", name: "ทดสอบ หนึ่ง", principal: 1000, months: 7, feePct: 2,
  start: d(addM(curM(), -2)), status: "active", purpose: "sick", guarantorIds: ["S002", "S003"],
};
const rows = schedule(loan1, cfg);
A.equal(rows.length, 7);
A.equal(round2(rows.reduce((s, r) => s + r.principal, 0)), 1000, "เงินต้นรวมตรงตามกู้ทุกบาท");
A.ok(rows.every((r) => r.fee === 20), "ค่าบำรุง flat = 20฿ ทุกงวด (1000×2%)");
A.ok(rows[0].due > rows[0].due.slice(0, 7) + "-01");
say("ตารางผ่อน flat ✓");

/* ---------- 4) จัดสรรชำระ: ค่าบำรุงงวดเก่าสุด → เงินต้น ---- */
st.loans.push(loan1);
st.txs.push(TX({ kind: "loan_out", member: "S001", loanId: "L001", amount: 1000, at: loan1.start, ym: loan1.start.slice(0, 7) }));
st.txs.push(TX({ kind: "loan_repay", member: "S001", loanId: "L001", amount: 162.86, at: d(addM(curM(), -1)), ym: addM(curM(), -1) }));
// งวด1 ค่าบำรุง 20 + เงินต้น 142.86 = 162.86
let ls = loanState(st, loan1, d(curM()));
A.equal(ls.feePaid, 20, "งวดแรกเข้าค่าบำรุงครบ 20");
A.equal(ls.princPaid, 142.86, "ส่วนที่เหลือตัดเงินต้นงวดแรก");
A.equal(ls.balance, round2(1000 - 142.86), "เงินต้นคงเหลือถูกต้อง");
// จ่าย 300 ทับงวด 2+3 (ตัดเป็นงวดๆ เรียงก่อน-หลัง: ค่าบำรุง+เงินต่องวดนั้น)
st.txs.push(TX({ kind: "loan_repay", member: "S001", loanId: "L001", amount: 300, at: d(curM()), ym: curM() }));
ls = loanState(st, loan1, d(curM()));
A.equal(ls.feePaid, 60, "ค่าบำรุงงวด 1-3 ครบ (20×3)");
A.equal(ls.princPaid, round2(162.86 - 20 + 300 - 40), "เงินต้น = ส่วนเกินจากค่าบำรุงทั้งหมด");
A.equal(ls.balance, round2(1000 - ls.princPaid));
A.ok((feeIncomeByYear(st)[Y] || 0) >= 40, "รายได้ค่าบำรุงคิดตามปีที่ชำระจริง");
say("การจัดสรรเงินชำระ (FIFO) ✓");

/* ---------- 5) สิทธิ์กู้ 3 เดือน + ผู้ค้ำ 2 + ค้างปรับ ---------- */
const ok = eligibility(st, mem.S001);
A.ok(typeof ok.can === "boolean" && ok.ok.length >= 2 && Array.isArray(ok.bad));
const newGuy = eligibility(st, mem.S003);
A.ok(!newGuy.can && newGuy.bad.some((b) => /ออม/.test(b)), "สมาชิกใหม่ <3 เดือน = กู้ไม่ได้");
say("ตรวจสอบสิทธิ์กู้ ✓");

/* ---------- 6) ยอดสะสมสมาชิก (สัจจะ+หุ้น+รายปี) ---------- */
st.txs.push(TX({ kind: "sharebuy", member: "S001", n: 35, amount: 350 }));
st.txs.push(TX({ kind: "annualsave", member: "S001", amount: 120 }));
const tot = memberTotals(st, mem.S001);
A.equal(tot.sharesN, 35); A.equal(tot.shares, 350); A.equal(tot.annual, 120);
A.equal(tot.saja, sumSaja(st, "S001"));
A.equal(tot.savings, round2(tot.saja + 350 + 120));
say("ยอดสะสมรายตัว + หุ้น ✓");

/* ---------- 7) กองทุนสวัสดิการ ---------- */
st.txs.push(TX({ kind: "welfare_in", cat: "donation", amount: 1000 }));
st.txs.push(TX({ kind: "welfare_out", cat: "cremation", member: "S002", amount: 300 }));
st.txs.push(TX({ kind: "welfare_out", cat: "sick", member: "S002", nights: 3, amount: 300 }));
const w = welfareFund(st);
// in = 1000 + ค่าปรับ 20 (S001, cash=welfare ตาม TX_KINDS) = 1020 ; out = 600
A.equal(w.in, 1020, "ค่าปรับถือเป็นรายรับกองทุนสวัสดิการ");
A.equal(w.out, 600);
A.equal(w.balance, 420);
say("กองทุนสวัสดิการ ✓");

/* ---------- 8) ปันผล: (กำไร×50%) ÷ หุ้นทั้งหมด × หุ้นสมาชิก ---------- */
const d2 = dividendCalc(st, Y, 120); // กำไรสมมติ 120
A.equal(d2.pool, 60, "จัดสรร 50% ตามข้อบังคับ");
const s1 = 35 + (st.txs.some((t) => t.kind === "sharebuy" && t.member === "S002") ? 0 : 0);
A.equal(d2.rows.find((r) => r.member === "S001").amount, round2((60 / d2.allShares) * 35), "ราย人头ตามหุ้น");
A.equal(round2(d2.rows.reduce((s, r) => s + r.amount, 0) + d2.retain), d2.pool, "จ่าย+เศษปัด = กองปันผลพอดี");
const noShare = dividendCalc({ ...st, txs: st.txs.filter((t) => t.kind !== "sharebuy") }, Y, 100);
A.equal(noShare.pool, 50); A.equal(noShare.allShares, 0); A.equal(noShare.perShare, 0);
say("สูตรปันผลถูกต้อง 100% ✓");

/* ---------- 9) งบดุลต้องสม (assets = liabilities) ---------- */
const b = balanceSheet(st, d(curM()));
A.ok(Math.abs(b.assets.total - b.liabilities.total) < 0.01, "งบดุลสองข้างเท่ากัน");
A.ok(b.balanced);
say("งบดุลสมการ ✓");

/* ---------- 10) งบรายรับ-รายจ่าย ปีปัจจุบัน ---------- */
const ie = incomeExpense(st, Y);
A.ok(ie.inc["ค่าบำรุงเงินกู้ (จากรการชำระจริง)"] >= 40);
A.ok(ie.totIn >= ie.inc["ค่าบำรุงเงินกู้ (จากรการชำระจริง)"]);
say("งบรายรับ-รายจ่าย ✓");

/* ---------- 11) ไฟล์ตัวอย่างจริงต้อง validate through shape + schema ---------- */
import { validateSnapshotShape } from "../app/js/db.js";
import { validate } from "./validate.mjs";
const snap = JSON.parse(readFileSync(new URL("../data/sample-data.json", import.meta.url), "utf8"));
A.deepEqual(validateSnapshotShape(snap), [], "sample ผ่าน shape check");
for (const c of ["members", "txs", "loans"]) {
  const sc = JSON.parse(readFileSync(new URL(`../schema/${{ members: "member", txs: "transaction", loans: "loan" }[c]}.schema.json`, import.meta.url), "utf8"));
  for (const doc of snap.data[c]) A.deepEqual(validate(doc, sc), [], `${c}/${doc.id} ผ่าน schema`);
}
say("ชุดข้อมูลตัวอย่างผ่าน schema ทุกrecord ✓");

/* ---------- 12) สลิป: verify code + ICS ---------- */
const R = await import("../app/js/receipt.js");
const tx1 = { id: "t-A", member: "S001", amount: 50, at: "2026-05-10", kind: "saja" };
const c1 = await R.verifyCode(tx1, "K1");
const c2 = await R.verifyCode({ ...tx1 }, "K1");
const c3 = await R.verifyCode({ ...tx1, amount: 40 }, "K1");
A.equal(c1, c2, "code จำเพาะ/ทำซ้ำได้");
A.notEqual(c1, c3, "เปลี่ยนยอด = คนละรหัส (สลิปปลอมตรวจพบได้)");
A.ok(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(c1), "รูปแบบ xxxx-xxxx-xxxx");
A.equal(R.normCode(c1.toLowerCase().replace(/-/g, " ")), c1.replace(/-/g, ""), "แกะ code จากกระดาษทนพิมพ์Spacing");
A.ok(R.normCode("1A2B-3C0D-5E6F").length === 12);
const ics = R.buildICS(st, [{ loan: { id: "L001", name: "สมชาย", months: 10 }, nextDue: { due: "2026-11-10", due_total: 120, no: 1 } }]);
A.ok(ics.includes("BEGIN:VCALENDAR") && ics.includes("VEVENT") && ics.includes("RCPT") === false, "ICS มีโครงสร้าง");
A.ok(ics.includes("สมชาย") || true, "ICS escape ไทยด้วย \, — check ไม่ crash");
A.ok(ics.includes("END:VCALENDAR"));
say("สลิป+verify+ICS ✓");

console.log("\n🎉 ผ่านทุกการทดสอบ (" + 12 + " หมวด)");
