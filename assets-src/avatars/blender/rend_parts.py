import sys; sys.path.insert(0,'/workspace/yooville/pair/work'); from lib import *
arm,me=load()
bm=bmesh.new(); bm.from_mesh(me.data); m,n=comps(bm)
groups={'A_50_54':[50,54],'B_48_52':[48,52],'C_49_53':[49,53],'D_head':[0,2,3,6,175,176,160,161,162,163,178,179,180,181,166,5,167,168]}
setup_render((600,600),12)
base=me.data.copy()
for g,ids in groups.items():
    me.data=base.copy(); bm=bmesh.new(); bm.from_mesh(me.data); bm.verts.ensure_lookup_table()
    dv=[v for v in bm.verts if m[v.index] not in ids]; bmesh.ops.delete(bm,geom=dv,context='VERTS'); bm.to_mesh(me.data)
    for yaw,nm in [(0,'f'),(90,'s'),(180,'b')]:
        cam(target=(0,0,0.7),yaw=yaw,ortho=0.6,dist=3); render(f'/workspace/yooville/pair/work/r/p_{g}_{nm}.png')
