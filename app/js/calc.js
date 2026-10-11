/* calc.js — สมองคำนวณ: สถานะส่งเงิน, ยอดสะสม, สิทธิ์กู้, ตารางผ่อน flat 2%,
 * ค่าปรับ, กองทุนสวัสดิการ, ปันผล, งบรายรับ-จ่าย, งบดุล
 * เป็นฟังก์ชัน pure (รับ state → คืนค่า) เพื่อทดสอบด้วย Node ได้ */
import { ymDiff, ymAdd, ymList, curYM, todayStr, monthEndStr } from "./util.js";

export const DEFAULT_CFG = {
  sajaDueDay: 25,            // สิ้นเดือนส่งไม่เกินวันที่เท่าไหร่
  sajaMonthly: 50,           // กติกาเงินสัจจะมาตรฐาน ต่อเดือน (บาท)
  sharePrice: 10,            // หุ้นละ 10 บาท
  annualTarget: 120,         // เงินออมรายปี 120 บาท/ปี
  lateFine: 20,              // ค่าปรับขาดส่ง บาท/ครั้ง
  loanMinMonthsSaved: 3,     // สิทธิ์กู้ = ออมครบกี่เดือน
  loanBaseLimit: 1000,       // วงเงินเริ่มต้น บาท/บัญชี
  loanMaxMonths: 10,         // ผ่อนไม่เกินกี่งวด
  loanFeePct: 2,             // ค่าบำรุง 2%/เดือน (flat เงินต้น)
  loanRemindDays: 3,         // เตือนล่วงหน้า (วัน)
  guarantorsMin: 2,          // ผู้ค้ำประกันอย่างน้อย
  maxActiveLoans: 1,         // สัญญากู้ active พร้อมกันได้กี่สัญญา
  sickNightPay: 100,         // ค่าเสียโอกาสเจ็บป่วย บาท/คืน
  sickMaxNightsYear: 10,     // ไม่เกินกี่คืน/ปี
  dividendPctOfProfit: 50,   // ปันผล = กำไรสุทธิ × 50%
  openingCash: 0,
};
export const LOAN_PURPOSES = { sick: { th: "เจ็บป่วย", prio: 1 }, study: { th: "ค่าเล่าเรียน", prio: 2 }, other: { th: "อื่นๆ", prio: 3 } };
export const WELFARE_CATS = { cremation: "ฌาปนกิจ", sick: "ค่าเสียโอกาสเจ็บป่วย", scholarship: "ทุนการศึกษาบุตร", other: "อื่น ๆ" };
export const TX_KINDS = {
  saja: { th: "เงินสัจจะรายเดือน", dir: "in", cash: "main" },
  sharebuy: { th: "ซื้อหุ้น", dir: "in", cash: "main" },
  annualsave: { th: "เงินออมรายปี", dir: "in", cash: "main" },
  fine: { th: "ค่าปรับขาดส่ง", dir: "in", cash: "welfare" },
  welfare_in: { th: "รับเข้ากองทุนสวัสดิการ", dir: "in", cash: "welfare" },
  welfare_out: { th: "จ่ายกองทุนสวัสดิการ", dir: "out", cash: "welfare" },
  loan_out: { th: "จ่ายสินเชื่อ (กู้)", dir: "out", cash: "main" },
  loan_repay: { th: "ชำระงวดกู้", dir: "in", cash: "main" },
  dividend_pay: { th: "จ่ายเงินปันผล", dir: "out", cash: "main" },
  other_in: { th: "รายได้อื่น", dir: "in", cash: "main" },
  other_out: { th: "รายจ่ายอื่น", dir: "out", cash: "main" },
};

/* ================= โหลด state ================= */
export async function loadState(DB) {
  const [members, txs, loans, users, settingsDocs] = await Promise.all([
    DB.byType("members"), DB.byType("txs"), DB.byType("loans"), DB.byType("users"), DB.byType("settings"),
  ]);
  const live = (a) => a.filter((d) => !d.deletedAt && !d.voided).sort((a, b) => (a.id < b.id ? -1 : 1));
  const cfgDoc = settingsDocs.find((d) => d.id === "cfg") || {};
  const group = settingsDocs.find((d) => d.id === "group") || {};
  return {
    members: live(members), txs: live(txs), loans: live(loans), users: live(users),
    cfg: { ...DEFAULT_CFG, ...(cfgDoc.v || {}) }, group: { name: "กลุ่มออมทรัพย์", ...(group.v || {}) },
  };
}
export const memberById = (st, id) => st.members.find((m) => m.id === id);

