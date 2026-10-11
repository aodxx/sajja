#!/usr/bin/env python3
"""make-manual.py — แปลง docs/manual-th.md → PDF A4.fonต์ไทยใหญ่ สไตล์ เป็นกันเองผู้สูงอายุ
ใช้: python3 scripts/make-manual.py"""
import re, os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak)
from reportlab.lib.styles import ParagraphStyle

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
pdfmetrics.registerFont(TTFont("Sarabun", os.path.join(ROOT, "docs/fonts/Sarabun-Regular.ttf")))
pdfmetrics.registerFont(TTFont("Sarabun-B", os.path.join(ROOT, "docs/fonts/Sarabun-Bold.ttf")))
pdfmetrics.registerFontFamily("Sarabun", normal="Sarabun", bold="Sarabun-B")

TEAL = colors.HexColor("#0f766e"); TEALL = colors.HexColor("#e6f4f1")
INK = colors.HexColor("#134e4a"); MUTED = colors.HexColor("#5f7a75")

def st(name, size, bold=False, color=INK, before=0, after=4, leading=None, align=0):
    return ParagraphStyle(name, fontName="Sarabun-B" if bold else "Sarabun",
                          fontSize=size, leading=leading or size * 1.65, textColor=color,
                          spaceBefore=before, spaceAfter=after, alignment=align)

S = {
    "h1": st("h1", 22, True, TEAL, 0, 2),
    "sub": st("sub", 12.5, False, MUTED, 0, 14),
    "h2": st("h2", 16, True, TEAL, 14, 6),
    "h3": st("h3", 13, True, INK, 8, 4),
    "p": st("p", 12),
    "li": st("li", 12, after=2),
    "tip": st("tip", 11.5, color=MUTED, after=8),
    "note": st("note", 12, color=colors.HexColor("#92400e"), after=8),
}

def bold_md(t):
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"`(.+?)`", r"<font face='Sarabun' color='#0f766e'>\1</font>", t)
    return t

def parse(md):
    story, lines, i = [], md.split("\n"), 0
    while i < len(lines):
        ln = lines[i].rstrip()
        if not ln.strip(): i += 1; continue
        if ln.startswith("## "): story.append(Paragraph(bold_md(ln[3:]), S["h2"]))
        elif ln.startswith("### "): story.append(Paragraph(bold_md(ln[4:]), S["h3"]))
        elif ln.startswith("# "): story.append(Paragraph(bold_md(ln[2:]), S["h1"]))
        elif ln.startswith("> ") or ln.startswith("*จำง่าย") or ln.startswith("*ถ้า") or ln.startswith("หมายเหตุ:"):
            story.append(Paragraph(bold_md(ln.lstrip("> ")), S["tip"]))
        elif ln.startswith("— จบคู่มือ") or ln.startswith("*— จบ"): story.append(Spacer(1, 8))
        elif re.match(r"^\d+\.\s", ln):
            story.append(Paragraph(bold_md(ln), S["li"], bulletText=""))
        elif ln.startswith("- "):
            story.append(Paragraph(bold_md(ln[2:]), S["li"], bulletText="•"))
        elif ln.startswith("|") and i + 1 < len(lines) and set(lines[i + 1].replace("|", "").replace(" ", "")) <= set("-:"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [bold_md(c.strip()) for c in lines[i].strip("|").split("|")]
                rows.append(cells); i += 1
            rows.pop(1)
            w = [195 * mm / max(2, len(rows[0]))] * len(rows[0])
            t = Table(rows, colWidths=w, repeatRows=1)
            t.setStyle(TableStyle([
                ("FONTNAME", (0, 0), (-1, -1), "Sarabun"), ("FONTSIZE", (0, 0), (-1, -1), 11),
                ("BACKGROUND", (0, 0), (-1, 0), TEALL), ("TEXTCOLOR", (0, 0), (-1, -1), INK),
                ("GRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#94a3b8")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LINEBELOW", (0, 0), (-1, 0), 1.2, TEAL),
            ]))
            story.append(t); story.append(Spacer(1, 6)); continue
        elif ln.startswith("**") and ln.rstrip("*").endswith(":"): story.append(Paragraph(bold_md(ln), S["note"]))
        elif ln.startswith("## ") is False and ln.startswith("---"): story.append(Spacer(1, 2))
        else: story.append(Paragraph(bold_md(ln), S["p"]))
        i += 1
    return story

def header_footer(canvas, doc):
    canvas.saveState()
    frame = getattr(doc, "_topFrame", None)
    canvas.setStrokeColor(TEALL); canvas.setLineWidth(3)
    canvas.line(18 * mm, 281 * mm, 192 * mm, 281 * mm)
    canvas.setFont("Sarabun-B", 9); canvas.setFillColor(TEAL)
    canvas.drawString(18 * mm, 286 * mm, "คู่มือระบบเงินสัจจะชุมชน")
    canvas.setFont("Sarabun", 9); canvas.setFillColor(MUTED)
    canvas.drawRightString(192 * mm, 12 * mm, f"หน้า {doc.page}")
    canvas.restoreState()

md = open(os.path.join(ROOT, "docs/manual-th.md"), encoding="utf-8").read()
# หน้าปกเล็กน้อย + คำนำ
md = ("# คู่มือการใช้งาน ระบบเงินสัจจะชุมชน\n"
      "### สำหรับคณะกรรมการกลุ่มออมทรัพย์ — เหรัญญิก · เลขานุการ · ผู้ตรวจสอบ\n"
      "เวอร์ชันแอป 1.0.0 · ใช้ได้ทั้งออฟไลน์และออนไลน์ · อ่านออกเสียงได้: ใช้โทรศัพท์ถ่ายรูปหน้าจอก็เรียกผู้ช่วยอ่านได้\n\n") + re.sub(r"^# .*\n^###? .*\n\n", "", md, count=1, flags=re.M)

doc = SimpleDocTemplate(os.path.join(ROOT, "docs/manual-th.pdf"), pagesize=A4,
                        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=20 * mm, bottomMargin=16 * mm,
                        title="คู่มือระบบเงินสัจจะชุมชน", author="QwenWork")
doc.build([Paragraph("กลุ่มออมทรัพย์แห่งประเทศไทย 🇹🇭", S["sub"])] + parse(md), header_footer)
print("✅ docs/manual-th.pdf สร้างแล้ว")
