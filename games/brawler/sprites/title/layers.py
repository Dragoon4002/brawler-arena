# Split flat title art into parallax layers (back -> front): sky, far, mid, front.
# Run: blender -b --factory-startup --python layers.py -- <art.png> <outdir> [overlay.png]
# Each layer = pixels inside its polygons; with flood=True the sky inside is removed by flooding from the polygon
# edge over light pixels (stops at the art's dark ink outlines). Lower layers get `fill` px of inpaint under higher
# ones, so shifting layers (parallax) never shows holes. Later layers win overlaps; 'sky' takes the rest.
import bpy, os, sys
import numpy as np

LAYERS = [
    {'name': 'far', 'fill': 30, 'flood': False, 'polys': [
        [(430, 625), (700, 640), (870, 630), (1000, 615), (1300, 635), (1300, 941), (430, 941)]]},
    {'name': 'mid', 'fill': 30, 'flood': True, 'polys': [
        [(0, 225), (110, 220), (250, 280), (300, 320), (330, 450), (430, 470), (450, 560), (410, 640), (430, 720), (470, 840), (720, 830), (740, 941), (0, 941)],
        [(1290, 0), (1672, 0), (1672, 941), (1100, 941), (1150, 860), (1290, 640), (1330, 430), (1300, 420), (1330, 300), (1380, 250), (1335, 0)]]},
    {'name': 'front', 'fill': 0, 'flood': True, 'polys': [
        [(545, 140), (600, 100), (660, 60), (760, 55), (865, 65), (875, 140), (965, 230), (955, 305), (900, 355), (810, 365), (750, 345), (700, 305), (610, 295), (600, 235), (548, 185)],
        [(995, 250), (1130, 165), (1210, 85), (1245, 90), (1300, 145), (1370, 170), (1462, 205), (1455, 255), (1365, 265), (1395, 385), (1345, 405), (1260, 400), (1175, 375), (1165, 255), (1050, 255)],
        [(200, 265), (260, 222), (400, 197), (440, 187), (525, 197), (565, 280), (565, 330), (622, 385), (700, 410), (695, 435), (570, 430), (530, 415), (420, 420), (330, 445), (282, 455), (268, 400), (298, 342), (252, 332)],
        [(835, 450), (990, 418), (1040, 365), (1100, 355), (1162, 418), (1252, 448), (1342, 498), (1338, 562), (1272, 582), (1292, 640), (1284, 692), (1294, 765), (1238, 775), (1198, 724), (1098, 704), (1046, 694), (1026, 642), (1006, 562), (936, 534), (835, 474)],
        [(245, 620), (298, 555), (398, 527), (468, 425), (562, 412), (622, 468), (700, 516), (758, 466), (800, 395), (845, 405), (824, 522), (744, 584), (704, 644), (642, 704), (562, 734), (502, 774), (418, 774), (376, 704), (326, 634)]]},
    {'name': 'pin', 'fill': 0, 'flood': False, 'polys': [  # front bits the sky flood still reaches (cape tip, hammer base)
        [(205, 262), (225, 244), (270, 238), (282, 255), (266, 281), (230, 286), (208, 278)],
        [(835, 308), (902, 302), (907, 357), (840, 362)]]},
    {'name': 'spark', 'fill': 0, 'flood': False, 'polys': [  # burst glow has no outline: keep as a disc, merged into front
        [(790 + 105 * np.cos(t), 462 + 105 * np.sin(t)) for t in np.linspace(0, 2 * np.pi, 24, endpoint=False)]]},
]
MERGE = {'spark': 'front', 'pin': 'front'}

args = sys.argv[sys.argv.index('--') + 1:]
src, out = args[0], args[1]
os.makedirs(out, exist_ok=True)
im = bpy.data.images.load(src); W, H = im.size
px = np.array(im.pixels[:], np.float32).reshape(H, W, 4)[::-1].copy(); px[..., 3] = 1
yy, xx = np.mgrid[0:H, 0:W] + 0.5

def poly_mask(pts):
    m = np.zeros((H, W), bool); n = len(pts)
    for i in range(n):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
        if y0 == y1: continue
        c = ((y0 <= yy) & (yy < y1)) | ((y1 <= yy) & (yy < y0))
        m ^= c & (xx < x0 + (yy - y0) * (x1 - x0) / (y1 - y0))
    return m

def nb(a):
    p = np.pad(a, [(1, 1), (1, 1)] + [(0, 0)] * (a.ndim - 2))
    return [p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]]

def dil(m, r=1):
    for _ in range(r): m = m | sum(x.astype(np.uint8) for x in nb(m)).astype(bool)
    return m

def grow(seed, ok):
    while True:
        g = dil(seed) & ok
        if (g == seed).all(): return seed
        seed = g

