#!/usr/bin/env python3
"""
Diagnostic Precision — Visual Design Canvas for Meridian Intelligence Dashboard
Generates a single-page PDF expressing the design philosophy as a visual reference.
"""
import math
from reportlab.lib.pagesizes import A3
from reportlab.lib.colors import HexColor, Color
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ─── Fonts ──────────────────────────────────────────
FONT_DIR = "/Users/avi/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/02d4e008-6569-4d48-b1f6-c1aa0c5357a4/61eac48d-5933-41d2-954a-965701ed89ec/skills/canvas-design/canvas-fonts/"
pdfmetrics.registerFont(TTFont('InstrumentSans', FONT_DIR + 'InstrumentSans-Regular.ttf'))
pdfmetrics.registerFont(TTFont('InstrumentSans-Bold', FONT_DIR + 'InstrumentSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('JetBrainsMono', FONT_DIR + 'JetBrainsMono-Regular.ttf'))
pdfmetrics.registerFont(TTFont('JetBrainsMono-Bold', FONT_DIR + 'JetBrainsMono-Bold.ttf'))
pdfmetrics.registerFont(TTFont('GeistMono', FONT_DIR + 'GeistMono-Regular.ttf'))

# ─── Colors ─────────────────────────────────────────
INK = HexColor('#0f1114')
INK2 = HexColor('#1a1d23')
INK3 = HexColor('#282c35')
PAPER = HexColor('#fafaf8')
PAPER2 = HexColor('#f3f2ee')
PAPER3 = HexColor('#eae8e3')
WHITE = HexColor('#ffffff')
RED = HexColor('#dc2626')
RED_BG = HexColor('#fef2f2')
AMBER = HexColor('#d97706')
AMBER_BG = HexColor('#fffbeb')
BLUE = HexColor('#2563eb')
BLUE_BG = HexColor('#eff6ff')
GREEN = HexColor('#16a34a')
GREEN_BG = HexColor('#f0fdf4')
TEXT2 = HexColor('#3d424d')
TEXT3 = HexColor('#6b7080')
TEXT4 = HexColor('#9ca1ad')
BORDER = HexColor('#ddd9d2')

W, H = A3  # 297mm x 420mm
OUT = "/Users/avi/Downloads/Claude/Projects/Projects/meridian-anaplan/meridian-design-canvas.pdf"

c = canvas.Canvas(OUT, pagesize=A3)

# ═══════════════════════════════════════════════════
#  LAYER 1: Dark geological stratum (top 30%)
# ═══════════════════════════════════════════════════
dark_h = H * 0.28
c.setFillColor(INK)
c.rect(0, H - dark_h, W, dark_h, fill=1, stroke=0)

# Subtle radial glow (blue, top-right)
c.saveState()
for i in range(40):
    alpha = 0.015 * (1 - i/40)
    c.setFillColor(Color(0.15, 0.39, 0.92, alpha))
    r = 120 - i * 2.5
    c.circle(W * 0.78, H - dark_h * 0.35, r * mm * 0.3, fill=1, stroke=0)
c.restoreState()

# Subtle radial glow (red, bottom-left of dark zone)
c.saveState()
for i in range(30):
    alpha = 0.01 * (1 - i/30)
    c.setFillColor(Color(0.86, 0.15, 0.15, alpha))
    r = 80 - i * 2
    c.circle(W * 0.15, H - dark_h * 0.8, r * mm * 0.3, fill=1, stroke=0)
c.restoreState()

# ─── Breadcrumb ────────────────────────────────────
y_bread = H - 38
c.setFillColor(Color(1,1,1,0.25))
c.setFont('GeistMono', 7)
c.drawString(32, y_bread, "SUPPLY CHAIN PLANNING  ·  MODEL INTELLIGENCE")

# ─── Title ─────────────────────────────────────────
y_title = y_bread - 36
c.setFillColor(WHITE)
c.setFont('InstrumentSans-Bold', 28)
c.drawString(32, y_title, "15 modules need attention")
y_title2 = y_title - 34
c.drawString(32, y_title2, "across ")
# "214" in amber
w_across = c.stringWidth("across ", 'InstrumentSans-Bold', 28)
c.setFillColor(AMBER)
c.drawString(32 + w_across, y_title2, "214")
w_214 = c.stringWidth("214", 'InstrumentSans-Bold', 28)
c.setFillColor(WHITE)
c.drawString(32 + w_across + w_214, y_title2, " analysed")

# ─── Description ───────────────────────────────────
y_desc = y_title2 - 22
c.setFillColor(Color(1,1,1,0.4))
c.setFont('InstrumentSans', 10)
c.drawString(32, y_desc, "Deterministic analysis of every formula, dependency, and aggregation")
c.drawString(32, y_desc - 14, "pattern. Issues ranked by blast radius — downstream outputs affected.")

# ─── Tags ──────────────────────────────────────────
y_tags = y_desc - 40
tags = ["NAMING: CLIENT-PREFIX", "FORMULA RISK: HIGH", "EVIDENCE: QUALIFIED"]
x_tag = 32
for tag in tags:
    tw = c.stringWidth(tag, 'GeistMono', 6.5) + 14
    # pill outline
    c.setStrokeColor(Color(1,1,1,0.12))
    c.setLineWidth(0.5)
    c.setFillColor(Color(1,1,1,0.03))
    c.roundRect(x_tag, y_tags - 4, tw, 16, 8, fill=1, stroke=1)
    c.setFillColor(Color(1,1,1,0.35))
    c.setFont('GeistMono', 6.5)
    c.drawString(x_tag + 7, y_tags, tag)
    x_tag += tw + 8

# ═══════════════════════════════════════════════════
#  SCORE RING — right side of dark stratum
# ═══════════════════════════════════════════════════
cx_ring = W - 100
cy_ring = H - dark_h * 0.45
ring_r = 55

# Track
c.setStrokeColor(Color(1,1,1,0.06))
c.setLineWidth(6)
c.setLineCap(1)
# Draw arc as a series of segments
for i in range(360):
    angle = math.radians(i - 90)
    x1 = cx_ring + ring_r * math.cos(angle)
    y1 = cy_ring + ring_r * math.sin(angle)
    c.setFillColor(Color(1,1,1,0.06))
    c.circle(x1, y1, 3, fill=1, stroke=0)

# Filled arc (91% of 360 = 327.6 degrees)
fill_degrees = 327.6
c.setFillColor(GREEN)
for i in range(int(fill_degrees)):
    angle = math.radians(i - 90)
    x1 = cx_ring + ring_r * math.cos(angle)
    y1 = cy_ring + ring_r * math.sin(angle)
    c.circle(x1, y1, 3, fill=1, stroke=0)

# Score number
c.setFillColor(WHITE)
c.setFont('InstrumentSans-Bold', 44)
c.drawCentredString(cx_ring, cy_ring - 8, "91")
c.setFillColor(Color(1,1,1,0.22))
c.setFont('GeistMono', 9)
c.drawCentredString(cx_ring, cy_ring - 22, "/100")
c.setFillColor(Color(1,1,1,0.25))
c.setFont('GeistMono', 6)
c.drawCentredString(cx_ring, cy_ring - 36, "HEALTH")

# ═══════════════════════════════════════════════════
#  LAYER 2: KPI Bridge — overlapping transition zone
# ═══════════════════════════════════════════════════
kpi_y = H - dark_h - 18
kpi_h = 62
kpi_x = 32
kpi_w = W - 64
cell_w = kpi_w / 4

# Shadow
c.setFillColor(Color(0,0,0,0.06))
c.roundRect(kpi_x + 2, kpi_y - 4, kpi_w, kpi_h, 8, fill=1, stroke=0)

# KPI cells with 1px gaps
kpis = [
    ("214", "MODULES", INK, PAPER3),
    ("33", "CRITICAL", RED, HexColor('#fecaca')),
    ("31", "HIGH", AMBER, HexColor('#fde68a')),
    ("58", "CLEAN", GREEN, HexColor('#bbf7d0')),
]
for i, (val, label, color, micro_color) in enumerate(kpis):
    cx = kpi_x + i * cell_w + (1 if i > 0 else 0)
    cw = cell_w - (1 if i < 3 else 0)
    # Cell bg
    c.setFillColor(WHITE)
    if i == 0:
        c.roundRect(cx, kpi_y, cw, kpi_h, 8, fill=1, stroke=0)
        # Mask right corners
        c.rect(cx + cw - 8, kpi_y, 8, kpi_h, fill=1, stroke=0)
    elif i == 3:
        c.roundRect(cx, kpi_y, cw, kpi_h, 8, fill=1, stroke=0)
        c.rect(cx, kpi_y, 8, kpi_h, fill=1, stroke=0)
    else:
        c.rect(cx, kpi_y, cw, kpi_h, fill=1, stroke=0)

    # Value
    c.setFillColor(color)
    c.setFont('InstrumentSans-Bold', 26)
    c.drawCentredString(cx + cw/2, kpi_y + kpi_h - 26, val)
    # Label
    c.setFillColor(TEXT4)
    c.setFont('GeistMono', 6.5)
    c.drawCentredString(cx + cw/2, kpi_y + kpi_h - 40, label)
    # Micro bar
    bar_w = 36
    c.setFillColor(micro_color)
    c.roundRect(cx + cw/2 - bar_w/2, kpi_y + 6, bar_w, 2.5, 1.25, fill=1, stroke=0)

# ═══════════════════════════════════════════════════
#  Distribution bar
# ═══════════════════════════════════════════════════
dist_y = kpi_y - 20
dist_x = 32
dist_w = W - 64
bar_h = 5

segments = [(0.154, RED), (0.145, AMBER), (0.43, BLUE), (0.271, PAPER3)]
sx = dist_x
for pct, col in segments:
    seg_w = dist_w * pct - 1.5
    c.setFillColor(col)
    c.roundRect(sx, dist_y, seg_w, bar_h, 2.5, fill=1, stroke=0)
    sx += seg_w + 2

# Legend
leg_y = dist_y - 14
leg_items = [("Critical 33", RED), ("High 31", AMBER), ("Medium 92", BLUE), ("Clean 58", PAPER3)]
lx = W - 64
for label, col in reversed(leg_items):
    tw = c.stringWidth(label, 'GeistMono', 6.5)
    c.setFont('GeistMono', 6.5)
    c.setFillColor(TEXT4)
    c.drawString(lx - tw, leg_y, label)
    c.setFillColor(col)
    c.circle(lx - tw - 6, leg_y + 3, 2, fill=1, stroke=0)
    lx = lx - tw - 18

# ═══════════════════════════════════════════════════
#  Section: Highest-Risk Modules
# ═══════════════════════════════════════════════════
sect_y = dist_y - 38
c.setFillColor(INK)
c.setFont('InstrumentSans-Bold', 11)
c.drawString(32, sect_y, "Highest-Risk Modules")
c.setFillColor(TEXT4)
c.setFont('GeistMono', 7)
c.drawRightString(W - 32, sect_y, "8 of 156")
# 2px rule
c.setFillColor(INK)
c.rect(32, sect_y - 6, W - 64, 2, fill=1, stroke=0)

# ─── Module table ──────────────────────────────────
tbl_y = sect_y - 22
tbl_x = 32
tbl_w = W - 64
row_h = 28

# Header
c.setFillColor(PAPER2)
c.roundRect(tbl_x, tbl_y - 16, tbl_w, 18, 0, fill=1, stroke=0)
c.setFont('GeistMono', 5.5)
c.setFillColor(TEXT4)
c.drawString(tbl_x + 8, tbl_y - 12, "MODULE")
c.drawString(tbl_x + tbl_w * 0.55, tbl_y - 12, "SEVERITY")
c.drawString(tbl_x + tbl_w * 0.72, tbl_y - 12, "ITEMS")
c.drawString(tbl_x + tbl_w * 0.82, tbl_y - 12, "RATING")

# Rows
modules = [
    ("DEM06 – Opportunity Management", 0.92, "92", "CRITICAL", RED),
    ("SLP05 – Slots", 0.85, "58", "CRITICAL", RED),
    ("MOD01 – General Settings", 0.72, "48", "CRITICAL", RED),
    ("DCW03 – Stat Calculations", 0.96, "195", "CRITICAL", RED),
    ("SUP04 – Calculations Weekly", 0.65, "120", "HIGH", AMBER),
    ("Income Statement", 0.42, "45", "MEDIUM", BLUE),
]

ry = tbl_y - 20
for name, sev_pct, items, rating, color in modules:
    # Left accent
    c.setFillColor(color)
    c.rect(tbl_x, ry - row_h + 8, 3, row_h - 4, fill=1, stroke=0)

    # Name
    c.setFillColor(INK)
    c.setFont('InstrumentSans-Bold', 9.5)
    c.drawString(tbl_x + 10, ry, name)

    # Severity meter
    meter_x = tbl_x + tbl_w * 0.55
    meter_w = 60
    # Track
    c.setFillColor(PAPER3)
    c.roundRect(meter_x, ry - 1, meter_w, 4, 2, fill=1, stroke=0)
    # Fill
    c.setFillColor(color)
    c.roundRect(meter_x, ry - 1, meter_w * sev_pct, 4, 2, fill=1, stroke=0)

    # Items
    c.setFillColor(TEXT3)
    c.setFont('GeistMono', 7.5)
    c.drawString(tbl_x + tbl_w * 0.72, ry, items)

    # Badge
    badge_x = tbl_x + tbl_w * 0.82
    badge_w = c.stringWidth(rating, 'GeistMono', 5.5) + 10
    c.setFillColor(color)
    c.roundRect(badge_x, ry - 3, badge_w, 12, 3, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont('GeistMono', 5.5)
    c.drawString(badge_x + 5, ry, rating)

    # Row separator
    c.setFillColor(PAPER3)
    c.rect(tbl_x, ry - row_h + 6, tbl_w, 0.5, fill=1, stroke=0)

    ry -= row_h

# ═══════════════════════════════════════════════════
#  Expanded detail for first module
# ═══════════════════════════════════════════════════
# Show a sample issue card below first row
detail_y = tbl_y - 20 - row_h + 6
# We'll skip this for visual clarity and jump to lower sections

# ═══════════════════════════════════════════════════
#  Risk Clusters
# ═══════════════════════════════════════════════════
rc_y = ry - 20
c.setFillColor(INK)
c.setFont('InstrumentSans-Bold', 11)
c.drawString(32, rc_y, "Risk Clusters")
c.rect(32, rc_y - 6, W - 64, 2, fill=1, stroke=0)

clusters = [
    ("Rename of 'Actual' in Versions", "12 items across 5 modules", "CRITICAL", RED),
    ("Connected modules with critical findings", "340 items across 4 modules", "HIGH", AMBER),
]
cy_c = rc_y - 24
for name, meta, rating, color in clusters:
    # Card
    c.setFillColor(WHITE)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.roundRect(32, cy_c - 14, W - 64, 30, 6, fill=1, stroke=1)
    # Accent
    c.setFillColor(color)
    c.rect(32, cy_c - 14, 3, 30, fill=1, stroke=0)
    # Text
    c.setFillColor(INK)
    c.setFont('InstrumentSans-Bold', 9)
    c.drawString(42, cy_c + 4, name)
    c.setFillColor(TEXT3)
    c.setFont('GeistMono', 6.5)
    c.drawString(42, cy_c - 6, meta)
    # Badge
    bw = c.stringWidth(rating, 'GeistMono', 5.5) + 10
    c.setFillColor(color)
    c.roundRect(W - 32 - bw - 8, cy_c - 1, bw, 12, 3, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont('GeistMono', 5.5)
    c.drawString(W - 32 - bw - 3, cy_c + 2, rating)
    cy_c -= 36

# ═══════════════════════════════════════════════════
#  Two-col: Fix Order + Bottlenecks
# ═══════════════════════════════════════════════════
twocol_y = cy_c - 10
col_w = (W - 64 - 20) / 2

# Fix Order panel
c.setFillColor(WHITE)
c.setStrokeColor(BORDER)
c.setLineWidth(0.5)
c.roundRect(32, twocol_y - 140, col_w, 150, 8, fill=1, stroke=1)
c.setFillColor(TEXT4)
c.setFont('GeistMono', 6.5)
c.drawString(44, twocol_y - 2, "RECOMMENDED FIX ORDER")
c.setFillColor(PAPER3)
c.rect(44, twocol_y - 10, col_w - 24, 0.5, fill=1, stroke=0)

steps = [
    ("1", ["SLP05 – Slots", "MOD01 – General…"], "+28"),
    ("2", ["Income Statement", "SLP01 – Slot Hours"], "+10"),
    ("3", ["SUP04 – Calc W…", "SUP15 – SO View"], ""),
    ("4", ["SUP07 – Alerts", "SUP21 – Supply…"], ""),
]
sy = twocol_y - 24
for num, pills, overflow in steps:
    # Number circle
    c.setFillColor(INK)
    c.circle(52, sy + 3, 8, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont('GeistMono', 6)
    c.drawCentredString(52, sy + 1, num)
    # Connector line
    if num != "4":
        c.setFillColor(PAPER3)
        c.rect(51.5, sy - 22, 1, 18, fill=1, stroke=0)
    # Pills
    px = 66
    for pill in pills:
        pw = c.stringWidth(pill, 'InstrumentSans', 7) + 12
        c.setFillColor(PAPER)
        c.setStrokeColor(BORDER)
        c.roundRect(px, sy - 3, pw, 14, 3, fill=1, stroke=1)
        c.setFillColor(TEXT2)
        c.setFont('InstrumentSans', 7)
        c.drawString(px + 6, sy, pill)
        px += pw + 4
    if overflow:
        c.setFillColor(TEXT4)
        c.setFont('GeistMono', 6)
        c.drawString(px, sy, overflow)
    # Tag
    c.setFillColor(BLUE)
    c.setFont('GeistMono', 5)
    c.drawString(66, sy - 11, "PARALLEL")
    sy -= 30

# Bottlenecks panel
bx = 32 + col_w + 20
c.setFillColor(WHITE)
c.setStrokeColor(BORDER)
c.setLineWidth(0.5)
c.roundRect(bx, twocol_y - 140, col_w, 150, 8, fill=1, stroke=1)
c.setFillColor(TEXT4)
c.setFont('GeistMono', 6.5)
c.drawString(bx + 12, twocol_y - 2, "BOTTLENECKS")
c.setFillColor(PAPER3)
c.rect(bx + 12, twocol_y - 10, col_w - 24, 0.5, fill=1, stroke=0)

bottlenecks = [
    ("DCW03", "History", 33, 40),
    ("DEM06", "Product", 30, 36),
    ("MOD01", "Current Period", 28, 33),
    ("SLP05", "Product", 24, 29),
    ("DEM06", "Customer", 22, 26),
]
by = twocol_y - 24
for mod, item, fan, bar_w in bottlenecks:
    c.setFillColor(INK)
    c.setFont('InstrumentSans-Bold', 8)
    c.drawString(bx + 12, by, mod)
    w_mod = c.stringWidth(mod, 'InstrumentSans-Bold', 8)
    c.setFillColor(TEXT2)
    c.setFont('InstrumentSans', 8)
    c.drawString(bx + 12 + w_mod, by, "." + item)
    # Bar
    c.setFillColor(BLUE)
    c.roundRect(bx + col_w - 70, by - 1, bar_w, 4, 2, fill=1, stroke=0)
    c.setFillColor(TEXT4)
    c.setFont('GeistMono', 6)
    c.drawString(bx + col_w - 24, by, str(fan) + " out")
    # Separator
    c.setFillColor(PAPER3)
    c.rect(bx + 12, by - 10, col_w - 24, 0.5, fill=1, stroke=0)
    by -= 22

# ═══════════════════════════════════════════════════
#  Evidence Boundaries
# ═══════════════════════════════════════════════════
ev_y = twocol_y - 168
c.setFillColor(INK)
c.setFont('InstrumentSans-Bold', 11)
c.drawString(32, ev_y, "Evidence Boundaries")
c.rect(32, ev_y - 6, W - 64, 2, fill=1, stroke=0)

# Evidence card
c.setFillColor(PAPER2)
c.setStrokeColor(BORDER)
c.setLineWidth(0.5)
c.roundRect(32, ev_y - 100, W - 64, 88, 8, fill=1, stroke=1)

# Confirmed column
c.setFillColor(GREEN)
c.setFont('InstrumentSans-Bold', 8)
c.drawString(48, ev_y - 20, "✓  Confirmed")
confirmed = [
    "Formula-level dependencies between all line items",
    "Exact blast radius for any change",
    "Hardcoded references that break on rename",
    "Dimensional flow and aggregation patterns",
]
ey = ev_y - 34
c.setFont('InstrumentSans', 7.5)
for item in confirmed:
    c.setFillColor(GREEN)
    c.circle(52, ey + 3, 1.5, fill=1, stroke=0)
    c.setFillColor(TEXT3)
    c.drawString(58, ey, item)
    ey -= 13

# Cannot determine column
mid_x = W / 2 + 16
c.setFillColor(TEXT4)
c.setFont('InstrumentSans-Bold', 8)
c.drawString(mid_x, ev_y - 20, "—  Cannot determine")
cannot = [
    "Actual recalculation performance or memory usage",
    "Whether a finding is intentional",
    "Cell count without Polaris/HyperConnect metadata",
    "User-facing page layout and dashboard config",
]
ey = ev_y - 34
c.setFont('InstrumentSans', 7.5)
for item in cannot:
    c.setFillColor(Color(0.61, 0.63, 0.68, 0.3))
    c.circle(mid_x + 4, ey + 3, 1.5, fill=1, stroke=0)
    c.setFillColor(TEXT4)
    c.drawString(mid_x + 10, ey, item)
    ey -= 13

# ═══════════════════════════════════════════════════
#  Philosophy watermark
# ═══════════════════════════════════════════════════
c.setFillColor(Color(0,0,0,0.04))
c.setFont('InstrumentSans-Bold', 6)
c.drawString(32, 16, "DIAGNOSTIC PRECISION  ·  MERIDIAN INTELLIGENCE  ·  DESIGN CANVAS V1")

c.save()
print(f"✓ Canvas saved to {OUT}")
