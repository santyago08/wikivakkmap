"""Find state-name labels (layer 19), match each to the fill region under it, make reading sheets."""
import sys, os, json
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
Image.MAX_IMAGE_PIXELS = None
S = sys.argv[1]
fill = np.asarray(Image.open(f'{S}/mapout/full/L09.png'))
names = np.asarray(Image.open(f'{S}/mapout/full/L19.png'))
H, W = fill.shape[:2]
key = (fill[..., 0].astype(np.int32) << 16) | (fill[..., 1].astype(np.int32) << 8) | fill[..., 2]
key[fill[..., 3] < 200] = -1
a = (names[..., 3] > 40).astype(np.uint8)
blob = cv2.dilate(a, np.ones((9, 22), np.uint8))
n, lab, st, cen = cv2.connectedComponentsWithStats(blob, 8)
labels = []
for i in range(1, n):
    x, y, w, h, ar = st[i]
    if ar < 60: continue
    sub = key[y:y + h, x:x + w]
    vals = sub[sub >= 0]
    if len(vals):
        u, c = np.unique(vals, return_counts=True); col = int(u[np.argmax(c)])
    else:
        # nearest fill pixel
        r = 60; ys, xs = np.nonzero(key[max(0, y - r):y + h + r, max(0, x - r):x + w + r] >= 0)
        col = int(key[max(0, y - r) + ys[0], max(0, x - r) + xs[0]]) if len(ys) else -1
    labels.append(dict(box=[int(x), int(y), int(w), int(h)], color=('#%06x' % col) if col >= 0 else None))
labels.sort(key=lambda l: (l['box'][1] // 1000, l['box'][0]))
for i, l in enumerate(labels): l['id'] = i
json.dump(labels, open(f'{S}/mapout/labels.json', 'w'), indent=1)
print(len(labels), 'labels;', sum(1 for l in labels if l['color']), 'matched')

os.makedirs(f'{S}/mapout/lsheets', exist_ok=True)
font = ImageFont.truetype('arial.ttf', 22)
rgba = Image.fromarray(names)
TW, TH, COLS, ROWS = 520, 150, 3, 8
per = COLS * ROWS
for sh in range(0, len(labels), per):
    sheet = Image.new('RGB', (TW * COLS, TH * ROWS), 'white'); d = ImageDraw.Draw(sheet)
    for j, l in enumerate(labels[sh:sh + per]):
        x, y, w, h = l['box']
        crop = rgba.crop((x - 4, y - 4, x + w + 4, y + h + 4))
        bg = Image.new('RGBA', crop.size, (255, 255, 255, 255)); bg.alpha_composite(crop); bg = bg.convert('RGB')
        sc = min((TW - 10) / bg.width, (TH - 30) / bg.height, 4.0)
        bg = bg.resize((max(1, int(bg.width * sc)), max(1, int(bg.height * sc))), Image.LANCZOS)
        ox, oy = (j % COLS) * TW, (j // COLS) * TH
        sheet.paste(bg, (ox + 5, oy + 26))
        d.rectangle([ox, oy, ox + TW - 1, oy + TH - 1], outline=(180, 180, 180))
        d.text((ox + 5, oy + 2), f"#{l['id']} {l['color']}", fill='red', font=font)
    sheet.save(f'{S}/mapout/lsheets/l{sh // per:02d}.png')
