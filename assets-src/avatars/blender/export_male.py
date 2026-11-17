import bpy,sys
bpy.ops.wm.open_mainfile(filepath='/workspace/yooville/pair/work/male_stage.blend')
for o in bpy.data.objects: o.select_set(o.type in ('ARMATURE','MESH'))
for o in bpy.data.objects:
    if o.type=='MESH':
        while len(o.data.uv_layers)>1: o.data.uv_layers.remove(o.data.uv_layers[-1])
out=sys.argv[sys.argv.index('--')+1]
bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',use_selection=True,export_yup=True,export_skins=True,export_morph=True,
  export_animations=False,export_vertex_color='ACTIVE',export_image_format='AUTO',export_apply=False,export_extras=False)
