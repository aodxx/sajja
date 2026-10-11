/* sync.js — สำรอง/ซิงก์ข้อมูลกับ GitHub Repository (ผ่าน GitHub REST API)
 * ⚠️ โหมดนี้ "ปิดเป็นค่าเริ่มต้น" ใช้เมื่อพร้อม เพราะ Token อยู่ในมือผู้ถือเครื่อง
 * แนวคิด: repo = คลังข้อมูล 1 ไฟล์ (data/current.json) เอกสิทธิ์เขียนเฉพาะ Fine-grained PAT
 * วิธีแก้ชนกัน: ทุกเขียนส่ง "sha ของเวอร์ชันที่ตนเห็น" ไปด้วย → ถ้ามีคนอื่นเขียนก่อน GitHub จะตอบ
 * 409 → ดึงข้อมูลใหม่ → merge (Last-Write-Wins ต่อ id) → เขียนซ้ำ (สูงสุด 3 ครั้ง) */
import { kvGet, kvSet, cachedExport, mergeSnapshot } from "./db.js";
import { encryptSnapshot, decryptSnapshot } from "./crypto.js";
import { toast } from "./util.js";

const API = "https://api.github.com";

export async function getSyncCfg() {
  return (await kvGet("sync")) || {
    enabled: false, mode: "manual",            // manual | auto-push
    owner: "", repo: "", branch: "main", path: "data/current.json",
    token: "", encrypt: true, pass: "", lastPush: "", lastPull: "", conflictCount: 0,
  };
}
export async function saveSyncCfg(cfg) { await kvSet("sync", cfg); }

const gh = async (cfg, path, opt = {}) => {
  const res = await fetch(API + path, {
    ...opt,
    headers: {
      Authorization: "Bearer " + cfg.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opt.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (res.status === 401) throw new Error("Token ไม่ถูกต้อง/หมดอายุ");
  if (res.status === 403) throw new Error("GitHub ปฏิเสธ (อัตราจำกัดหรือสิทธิ์ไม่พอ)");
  if (res.status === 404) return null;
  if (res.status === 409) { const e = new Error("conflict"); e.conflict = true; e.data = await res.json().catch(() => null); throw e; }
  if (!res.ok) throw new Error("GitHub ตอบกลับผิดพลาด " + res.status);
  return res.status === 204 ? null : await res.json();
};

function base64ToBytes(b64) {
  const bin = atob(b64.replace(/\n/g, "")); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u;
}
const bytesToBase64 = (bytes) => { let s = ""; const c = 0x8000; for (let i = 0; i < bytes.length; i += c) s += String.fromCharCode.apply(null, bytes.subarray(i, i + c)); return btoa(s); };

async function decodeSnapText(text, cfg) {
  if (!text) return null;
  let j = JSON.parse(text);
  if (j.format === "sajja-enc-v1") { if (!cfg.pass) throw new Error("ไฟล์บน GitHub เข้ารหัส ไว้ — ตั้งรหัสผ่านก่อน sync"); j = JSON.parse(await decryptSnapshot(text, cfg.pass)); }
  return j;
}

export async function testConnection(cfg) {
  const r = await gh(cfg, `/repos/${cfg.owner}/${cfg.repo}`);
  if (!r) throw new Error("ไม่พบ repo (" + cfg.owner + "/" + cfg.repo + ") — Token จำกัดให้เข้าถึง repo อื่นหรือเปล่า?");
  return { name: r.full_name, private: r.private, default_branch: r.default_branch };
}

/** ดึงข้อมูลจาก repo → merge เข้าเครื่อง */
export async function pull(cfg0) {
  const cfg = cfg0 || (await getSyncCfg());
  if (!cfg.enabled || !cfg.token) throw new Error("ยังไม่เปิดใช้งานการซิงก์ (เมนูอื่น → ซิงก์/สำรอง)");
  const r = await gh(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}?ref=${cfg.branch}`);
  if (!r || !r.content) { toast("ℹ️ repo ยังไม่มีไฟล์ข้อมูล"); return { added: 0, updated: 0, skipped: 0, empty: true }; }
  let text = new TextDecoder().decode(base64ToBytes(r.content));
  let snap = await decodeSnapText(text, cfg);
  const out = await mergeSnapshot(snap, "sync-pull", "merge");
  cfg.lastPull = new Date().toISOString(); await saveSyncCfg(cfg);
  return out;
}

/** ส่งข้อมูลขึ้น repo ( เข้ารหัส ก่อนเสมอหากเลือกไว้ ) พร้อมแก้ conflict อัตโนมัติ */
export async function push(cfg0, silent = false) {
  const cfg = cfg0 || (await getSyncCfg());
  if (!cfg.enabled || !cfg.token) throw new Error("ยังไม่เปิดใช้งานการซิงก์");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const snap = await cachedExport();
    let text = JSON.stringify(snap, 0);
    if (cfg.encrypt) text = await encryptSnapshot(text, cfg.pass);
    let sha = null;
    try { const cur = await gh(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}?ref=${cfg.branch}`); sha = cur && cur.sha; } catch (e) { if (!silent) throw e; }
    try {
      await gh(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`, {
        method: "PUT",
        body: JSON.stringify({
          message: `data: backup ${new Date().toISOString()} by sajja-app (attempt ${attempt})`,
          content: bytesToBase64(new TextEncoder().encode(text)), branch: cfg.branch, sha: sha || undefined,
        }),
      });
      cfg.lastPush = new Date().toISOString(); await saveSyncCfg(cfg);
      if (!silent) toast("☁️ สำรองขึ้น GitHub สำเร็จแล้ว");
      return { ok: true };
    } catch (e) {
      if (!e.conflict) throw e;
      cfg.conflictCount = (cfg.conflictCount || 0) + 1; await saveSyncCfg(cfg);
      if (!silent) toast("⚠️ มีอีกเครื่องส่งข้อมูลก่อน — กำลังรวมข้อมูลและลองใหม่ (" + attempt + "/3)");
      try { await pull(cfg); } catch { /* remote มี encrypted ที่แก้อะไรไม่ได้ — ข้ามไปส่งใหม่ */ }
    }
  }
  throw new Error("รวมข้อมูลอัตโนมัติไม่สำเร็จ 3 ครั้ง — ใช้ปุ่ม \"ส่งทั้งก้อน (ทับของเก่า)\" หรือ Export/Import ด้วยมือ");
}

/** ทางเลือกไม่ต้องใช้ Token: ดาวน์โหลดไฟล์ที่พร้อมลากวางลง github.com ด้วยมือ */
export async function githubDropFile(cfg0) {
  const cfg = cfg0 || (await getSyncCfg());
  const snap = await cachedExport();
  let text = JSON.stringify(snap, cfg.encrypt ? 0 : 1);
  if (cfg.encrypt) text = await encryptSnapshot(text, cfg.pass);
  return { filename: cfg.path.split("/").pop() || "current.json", text };
}
