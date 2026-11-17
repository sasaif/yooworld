import bpy,bmesh,json,mathutils
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='/workspace/yooville/pair/work/juanita_src.glb')
for o in bpy.data.objects: print(o.name,o.type,o.parent.name if o.parent else None, tuple(round(x,3) for x in o.dimensions))
me=[o for o in bpy.data.objects if o.type=='MESH'][0]
arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]
print('arm scale',arm.scale, arm.rotation_euler, 'mesh mw', me.matrix_world)
for b in arm.data.bones: print(b.name, tuple(round(x,3) for x in (arm.matrix_world@b.head_local)))
bm=bmesh.new(); bm.from_mesh(me.data); bm.verts.ensure_lookup_table()
uv=bm.loops.layers.uv.active
# connected components
seen=set(); comps=[]
for v in bm.verts:
  if v.index in seen: continue
  stack=[v]; comp=[]
  seen.add(v.index)
  while stack:
    x=stack.pop(); comp.append(x.index)
    for e in x.link_edges:
      y=e.other_vert(x)
      if y.index not in seen: seen.add(y.index); stack.append(y)
  comps.append(comp)
mw=me.matrix_world
out=[]
for i,c in enumerate(comps):
  co=[mw@bm.verts[k].co for k in c]
  mn=[min(p[a] for p in co) for a in range(3)]; mx=[max(p[a] for p in co) for a in range(3)]
  fs=set()
  for k in c:
    for f in bm.verts[k].link_faces: fs.add(f.index)
  us=[l[uv].uv for fi in list(fs)[:400] for l in bm.faces[fi].loops] if False else []
  bm.faces.ensure_lookup_table()
  uvs=[l[uv].uv for fi in fs for l in bm.faces[fi].loops]
  umn=(min(u.x for u in uvs),min(u.y for u in uvs)); umx=(max(u.x for u in uvs),max(u.y for u in uvs))
  out.append(dict(i=i,nv=len(c),nf=len(fs),mn=[round(x,3) for x in mn],mx=[round(x,3) for x in mx],uv=[round(x,3) for x in umn+umx]))
out.sort(key=lambda d:-d['nf'])
for d in out: print(d)
json.dump(out,open('/workspace/yooville/pair/work/comps.json','w'))
img=bpy.data.images[0]; print(img.name,img.size[:]); img.filepath_raw='/workspace/yooville/pair/work/albedo.png'; img.file_format='PNG'; img.save()
