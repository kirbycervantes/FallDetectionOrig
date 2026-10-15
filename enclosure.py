"""Fall-detection wearable enclosure v2 (base + press-fit lid) with placeholder parts. Units: mm.
Box coords: X = left->right (9 cm side), Y = front->back (7 cm side), Z = up.
Board coords (bx, by) follow the user's photos/sketch: from the board's back-left corner,
by measured toward the front (the side where the volume knob sticks out)."""
import numpy as np
import trimesh
from trimesh.creation import box as _box, cylinder as _cyl
from trimesh.transformations import rotation_matrix as rot

def box(x0, x1, y0, y1, z0, z1):
    b = _box(extents=[x1 - x0, y1 - y0, z1 - z0])
    b.apply_translation([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2])
    return b

def cyl(r, h, center, axis='z', sections=48):
    c = _cyl(radius=r, height=h, sections=sections)
    if axis == 'y':
        c.apply_transform(rot(np.pi / 2, [1, 0, 0]))
    if axis == 'x':
        c.apply_transform(rot(np.pi / 2, [0, 1, 0]))
    c.apply_translation(center)
    return c

U = lambda *m: trimesh.boolean.union(list(m), engine='manifold')
D = lambda a, *m: trimesh.boolean.difference([a, *m], engine='manifold')

# ---------------- key dimensions ----------------
BOARD_X, BOARD_Y, BOARD_T = 90.0, 70.0, 1.6
CLEAR, WALL, FLOOR = 1.0, 1.8, 1.5
BATT_T = 10.0                         # 103450 LiPo is 10 mm thick
OFF = WALL + CLEAR                    # board edge offset from outside
OX, OY = BOARD_X + 2 * OFF, BOARD_Y + 2 * OFF      # 95.6 x 75.6
BOARD_Z = FLOOR + BATT_T + 0.3        # board underside (on corner posts)
BTOP = BOARD_Z + BOARD_T              # board top  = 13.4
TOP = 26.0                            # top of walls = underside of lid
LID_T, LIP_H, LIP_T, FIT = 2.0, 2.5, 1.2, 0.3

def P(bx, by):
    """board coords -> box XY"""
    return OFF + bx, OY - OFF - by

# ---------------- feature positions (board coords) ----------------
MIC_C = (12.0, 6.0)          # mic capsule
BUZ_C = (33.0, 7.0)          # buzzer
RED_BY, RED_Z = 6.0, 19.4    # red button, left wall
YEL_BY, YEL_Z = 21.0, 19.4   # yellow button, left wall (next to the red one)
ESP_BY, ESP_Z = 15.0, 18.5   # ESP32-C3 USB-C, right wall
CHG_BY, CHG_Z = 11.0, 4.7    # TP4056 Type-C, left wall (under the board)
POT_BX, POT_Z = 59.5, 20.0   # impact-threshold knob shaft, front wall
GPS_C = (49.0, 21.0)         # GPS patch antenna window in the lid
PATCH, CERAMIC = 25.0, 18.0  # patch PCB / ceramic size

# ---------------- base ----------------
base = D(box(0, OX, 0, OY, 0, TOP), box(WALL, OX - WALL, WALL, OY - WALL, FLOOR, TOP + 1))
posts = [box(x, x + 3, y, y + 3, FLOOR - 0.01, BOARD_Z)
         for x in (WALL, OX - WALL - 3) for y in (WALL, OY - WALL - 3)]
# button guards, both on the left wall: red (SOS) round, yellow (Cancel) square
ry, yy = P(0, RED_BY)[1], P(0, YEL_BY)[1]
g_red = D(cyl(6.6, 3, [-1.5, ry, RED_Z], 'x'), cyl(5.8, 4, [-1.5, ry, RED_Z], 'x'))
g_yel = D(box(-3, 0.01, yy - 6.6, yy + 6.6, YEL_Z - 6.6, YEL_Z + 6.6),
          box(-4, 1, yy - 5.8, yy + 5.8, YEL_Z - 5.8, YEL_Z + 5.8))
base = U(base, *posts, g_red, g_yel)