lum = px[..., :3] @ np.array([0.3, 0.55, 0.15], np.float32)
ink = dil(lum < 0.22, 1)  # dark outlines (small gaps closed) block the sky flood

def sky_flood(m):
    # Grow from the polygon edge, stepping only between near-identical neighbours: sky gradients are smooth,
    # while every edge into a character jumps in colour even where its ink outline has a gap.
    ys, xs = np.nonzero(m)  # crop to bbox + 3px margin (outside m, so np.roll never wraps into the polygon)
    y0, y1, x0, x1 = max(ys.min() - 3, 0), min(ys.max() + 4, H), max(xs.min() - 3, 0), min(xs.max() + 4, W)
    c, ok = px[y0:y1, x0:x1, :3], (m & ~ink)[y0:y1, x0:x1]
    mm = m[y0:y1, x0:x1]
    seed = (mm & ok) & ~(np.roll(mm, 2, 0) & np.roll(mm, -2, 0) & np.roll(mm, 2, 1) & np.roll(mm, -2, 1))
    steps = []
    for ax, d in ((0, 1), (0, -1), (1, 1), (1, -1)):
        steps.append((ax, d, ok & (np.abs(c - np.roll(c, d, ax)).max(-1) < 0.05)))
    while True:
        g = seed.copy()
        for ax, d, okd in steps: g |= np.roll(seed, d, ax) & okd
        if (g == seed).all(): break
        seed = g
    # Opening: cut leaks through thin outline gaps (<6px). Erode sky (outside counts as sky), keep only what stays
    # connected to the outside, grow back 3px within the original sky.
    ext = seed | ~mm
    er = ~dil(~ext, 3)
    keep = grow(~mm, er)
    seed = dil(keep, 3) & seed
    out = np.zeros((H, W), bool); out[y0:y1, x0:x1] = seed
    return out

own = np.zeros((H, W), int)  # 0 = sky
for i, L in enumerate(LAYERS, 1):
    for poly in L['polys']:
        m = poly_mask(poly)
        if L['flood']:
            m &= ~sky_flood(m)
        own[m] = i
for i, L in enumerate(LAYERS, 1):  # merged layers take the target's index
    if L['name'] in MERGE: own[own == i] = 1 + [l['name'] for l in LAYERS].index(MERGE[L['name']])

names = ['sky'] + [L['name'] for L in LAYERS if L['name'] not in MERGE]
fills = {'sky': 50, **{L['name']: L['fill'] for L in LAYERS}}
idx = {n: (0 if n == 'sky' else 1 + [l['name'] for l in LAYERS].index(n)) for n in names}
comp = np.zeros_like(px)
for n in names:
    i = idx[n]; mine = own == i
    band = mine & dil(own > i, 3)  # anti-aliased edge next to higher layers: not a fill source (would smear ghosts)
    known = mine & ~band
    col = px[..., :3] * known[..., None]; alpha = mine.astype(np.float32)
    target = (own > i) | band
    for _ in range(fills[n]):
        ks = nb(known.astype(np.float32)); k = sum(ks)
        g = target & ~known & (k > 0)
        if not g.any(): break
        col[g] = (sum(c * w[..., None] for c, w in zip(nb(col), ks))[g]) / k[g, None]; alpha[g] = 1
        known = known | g
    filled = known & ~(mine & ~band)
    for _ in range(120 if filled.any() else 0):  # smooth the fill (no streaks)
        ks = nb(known.astype(np.float32)); k = np.maximum(sum(ks), 1)
        col[filled] = (sum(c * w[..., None] for c, w in zip(nb(col), ks))[filled]) / k[filled, None]
    col[band] = px[band, :3]  # keep the real edge pixels
    layer = np.dstack([col, alpha])
    o = bpy.data.images.new(n, W, H, alpha=True); o.pixels = np.ascontiguousarray(layer[::-1]).ravel()
    o.filepath_raw = os.path.join(out, f'{names.index(n)}-{n}.png'); o.file_format = 'PNG'; o.save()
    comp = layer * layer[..., 3:] + comp * (1 - layer[..., 3:])
print('layers', names, 'reassembly max err', float(np.abs(comp[..., :3] - px[..., :3]).max()))
if len(args) > 2:
    pal = np.array([[0, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0]], np.float32)
    ov = px.copy(); m = own > 0
    rem = np.array([idx[n] for n in names]); lut = np.zeros(len(LAYERS) + 1, int)
    for k2, v in enumerate(rem): lut[v] = k2
    ov[m, :3] = ov[m, :3] * 0.45 + pal[lut[own[m]]] * 0.55
    o = bpy.data.images.new('ov', W, H); o.pixels = np.ascontiguousarray(ov[::-1]).ravel(); o.filepath_raw = args[2]; o.file_format = 'PNG'; o.save()
