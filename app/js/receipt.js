/* receipt.js — หลักฐาน 2 ฝ่าย: เลขที่เอกสารรันต่อปี + รหัสตรวจสลิป (verify code) + Print + ICS */
import { h, fmtBaht, fmtDate, fmtYM, toast } from "./util.js";
import { getDoc, saveDoc, byType } from "./db.js";

const KIND_LABEL = {
  saja: "รับเงินสัจจะรายเดือน", sharebuy: "รับเงินซื้อหุ้น", annualsave: "รับเงินออมรายปี",
  fine: "ค่าปรับขาดส่ง", loan_repay: "รับชำระงวดเงินกู้", dividend_pay: "จ่ายเงินปันผล",
  welfare_out: "จ่ายเงินสวัสดิการ", other_in: "รายได้อื่น", other_out: "รายจ่ายอื่น", loan_out: "จ่ายเงินกู้",
};

/* ---------- group key (สร้างครั้งเดียว เก็บใน settings) ---------- */
export async function groupKey(actor) {
  const doc = await getDoc("settings", "groupkey");
  if (doc && doc.v) return doc.v;
  const buf = crypto.getRandomValues(new Uint8Array(16));
  const v = btoa(String.fromCharCode(...buf));
  await saveDoc("settings", { id: "groupkey", v }, actor || "system", "create");
  return v;
}
async function shaHex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
/** รหัส 12 hex จาก (key | id | member | amount | at) — คำนวณซ้ำได้ทุกอุปกรณ์ที่มีข้อมูล+key เดียวกัน */
export async function verifyCode(tx, key) {
  const raw = `${key}|${tx.id}|${tx.member || "-"}|${tx.amount}|${tx.at}`;
  const hex = (await shaHex(raw)).slice(0, 12).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}
/** แกะ code จากกระดาษ (ทนพิมพ์ผิดตัว O/0 กันเล็กน้อย) */
export function normCode(s) {
  return String(s || "").toUpperCase().replace(/[^0-9A-F]/g, "").replace(/O/g, "0").replace(/I/g, "1").replace(/L/g, "1").slice(0, 12);
}

/* ---------- เลขที่เอกสารรันต่อปี ---------- */
export async function nextReceiptNo(at, actor) {
  const year = Number(String(at).slice(0, 4)) + 543;
  const doc = await getDoc("settings", `rcpt-${year}`);
  const n = (doc && doc.v && doc.v.n) || 0;
  const nn = n + 1;
  await saveDoc("settings", { id: `rcpt-${year}`, v: { n: nn } }, actor || "system", "update");
  return `RCPT-${year}-${String(nn).padStart(4, "0")}`;
}
/** เรียกก่อน saveDoc("txs"...) → เติม receiptNo + verifyCode ให้ tx (ต้อง await ภายใน ctx.edit) */
export async function attachReceipt(tx, st, actor) {
  if (!tx.receiptNo) tx.receiptNo = await nextReceiptNo(tx.at || new Date().toISOString().slice(0, 10), actor);
  let key = (st.keys && st.keys.groupkey) || null;
  if (!key) key = await groupKey(actor);
  tx.vcode = await verifyCode(tx, key);
  return tx;
}

