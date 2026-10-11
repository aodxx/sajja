/* fileio.js — Export/Import ข้อมูล + Excel/CSV/PDF(print) */
import { byType, COLLECTIONS, cachedExport } from "./db.js";
import { downloadText, downloadBlob, todayStr, fmtBaht, toast, modal, h, confirmBox } from "./util.js";
import { encryptSnapshot, openMaybeEncrypted } from "./crypto.js";
import { mergeSnapshot } from "./db.js";

export async function exportFilename(prefix = "sajja-backup") {
  return `${prefix}-${todayStr()}`;
}

/* ---------- JSON ---------- */
export async function exportJSON({ encrypt = false, pass = "", prefix = "sajja-backup" } = {}) {
  const snap = await cachedExport();
  snap.appVersion = "1.0.0";
  const text = JSON.stringify(snap, encrypt ? 0 : 1);
  let filename = await exportFilename(prefix);
  let blobText = text;
  if (encrypt) { blobText = await encryptSnapshot(text, pass); filename += ".enc.json"; }
  else filename += ".json";
  downloadText(filename, blobText);
  toast("📦 ดาวน์โหลดไฟล์สำรองแล้ว " + filename);
  return { filename, text: blobText };
}

/* ---------- Import ---------- */
export async function importFile(file, actor, mode) {
  let text;
  try { text = await openMaybeEncrypted(file); } catch (e) { toast("เปิดไฟล์ไม่สำเร็จ: " + e.message, 4000, true); return null; }
  if (!text) return null; // user cancel
  let snap;
  try { snap = JSON.parse(text); }
  catch { toast("ไฟล์นี้ไม่ใช่ JSON ที่ถูกต้อง ❌", 4000, true); return null; }
  try {
    const r = await mergeSnapshot(snap, actor, mode);
    toast(`✅ นำเข้าสำเร็จ: เพิ่ม ${r.added} · แก้ ${r.updated} · ข้าม(ใหม่กว่า) ${r.skipped}`);
    return r;
  } catch (e) { toast(e.message, 5000, true); return null; }
}
export function filePicker() {
  return new Promise((res) => {
    const inp = h("input", { type: "file", accept: ".json,.enc.json,application/json" });
    inp.onchange = () => res(inp.files[0] || null);
    inp.click();
  });
}

/* ---------- CSV (มี BOM เปิดใน Excel ภาษาไทยไม่เพี้ยน) ---------- */
export function toCSV(rows) {
  return rows.map((r) => r.map((c) => {
    const s = String(c ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(",")).join("\r\n");
}
export const exportCSV = (name, rows) => downloadText(name + ".csv", toCSV(rows), "text/csv;charset=utf-8", true);

/* ---------- XLSX (ต้องใช้ SheetJS — โหลดครั้งแรกแล้วแคชไว้ในเครื่อง) ---------- */
let _xlsxPromise = null;
export function ensureXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!_xlsxPromise) {
    _xlsxPromise = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "vendor/xlsx.full.min.js";
      s.onload = () => {
        if (!navigator.onLine) toast("ℹ️ โหลดครั้งแรก เสียบเน็ตไว้ล่วงหน้าแล้วนะ — ครั้งถัดไปใช้ได้เลย", 4000);
        res(window.XLSX);
      };
      s.onerror = () => {
        _xlsxPromise = null;
        rej(new Error("ไฟล์ Excel ยังไม่ได้แคช — ต้องต่อเน็ตครั้งแรก 1 ครั้ง (ครั้งเดียวเท่านั้น)"));
      };
      document.head.append(s);
    });
  }
  return _xlsxPromise;
}
export async function exportXLSX(name, sheets /* [{title, rows: [[..]]}] */) {
  let XLSX;
  try { XLSX = await ensureXLSX(); }
  catch (e) { toast(e.message + " — ชั่วคราวใช้ CSV แทน", 5000, true); exportCSV(name, sheets[0].rows); return; }
  const wb = XLSX.utils.book_new();
  for (const sh of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sh.rows);
    ws["!cols"] = (sh.rows[0] || []).map(() => ({ wch: 14 }));
    XLSX.utils.book_append_sheet(wb, ws, (sh.title || "Sheet").slice(0, 31));
  }
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(name + ".xlsx", new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  toast("📊 ไฟล์ Excel พร้อมใช้งาน");
}

/* ---------- PDF ผ่านหน้าพิมพ์ (Android: พิมพ์ → บันทึกเป็น PDF) ---------- */
export function printHTML(title, bodyHTML) {
  const w = window.open("", "_blank");
  if (!w) { toast("เบราว์เซอร์บล็อกป๊อปอัพ — อนุญาตป๊อปอัพก่อนนะ", 4000, true); return; }
  w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>${title}</title>
  <style>
    body{font-family:"Noto Sans Thai","Sarabun",sans-serif;font-size:13px;color:#111;margin:28px}
    h1{font-size:17px;text-align:center;margin:0} .sub{text-align:center;color:#555;margin:2px 0 16px}
    table{border-collapse:collapse;width:100%;margin-top:8px}
    th,td{border:1px solid #94a3b8;padding:4px 8px;text-align:left;font-size:12px}
    th{background:#e6f4f1;text-align:center} td.n{text-align:right;white-space:nowrap}
    tr.sum td{font-weight:700;background:#f1faf8}
    .signs{display:flex;justify-content:space-between;margin-top:46px;font-size:12px;text-align:center}
    @media print{@page{margin:14mm}}
  </style></head><body>${bodyHTML}
  <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}

/* UI helper: ปุ่มเลือก-format ของตารางรายงาน */
export function reportButtons(name, makeRows) {
  const btns = h("div", { class: "btn-row", style: "margin-top:10px" });
  const mk = (label, fn, cls = "btn-ghost") => { const b = h("button", { class: "btn btn-sm " + cls }, label); b.onclick = fn; btns.append(b); };
  mk("🖨️ PDF/พิมพ์", () => {
    const rows = makeRows();
    const html = `<h1>${esc(rows.title)}</h1><div class="sub">${rows.subtitle || ""}</div><table>${
      rows.rows.map((r, i) => `<tr>${r.map((c) => i < rows.headerCount
        ? `<th>${esc(c)}</th>`
        : `<td${typeof Number(c) === "number" && String(c).trim() !== "" && !isNaN(String(c).replace(/,/g, "")) ? ' class="n"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")
    }</table><div class="signs"><span>ผู้บันทึก<br><br>__________________</span><span>ประธานกลุ่ม<br><br>__________________</span></div>`;
    printHTML(rows.title, html);
  }, "btn-primary");
  mk("📊 Excel", async () => { const r = makeRows(); await exportXLSX(name, [{ title: name, rows: r.rows }]); });
  mk("🧾 CSV", () => { const r = makeRows(); exportCSV(name, r.rows); });
  return btns;
}
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
