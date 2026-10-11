/* ui-payday.js — คาน์เตอร์รับผ่อน: จอเดียวจบ ไม่ต้องเปิดเข้าทีละสัญญา */
import { h, toast, fmtBaht, genId, inputBox, modal, curYM } from "./util.js";
import { saveDoc } from "./db.js";
import { loanState, round2, daysBetween } from "./calc.js";
import { attachReceipt, slipHTML, downloadICS } from "./receipt.js";

export async function renderPayday(ctx) {
  const { st, root } = ctx;
  const today = new Date().toISOString().slice(0, 10);
  const acts = st.loans.filter((l) => l.status === "active")
    .map((l) => ({ l, s: loanState(st, l, today) }))
    .filter((x) => x.s.balance > 0.004);
  const rank = (x) => x.s.overdueMonths ? 0 : (x.s.nextDue && x.s.nextDue.due <= addD(today, 3) ? 1 : 2);
  const addD = (dstr, k) => { const t = new Date(dstr); t.setDate(t.getDate() + k); return t.toISOString().slice(0, 10); };
  acts.sort((a, b) => rank(a) - rank(b) || (a.s.nextDue ? a.s.nextDue.due < b.s.nextDue.due ? -1 : 1 : 0));

  const dueNow = acts.filter((x) => rank(x) === 1).length;
  const over = acts.filter((x) => rank(x) === 0).length;
  root.append(h("div", { class: "hero" },
    h("div", { class: "small", style: "opacity:.85" }, "🧮 คาน์เตอร์รับผ่อนวันนี้"),
    h("div", { class: "amount" }, acts.length + " สัญญา"),
    h("div", { class: "chiprow" },
      over ? h("span", { class: "chip" }, "🔕 ค้าง " + over) : h("span", { class: "chip" }, "✅ ไม่มีการค้าง"),
      dueNow ? h("span", { class: "chip" }, "⏰ กำหนดใน 3 วัน: " + dueNow) : null,
      h("span", { class: "chip" }, "เป้า: รับผ่อน 10 คน ไม่เกิน 2 นาที"))));

  const list = h("div", { class: "list" });
  if (!acts.length) list.append(h("div", { class: "empty" }, h("span", { class: "ic" }, "🌾"), "ไม่มีสัญญากำลังผ่อน — สบายใจได้"));
  for (const { l, s } of acts) {
    const dueAmt = s.nextDue ? round2(s.nextDue.due_total) : round2(l.principal / l.months + l.principal * (l.feePct ?? 2) / 100);
    const flag = s.overdueMonths ? { ic: "🔴", cl: "var(--red)", txt: "ค้าง " + s.overdueMonths + " งวด" }
      : (s.nextDue && s.nextDue.due <= addD(today, 3) ? { ic: "⏰", cl: "var(--gold)", txt: "ถึงกำหนด " + s.nextDue.due.slice(8) + "/" + s.nextDue.due.slice(5, 7) } : { ic: "⚪", cl: "var(--line)", txt: "งวดหน้า " + (s.nextDue ? s.nextDue.due : "-") });
    const el = h("div", { class: "item", style: "border:2px solid " + flag.cl, cursor: "pointer" },
      h("span", { class: "avatar" }, flag.ic),
      h("span", { class: "grow" },
        h("span", { class: "name" }, l.name),
        h("span", { class: "meta" }, `${l.id} · ${flag.txt} · คงเหลือ ${fmtBaht(s.balance)}฿${s.carry ? ` · เครดิต ${fmtBaht(s.carry)}฿` : ""}`)),
      h("button", { class: "btn btn-sm btn-green", style: "min-width:86px", onclick: (e) => { e.stopPropagation(); pay(l, s, dueAmt); } }, "✓ " + fmtBaht(dueAmt) + "฿"),
      h("button", { class: "btn btn-sm btn-ghost", style: "margin-left:6px", title: "ยอด khác/ชำระปิดยอด", onclick: (e) => { e.stopPropagation(); payAsk(l, s); } }, "✎"));
    el.onclick = () => ctx.nav("loan", l.id);
    list.append(el);
  }
  root.append(list);
  root.append(h("div", { class: "btn-row", style: "margin-top:12px" },
    h("button", { class: "btn btn-outline", onclick: () => downloadICS(st) }, "📆 ปฏิทินงวดผ่อน (.ics)"),
    h("button", { class: "btn btn-ghost", onclick: () => ctx.nav("loans") }, "📄 ทุกสัญญา")) );
  if (ctx.canEdit) root.append(h("p", { class: "small muted", style: "margin-top:10px" }, "แตะ ✓ = รับยอดงวดพอดี (ครั้งเดียวจบ พร้อมออกเลขที่สลิป) · ✎ = รับยอดพิเศษ/ปิดยอดก่อนกำหนด · กดยังสัญญาเพื่อดูตารางผ่อนเต็ม ๆ"));

  async function pay(l, s, amount) { await post(l, amount, "รับผ่อนหน้าเคาน์เตอร์"); }
  async function payAsk(l, s) {
    const dueAmt = s.nextDue ? round2(s.nextDue.due_total) : 0;
    const v = await inputBox("✎ รับยอดพิเศษ — " + l.name, { label: "จำนวนเงิน (฿)", value: dueAmt ? String(dueAmt) : "", type: "number", hint: "ใส่ตามเงินสดที่ได้รับจริง ระบบตัดให้เอง: ค่าบำรุง→เงินต้น→งวดถัดไป" });
    if (v == null || !(Number(v) > 0)) return;
    await post(l, round2(Number(v)), "ยอดพิเศษ");
  }
  async function post(l, amount, note) {
    await ctx.edit(async () => {
      const tx = { id: genId("tx"), kind: "loan_repay", member: l.member, loanId: l.id, amount, at: today, ym: today.slice(0, 7), note };
      await attachReceipt(tx, st, ctx.user?.name);
      await saveDoc("txs", tx, ctx.user?.name, "create");
      // auto-close
      const db = await import("./db.js");
      const C = await import("./calc.js");
      const st2 = await C.loadState(db);
      const l2 = st2.loans.find((x) => x.id === l.id);
      const s2 = C.loanState(st2, l2, today);
      if (s2.balance <= 0.004 && s2.rows.every((r) => r.fee - r.feePaid < 0.005 && r.principal - r.princPaid < 0.005)) {
        await saveDoc("loans", { ...l2, id: l2.id, status: "closed", closedAt: today }, ctx.user?.name, "update");
      }
      l._lastAmount = amount;
    }, `✅ รับ ${fmtBaht(amount)}฿ จาก ${l.name} — แตะ ✓ เพื่อพิมพ์ออกได้ทันที`, );
    // เสนอพิมพ์สลิปทันทีเป็นใบๆ
    const db = await import("./db.js");
    const C = await import("./calc.js");
    const st2 = await C.loadState(db);
    const tx = st2.txs.filter((t) => t.kind === "loan_repay" && t.loanId === l.id).sort((a, b) => (a.updatedAt || "") < (b.updatedAt || "") ? -1 : 1).pop();
    if (tx && tx.receiptNo) {
      modal("🧾 ออกสลิปให้ " + l.name, h("p", { style: "font-family:monospace;font-size:1.05rem;background:var(--teal-l);border-radius:10px;padding:10px" },
        tx.receiptNo + "\nรหัสตรวจ: " + tx.vcode + "\nจำนวน " + fmtBaht(tx.amount) + " บาท"),
        [{ label: "เดี๋ยวค่อยพิมพ์" }, { label: "🖨️ พิมพ์สลิปให้สมาชิก", cls: "btn-primary", fn: () => import("./fileio.js").then((F) => F.printHTML("สลิป " + tx.receiptNo, slipHTML(tx, st2, { copyLabel: "ต้นขั้วกลุ่ม" }) + slipHTML(tx, st2, { copyLabel: "ให้สมาชิก" }))) }]);
    }
  }
}
