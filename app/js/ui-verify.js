/* ui-verify.js — ตรวจสลิป: ผู้ตรวจสอบ/กรรมการคนไหนก็ยืนยันได้ว่า "สลิปจริง หรือ ปลอม/ถูกแก้" */
import { h, toast, fmtBaht, fmtDate, $ } from "./util.js";
import { findSlip } from "./receipt.js";

export async function renderVerify(ctx) {
  const { root, st } = ctx;
  const inp = h("input", { placeholder: "เช่น RCPT-2569-0012 หรือ 1A2B-3C4D-5E6F", style: "min-height:56px;font-size:1.15rem;font-family:monospace;text-align:center;border:2px solid var(--line);border-radius:12px;width:100%", autocapitalize: "characters" });
  const btn = h("button", { class: "btn btn-primary", style: "margin-top:10px" }, "🔎 ตรวจสลิป");
  const res = h("div", { class: "stack" });
  btn.onclick = go;
  inp.onkeydown = (e) => { if (e.key === "Enter") go(); };
  async function go() {
    res.innerHTML = "<div class='card muted small'>กำลังตรวจกับข้อมูลบัญชี…</div>";
    const tx = await findSlip(inp.value);
    res.innerHTML = "";
    if (!tx) {
      res.append(h("div", { class: "card", style: "border:2px solid var(--red);text-align:center" },
        h("div", { style: "font-size:2.4rem" }, "❌ ไม่พบสลิปนี้"),
        h("p", { class: "small muted" }, "ไม่พบเลขที่/รหัสนี้ในบัญชีกลุ่ม — อาจเป็นสลิปที่ถูกยกเลิก/แก้ไขไปแล้ว, พิมพ์ตกหล่น, หรือสลิปก่อนช่วงข้อมูลที่เครื่องนี้เก็บไว้ — ลองเปลี่ยนเป็นกรอกเลขที่เอกสาร (RCPT-...) แทนเพื่อดูประวัติ แล้วเทียบกับสมุด/สอบถามเหรัญญิก"))); 
      return;
    }
    const mem = st.members.find((m) => m.id === tx.member);
    const okBadge = tx._voided ? h("span", { class: "badge b-red", style: "font-size:1rem" }, "🗑️ รายการนี้ถูกลบ/แก้ไขไปแล้ว")
      : tx._codeValid === false ? h("span", { class: "badge b-gold", style: "font-size:1rem" }, "⚠️ สลิปนี้ไม่ตรงกับบัญชีปัจจุบัน (ยอดถูกแก้แล้ว)")
        : h("span", { class: "badge b-green", style: "font-size:1rem" }, "✅ สลิปถูกต้องตรงกับบัญชี");
    res.append(h("div", { class: "card" },
      h("div", { style: "text-align:center;margin-bottom:8px" }, okBadge),
      tblRows([
        ["เลขที่เอกสาร", tx.receiptNo || "—"],
        ["รหัสตรวจสอบ", tx.vcode || "—"],
        ["รายการ", kindTh(tx.kind) + (tx.loanId ? " · สัญญา " + tx.loanId : "") + (tx.n ? " · " + tx.n + " หุ้น" : "")],
        ["สมาชิก", mem ? mem.name + " (" + mem.id + ")" : tx.member || "—"],
        ["จำนวนเงิน", h("b", {}, fmtBaht(tx.amount) + " ฿").textContent],
        ["วันที่", fmtDate(tx.at)],
        ["ผู้บันทึก", (tx.createdBy || tx.deletedBy || "—") + (tx._voided ? " · ลบโดย " + (tx.deletedBy || "?") + " " + fmtDate(tx.deletedAt) + " — เหตุผล: " + (tx.deleteReason || "-") : "")],
        ...(tx.note ? [["หมายเหตุ", tx.note]] : []),
      ]),
      tx._voided || tx._codeValid === false ? h("p", { class: "note", style: "margin-top:10px" }, "แนวปฏิบัติ: เรียกสมาชิกผู้ถือสลิป + เหรัญญิก มาเทียบต้นขั้ว/สมุดคู่ฝากก่อนสรุป — ดูรายละเอียดการแก้ไขที่หน้า 'ประวัติการแก้ไข' ด้วยรหัสเอกสารนี้") : null));
  }
  root.append(
    h("div", { class: "card" }, h("h3", {}, "🧾 ตรวจสลิปเงินสด"),
      h("p", { class: "small muted" }, "พิมพ์หรือลอกเลข/รหัสบน สลิป ของสมาชิก แล้วกรอกด้านล่าง"),
      inp, btn), res,
    h("p", { class: "small muted", style: "margin-top:12px" }, "หมายเหตุ: เครื่องผู้ตรวจสอบต้องมีข้อมูลถึงวันที่ออกสลิป (import ไฟล์สำรองล่าสุดแล้ว) จึงจะพบสลิปของกลุ่ม"));
}
function tblRows(rows) {
  const t = h("table", { class: "tbl", style: "min-width:0" });
  const body = h("tbody");
  rows.forEach(([a, b]) => body.append(h("tr", {}, h("td", { style: "color:var(--muted);width:38%" }, a), h("td", {}, String(b ?? "")))));
  t.append(body);
  const w = h("div", { class: "tbl-wrap" }); w.append(t); return w;
}
const kindTh = (k) => ({ saja: "รับเงินสัจจะ", sharebuy: "รับซื้อหุ้น", annualsave: "รับออมรายปี", loan_repay: "รับชำระงวดกู้", fine: "ค่าปรับ", dividend_pay: "จ่ายปันผล", welfare_out: "จ่ายสวัสดิการ", other_in: "รายได้อื่น", other_out: "รายจ่ายอื่น", loan_out: "จ่ายเงินกู้" }[k] || k);
