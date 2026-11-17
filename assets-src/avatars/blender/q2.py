import sys; sys.path.insert(0,'/workspace/yooville/pair/work'); from lib import *
arm,me=load()
for n in me.data.materials[0].node_tree.nodes: print(n.type,n.name,[ (i.name,[l.from_node.name for l in i.links]) for i in n.inputs if i.links])
