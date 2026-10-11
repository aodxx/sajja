/* ui-settings.js — ตั้งค่ากลุ่ม / สำรอง-ซิงก์ / ผู้ใช้-PIN / โหมดแสดงให้สมาชิก */
import { h, toast, fmtBaht, inputBox, confirmBox, curYM, fmtYM, todayStr, downloadText, modal } from "./util.js";
import { saveDoc, getDoc, kvGet, kvSet, allDocs, wipeAll } from "./db.js";
import { makePinRecord } from "./crypto.js";
import { DEFAULT_CFG, memberTotals, sajaHistory, loanState, welfareFund, eligibility } from "./calc.js";
import { exportJSON, importFile, filePicker } from "./fileio.js";
import * as sync from "./sync.js";
import { tbl } from "./ui-members.js";

/* ================== ตั้งค่ากลุ่ม ================== */
const FIELDS = [
  ["groupName", "🏘️ ชื่อกลุ่ม", "text"],
  ["village", "ชื่อหมู่บ้าน / ตำบล", "text"],
  ["sajaMonthly", "เงินสัจจะมาตรฐาน (฿/เดือน)", "number"],
  ["sajaDueDay", "ส่งไม่เกินวันที่ของเดือน", "number"],
  ["sharePrice", "ราคาหุ้น (฿/หุ้น)", "number"],
  ["annualTarget", "เงินออมรายปี (฿/คน/ปี)", "number"],
  ["lateFine", "ค่าปรับขาดส่ง (฿/เดือนที่ขาด)", "number"],
  ["loanMinMonthsSaved", "ต้องออมครบกี่เดือนถึงกู้ได้", "number"],
  ["loanBaseLimit", "วงเงินกู้เริ่มต้น (฿/บัญชี)", "number"],
  ["loanFeePct", "ค่าบำรุงเงินกู้ (%/เดือน flat)", "number"],
  ["loanMaxMonths", "ผ่อนได้ไม่เกินกี่งวด", "number"],
  ["guarantorsMin", "ผู้ค้ำประกันอย่างน้อย (คน)", "number"],
  ["sickNightPay", "ค่าเสียโอกาสเจ็บป่วย (฿/คืน)", "number"],
  ["sickMaxNightsYear", "ไม่เกินกี่คืน/ปี", "number"],
  ["dividendPctOfProfit", "ปันผล = กำไรสุทธิ × (%)", "number"],
  ["openingCash", "เงินสดคงเหลือยกมาตอนเริ่มใช้ระบบ (฿)", "number"],
];

