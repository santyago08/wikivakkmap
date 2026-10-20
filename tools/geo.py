"""Trace state outlines (vector polygons in full-res pixel coords) and assign continents.
usage: python geo.py <scratch> <out.json>
"""
import sys, json
import numpy as np, cv2
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
S, OUT = sys.argv[1], sys.argv[2]
Q = 4  # work at 1/4 resolution
fill = np.asarray(Image.open(f'{S}/mapout/full/L09.png'))
H, W = fill.shape[:2]
key = (fill[..., 0].astype(np.int32) << 16) | (fill[..., 1].astype(np.int32) << 8) | fill[..., 2]
key[fill[..., 3] < 200] = -1
del fill
kq = cv2.resize(key, (W // Q, H // Q), interpolation=cv2.INTER_NEAREST)
water = np.asarray(Image.open(f'{S}/mapout/full/L06.png'))[..., 3]
land = cv2.resize((water < 128).astype(np.uint8), (W // Q, H // Q), interpolation=cv2.INTER_NEAREST)
del water
nl, landlab = cv2.connectedComponents(land, connectivity=8)

# continent labels: layer 13, ordered left-to-right with the names read from the map
cont = np.asarray(Image.open(f'{S}/mapout/full/L13.png'))[..., 3]
cq = cv2.dilate((cv2.resize(cont, (W // Q, H // Q), interpolation=cv2.INTER_AREA) > 20).astype(np.uint8), np.ones((15, 40), np.uint8))
n, lab, st, cen = cv2.connectedComponentsWithStats(cq, 8)
KNOWN = {  # approximate centres on a 2000x1000 preview -> names
    'Мирам': (685, 32), 'Дзайвелл': (405, 248), 'Гайва': (655, 470), 'Цакерей': (190, 590), 'Заккервад': (1590, 195),
    'Зинсейда': (1660, 565), 'Афана': (1330, 677), 'Ревен': (1690, 800), 'Равейя': (445, 960)}
conts = {}
for name, (x, y) in KNOWN.items():
    x, y = x * W / 2000 / Q, y * H / 1000 / Q
    best = min(range(1, n), key=lambda i: (cen[i][0] - x) ** 2 + (cen[i][1] - y) ** 2)
    cx, cy = cen[best]
    # landmass under (or nearest to) the label
    ys, xs = np.nonzero(landlab > 0)
    j = np.argmin((xs - cx) ** 2 + (ys - cy) ** 2)
    conts[name] = dict(x=float(cx * Q), y=float(cy * Q), land=int(landlab[ys[j], xs[j]]))
print({k: v['land'] for k, v in conts.items()})

states = {}
for k in np.unique(kq[kq >= 0]):
    m = (kq == k).astype(np.uint8)
    if m.sum() < 8: continue
    cs, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    polys = []
    for i, c in enumerate(cs):
        if hier[0][i][3] != -1: continue  # holes handled with their parent
        if cv2.contourArea(c) < 1.5: continue
        ring = cv2.approxPolyDP(c, .7, True)[:, 0, :] * Q
        rings = [ring.tolist()]
        ch = hier[0][i][2]
        while ch != -1:
            if cv2.contourArea(cs[ch]) > 3:
                rings.append((cv2.approxPolyDP(cs[ch], .7, True)[:, 0, :] * Q).tolist())
            ch = hier[0][ch][0]
        polys.append(rings)
    ys, xs = np.nonzero(m)
    # continent by landmass of the largest part, else nearest continent label
    n2, l2, st2, cen2 = cv2.connectedComponentsWithStats(m, 8)
    big = 1 + int(np.argmax(st2[1:, 4]))
    bx, by = cen2[big]
    lm = landlab[int(by), int(bx)]
    cname = next((nm for nm, c in conts.items() if c['land'] == lm and lm > 0), None)
    if cname is None:
        cname = min(conts, key=lambda nm: (conts[nm]['x'] - bx * Q) ** 2 + (conts[nm]['y'] - by * Q) ** 2)
    states['#%06x' % k] = dict(polys=polys, cx=float(bx * Q), cy=float(by * Q),
                              bbox=[int(xs.min() * Q), int(ys.min() * Q), int((xs.max() + 1) * Q), int((ys.max() + 1) * Q)],
                              continent=cname, area=int(m.sum() * Q * Q))
json.dump(dict(width=W, height=H, continents={k: dict(x=v['x'], y=v['y']) for k, v in conts.items()}, states=states),
          open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(states), 'states; points', sum(len(r) for s in states.values() for p in s['polys'] for r in p))
