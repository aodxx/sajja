/* crypto.js — PIN (PBKDF2) + เข้ารหัสไฟล์สำรอง (AES-GCM) ด้วย Web Crypto */
import { downloadBlob, downloadText, inputBox, toast, modal, h } from "./util.js";

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
function unb64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
async function sha256Hex(str) { const d = await crypto.subtle.digest("SHA-256", enc.encode(str)); return b64(d); }

/** hash PIN แบบ PBKDF2-SHA256 (120k รอบ) — ใช้เทียบ PIN แทนการเก็บ PIN ตรง ๆ */
export async function hashPin(pin, saltB64) {
  const keyMat = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: unb64(saltB64), iterations: 120000, hash: "SHA-256" }, keyMat, 256);
  return b64(bits);
}
export async function makePinRecord(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { algo: "PBKDF2-SHA256-120k", salt: b64(salt.buffer), hash: await hashPin(pin, b64(salt.buffer)) };
}
export async function verifyPin(pin, rec) {
  if (!rec) return false;
  const got = await hashPin(pin, rec.salt);
  // เทียบแบบ constant-time พอสมควร
  if (got.length !== rec.hash.length) return false;
  let diff = 0; for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ rec.hash.charCodeAt(i);
  return diff === 0;
}

/* ---------- เข้ารหัส snapshot ---------- */
async function deriveKey(pass, salt) {
  const km = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
/** คืน Blob ไฟล์ .enc.json (base64 ของ AES-GCM) — ส่งขึ้น GitHub/LINE ได้อย่างปลอดภัย */
export async function encryptSnapshot(text, passphrase) {
  if (!passphrase || passphrase.length < 8) throw new Error("รหัสผ่านต้องยาวอย่างน้อย 8 ตัว");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
  const payload = { format: "sajja-enc-v1", salt: b64(salt.buffer), iv: b64(iv.buffer), data: b64(ct) };
  return JSON.stringify(payload, null, 1);
}
export async function decryptSnapshot(jsonText, passphrase) {
  const p = JSON.parse(jsonText);
  if (p.format !== "sajja-enc-v1") throw new Error("ไม่ recognisable — นี่ไม่ใช่ไฟล์ .enc.json ของระบบนี้");
  const key = await deriveKey(passphrase, unb64(p.salt));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(p.iv) }, key, unb64(p.data));
  return new TextDecoder().decode(pt);
}

/**
 * ให้ผู้ใช้เลือก: เข้ารหัสด้วย passphrase ไหม
 * @returns {Promise<{text:string, filename:string}|null>} null = ยกเลิก
 */
export async function protectAndName(baseFilename, jsonText, optPass) {
  if (optPass) return { text: await encryptSnapshot(jsonText, optPass), filename: baseFilename + ".enc.json" };
  return { text: jsonText, filename: baseFilename + ".json" };
}

/** โหลดไฟล์สำรอง (เข้ารหัสหรือไม่ก็ได้) → ข้อความ JSON */
export async function openMaybeEncrypted(file) {
  const text = (await file.text()).replace(/^\uFEFF/, "");
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* plain หรือเสีย */ }
  if (parsed && parsed.format === "sajja-enc-v1") {
    for (let i = 0; i < 3; i++) {
      const pass = await inputBox("🔒 ไฟล์นี้ถูกเข้ารหัส", { label: "ใส่รหัสผ่านที่ตั้งไว้ตอนสำรอง", type: "password", hint: "ครั้งที่ " + (i + 1) + "/3" });
      if (pass == null) return null;
      try { return await decryptSnapshot(text, pass); }
      catch (e) { toast("รหัสผ่านไม่ถูกต้อง ❌", 2000, true); }
    }
    toast("ใส่รหัสผิดเกิน 3 ครั้ง", 2500, true);
    return null;
  }
  return text;
}
