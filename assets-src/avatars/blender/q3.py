import sys; sys.path.insert(0,'/workspace/yooville/pair/work'); from lib import *
arm,me=load()
bm=bmesh.new(); bm.from_mesh(me.data); m,n=comps(bm)
for c in (33,34,13):
    be=[e for e in bm.edges if e.is_boundary and m[e.verts[0].index]==c]
    # loops
    zs=sorted(set(round((e.verts[0].co.z+e.verts[1].co.z)/2,3) for e in be))
    print(c,len(be),'z of boundary edges',zs[:10],'...',zs[-5:])
    vs=[v for v in bm.verts if m[v.index]==c]; print('  zmin',min(v.co.z for v in vs),'zmax',max(v.co.z for v in vs))
