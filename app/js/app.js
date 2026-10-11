/* app.js — โครงแอป: boot, router, การอนุญาตสิทธิ์, ออฟไลน์, แจ้งเตือน */
import { $, $$, h, toast } from "./util.js";
import * as DB from "./db.js";
import { loadState, loanAlerts, daysBetween } from "./calc.js";
import { showLogin } from "./ui-login.js";
import { renderDashboard } from "./ui-dashboard.js";
import { renderMembers, renderMember } from "./ui-members.js";
import { renderSavings } from "./ui-savings.js";
import { renderLoans, renderLoan } from "./ui-loans.js";
import { renderWelfare } from "./ui-welfare.js";
import { renderDividend } from "./ui-dividend.js";
import { renderReports } from "./ui-reports.js";
import { renderAudit } from "./ui-audit.js";
import { renderSettings, renderBackup, renderUsers, renderPublic } from "./ui-settings.js";
import { renderPayday } from "./ui-payday.js";
import { renderVerify } from "./ui-verify.js";

export const App = { user: null, st: null, route: "dashboard", param: null };

const ROUTES = {
  dashboard: { title: "หน้าหลัก", fn: renderDashboard, tab: "dashboard" },
  savings: { title: "รับเงินเดือนนี้", fn: renderSavings, tab: "savings" },
  members: { title: "ทะเบียนสมาชิก", fn: renderMembers, tab: "members" },
  member: { title: "ประวัติสมาชิก", fn: (c) => renderMember(c, c.param), tab: "members" },
  loans: { title: "กู้ / ผ่อน", fn: renderLoans, tab: "loans" },
  loan: { title: "สัญญากู้", fn: (c) => renderLoan(c, c.param), tab: "loans" },
  welfare: { title: "กองทุนสวัสดิการ", fn: renderWelfare, tab: "menu" },
  dividend: { title: "เงินปันผล", fn: renderDividend, tab: "menu" },
  reports: { title: "รายงาน", fn: renderReports, tab: "menu" },
  audit: { title: "ประวัติการแก้ไข", fn: renderAudit, tab: "menu" },
  settings: { title: "ตั้งค่ากลุ่ม", fn: renderSettings, tab: "menu" },
  backup: { title: "สำรอง / ซิงก์", fn: renderBackup, tab: "backup" },
  users: { title: "ผู้ใช้งาน / PIN", fn: renderUsers, tab: "menu" },
  public: { title: "ดูยอดสมาชิก", fn: renderPublic, tab: "menu" },
  payday: { title: "เคาน์เตอร์ผ่อนวันนี้", fn: renderPayday, tab: "loans" },
  verify: { title: "ตรวจสลิป", fn: renderVerify, tab: "menu" },
  menu: { title: "อื่น ๆ", fn: renderMenu, tab: "menu" },
};

/* ---------- สิทธิ์: auditor = อ่านอย่างเดียว ---------- */
export function canEdit() { return App.user && App.user.role !== "auditor"; }
export function isTreasurer() { return App.user && App.user.role === "treasurer"; }

