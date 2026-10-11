/* ui-reports.js — ศูนย์รายงาน: งบรรับ-รายจ่าย, งบดุล, รายตัวสมาชิก, ลูกหนี้ค้าง, สวัสดิการ + PDF/Excel/CSV */
import { h, toast, fmtBaht, fmtDate, fmtYM, curYM, todayStr } from "./util.js";
import { memberTotals, sajaHistory, loanState, incomeExpense, balanceSheet, welfareFund, dividendCalc, eligibility } from "./calc.js";
import { reportButtons } from "./fileio.js";
import { tbl } from "./ui-members.js";

const KIND_TH = { saja: "เงินสัจจะ", sharebuy: "ซื้อหุ้น", annualsave: "ออมรายปี", fine: "ค่าปรับ", welfare_in: "รับสวัสดิการ", welfare_out: "จ่ายสวัสดิการ", loan_out: "จ่ายกู้", loan_repay: "รับชำระกู้", dividend_pay: "จ่ายปันผล", other_in: "รายได้อื่น", other_out: "รายจ่ายอื่น" };

export async function renderReports(ctx) {
  const { st, root } = ctx;
  const yearOptions = [...new Set(st.txs.map((t) => Number((t.at || "").slice(0, 4)) || new Date().getFullYear()))].sort((a, b) => b - a);
  [new Date().getFullYear() - 1, new Date().getFullYear()].forEach((y) => { if (!yearOptions.includes(y)) yearOptions.push(y); });
  yearOptions.sort((a, b) => b - a);
  const sel = { year: yearOptions[0], memberId: "" };

  const yearSel = h("select", { style: "min-height:48px;border:2px solid var(--line);border-radius:12px;padding:0 10px;font-size:1rem;background:#fff;font-weight:700" },
    ...yearOptions.map((y) => h("option", { value: y }, "ปี " + (y + 543))));
  yearSel.onchange = () => paint();
  const body = h("div", { class: "stack" });

  const tiles = h("div", { class: "tiles" });
  const R = [
    ["1", "💰", "งบรายรับ-รายจ่าย", () => rptIncome()],
    ["2", "⚖️", "งบดุล (ส่ง 31 ธ.ค.)", () => rptBalance()],
    ["3", "👤", "รายงานรายตัวสมาชิก", () => rptMembers()],
    ["4", "🔕", "ลูกหนี้ค้างชำระ", () => rptDebtors()],
    ["5", "🧾", "สรุปส่งสัจจะเดือนนี้", () => rptMonth()],
    ["6", "🧰", "กองทุนสวัสดิการ", () => rptWelfare()],
    ["7", "🎁", "ปันผลประจำปี", () => ctx.nav("dividend")],
    ["8", "📜", "ตรวจแก้ย้อนหลัง (Audit)", () => ctx.nav("audit")],
  ];
  R.forEach(([n, ic, t, fn]) => tiles.append(h("button", { class: "tile", onclick: fn },
    h("span", { class: "ic" }, ic), h("span", {}, t), h("span", { class: "sub" }, "ข้อ " + n))));
  root.append(h("p", { class: "muted small" }, "เลือกประเภทรายงาน → กดปุ่ม PDF / Excel / CSV ด้านล่างรายงาน"), tiles, yearSel, body);
  paint();

  async function paint() { body.replaceChildren(rptMonth()); }

  /* ---------- งบรายรับ-รายจ่าย ---------- */
  function rptIncome() {
    const y = Number(yearSel.value);
    const ie = incomeExpense(st, y);
    const title = "งบรายรับ-รายจ่าย ปี " + (y + 543) + " — " + st.group.name;
    const rows = [["รายรับ", "จำนวน (฿)", "", "รายจ่าย", "จำนวน (฿)"]];
    const ins = Object.entries(ie.inc), outs = Object.entries(ie.exp);
    for (let i = 0; i < Math.max(ins.length, outs.length); i++)
      rows.push([ins[i] ? ins[i][0] : "", ins[i] ? fmtBaht(ins[i][1]) : "", "", outs[i] ? outs[i][0] : "", outs[i] ? fmtBaht(outs[i][1]) : ""]);
    rows.push(["รวมรายรับ", fmtBaht(ie.totIn), "", "รวมรายจ่าย", fmtBaht(ie.totOut)]);
    rows.push(["", "", "เกิน(+)/ขาด(-)ดุล", fmtBaht(ie.net), ""]);
    const box = h("div", { class: "card" }, h("h3", {}, title), tbl(rows.filter((r) => r.some((c) => c !== ""))),
      h("p", { class: "small muted" }, "* เงินรับฝากออม/หุ้น/ใช้หนี้เงินต้น ไม่นับเป็นรายได้ (เป็นหนี้คืนสมาชิก); ค่าปรับ-สวัสดิการอยู่ในกองทุนสวัสดิการแยกต่างหาก"));
    box.append(reportButtons("รายรับ-รายจ่าย-" + (y + 543), () => ({ title, headerCount: 1, rows })));
    return box;
  }

  /* ---------- งบดุล ---------- */
  function rptBalance() {
    const y = Number(yearSel.value);
    const asOf = y < new Date().getFullYear() ? y + "-12-31" : todayStr();
    const b = balanceSheet(st, asOf);
    const title = "งบดุล ณ " + fmtDate(asOf) + " — " + st.group.name;
    const rows = [["ทรัพย์สิน", "฿", "หนี้สิน/ทุน", "฿"]];
    const L = Object.entries(b.assets).filter(([k]) => k !== "total");
    const Ra = Object.entries(b.liabilities).filter(([k]) => k !== "total");
    for (let i = 0; i < Math.max(L.length, Ra.length); i++) rows.push([L[i] ? L[i][0] : "", L[i] ? fmtBaht(L[i][1]) : "", "", Ra[i] ? Ra[i][0] : "", Ra[i] ? fmtBaht(Ra[i][1]) : ""]);
    rows.push(["รวมทรัพย์สิน", fmtBaht(b.assets.total), "", "รวมหนี้สิน+ทุน", fmtBaht(b.liabilities.total)]);
    const box = h("div", { class: "card" }, h("h3", {}, title),
      h("p", { class: b.balanced ? "ok" : "bad" }, b.balanced ? "✅ 2 ฝ่ายตรงกัน (สมการบัญชีผ่าน)" : "⚠️ 2 ฝ่ายไม่ตรง — ให้ “ตรวจความถูกต้อง” ในหน้า ตั้งค่า"),
      tbl(rows), reportButtons("งบดุล-" + asOf, () => ({ title, headerCount: 1, rows })));
    return box;
  }

  /* ---------- รายตัวสมาชิก ---------- */
  function rptMembers() {
    const ms = st.members.filter((m) => m.status !== "resigned");
    const rows = [["รหัส", "ชื่อ", "ส่งแล้วเดือนนี้(สะสม)", "ค้าง(เดือน)", "ออมสะสม", "หุ้น", "ออมปี", "หนี้กู้คงเหลือ", "สิทธิ์กู้"]];
    for (const m of ms) {
      const t = memberTotals(st, m);
      const e = eligibility(st, m);
      const bal = st.loans.filter((l) => l.member === m.id && l.status === "active").reduce((s, l) => s + loanState(st, l).balance, 0);
      const lates = sajaHistory(st, m).filter((r) => r.status === "late").length;
      rows.push([m.id, m.name, t.saja ? "✅" : "-", lates || "-", t.saja, t.sharesN + " (" + t.shares + "฿)", t.annual, round2(bal), e.can ? "✅" : "🔴"]);
    }
    const title = "รายงานรายตัวสมาชิก ณ " + fmtDate(todayStr());
    const box = h("div", { class: "card" }, h("h3", {}, title), tbl(rows),
      reportButtons("รายตัวสมาชิก", () => ({ title, headerCount: 1, rows })));
    return box;
  }
  const round2 = (x) => Math.round(x * 100) / 100;

  /* ---------- ลูกหนี้ค้างชำระ ---------- */
  function rptDebtors() {
    const y = Number(yearSel.value);
    const list = st.loans.filter((l) => l.status === "active").map((l) => ({ l, s: loanState(st, l) }))
      .filter((x) => x.s.overdueMonths > 0);
    const rows = [["ผู้กู้", "สัญญา", "วัตถุประสงค์", "ค้าง(งวด)", "ยอดค้างรวม", "งวดถัดไป", "ผู้ค้ำ"]];
    list.forEach(({ l, s }) => {
      const unpaid = s.rows.filter((r) => r.due < todayStr() && (r.principal - r.princPaid > 0 || r.fee - r.feePaid > 0));
      const amt = Math.round(unpaid.reduce((ac, r) => ac + (r.principal - r.princPaid) + (r.fee - r.feePaid), 0));
      rows.push([l.name, l.id, (l.purposeTh || "").slice(2) || l.purpose, s.overdueMonths, amt, s.nextDue ? fmtDate(s.nextDue.due) : "-",
        (l.guarantorIds || []).join(", ")]);
    });
    rows.push(["รวม", "", "", "", rows.slice(1).reduce((s, r) => s + (Number(r[4]) || 0), 0), "", ""]);
    const title = "รายงานลูกหนี้ค้างชำระ ณ " + fmtDate(todayStr()) + " — " + st.group.name;
    return h("div", { class: "card" }, h("h3", {}, title),
      !list.length ? h("p", { class: "ok" }, "✅ ไม่มีใครค้างผ่อน — ยอดเยี่ยม") : h("p", { class: "muted small" }, "ติดตามผู้กู้ + แจ้งผู้ค้ำภายใน 7 วัน"),
      tbl(rows), reportButtons("ลูกหนี้ค้างชำระ", () => ({ title, headerCount: 1, rows })));
  }

  /* ---------- สรุปส่งเดือนนี้ ---------- */
  function rptMonth() {
    const ym = curYM();
    const rows = [["รหัส", "สมาชิก", "กติกา(฿)", "สถานะ", "ส่งจริง", "วันที่"]];
    let sent = 0, total = 0, sumAmt = 0;
    st.members.filter((m) => m.status !== "resigned").forEach((m) => {
      const s = sajaHistory(st, m).find((r) => r.ym === ym);
      total++;
      const amt = s ? s.amount : 0;
      if (s && s.status === "sent") { sent++; sumAmt += amt; }
      const t = st.txs.find((x) => x.kind === "saja" && x.member === m.id && x.ym === ym);
      rows.push([m.id, m.name, Number(m.monthly) || st.cfg.sajaMonthly, s ? (s.status === "sent" ? "✅" : s.status === "late" ? "🔴 ค้าง" : "🟡 รอบุ") : "-", amt, t ? fmtDate(t.at) : "-"]);
    });
    rows.push(["", "รวม " + sent + "/" + total + " คน", "", "", sumAmt, ""]);
    const title = "สรุปการส่งเงินสัจจะ " + fmtYM(ym) + " — " + st.group.name;
    return h("div", { class: "card" }, h("h3", {}, title), tbl(rows),
      reportButtons("ส่งสัจจะ-" + ym, () => ({ title, headerCount: 1, rows })));
  }

  /* ---------- สวัสดิการ ---------- */
  function rptWelfare() {
    const y = Number(yearSel.value);
    const w = welfareFund(st);
    const rows = [["หมวด", "รับ (฿)", "จ่าย (฿)"]];
    const cats = { "ค่าปรับ": [0, 0], "เงินบริจาค/อุดหนุน": [0, 0], "ฌาปนกิจ": [0, 0], "เจ็บป่วย(คืน)": [0, 0], "ทุนการศึกษา": [0, 0], "ภัยพิบัติ": [0, 0], "อื่น": [0, 0] };
    const key = (t) => t.cat;
    st.txs.filter((t) => ["welfare_in", "welfare_out", "fine"].includes(t.kind) && Number((t.at || "").slice(0, 4)) === y)
      .forEach((t) => {
        const c = t.kind === "fine" && t.received ? "ค่าปรับ" : t.kind === "fine" ? null : t.kind === "welfare_in" ? "เงินบริจาค/อุดหนุน"
          : t.cat === "cremation" ? "ฌาปนกิจ" : t.cat === "sick" ? "เจ็บป่วย(คืน)" : t.cat === "scholarship" ? "ทุนการศึกษา" : t.cat === "disaster" ? "ภัยพิบัติ" : "อื่น";
        if (!c) return;
        if (t.kind === "welfare_out") cats[c][1] += (t.amount); else cats[c][0] += t.amount;
      });
    Object.entries(cats).forEach(([c, v]) => { if (v[0] || v[1]) rows.push([c, round2(v[0]), round2(v[1])]); });
    rows.push(["คงเหลือกองทุน (ทุกปีสะสม)", "", w.balance]);
    const title = "รายงานกองทุนสวัสดิการ ปี " + (y + 543);
    return h("div", { class: "card" }, h("h3", {}, title), tbl(rows),
      reportButtons("สวัสดิการ-" + (y + 543), () => ({ title, headerCount: 1, rows })));
  }
  const received = (t) => t.received;
}
