/* ui-audit.js — ประวัติการแก้ไข: ใคร / แก้ะไร / เมื่อไหร่ + กู้คืน (undo) */
import { h, toast, fmtBaht, modal, confirmBox } from "./util.js";
import { auditList, getDoc, saveDoc, logAudit, byType } from "./db.js";
import { reportButtons } from "./fileio.js";

const ACTION_TH = { create: "➕ เพิ่ม", update: "✏️ แก้", delete: "🗑️ ลบ(soft)", "delete-hard": "❌ ลบจริง", login: "🔑 เข้าสู่ระบบ", import: "📥 นำเข้าข้อมูล", undo: "↩️ กู้คืน", setup: "🏁 ตั้งค่าเริ่มต้น", backup: "☁️ สำรอง" };

export async function renderAudit(ctx) {
  const { st, root } = ctx;
  const list = await auditList(500);
  const flt = { user: "", action: "" };
  const userSel = h("select", { style: "min-height:48px;border:2px solid var(--line);border-radius:12px;background:#fff" },
    h("option", { value: "" }, "👤 ทุกผู้ใช้"), ...[...new Set(list.map((a) => a.actor).filter(Boolean))].map((u) => h("option", { value: u }, u)));
  const actSel = h("select", { style: "min-height:48px;border:2px solid var(--line);border-radius:12px;background:#fff" },
    ...[["", "🧾 ทุกรายการ"], ["create", "➕ เพิ่ม"], ["update", "✏️ แก้"], ["delete", "🗑️ ลบ"], ["login", "🔑 เข้าระบบ"], ["import", "📥 นำเข้า"]].map(([v, t]) => h("option", { value: v }, t)));
  userSel.onchange = paint; actSel.onchange = paint;
  const box = h("div", { class: "list" });
  root.append(h("div", { class: "grid2" }, userSel, actSel),
    h("p", { class: "small muted" }, "แตะรายการเพื่อดู “ก่อนแก้ → หลังแก้” — ระบบไม่มีการลบข้อมูลทิ้ง (Soft Delete)"), box);

  function paint() {
    box.innerHTML = "";
    let rows = list;
    if (userSel.value) rows = rows.filter((a) => a.actor === userSel.value);
    if (actSel.value) rows = rows.filter((a) => (a.action || "").startsWith(actSel.value));
    rows.slice(0, 200).forEach((a) => {
      box.append(h("button", { class: "item", onclick: () => showDetail(a) },
        h("span", { class: "avatar", style: "font-size:1.1rem" }, (ACTION_TH[a.action] || "•").slice(0, 2)),
        h("span", { class: "grow" },
          h("span", { class: "name" }, (ACTION_TH[a.action] || a.action) + " — " + labelOf(a)),
          h("span", { class: "meta" }, a.actor || "?" + " · " + new Date(a.ts).toLocaleString("th-TH"))),
        a.reason ? h("span", { class: "badge b-red", style: "max-width:38%;overflow:hidden;text-overflow:ellipsis" }, a.reason) : ""));
    });
  }
  async function showDetail(a) {
    const c = h("div", { class: "stack" },
      h("p", { class: "small muted" }, new Date(a.ts).toLocaleString("th-TH") + " · " + (a.actor || "-") + " · " + (a.entity || a.type || "-") + " " + (a.refId || "")),
      a.reason ? h("p", {}, "📝 " + a.reason) : "",
      diffView(a),
      a.action !== "login" && a.after ? h("pre", { class: "code" }, JSON.stringify(a.after, null, 1).slice(0, 1500)) : "",
      a.action !== "login" && a.before ? h("pre", { class: "code" }, "ก่อนแก้: " + JSON.stringify(a.before, null, 1).slice(0, 900)) : "");
    const actions = [{ label: "ปิด" }];
    if (ctx.canEdit && a.action === "delete" && a.refId && !String(a.refId).startsWith("-")) {
      actions.push({ label: "↩️ กู้คืนข้อมูลนี้", cls: "btn-green", fn: async () => {
        const yes = await confirmBox("กู้คืนรายการนี้กลับมา? (จะสร้าง Audit ใหม่ว่ามีการ undo)", { okLabel: "↩️ กู้คืน" });
        if (!yes) return;
        await saveDoc(a.entity || a.type, { ...a.before, deletedAt: null, deleteReason: null }, ctx.user?.name, "undo");
        await logAudit({ actor: ctx.user?.name, action: "undo", type: a.entity || a.type, refId: a.refId, after: a.before, reason: "กู้คืนจากรายการ " + a.id });
        toast("↩️ กู้คืนแล้ว — โหลดหน้าใหม่");
        ctx.refresh();
      } });
    }
    modal("🔎 " + labelOf(a), c, actions);
  }
  root.append(reportButtons("ประวัติการแก้ไข", () => ({
    title: "Audit Trail — " + st.group.name, headerCount: 1,
    rows: [["เวลา", "ผู้ใช้", "การกระทำ", "ทำอะไร", "เหตุผล"]].concat(list.slice(0, 800).map((a) => [
      new Date(a.ts).toLocaleString("th-TH"), a.actor || "", ACTION_TH[a.action] || a.action, (a.entity || a.type) + " " + a.refId, a.reason || "",
    ])),
  })));
}
function labelOf(a) {
  const t = a.entity || a.type || "";
  const names = {members: "สมาชิก", txs: "รายการเงิน", loans: "สัญญากู้", settings: "กติกา/ตั้งค่า", users: "ผู้ใช้/PIN", audit: "log", welfares: "สวัสดิการ", shares: "หุ้น"};
  let x = a.after || a.before || {};
  return (names[t] || t) + " " + (x.name ? x.name : x.kind ? kindTh(x.kind) : x.note ? String(x.note).slice(0, 30) : a.refId || "") ;
}
const kindTh = (k) => ({ saja: "สัจจะ", sharebuy: "หุ้น", annualsave: "ออมปี", fine: "ค่าปรับ", welfare_in: "รับสวัสดิการ", welfare_out: "จ่ายสวัสดิการ", loan_out: "จ่ายกู้", loan_repay: "ชำระกู้", dividend_pay: "ปันผล" }[k] || k);
function diffView(a) {
  if (!a.before || !a.after) return "";
  const keys = [...new Set([...Object.keys(a.before), ...Object.keys(a.after)])].filter((k) => JSON.stringify(a.before[k]) !== JSON.stringify(a.after[k]) && !["updatedAt", "deletedAt"].includes(k));
  if (!keys.length) return h("p", { class: "small" }, "(ไม่มีการเปลี่ยนฟิลด์ — อาจเป็นบันทึกกลับ)");
  return h("div", {}, ...keys.slice(0, 12).map((k) => h("p", { class: "small" }, `🔸 ${k}: `, h("b", {}, diffVal(a.before[k])), " → ", h("b", {}, diffVal(a.after[k])))));
}
const diffVal = (v) => { const s = v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v); return s.slice(0, 60); };
