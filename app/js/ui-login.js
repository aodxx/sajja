/* ui-login.js — เลือกผู้ใช้ + PIN 4 หลัก; ครั้งแรก = ตั้งค่ากลุ่ม */
import { h, $, toast, fmtDate } from "./util.js";
import { byType, saveDoc, logAudit, kvGet, kvSet } from "./db.js";
import { makePinRecord, verifyPin } from "./crypto.js";

const ROLE_TH = { treasurer: "เหรัญญิก", secretary: "เลขานุการ", auditor: "ผู้ตรวจสอบ" };
export { ROLE_TH };

export async function showLogin(onDone) {
  const users = (await byType("users")).filter((u) => !u.deletedAt && u.active !== false);
  const screen = $("#loginScreen");
  screen.classList.remove("hidden");
  const card = screen.querySelector(".login-card");
  card.innerHTML = "";

  if (!users.length) return showSetup(card, onDone);

  card.append(h("div", { class: "login-logo" }, "🛡️"), h("h1", {}, "ใครกำลังใช้เครื่อง?"),
    h("p", { class: "muted small" }, "เลือกชื่อ แล้วใส่รหัส PIN 4 หลัก"));
  const grid = h("div", { class: "user-grid" });
  for (const u of users) {
    grid.append(h("button", { class: "user-pick", onclick: () => askPin(u).then((ok) => { if (ok) finish(u, onDone, screen); }) },
      h("span", { class: "ic" }, u.role === "treasurer" ? "💰" : u.role === "secretary" ? "📝" : "🔎"),
      h("span", {}, u.name), h("span", { class: "small muted" }, ROLE_TH[u.role] || u.role)));
  }
  card.append(grid);
}

async function askPin(user) {
  return new Promise((res) => {
    const screen = $("#loginScreen");
    const card = screen.querySelector(".login-card");
    card.innerHTML = "";
    card.append(h("div", { class: "login-logo" }, "🔑"), h("h1", {}, "ใส่รหัส PIN"),
      h("p", { class: "muted", id: "loginUser" }, user.name + " · " + (ROLE_TH[user.role] || "")));
    const dots = h("div", { class: "pin-dots" }, h("i", {}), h("i", {}), h("i", {}), h("i", {}));
    card.append(dots);
    let pin = "";
    const tries = { n: 0 };
    const pad = h("div", { class: "keypad" });
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"].forEach((k) => {
      const b = h("button", { class: k === "⌫" || k === "✓" ? "fn" : "" }, k);
      b.onclick = () => press(k, b);
      pad.append(b);
    });
    card.append(pad, h("button", { class: "link-btn", id: "btnBackToUsers" }, "← เลือกผู้ใช้ใหม่"));
    card.querySelector("#btnBackToUsers").onclick = () => showLogin(() => {});
    function press(k) {
      if (k === "⌫") pin = pin.slice(0, -1);
      else if (k === "✓") { check(); return; }
      else if (pin.length < 4) pin += k;
      [...dots.children].forEach((d, i) => d.classList.toggle("on", i < pin.length));
      if (pin.length === 4) setTimeout(check, 120);
    }
    async function check() {
      if (pin.length !== 4) return;
      const ok = await verifyPin(pin, user.pin);
      if (!ok) {
        tries.n++; pin = "";
        [...dots.children].forEach((d) => d.classList.remove("on"));
        dots.animate([{ transform: "translateX(0)" }, { transform: "translateX(-8px)" }, { transform: "translateX(8px)" }, { transform: "translateX(0)" }], { duration: 250 });
        toast("PIN ไม่ถูกต้อง ❌" + (tries.n >= 3 ? " — ลองใหม่ค่อย ๆ นะ" : ""), 2200, true);
        if (tries.n >= 6) { toast("ใส่ผิดหลายครั้ง — รอสักครู่", 3000, true); setTimeout(() => showLogin(() => {}), 1500); }
        return;
      }
      res(true);
    }
  });
}

function finish(user, onDone, screen) {
  kvSet("lastUser", user.id);
  logAudit({ actor: user.name, action: "login", type: "session", refId: user.id });
  screen.classList.add("hidden");
  onDone(user);
}

/* ---------- ครั้งแรก: ตั้งค่ากลุ่ม + ผู้ดูแล ---------- */
function showSetup(card, onDone) {
  card.innerHTML = "";
  card.append(h("div", { class: "login-logo" }, "🏘️"), h("h1", {}, "ยินดีต้อนรับ! ตั้งค่าครั้งแรก"),
    h("p", { class: "muted small" }, "กรอกข้อมูลกลุ่ม และตั้งชื่อ/PIN ของเหรัญญิก (จำ PIN ให้ดี — หายต้องรีเซ็ตใหม่)"));
  const fName = h("input", { placeholder: "ชื่อกลุ่ม เช่น กลุ่มออมทรัพย์บ้านใหม่", value: "กลุ่มออมทรัพย์" });
  const fVil = h("input", { placeholder: "หมู่บ้าน / ตำบล" });
  const fUser = h("input", { placeholder: "ชื่อผู้ใช้งาน (เหรัญญิก)" });
  const fPin = h("input", { placeholder: "PIN 4 หลัก", inputmode: "numeric", maxlength: 4, type: "password" });
  const fPin2 = h("input", { placeholder: "ยืนยัน PIN", inputmode: "numeric", maxlength: 4, type: "password" });
  const btn = h("button", { class: "btn btn-primary", style: "margin-top:10px" }, "✅ เริ่มใช้งาน");
  btn.onclick = async () => {
    if (!fUser.value.trim()) return toast("ใส่ชื่อผู้ใช้ก่อน", 2200, true);
    if (!/^\d{4}$/.test(fPin.value)) return toast("PIN ต้องเป็นตัวเลข 4 หลัก", 2200, true);
    if (fPin.value !== fPin2.value) return toast("PIN ยืนยันไม่ตรงกัน", 2200, true);
    await saveDoc("settings", { id: "group", v: { name: fName.value.trim() || "กลุ่มออมทรัพย์", village: fVil.value.trim() } }, fUser.value.trim(), "setup");
    await saveDoc("users", { id: "treasurer", name: fUser.value.trim(), role: "treasurer", active: true, pin: await makePinRecord(fPin.value) }, "setup", "create");
    const u = (await byType("users"))[0];
    toast("🎉 ตั้งค่าเรียบร้อย — ยินดีด้วย!");
    $("#loginScreen").classList.add("hidden");
    onDone(u);
  };
  const wrap = (label, input) => h("div", { class: "field" }, h("label", {}, label), input);
  card.append(h("div", { class: "stack", style: "text-align:left;margin-top:14px" },
    wrap("ชื่อกลุ่ม", fName), wrap("หมู่บ้าน/ตำบล", fVil), wrap("ชื่อผู้ใช้", fUser), wrap("ตั้ง PIN 4 หลัก", fPin), wrap("ยืนยัน PIN", fPin2)), btn);
}
