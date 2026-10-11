/* ui-dividend.js — ปันผล 31 ธ.ค.: (กำไรสุทธิ × 50%) ÷ หุ้นทั้งหมด × หุ้นสมาชิก */
import { h, toast, fmtBaht, inputBox, confirmBox, curYM, genId } from "./util.js";
import { saveDoc } from "./db.js";
import { dividendCalc, round2, feeIncomeByYear, defaultNetProfit } from "./calc.js";
import { tbl } from "./ui-members.js";
import { reportButtons } from "./fileio.js";

export async function renderDividend(ctx) {
  const { st, root } = ctx;
  const curYear = Number(new Date().getFullYear());
  const sel = { year: curYear - (curYM() !== "12" && new Date().getMonth() < 11 ? 1 : 0) }; // ค่าเริ่มต้น: ปีก่อนถ้ายังไม่สิ้นปี
  const yearBox = h("div", { class: "card header-row", style: "display:flex;align-items:center;justify-content:space-between" },
    h("button", { class: "btn btn-sm btn-ghost", onclick: () => { sel.year--; paint(); } }, "◀ " + (sel.year - 1 + 543)),
    h("b", {}, "🎁 ปันผลรอบสิ้นปี " + (sel.year + 543)),
    h("button", { class: "btn btn-sm btn-ghost", onclick: () => { sel.year++; paint(); } }, (sel.year + 1 + 543) + " ▶"));
  const body = h("div", { class: "stack" });
  root.append(yearBox, body);
  paint();

  async function paint() {
    body.innerHTML = "";
    const d = dividendCalc(st, sel.year);
    const profitInput = h("input", { type: "number", value: String(d.profit), style: "min-height:52px;border:2px solid var(--line);border-radius:12px;padding:8px 12px;font-size:1.2rem;font-weight:800;width:100%" });
    const note = h("p", { class: "small muted" }, "ค่าเริ่มต้นคำนวณจาก: ค่าบำรุงรับ (" + fmtBu(feeIncomeByYear(st)[sel.year] || 0) + "฿) + รายได้อื่น − ค่าใช้จ่ายดำเนินงาน — แก้ตัวเลขได้ตามมติที่ประชุมใหญ่");
    function fmtBu(x) { return round2(x).toLocaleString("th-TH"); }

    const calcBox = h("div", { class: "stack" });
    function recalc() {
      const dd = dividendCalc(st, sel.year, profitInput.value);
      calcBox.innerHTML = "";
      calcBox.append(
        h("div", { class: "stat-grid" },
          h("div", { class: "stat" }, h("div", { class: "num" }, fmtBaht(dd.profit) + "฿"), h("div", { class: "lbl" }, "กำไรสุทธิ (ยืนยันแล้ว)")),
          h("div", { class: "stat" }, h("div", { class: "num" }, fmtBaht(dd.pool) + "฿"), h("div", { class: "lbl" }, "จัดสรรปันผล " + st.cfg.dividendPctOfProfit + "%")),
          h("div", { class: "stat" }, h("div", { class: "num" }, dd.allShares), h("div", { class: "lbl" }, "หุ้นทั้งกลุ่ม ณ สิ้นปี")),
          h("div", { class: "stat" }, h("div", { class: "num" }, dd.perShare.toFixed(4)), h("div", { class: "lbl" }, "ต่อหุ้น (บาท)")),
        ),
        h("div", { class: "note" }, "🧮 สูตร: (" + fmtBu(dd.profit) + " × " + st.cfg.dividendPctOfProfit + "%) ÷ " + dd.allShares + " หุ้น × หุ้นของสมาชิกแต่ละคน · เศษปัดลงคงเหลือเข้าเงินกองทุน " + fmtBaht(dd.retain) + "฿"),
        tbl([["รหัส", "ชื่อสมาชิก", "หุ้น", "ปันผลได้ (฿)"],
          ...dd.rows.filter((r) => r.shares > 0 || true).map((r) => [r.member, r.name, String(r.shares), fmtBaht(r.amount)]),
          ["", "รวม", String(d.allShares), fmtBaht(dd.sumRows)]]));
      if (ctx.canEdit) {
        const payBtn = h("button", { class: "btn btn-green", onclick: () => payAll(dd) }, "💵 บันทึกจ่ายปันผลครบทุกตามตาราง (สร้างรายการเงินสดออก)");
        calcBox.append(payBtn);
      }
      const ex = reportButtons("ปันผล-" + (sel.year + 543), () => ({
        title: "ประกาศเงินปันผล ปี " + (sel.year + 543) + " — " + st.group.name,
        subtitle: "กำไรสุทธิ " + fmtBaht(dd.profit) + " × " + st.cfg.dividendPctOfProfit + "% ÷ " + dd.allShares + " หุ้น = " + dd.perShare.toFixed(4) + " ฿/หุ้น",
        headerCount: 1,
        rows: [["รหัส", "ชื่อสมาชิก", "หุ้น", "เงินปันผล (บาท)"], ...dd.rows.map((r) => [r.member, r.name, r.shares, r.amount.toFixed(2)])],
      }));
      calcBox.append(ex);
    }
    body.append(
      h("div", { class: "card" }, h("h3", {}, "1️⃣ กำไรสุทธิปี " + (sel.year + 543)), profitInput, note),
      h("button", { class: "btn btn-primary", onclick: recalc }, "🧮 คำนวณเงินปันผล"),
      calcBox);
    if (sel.year === curYear && new Date().getMonth() < 11)
      body.append(h("div", { class: "note" }, "ℹ️ ยังไม่สิ้นปี — ตัวเลขเป็นค่าคาดการณ์; ปิดบัญชีจริง 31 ธ.ค. แล้วตรวจสอบอีกครั้ง"));
    profitInput.oninput = () => {};
  }

  async function payAll(dd) {
    const yes = await confirmBox(`ยืนยันจ่ายเงินปันผล ${dd.rows.filter((r) => r.amount > 0).length} คน รวม ${fmtBaht(dd.sumRows)} ฿?\n(สร้าง “รายการจ่าย” ในบัญชีกลุ่ม — ถ้าจ่ายจริงไม่เท่านี้ให้ void แล้วแก้)`, { okLabel: "💵 บันทึกจ่าย" });
    if (!yes) return;
    await ctx.edit(async () => {
      for (const r of dd.rows.filter((x) => x.amount > 0))
        await saveDoc("txs", { id: genId("tx"), kind: "dividend_pay", member: r.member, amount: r.amount, year: sel.year, at: new Date().toISOString().slice(0, 10), ym: curYM(), note: "ปันผลปี " + (sel.year + 543) }, ctx.user?.name, "create");
    }, "💵 บันทึกจ่ายปันผลแล้ว");
  }
}
