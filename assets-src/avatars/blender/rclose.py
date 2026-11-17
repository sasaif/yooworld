import sys; sys.path.insert(0,'/workspace/yooville/pair/work'); from lib import *
bpy.ops.wm.open_mainfile(filepath='/workspace/yooville/pair/work/male_stage.blend')
setup_render((800,800),16)
cam(target=(0,0.05,0.8),yaw=10,pitch=25,ortho=0.4,dist=3); render('/workspace/yooville/pair/work/r/top.png')
