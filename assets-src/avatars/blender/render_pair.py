import bpy,sys,math
sys.path.insert(0,'.'); from lib import *
bpy.ops.wm.read_factory_settings(use_empty=True)
def imp(p,x):
    before=set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=p)
    new=[o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.name.startswith('Icosphere'): bpy.data.objects.remove(o); continue
        if o.parent is None: o.location.x+=x
imp('/workspace/yooville/pair/juanita_female.glb',0.28)
imp('/workspace/yooville/pair/juanita_male.glb',-0.28)
setup_render((1600,1100),32)
R='/workspace/yooville/pair/renders/'
cam((0,0,0.5),3.2,0,4,50); render(R+'pair_front.png')
cam((0,0,0.5),3.2,35,8,50); render(R+'pair_threequarter.png')
setup_render((1000,1000),40)
cam((-0.28,0,0.68),1.0,18,4,55); render(R+'male_face_closeup.png')
cam((0.28,0,0.68),1.0,18,4,55); render(R+'female_face_closeup.png')
