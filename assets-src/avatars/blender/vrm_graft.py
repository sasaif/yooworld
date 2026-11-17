import json,struct,sys,copy
def read(p):
    b=open(p,'rb').read(); off=12; chunks=[]
    while off<len(b):
        L,T=struct.unpack('<II',b[off:off+8]); chunks.append((T,b[off+8:off+8+L])); off+=8+L
    j=json.loads(chunks[0][1]); bin_=[c for t,c in chunks if t==0x004E4942][0]; return j,bin_
def write(p,j,bin_):
    js=json.dumps(j,separators=(',',':')).encode(); js+=b' '*((4-len(js)%4)%4); bin_+=b'\0'*((4-len(bin_)%4)%4)
    out=struct.pack('<III',0x46546C67,2,12+8+len(js)+8+len(bin_))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(bin_),0x004E4942)+bin_
    open(p,'wb').write(out)
src,_=read(sys.argv[1]); tgt,tb=read(sys.argv[2]); title=sys.argv[4]
v=copy.deepcopy(src['extensions']['VRM'])
sn=[n['name'] for n in src['nodes']]; tn={n['name']:i for i,n in enumerate(tgt['nodes'])}
def rn(i): return tn[sn[i]] if i is not None and i>=0 and sn[i] in tn else -1
for hb in v['humanoid']['humanBones']: hb['node']=rn(hb['node'])
v['humanoid']['humanBones']=[h for h in v['humanoid']['humanBones'] if h['node']>=0]
fp=v['firstPerson']; fp['firstPersonBone']=rn(fp['firstPersonBone'])
for a in fp.get('meshAnnotations',[]): a['mesh']=0
for g in v['secondaryAnimation']['boneGroups']: g['bones']=[rn(x) for x in g['bones'] if rn(x)>=0]; g['center']=-1
mats=tgt['materials']; mp=v['materialProperties'][0]
v['materialProperties']=[]
for m in mats:
    q=copy.deepcopy(mp); q['name']=m['name']; q['textureProperties']={'_MainTex':0,'_ShadeTexture':0}; v['materialProperties'].append(q)
v['meta']['title']=title; v['meta'].pop('texture',None)
v['exporterVersion']='yooville-graft-1.0'
tgt.setdefault('extensions',{})['VRM']=v
tgt['extensionsUsed']=sorted(set(tgt.get('extensionsUsed',[])+['VRM']))
write(sys.argv[3],tgt,tb)
print('ok',len(v['humanoid']['humanBones']),'bones mapped; textureProperties',mp.get('textureProperties'))