/* ================= สถานะเงินสัจจะ ================= */
/** สถานะเดือน ym ของสมาชิก m: sent | due (本月ยังไม่เลยกำหนด) | late (ผิดนัด) | none (ยังไม่เกิด/ลาออกแล้ว) */
export function sajaStatus(m, ym, st, asOf = todayStr()) {
  const paid = st.txs.some((t) => t.kind === "saja" && t.member === m.id && t.ym === ym);
  if (paid) return "sent";
  const joinYM = String(m.joined || "1990-01").slice(0, 7);
  if (ymDiff(joinYM, ym) < 0) return "none";
  if (m.status === "resigned" && ymDiff(m.resignedAt || "2100-01", ym) > 0) return "none";
  const cur = curYM();
  if (ymDiff(cur, ym) > 0) return "none";               // เดือนอนาคต
  const overdue = ymDiff(ym, cur) > 0 || (ym === cur && Number(asOf.slice(8, 10)) > (m.dueDay || st.cfg.sajaDueDay));
  return overdue ? "late" : "due";
}
export function sajaHistory(st, m, toYM = curYM()) {
  const joinYM = String(m.joined || "1990-01").slice(0, 7);
  return ymList(joinYM, toYM).map((ym) => ({ ym, status: sajaStatus(m, ym, st), amount: sumSaja(st, m.id, ym) }));
}
export function sumSaja(st, memberId, ym = null) {
  return round2(st.txs.filter((t) => t.kind === "saja" && t.member === memberId && (!ym || t.ym === ym)).reduce((s, t) => s + t.amount, 0));
}
export const sumKind = (st, kind, memberId = null) =>
  round2(st.txs.filter((t) => t.kind === kind && (!memberId || t.member === memberId)).reduce((s, t) => s + t.amount, 0));

export function memberTotals(st, m) {
  const saja = sumSaja(st, m.id);
  const sharesN = st.txs.filter((t) => t.kind === "sharebuy" && t.member === m.id).reduce((s, t) => s + (t.n || Math.round(t.amount / st.cfg.sharePrice)), 0);
  const shares = round2(sharesN * st.cfg.sharePrice);
  const annual = sumKind(st, "annualsave", m.id);
  const finesPaid = sumKind(st, "fine", m.id);
  return { saja, sharesN, shares, annual, finesPaid, savings: round2(saja + shares + annual) };
}
export function monthsSaved(st, m) {
  return new Set(st.txs.filter((t) => t.kind === "saja" && t.member === m.id).map((t) => t.ym)).size;
}
/** ค้างส่งทั้งหมด (late ทุกเดือนที่ผ่านมาจนถึงเดือนนี้) */
export function lateMonths(st, m, asOf = todayStr()) {
  const joinYM = String(m.joined || "1990-01").slice(0, 7);
  return ymList(joinYM, curYM()).filter((ym) => sajaStatus(m, ym, st, asOf) === "late");
}
/** ภาระค่าปรับที่ยังไม่เก็บ (เดือนละครั้ง × อัตรา) */
export function finesDue(st, m) { return lateMonths(st, m).length * st.cfg.lateFine; }

/* ปุ่ม "เก็บค่าปรับ" — สร้าง tx kind fine จำนวน n ครั้งของเดือนที่ค้าง (กันลงซ้ำ) */
export function finesPending(st, m) {
  const billed = new Set(st.txs.filter((t) => t.kind === "fine" && t.member === m.id).map((t) => t.fineYM).filter(Boolean));
  return lateMonths(st, m).filter((ym) => !billed.has(ym));
}