/* ---------- พิมพ์ใบเสร็จ (สำเนาให้สมาชิก + ต้นขั้วกลุ่ม) ---------- */
export function slipHTML(tx, st, opts = {}) {
  const g = st.group || {};
  const mem = tx.member ? (st.members.find((m) => m.id === tx.member) || { name: tx.memberName || tx.member }) : null;
  const rows = [
    ["รายการ", KIND_LABEL[tx.kind] || tx.kind],
    ["ชื่อสมาชิก", mem ? `${mem.name} (${mem.id})` : "—"],
    ["เลขที่เอกสาร", `<b style='font-size:15px'>${tx.receiptNo || "-"}</b>`],
    ["รหัสตรวจสอบ", `<b style='font-size:16px;letter-spacing:2px;font-family:monospace'>${tx.vcode || "-"}</b>`],
    ["จำนวนเงิน", `<b style='font-size:18px'>${fmtBaht(tx.amount)} บาท</b>`],
    ...(tx.kind === "loan_repay" ? [["สัญญากู้", tx.loanId || "-"], ["เหลือยอดกู้", fmtBaht(tx.loanBalanceAfter || st ? tx._bal || 0 : 0) + " (ดูตารางกู้)"]] : []),
    ...(tx.n ? [["จำนวนหุ้น", tx.n + " หุ้น"]] : []),
    ["วันที่", fmtDate(tx.at) + (opts.copyLabel ? ` (${opts.copyLabel})` : "")],
    ...(tx.note ? [["หมายเหตุ", tx.note]] : []),
  ];
  return `<div style="width:100mm;border:1.5px dashed #567;padding:8px 10px;font-size:12px;page-break-after:always">${
    `<div style="text-align:center"><b style='font-size:13.5px'>${g.name || "กลุ่มออมทรัพย์"}</b><br><span style="color:#555">${g.village || ""} · เอกสารรับ-จ่ายเงิน</span></div>` +
    `<table style="width:100%;margin-top:6px">${rows.map(([a, b]) => `<tr><td style="border:none;padding:1px 2px;color:#444">${a}</td><td style="border:none;text-align:right">${b}</td></tr>`).join("")}</table>` +
    `<div style="margin-top:8px;border-top:1px solid #999;padding-top:4px;color:#444">กรุณาเก็บไว้เป็นหลักฐาน — <b>แจ้งเหรัญญิกทันที</b>ถ้าไม่มีเอกสารนี้ หรือตรวจแล้วสถานะเป็น"ถูกยกเลิก/แก้ไข"<br>ผู้รับเงิน: ____________ &nbsp; ผู้จ่ายเงิน: ____________</div>`}</div>`;
}
export function printSlip(tx, st) {
  import("./fileio.js").then((F) => F.printHTML("ใบเสร็จ " + (tx.receiptNo || ""), `
    <div style="display:flex;gap:6mm;justify-content:center;flex-wrap:wrap">
      ${slipHTML(tx, st, { copyLabel: "ต้นขั้วกลุ่ม" })}
      ${slipHTML(tx, st, { copyLabel: "ให้สมาชิก" })}
    </div>`));
}

/* ---------- ตรวจสลิป ---------- */
export async function findSlip(input) {
  const q = String(input || "").trim().toUpperCase();
  if (!q) return null;
  const all = await byType("txs"); // รวม tombstone เพื่อจับเคสถูกยกเลิก
  const code = normCode(q);
  let tx = null;
  if (/^RCPT/.test(q)) tx = all.find((t) => (t.receiptNo || "").toUpperCase() === q);
  if (!tx && code.length === 12) tx = all.find((t) => normCode(t.vcode || "") === code);
  // กันปลอม: ตรวจรหัส crypto อีกครั้ง
  if (tx) {
    const kdoc = await getDoc("settings", "groupkey");
    if (kdoc && kdoc.v && tx.vcode) {
      const expect = await verifyCode(tx, kdoc.v);
      tx._codeValid = normCode(expect) === normCode(tx.vcode);
    } else tx._codeValid = null;
    tx._voided = !!tx.deletedAt;
  }
  return tx || null;
}

/* ---------- ปฏิทิน .ics ---------- */
export function buildICS(st, alerts) {
  const esc = (s) => String(s).replace(/[,;\\]/g, "\\$&");
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//sajja//payday//TH", "CALSCALE:GREGORIAN"];
  alerts.forEach((a, i) => {
    const due = a.nextDue && a.nextDue.due;
    if (!due) return;
    const dt = due.replace(/-/g, "") + "T000000";
    const r3 = new Date(new Date(due).getTime() - 3 * 86400000);
    const start = r3.toISOString().slice(0, 10).replace(/-/g, "") + "T000000";
    lines.push("BEGIN:VEVENT",
      `UID:sajja-${i}-${a.loan.id}@sajja.app`,
      `DTSTAMP:${now}`,
      `DTSTART:${start}`,
      `DTEND:${dt.replace("T000000", "T235959")}`,
      `SUMMARY:${esc("ผ่อนเงินกู้ " + a.loan.name + " " + Math.round(a.nextDue.due_total) + "฿ (" + a.loan.id + ")")}`,
      `DESCRIPTION:${esc("ครบกำหนด " + due + " — งวดที่ " + a.nextDue.no + "/" + a.loan.months + " นำสลิปผ่อนมาแสดงด้วย")}`,
      "BEGIN:VALARM", "TRIGGER:-PT0H", "ACTION:DISPLAY", `DESCRIPTION:${esc("ครบกำหนดผ่อนวันนี้")}`, "END:VALARM",
      "END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
export function downloadICS(st) {
  import("./calc.js").then(async (C) => {
    const today = new Date().toISOString().slice(0, 10);
    const soon = C.loanAlerts(st, today).filter((a) => a.nextDue && a.nextDue.due >= today);
    if (!soon.length) return toast("ยังไม่มีการผ่อนที่ถึงกำหนดข้างหน้า 😊");
    const { downloadText } = await import("./util.js");
    downloadText("sajja-paydays.ics", C ? buildICS(st, soon) : "", "text/calendar");
    toast("📆 ได้ไฟล์แล้ว — เปิดเพื่อเพิ่มเข้า Google Calendar ทันที");
  });
}
