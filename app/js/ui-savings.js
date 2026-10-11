/* ui-savings.js — หน้า "รับเงิน" หัวใจของงานประจำเดือน: สัจจะ / หุ้น / ออมรายปี + ค่าปรับ */
import { h, toast, fmtBaht, fmtYM, ymAdd, curYM, genId, modal, confirmBox, inputBox } from "./util.js";
import { saveDoc, byType } from "./db.js";
import { sajaStatus, memberTotals, finesPending, sumSaja, round2 } from "./calc.js";

const TABS = [["saja", "💵 สัจจะ"], ["share", "🧾 หุ้น"], ["annual", "🐷 ออมปี"]];

export async function renderSavings(ctx) {
  const { st, root } = ctx;
  const today = new Date().toISOString().slice(0, 10);
  const cur = { tab: "saja", ym: curYM() };
  const tabsBox = h("div", { class: "seg" });
  const body = h("div", { class: "stack" });
  const members = (await byType("members")).filter((m) => !m.deletedAt && m.status !== "resigned");
  const today2 = () => (cur.ym === curYM() ? today : cur.ym + "-25");

  function paintTabs() {
    tabsBox.innerHTML = "";
    for (const [t, label] of TABS)
      tabsBox.append(h("button", { class: t === cur.tab ? "on" : "", onclick: () => { cur.tab = t; paintTabs(); paint(); } }, label));
  }
  async function paint() {
    body.innerHTML = "";
    if (cur.tab === "saja") await paintSaja();
    else if (cur.tab === "share") await paintShare();
    else await paintAnnual();
    root.append(body); // body ต่อท้าย หลัง header ของแต่ละโหมด
  }

  /* ================= สัจจะรายเดือน ================= */
  async function paintSaja() {
    const ym = cur.ym;
    let sum = 0, paid = 0;
    const list = h("div", { class: "list" });
    for (const m of members) {
      const s = sajaStatus(m, ym, st, today);
      if (s === "none") continue;
      if (s === "sent") { paid++; sum += sumSaja(st, m.id, ym); }
      const amt = Number(m.monthly) || st.cfg.sajaMonthly || 50;
      const cls = s === "sent" ? "ok" : s === "late" ? "late" : "due";
      list.append(h("button", {
        class: "item",
        style: "border:2px solid " + (cls === "ok" ? "var(--green)" : cls === "late" ? "var(--red)" : "var(--line)"),
        onclick: () => (cls === "ok" ? showMonth(m) : recordSaja(m, amt)),
      },
        h("span", { class: "avatar", style: "background:" + (cls === "ok" ? "var(--green-l)" : cls === "late" ? "var(--red-l)" : "var(--teal-l)") },
          cls === "ok" ? "✓" : (cls === "late" ? "!" : m.name.slice(0, 1))),
        h("span", { class: "grow" },
          h("span", { class: "name" }, m.name),
          h("span", { class: "meta" }, m.id + " · ต้องส่ง " + fmtBaht(amt) + "฿" + (cls === "late" ? " · 🔴ค้าง" : ""))),
        h("span", { class: "right" },
          cls === "ok" ? [document.createTextNode(fmtBaht(sumSaja(st, m.id, ym)) + "฿"), h("span", { class: "lbl" }, "✅ ส่งแล้ว")]
            : cls === "late" ? h("span", { class: "badge b-red" }, "บันทึกส่ง")
              : h("span", { class: "badge b-teal" }, "แตะเพื่อบันทึก"))));
    }
    const fineCount = members.map((m) => finesPending(st, m).length).reduce((a, b) => a + b, 0);
    const fineMembers = members.filter((m) => finesPending(st, m).length).length;

    body.prepend(
      h("div", { class: "card header-row", style: "display:flex;align-items:center;justify-content:space-between" },
        h("button", { class: "btn btn-sm btn-ghost", onclick: () => { cur.ym = ymAdd(cur.ym, -1); render(); } }, "◀ เดือนก่อน"),
        h("b", { style: "font-size:1.05rem" }, "🗓️ " + fmtYM(ym)),
        h("button", { class: "btn btn-sm btn-ghost", onclick: () => { cur.ym = ymAdd(cur.ym, 1); if (cur.ym > curYM()) toast("ย้อนดูอนาคตได้ แต่อย่าเพิ่งเก็บเงิน 😄", 2500); } }, "ถัดไป ▶")),
      h("div", { class: "stat-grid" },
        h("div", { class: "stat" }, h("div", { class: "num" }, paid + "/" + members.length), h("div", { class: "lbl" }, "ส่งแล้วเดือนนี้")),
        h("div", { class: "stat" }, h("div", { class: "num" }, fmtBaht(round2(sum)) + "฿"), h("div", { class: "lbl" }, "รวมรับเดือนนี้"))),
      h("button", { class: "btn btn-green", onclick: () => bulkCollect() }, "⚡ เก็บครบทุกคนยอดมาตรฐาน (เร็วมาก)"),
      ctx.canEdit && members.length ? h("button", { class: "btn btn-outline", onclick: () => ctx.nav("members") }, "➕ ยังไม่มีชื่อสมาชิก? เพิ่มที่นี่") : null,
      fineMembers ? h("div", { class: "note" },
        h("b", {}, `⚠️ ขาดส่ง ${fineMembers} คน (${fineCount} เดือน) ต้องเก็บค่าปรับคนละ ${st.cfg.lateFine}฿/ครั้ง`), h("br"),
        ctx.canEdit ? h("button", { class: "btn btn-gold btn-sm", style: "margin-top:8px", onclick: collectFines }, "🧾 ออกใบค่าปรับ → เข้ากองทุนสวัสดิการ") : null) : null);
    body.append(list);
    return;

    async function render() { body.innerHTML = ""; await paintSaja(); root.append(body); }

    async function recordSaja(m, amt) {
      const v = await inputBox("💵 รับเงินสัจจะ — " + m.name, {
        label: fmtYM(ym) + " ส่งกี่บาท?", value: String(amt), type: "number",
        hint: "แก้ได้ถ้าส่งไม่เท่ากติกา (ระบบจะบันทึกยอดจริง)",
      });
      if (v == null || v === "") return;
      const amount = round2(Number(v)); if (amount <= 0) return toast("ใส่จำนวนเงินก่อน", 2000, true);
      await ctx.edit(() => saveDoc("txs", {
        id: genId("tx"), kind: "saja", member: m.id, ym, amount, at: today2(), note: "" }, ctx.user?.name, "create"),
        `✅ ${m.name} ส่ง ${fmtBaht(amount)} ฿`);
    }
    function showMonth(m) {
      modal("🧾 " + m.name + " — " + fmtYM(ym),
        h("p", {}, "ส่งแล้ว " + fmtBaht(sumSaja(st, m.id, ym)) + " บาท ✅"), [
        { label: "ปิด" },
        ...(ctx.canEdit ? [{ label: "🗑️ ลบ (บันทึกผิด)", cls: "btn-red", fn: () => undoSaja(m) }] : []),
      ]);
    }
    async function undoSaja(m) {
      const reason = await inputBox("ลบรายการส่งเงิน (Soft Delete)", { label: "เหตุผล *", hint: "เช่น ลงวันผิด / ยอดผิด — แล้วบันทึกใหม่" });
      if (reason == null) return;
      if (!reason.trim()) return toast("ต้องใส่เหตุผลด้วย", 2200, true);
      const ts = st.txs.filter((x) => x.kind === "saja" && x.member === m.id && x.ym === ym);
      if (!ts.length) return;
      await ctx.edit(async () => {
        for (const t of ts) await saveDoc("txs", { ...t, deletedAt: new Date().toISOString(), deleteReason: reason, deletedBy: ctx.user?.name }, ctx.user?.name, "delete");
      }, "🗑️ ลบแล้ว — ตรวจได้ใน “ประวัติการแก้ไข”");
    }
    async function bulkCollect() {
      const dueList = members.filter((m) => { const s = sajaStatus(m, ym, st, today); return s === "due" || s === "late"; });
      if (!dueList.length) return toast("ทุกคนส่งครบแล้ว 😊");
      const yes = await confirmBox(`บันทึกว่า “ส่งแล้ว” ครบ ${dueList.length} คน ที่ยังค้าง (ยอดมาตรฐานของแต่ละคน) แล้วไปนับเงินสดรวมทีหลัง?`, { okLabel: `✅ รับเงิน ${dueList.length} คน` });
      if (!yes) return;
      await ctx.edit(async () => {
        for (const m of dueList) {
          const amt = Number(m.monthly) || st.cfg.sajaMonthly || 50;
          await saveDoc("txs", { id: genId("tx"), kind: "saja", member: m.id, ym, amount: amt, at: today2(), note: "บันทึกรวมท้ายเดือน" }, ctx.user?.name, "create");
        }
      }, `✅ บันทึก ${dueList.length} คนแล้ว — ฝอยนับเงินจริงแล้วลองเทียบกับสมุด`);
    }
    async function collectFines() {
      const lines = [];
      for (const m of members) for (const y2 of finesPending(st, m)) lines.push({ m, ym: y2, amt: st.cfg.lateFine });
      if (!lines.length) return toast("ไม่มีค่าปรับค้าง", 2000);
      const yes = await confirmBox(`ออกใบค่าปรับ ${lines.length} รายการ × ${st.cfg.lateFine}฿ = ${fmtBaht(lines.length * st.cfg.lateFine)}฿\n(บันทึกเป็น “ต้องรับกองทุนสวัสดิการ” ยังไม่นับเงินสดจนกว่าจะรับจริง)`, { okLabel: "🧾 ออกใบปรับ" });
      if (!yes) return;
      await ctx.edit(async () => {
        for (const { m, ym: y2, amt } of lines)
          await saveDoc("txs", {
            id: genId("tx"), kind: "fine", member: m.id, fineYM: y2, amount: amt, at: today2(),
            received: false, note: "ค่าปรับขาดส่งเดือน " + fmtYM(y2),
          }, ctx.user?.name, "create");
      }, "🧾 ออกใบค่าปรับแล้ว — กด “รับชำระ” รายตัวในหน้า สวัสดิการ");
    }
  }

  /* ================= หุ้น ================= */
  async function paintShare() {
    const list = h("div", { class: "list" });
    for (const m of members) {
      const t = memberTotals(st, m);
      list.append(h("button", { class: "item", onclick: () => buyShare(m) },
        h("span", { class: "avatar" }, m.name.slice(0, 1)),
        h("span", { class: "grow" }, h("span", { class: "name" }, m.name),
          h("span", { class: "meta" }, m.id + " · ถือ " + t.sharesN + " หุ้น (" + fmtBaht(t.shares) + "฿)")),
        h("span", { class: "right badge b-teal" }, "➕ ซื้อเพิ่ม")));
    }
    body.append(h("div", { class: "note" }, `🧾 หุ้นละ ${fmtBaht(st.cfg.sharePrice)} ฿ — ซื้อได้เมื่อคณะกรรมการอนุมัติ (ยอดสะสมนับปันผลสิ้นปี)`, ), list);
  }
  async function buyShare(m) {
    const v = await inputBox("🧾 ซื้อหุ้น — " + m.name, { label: "จำนวนหุ้น *", value: "5", type: "number", hint: fmtBaht(st.cfg.sharePrice) + " ฿/หุ้น ระบบคำนวณเงินเอง" });
    if (v == null) return toast("ยกเลิกแล้ว");
    const n = Math.trunc(Number(v)); if (!n || n <= 0) return toast("ใส่จำนวนหุ้นก่อน", 2000, true);
    await ctx.edit(() => saveDoc("txs", {
      id: genId("tx"), kind: "sharebuy", member: m.id, n, amount: round2(n * st.cfg.sharePrice), at: today2(), ym: curYM(), note: "" }, ctx.user?.name, "create"),
      `✅ ${m.name} ซื้อ ${n} หุ้น = ${fmtBaht(n * st.cfg.sharePrice)} ฿`);
  }

  /* ================= ออมรายปี ================= */
  async function paintAnnual() {
    const year = Number(cur.ym.slice(0, 4));
    const rows = h("div", { class: "list" });
    for (const m of members) {
      const paid = st.txs.filter((t) => t.kind === "annualsave" && t.member === m.id && Number((t.at || "").slice(0, 4)) === year).reduce((s, t) => s + t.amount, 0);
      const done = paid >= st.cfg.annualTarget;
      rows.append(h("button", { class: "item", style: "border:2px solid " + (done ? "var(--green)" : "var(--line)"), onclick: () => payAnnual(m, year) },
        h("span", { class: "avatar", style: "background:" + (done ? "var(--green-l)" : "var(--teal-l)") }, done ? "✓" : m.name.slice(0, 1)),
        h("span", { class: "grow" }, h("span", { class: "name" }, m.name), h("span", { class: "meta" }, m.id)),
        h("span", { class: "right" }, fmtBaht(paid) + "/" + fmtBaht(st.cfg.annualTarget), h("span", { class: "lbl" }, "฿ ปี " + (year + 543)))));
    }
    body.append(h("div", { class: "note" }, "🐷 เงินออมรายปี " + fmtBaht(st.cfg.annualTarget) + " ฿/คน/ปี จะส่งทีเดียวหรือแบ่งส่งก็ได้ — ยอดสะสมคำนวณอัตโนมัติ"), rows);
  }
  async function payAnnual(m, year) {
    const paid = st.txs.filter((t) => t.kind === "annualsave" && t.member === m.id && Number((t.at || "").slice(0, 4)) === year).reduce((s, t) => s + t.amount, 0);
    const left = Math.max(0, st.cfg.annualTarget - paid);
    const v = await inputBox("🐷 ออมรายปี — " + m.name, { label: "ส่งเพิ่มกี่บาท?", value: String(left || st.cfg.annualTarget), type: "number", hint: "ปีนี้ส่งแล้ว " + fmtBaht(paid) + "/" + fmtBaht(st.cfg.annualTarget) + " ฿" });
    if (v == null || v === "") return;
    await ctx.edit(() => saveDoc("txs", { id: genId("tx"), kind: "annualsave", member: m.id, amount: round2(Number(v)), at: today2(), ym: curYM(), note: "" }, ctx.user?.name, "create"),
      `✅ ${m.name} +${fmtBaht(v)} ฿`);
  }

  /* mount */
  tabsBox.innerHTML = "";
  paintTabs();
  root.append(tabsBox);
  await paint();
}
