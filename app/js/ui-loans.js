/* ui-loans.js — กู้ยืม: สิทธิ์ (ออมครบ 3 ด.), ค้ำ 2 คน, ค่าบำรุง 2%/ด. flat, ≤10 งวด, จัดลำดับเจ็บป่วย>เล่าเรียน>อื่น */
import { h, toast, fmtBaht, fmtDate, curYM, genId, inputBox, confirmBox, modal, ymAdd } from "./util.js";
import { saveDoc, byType, getDoc, softRemove } from "./db.js";
import { loadState } from "./calc.js";
import { eligibility, loanState, schedule, round2, LOAN_PURPOSES, memberById, activeLoans } from "./calc.js";
import { tbl } from "./ui-members.js";

export const PURPOSE_OPTS = Object.entries(LOAN_PURPOSES).map(([k, v]) => [k, `${v.prio === 1 ? "🚑" : v.prio === 2 ? "🎓" : "📦"} ${v.th} (ลำดับ ${v.prio})`]);

export async function renderLoans(ctx) {
  const { st, root, param } = ctx;
  const today = new Date().toISOString().slice(0, 10);

  if (param === "!new") return openApply(ctx, null);

  const active = st.loans.filter((l) => l.status === "active")
    .map((l) => ({ l, s: loanState(st, l, today) }));
  const waiting = st.loans.filter((l) => l.status === "waiting");
  const closed = st.loans.filter((l) => l.status === "closed").slice(-8).reverse();

  const outOpen = round2(active.filter((x) => x.s.overdueMonths).reduce((s, x) => s + x.s.balance, 0));
  const dueMonth = active.reduce((s, x) => s + x.l.principal * (x.l.feePct ?? st.cfg.loanFeePct) / 100, 0);

  root.append(h("div", { class: "hero" },
    h("div", { class: "small", style: "opacity:.85" }, "📄 ให้กู้ค้างรวม"),
    h("div", { class: "amount" }, fmtBaht(active.reduce((s, x) => s + x.s.balance, 0)) + " ฿"),
    h("div", { class: "chiprow" },
      h("span", { class: "chip" }, (outOpen ? "🔕 ค้างชำระ " + fmtBaht(outOpen) + "฿" : "✅ ไม่มีการค้าง")),
      h("span", { class: "chip" }, "ค่าบำรุงคาดการณ์เดือนนี้ " + fmtBaht(round2(dueMonth)) + "฿"),
      waiting.length ? h("span", { class: "chip" }, "📝 รออนุมัติ " + waiting.length) : null)));

  if (waiting.length && ctx.canEdit) {
    const w = h("div", { class: "list" });
    waiting.sort((a, b) => (PURPOSE_OPTS.findIndex((p) => p[0] === a.purpose)) - (PURPOSE_OPTS.findIndex((p) => p[0] === b.purpose)));
    waiting.forEach((l) => w.append(h("button", { class: "item", style: "border:2px solid var(--gold)", onclick: () => ctx.nav("loan", l.id) },
      h("span", { class: "avatar", style: "background:var(--gold-l)" }, "📝"),
      h("span", { class: "grow" }, h("span", { class: "name" }, l.name + " · " + fmtBaht(l.principal) + "฿"),
        h("span", { class: "meta" }, l.id + " · " + (purposeTh(l) || "") + " · ขอไว้ " + fmtDate(l.appliedAt || l.start))),
      h("span", { class: "right badge b-gold" }, "พิจารณา ›"))));
    root.append(h("div", { class: "section-title" }, "📝 คิวรออนุมัติ ( เรียงตามลำดับความสำคัญ )"), w);
  }

  const list = h("div", { class: "list" });
  active.forEach(({ l, s }) => {
    const border = s.overdueMonths ? "var(--red)" : s.dueSoon ? "var(--gold)" : "var(--line)";
    list.append(h("button", { class: "item", style: "border:2px solid " + border, onclick: () => ctx.nav("loan", l.id) },
      h("span", { class: "avatar", style: "background:" + (s.overdueMonths ? "var(--red-l)" : "var(--teal-l)") }, s.overdueMonths ? "🔕" : "📄"),
      h("span", { class: "grow" }, h("span", { class: "name" }, l.name),
        h("span", { class: "meta" }, `${l.id} · ${purposeTh(l)} · ค่างวด ${fmtBaht(s.rows[0]?.due_total || 0)}฿ × ${l.months}`)),
      h("span", { class: "right" }, fmtBaht(s.balance) + "฿",
        h("span", { class: "lbl" }, s.overdueMonths ? "🔴 ค้าง " + s.overdueMonths + " งวด" : s.dueSoon ? "⏰ ถึง " + s.nextDue.due : "งวดถัด " + (s.nextDue ? s.nextDue.due : "-")))));
  });
  if (!active.length && !waiting.length) list.append(h("div", { class: "empty" }, h("span", { class: "ic" }, "🌱"), "ยังไม่มีสัญญากู้ — พร้อมให้สมาชิกกู้เมื่อออมครบกติกา"));
  root.append(h("div", { class: "section-title" }, "💼 สัญญากำลังผ่อน"), list);
  if (ctx.canEdit)
    root.append(h("button", { class: "btn btn-gold", onclick: () => openApply(ctx, null) }, "📝 ยื่นคำขอกู้ใหม่"));

  if (closed.length) {
    const cl = h("div", { class: "list" });
    for (const l of closed) {
      cl.append(h("button", { class: "item", style: "opacity:.75", onclick: () => ctx.nav("loan", l.id) },
        h("span", { class: "avatar", style: "background:var(--green-l)" }, "✅"),
        h("span", { class: "grow" },
          h("span", { class: "name" }, `${l.name} (${l.id})`),
          h("span", { class: "meta" }, "ปิดแล้ว " + fmtDate(l.closedAt || ""))),
        h("span", { class: "right" }, fmtBaht(l.principal) + "฿", h("span", { class: "lbl" }, purposeTh(l)))));
    }
    root.append(h("div", { class: "section-title" }, "✅ ปิดบัญชีล่าสุด"), cl);
  }
  root.append(h("div", { class: "note" }, `กติกา: ออมครบ ${st.cfg.loanMinMonthsSaved} เดือน · วงเริ่มต้น ${fmtBaht(st.cfg.loanBaseLimit)}฿/บัญชี · ผู้ค้ำ ${st.cfg.guarantorsMin} คน · ค่าบำรุง ${st.cfg.loanFeePct}%/เดือน (flat) · ผ่อนไม่เกิน ${st.cfg.loanMaxMonths} งวด`));
  toastClose();
}
function toastClose() {}
const purposeTh = (l) => (PURPOSE_OPTS.find((p) => p[0] === l.purpose) || [, l.purposeTh || "-"])[1].replace(/^[🚑🎓📦]\s*/, "") || l.purposeTh;

