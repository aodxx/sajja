/* ui-members.js — ทะเบียนสมาชิก: เพิ่ม/แก้/ค้นหา/ประวัติรายคน (Soft Delete เท่านั้น) */
import { h, toast, fmtDate, fmtBaht, inputBox, confirmBox, modal, fmtYM, debounce } from "./util.js";
import { saveDoc, byType, getDoc, softRemove } from "./db.js";
import { memberTotals, sajaHistory, sajaStatus, loanState, eligibility } from "./calc.js";

async function nextMemberId() {
  const members = await byType("members");
  let n = 1;
  while (members.some((x) => x.id === "S" + String(n).padStart(3, "0"))) n++;
  return "S" + String(n).padStart(3, "0");
}

/* helper ตาราง (ใช้ทั้งหน้าสมาชิก/รายงาน) */
export function tbl(rows) {
  const wrap = h("div", { class: "tbl-wrap" });
  const t = h("table", { class: "tbl" });
  t.append(h("thead", {}, h("tr", {}, ...(rows[0] || []).map((c) => h("th", {}, String(c ?? ""))))));
  const body = h("tbody");
  (rows.slice(1) || []).forEach((r) => body.append(h("tr", {}, ...r.map((c) => h("td", {}, String(c ?? ""))))));
  t.append(body);
  wrap.append(t);
  return wrap;
}

export async function renderMembers(ctx) {
  const { st, root } = ctx;
  const today = new Date().toISOString().slice(0, 10);
  const showOnly = { resigned: false };
  const all = (await byType("members"))
    .filter((m) => !m.deletedAt)
    .map((m) => ({ m, tw: memberTotals(st, m), lates: sajaHistory(st, m).filter((r) => r.status === "late").length }));

  const listEl = h("div", { class: "list" });
  const search = h("input", { placeholder: "🔍 ค้นหาชื่อ / ชื่อเล่น / รหัส...", "aria-label": "ค้นหาสมาชิก" });
  const sortSel = h("select", { style: "min-height:48px;border:2px solid var(--line);border-radius:12px;padding:0 10px;font-size:.9rem;background:#fff" },
    h("option", { value: "code" }, "เรียง: รหัสสมาชิก"),
    h("option", { value: "late" }, "เรียง: ค้างส่งมากสุด"),
    h("option", { value: "saved" }, "เรียง: ออมสะสมมากสุด"));
  search.oninput = debounce(paint, 200);
  sortSel.onchange = () => paint();

  function paint() {
    const q = (search.value || "").trim().toLowerCase();
    let rows = all.filter((x) => (showOnly.resigned ? x.m.status === "resigned" : x.m.status !== "resigned"));
    if (q) rows = rows.filter((x) => (x.m.name + " " + (x.m.nick || "") + " " + x.m.id).toLowerCase().includes(q));
    if (sortSel.value === "late") rows.sort((a, b) => b.lates - a.lates);
    if (sortSel.value === "saved") rows.sort((a, b) => b.tw.savings - a.tw.savings);
    listEl.innerHTML = "";
    if (!rows.length) listEl.append(h("div", { class: "empty" }, h("span", { class: "ic" }, "👥"), "ไม่พบสมาชิก — กด “+ เพิ่มสมาชิก” ด้านล่าง"));
    for (const { m, tw, lates } of rows) {
      const stt = sajaStatus(m, today.slice(0, 7), st, today);
      listEl.append(h("button", { class: "item", onclick: () => ctx.nav("member", m.id) },
        h("span", { class: "avatar" }, m.name.slice(0, 1)),
        h("span", { class: "grow" },
          h("span", { class: "name" }, m.name + (m.nick ? " (" + m.nick + ")" : "") + (m.status === "resigned" ? " 📤" : "")),
          h("span", { class: "meta" }, m.id + " · สัจจะ " + fmtBaht(m.monthly || st.cfg.sajaMonthly || 50) + "฿/เดือน · หุ้น " + tw.sharesN)),
        h("span", { class: "right" }, fmtBaht(tw.savings) + "฿",
          h("span", { class: "lbl" }, lates ? "🔴 ค้าง " + lates + " เดือน" : stt === "due" ? "🟡 รอส่งเดือนนี้" : "✅ ส่งเดือนนี้แล้ว"))));
    }
    if (ctx.canEdit)
      listEl.append(h("button", { class: "btn btn-primary", style: "margin-top:10px", onclick: () => addEdit(ctx, null) }, "➕ เพิ่มสมาชิก"));
  }

  root.append(
    h("div", { class: "search" }, search), sortSel,
    h("div", { class: "seg" },
      h("button", { class: "on", onclick: (e) => { showOnly.resigned = false; e.target.classList.add("on"); e.target.nextElementSibling.classList.remove("on"); paint(); } }, "🟢 สมาชิกปัจจุบัน"),
      h("button", { onclick: (e) => { showOnly.resigned = true; e.target.classList.add("on"); e.target.previousElementSibling.classList.remove("on"); paint(); } }, "📤 เคยเป็นสมาชิก")),
    listEl);
  paint();
}