/* ================= การกู้ ================= */
export function eligibility(st, m) {
  const ok = [], bad = [];
  const ms = monthsSaved(st, m);
  (ms >= st.cfg.loanMinMonthsSaved ? ok : bad).push(`ออมครบ ${st.cfg.loanMinMonthsSaved} เดือน (มี ${ms} เดือน)`);
  if (m.status !== "resigned") ok.push("สถานะสมาชิกปกติ"); else bad.push("ลาออกจากการเป็นสมาชิกแล้ว");
  const open = activeLoans(st, m.id);
  (open.length < st.cfg.maxActiveLoans ? ok : bad).push(open.length ? `มีสัญญากู้ค้าง ${open.length} สัญญา` : "ไม่มีหนี้อยู่ในระหว่างผ่อน");
  const late = lateMonths(st, m);
  (late.length === 0 ? ok : bad).push(late.length ? `ค้างส่งเงินสัจจะ ${late.length} เดือน` : "ส่งสัจจะครบตามกำหนด");
  return { can: bad.length === 0, ok, bad, limit: loanLimit(st, m), monthsSaved: ms };
}
export function loanLimit(st, m) {
  // วงเงินเริ่มต้นตามข้อบังคับ + เพิ่มได้ถ้ากลุ่มกำหนดกติกา (ตอนนี้คง 1,000 ต่อ บัญชี)
  return st.cfg.loanBaseLimit;
}
export const activeLoans = (st, memberId) => st.loans.filter((l) => l.member === memberId && l.status === "active");

/** ตารางผ่อน flat = เงินต้น/งวด คงที่ + ค่าบำรุง = เงินต้น × 2% คงที่ทุกงวด */
export function schedule(loan, cfg) {
  const n = loan.months || cfg.loanMaxMonths;
  const feePct = loan.feePct ?? cfg.loanFeePct;
  const princPer = round2(loan.principal / n);
  const feeMonthly = round2(loan.principal * feePct / 100);
  const day = Number(String(loan.start).slice(8, 10)) || cfg.sajaDueDay;
  const rows = [];
  for (let i = 1; i <= n; i++) {
    const dueYM = ymAdd(String(loan.start).slice(0, 7), i);
    const due = `${dueYM}-${String(day).padStart(2, "0")}`;
    rows.push({ no: i, due, principal: i === n ? round2(loan.principal - princPer * (n - 1)) : princPer, fee: feeMonthly, due_total: 0 });
    rows[i - 1].due_total = round2(rows[i - 1].principal + feeMonthly);
  }
  return rows;
}
/** จ่ายเงินเข้าสัญญา → จัดสรร: ค่าบำรุงงวดเก่าสุดก่อน แล้วเงินต้นงวดเก่าสุด (FIFO) */
export function loanState(st, loan, asOf = todayStr()) {
  const cfg = st.cfg;
  const rows = schedule(loan, cfg).map((r) => ({ ...r, feePaid: 0, princPaid: 0 }));
  const pays = st.txs.filter((t) => t.kind === "loan_repay" && t.loanId === loan.id).sort((a, b) => a.at < b.at ? -1 : 1);
  let carry = 0;
  const byTx = []; // บันทึกการจัดสรรจริงต่อใบเสร็จ ({txId, at, fee, principal})
  for (const p of pays) {
    let left = p.amount;
    const beforeFee = round2(rows.reduce((s, r) => s + r.feePaid, 0));
    const beforePrinc = round2(rows.reduce((s, r) => s + r.princPaid, 0));
    for (const r of rows) { // งวดเก่าสุดก่อน: ในงวด = ค่าบำรุง → เงินต้น
      if (left <= 0.004) break;
      const needF = round2(r.fee - r.feePaid);
      if (needF > 0) { const take = Math.min(needF, left); r.feePaid = round2(r.feePaid + take); left = round2(left - take); }
      const needP = round2(r.principal - r.princPaid);
      if (needP > 0 && left > 0.004) { const take = Math.min(needP, left); r.princPaid = round2(r.princPaid + take); left = round2(left - take); }
    }
    byTx.push({ txId: p.id, at: p.at, fee: round2(rows.reduce((s, r) => s + r.feePaid, 0) - beforeFee), principal: round2(rows.reduce((s, r) => s + r.princPaid, 0) - beforePrinc), overpaid: left });
    carry = round2(carry + left); // จ่ายเกิน → เป็นเครดิตเหลือตัดงวดถัดไป
  }
  const princPaid = round2(rows.reduce((s, r) => s + r.princPaid, 0));
  const feePaid = round2(rows.reduce((s, r) => s + r.feePaid, 0));
  const balance = round2(loan.principal - princPaid + Math.max(0, -(carry))); // ปกติ carry ไม่น่าติดลบ
  const unpaid = rows.filter((r) => round2(r.principal - r.princPaid) > 0 || round2(r.fee - r.feePaid) > 0);
  const nextDue = unpaid[0] || null;
  const overdueMonths = unpaid.filter((r) => r.due < asOf).length;
  const status = balance <= 0.004 && rows.every((r) => round2(r.fee - r.feePaid) < 0.005 && round2(r.principal - r.princPaid) < 0.005) ? "closed"
    : overdueMonths ? "overdue" : "active";
  const dueSoon = nextDue && nextDue.due >= asOf && daysBetween(asOf, nextDue.due) <= cfg.loanRemindDays ? nextDue : null;
  return { rows, princPaid, feePaid, byTx, carry, balance, nextDue, dueSoon, overdueMonths, status, paidTotal: round2(princPaid + feePaid) };
}
/** สรุปค่าบำรุง (รายได้) ทั้งกลุ่มตามปี พ.ศ./ค.ศ. — นับตอนชำระจริง ไม่ใช่ตอนอนุมัติ */
export function feeIncomeByYear(st) {
  const map = {};
  for (const l of st.loans.filter((x) => x.status !== "void")) {
    for (const t of loanState(st, l).byTx) {
      const y = Number(t.at.slice(0, 4));
      map[y] = round2((map[y] || 0) + t.fee);
    }
  }
  return map;
}
export function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