def wall_cuts(depth_in=0.0):
    """holes through the walls; depth_in extends them inward (used to clear the lid lip)"""
    d = depth_in
    px = P(POT_BX, 0)[0]
    return [
        box(-5, WALL + 1 + d, P(0, CHG_BY)[1] - 5, P(0, CHG_BY)[1] + 5, CHG_Z - 2.5, CHG_Z + 2.5),   # charging
        cyl(5.5, 12 + 2 * d, [WALL / 2, ry, RED_Z], 'x'),                                            # red button
        box(OX - WALL - 1 - d, OX + 5, P(0, ESP_BY)[1] - 6, P(0, ESP_BY)[1] + 6, ESP_Z - 3.5, ESP_Z + 3.5),  # ESP32 USB
        cyl(5.5, 12 + 2 * d, [WALL / 2, yy, YEL_Z], 'x'),                                              # yellow button
        U(cyl(3.75, 12 + 2 * d, [px, WALL / 2, POT_Z], 'y'),                                         # knob: U-slot open at top
          box(px - 3.75, px + 3.75, -5, WALL + 1 + d, POT_Z, TOP + 5)),
    ]
base = D(base, *wall_cuts(), box(OX / 2 - 6, OX / 2 + 6, OY - WALL - 0.5, OY + 1, TOP - 1.5, TOP + 1))  # lid pry notch

# ---------------- lid (assembled position) ----------------
lid = box(0, OX, 0, OY, TOP, TOP + LID_T)
lo = (OX - 2 * WALL - 2 * FIT, OY - 2 * WALL - 2 * FIT)
cx, cy = OX / 2, OY / 2
lip = D(box(cx - lo[0] / 2, cx + lo[0] / 2, cy - lo[1] / 2, cy + lo[1] / 2, TOP - LIP_H, TOP + 0.01),
        box(cx - lo[0] / 2 + LIP_T, cx + lo[0] / 2 - LIP_T, cy - lo[1] / 2 + LIP_T, cy + lo[1] / 2 - LIP_T, 0, TOP + 1))
lip = D(lip, *wall_cuts(depth_in=4),
        box(-1, OFF + 5, ry - 7.5, ry + 7.5, 0, TOP + 1), box(-1, OFF + 5, yy - 7.5, yy + 7.5, 0, TOP + 1))
lid = U(lid, lip)

def grille(c, r, hole=1.6, pitch=2.8):
    out = []
    for i in range(-5, 6):
        for j in range(-5, 6):
            x = c[0] + i * pitch + (j % 2) * pitch / 2
            y = c[1] + j * pitch * 0.866
            if np.hypot(x - c[0], y - c[1]) <= r:
                out.append(cyl(hole / 2, 10, [x, y, TOP + 1], sections=16))
    return out

g = P(*GPS_C)
lid = D(lid, *grille(P(*MIC_C), 4.2), *grille(P(*BUZ_C), 5.0),
        box(g[0] - CERAMIC / 2 - 0.4, g[0] + CERAMIC / 2 + 0.4, g[1] - CERAMIC / 2 - 0.4, g[1] + CERAMIC / 2 + 0.4, TOP - 1, TOP + LID_T + 1),
        box(g[0] - PATCH / 2 - 0.4, g[0] + PATCH / 2 + 0.4, g[1] - PATCH / 2 - 0.4, g[1] + PATCH / 2 + 0.4, TOP - LIP_H - 1, TOP + 1.0))
assert base.is_watertight and lid.is_watertight

# ---------------- placeholder parts (preview only, not printed) ----------------
parts = []  # (name, mesh, rgb, on_lid)
def part(name, rgb, *meshes, on_lid=False):
    parts.append((name, trimesh.util.concatenate(meshes), rgb, on_lid))

def bbox(bx0, bx1, by0, by1, z0, z1):
    (x0, y1), (x1, y0) = P(bx0, by0), P(bx1, by1)
    return box(x0, x1, y0, y1, z0, z1)

part('Perfboard 9 x 7 cm', (150, 82, 50), bbox(0, BOARD_X, 0, BOARD_Y, BOARD_Z, BTOP))
part('LiPo battery 1 (103450)', (235, 190, 60), bbox(19.5, 53.5, 20, 70, FLOOR, FLOOR + BATT_T))
part('LiPo battery 2 (103450)', (235, 190, 60), bbox(54, 88, 20, 70, FLOOR, FLOOR + BATT_T))
part('TP4056 Type-C charger', (40, 80, 170), bbox(0.5, 28, 2.5, 19.5, FLOOR, FLOOR + 1.6),
     bbox(-0.8, 7, CHG_BY - 4.5, CHG_BY + 4.5, FLOOR + 1.6, FLOOR + 4.8))