export async function renderSettings(ctx) {
  const { st, root } = ctx;
  const vals = { groupName: st.group.name || "", village: st.group.village || "", ...st.cfg };
  const box = h("div", { class: "card" });
  const inputs = {};
  FIELDS.forEach(([key, label, type]) => {
    const inp = h("input", { type, value: String(vals[key] ?? ""), inputmode: type === "number" ? "decimal" : "text" });
    inputs[key] = inp;
    box.append(h("div", { class: "field" }, h("label", {}, label), inp,
      type === "number" ? h("span", { class: "hint" }, "ค่ามาตรฐานระบบ: " + DEFAULT_CFG[key]) : null));
  });
  root.append(h("div", { class: "note" }, ctx.canEdit ? "⛔ แก้กติกาได้เฉพาะเหรัญญิก/เลขานุการ · ทุกการแก้บันทึกใน Audit" : "🔒 โหมดดูอย่างเดียว — ผู้ตรวจสอบแก้ไขไม่ได้"), box);

  if (ctx.canEdit) {
    root.append(h("button", { class: "btn btn-primary", onclick: save }, "💾 บันทึกรกกติกาทั้งหมด"));
    async function save() {
      const cfgv = {};
      for (const [key, , type] of FIELDS) {
        const raw = inputs[key].value.trim();
        if (key === "groupName") { cfgv.__group = cfgv.__group || {}; cfgv.__group.name = raw || "กลุ่มออมทรัพย์"; continue; }
        if (key === "village") { cfgv.__group = cfgv.__group || {}; cfgv.__group.village = raw; continue; }
        cfgv[key] = type === "number" ? (raw === "" ? DEFAULT_CFG[key] : Number(raw)) : raw;
      }
      const { __group, ...cfgOnly } = cfgv;
      await ctx.edit(async () => {
        await saveDoc("settings", { id: "group", v: { name: __group.name, village: __group.village } }, ctx.user?.name, "update");
        await saveDoc("settings", { id: "cfg", v: cfgOnly }, ctx.user?.name, "update");
      }, "⚙️ บันทึกกติกาใหม่แล้ว");
    }
  }

  root.append(h("div", { class: "section-title" }, "🧰 เครื่องมือผู้ดูแล"));
  const tools = h("div", { class: "btn-row" },
    h("button", { class: "btn btn-ghost", onclick: checkMath }, "🧮 ตรวจความถูกต้องบัญชี"),
    ctx.isTreasurer ? h("button", { class: "btn btn-red", onclick: wipe }, "🧹 ล้างทั้งหมด (เริ่มใหม่)") : null);
  root.append(tools, h("p", { class: "small muted" }, "แอปเวอร์ชัน 1.0.0 · ข้อมูลอยู่ในเครื่องคุณ (IndexedDB) · offine 100% ได้"));

  async function checkMath() {
    const b = (await import("./calc.js")).balanceSheet(st);
    const w = welfareFund(st);
    const sv = st.members.reduce((s, m) => s + memberTotals(st, m).savings, 0);
    modal("🧮 สรุปตรวจยอด", h("div", { class: "stack" },
      tbl([["รายการ", "จำนวน (฿)"],
        ["ทรัพย์สิน: เงินสด+ bank (ระบบคำนวณ)", b.assets["เงินคงเหลือ (เงินสด/ธนาคาร)"].toLocaleString()],
        ["ทรัพย์สิน: เงินให้กู้ยืมคงเหลือ", Math.round(b.assets["เงินให้กู้ยืมคงเหลือ"]).toLocaleString()],
        ["ทรัพย์สินรวม", b.assets.total.toLocaleString()],
        ["หนี้สิน: เงินออมสมาชิกสะสม", Math.round(sv).toLocaleString()],
        ["กองทุนสวัสดิการ", Math.round(w.balance).toLocaleString()],
        ["กำไรสะสม/เงินทุน", Math.round(b.liabilities["กำไรสะสม/เงินกองทุน"]).toLocaleString()],
        ["รวม", b.liabilities.total.toLocaleString()]]),
      h("p", { class: b.balanced ? "ok" : "bad" }, b.balanced ? "✅ สมการบัญชีตรงกัน (ผ่าน)"
        : "⚠️ สองข้างไม่เท่ากัน — เช็ก: (1) ฝอยนับเงินจริง vs “เงินสด(ระบบคำนวณ)” (2) เปิดเงินสดยกมา (openingCash) ถูกไหม (3) มีรายการที่ลืมบันทึกหรือไม่"),
      [{ label: "ปิด" }]));
  }
  async function wipe() {
    const yes = await confirmBox("⚠️ จะล้างข้อมูลทุกตารางในเครื่องนี้ (สมาชิก ธุรกรรม กู้ audit) — ใช้ตอนทดลองเท่านั้น\nถ้ายืนยัน: Export เก็บไว้ก่อนจะปลอดภัยกว่า", { okLabel: "ล้างทั้งหมด", danger: true });
    if (!yes) return;
    const code = await inputBox("พิมพ์คำว่า “ล้าง” เพื่อครั้งสุดท้าย", { label: "คำยืนยัน" });
    if ((code || "").trim() !== "ล้าง") return toast("ยกเลิกแล้ว 🙂", 1800);
    await wipeAll();
    toast("🧹 ล้างแล้ว — กำลังโหลดใหม่");
    setTimeout(() => location.reload(), 700);
  }
}

