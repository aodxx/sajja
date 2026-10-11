/* db.js — IndexedDB store + Audit Trail (Soft Delete เท่านั้น) + Merge ข้ามอุปกรณ์
 * ทุก collection เก็บเป็น {id, type:"collection", updatedAt, deletedAt:null|ISO}
 *ห้าม hard delete — การแก้/ลบ จะบันทึก before/after ลง log เสมอ */
import { nowISO, genId, debounce } from "./util.js";

const DBNAME = "sajja-db";
const VERSION = 1;
export const COLLECTIONS = ["members", "txs", "loans", "shares", "welfares", "users", "settings", "audit"];

let _db = null;
export async function openDB() {
  if (_db) return _db;
  _db = await new Promise((res, rej) => {
    const r = indexedDB.open(DBNAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("docs")) {
        const s = db.createObjectStore("docs", { keyPath: ["type", "id"] });
        s.createIndex("by-type", "type");
        s.createIndex("by-updated", "updatedAt");
      }
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return _db;
}

function txStore(mode, storeName = "docs") {
  return _db.transaction(storeName, mode).objectStore(storeName);
}
const idbReq = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function byType(type) {
  const db = await openDB();
  return idbReq(txStore("readonly").index("by-type").getAll(IDBKeyRange.only(type)));
}
export async function getDoc(type, id) {
  const db = await openDB();
  return idbReq(txStore("readonly").get([type, id]));
}
export async function putDoc(doc) {
  const db = await openDB();
  doc.updatedAt = nowISO();
  await idbReq(txStore("readwrite").put(doc));
  scheduleExportCache();
  return doc;
}
/** Undo การ import "replace": ลบจริง (hard) — ใช้เฉพาะการกู้ค่าจาก log ก่อน import เท่านั้น */
export async function hardDelete(type, id) {
  const db = await openDB();
  await idbReq(txStore("readwrite").delete([type, id]));
}
export async function wipeAll() {
  const db = await openDB();
  for (const s of ["docs", "kv"]) await idbReq(txStore("readwrite", s).clear());
}

/** ลบแบบ Soft Delete + audit */
export async function softRemove(type, id, actor, reason) {
  const doc = (await getDoc(type, id)) || { type, id };
  const before = { ...doc };
  doc.deletedAt = nowISO(); doc.deletedBy = actor; doc.deleteReason = reason || "";
  await putDoc(doc);
  await logAudit({ actor, action: "delete", type, refId: id, before, reason });
  return doc;
}
/** แก้ข้อมูล + audit อัตโนมัติ */
export async function saveDoc(type, partial, actor, action = "update") {
  const doc = { id: partial.id || (partial.code ? normCode(partial.code) : genId(type.slice(0, 3))) };
  const before = (await getDoc(type, doc.id)) || null;
  Object.assign(doc, partial, { id: doc.id, type });
  if (before && before.deletedAt && !("deletedAt" in partial)) doc.deletedAt = null; // revive = แก้ไข
  await putDoc(doc);
  await logAudit({ actor, action: action || (before ? "update" : "create"), type, refId: doc.id, before, after: { ...doc } });
  return doc;
}
export function normCode(code) { return "S" + String(code).trim().padStart(3, "0"); }

/* ---------- audit ---------- */
export async function logAudit(entry) {
  const db = await openDB();
  const rec = { id: genId("au"), ts: nowISO(), ...entry, type: "audit", entity: entry.type || "-" };
  await idbReq(txStore("readwrite").put(rec));
  return rec;
}
export async function auditList(limit = 400) {
  const all = await byType("audit");
  return all.sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, limit);
}

/* ---------- kv (กันชน export cache / meta เล็กน้อย) ---------- */
export async function kvGet(k) { const db = await openDB(); return idbReq(txStore("readonly", "kv").get(k)); }
export async function kvSet(k, v) { const db = await openDB(); await idbReq(txStore("readwrite", "kv").put(v, k)); }

/* ---------- full snapshot / merge ---------- */
export async function allDocs() {
  const out = {};
  for (const t of COLLECTIONS) out[t] = (await byType(t)).filter((d) => !d.deletedAt);
  out.deleted = {};
  for (const t of COLLECTIONS) out.deleted[t] = (await byType(t)).filter((d) => d.deletedAt);
  const meta = await kvGet("meta");
  return {
    format: "sajja-data-v1", exportedAt: nowISO(),
    appVersion: (await kvGet("appVersion")) || "", meta: meta || null,
    data: out,
  };
}
/** snapshot → doc ทุกตัว (รวม tombstone) เพื่อ merge */
async function snapshotPairs(snap) {
  const docs = [];
  const d = snap.data || {};
  for (const t of COLLECTIONS) {
    for (const doc of (d[t] || [])) docs.push(doc);
    for (const doc of ((d.deleted || {})[t] || [])) docs.push(doc);
  }
  return docs;
}
export function validateSnapshotShape(snap) {
  const errs = [];
  if (!snap || typeof snap !== "object") return ["ไฟล์ไม่ใช่ object"];
  if (snap.format !== "sajja-data-v1") errs.push("format ไม่ถูกต้อง (คาดหวัง sajja-data-v1)");
  if (!snap.data || typeof snap.data !== "object") errs.push("ไม่มีช่อง data");
  for (const p of snapshotPairsSync(snap)) {
    if (!p.id || !p.type) { errs.push("พบรายการไม่มี id/type"); break; }
  }
  return errs;
}
function snapshotPairsSync(snap) {
  const out = []; const d = (snap && snap.data) || {};
  for (const t of COLLECTIONS) { (d[t] || []).forEach((x) => x && out.push(x)); ((d.deleted || {})[t] || []).forEach((x) => x && out.push(x)); }
  return out;
}

/**
 * Merge snapshot เข้าเครื่อง (Last-Write-Wins ตาม updatedAt ต่อ id)
 * mode: "merge" = รวม (แนะนำสำหรับย้าย/รับข้อมูลจากอีกเครื่อง), "replace" = ล้างก่อนแล้วใส่ใหม่
 * คืนสรุป {added, updated, skipped}
 */
export async function mergeSnapshot(snap, actor, mode = "merge") {
  const errs = validateSnapshotShape(snap);
  if (errs.length) throw new Error("ไฟล์ข้อมูลไม่ผ่านตรวจ: " + errs.join(", "));
  const db = await openDB();
  if (mode === "replace") {
    const st = txStore("readwrite"); st.clear();
    await new Promise((res, rej) => { st.transaction.oncomplete = res; st.transaction.onerror = rej; });
    _db = null; await openDB();
  }
  const pairs = await snapshotPairs(snap);
  let added = 0, updated = 0, skipped = 0;
  for (const doc of pairs) {
    const cur = await getDoc(doc.type, doc.id);
    if (!cur) { await putDoc(doc); added++; }
    else if ((doc.updatedAt || "") > (cur.updatedAt || "")) { await putDoc(doc); updated++; }
    else skipped++;
  }
  if (snap.meta) await kvSet("meta", snap.meta);
  await logAudit({ actor, action: "import", type: "-", refId: "-", reason: `mode=${mode} เพิ่ม=${added} แก้=${updated} ข้าม=${skipped}` });
  scheduleExportCache();
  return { added, updated, skipped };
}

/* ---------- export cache สำหรับ sync GitHub ---------- */
const _regen = debounce(async () => {
  try { await kvSet("exportCache", await allDocs()); await kvSet("exportCacheAt", nowISO()); fireCacheUpdate(); } catch (e) { console.warn(e); }
}, 400);
export function scheduleExportCache() { _regen(); }
let cacheListeners = [];
export function onExportCache(fn) { cacheListeners.push(fn); }
function fireCacheUpdate() { cacheListeners.forEach((f) => { try { f(); } catch {} }); }
export async function cachedExport() {
  let c = await kvGet("exportCache");
  if (!c) { c = await allDocs(); await kvSet("exportCache", c); await kvSet("exportCacheAt", nowISO()); }
  return c;
}
