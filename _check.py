import trimesh, itertools
s=trimesh.load('_preview.glb')
g={k:v for k,v in s.geometry.items()}
base=g['base']; lid=g['lid']
def inter(a,b):
    try:
        r=trimesh.boolean.intersection([a,b],engine='manifold'); return r.volume if len(r.faces) else 0
    except Exception as e: return -1
names=[k for k in g if k not in('base','lid')]
for n in names:
    vb,vl=inter(g[n],base),inter(g[n],lid)
    if vb>0.05 or vl>0.05: print(f'{n:32s} vs base {vb:7.2f}  vs lid {vl:7.2f}')
for a,b in itertools.combinations(names,2):
    v=inter(g[a],g[b])
    if v>0.05: print(f'{a} x {b}: {v:.2f}')
print('check done')