/* ---------- ฟอร์มขอกู้ ---------- */
export async function openApply(ctx, preMember) {
  const { st } = ctx;
  const members = (await byType("members")).filter((m) => !m.deletedAt && m.status !== "resigned");
  const purpose = { v: "sick" };
  const months = { v: st.cfg.loanMaxMonths };
  const chosen = { member: preMember && preMember !== "!new" ? preMember : null };
  const guarantors = new Set();

  await openForm(); async function openForm() {}
  function memberSelectBox() {
    const box = h("div", { class: "field" }, h("label", {}, "1️⃣ เลือกผู้ขอกู้ *"), h("div", { class: "hint" }, "แตะเพื่อเลือก"));
    const btn = h("button", { class: "btn btn-outline", style: "width:100%", onclick: pick },
      chosen.member ? "👤 " + chosen.member.name + " (" + chosen.member.id + ")" : "แตะเลือกสมาชิก…");
    box.append(btn);
    return box;
  }
  async function pick() {
    const list = h("div", { class: "list", style: "max-height:50vh;overflow:auto" });
    for (const m of members) {
      const e = eligibility(st, m);
      list.append(h("button", { class: "item", onclick: () => { chosen.member = m; guarantors.clear(); close(); draw(); } },
        h("span", { class: "avatar" }, m.name.slice(0, 1)),
        h("span", { class: "grow" }, h("span", { class: "name" }, m.name), h("span", { class: "meta" }, m.id + " · ออมแล้ว " + e.monthsSaved + " เดือน")),
        h("span", { class: "right" }, e.can ? h("span", { class: "badge b-green" }, "✅ กู้ได้") : h("span", { class: "badge b-red" }, "🔴 ยังไม่ได้"))));
    }
    const { close } = modal("เลือกสมาชิกผู้ขอกู้", list, [{ label: "ปิด" }]);
  }

  const content = h("div", {});
  function draw() {
    content.innerHTML = "";
    content.append(memberSelectBox(), h("div", { style: "height:12px" }));
    if (!chosen.member) return;
    const e = eligibility(st, chosen.member);
    content.append(h("div", { class: e.can ? "note" : "note", style: e.can ? "" : "background:var(--red-l);border-color:var(--red)" },
      e.can ? "✅ " + chosen.member.name + " มีสิทธิ์กู้ วงเงินเริ่มต้น " + fmtBaht(e.limit) + "฿ (ออมแล้ว " + e.monthsSaved + " เดือน)"
        : "⚠️ ยังไม่ผ่านเกณฑ์:\n" + e.bad.map((x) => "• " + x).join("\n")));

    // จุดประสงค์
    const pr = h("div", { class: "field" }, h("label", {}, "2️⃣ วัตถุประสงค์ (มีผลต่อลำดับการพิจารณา)"));
    const seg = h("div", { class: "seg" });
    for (const [k, label] of PURPOSE_OPTS) seg.append(h("button", { class: purpose.v === k ? "on" : "", onclick: () => { purpose.v = k; draw(); } }, label));
    pr.append(seg); content.append(pr);

    // จำนวนเงิน + งวด
    const fP = h("input", { type: "number", value: String(e.limit), inputmode: "decimal", min: "100" });
    const preview = h("p", { class: "small muted" });
    const upd = () => {
      const p = Number(fP.value) || 0; const n = months.v || 1;
      const fee = round2(p * st.cfg.loanFeePct / 100);
      const principalPer = round2(p / n);
      preview.textContent = p && n ? `ค่างวด = เงินต้น ${fmtBaht(principalPer)} + ค่าบำรุง ${fmtBaht(fee)} = ${fmtBaht(round2(principalPer + fee))} ฿/เดือน (${n} งวด) · รวมจ่าย ${fmtBaht(round2((principalPer + fee) * n))}฿` : "";
      if (p > e.limit) preview.textContent += " ⚠️ เกินวงเริ่มต้น — คณะกรรมการอนุมัติเป็นกรณี";
    };
    fP.oninput = upd;
    const msel = h("select", {});
    for (let n = 1; n <= st.cfg.loanMaxMonths; n++) msel.append(h("option", { value: n }, n + " งวด/เดือน"));
    msel.value = String(months.v);
    msel.onchange = () => { months.v = Number(msel.value); upd(); drawPreviewDate(); };
    content.append(h("div", { class: "grid2" },
      h("div", { class: "field" }, h("label", {}, "3️⃣ วงเงินกู้ (฿)"), fP),
      h("div", { class: "field" }, h("label", {}, "4️⃣ จำนวนงวด ( maks " + st.cfg.loanMaxMonths + " )"), msel)));
    upd();

    const startDate = h("input", { type: "date", value: new Date().toISOString().slice(0, 10) });
    startDate.onchange = () => { drawPreviewDate(); };
    content.append(h("div", { class: "field" }, h("label", {}, "📅 วันรับเงินกู้"), startDate, h("span", { class: "hint" }, "งวดแรกชำระเดือนถัดไปจากวันนี้") ), h("p", { id: "previewDates", class: "small muted" }));

    // ผู้ค้ำประกัน
    const gBox = h("div", { class: "field" }, h("label", {}, `5️⃣ ผู้ค้ำประกัน อย่างน้อย ${st.cfg.guarantorsMin} คน *`));
    const gList = h("div", { class: "list", style: "max-height:34vh;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:6px" });
    const note = h("p", { class: "small" });
    members.filter((m) => m.id !== chosen.member.id).forEach((m) => {
      const cb = h("input", { type: "checkbox", id: "g" + m.id, checked: guarantors.has(m.id) });
      cb.onchange = () => { cb.checked ? guarantors.add(m.id) : guarantors.delete(m.id); paintG(); };
      gList.append(h("label", { for: "g" + m.id, style: "display:flex;gap:10px;align-items:center;padding:8px 10px;min-height:52px;cursor:pointer" },
        cb, h("span", { class: "name" }, m.name), h("span", { class: "muted small", style: "margin-left:auto" }, m.id)));
    });
    function paintG() { note.textContent = `เลือกแล้ว ${guarantors.size}/${st.cfg.guarantorsMin} คน`; note.className = "small " + (guarantors.size >= st.cfg.guarantorsMin ? "ok" : "muted"); }
    paintG(); gBox.append(gList, note);
    content.append(gBox);
    function drawPreviewDate() {
      const el = content.querySelector("#previewDates");
      if (el) el.textContent = "งวดแรกถึงกำหนด: " + ymAdd(startDate.value.slice(0, 7), 1) + "-" + startDate.value.slice(8, 10) + " · งวดสุดท้าย: " + ymAdd(startDate.value.slice(0, 7), months.v) + "-" + startDate.value.slice(8, 10);
    }
    drawPreviewDate();
  }
  draw();
  modal("📝 แบบขอกู้เงินสัจจะ", content, [
    { label: "ยกเลิก" },
    { label: "💾 บันทึกคำขอ", cls: "btn-primary", fn: submit },
  ]);
  async function submit() {
    if (!chosen.member) return toast("เลือกผู้ขอกู้ก่อน", 2200, true);
    const p = Number(content.querySelector('input[type=number]').value) || 0;
    const n = months.v;
    if (p < 100) return toast("วงเงินน้อยเกินไป", 2200, true);
    if (guarantors.size < st.cfg.guarantorsMin) return toast(`ต้องเลือกผู้ค้ำ ${st.cfg.guarantorsMin} คนขึ้นไป (${guarantors.size} แล้ว)`, 3200, true);
    const e = eligibility(st, chosen.member);
    if (!e.can) {
      const yes = await confirmBox("ผู้กู้ยังไม่ผ่านเกณฑ์อัตโนมัติ:\n" + e.bad.join("\n") + "\n\nบันทึกเป็น “รออนุมัติ” ให้คณะกรรมการตัดสินใจ?, กู้ยืมต้องไม่ค้างค่าปรับด้วย)", { okLabel: "📝 บันทึกไว้ก่อน" });
      if (!yes) return;
    }
    let id;
    { const loans = await byType("loans"); let k = 1; while (loans.some((x) => x.id === "L" + String(k).padStart(3, "0"))) k++; id = "L" + String(k).padStart(3, "0"); }
    const startDate = content.querySelector('input[type=date]').value;
    const loan = {
      id, type: "loans", member: chosen.member.id, name: chosen.member.name,
      principal: round2(p), months: n, feePct: st.cfg.loanFeePct, purpose: purpose.v,
      purposeTh: (PURPOSE_OPTS.find((x) => x[0] === purpose.v) || [])[1],
      guarantorIds: [...guarantors], start: startDate, appliedAt: new Date().toISOString(),
      status: "waiting", note: "",
    };
    await ctx.edit(() => saveDoc("loans", loan, ctx.user?.name, "create"), "📝 บันทึกคำขอกู้แล้ว — เข้าคิวรออนุมัติ");
    ctx.nav("loan", id);
  }
}

