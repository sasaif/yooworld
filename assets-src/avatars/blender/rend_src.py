import sys; sys.path.insert(0,'/workspace/yooville/pair/work'); from lib import *
arm,me=load()
setup_render((700,900),16)
for yaw,n in [(0,'front'),(35,'tq'),(90,'side'),(180,'back')]:
    cam(yaw=yaw,ortho=1.05,dist=3); bpy.context.scene.render.resolution_x=800; bpy.context.scene.render.resolution_y=800
    render(f'/workspace/yooville/pair/work/r/src_{n}.png')
