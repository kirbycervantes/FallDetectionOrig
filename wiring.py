"""Cirkit/Tinkercad-style wiring diagram for the ESP32-C3 fall-detection wearable.
Units are arbitrary drawing units (canvas 270 x 172). Run: python wiring.py"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Circle, Rectangle, Polygon
import matplotlib.patheffects as pe

W, H = 270, 172
fig = plt.figure(figsize=(27, 17.2), dpi=100)
ax = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, W); ax.set_ylim(0, H); ax.set_aspect('equal'); ax.axis('off')
fig.patch.set_facecolor('#f6f8fb')

# dotted grid like an online circuit editor
for gx in range(0, W + 1, 4):
    for gy in range(0, H + 1, 4):
        ax.plot(gx, gy, '.', color='#d5dbe5', ms=1.6, zorder=0)

FONT = 'DejaVu Sans'
PIN = '#d9b44a'
pins = {}

def T(x, y, s, size=9, color='white', weight='normal', ha='center', va='center', rot=0, z=6):
    ax.text(x, y, s, fontsize=size, color=color, weight=weight, ha=ha, va=va, rotation=rot,
            family=FONT, zorder=z)

def board(key, x, y, w, h, color, title, sub=None, pinlist=(), tcol='white', title_at=None):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle='round,pad=0,rounding_size=1.6',
                                fc=color, ec='#1d2433', lw=1.4, zorder=3))
    tx, ty = title_at or (x + w / 2, y + h - 3.2)
    T(tx, ty, title, 10.5, tcol, 'bold')
    if sub:
        T(tx, ty - 3.2, sub, 7.5, tcol)
    for name, side, pos in pinlist:
        if side == 'L':   px, py, lx, ly, ha = x, pos, x + 1.6, pos, 'left'
        elif side == 'R': px, py, lx, ly, ha = x + w, pos, x + w - 1.6, pos, 'right'
        elif side == 'T': px, py, lx, ly, ha = pos, y + h, pos, y + h - 2.6, 'center'
        else:             px, py, lx, ly, ha = pos, y, pos, y + 2.6, 'center'
        ax.add_patch(Rectangle((px - 0.9, py - 0.9), 1.8, 1.8, fc=PIN, ec='#7a5d10', lw=0.6, zorder=4))
        T(lx, ly, name, 6.8, tcol, 'bold', ha=ha, rot=90 if side in 'TB' else 0)
        pins[f'{key}.{name}'] = (px, py)
    return (x, y, w, h)

def P(k):
    return pins[k]

def wire(pts, color, lw=2.6, z=2):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    ax.plot(xs, ys, color=color, lw=lw, solid_joinstyle='round', solid_capstyle='round', zorder=z,
            path_effects=[pe.Stroke(linewidth=lw + 2.6, foreground='white'), pe.Normal()])

def dot(x, y, color):
    ax.add_patch(Circle((x, y), 0.9, fc=color, ec='white', lw=0.8, zorder=5))

def route(a, b, via, color, lw=2.6, dots=()):
    """a, b: pin keys or points; via: list of intermediate points"""
    pa = P(a) if isinstance(a, str) else a
    pb = P(b) if isinstance(b, str) else b
    wire([pa, *via, pb], color, lw)
    for d in dots:
        dot(*d, color)

RED, BLK, ORG = '#e0322b', '#20242c', '#f08a1c'   # 5V, GND, 3V3
C = dict(sda='#2f7de1', scl='#8e44ad', tx='#16a085', rx='#d4ac0d', btn1='#c0392b', btn2='#e6b800',
         led='#ec407a', buz='#6d4c41', vib='#00838f', aud='#5e35b1', spk='#7cb342', bat='#e0322b')

# ---------------- power rails (top + bottom, like a breadboard) ----------------
RAILS_TOP = {'5V': 166, 'GND': 161, '3V3': 156}
RAILS_BOT = {'5V': 6, 'GND': 11, '3V3': 16}
RX0, RX1 = 66, 262
for rails in (RAILS_TOP, RAILS_BOT):
    for n, y in rails.items():
        col = {'5V': RED, 'GND': BLK, '3V3': ORG}[n]
        ax.add_patch(FancyBboxPatch((RX0, y - 1.3), RX1 - RX0, 2.6, boxstyle='round,pad=0,rounding_size=1.2',
                                    fc=col, ec='none', alpha=0.18, zorder=1))
        ax.plot([RX0 + 1, RX1 - 1], [y, y], color=col, lw=3.2, zorder=1.5, solid_capstyle='round')
        T(RX0 - 1.5, y, {'5V': '+5V', 'GND': 'GND', '3V3': '+3.3V'}[n], 8.5, col, 'bold', ha='right')
# tie top and bottom rails together on the right edge
for i, n in enumerate(['5V', 'GND', '3V3']):
    col = {'5V': RED, 'GND': BLK, '3V3': ORG}[n]
    x = RX1 + 1.5 + i * 2.2
    wire([(RX1 - 2, RAILS_TOP[n]), (x, RAILS_TOP[n]), (x, RAILS_BOT[n]), (RX1 - 2, RAILS_BOT[n])], col, 2.2)
    dot(RX1 - 2, RAILS_TOP[n], col); dot(RX1 - 2, RAILS_BOT[n], col)

# ---------------- ESP32-C3 SuperMini ----------------
EX, EY, EW, EH = 120, 64, 24, 46
Lp = ['5V', 'GND', '3V3', '4', '3', '2', '1', '0']
Rp = ['5', '6', '7', '8', '9', '10', '20', '21']
board('ESP', EX, EY, EW, EH, '#1b1d22', 'ESP32-C3', 'SuperMini',
      [(n if not n.isdigit() else f'G{n}', 'L', 104 - 4 * i) for i, n in enumerate(Lp)] +
      [(f'G{n}', 'R', 104 - 4 * i) for i, n in enumerate(Rp)], title_at=(EX + EW / 2, EY + 6.5))
ax.add_patch(FancyBboxPatch((EX + 7.5, EY + EH - 1.5), 9, 4, boxstyle='round,pad=0,rounding_size=1',
                            fc='#c9ccd2', ec='#6b7280', lw=1, zorder=4))
T(EX + 12, EY + EH + 3.6, 'USB-C', 7, '#4b5563', 'bold')
ax.add_patch(Rectangle((EX + 8, EY + 22), 8, 8, fc='#2d3038', ec='#4b5563', lw=1, zorder=4, angle=0))
T(EX + 12, EY + 26, 'C3', 7, '#9aa3b2', 'bold')

# ESP power -> top rails
route('ESP.5V', (116, RAILS_TOP['5V']), [(116, 104)], RED, dots=[(116, RAILS_TOP['5V'])])
route('ESP.GND', (114, RAILS_TOP['GND']), [(114, 100)], BLK, dots=[(114, RAILS_TOP['GND'])])
route('ESP.3V3', (112, RAILS_TOP['3V3']), [(112, 96)], ORG, dots=[(112, RAILS_TOP['3V3'])])

# ---------------- power section (top-left) ----------------
board('BAT', 4, 140, 50, 16, '#2b2f36', '18650 Battery Holder', '3.7 V Li-ion', [('+', 'B', 12), ('−', 'B', 22)])
ax.add_patch(FancyBboxPatch((9, 143.5), 40, 6, boxstyle='round,pad=0,rounding_size=2.8',
                            fc='#3a7bd5', ec='#1d2433', lw=1, zorder=4))
T(29, 146.5, '18650  3.7V', 7.5, 'white', 'bold')
board('TP', 4, 112, 26, 18, '#1f5fbf', 'TP4056', 'Type-C charger',
      [('B+', 'T', 12), ('B−', 'T', 22), ('OUT+', 'R', 125), ('OUT−', 'R', 117)])
ax.add_patch(Rectangle((2.4, 117), 4, 7, fc='#c9ccd2', ec='#6b7280', lw=1, zorder=5))
T(4.4, 113.6, 'USB-C', 5.5, 'white', 'bold')
board('MT', 38, 112, 22, 18, '#1f5fbf', 'MT3608', 'boost → 5 V',
      [('VIN+', 'L', 125), ('VIN−', 'L', 117), ('VOUT+', 'R', 125), ('VOUT−', 'R', 117)])
ax.add_patch(Rectangle((46, 113.5), 6, 4.5, fc='#2b67d6', ec='#9fc0ff', lw=0.8, zorder=4))
board('IND', 38, 90, 22, 12, '#263238', 'Battery Level', 'Indicator 3.7 V', [('+', 'T', 44), ('−', 'T', 52)])
for i, c in enumerate(['#e53935', '#fdd835', '#43a047', '#43a047']):
    ax.add_patch(Rectangle((41 + i * 4, 91.2), 3, 1.6, fc=c, ec='none', zorder=4))

route('BAT.+', 'TP.B+', [], RED)
route('BAT.−', 'TP.B−', [], BLK)
route('TP.OUT+', 'MT.VIN+', [], RED)
route('TP.OUT−', 'MT.VIN−', [], BLK)
route('IND.+', (33, 125), [(44, 106), (33, 106)], RED, dots=[(33, 125)])
route('IND.−', (35.5, 117), [(52, 108), (35.5, 108)], BLK, dots=[(35.5, 117)])
route('MT.VOUT+', (62, RAILS_TOP['5V']), [(62, 125)], RED, dots=[(62, RAILS_TOP['5V'])])
route('MT.VOUT−', (64, RAILS_TOP['GND']), [(64, 117)], BLK, dots=[(64, RAILS_TOP['GND'])])
T(30, 135.5, 'Set MT3608 output to 5.0 V before connecting', 7.5, '#b91c1c', 'bold')

# ---------------- buttons (left) ----------------
def button(key, x, y, cap, label):
    board(key, x, y, 24, 12, '#1e66c9', label, 'button module',
          [('VCC', 'R', y + 9), ('OUT', 'R', y + 6), ('GND', 'R', y + 3)], title_at=(x + 9.5, y + 8.2))
    ax.add_patch(Circle((x + 4.5, y + 3.6), 2.6, fc=cap, ec='#1d2433', lw=1, zorder=5))

button('CAN', 72, 40, '#f4c20d', 'CANCEL')
button('SOS', 72, 22, '#e53935', 'SOS')
# power down to bottom rails
route('CAN.GND', (97, RAILS_BOT['GND']), [(97, 43)], BLK, dots=[(97, RAILS_BOT['GND'])])
route('CAN.VCC', (99, RAILS_BOT['3V3']), [(99, 49)], ORG, dots=[(99, RAILS_BOT['3V3'])])
route('SOS.GND', (97, 25), [], BLK, dots=[(97, 25)])
route('SOS.VCC', (99, 31), [], ORG, dots=[(99, 31)])
# signals up to the ESP32
route('CAN.OUT', 'ESP.G4', [(102, 46), (102, 92)], C['btn2'])
route('SOS.OUT', 'ESP.G3', [(104.5, 28), (104.5, 88)], C['btn1'])

# ---------------- LEDs (left, near ESP) ----------------
def resistor(x, y, label, vertical=False):
    if vertical:
        ax.add_patch(FancyBboxPatch((x - 1.3, y - 3.5), 2.6, 7, boxstyle='round,pad=0,rounding_size=1',
                                    fc='#e8d3a8', ec='#6b4f1d', lw=1, zorder=4))
        for k, c in enumerate(['#d32f2f', '#d32f2f', '#5d4037']):
            ax.add_patch(Rectangle((x - 1.3, y - 2 + k * 1.6), 2.6, 0.6, fc=c, ec='none', zorder=4.5))
        T(x + 2.2, y, label, 6.5, '#374151', 'bold', ha='left')
    else:
        ax.add_patch(FancyBboxPatch((x - 3.5, y - 1.3), 7, 2.6, boxstyle='round,pad=0,rounding_size=1',
                                    fc='#e8d3a8', ec='#6b4f1d', lw=1, zorder=4))
        for k, c in enumerate(['#d32f2f', '#d32f2f', '#5d4037']):
            ax.add_patch(Rectangle((x - 2 + k * 1.6, y - 1.3), 0.6, 2.6, fc=c, ec='none', zorder=4.5))
        T(x, y + 2.6, label, 6.5, '#374151', 'bold')

def led(x, y, color, label, label_side='left'):
    """LED pointing left: anode at right (x+2.5), cathode at left (x-2.5)"""
    ax.add_patch(Circle((x, y), 2.1, fc=color, ec='#1d2433', lw=1, zorder=5, alpha=0.95))
    ax.add_patch(Circle((x - 0.6, y + 0.6), 0.6, fc='white', ec='none', zorder=5.5, alpha=0.7))
    T(x, y + 3.6 if label_side == 'top' else y - 3.6, label, 6.8, '#374151', 'bold')

# alert LED on G0, GPS LED on G1
for gp, yy, col, name, lx in [('G1', 80, '#43a047', 'GPS LED', 106), ('G0', 76, '#e53935', 'ALERT LED', 108.5)]:
    resistor(115.5, yy, '220Ω')
    led(lx, yy, col, name, 'top' if gp == 'G1' else 'bottom')
    wire([P(f'ESP.{gp}'), (119, yy)], C['led'], 2.2)
    wire([(112, yy), (lx + 2.1, yy)], C['led'], 2.2)
    wire([(lx - 2.1, yy), (lx - 3.2, yy), (lx - 3.2, RAILS_BOT['GND'])], BLK, 2.2)
    dot(lx - 3.2, RAILS_BOT['GND'], BLK)
T(97, 70, 'GPIO2 left free\n(boot strapping pin)', 6.8, '#6b7280', ha='center')

# power LED: 3V3 -> 220R -> LED -> GND (always on)
led(134, 52, '#1e88e5', 'POWER LED', 'top')
resistor(125, 52, '220Ω')
wire([(124, RAILS_BOT['3V3']), (121, RAILS_BOT['3V3'])], ORG, 2.2)
wire([(121, RAILS_BOT['3V3']), (121, 52), (121.5, 52)], ORG, 2.2); dot(121, RAILS_BOT['3V3'], ORG)
wire([(128.5, 52), (131.9, 52)], ORG, 2.2)
wire([(136.1, 52), (139, 52), (139, RAILS_BOT['GND'])], BLK, 2.2); dot(139, RAILS_BOT['GND'], BLK)

# ---------------- SIM800L (upper right) ----------------
board('SIM', 172, 92, 40, 24, '#1f5fbf', 'SIM800L V2', 'GSM / SMS / calls',
      [('5V', 'L', 112), ('GND', 'L', 108), ('RXD', 'L', 100), ('TXD', 'L', 96),
       ('MIC+', 'R', 112), ('MIC−', 'R', 108), ('SPK+', 'R', 100), ('SPK−', 'R', 96)],
      title_at=(192, 104))
ax.add_patch(Rectangle((181, 93.5), 14, 6.5, fc='#d1d5db', ec='#6b7280', lw=1, zorder=4))
T(188, 96.7, 'SIM card', 6.5, '#374151', 'bold')
# GSM antenna
ax.add_patch(Rectangle((198, 116), 2.4, 3, fc='#d9b44a', ec='#7a5d10', zorder=4))
ax.add_patch(FancyBboxPatch((197.6, 119), 3.2, 14, boxstyle='round,pad=0,rounding_size=1.5',
                            fc='#1d1f24', ec='#000', zorder=4))
T(203.5, 128, 'GSM\nantenna', 7, '#374151', 'bold', ha='left')
route('ESP.G6', 'SIM.RXD', [], C['tx'])        # ESP TX -> SIM RX
route('ESP.G7', 'SIM.TXD', [], C['rx'])        # SIM TX -> ESP RX
route('SIM.5V', (168, RAILS_TOP['5V']), [(168, 112)], RED, dots=[(168, RAILS_TOP['5V'])])
route('SIM.GND', (165.5, RAILS_TOP['GND']), [(165.5, 108)], BLK, dots=[(165.5, RAILS_TOP['GND'])])

# ---------------- vibration motor driver (top middle) ----------------
# G5 -> 1k -> NPN base ; motor between 3V3 and collector ; diode across motor
route('ESP.G5', (150, 121), [(148, 104), (148, 121)], C['vib'], lw=2.2)
resistor(152, 121, '1kΩ')
ax.add_patch(Circle((159.5, 121), 3.2, fc='#111827', ec='#000', zorder=5))
T(159.5, 121, 'NPN', 6, 'white', 'bold')
T(159.5, 116.6, '2N2222', 6.3, '#374151', 'bold')
wire([(155.5, 121), (156.3, 121)], C['vib'], 2.2)
# emitter -> GND (top rail), collector -> motor
wire([(161, 123.5), (161, 128), (156, 128), (156, RAILS_TOP['GND'])], BLK, 2.2); dot(156, RAILS_TOP['GND'], BLK)
T(160.6, 126, 'E', 6, '#374151', 'bold', ha='left')
wire([(162.5, 120), (164, 120), (164, 136)], C['vib'], 2.2)
T(165, 118.6, 'C', 6, '#374151', 'bold')
ax.add_patch(Circle((164, 140), 4, fc='#b0b7c3', ec='#4b5563', lw=1.2, zorder=5))
T(164, 140, 'M', 9, '#1f2937', 'bold')
T(170, 140, 'Coin vibration\nmotor', 7, '#374151', 'bold', ha='left')
wire([(164, 144), (164, 147), (152, 147), (152, RAILS_TOP['3V3'])], ORG, 2.2); dot(152, RAILS_TOP['3V3'], ORG)
T(149, 141.5, '1N4148\nacross motor', 6, '#6b7280', ha='right')

# ---------------- MPU6050 (middle right) ----------------
board('MPU', 172, 66, 28, 22, '#1f5fbf', 'MPU6050', 'GY-521 accel + gyro',
      [('SDA', 'L', 84), ('SCL', 'L', 80), ('VCC', 'L', 72), ('GND', 'L', 68)], title_at=(188, 80))
ax.add_patch(Rectangle((183, 68.5), 8, 6, fc='#111827', ec='#4b5563', zorder=4))
route('ESP.G8', 'MPU.SDA', [(152, 92), (152, 84)], C['sda'])
route('ESP.G9', 'MPU.SCL', [(155, 88), (155, 80)], C['scl'])
route('MPU.VCC', (160, RAILS_BOT['3V3']), [(160, 72)], ORG, dots=[(160, RAILS_BOT['3V3'])])
route('MPU.GND', (162.5, RAILS_BOT['GND']), [(162.5, 68)], BLK, dots=[(162.5, RAILS_BOT['GND'])])

# ---------------- buzzer ----------------
ax.add_patch(Circle((150, 60), 5, fc='#1f2328', ec='#000', lw=1.2, zorder=5))
ax.add_patch(Circle((150, 60), 1, fc='#555', ec='none', zorder=6))
T(150, 53, 'Active buzzer', 7, '#374151', 'bold')
pins['BUZ.+'] = (153.5, 63.5); pins['BUZ.−'] = (146.5, 56.5)
T(155, 65.5, '+', 8, '#374151', 'bold')
route('ESP.G10', 'BUZ.+', [(149, 76), (157, 76), (157, 63.5)], C['buz'], lw=2.2)
route('BUZ.−', (146.5, RAILS_BOT['GND']), [], BLK, lw=2.2, dots=[(146.5, RAILS_BOT['GND'])])

# ---------------- GPS (lower right) ----------------
board('GPS', 172, 26, 34, 30, '#1f5fbf', 'NEO-6M V2', 'GPS module',
      [('TX', 'L', 52), ('RX', 'L', 48), ('VCC', 'L', 36), ('GND', 'L', 32)], title_at=(193, 52))
ax.add_patch(Rectangle((183, 29), 12, 12, fc='#c8a165', ec='#6b4f1d', lw=1, zorder=4))
ax.add_patch(Rectangle((185.5, 31.5), 7, 7, fc='#e5e7eb', ec='#9ca3af', lw=1, zorder=4.5))
T(189, 26.6 + 16, 'patch antenna', 6, 'white', 'bold')
route('ESP.G20', 'GPS.TX', [(158.5, 80), (158.5, 52)], C['rx'] if False else '#00a86b')
route('ESP.G21', 'GPS.RX', [(160.8, 76)], '#ff7043') if False else None
wire([P('ESP.G21'), (166, 76), (166, 48), P('GPS.RX')], '#ff7043')
route('GPS.VCC', (168, RAILS_BOT['3V3']), [(168, 36)], ORG, dots=[(168, RAILS_BOT['3V3'])])
route('GPS.GND', (170, RAILS_BOT['GND']), [(170, 32)], BLK, dots=[(170, RAILS_BOT['GND'])])

# ---------------- MAX4466 microphone (far right top) ----------------
board('MIC', 226, 120, 26, 18, '#6a2c91', 'MAX4466', 'electret mic amp',
      [('OUT', 'B', 232), ('GND', 'B', 239), ('VCC', 'B', 246)], title_at=(239, 134))
ax.add_patch(Circle((239, 127.5), 4.2, fc='#2a2a2a', ec='#9ca3af', lw=1.5, zorder=5))
ax.add_patch(Circle((239, 127.5), 2.6, fc='#3f3f3f', ec='none', zorder=5.5))
route('MIC.OUT', 'SIM.MIC+', [(232, 112)], C['aud'])
route('SIM.MIC−', (239, 108), [], BLK, dots=[])
wire([P('MIC.GND'), (239, 108)], BLK); dot(239, 108, BLK)
wire([(239, 108), (239, 104), (256, 104), (256, RAILS_BOT['GND'])], BLK); dot(256, RAILS_BOT['GND'], BLK)
route('MIC.VCC', (248.5, RAILS_TOP['3V3']), [(246, 116), (248.5, 116)], ORG, dots=[(248.5, RAILS_TOP['3V3'])])

# ---------------- PAM8403 + speaker (far right bottom) ----------------
board('PAM', 216, 64, 30, 26, '#1e8449', 'PAM8403', 'audio amp',
      [('L-IN', 'T', 220), ('GND', 'T', 226), ('5V', 'L', 70), ('PGND', 'L', 66),
       ('L+', 'R', 84), ('L−', 'R', 80)], title_at=(233, 74))
ax.add_patch(Rectangle((230, 80), 8, 7, fc='#1aa36f', ec='#0b5d3c', lw=1, zorder=4))
ax.add_patch(Circle((234, 83.5), 2.2, fc='#9ca3af', ec='#4b5563', zorder=5))
T(240.5, 86.5, 'B50K', 6, 'white', 'bold', ha='left')
route('SIM.SPK+', 'PAM.L-IN', [(214, 100), (214, 93), (220, 93)], C['spk'])
route('SIM.SPK−', 'PAM.GND', [(216, 96), (216, 95), (226, 95)], BLK)
route('PAM.5V', (210, RAILS_BOT['5V']), [(210, 70)], RED, dots=[(210, RAILS_BOT['5V'])])
route('PAM.PGND', (212.5, RAILS_BOT['GND']), [(212.5, 66)], BLK, dots=[(212.5, RAILS_BOT['GND'])])
ax.add_patch(Circle((256, 76), 6.5, fc='#2a2d34', ec='#000', lw=1.5, zorder=5))
ax.add_patch(Circle((256, 76), 3.6, fc='#4b5563', ec='#111', lw=1, zorder=5.5))
T(256, 66.5, 'Speaker 20 mm\n8 Ω 1 W', 6.8, '#374151', 'bold')
wire([P('PAM.L+'), (251, 84), (251, 79)], '#e53935', 2.2)
wire([P('PAM.L−'), (249.5, 80), (249.5, 74), (250.5, 74)], BLK, 2.2)

# ---------------- title + legend ----------------
T(4, 168.5, 'ESP32-C3 Fall Detection Wearable — Wiring Diagram', 17, '#111827', 'bold', ha='left')
T(4, 163.5, 'Recommended pin map · wires that cross without a dot are not connected', 9.5, '#4b5563', ha='left')

pinmap = [('G3', 'SOS button OUT'), ('G4', 'Cancel button OUT'), ('G0', 'Alert LED (220 Ω)'),
          ('G1', 'GPS LED (220 Ω)'), ('G5', 'Vibration motor (via NPN)'), ('G6', 'ESP TX → SIM800L RXD'),
          ('G7', 'ESP RX ← SIM800L TXD'), ('G8', 'MPU6050 SDA'), ('G9', 'MPU6050 SCL'),
          ('G10', 'Buzzer +'), ('G20', 'ESP RX ← GPS TX'), ('G21', 'ESP TX → GPS RX')]
bx, by = 4, 84
ax.add_patch(FancyBboxPatch((bx, by - 52), 58, 54, boxstyle='round,pad=0,rounding_size=1.5',
                            fc='white', ec='#cbd5e1', lw=1.2, zorder=3))
T(bx + 3, by - 1.5, 'ESP32-C3 pin map', 10, '#111827', 'bold', ha='left')
for i, (g, d) in enumerate(pinmap):
    yy = by - 6.5 - i * 3.6
    T(bx + 3, yy, g, 8, '#2563eb', 'bold', ha='left')
    T(bx + 12, yy, d, 8, '#1f2937', ha='left')

lg = [(RED, '+5 V (MT3608 out)'), (ORG, '+3.3 V (ESP32 3V3)'), (BLK, 'GND (common)')]
for i, (c, s) in enumerate(lg):
    yy = 24 - i * 4
    ax.plot([6, 12], [yy, yy], color=c, lw=3.2)
    T(14, yy, s, 8, '#1f2937', ha='left')

for ext in ('png', 'pdf'):
    fig.savefig(f'wiring_diagram.{ext}', facecolor=fig.get_facecolor(), dpi=160 if ext == 'png' else None)
print('saved')