/* ================== สำรอง / ซิงก์ ================== */
export async function renderBackup(ctx) {
  const { st, root } = ctx;
  const cacheAt = await kvGet("exportCacheAt");
  const scfg = await sync.getSyncCfg();

  root.append(h("div", { class: "card" },
    h("h3", {}, "🗓️ สำเนาภายในเครื่องล่าสุด"),
    h("p", {}, cacheAt ? new Date(cacheAt).toLocaleString("th-TH") : "— ยังไม่มี —"),
    h("button", { class: "btn btn-ghost", style: "margin-top:8px", onclick: makeCacheNow }, "🔄 ทำสำเนาด่วนในเครื่อง")));

  /* วิธี 1: ไฟล์ → ลากวาง GitHub (ไม่ต้องใช้ token) */
  const encChk = h("input", { type: "checkbox", checked: true });
  const passBox = h("input", { type: "password", placeholder: "รหัสผ่าน ≥ 8 ตัว (ถ้าตั้ง: ไฟล์จะเข้ารหัส AES — ลืมรหัส = กู้ไม่ได้!)" });
  root.append(h("div", { class: "card" },
    h("h2", {}, "☁️ วิธีที่ 1 — ส่งขึ้น GitHub (แนะนำ)"),
    h("ol", { class: "small", style: "margin:4px 0 10px 20px" },
      h("li", {}, "กดปุ่มล่าง → ได้ไฟล์ 1 ไฟล์"),
      h("li", {}, "เปิด repo กลุ่ม → โฟลเดอร์ data → Add file → Upload files → ลากไฟล์วาง → Commit"),
      h("li", {}, "เสร็จ! Actions จะตรวจความถูกต้อง + เก็บประวัติให้เอง (ดูที่แท็บ Actions)")),
    h("label", { style: "display:flex;gap:10px;align-items:center;min-height:44px" }, encChk, " 🔒 เข้ารหัสก่อนเก็บ (แนะนำ)"),
    passBox,
    h("button", { class: "btn btn-primary", style: "margin-top:8px", onclick: dropFile }, "📤 สร้างไฟล์สำรอง (ดาวน์โหลด)")));

  /* วิธี 2: ไฟล์มือต่อมือ */
  root.append(h("div", { class: "card" },
    h("h2", {}, "📦 วิธีที่ 2 — Export/Import ผ่าน LINE/SD"),
    h("div", { class: "btn-row" },
      h("button", { class: "btn btn-outline", onclick: () => exp(false) }, "📤 Export ธรรมดา"),
      h("button", { class: "btn btn-outline", onclick: () => exp(true) }, "🔐 Export + รหัส")),
    h("button", { class: "btn btn-ghost", style: "margin-top:10px", onclick: chooseImport }, "📥 Import ไฟล์ (ย้ายเครื่อง/รับจากเครื่องอื่น)"),
    h("p", { class: "small muted" }, "โหมด “รวม(merge)” = เติมรายการใหม่ ไม่ทับของใหม่กว่า → ปลอดภัยเมื่อ 2 เครื่องบันทึกแยกกัน")));

  /* วิธี 3: sync อัตโนมัติ (ขั้นสูง) */
  const adv = h("details", { class: "card" }, h("summary", { style: "font-weight:700" }, "🧠 วิธีที่ 3 — ซิงก์อัตโนมัติด้วย Token (ขั้นสูง)"));
  const en = h("input", { type: "checkbox", checked: scfg.enabled });
  const fOwner = h("input", { placeholder: "owner (ชื่อ GitHub)", value: scfg.owner });
  const fRepo = h("input", { placeholder: "repo เช่น sajjja-data", value: scfg.repo });
  const fPath = h("input", { placeholder: "data/current.json", value: scfg.path });
  const fToken = h("input", { type: "password", placeholder: "github_pat_… Fine-grained repo เดียว Contents:RW อายุ ≤90 วัน", value: scfg.token });
  const fPass = h("input", { type: "password", placeholder: "passphrase เข้ารหัสไฟล์บน repo", value: scfg.pass });
  const stat = h("p", { class: "small" }, scfg.enabled ? "🟢 เปิด — push ล่าสุด " + (scfg.lastPush || "-") + " · pull ล่าสุด " + (scfg.lastPull || "-") : "🔴 ปิดอยู่ (โหมดปลอดภัยเริ่มต้น)");
  adv.append(
    h("div", { class: "note", style: "margin:10px 0" },
      "⚠️ Token = กุญแจห้องเอกสาร ถ้าเครื่องหายคนเอามือถืออาจอ่าน/ทับ/ลบข้อมูลกลุ่มได้ (ถึงไฟล์จะเข้ารหัส สิทธิ์เขียนยังลบได้) " +
      "ข้อปฏิบัติ: ใช้เฉพาะเครื่องเหรัญญิก · Fine-grained จำกัด repo data เท่านั้น ไม่มี admin · หมดอายุ 90 วัน · repo ต้อง Private · ตั้ง calendar เปลี่ยน token · เมื่อเปลี่ยนกรรมการ revoke ทันที"),
    h("div", { class: "stack" },
      h("label", { style: "display:flex;gap:10px" }, en, " เปิดโหมดอัติโนมัติ"),
      fOwner, fRepo, fPath, fToken, fPass, stat,
      h("div", { class: "btn-row" },
        h("button", { class: "btn btn-sm btn-ghost", onclick: testConn }, "🔌 ทดสอบ"),
        h("button", { class: "btn btn-sm btn-green", onclick: doPush }, "⬆️ Push"),
        h("button", { class: "btn btn-sm btn-outline", onclick: doPull }, "⬇️ Pull+รวม"))));
  root.append(adv);

  root.append(h("div", { class: "card" },
    h("h3", {}, "🛡️ จังหวะสำรองที่แนะนำ"),
    h("ul", { class: "small", style: "margin:6px 0 0 18px" },
      h("li", {}, "หลังประชุมทุกเดือน: วิธี 1 (ขึ้น GitHub) — ผู้ตรวจสอบกดดู Actions ผ่าน ✅"),
      h("li", {}, "ทุก 3 เดือน: วิธี 2 Export เข้ารหัส 1 copies ให้ผู้ตรวจสอบเก็บนอกบ้าน"),
      h("li", {}, "อย่าวางไฟล์ unencrypted ใน Google Drive สาธารณะ/LINE group ใหญ่")),
    ctx.canEdit ? h("button", { class: "btn btn-ghost btn-sm", style: "margin-top:10px", onclick: markDone }, "✅ บันทึกว่า “สำรองวันนี้แล้ว”ลงใน audit") : null));

  async function testConn() {
    const c = await saveCfg();
    try { const r = await sync.testConnection(c); toast("✅ หา repo เจอ: " + r.name + (r.private ? " (Private ✅)" : " — ⚠️ เป็น Public!")); }
    catch (e) { toast("❌ " + e.message, 5000, true); }
  }
  async function doPush() {
    const c = await saveCfg();
    if (!c.enabled) return toast("กดเปิด “โหมดอัตโนมัติ” ก่อน", 2500, true);
    if (!c.encrypt && !confirm("ไม่เข้ารหัส = ข้อมูลโผล่บน GitHub ตรง ๆ มั่นใจ? (repo ต้อง private)")) return;
    try { await sync.push(c); stat.textContent = "🟢 push เมื่อ " + new Date().toLocaleString("th-TH"); await ctx.edit(() => {}, ""); }
    catch (e) { toast("❌ " + e.message, 5500, true); }
  }
  async function doPull() {
    const c = await saveCfg();
    if (!c.enabled) return toast("กดเปิด “โหมดอัตโนมัติ” ก่อน", 2500, true);
    try { const r = await sync.pull(c); await ctx.edit(() => {}, `⬇️ ดึงข้อมูลแล้ว: เพิ่ม ${r.added} ใหม่ ${r.updated} (ข้อมูลเครื่องใหม่กว่าจะคงอยู่)`); }
    catch (e) { toast("❌ " + e.message, 5500, true); }
  }
  async function saveCfg() {
    await sync.saveSyncCfg({ ...scfg, enabled: en.checked, owner: fOwner.value.trim(), repo: fRepo.value.trim(), path: fPath.value.trim() || "data/current.json", token: fToken.value.trim() || scfg.token, pass: fPass.value || scfg.pass });
    return await sync.getSyncCfg();
  }
  async function dropFile() {
    const useEnc = encChk.checked;
    if (useEnc && (passBox.value || "").length < 8) return toast("ตั้งรหัสผ่าน ≥ 8 ตัวก่อน หรือถอดถูก “เข้ารหัส” ออก", 3500, true);
    const c = await saveCfg();
    const { text } = await sync.githubDropFile({ ...c, encrypt: false }); // ป้องกันเข้ารหัสสองชั้น
    const name = "current.json";
    if (useEnc) {
      const { encryptSnapshot } = await import("./crypto.js");
      downloadText("current-" + todayStr() + ".enc.json", await encryptSnapshot(text, passBox.value || c.pass));
    } else downloadText("current-" + todayStr() + ".json", text);
    toast("📁 ได้ไฟล์แล้ว — ลากวางลง data/ ใน repo ได้เลย");
  }
  async function exp(enc) {
    if (enc) {
      const p1 = await inputBox("🔐 ตั้งรหัสผ่านสำรอง", { label: "อย่าลืมรหัส — ลืมคือเปิดไม่ได้", type: "password" });
      if (!p1 || p1.length < 8) return toast("รหัสต้อง ≥ 8 ตัว", 2400, true);
      const p2 = await inputBox("ยืนยันรหัส", { type: "password" });
      if (p1 !== p2) return toast("ยืนยันไม่ตรงกัน", 2200, true);
      await exportJSON({ encrypt: true, pass: p1 });
      await ctx.edit(() => kvSet("lastExport", new Date().toISOString()), "");
    } else { await exportJSON({}); await kvSet("lastExport", new Date().toISOString()); }
  }
  async function chooseImport() {
    const f = await filePicker(); if (!f) return;
    const yesMerge = await confirmBox("“รวม” = เติมรายการใหม่จากไฟล์ ไม่ทับข้อมูลที่เครื่องคุณใหม่กว่า (ใช้บ่อยตอนซิงก์ข้ามเครื่อง)\n\nกดยืนยัน = รวมข้อมูล — ถ้าต้องการ “แทนที่ทั้งหมด” ให้กด “ลบ...” ด้านล่าง(เสี่ยง)", { okLabel: "🪄 รวม(merge)" });
    if (!yesMerge) return;
    const r = await importFile(f, ctx.user?.name, "merge");
    if (r) { toast("📥 เสร็จ: เพิ่ม " + r.added + " ใหม่ " + r.updated + " (ข้าม " + r.skipped + ")"); ctx.refresh(); }
  }
  async function markDone() {
    await ctx.edit(async () => {
      const { logAudit } = await import("./db.js");
      await logAudit({ actor: ctx.user?.name, action: "backup", type: "backup", refId: "-", reason: "สำรองขึ้น GitHub/เก็บนอกเครื่อง วันนี้แล้ว" });
    }, "✅ บันทึกการสำรองวันนี้แล้ว");
  }
}
async function makeCacheNow() {
  const s = await allDocs();
  await kvSet("exportCache", s); await kvSet("exportCacheAt", new Date().toISOString());
  toast("🔄 ทำสำเนาฉุกเฉินในเครื่องแล้ว");
}

