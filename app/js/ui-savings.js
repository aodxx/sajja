/* ui-savings.js — หน้า "รับเงิน" หัวใจของงานประจำเดือน: สัจจะ / หุ้น / ออมรายปี + ค่าปรับ */
import { h, toast, fmtBaht, fmtYM, ymAdd, curYM, genId, modal, confirmBox, inputBox, fmtDate } from "./util.js";
import { saveDoc, byType, getDoc } from "./db.js";
import { sajaStatus, memberTotals, finesPending, sumSaja, round2 } from "./calc.js";
import { attachReceipt, slipHTML } from "./receipt.js";

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
      const rowKids = [
        h("span", { class: "avatar", style: "background:" + (cls === "ok" ? "var(--green-l)" : cls === "late" ? "var(--red-l)" : "var(--teal-l)") },
          cls === "ok" ? "✓" : (cls === "late" ? "!" : m.name.slice(0, 1))),
        h("span", { class: "grow" },
          h("span", { class: "name" }, m.name),
          h("span", { class: "meta" }, m.id + " · ต้องส่ง " + fmtBaht(amt) + "฿" + (cls === "late" ? " · 🔴ค้าง" : ""))),
      ];
      if (cls === "ok") {
        const tx = st.txs.filter((x) => x.kind === "saja" && x.member === m.id && x.ym === ym).sort((a, b) => (a.updatedAt || "") < (b.updatedAt || "") ? -1 : 1).pop();
        rowKids.push(h("span", { class: "right" }, fmtBaht(sumSaja(st, m.id, ym)) + "฿",
          h("span", { class: "lbl" }, "✅ " + (tx && tx.receiptNo ? tx.receiptNo.slice(-4) : "ส่งแล้ว"))));
        list.append(wrapRow(rowKids, m));
      } else {
        rowKids.push(
          h("button", { class: "btn btn-sm btn-green", style: "min-width:74px", onclick: (e) => { e.stopPropagation(); recordSaja(m, amt); } }, "✓ รับ"),
          h("button", { class: "btn btn-sm btn-ghost", style: "margin-left:6px", title: "กรอกยอดเอง", onclick: (e) => { e.stopPropagation(); recordSajaAsk(m, amt); } }, "✎"));
        list.append(wrapRow(rowKids, m));
      }
      function wrapRow(kids, mm) {
        const el = h("div", { class: "item", style: "border:2px solid " + (cls === "ok" ? "var(--green)" : cls === "late" ? "var(--red)" : "var(--line)"), cursor: "pointer" }, ...kids);
        el.onclick = () => (cls === "ok" ? showMonth(mm) : recordSaja(mm, amt)); // แตะที่ชื่อ = รับยอดหลักทันที
        return el;
      }
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
    body.append(list, reconCard());
    return;

    function reconCard() {
      const card = h("div", { class: "card" },
        h("h3", {}, "💰 เทียบโถะเงิน — " + fmtYM(ym)),
        h("p", { class: "small muted" }, "หลังประชุม: นับเงินสดจริงที่ได้กับตา ใส่จำนวนในช่อง — ระบบเทียบว่าตรงกับที่บันทึกไปกี่บาท (ส่วนต่างห้ามละเลย ต้องกรอกเหตุผล)"),
        h("p", { class: "small" }, "ระบบบันทึกว่ารับเดือนนี้: " + h("b", {}, fmtBaht(round2(sum)) + " ฿")));
      const inp = h("input", { type: "number", placeholder: "นับเงินสดได้ (฿)", inputmode: "decimal", style: "min-height:56px;border:2px solid var(--line);border-radius:12px;padding:10px 14px;font-size:1.25rem;font-weight:800;width:100%;text-align:center" });
      const note = h("input", { type: "text", placeholder: "หมายเหตุ (ใส่เมื่อยอดไม่ตรง เช่น ธ.บัตรค้าง 100)" });
      const btnSave = h("button", { class: "btn btn-primary", style: "margin-top:8px" }, "🔒 บันทึกการเทียบ (เข้า Audit)");
      const state = h("p", { class: "small" });
      btnSave.onclick = async () => {
        const counted = Number(inp.value);
        if (!(counted >= 0)) return toast("กรอกจำนวนที่นับได้ก่อน", 2200, true);
        const diff = round2(counted - sum);
        if (Math.abs(diff) > 0.5 && !note.value.trim()) return toast("ยอดไม่ตรง — กรุณากรอกเหตุผลสั้นๆ", 2800, true);
        await ctx.edit(async () => {
          await saveDoc("settings", { id: "recon-" + ym, v: { expect: round2(sum), counted, diff, note: note.value.trim(), by: ctx.user?.name, at: new Date().toISOString() } }, ctx.user?.name, "update");
        }, Math.abs(diff) < 0.5 ? "✅ ตรงกันเป๊ะ — ปิดงวดได้เลย" : "🟡 บันทึกส่วนต่าง " + fmtBaht(diff) + "฿ (เด้งเตือนบนหน้าหลักจนกว่าจะแก้)");
      };
      card.append(inp, note, btnSave, state);
      getDoc("settings", "recon-" + ym).then((d) => {
        if (d && d.v) {
          state.innerHTML = d.v.diff && Math.abs(d.v.diff) > 0.5
            ? `🟡 เทียบแล้ว ${fmtDate(d.v.at)}: นับ ${fmtBaht(d.v.counted)} ต่าง ${fmtBaht(d.v.diff)}฿ · ${d.v.note || "-"} · โดย ${d.v.by}`
            : `🟢 เทียบแล้ว ${fmtDate(d.v.at)}: ยอดตรงเป๊ะ · โดย ${d.v.by}`;
          if (Math.abs((d.v.counted ?? d.v.expect) - d.v.expect) < 0.5) card.style.borderColor = "#16a34a";
        }
      });
      return card;
    }

    async function render() { body.innerHTML = ""; await paintSaja(); root.append(body); }

    async function recordSaja(m, amt) {
      const amount = round2(Number(amt)); if (!(amount > 0)) return;
      await ctx.edit(async () => {
        const tx = { id: genId("tx"), kind: "saja", member: m.id, ym, amount, at: today2(), note: "" };
        await attachReceipt(tx, st, ctx.user?.name);
        await saveDoc("txs", tx, ctx.user?.name, "create");
      }, `✅ ${m.name} ${fmtBaht(amount)}฿ — แตะชื่อเพื่อพิมพ์สลิป`);
    }
    async function recordSajaAsk(m, amt) {
      const v = await inputBox("💵 รับเงินพิเศษ — " + m.name, {
        label: fmtYM(ym) + " ส่งกี่บาท?", value: String(amt), type: "number",
        hint: "ใช้เมื่อยอดไม่เท่ากติกา เช่น จ่ายชดเชยเดือนที่ขาด",
      });
      if (v == null || v === "") return;
      const amount = round2(Number(v)); if (amount <= 0) return toast("ใส่จำนวนเงินก่อน", 2000, true);
      await ctx.edit(async () => {
        const tx = { id: genId("tx"), kind: "saja", member: m.id, ym, amount, at: today2(), note: "ยอดพิเศษ" };
        await attachReceipt(tx, st, ctx.user?.name);
        await saveDoc("txs", tx, ctx.user?.name, "create");
      }, `✅ ${m.name} ส่ง ${fmtBaht(amount)} ฿`);
    }
    function showMonth(m) {
      const tx = st.txs.filter((x) => x.kind === "saja" && x.member === m.id && x.ym === ym).sort((a, b) => (a.updatedAt || "") < (b.updatedAt || "") ? -1 : 1).pop();
      const body = h("div", { class: "stack" },
        tx && tx.receiptNo ? h("p", { style: "font-family:monospace;font-size:1.02rem;background:var(--teal-l);border-radius:10px;padding:8px 12px" },
          "เลขที่: " + tx.receiptNo + "\nรหัสตรวจสลิป: " + (tx.vcode || "—")) : null,
        h("p", {}, "ยอดที่รับ: " + fmtBaht(sumSaja(st, m.id, ym)) + " บาท (" + (tx ? fmtDate2(tx.at) : "-") + ")"));
      modal("🧾 " + m.name + " — " + fmtYM(ym), body, [
        { label: "ปิด" },
        ...(tx ? [{ label: "🖨️ พิมพ์สลิป", cls: "btn-primary", fn: () => { import("./fileio.js").then((F) => F.printHTML("สลิป " + tx.receiptNo, require_slip(tx))); } }] : []),
        ...(ctx.canEdit && tx ? [{ label: "✏️ แก้ยอด", fn: () => changeSaja(tx) }] : []),
        ...(ctx.canEdit && tx ? [{ label: "🗑️ ลบ", cls: "btn-red", fn: () => undoSaja(m) }] : []),
      ]);
      function fmtDate2(x) { const [y, mo, d] = String(x).split("-"); return `${d}/${mo}/${+y + 543}`; }
    }
    function require_slip(tx) { return slipHTML(tx, st, { copyLabel: "ต้นขั้วกลุ่ม" }) + slipHTML(tx, st, { copyLabel: "ให้สมาชิก" }); }
    async function changeSaja(tx) {
      const v = await inputBox("✏️ แก้ยอดเงิน — จะออกเลขที่สลิปใหม่", {
        label: "ยอดที่ถูกต้อง (฿)", value: String(tx.amount), type: "number",
        hint: "ระบบเก็บเลขที่ไว้ + สลิปเก่าจะตรวจไม่ผ่าน (หลักฐานว่ามีการแก้)",
      });
      if (v == null || !(Number(v) > 0)) return;
      await ctx.edit(async () => {
        const nt = { ...tx, id: tx.id, amount: round2(Number(v)), note: (tx.note ? tx.note + " | " : "") + "แก้เป็น " + fmtBaht(v) + "฿" };
        await attachReceipt(nt, st, ctx.user?.name); // เลขเอกสารคงเดิม รหัสตรวจเปลี่ยน → สลิปกระดาษเก่าตรวจพบทันทีว่าถูกแก้
        await saveDoc("txs", nt, ctx.user?.name, "update");
      }, "✏️ แก้ยอด + ออกสลิปใหม่ให้แล้ว (พิมพ์แจกแทนของเก่า)");
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
          const tx = { id: genId("tx"), kind: "saja", member: m.id, ym, amount: amt, at: today2(), note: "รับเหมาทั้งแถว" };
          await attachReceipt(tx, st, ctx.user?.name);
          await saveDoc("txs", tx, ctx.user?.name, "create");
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
