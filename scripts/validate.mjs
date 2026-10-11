#!/usr/bin/env node
/* validate.mjs — ตรวจไฟล์ข้อมูลกลุ่ม (JSON Schema subset + กติกาความสอดคล้อง)
 * ใช้งาน:  node scripts/validate.mjs data/*.json
 * ใช้ใน GitHub Actions: validate-data.yml  — error = fail build */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

/* ---------------- mini-JSON-Schema (draft-07 subset) ---------------- */
const SCHEMAS = {};
for (const f of process.argv.slice(2).filter((a) => a.endsWith("schema.json"))) {
  const j = JSON.parse(readFileSync(f, "utf8"));
  SCHEMAS[j.$id || basename(f)] = j;
}
function resolve(ref) { return SCHEMAS[ref.replace(/^#\/?/, "").replace(/\.json$/, "") + ".json"] || SCHEMAS[ref]; }
function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v;
}
export function validate(obj, schema, path = "$", errs = []) {
  if (!schema) return errs;
  const t = typeOf(obj);
  if (schema.const !== undefined && obj !== schema.const) errs.push(`${path}: ต้องเป็น "${schema.const}"`);
  if (schema.enum && !schema.enum.includes(obj)) errs.push(`${path}: ค่า "${obj}" ไม่อยู่ในที่อนุญาต (${schema.enum.join("/")})`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((x) => x === t || (x === "number" && t === "integer"))) errs.push(`${path}: ชนิดข้อมูลต้องเป็น ${types.join("/")} (พบ ${t})`);
  }
  if (t === "string") {
    if (schema.minLength != null && obj.length < schema.minLength) errs.push(`${path}: สั้นกว่า ${schema.minLength}`);
    if (schema.maxLength != null && obj.length > schema.maxLength) errs.push(`${path}: ยาวเกิน ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(obj)) errs.push(`${path}: รูปแบบไม่ตรง ${schema.pattern}`);
  }
  if (t === "number" || t === "integer") {
    if (schema.minimum != null && obj < schema.minimum) errs.push(`${path}: น้อยกว่า ${schema.minimum}`);
    if (schema.maximum != null && obj > schema.maximum) errs.push(`${path}: มากกว่า ${schema.maximum}`);
    if (schema.exclusiveMinimum != null && obj <= schema.exclusiveMinimum) errs.push(`${path}: ต้องมากกว่า ${schema.exclusiveMinimum}`);
  }
  if (schema.$ref) { validate(obj, resolve(schema.$ref), path, errs); }
  if (t === "array") {
    if (schema.minItems != null && obj.length < schema.minItems) errs.push(`${path}: มีitem น้อยกว่า ${schema.minItems}`);
    if (schema.items) obj.forEach((x, i) => validate(x, schema.items, `${path}[${i}]`, errs));
  }
  if (t === "object") {
    for (const r of schema.required || []) if (!(r in obj)) errs.push(`${path}: ขาดฟิลด์บังคับ "${r}"`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties && schema.properties[k];
      if (sub) validate(v, sub, `${path}.${k}`, errs);
      else if (schema.additionalProperties === false) errs.push(`${path}.${k}: ฟิลด์ไม่อนุญาต`);
    }
  }
  return errs;
}

/* ---------------- กติกาความสอดคล้อง ---------------- */
function integrity(snap, prefix) {
  const e = [];
  const ids = new Set(snap.data.members.map((m) => m.id));
  const live = (f) => (snap.data[f] || []).filter((x) => !x.deletedAt && !x.voided);
  for (const t of live("txs")) {
    if (t.member && !ids.has(t.member)) e.push(`${prefix}tx ${t.id}: อ้างถึงสมาชิกไม่มีจริง (${t.member})`);
    if (typeof t.amount === "number" && t.amount <= 0) e.push(`${prefix}tx ${t.id}: จำนวนเงินต้องมากกว่า 0`);
  }
  for (const l of (snap.data.loans || []).filter((x) => x.status !== "void")) {
    if (!ids.has(l.member)) e.push(`${prefix}loan ${l.id}: สมาชิกไม่มีจริง`);
    if (l.status === "active" || l.status === "closed") {
      const out = live("txs").filter((x) => x.loanId === l.id && x.kind === "loan_repay").reduce((s, x) => s + x.amount, 0);
      if (out > l.principal * 1.25) e.push(`${prefix}loan ${l.id}: ชำระรวมผิดปกติ (เกิน 125% ของเงินต้น)`);
    }
    const guar = (l.guarantorIds || []).filter((g) => g !== l.member);
    if (["active", "closed"].includes(l.status) && guar.length < 2) e.push(`${prefix}loan ${l.id}: ผู้ค้ำประกันไม่ครบ 2 คน`);
    const disb = live("txs").some((x) => x.loanId === l.id && x.kind === "loan_out");
    if (l.status === "active" && !disb) e.push(`${prefix}loan ${l.id}: สถานะ active แต่ไม่มีรายการจ่ายเงินกู้`);
  }
  if (!live("members").length && (snap.data.txs || []).length) e.push(`${prefix}ไม่มีสมาชิกเลย แต่มีรายการเงิน — ไฟล์อาจไม่สมบูรณ์`);
  return e;
}

/* ---------------- main (เฉพาะเมื่อรันเป็น CLI) ---------------- */
const isCli = process.argv[1] && process.argv[1].endsWith("validate.mjs");
if (isCli) main();
function main() {
let fail = 0;
for (const f of process.argv.slice(2).filter((a) => !a.endsWith("schema.json"))) {
  let snap;
  try {
    const text = readFileSync(f, "utf8").replace(/^\uFEFF/, "");
    if (/"format":\s*"sajja-enc-v1"/.test(text.slice(0, 200))) { console.log(`ℹ️  ${f} — ไฟล์เข้ารหัส (ผ่าน: สบายใจได้) — ข้าม schema`); continue; }
    snap = JSON.parse(text);
  } catch (err) { console.error(`❌ ${basename(f)} ไม่ใช่ JSON ที่ถูกต้อง: ${err.message}`); fail++; continue; }
  let errs = validate(snap, SCHEMAS["snapshot.schema.json"]);
  // ตรวจชนิดราย collection เพื่อ error ที่กระชับ
  for (const c of ["members", "txs", "loans"]) {
    const s = SCHEMAS[c === "txs" ? "transaction.schema.json" : c + ".schema.json"];
    for (const doc of snap.data?.[c] || []) {
      const sub = validate(doc, s, `${c}/${doc?.id}`);
      errs.push(...sub);
    }
  }
  errs = errs.concat(integrity(snap, basename(f) + ": "));
  if (errs.length) { console.error(`❌ ${basename(f)}:\n` + errs.slice(0, 40).map((x) => "   " + x).join("\n")); fail++; }
  else console.log(`✅ ${basename(f)} — ผ่าน schema + ความสอดคล้อง`);
}
process.exit(fail ? 1 : 0);
}