/* ================== ผู้ใช้ / PIN ================== */
export async function renderUsers(ctx) {
  const { st, root } = ctx;
  const ROLE = { treasurer: "💰 เหรัญญิก (สิทธิ์เต็ม)", secretary: "📝 เลขานุการ (บันทึก แก้ไข)", auditor: "🔎 ผู้ตรวจสอบ (ดูอย่างเดียว)" };
  const list = h("div", { class: "list" });
  st.users.forEach((u) => {
    list.append(h("div", { class: "item" },
      h("span", { class: "avatar" }, (ROLE[u.role] || "🧑").slice(0, 2)),
      h("span", { class: "grow" }, h("span", { class: "name" }, u.name), h("span", { class: "meta" }, (ROLE[u.role] || u.role) + (u.active === false ? " · 🔴ระงับ" : ""))),
      ctx.isTreasurer ? h("button", { class: "btn btn-sm btn-outline", style: "margin-left:6px", onclick: () => changePin(u) }, "🔁 PIN") : "",
      ctx.isTreasurer && (u.role === "secretary" || u.role === "auditor") ? h("button", { class: "btn btn-sm btn-ghost", style: "margin-left:6px", onclick: () => toggle(u) }, u.active === false ? "เปิด" : "ระงับ") : ""));
  });
  root.append(list);
  if (ctx.isTreasurer) {
    root.append(h("button", { class: "btn btn-primary", style: "margin-top:10px", onclick: addUser }, "➕ เพิ่มผู้ใช้/PIN"));
    root.append(h("p", { class: "small muted", style: "margin-top:10px" }, "บทบาท: เหรัญญิกควรมี คนเดียว (คุม GitHub token) · เลขานุการบันทึกสมาชิก/กู้ · ผู้ตรวจสอบ ดูรายงาน+audit อย่างเดียว · PIN ผิด 4 ครั้ง = ล็อกหน้าจอ")) ;
  }
  async function changePin(u) {
    const p1 = await inputBox("🔁 PIN ใหม่ — " + u.name, { label: "ตัวเลข 4 หลัก", type: "password" });
    if (!p1) return; if (!/^\d{4}$/.test(p1)) return toast("ต้องตัวเลข 4 หลัก", 2200, true);
    const p2 = await inputBox("", { label: "พิมพ์ซ้ำ", type: "password" });
    if (p1 !== p2) return toast("ไม่ตรงกัน", 2200, true);
    await ctx.edit(async () => {
      const cur = await getDoc("users", u.id);
      await saveDoc("users", { ...cur, pin: await makePinRecord(p1) }, ctx.user?.name, "update");
    }, "🔁 เปลี่ยน PIN ให้ " + u.name + " แล้ว");
  }
  async function toggle(u) {
    await ctx.edit(async () => saveDoc("users", { ...u, active: u.active === false }, ctx.user?.name, "update"), u.active === false ? "เปิดใช้แล้ว" : "🔴 ระงับแล้ว (login ไม่ได้ แต่ประวัติ audit ยังครบ)");
  }
  async function addUser() {
    const name = await inputBox("➕ ชื่อเล่น/ชื่อจริง ผู้ใช้ใหม่", { label: "ชื่อที่แสดงในแอป" });
    if (!name) return;
    const roleRaw = await inputBox("เลือกตำแหน่ง", { label: "พิมพ์ 1 = เลขานุการ · 2 = ผู้ตรวจสอบ (เหรัญญิกมีคนเดียวแล้ว)", value: "2" });
    const role = { 1: "secretary", 2: "auditor" }[Number(roleRaw)] || "auditor";
    const p1 = await inputBox("PIN 4 หลักให้ " + name, { type: "password" });
    if (!p1 || !/^\d{4}$/.test(p1)) return toast("PIN ต้องเป็นตัวเลข 4 หลัก", 2500, true);
    const p2 = await inputBox("", { label: "พิมพ์ซ้ำ", type: "password" });
    if (p1 !== p2) return toast("ไม่ตรงกัน", 2200, true);
    const rec = await makePinRecord(p1);
    await ctx.edit(() => saveDoc("users", { id: "u" + Date.now().toString(36), name: name.trim(), role, active: true, pin: rec },
      ctx.user?.name, "create"), "✅ เพิ่ม " + name + " (" + role + ") แล้ว");
  }
}

