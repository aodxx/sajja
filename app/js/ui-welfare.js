/* ui-welfare.js — กองทุนสวัสดิการ: ฌาปนกิจ / ค่าเสียโอกาสเจ็บป่วย / ทุนการศึกษา / รับชำระค่าปรับ */
import { h, toast, fmtBaht, fmtDate, curYM, genId, inputBox, confirmBox, modal } from "./util.js";
import { saveDoc, byType } from "./db.js";
import { welfareFund, sickNightsThisYear, round2 } from "./calc.js";
import { tbl } from "./ui-members.js";
import { attachReceipt } from "./receipt.js";

const OUT_TYPES = [
  ["cremation", "🕯️ ฌาปนกิจ/ช่วยเหลืองานศพ"],
  ["sick", "🛏️ ค่าเสียโอกาสเจ็บป่วย (เป็นคืน)"],
  ["scholarship", "🎓 ทุนการศึกษาบุตร"],
  ["disaster", "🌊 ช่วยเหลือภัยพิบัติ"],
  ["other", "📦 อื่น ๆ"],
];
const IN_TYPES = [["donation", "🙏 เงินบริจาค"], ["gov", "🏛️ งบสนับสนุนราชการ"], ["fine", "⚖️ รับชำระค่าปรับ"], ["other", "📥 อื่น ๆ"]];