part('ESP32-C3', (30, 30, 35), bbox(66.5, 89, 6, 24, BTOP + 2.5, BTOP + 3.5),
     bbox(70, 82, 9, 21, BTOP + 3.5, BTOP + 5), bbox(82, 90, ESP_BY - 4.5, ESP_BY + 4.5, BTOP + 3.5, BTOP + 6.7))
part('SIM800L', (35, 70, 150), bbox(0.5, 27.5, 29, 69, BTOP + 2.5, BTOP + 4.1),
     bbox(5, 23, 36, 54, BTOP + 4.1, BTOP + 7))
part('NEO-7M GPS', (35, 70, 150), bbox(28.5, 54, 34.5, 70, BTOP + 2.5, BTOP + 4.1),
     bbox(35, 47, 44, 56, BTOP + 4.1, BTOP + 6.5))
part('Threshold knob board', (40, 140, 70), bbox(52, 84, 48, 69, BTOP, BTOP + 1.6),
     bbox(70, 80, 55, 65, BTOP + 1.6, BTOP + 4))
kx, ky = P(POT_BX, 69)
part('Impact threshold knob (B50K)', (60, 150, 90), bbox(55, 64, 58, 69, BTOP + 1.6, BTOP + 11.6),
     cyl(3, 16, [kx, ky - 8, POT_Z], 'y'))
mx, my = P(*MIC_C)
part('Microphone', (120, 60, 160), bbox(4, 24, 0.5, 14, BTOP + 2.5, BTOP + 4.1),
     cyl(4.85, 5, [mx, my, BTOP + 6.6]))
bx_, by_ = P(*BUZ_C)
part('Buzzer', (25, 25, 25), cyl(6, 9.5, [bx_, by_, BTOP + 4.75]))
part('Red button (SOS)', (215, 40, 40), box(OFF, OFF + 3, ry - 6, ry + 6, BTOP, BTOP + 12),
     cyl(5, 7, [0.5, ry, RED_Z], 'x'))
part('Yellow button (Cancel)', (240, 200, 30), box(OFF, OFF + 3, yy - 6, yy + 6, BTOP, BTOP + 12),
     cyl(5, 7, [0.5, yy, YEL_Z], 'x'))
ax0, ay = P(8, 23)
part('GSM antenna', (40, 40, 40), cyl(3, 9, [ax0 + 4.5, ay, BTOP + 4.5], 'x'),
     cyl(4.25, 38, [ax0 + 28, ay, BTOP + 4.5], 'x'))
part('GPS patch antenna', (50, 150, 70), box(g[0] - PATCH / 2, g[0] + PATCH / 2, g[1] - PATCH / 2, g[1] + PATCH / 2, TOP + 1 - 1.6, TOP + 1),
     on_lid=True)
part('GPS ceramic', (245, 245, 240), box(g[0] - CERAMIC / 2, g[0] + CERAMIC / 2, g[1] - CERAMIC / 2, g[1] + CERAMIC / 2, TOP + 1, TOP + 5),
     on_lid=True)

# ---------------- export ----------------
base.export('enclosure_base.stl')
lid_print = lid.copy()
lid_print.apply_transform(rot(np.pi, [1, 0, 0]))
lid_print.apply_translation(-lid_print.bounds[0])
lid_print.export('enclosure_lid.stl')

scene = trimesh.Scene()
def add(name, m, rgb, alpha=255):
    m = m.copy()
    m.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
        baseColorFactor=[*rgb, alpha], metallicFactor=0.05, roughnessFactor=0.6))
    scene.add_geometry(m, node_name=name, geom_name=name)
add('base', base, (0x2F, 0x54, 0x80)); add('lid', lid, (0xE2, 0xE9, 0xF0))
for name, m, rgb, on_lid in parts:
    add(('lid|' if on_lid else 'part|') + name, m, rgb)
scene.export('_preview.glb')

print('outer size (mm): %.1f x %.1f x %.1f' % (OX, OY, TOP + LID_T))
print('base', base.bounds.round(1).tolist())
