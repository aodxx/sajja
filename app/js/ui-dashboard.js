/* ui-dashboard.js — หน้าหลัก: สรุปยอด + สิ่งที่ต้องทำเดือนนี้ */
import { h, curYM, fmtYM, fmtBaht, toast } from "./util.js";
import { byType, kvGet } from "./db.js";
import { memberTotals, sajaStatus, welfareFund, finesPending, loanAlerts, loadState } from "./calc.js";


export async function renderDashboard(ctx) {
  const { st, root } = ctx;
  const today = new Date().toISOString().slice(0, 10);
  const cur = curYM();
  const active = st.members.filter((m) => m.status !== "resigned");

  // ---- hero ตัวเลข ----
  const cash = st.cfg.openingCash + st.txs.reduce((s, t) => s + (["saja", "sharebuy", "annualsave", "welfare_in", "other_in", "loan_repay"].includes(t.kind) ? t.amount : 0)
    + (t.kind === "fine" && t.received ? t.amount : 0)
    - (["loan_out", "welfare_out", "other_out", "dividend_pay"].includes(t.kind) ? t.amount : 0), 0);
  const loansDue = st.loans.filter((l) => l.status === "active").reduce((s, l) => s + Math.max(0, loanAlertsOf(st, l).balance), 0);
  const savedAll = active.reduce((s, m) => s + memberTotals(st, m).savings, 0);
  const wf = welfareFund(st);
  const sentCnt = active.filter((m) => sajaStatus(m, cur, st, today) === "sent").length;

  root.append(h("div", { class: "hero" },
    h("div", { class: "small", style: "opacity:.85" }, "💰 เงินคงเหลือกลุ่มวันนี้"),
    h("div", { class: "amount" }, fmtBaht(cash) + " ฿"),
    h("div", { class: "chiprow" },
      h("span", { class: "chip" }, "ให้กู้คงเหลือ " + fmtBaht(loansDue) + " ฿"),
      h("span", { class: "chip" }, "กองทุนสวัสดิการ " + fmtBaht(wf.balance) + " ฿"),
      h("span", { class: "chip" }, "เงินออมสมาชิก " + fmtBaht(savedAll) + " ฿"))));

  // ---- รับเงินเดือนนี้ ----
  root.append(h("div", { class: "card" },
    h("h2", {}, "🗓️ " + fmtYM(cur) + " — รับเงินสัจจะ"),
    h("div", { class: "progress" }, h("i", { style: `width:${active.length ? Math.round((sentCnt / active.length) * 100) : 0}%` })),
    h("p", { class: "small muted", style: "margin:8px 0 10px" },
      `ส่งแล้ว ${sentCnt}/${active.length} คน · ยังไม่ส่ง ${active.length - sentCnt}คน`),
    h("a", { class: "btn btn-primary", href: "#/savings", style: "text-decoration:none" }, "👉 เปิดหน้ารับเงินเดือนนี้")));

  // ---- สิ่งที่ต้องทำวันนี้ ----
  const todo = [];
  active.forEach((m) => {
    const fp = finesPending(st, m);
    if (fp.length) todo.push({ ic: "⚠️", t: `${m.name} ขาดส่ง ${fp.length} เดือน — ยังไม่ได้เก็บค่าปรับ`, to: "savings", prio: 1 });
  });
  const alerts = loanAlerts(st, today);
  alerts.filter((a) => a.flag === "overdue").forEach((a) =>
    todo.push({ ic: "🔕", t: `${a.loan.name} ค้างผ่อน ${a.overdueMonths} งวด (${a.balance} ฿)`, to: "loan:" + a.loan.id, prio: 0 }));
  alerts.filter((a) => a.flag === "due-soon").forEach((a) =>
    todo.push({ ic: "⏰", t: `${a.loan.name} จะครบกำหนดผ่อนวันที่ ${a.nextDue.due}`, to: "loan:" + a.loan.id, prio: 1 }));
  {
    const db = await import("./db.js");
    const rec = await db.getDoc("settings", "recon-" + cur);
    if (rec && rec.v && Math.abs((rec.v.counted ?? rec.v.expect) - rec.v.expect) > 0.5)
      todo.unshift({ ic: "💰", t: `เทียบโถะเดือนนี้ส่วนต่าง ${Math.round((rec.v.counted ?? 0) - rec.v.expect)} ฿ — ยังไม่ได้เคลียร์ (${rec.v.note || "-"})`, to: "savings", prio: 0 });
  }
  const waiting = st.loans.filter((l) => l.status === "waiting");
  waiting.forEach((l) => todo.push({ ic: "📝", t: `คำขอกู้รอพิจารณา ${l.pendingPrio === 1 ? "(เจ็บป่วย—ด่วน)" : ""} : ${l.name}`, to: "loan:" + l.id, prio: l.pendingPrio === "1" || l.pendingPrio === 1 ? 0 : 2 }));
  const backupAt = await kvGet("exportCacheAt");
  if (!backupAt || Date.now() - new Date(backupAt).getTime() > 7 * 86400000)
    todo.unshift({ ic: "☁️", t: "เกิน 7 วันแล้วไม่ได้สำรองข้อมูล — กด “สำรอง/ซิงก์” เดียวนี้", to: "backup", prio: 0 });

  const box = h("div", { class: "list" });
  const sorted = todo.sort((a, b) => a.prio - b.prio).slice(0, 8);
  if (!sorted.length) box.append(h("div", { class: "empty" }, h("span", { class: "ic" }, "✅"), "วันนี้ไม่มีอะไรค้าง เยี่ยมมาก!"));
  sorted.forEach((t) => box.append(h("button", { class: "item", onclick: () => (t.to.startsWith("loan:") ? ctx.nav("loan", t.to.slice(5)) : ctx.nav(t.to)) },
    h("span", { class: "avatar" }, t.ic), h("span", { class: "grow" }, h("span", { class: "name" }, t.t)), h("span", { class: "muted" }, "›"))));
  root.append(h("div", { class: "section-title" }, "📌 สิ่งที่ต้องทำ"), box);

  if (!st.members.length && ctx.canEdit) {
    root.append(h("button", { class: "btn btn-outline", onclick: loadSample }, "🧪 ลองโหลด “ข้อมูลตัวอย่าง” (สมาชิก 5 คน + ออม/กู้/ชำระครบทุกแบบ)"));
  }
  // ---- shortcut ----
  const tiles = h("div", { class: "tiles" },
    tile("👥", "ทะเบียนสมาชิก", active.length + " คน", () => ctx.nav("members")),
    tile("🧰", "สวัสดิการ", "คงเหลือ " + fmtBaht(wf.balance) + "฿", () => ctx.nav("welfare")),
    tile("📄", "กู้/ผ่อน", alerts.length + " รายการน่าสนใจ", () => ctx.nav("loans")),
    tile("💵", "เคาน์เตอร์ผ่อน", "แตะเดียวรับครบ", () => ctx.nav("payday")),
    tile("📊", "รายงาน", "PDF · Excel · CSV", () => ctx.nav("reports")));
  root.append(h("div", { class: "section-title" }, "⚡ ทางลัด"), tiles);
}
function tile(ic, t, s, onclick) {
  return h("button", { class: "tile", onclick }, h("span", { class: "ic" }, ic), h("span", {}, t), h("span", { class: "sub" }, s));
}
import { loanState } from "./calc.js";
const loanAlertsOf = (st, l) => loanState(st, l);

async function loadSample() {
  try {
    const res = await fetch("data/sample-data.json");
    if (!res.ok) throw new Error("ไม่พบไฟล์ตัวอย่างในแอป");
    const snap = await res.json();
    const db = await import("./db.js");
    const r = await db.mergeSnapshot(snap, "ตัวอย่าง", "merge");
    toast(`🧪 โหลดตัวอย่างแล้ว: รายการใหม่ ${r.added} · อัปเดต ${r.updated}`);
    setTimeout(() => location.reload(), 700);
  } catch (e) { toast("โหลดตัวอย่างไม่สำเร็จ: " + e.message, 4000, true); }
}
