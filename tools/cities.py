"""Pair city-name labels (layer 18) with city markers (layer 17), find the state under each city,
and build contact sheets of the labels for reading."""
import sys, os, json
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
Image.MAX_IMAGE_PIXELS = None
S = sys.argv[1]
mk = np.asarray(Image.open(f'{S}/mapout/full/L17.png'))[..., 3]
n, _, st, cen = cv2.connectedComponentsWithStats((mk > 40).astype(np.uint8), 8)
markers = [dict(x=float(cen[i][0]), y=float(cen[i][1]), big=bool(max(st[i, 2], st[i, 3]) >= 8)) for i in range(1, n)]
names = np.asarray(Image.open(f'{S}/mapout/full/L18.png'))
a = (names[..., 3] > 40).astype(np.uint8)
d = cv2.dilate(a, np.ones((7, 15), np.uint8))
n2, _, st2, _ = cv2.connectedComponentsWithStats(d, 8)
fill = np.asarray(Image.open(f'{S}/mapout/full/L09.png'))
key = (fill[..., 0].astype(np.int32) << 16) | (fill[..., 1].astype(np.int32) << 8) | fill[..., 2]
key[fill[..., 3] < 200] = -1
def state_at(x, y):
    x, y = int(x), int(y); sub = key[max(0, y - 6):y + 7, max(0, x - 6):x + 7]; v = sub[sub >= 0]
    if not len(v): return None
    u, c = np.unique(v, return_counts=True); return '#%06x' % u[np.argmax(c)]
cities = []
used = set()
for i in range(1, n2):
    x, y, w, h, ar = st2[i]
    if ar < 40: continue
    # nearest marker to the label box
    best, bd = None, 1e9
    for j, m in enumerate(markers):
        dx = max(x - m['x'], 0, m['x'] - (x + w)); dy = max(y - m['y'], 0, m['y'] - (y + h))
        dd = (dx * dx + dy * dy) ** .5
        if dd < bd: bd, best = dd, j
    m = markers[best] if bd < 70 else None
    if m: used.add(best)
    px, py = (m['x'], m['y']) if m else (x + w / 2, y + h / 2)
    cities.append(dict(box=[int(x), int(y), int(w), int(h)], x=round(px), y=round(py), major=bool((m and m['big']) or h >= 20),
                       state=state_at(px, py), marker=m is not None))
cities.sort(key=lambda c: (c['y'] // 900, c['x']))
for i, c in enumerate(cities): c['id'] = i
json.dump(cities, open(f'{S}/mapout/cities_raw.json', 'w'), indent=0)
print(len(cities), 'labels;', sum(c['marker'] for c in cities), 'with markers;', len(markers) - len(used), 'markers without a name')

os.makedirs(f'{S}/mapout/csheets', exist_ok=True)
font = ImageFont.truetype('arial.ttf', 20)
rgba = Image.fromarray(names)
TW, TH, COLS, ROWS = 390, 70, 4, 10
per = COLS * ROWS
for sh in range(0, len(cities), per):
    sheet = Image.new('RGB', (TW * COLS, TH * ROWS), 'white'); dr = ImageDraw.Draw(sheet)
    for j, c in enumerate(cities[sh:sh + per]):
        x, y, w, h = c['box']
        crop = rgba.crop((x - 3, y - 3, x + w + 3, y + h + 3))
        bg = Image.new('RGBA', crop.size, (255, 255, 255, 255)); bg.alpha_composite(crop); bg = bg.convert('RGB')
        sc = min((TW - 50) / bg.width, (TH - 8) / bg.height, 3.0)
        bg = bg.resize((max(1, int(bg.width * sc)), max(1, int(bg.height * sc))), Image.LANCZOS)
        ox, oy = (j % COLS) * TW, (j // COLS) * TH
        sheet.paste(bg, (ox + 46, oy + 4))
        dr.rectangle([ox, oy, ox + TW - 1, oy + TH - 1], outline=(190, 190, 190))
        dr.text((ox + 3, oy + 3), str(c['id']), fill='red', font=font)
    sheet.save(f'{S}/mapout/csheets/c{sh // per:02d}.png')
