"""Re-render the Kanyalo map in an atlas style from the extracted layers.
usage: python render.py <scratch> <out.png>
"""
import sys
import numpy as np, cv2
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
S, OUT = sys.argv[1], sys.argv[2]
F = f'{S}/mapout/full'
def load(i): return np.asarray(Image.open(f'{F}/L{i:02d}.png'))
def hexc(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255

water = load(6)
H, W = water.shape[:2]
sea = (water[..., 3] > 128)
del water
fill = load(9)
key = (fill[..., 0].astype(np.int32) << 16) | (fill[..., 1].astype(np.int32) << 8) | fill[..., 2]
key[fill[..., 3] < 200] = -1
fillrgb = fill[..., :3].copy(); del fill
print('loaded', flush=True)

# ---- distance fields at half resolution ----
h2, w2 = H // 2, W // 2
sea2 = cv2.resize(sea.astype(np.uint8), (w2, h2), interpolation=cv2.INTER_NEAREST)
d_sea2 = cv2.distanceTransform(sea2, cv2.DIST_L2, 5) * 2           # distance from land, in full-res px
d_land2 = cv2.distanceTransform(1 - sea2, cv2.DIST_L2, 5) * 2      # distance from sea, inside land
key2 = cv2.resize(key, (w2, h2), interpolation=cv2.INTER_NEAREST)
edge = np.zeros_like(key2, bool)
edge[:, 1:] |= key2[:, 1:] != key2[:, :-1]; edge[1:, :] |= key2[1:, :] != key2[:-1, :]
d_edge2 = cv2.distanceTransform((~edge).astype(np.uint8), cv2.DIST_L2, 5) * 2
del sea2, key2, edge
print('distances', flush=True)

# ---- grain texture (tileable value noise) ----
rng = np.random.default_rng(7)
def grain(size, scales):
    g = np.zeros((size, size), np.float32)
    for s, a in scales:
        n = rng.random((size // s, size // s)).astype(np.float32)
        g += cv2.resize(n, (size, size), interpolation=cv2.INTER_CUBIC) * a
    return (g - g.mean()) / (g.std() + 1e-6)
G = grain(1024, [(256, .6), (64, .8), (16, .6), (4, .5), (1, .3)])

SEA_SHALLOW, SEA_DEEP = hexc('#2F5F66'), hexc('#142E36')
RIPPLE = hexc('#A7CBC5')
LAND, LAND_EDGE = hexc('#D6D1BC'), hexc('#B4AE95')
INK, COAST = hexc('#2B2622'), hexc('#1F2B2B')
HALO = hexc('#E4E0CE')
SEA_LABEL = hexc('#B8D5CF')

layers = {i: load(i)[..., 3].copy() for i in (10, 11, 12, 13, 14, 15, 16, 17, 18, 19)}
print('layers', flush=True)
out = np.zeros((H, W, 3), np.uint8)

def over(dst, color, alpha):
    a = alpha[..., None]
    return dst * (1 - a) + color * a

STRIP = 400
for r0 in range(0, H, STRIP):
    r1 = min(H, r0 + STRIP); h = r1 - r0
    a0, a1 = r0 // 2, (r1 + 1) // 2
    up = lambda m: cv2.resize(m[a0:a1], (W, (a1 - a0) * 2), interpolation=cv2.INTER_LINEAR)[(r0 - a0 * 2):(r0 - a0 * 2) + h]
    ds, dl, de = up(d_sea2), up(d_land2), up(d_edge2)
    mir = lambda v: np.where(v % 2048 < 1024, v % 1024, 1023 - v % 1024)  # mirrored tiling, no seams
    g = G[mir(np.arange(r0, r1))][:, mir(np.arange(W))]
    s = sea[r0:r1]
    # sea: depth gradient + ripple lines along the coast
    t = np.clip(ds / 300, 0, 1) ** .8; t = t * t * (3 - 2 * t)
    seac = SEA_SHALLOW * (1 - t[..., None]) + SEA_DEEP * t[..., None]
    seac = seac * (1 + g[..., None] * .025)
    rip = np.zeros_like(ds)
    for dist, a in ((9, .42), (20, .3), (34, .2), (52, .12), (76, .07)):
        rip = np.maximum(rip, np.clip(1 - np.abs(ds - dist) / 1.6, 0, 1) * a)
    seac = over(seac, RIPPLE, rip)
    # land: paper grain + darker rim along the coast
    e = np.clip(1 - dl / 34, 0, 1) ** 1.6 * .55
    landc = LAND * (1 + g[..., None] * .035)
    landc = over(landc, LAND_EDGE, e)
    # state wash: light overall, stronger near the border (watercolour edge)
    k = key[r0:r1] >= 0
    c = fillrgb[r0:r1].astype(np.float32) / 255
    wash = (.28 + np.clip(1 - de / 22, 0, 1) ** 1.3 * .34) * k
    tinted = landc * (1 - wash[..., None]) + (landc * (c * .75 + .25)) * wash[..., None]
    px = np.where(s[..., None], seac, tinted)
    # ink layers
    def L(i, color, mult=1.0):
        a = layers[i][r0:r1].astype(np.float32) / 255 * mult
        return over(px, color, np.clip(a, 0, 1))
    px = L(10, INK, .75)        # state borders
    px = L(11, COAST, 1.8)      # coastline
    for i in (14, 15, 16): px = L(i, HALO, .9)  # label halos
    px = L(17, INK)             # city marks
    px = L(18, INK)             # city names
    px = L(19, INK)             # state names
    px = L(13, INK, .92)        # continent names
    px = L(12, SEA_LABEL, 1.0)  # ocean names
    out[r0:r1] = np.clip(px * 255 + .5, 0, 255).astype(np.uint8)
    if r0 % 2000 == 0: print('row', r0, flush=True)

Image.fromarray(out).save(OUT, compress_level=2)
Image.fromarray(out).resize((2000, 1000), Image.LANCZOS).save(OUT.replace('.png', '_2000.png'))
print('done', flush=True)