/** สรุปหนี้ค้างทั้งกลุ่ม สำหรับ dashboard + รายงานลูกหนี้ */
export function loanAlerts(st, asOf = todayStr()) {
  const out = [];
  for (const l of st.loans.filter((x) => x.status !== "closed")) {
    const s = loanState(st, l, asOf);
    if (s.balance <= 0 && s.overdueMonths === 0) continue;
    if (s.overdueMonths > 0) out.push({ loan: l, ...s, flag: "overdue" });
    else if (s.dueSoon) out.push({ loan: l, ...s, flag: "due-soon" });
    else if (s.balance > 0) out.push({ loan: l, ...s, flag: "open" });
  }
  const rank = { overdue: 0, "due-soon": 1, open: 2 };
  return out.sort((a, b) => rank[a.flag] - rank[b.flag]);
}

/* ================= กองทุนสวัสดิการ ================= */
export function welfareFund(st) {
  let bal = 0; const inRows = [], outRows = [];
  for (const t of st.txs.filter((x) => TX_KINDS[x.kind]?.cash === "welfare")) {
    if (t.kind === "fine" && !t.received) continue; // ใบปรับยังไม่เก็บ = ยังไม่นับเป็นเงินสดกองทุน
    bal += (TX_KINDS[t.kind].dir === "in" ? t.amount : -t.amount);
    (TX_KINDS[t.kind].dir === "in" ? inRows : outRows).push(t);
  }
  return { balance: round2(bal), in: round2(inRows.reduce((s, t) => s + t.amount, 0)), out: round2(outRows.reduce((s, t) => s + t.amount, 0)) };
}
export function sickNightsThisYear(st, memberId, year = Number(todayStr().slice(0, 4))) {
  return st.txs.filter((t) => t.kind === "welfare_out" && t.cat === "sick" && t.member === memberId && Number(t.at.slice(0, 4)) === year)
    .reduce((s, t) => s + (t.nights || 0), 0);
}

