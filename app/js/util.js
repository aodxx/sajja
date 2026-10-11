/* util.js — ตัวช่วยทั่วไป (ไม่มี dependency) */
export const pad2 = (n) => String(n).padStart(2, "0");
export const nowISO = () => new Date().toISOString();
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
export const curYM = () => todayStr().slice(0, 7);
export const genId = (p = "id") =>
  `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

export function fmtBaht(n, decimals = 2) {
  const v = Number(n) || 0;
  return v.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}
export function fmtDate(iso) { // 2569 style
  if (!iso) return "-";
  const d = new Date(iso); if (isNaN(d)) return iso;
  return `${d.getDate()} ${["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."][d.getMonth()]} ${d.getFullYear() + 543}`;
}
export function fmtYM(ym) {
  if (!ym) return "-";
  const [y, m] = ym.split("-").map(Number);
  return `${["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."][m - 1]}/${y + 543}`;
}
const THN = ["ศูนย์","หนึ่ง","สอง","สาม","สี่","ห้า","หก","เจ็ด","แปด","เก้า","สิบ"];
export function thHi(n) { return THN[Number(n)] ?? String(n); }

/** จำนวนเดือนตั้งแต่ YM แรกถึง YM หลัง (inclusive ทั้งสองฝั่ง), 0 ถ้าย้อนหลัง */
export function ymDiff(a, b) {
  const [ay, am] = a.split("-").map(Number), [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}
export function ymAdd(ym, k) {
  let [y, m] = ym.split("-").map(Number); m += k;
  y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${pad2(m)}`;
}
export function ymList(from, to) { const out = []; let c = from; while (ymDiff(c, to) >= 0 && out.length < 600) { out.push(c); c = ymAdd(c, 1); } return out; }
export function monthEndStr(ym) { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); } // วันสุดท้ายของเดือน (UTC-safe)

export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- DOM helpers ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(9)) {
    if (kid === false || kid == null) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/* ---------- toast ---------- */
let toastLimit = 3;
export function toast(msg, ms = 2600, isErr = false) {
  const host = $("#toastHost"); if (!host) return alert(msg);
  const t = h("div", { class: "toast" + (isErr ? " err" : "") }, msg);
  host.append(t);
  while (host.children.length > toastLimit) host.firstChild.remove();
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .4s"; setTimeout(() => t.remove(), 400); }, ms);
}

/* ---------- modal / confirm / prompt ---------- */
export function modal(title, contentEl, actions = []) {
  const host = $("#modalHost"); host.innerHTML = "";
  const bg = h("div", { class: "modal-bg", onclick: (e) => { if (e.target === bg) close(); } });
  const box = h("div", { class: "modal", role: "dialog", "aria-modal": "true" },
    h("h2", {}, title), contentEl,
    h("div", { class: "btn-row", style: "margin-top:16px" },
      ...actions.map((a) =>
        h("button", { class: `btn btn-sm ${a.cls || "btn-ghost"}`, style: "flex:1", onclick: () => { close(); a.fn && a.fn(); } }, a.label))));
  bg.append(box); host.append(bg);
  function close() { bg.remove(); }
  return { close, box };
}
export function confirmBox(msg, { okLabel = "ยืนยัน", danger = false } = {}) {
  return new Promise((res) => {
    const m = modal("ยืนยัน", h("p", {}, msg), [
      { label: "ยกเลิก", fn: () => res(false) },
      { label: okLabel, cls: danger ? "btn-red" : "btn-primary", fn: () => res(true) },
    ]);
  });
}
export function inputBox(title, { label = "", value = "", type = "text", hint = "" } = {}) {
  return new Promise((res) => {
    const inp = h("div", { class: "field" }, h("label", {}, label),
      h("input", { type, value }), hint ? h("span", { class: "hint" }, hint) : null);
    modal(title, inp, [
      { label: "ยกเลิก", fn: () => res(null) },
      { label: "ตกลง", cls: "btn-primary", fn: () => res(inp.querySelector("input").value) },
    ]);
    setTimeout(() => inp.querySelector("input").focus(), 60);
  });
}

/* ---------- download ---------- */
export function downloadBlob(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 800);
}
export function downloadText(filename, text, mime = "application/json;charset=utf-8", bom = false) {
  const body = bom ? "\ufeff" + text : text; // BOM ใช้เฉพาะ CSV/Excel ภาษาไทย
  downloadBlob(filename, new Blob([body], { type: mime }));
}
