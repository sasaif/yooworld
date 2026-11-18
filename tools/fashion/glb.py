import json,struct,numpy as np
CT={5120:np.int8,5121:np.uint8,5122:np.int16,5123:np.uint16,5125:np.uint32,5126:np.float32}
NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def load(path):
    b=open(path,'rb').read(); l=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+l])
    off=20+l; bl=struct.unpack('<I',b[off:off+4])[0]; bin_=b[off+8:off+8+bl]
    def acc(i):
        a=j['accessors'][i]; dt=CT[a['componentType']]; n=NC[a['type']]
        if 'bufferView' not in a:
            arr=np.zeros((a['count'],n),dtype=dt); sp=a.get('sparse')
            if sp:
                ii=sp['indices']; vv=sp['values']
                bi=j['bufferViews'][ii['bufferView']]; ix=np.frombuffer(bin_,dtype=CT[ii['componentType']],count=sp['count'],offset=bi.get('byteOffset',0)+ii.get('byteOffset',0))
                bvv=j['bufferViews'][vv['bufferView']]; vals=np.frombuffer(bin_,dtype=dt,count=sp['count']*n,offset=bvv.get('byteOffset',0)+vv.get('byteOffset',0)).reshape(-1,n)
                arr[ix]=vals
            return arr
        bv=j['bufferViews'][a['bufferView']]
        o=bv.get('byteOffset',0)+a.get('byteOffset',0); stride=bv.get('byteStride',0); isz=np.dtype(dt).itemsize*n
        if stride and stride!=isz:
            raw=np.frombuffer(bin_,dtype=np.uint8,count=stride*a['count'],offset=o).reshape(a['count'],stride)[:,:isz].copy()
            arr=raw.view(dt).reshape(a['count'],n)
        else: arr=np.frombuffer(bin_,dtype=dt,count=a['count']*n,offset=o).reshape(a['count'],n)
        return arr
    return j,acc
class UF:
    def __init__(s,n): s.p=np.arange(n)
    def f(s,x):
        p=s.p
        while p[x]!=x: p[x]=p[p[x]]; x=p[x]
        return x
    def u(s,a,b):
        a=s.f(a); b=s.f(b)
        if a!=b: s.p[max(a,b)]=min(a,b)
def mesh(path):
    j,acc=load(path); pr=j['meshes'][0]['primitives'][0]; A=pr['attributes']
    d=dict(pos=acc(A['POSITION']).astype(np.float64),uv=acc(A['TEXCOORD_0']).astype(np.float64),idx=acc(pr['indices']).reshape(-1,3).astype(np.int64),
           joints=acc(A['JOINTS_0']),weights=acc(A['WEIGHTS_0']),targets=[acc(t['POSITION']) for t in pr['targets']])
    d['tnames']=[n.split('.')[-1] for n in j['meshes'][0]['extras']['targetNames']]
    sk=j['skins'][0]; d['jnames']=[j['nodes'][k]['name'] for k in sk['joints']]
    d['ibm']=acc(sk['inverseBindMatrices']).reshape(-1,4,4)
    d['j']=j
    return d
def islands(d, weld=False):
    n=len(d['pos']); uf=UF(n)
    for a,b,c in d['idx']: uf.u(a,b); uf.u(b,c)
    if weld:
        key={}
        for i,p in enumerate(np.round(d['pos'],5)):
            k=tuple(p)
            if k in key: uf.u(i,key[k])
            else: key[k]=i
    root=np.array([uf.f(i) for i in range(n)]); u,lab=np.unique(root,return_inverse=True); return lab,len(u)