/* ---------- ฟอร์มเพิ่ม/แก้ ---------- */
function fld(f, label, key, type = "text", ph = "", hint = "") {
  f[key] = h("input", {
    type, placeholder: ph,
    value: f.__m ? String(f.__m[key] ?? "") : "",
    inputmode: type === "number" ? "decimal" : type === "tel" ? "tel" : "text",
  });
  return h("div", { class: "field" }, h("label", {}, label), f[key], hint ? h("span", { class: "hint" }, hint) : null);
}
export function addEdit(ctx, m) {
  const isNew = !m;
  const f = { __m: m };
  const content = h("div", {},
    fld(f, "👤 ชื่อ-สกุลจริง *", "name", "text", "เช่น สมจิตร ใจดี"),
    fld(f, "ชื่อเล่น (เรียกง่าย ๆ)", "nick", "text", "เช่น จิตร"),
    h("div", { class: "grid2" }, fld(f, "📱 เบอร์โทร", "phone", "tel", "08x-xxx-xxxx"), fld(f, "🎂 วันเกิด", "born", "date")),
    h("div", { class: "grid2" }, fld(f, "📅 วันเข้ากลุ่ม *", "joined", "date", "", "ใช้คำนวณสิทธิ์กู้/ค่าปรับ"), fld(f, "💵 เงินสัจจะ/เดือน", "monthly", "number", "50", "เว้นว่าง = กติกากลุ่ม")),
    fld(f, "🏠 ที่อยู่สั้น ๆ", "addr", "text", "เช่น 12/3 หมู่ 5"),
    fld(f, "เลขสมุดคู่ฝาก (ถ้ามี)", "bookno", "text", ""),
    fld(f, "หมายเหตุ", "note", "text", ""));
  async function save() {
    const d = {};
    for (const [k, el] of Object.entries(f)) {
      if (k === "__m") continue;
      d[k] = typeof el.value === "string" ? el.value.trim() : el.value;
    }
    if (!d.name) return toast("❌ กรุณากรอกชื่อ-สกุล", 2200, true);
    if (!d.joined) return toast("❌ กรุณาระบุวันเข้ากลุ่ม", 2200, true);
    d.monthly = d.monthly ? Number(d.monthly) : (ctx.cfg.sajaMonthly || 50);
    await ctx.edit(async () => {
      const id = m ? m.id : await nextMemberId();
      await saveDoc("members", { id, ...d, code: id.slice(1), status: (m && m.status) || "active" }, ctx.user?.name, isNew ? "create" : "update");
    }, isNew ? "✅ เพิ่มสมาชิกแล้ว" : "💾 แก้ข้อมูลแล้ว");
  }
  modal(isNew ? "➕ เพิ่มสมาชิกใหม่" : "✏️ แก้ข้อมูล " + m.name, content,
    [{ label: "ยกเลิก" }, { label: "💾 บันทึก", cls: "btn-primary", fn: save }]);
}