/* ---------- หน้าสัญญา + ตารางผ่อน + รับชำระ ---------- */
export async function renderLoan(ctx, id) {
  const { st, root } = ctx;
  if (id === "!new") return openApply(ctx, ctx.param === "!new" ? null : ctx.param);
  const l = await getDoc("loans", id);
  if (!l || l.deletedAt) { root.append(h("div", { class: "empty" }, "😕 ไม่พบสัญญานี้")); return; }
  const today = new Date().toISOString().slice(0, 10);
  const s = loanState(st, l, today);
  const gNames = (l.guarantorIds || []).map((g) => { const m = memberById(st, g); return m ? m.name + " (" + g + ")" : g; });
  const prio = (LOAN_PURPOSES[l.purpose] || { prio: 3, th: l.purposeTh || "อื่นๆ" }).prio;
  const pTh = l.purposeTh || (LOAN_PURPOSES[l.purpose] || {}).th || "อื่นๆ";

  root.append(h("div", { class: "card", style: "text-align:center" },
    h("div", { style: "font-size:2.4rem" }, prio === 1 ? "🚑" : prio === 2 ? "🎓" : "📦"),
    h("h2", { style: "margin:2px" }, l.name + " · " + fmtBaht(l.principal) + "฿"),
    h("p", { class: "muted small" }, `${l.id} · ${pTh} (ลำดับ ${prio}) · ค่าบำรุง ${l.feePct}%/ด. flat · ${l.months} งวด · เริ่ม ${fmtDate(l.start)}`),
    h("p", { class: "small" }, "🤝 ผู้ค้ำ: " + (gNames.join(" + ") || "—")),
    h("div", { class: "chiprow", style: "justify-content:center" },
      l.status === "waiting" ? h("span", { class: "badge b-gold" }, "📝 รออนุมัติ") :
        l.status === "active" ? (s.overdueMonths ? h("span", { class: "badge b-red" }, "🔕 ค้าง " + s.overdueMonths + " งวด") : h("span", { class: "badge b-teal" }, "กำลังผ่อน")) :
          l.status === "closed" ? h("span", { class: "badge b-green" }, "✅ ปิดบัญชี") : h("span", { class: "badge b-gray" }, "ยกเลิก"),
      h("span", { class: "chip", style: "background:var(--teal-l);color:var(--teal-d)" }, "คงเหลือ " + fmtBaht(Math.max(0, s.balance)) + " ฿" + (s.carry ? ` (เครดิตเกิน ${fmtBaht(s.carry)}฿)` : "")))));

  // ตารางผ่อน
  const rows = [["งวด", "ถึงกำหนด", "เงินต้น", "ค่าบำรุง", "รวมงวด", "จ่ายแล้ว", "คงเหลือ", "สถานะ"]];
  s.rows.forEach((r) => {
    const left = round2(r.principal - r.princPaid + r.fee - r.feePaid);
    const done = left < 0.005;
    const isOver = !done && r.due < today;
    rows.push([r.no, fmtDate(r.due), fmtBaht(r.principal), fmtBaht(r.fee), fmtBaht(r.due_total),
      fmtBaht(round2(r.princPaid + r.feePaid)), done ? "—" : fmtBaht(left),
      done ? "✅" : isOver ? "🔴 ค้าง" : r.due >= today && r.due <= ymAdd(today.slice(0, 7), 0) + "-99" ? "⏰ เร็วๆ นี้" : "⬜"]);
  });
  root.append(tbl(rows));

  const btns = h("div", { class: "btn-row" });
  if (ctx.canEdit && l.status === "waiting") {
    btns.append(h("button", { class: "btn btn-green", onclick: () => approve() }, "✅ อนุมัติ + จ่ายเงินกู้"));
    btns.append(h("button", { class: "btn btn-red", onclick: () => reject() }, "❌ ไม่อนุมัติ"));
  }
  if (ctx.canEdit && l.status === "active") {
    btns.append(h("button", { class: "btn btn-gold", onclick: () => repay(s) }, "💵 รับชำระงวดนี้ " + (s.nextDue ? "(" + fmtBaht(s.nextDue.due_total) + "฿)" : "")));
    btns.append(h("button", { class: "btn btn-outline", onclick: () => editLoan() }, "✏️ แก้สัญญา"));
  }
  root.append(btns);
  root.append(h("button", { class: "btn btn-ghost", style: "margin-top:8px", onclick: () => ctx.nav("loans") }, "← กลับหน้ากู้/ผ่อน"));

  async function approve() {
    const yes = await confirmBox(`จ่ายเงินกู้ ${fmtBaht(l.principal)} ฿ ให้ ${l.name} พร้อมออกเอกสาร? (ระบบจะบันทึกเงินออกจากกองทุน + ตารางผ่อน)`, { okLabel: "✅ จ่ายเงินกู้" });
    if (!yes) return;
    await ctx.edit(async () => {
      await saveDoc("loans", { ...l, id: l.id, status: "active", approvedBy: ctx.user?.name, approvedAt: new Date().toISOString() }, ctx.user?.name, "update");
      await saveDoc("txs", { id: genId("tx"), kind: "loan_out", member: l.member, loanId: l.id, amount: l.principal, at: l.start || today, ym: (l.start || today).slice(0, 7), note: "จ่ายกู้ " + l.id }, ctx.user?.name, "create");
    }, "✅ อนุมัติ + บันทึกจ่ายเงินกู้แล้ว");
  }
  async function reject() {
    const r = await inputBox("❌ เหตุผลที่ไม่อนุมัติ", { label: "เหตุผล *", hint: "เก็บไว้ใน Audit + แจ้งผู้กู้" });
    if (r == null) return;
    await ctx.edit(async () => { await saveDoc("loans", { ...l, id: l.id, status: "void", voidReason: r }, ctx.user?.name, "update"); }, "🗑️ ยกเลิกคำขอแล้ว (ข้อมูลเดิมยังอยู่)");
  }
  async function repay(s2) {
    const dueAmt = s2.nextDue ? s2.nextDue.due_total : round2(l.principal / l.months + l.principal * (l.feePct ?? st.cfg.loanFeePct) / 100);
    const v = await inputBox("💵 รับชำระ — " + l.name, { label: "จำนวนเงินที่รับงวดนี้ *", value: String(dueAmt), type: "number", hint: "จ่ายเกิน/ขาดได้ ระบบตัดยอดอัตโนมัติ: ค่าบำรุงก่อน → เงินต้นงวดเก่าสุด" });
    if (v == null || v === "") return;
    const amt = round2(Number(v)); if (amt <= 0) return toast("ใส่จำนวนเงินก่อน", 2000, true);
    const note = await inputBox("ออกใบเสร็จ", { label: "เอกสาร/หมายเหตุ (เว้นว่างได้)", value: "" });
    await ctx.edit(async () => {
      await saveDoc("txs", { id: genId("tx"), kind: "loan_repay", member: l.member, loanId: l.id, amount: amt, fee: 0, principal: 0, at: today, ym: today.slice(0, 7), note: (note || "").trim() }, ctx.user?.name, "create");
      // ถ้ายอดคงเหลือ = 0 → ปิดสัญญาอัตโนมัติ
      const st2 = await freshState();
      const s3 = loanState(st2, (await getDoc("loans", l.id)), today);
      if (s3.balance <= 0.004 && s3.rows.every((r) => round2(r.fee - r.feePaid) < 0.005 && round2(r.principal - r.princPaid) < 0.005))
        await saveDoc("loans", { ...l, id: l.id, status: "closed", closedAt: today }, ctx.user?.name, "update");
    }, `✅ รับ ${fmtBaht(amt)} ฿ — คำนวณยอดคงเหลือใหม่แล้ว`);
  }
  async function freshState() { const db = await import("./db.js"); return loadState(db); }
  async function editLoan() {
    const months = await inputBox("✏️ แก้สัญญา (บันทึกการแก้ไข)", { label: `จำนวนงวด (เดิม ${l.months}) ≤ ${st.cfg.loanMaxMonths}`, value: String(l.months), type: "number" });
    if (!months) return;
    const pr = await inputBox("", { label: "หมายเหตุสัญญา", value: l.note || "" });
    await ctx.edit(() => saveDoc("loans", { ...l, id: l.id, months: Number(months) || l.months, note: pr ?? l.note }, ctx.user?.name, "update"), "💾 แก้สัญญาแล้ว (ตรวจได้ใน Audit)");
  }
}

/* พิมพ์ statement — ใช้ผ่านปุ่ม PDF ในหน้ารายงานก็ได้ */
export function printStmtFor(ctx, l) {}
export async function loanStatementHTML(ctx, l) { return ""; }
export function printStmt() {}