/* ================= ปันผล (31 ธ.ค.) ================= */
/** รายจ่ายที่ใช้หักจาก "กำไรสุทธิ" ในการปันผล = ค่าใช้จ่ายดำเนินงาน (other_out) ไม่ใช้สวัสดิการ */
export function defaultNetProfit(st, year) {
  const fee = feeIncomeByYear(st)[year] || 0;
  const oin = round2(st.txs.filter((t) => t.kind === "other_in" && Number((t.ym || t.at || "").slice(0, 4)) === year).reduce((s, t) => s + t.amount, 0));
  const oout = round2(st.txs.filter((t) => t.kind === "other_out" && Number((t.ym || t.at || "").slice(0, 4)) === year).reduce((s, t) => s + t.amount, 0));
  return round2(fee + oin - oout);
}
export function dividendCalc(st, year, profitOverride = null) {
  // กำไรสุทธิ = ค่าบำรุงเงินกู้รับ + รายได้อื่น − ค่าใช้จ่ายดำเนินงาน (คณะกรรมการกดยืนยัน/แก้ไขตัวเลขได้)
  const profit = profitOverride != null && String(profitOverride).trim() !== "" ? round2(profitOverride) : defaultNetProfit(st, year);
  const pool = round2(profit * st.cfg.dividendPctOfProfit / 100);
  const totals = st.members.filter((m) => m.status !== "resigned" || m.shareKeepYearEnd !== false)
    .map((m) => {
      const shares = st.txs.filter((t) => t.kind === "sharebuy" && t.member === m.id && Number((t.at || "").slice(0, 4)) <= year)
        .reduce((s, t) => s + (t.n || Math.round(t.amount / st.cfg.sharePrice)), 0);
      return { m, member: m.id, name: m.name, shares };
    });
  const allShares = totals.reduce((s, x) => s + x.shares, 0);
  const perShare = allShares ? pool / allShares : 0;
  const rows = totals.map((x) => ({ ...x, amount: round2(x.shares * perShare) }));
  const sumRows = round2(rows.reduce((s, x) => s + x.amount, 0));
  return { profit, pool, allShares, perShare: Math.floor(perShare * 1e4) / 1e4, rows, sumRows, retain: round2(pool - sumRows), year };
}

/* ================= รายงาน ================= */
export function incomeExpense(st, year) {
  const ys = (t) => Number((t.at || t.ym || "").slice(0, 4)) === year;
  const inc = { "ค่าบำรุงเงินกู้ (จากรการชำระจริง)": feeIncomeByYear(st)[year] || 0 };
  const exp = {};
  for (const t of st.txs.filter(ys)) {
    const k = TX_KINDS[t.kind]; if (!k) continue;
    if (t.kind === "loan_repay") continue;
    if (k.dir === "in") inc[k.th] = round2((inc[k.th] || 0) + t.amount);
    else exp[k.th + (t.cat ? ` (${WELFARE_CATS[t.cat] || t.cat})` : "")] = round2((exp[k.th + (t.cat ? ` (${WELFARE_CATS[t.cat] || t.cat})` : "")] || 0) + t.amount);
  }
  const totIn = round2(Object.values(inc).reduce((a, b) => a + b, 0));
  const totOut = round2(Object.values(exp).reduce((a, b) => a + b, 0));
  return { year, inc, exp, totIn, totOut, net: round2(totIn - totOut) };
}
export function balanceSheet(st, asOf = todayStr()) {
  let cash = st.cfg.openingCash || 0;
  let loansDue = 0, savings = 0;
  for (const t of st.txs) {
    const k = TX_KINDS[t.kind]; if (!k) continue;
    if (t.kind === "fine" && !t.received) continue; // ใบปรับที่ยังไม่เก็บ ไม่ใช่เงินสด
    if (t.at <= asOf) cash += (k.dir === "in" ? t.amount : -t.amount);
  }
  for (const l of st.loans) { if (String(l.start) <= asOf) loansDue += Math.max(0, loanState(st, l, asOf).balance); }
  for (const m of st.members) if (String(m.joined) <= asOf) savings += memberTotals(st, m).savings;
  const w = welfareFund(st);
  const equity = round2(cash + loansDue - savings - w.balance);
  return {
    asOf,
    assets: { "เงินคงเหลือ (เงินสด/ธนาคาร)": round2(cash), "เงินให้กู้ยืมคงเหลือ": round2(loansDue), total: round2(cash + loansDue) },
    liabilities: { "เงินออมสมาชิกสะสม": round2(savings), "กองทุนสวัสดิการ": w.balance, "กำไรสะสม/เงินกองทุน": equity, total: round2(savings + w.balance + equity) },
    balanced: Math.abs(round2(cash + loansDue) - round2(savings + w.balance + equity)) < 1,
  };
}

export function round2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