/* ============ โหมดแสดงให้สมาชิกดู (เหรัญญิกถือเครื่อง) ============ */
export async function renderPublic(ctx) {
  const { st, root } = ctx;
  root.append(h("div", { class: "note" }, "👁️ ยื่นมือถือให้สมาชิกแตะชื่อตัวเอง — เห็นเฉพาะของคนนี้ ไม่ต้องกลัวข้อมูลปน"));
  const wrap = h("div", { class: "stack" });
  root.append(wrap);
  drawList();

  function drawList() {
    wrap.innerHTML = "";
    const list = h("div", { class: "list" });
    st.members.filter((m) => m.status !== "resigned").forEach((m) => list.append(h("button", { class: "item", onclick: () => show(m) },
      h("span", { class: "avatar" }, m.name.slice(0, 1)),
      h("span", { class: "grow" }, h("span", { class: "name" }, m.name), h("span", { class: "meta" }, "กดเพื่อดูยอดของคุณ")),
      h("span", { class: "muted" }, "›"))));
    wrap.append(list);
  }
  async function show(m) {
    wrap.innerHTML = "";
    const t = memberTotals(st, m);
    const loans = st.loans.filter((l) => l.member === m.id && l.status !== "void");
    const thisYM = curYM();
    const sMonth = sajaHistory(st, m).find((x) => x.ym === thisYM);
    const e = (await eligibilityAsync(st, m));
    wrap.append(
      h("div", { class: "hero" },
        h("div", { class: "small", style: "opacity:.85" }, "👤 " + m.name),
        h("div", { class: "amount" }, fmtBaht(t.savings) + " ฿"),
        h("div", { class: "small", style: "opacity:.85" }, "เงินออมทั้งหมดของคุณ (สัจจะ+หุ้น+รายปี)")),
      h("div", { class: "stat-grid" },
        h("div", { class: "stat" }, h("div", { class: "num" }, fmtBaht(t.saja)), h("div", { class: "lbl" }, "สัจจะสะสม")),
        h("div", { class: "stat" }, h("div", { class: "num" }, t.sharesN + " หุ้น"), h("div", { class: "lbl" }, "หุ้น = " + fmtBaht(t.shares) + "฿")),
        h("div", { class: "stat" }, h("div", { class: "num" }, fmtBaht(t.annual)), h("div", { class: "lbl" }, "ออมรายปี")),
        h("div", { class: "stat" }, h("div", { class: "num" }, loans.filter((l) => l.status === "active").reduce((s, l) => s + loanState(st, l).balance, 0).toFixed(0)), h("div", { class: "lbl" }, "หนี้กู้คงเหลือ ฿"))),
      h("div", { class: "card" }, h("h3", {}, "เดือนนี้ " + fmtYM(thisYM)),
        h("p", { class: sMonth && sMonth.status === "sent" ? "ok" : "bad", style: "font-size:1.2rem" },
          sMonth && sMonth.status === "sent" ? "✅ ส่งแล้ว " + fmtBaht(sMonth.amount) + " ฿"
            : "⏳ ยังไม่ส่ง — " + fmtBaht(Number(m.monthly) || st.cfg.sajaMonthly) + " ฿ (แจ้งเหรัญญิกได้เลย)")),
      loans.length ? h("div", { class: "list" }, loans.map((l) => {
        const s = loanState(st, l);
        return h("div", { class: "item" }, h("span", { class: "avatar" }, "📄"),
          h("span", { class: "grow" }, h("span", { class: "name" }, l.id + " " + l.purposeTh), h("span", { class: "meta" }, "งวดถัด " + (s.nextDue ? s.nextDue.due : "-") + (s.overdueMonths ? " · ค้าง " + s.overdueMonths + " งวด" : ""))),
          h("span", { class: "right" }, fmtBaht(s.balance) + "฿"));
      })) : null,
      h("div", { class: "card" }, h("h3", {}, "🎯 สิทธิ์กู้ยืมของคุณ"),
        h("p", { class: e.can ? "ok" : "bad" }, e.can ? "กู้ได้แล้ว! วงเงินเริ่มต้น " + fmtBaht(e.limit) + "฿ (ออมครบ " + e.monthsSaved + " เดือน)" : "อีกนิด: " + e.bad.join(" · "))),
      h("button", { class: "btn btn-primary", style: "margin-top:8px", onclick: drawList }, "← กลับ (เลือกคนต่อไป)"));
  }
}
async function eligibilityAsync(st, m) {
  const db = await import("./db.js");
  const { loadState } = await import("./calc.js");
  return eligibility(await loadState(db), m);
}
