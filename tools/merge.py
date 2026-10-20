import json,sys,re
S=sys.argv[1]
g=json.load(open(f'{S}/site_build/geo.json',encoding='utf-8'))
names=json.load(open(f'{S}/mapout/names.json',encoding='utf-8'))
T=dict(zip('абвгдеёжзийклмнопрстуфхцчшщъыьэюя',['a','b','v','g','d','e','e','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','h','ts','ch','sh','sch','','y','','e','yu','ya']))
slug=lambda s:re.sub(r'^-|-$','',re.sub(r'[^a-z0-9]+','-',''.join(T.get(c,c) for c in s.lower())))
C=g['continents'];shared=['Дзайвелл','Гайва']
out=[];missing=[c for c in names if c not in g['states']]
for col,st in g['states'].items():
    if col not in names: continue
    cont=st['continent']
    if cont in shared:
        cont=min(shared,key=lambda n:(C[n]['x']-st['cx'])**2+(C[n]['y']-st['cy'])**2)
    out.append(dict(id=slug(names[col]),name=names[col],color=col,continent=cont,cx=round(st['cx']),cy=round(st['cy']),bbox=st['bbox'],polys=st['polys']))
out.sort(key=lambda s:s['name'])
geo=dict(width=g['width'],height=g['height'],continents={k:dict(x=round(v['x']),y=round(v['y'])) for k,v in C.items()},states=out)
open(f'{S}/site_build/map/states.js','w',encoding='utf-8').write('/* Сгенерировано из карты V4: границы государств (в пикселях полной карты 16000×8000). */\nconst GEO = '+json.dumps(geo,ensure_ascii=False,separators=(',',':'))+';\n')
from collections import Counter
print(len(out),'states; missing names in geo:',missing)
print(Counter(s['continent'] for s in out))
print('dup ids',[k for k,v in Counter(s['id'] for s in out).items() if v>1])