/* ---------- หน้าประวัติรายคน ---------- */
export async function renderMember(ctx, id) {
  const { st, root } = ctx;
  const m = await getDoc("members", id);
  if (!m || m.deletedAt) { root.append(h("div", { class: "empty" }, "😕 ไม่พบสมาชิกคนนี้")); return; }
  const tw = memberTotals(st, m);
  const his = sajaHistory(st, m).reverse();
  const elig = eligibility(st, m);
  const loans = st.loans.filter((l) => l.member === id && l.status !== "void");

  root.append(h("div", { class: "card", style: "text-align:center" },
    h("div", { style: "font-size:2.6rem" }, "👤"),
    h("h2", { style: "margin:2px" }, m.name),
    h("p", { class: "muted small" }, "รหัส " + m.id + (m.nick ? " · " + m.nick : "") + " · เข้ากลุ่ม " + fmtDate(m.joined)),
    m.status === "resigned" ? h("span", { class: "badge b-gold" }, "พ้นสมาชิกแล้ว") : null));

  const grid = h("div", { class: "stat-grid" });
  [["💵 สัจจะสะสม", fmtBaht(tw.saja) + "฿"], ["🧾 หุ้น " + tw.sharesN + " หุ้น", fmtBaht(tw.shares) + "฿"],
   ["🐷 ออมรายปี", fmtBaht(tw.annual) + "฿"], ["💰 รวมเงินออม", fmtBaht(tw.savings) + "฿"],
   ["⚠️ ค่าปรับจ่ายแล้ว", fmtBaht(tw.finesPaid) + "฿"],
   ["📄 หนี้กู้คงเหลือ", fmtBaht(loans.reduce((s, l) => s + (l.status === "active" ? loanState(st, l).balance : 0), 0)) + "฿"]]
    .forEach(([l, v]) => grid.append(h("div", { class: "stat" }, h("div", { class: "num" }, v), h("div", { class: "lbl" }, l))));
  root.append(grid);

  root.append(h("div", { class: "card" }, h("h3", {}, "✅ สิทธิ์กู้ยืม"),
    h("p", { class: elig.can ? "ok" : "bad", style: "margin:2px 0" },
      elig.can ? "กู้ได้ · วงเงินเริ่มต้น " + fmtBaht(elig.limit) + "฿" : "ยังไม่พร้อมกู้"),
    ...elig.ok.map((x) => h("p", { class: "small", style: "margin:2px 0" }, "🟢 " + x)),
    ...elig.bad.map((x) => h("p", { class: "small bad", style: "margin:2px 0" }, "🔴 " + x)),
    ctx.canEdit ? h("button", { class: "btn btn-gold", style: "margin-top:8px", onclick: () => ctx.nav("loan", "!new"), }, "📄 ยื่นขอกู้ใหม่") : null));

  const rowsHis = [["เดือน", "สถานะ", "จำนวนเงิน"]];
  his.slice(0, 15).forEach((r) => rowsHis.push([fmtYM(r.ym),
    r.status === "sent" ? "✅ ส่งแล้ว" : r.status === "late" ? "🔴 ค้าง" : r.status === "due" ? "🟡 เดือนนี้" : "—",
    r.amount ? fmtBaht(r.amount) : "-"]));
  root.append(h("div", { class: "card" }, h("h3", {}, "🗓️ ประวัติเงินสัจจะ (15 เดือนล่าสุด)"), tbl(rowsHis)));

  if (loans.length) {
    const lb = h("div", { class: "list" });
    loans.forEach((l) => {
      const s = loanState(st, l);
      lb.append(h("button", { class: "item", onclick: () => ctx.nav("loan", l.id) },
        h("span", { class: "avatar" }, "📄"),
        h("span", { class: "grow" }, h("span", { class: "name" }, l.id + " · " + fmtBaht(l.principal) + "฿"),
          h("span", { class: "meta" }, (l.purposeTh || l.purpose || "") + " · " + l.months + " งวด · เริ่ม " + fmtDate(l.start))),
        h("span", { class: "right" }, fmtBaht(s.balance) + "฿", h("span", { class: "lbl" }, s.status === "closed" ? "ปิดแล้ว ✅" : "คงเหลือ"))));
    });
    root.append(h("div", { class: "section-title" }, "📄 สัญญากู้ของคนนี้"), lb);
  }

  const btns = h("div", { class: "btn-row", style: "margin-top:6px" });
  if (ctx.canEdit) {
    btns.append(h("button", { class: "btn btn-outline", onclick: () => addEdit(ctx, m) }, "✏️ แก้ข้อมูล"));
    if (m.status !== "resigned")
      btns.append(h("button", { class: "btn btn-ghost", onclick: async () => {
        const yes = await confirmBox(`ให้ ${m.name} พ้นสภาพสมาชิก? (ประวัติเงินทั้งหมดจะยังอยู่ครบ)`, { okLabel: "✅ พ้นสภาพ" });
        if (!yes) return;
        await ctx.edit(() => saveDoc("members", { ...m, id: m.id, status: "resigned", resignedAt: new Date().toISOString().slice(0, 10) }, ctx.user?.name, "update"), "📤 บันทึกพ้นสภาพแล้ว");
      } }, "📤 พ้นสภาพ"));
    btns.append(h("button", { class: "btn btn-red", onclick: async () => {
      const r = await inputBox("🗑️ ลบรายชื่อ (Soft Delete)", { label: "เหตุผลที่ต้องลบ *", hint: "บันทึกไว้ใน Audit Trail เสมอ เช่น “ลงทะเบียนซ้ำ”" });
      if (r == null) return;
      if (!r.trim()) return toast("กรุณาใส่เหตุผลด้วย", 2200, true);
      await ctx.edit(() => softRemove("members", m.id, ctx.user?.name, r), "🗑️ ลบแล้ว — กู้คืนได้ใน “ประวัติการแก้ไข”");
      ctx.nav("members");
    } }, "🗑️ ลบ"));
  }
  if (btns.children.length) root.append(btns);
  root.append(h("button", { class: "btn btn-ghost", onclick: () => ctx.nav("members") }, "← กลับทะเบียนสมาชิก"));
}
