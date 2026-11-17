import sys; sys.path.insert(0,'/workspace/yooville/pair/work'); from lib import *
from bpy_extras.object_utils import world_to_camera_view
arm,me=load()
bm=bmesh.new(); bm.from_mesh(me.data); m,n=comps(bm)
random.seed(2); cols=[(random.random(),random.random(),random.random()) for _ in range(n)]
ca=me.data.color_attributes.new('cid','FLOAT_COLOR','POINT')
for v in me.data.vertices: ca.data[v.index].color=(*cols[m[v.index]],1)
mat=bpy.data.materials.new('cm'); mat.use_nodes=True; nt=mat.node_tree; a=nt.nodes.new('ShaderNodeAttribute'); a.attribute_name='cid'
e=nt.nodes.new('ShaderNodeEmission'); nt.links.new(a.outputs[0],e.inputs[0]); nt.links.new(e.outputs[0],nt.nodes['Material Output'].inputs[0])
me.data.materials.clear(); me.data.materials.append(mat)
setup_render((1000,1000),4)
cent={}
for vi,c in m.items(): cent.setdefault(c,[]).append(me.matrix_world@me.data.vertices[vi].co)
info={}
for yaw,name in [(0,'front'),(180,'back'),(90,'side')]:
    c=cam(yaw=yaw,ortho=1.05,dist=3); bpy.context.view_layer.update()
    render(f'/workspace/yooville/pair/work/r/cm_{name}.png')
    lab=[]
    for k,pts in cent.items():
        if len(pts)<60: continue
        cc=sum(pts,mathutils.Vector())/len(pts); p=world_to_camera_view(bpy.context.scene,c,cc); lab.append((k,p.x,p.y,len(pts)))
    info[name]=lab
json.dump(info,open('/workspace/yooville/pair/work/r/cm_labels.json','w'))
