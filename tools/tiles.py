"""Cut the rendered map into a Leaflet tile pyramid: tiles/{z}/{x}/{y}.webp, z=MAXZ is full resolution."""
import sys, os, math
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
SRC, OUT = sys.argv[1], sys.argv[2]
T, MAXZ, PAD = 256, 6, (20, 46, 54)
img = Image.open(SRC).convert('RGB')
W, H = img.size
total = 0
for z in range(MAXZ, -1, -1):
    sc = 2 ** (MAXZ - z)
    lvl = img if z == MAXZ else img.resize((math.ceil(W / sc), math.ceil(H / sc)), Image.LANCZOS)
    nx, ny = math.ceil(lvl.width / T), math.ceil(lvl.height / T)
    for x in range(nx):
        os.makedirs(f'{OUT}/{z}/{x}', exist_ok=True)
        for y in range(ny):
            tile = lvl.crop((x * T, y * T, x * T + T, y * T + T))
            if tile.size != (T, T) or x * T + T > lvl.width or y * T + T > lvl.height:
                bg = Image.new('RGB', (T, T), PAD); bg.paste(lvl.crop((x * T, y * T, min(lvl.width, x * T + T), min(lvl.height, y * T + T))), (0, 0)); tile = bg
            tile.save(f'{OUT}/{z}/{x}/{y}.webp', 'WEBP', quality=80, method=4)
            total += 1
    print('z', z, nx, 'x', ny, flush=True)
    if z != MAXZ: del lvl
print('tiles', total)
