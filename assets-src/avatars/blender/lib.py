import bpy,bmesh,math,mathutils,json,random
SRC='/workspace/yooville/pair/work/juanita_src.glb'
def load(path=SRC):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    for o in list(bpy.data.objects):
        if o.name.startswith('Icosphere'): bpy.data.objects.remove(o)
    me=[o for o in bpy.data.objects if o.type=='MESH'][0]
    arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]
    return arm,me
def comps(bm):
    bm.verts.ensure_lookup_table(); seen={}; cid=0
    for v in bm.verts:
        if v.index in seen: continue
        st=[v]; seen[v.index]=cid
        while st:
            x=st.pop()
            for e in x.link_edges:
                y=e.other_vert(x)
                if y.index not in seen: seen[y.index]=cid; st.append(y)
        cid+=1
    return seen,cid
def setup_render(res=(900,900),samples=24):
    sc=bpy.context.scene; sc.render.engine='CYCLES'; sc.cycles.samples=samples; sc.cycles.device='CPU'
    sc.render.resolution_x,sc.render.resolution_y=res; sc.render.film_transparent=False
    w=bpy.data.worlds.new('w'); sc.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[0].default_value=(0.92,0.9,0.97,1); w.node_tree.nodes['Background'].inputs[1].default_value=0.9
    sc.view_settings.view_transform='Standard'
    for n,(loc,en) in {'key':((1.5,2.5,2.5),300),'fill':((-2,1.5,1.2),120),'rim':((0,-2.5,2),150)}.items():
        L=bpy.data.lights.new(n,'AREA'); L.energy=en; L.size=2; o=bpy.data.objects.new(n,L); sc.collection.objects.link(o); o.location=loc
        d=mathutils.Vector((0,0,0.5))-o.location; o.rotation_euler=d.to_track_quat('-Z','Y').to_euler()
def cam(target=(0,0,0.47),dist=2.2,yaw=0,pitch=0,lens=50,ortho=None):
    sc=bpy.context.scene
    c=bpy.data.objects.get('Cam')
    if not c:
        c=bpy.data.objects.new('Cam',bpy.data.cameras.new('Cam')); sc.collection.objects.link(c); sc.camera=c
    t=mathutils.Vector(target); y=math.radians(yaw); p=math.radians(pitch)
    c.location=t+mathutils.Vector((math.sin(y)*math.cos(p),math.cos(y)*math.cos(p),math.sin(p)))*dist
    c.rotation_euler=(t-c.location).to_track_quat('-Z','Y').to_euler(); c.data.lens=lens
    if ortho: c.data.type='ORTHO'; c.data.ortho_scale=ortho
    else: c.data.type='PERSP'
    return c
def render(path):
    bpy.context.scene.render.filepath=path; bpy.ops.render.render(write_still=True)
