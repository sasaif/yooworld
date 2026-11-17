import sys; sys.path.insert(0,'/workspace/yooville/pair/work'); from lib import *
arm,me=load()
print([vg.name for vg in me.vertex_groups][:50])
bm=bmesh.new(); bm.from_mesh(me.data); m,n=comps(bm)
dl=bm.verts.layers.deform.active; bm.verts.ensure_lookup_table()
names={vg.index:vg.name for vg in me.vertex_groups}
for c in [50,48,49,0,2,167,160,16,18,32,33,13,37,15,7]:
    acc={}
    for v in bm.verts:
        if m[v.index]==c:
            for g,w in v[dl].items(): acc[names[g]]=acc.get(names[g],0)+w
    print(c,sorted(acc.items(),key=lambda x:-x[1])[:5])
mat=me.data.materials[0]; print(mat.use_backface_culling, mat.blend_method)
print([k.name for k in me.data.shape_keys.key_blocks])
