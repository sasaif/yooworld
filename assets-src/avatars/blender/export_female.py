import sys; sys.path.insert(0,'/workspace/yooville/pair/work'); from lib import *
arm,me=load()
while len(me.data.uv_layers)>1: me.data.uv_layers.remove(me.data.uv_layers[-1])
me.name='juanita_female'; me.data.name='juanita_female'; me.data.materials[0].name='juanita_female_mat'
bpy.data.images[0].name='juanita_female_albedo'
for o in bpy.data.objects: o.select_set(o.type in ('ARMATURE','MESH'))
bpy.ops.export_scene.gltf(filepath='/workspace/yooville/pair/juanita_female.glb',export_format='GLB',use_selection=True,export_yup=True,export_skins=True,export_morph=True,export_animations=False,export_vertex_color='NONE',export_apply=False)