/* ---------- router ---------- */
function parseHash() {
  const m = (location.hash.replace(/^#\/?/, "") || "dashboard").split("/");
  return [m[0] in ROUTES ? m[0] : "dashboard", decodeURIComponent(m[1] || "") || null];
}
export function nav(route, param = null) {
  const q = route + (param ? "/" + encodeURIComponent(param) : "");
  if (location.hash === "#" + q) render();
  else location.hash = q;
}
let _rendering = false;
async function render() {
  if (_rendering) return; _rendering = true;
  try {
    App.st = await loadState(DB);
    const [route, param] = parseHash();
    App.route = route; App.param = param;
    const R = ROUTES[route];
    const holder = $("#view"); holder.innerHTML = "";
    const root = h("div", { class: "stack" });
    const ctx = {
      root, holder, st: App.st, user: App.user, group: App.st.group, cfg: App.st.cfg,
      nav, refresh: render, param, canEdit: canEdit(), isTreasurer: isTreasurer(),
      /** ทำรายการแก้ไข + audit + reload อัตโนมัติ; บล็อกให้อัตโนมัติถ้าเป็น readonly */
      edit: async (fn, msg = "💾 บันทึกแล้ว") => {
        if (!canEdit()) { toast("🔒 ท่านอยู่ในโหมดอ่านอย่างเดียว — ต้องเป็นเหรัญญิก/เลขานุการ", 2500, true); return; }
        await fn(); if (msg) toast(msg); await render();
      },
    };
    holder.append(h("div", { class: "crumbs" }, R.title), root);
    await R.fn(ctx);
    $$("#tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.route === R.tab));
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    $("#view").innerHTML = `<div class="card"><h3 class="bad">😵 มีข้อผิดพลาด</h3><p class="small muted">${String((e && e.message) || e)}</p></div>`;
  } finally { _rendering = false; }
}

/* ---------- เมนูอื่น ๆ ---------- */
function renderMenu(ctx) {
  const tiles = [
    ["📊", "รายงาน", "PDF · Excel · CSV", "reports"],
    ["🧰", "สวัสดิการ", "ฌาปนกิจ เจ็บป่วย ทุนเรียน", "welfare"],
    ["🎁", "ปันผล 31 ธ.ค.", "คำนวณจ่ายตามหุ้น", "dividend"],
    ["💵", "เคาน์เตอร์ผ่อนวันนี้", "รับผ่อน 1 จอแตะเดียวจบ", "payday"],
    ["🧾", "ตรวจสลิป", "ยืนยันสลิปจริง ปลอม/ถูกแก้", "verify"],
    ["👁️", "ให้สมาชิกดูยอด", "เปิดเครื่องให้ดูรายคน", "public"],
    ["📜", "ตรวจการแก้ไข", "Audit trail", "audit"],
    ["☁️", "สำรอง/ซิงก์", "JSON · GitHub", "backup"],
    ["⚙️", "ตั้งค่ากลุ่ม", "กติกา ค่าปรับ ดอกเบี้ย", "settings"],
    ["🧑", "ผู้ใช้/PIN", "กรรมการ 3 ตำแหน่ง", "users"],
  ];
  const box = h("div", { class: "tiles" });
  for (const [ic, t, s, r] of tiles) box.append(h("button", { class: "tile", onclick: () => ctx.nav(r) },
    h("span", { class: "ic" }, ic), h("span", {}, t), h("span", { class: "sub" }, s)));
  ctx.root.append(h("h2", { style: "margin:2px 0 4px;font-size:1.15rem" }, "📌 " + ctx.group.name), box);
}

/* ---------- สถานะเน็ต + แจ้งเตือน ---------- */
function connUI() {
  const dot = $("#connDot");
  const set = () => { dot.className = "conn-dot " + (navigator.onLine ? "online" : "offline"); };
  set();
  addEventListener("online", () => { set(); toast("🌐 กลับมาออนไลน์แล้ว"); });
  addEventListener("offline", () => { set(); toast("📴 ไม่มีเน็ต — ใช้งานได้ต่อเนื่อง 100%", 3200); });
}
function dueReminders() {
  if (!App.st) return;
  const today = new Date().toISOString().slice(0, 10);
  const alerts = loanAlerts(App.st, today);
  const s = alerts.find((x) => x.flag === "due-soon");
  const o = alerts.find((x) => x.flag === "overdue");
  if (s) toast(`⏰ อีก ${Math.max(1, daysBetween(today, s.nextDue.due))} วัน ${s.loan.name} ต้องผ่อนงวด ${s.nextDue.due}`, 6000);
  if (o && s !== o) toast(`🔕 ${o.loan.name} ค้างผ่อน ${o.overdueMonths} งวด — ยอดคงเหลือ ${o.balance} บาท`, 6000);
}

/* ---------- boot ---------- */
async function boot() {
  try { await DB.openDB(); } catch (e) {
    document.body.innerHTML = "<h2 style='padding:28px;text-align:center'>😕 เบราว์เซอร์นี้ไม่รองรับการเก็บข้อมูล (IndexedDB)<br><small>กรุณาใช้ Chrome บน Android</small></h2>";
    return;
  }
  $$("#tabbar button").forEach((b) => (b.onclick = () => nav(b.dataset.route)));
  $("#btnHome").onclick = () => nav("dashboard");
  connUI();
  await showLogin(async (user) => {
    App.user = user;
    const badge = $("#userBadge");
    badge.textContent = (user.role === "treasurer" ? "💰" : user.role === "secretary" ? "📝" : "🔎") + " " + user.name;
    badge.classList.remove("hidden");
    $("#tabbar").classList.remove("hidden");
    await render();
    setTimeout(dueReminders, 900);
    setInterval(() => { if (!document.hidden && App.st) dueReminders(); }, 10 * 60 * 1000);
  });
  addEventListener("hashchange", () => { const [r] = parseHash(); render(); });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
await boot();
