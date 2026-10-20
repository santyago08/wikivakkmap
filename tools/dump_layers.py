import sys, os, struct, gzip
import numpy as np
from PIL import Image
from pypdn.nrbf import NRBF
Image.MAX_IMAGE_PIXELS=None
src,out=sys.argv[1],sys.argv[2]; want=set(int(x) for x in sys.argv[3].split(','))
os.makedirs(out,exist_ok=True)
with open(src,'rb') as fh:
    fh.read(4);hs=struct.unpack('<i',fh.read(3)+b'\x00')[0];fh.read(hs);fh.read(2)
    doc=NRBF(stream=fh).getRoot();W,H=doc.width,doc.height;buf=None
    for li in range(doc.layers.ArrayList__size):
        lay=doc.layers.ArrayList__items[li];length=lay.surface.scan0.length64
        if buf is None: buf=bytearray(length)
        fmt=struct.unpack('>B',fh.read(1))[0];chunk=struct.unpack('>I',fh.read(4))[0];count=-(-length//chunk)
        keep=li in want
        for _ in range(count):
            num=struct.unpack('>I',fh.read(4))[0];size=struct.unpack('>I',fh.read(4))[0];raw=fh.read(size)
            if keep:
                d=gzip.decompress(raw) if fmt==0 else raw;buf[num*chunk:num*chunk+len(d)]=d
        if keep:
            img=np.frombuffer(buf,np.uint8).reshape(H,W,4)[:,:,[2,1,0,3]]
            Image.fromarray(img).save(os.path.join(out,f'L{li:02d}.png'),compress_level=3);print('saved',li,flush=True)