export async function renderWelfare(ctx) {
  const { st, root } = ctx;
  const year = Number(curYM().slice(0, 4));
  const today = new Date().toISOString().slice(0, 10);
  const w = welfareFund(st);
  const finesUnpaid = st.txs.filter((t) => t.kind === "fine" && !t.received);

  root.append(h("div", { class: "hero" },
    h("div", { class: "small", style: "opacity:.85" }, "🧰 กองทุนสวัสดิการ"),
    h("div", { class: "amount" }, fmtBaht(w.balance) + " ฿"),
    h("div", { class: "chiprow" },
      h("span", { class: "chip" }, "รับเข้า " + fmtBaht(w.in) + "฿"),
      h("span", { class: "chip" }, "จ่ายออก " + fmtBaht(w.out) + "฿"),
      finesUnpaid.length ? h("span", { class: "chip" }, "⚖️ ใบปรับรอเก็บ " + finesUnpaid.length + " ใบ") : null)));

  if (finesUnpaid.length) {
    root.append(h("button", { class: "btn btn-gold", onclick: collectFinesPaid }, "⚖️ รับชำระค่าปรับค้าง — ทั้งหมด " + finesUnpaid.length + " ใบ"));
  }
  const inBtn = h("button", { class: "btn btn-green", onclick: () => addIn() }, "📥 บันทึกรับเงินเข้ากองทุน");
  const outTiles = h("div", { class: "tiles" });
  OUT_TYPES.forEach(([k, label]) => outTiles.append(h("button", { class: "tile", onclick: () => addOut(k) }, h("span", { class: "ic" }, label.slice(0, 2)), h("span", {}, label.slice(3)))));
  root.append(h("div", { class: "section-title" }, "✍️ บันทึก"), inBtn, outTiles);

  // รายการเดินบัญชีปีนี้
  const rows = [["วันที่", "ประเภท", "เรื่อง", "รับ", "จ่าย", "คงเหลือสะสม"]];
  let run = 0;
  txList(st).filter((t) => Number(t.at.slice(0, 4)) <= year).forEach((t) => {
    const dir = (t.kind === "welfare_in" || (t.kind === "fine" && t.received)) ? (t.received ? t.amount : 0) : (t.kind === "fine" ? 0 : -t.amount);
    run = round2(run + dir);
    if (Number(t.at.slice(0, 4)) === year)
      rows.push([fmtDate(t.at), t.kind === "fine" ? "⚖️ " + (t.received ? "ค่าปรับ(รับแล้ว)" : "ค่าปรับ(ใบแจ้ง)") : iconCat(t.cat) + " " + (OUT_TYPES.find((x) => x[0] === t.cat)?.[1] || "รับเข้า"),
        `${t.memberName || t.member || ""} ${t.title || t.note || ""}`.trim(),
        dir > 0 ? fmtBaht(dir) : "-", dir < 0 ? fmtBaht(-dir) : "-", fmtBaht(run)]);
  });
  root.append(h("div", { class: "section-title" }, "📒 walking งบกองทุน (ปี " + year + " +543 )"), tbl(rows));
  root.append(h("div", { class: "note" }, `กติกา: ค่าเสียโอกาสเจ็บป่วย ${fmtBaht(st.cfg.sickNightPay)} ฿/คืน ไม่เกิน ${st.cfg.sickMaxNightsYear} คืน/คน/ปี · รายรับกองทุน (รวมค่าปรับ) แยกจากกองทุนกลุ่ม ไม่เอามาคิดปันผล`));

  async function collectFinesPaid() {
    const yes = await confirmBox(`ยืนยันรับชำระค่าปรับทั้ง ${finesUnpaid.length} ใบ รวม ${fmtBaht(finesUnpaid.reduce((s, t) => s + t.amount, 0))} ฿\n(ระบบทำเครื่องหมาย “รับแล้ว” และบันทึกเงินสดเข้ากองทุนพร้อม audit)`, { okLabel: "💵 รับเงินครบแล้ว" });
    if (!yes) return;
    await ctx.edit(async () => {
      for (const t of finesUnpaid)
        await saveDoc("txs", { ...t, id: t.id, received: true, paidAt: today, note: (t.note || "") + " · รับแล้ว " + fmtDate(today) }, ctx.user?.name, "update");
    }, "💵 รับชำระค่าปรับเข้ากองทุนแล้ว");
  }
  async function addIn() {
    const type = await pick(IN_TYPES.map(x => x[1]) , "📥 รับเงินเข้าชนิดไหน"); if (!type) return;
    const amt = await inputBox("จำนวนเงิน (฿)"); if (!amt || !(Number(amt) > 0)) return;
    const title = await inputBox("หมายเหตุ", { value: "" });
    await ctx.edit(() => saveDoc("txs", { id: genId("tx"), kind: "welfare_in", cat: IN_TYPES.find((x) => x[1] === type)[0], amount: round2(Number(amt)), at: today, ym: curYM(), title: title || type, member: "" }, ctx.user?.name, "create"), "📥 บันทึกแล้ว");
  }
  async function addOut(key) {
    const members = (await byType("members")).filter((m) => !m.deletedAt);
    const mem = await pick(members.map((m) => m.name + " (" + m.id + ")"), "ใครเป็นผู้รับ /เกี่ยวข้องกับเคสนี้"); if (!mem) return;
    const m = members.find((x) => x.name + " (" + x.id + ")" === mem);
    if (key === "sick") return sickPay(m);
    if (key === "cremation") return simpleCase(m, "🕯️ ฌาปนกิจ", "จำนวนเงินช่วยงานศพ (฿)");
    if (key === "scholarship") return simpleCase(m, "🎓 ทุนการศึกษา", "จำนวนทุน (฿)");
    if (key === "disaster") return simpleCase(m, "🌊 ภัยพิบัติ", "จำนวนช่วย (฿)");
    return simpleCase(m, "📦 อื่น ๆ", "จำนวนเงิน (฿)");
  }
  async function simpleCase(m, label, askAmt) {
    const amt = await inputBox(askAmt); if (!amt || !(Number(amt) > 0)) return;
    const note = await inputBox("รายละเอียดกรณี (ใส่เหตุผลไว้เป็นหลักฐาน)", { value: "" });
    await ctx.edit(async () => { const t = { id: genId("tx"), kind: "welfare_out", cat: label.slice(2), member: m.id, memberName: m.name, amount: round2(Number(amt)), at: today, ym: curYM(), title: label, note: note || "" }; await attachReceipt(t, st, ctx.user?.name); await saveDoc("txs", t, ctx.user?.name, "create"); }, `✅ จ่าย ${label} ${fmtBaht(amt)} ฿ ให้ ${m.name}`);
  }
  async function sickPay(m) {
    const doneThisYear = sickNightsThisYear(st, m.id, year);
    const left = Math.max(0, st.cfg.sickMaxNightsYear - doneThisYear);
    const nightsV = await inputBox("🛏️ ค่าเสียโอกาส — " + m.name, { label: `จำนวนคืน (ปีใช้แล้ว ${doneThisYear}/${st.cfg.sickMaxNightsYear} คืน เหลือ ${left})`, value: "1", type: "number" });
    if (nightsV == null) return;
    let n = Math.trunc(Number(nightsV)) || 0; if (n <= 0) return;
    if (n > left) {
      const yes = await confirmBox(`เกินสิทธิ์ปีนี้อีก ${n - left} คืน (เหลือ ${left}) ระบบจะบันทึก ${n} คืนเป็น“พิเศษ” ให้ประธานลงนาม — ตกลง?`, { okLabel: "บันทึกแบบพิเศษ" });
      if (!yes) return;
    }
    const amt = round2(Math.min(n, left) * st.cfg.sickNightPay) + (n > left ? round2((n - left) * st.cfg.sickNightPay) : 0);
    const note = await inputBox("เหตุผล/สถานที่รักษา (หลักฐาน)", { value: "" });
    await ctx.edit(async () => { const t = {
      id: genId("tx"), kind: "welfare_out", cat: "sick", member: m.id, memberName: m.name,
      nights: n, amount: amt, overQuota: n > left, at: today, ym: curYM(), title: "🛏️ ค่าเสียโอกาสเจ็บป่วย", note: note || "" };
      await attachReceipt(t, st, ctx.user?.name);
      await saveDoc("txs", t, ctx.user?.name, "create"); },
      `✅ จ่าย ${fmtBaht(amt)} ฿ (${n} คืน × ${st.cfg.sickNightPay}฿)`);
  }
}
function iconCat(cat) { return OUT_TYPES.find((x) => x[0] === cat)?.[0]?.slice(0, 2) || cat?.slice(0, 2) || "📥"; }
const txList = (st) => st.txs.filter((t) => (t.kind === "welfare_in" || t.kind === "welfare_out" || t.kind === "fine") && !t.deletedAt)
  .slice().sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? -1 : 1));
function pick(options, title) {
  return new Promise((res) => {
    const list = h("div", { class: "list", style: "max-height:56vh;overflow:auto" });
    options.forEach((o) => list.append(h("button", { class: "item", onclick: () => { res(o); } }, h("span", { class: "grow" }, h("span", { class: "name" }, o)))));
    modal(title, list, [{ label: "ยกเลิก", fn: () => res(null) }]);
  });
}
