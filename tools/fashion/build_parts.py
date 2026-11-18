"""Offline pre-processing of the two CC0 avatars for the fashion system (no Blender needed).
1. male legs: copy the female leg UVs (identical topology) so lower legs own a skin island -> shorts/long pants work.
2. label every vertex / triangle with a body part (skin, hair, top zones, shorts, legs, shoes, brows, bag...).
3. feature points (eyes, mouth, nose, ears, head top, neck...) in mesh space + face UV landmarks.
4. one shared atlas label mask (both avatars use the same UV layout) -> public/models/avatars/atlas_mask.png
Usage: python3 tools/fashion/build_parts.py   (reads/writes public/models/avatars)"""
import base64, json, struct, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, __file__.rsplit('/',1)[0])
from glb import mesh, islands, load
ROOT='public/models/avatars/'
L=dict(NONE=0,SKIN_HEAD=1,SKIN_HAND=2,LEG=3,TOP_TORSO=4,TOP_UPPER=5,TOP_FORE=6,TOP_CUFF=7,TOP_COLLAR=8,TOP_HEM=9,TEE=10,SHORTS=11,SHOE=12,SOLE=13,HAIR=14,BROW=15,EYE=16,EYEBALL=17,MOUTH_IN=18,TEETH=19,BAG=20,BAG_STRAP=21,LASH=22,HAIR_BUN=23)

def patch_male_legs():
    F=mesh(ROOT+'juanita_female.glb'); path=ROOT+'juanita_male.glb'
    b=bytearray(open(path,'rb').read()); l=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+l]); off=20+l+8
    M=mesh(path)
    labF,_=islands(F,True); labM,_=islands(M,True)
    def legs(d,lab):
        dom=d['joints'][np.arange(len(d['pos'])),d['weights'].argmax(1)]; out=[]
        for c in np.unique(lab):
            vs=np.where(lab==c)[0]; jn=d['jnames'][np.bincount(dom[vs]).argmax()]
            if jn in ('LeftUpLeg','RightLeg') and len(vs)==75: out.append(vs)
        return np.concatenate(out)
    fv,mv=legs(F,labF),legs(M,labM); assert (fv==mv).all(), 'leg topology differs'
    if np.abs(M['uv'][mv]-F['uv'][fv]).max()<1e-6: print('male legs already patched'); return
    a=j['accessors'][j['meshes'][0]['primitives'][0]['attributes']['TEXCOORD_0']]; bv=j['bufferViews'][a['bufferView']]
    stride=bv.get('byteStride',8); base=off+bv.get('byteOffset',0)+a.get('byteOffset',0)
    for i in mv: b[base+i*stride:base+i*stride+8]=struct.pack('<2f',*F['uv'][i])
    open(path,'wb').write(b); print('patched',len(mv),'male leg UVs')

def classify(d):
    lab,n=islands(d,True); P=d['pos']; uv=d['uv']
    dom=d['joints'][np.arange(len(P)),d['weights'].argmax(1)]
    vlab=np.zeros(len(P),np.uint8); comps=[]
    for c in range(n):
        vs=np.where(lab==c)[0]; comps.append((c,vs,d['jnames'][np.bincount(dom[vs]).argmax()],uv[vs].mean(0)))
    heads=[x for x in comps if x[2]=='Head']; head=max(heads,key=lambda x:len(x[1]))
    spines=[x for x in comps if x[2]=='Spine2']; top=max(spines,key=lambda x:len(x[1]))
    for c,vs,jn,mu in comps:
        u,v=mu; p=P[vs]; k='NONE'
        if c==head[0]: k='SKIN_HEAD'
        elif jn=='Head':
            if 0.76<u<0.95 and 0.04<v<0.48: k='HAIR_BUN'
            elif (0.33<u<0.62 and 0.28<v<0.72) or u<0.06: k='HAIR'
            elif u<0.25 and 0.3<v<0.4: k='MOUTH_IN'
            elif u>0.95 and v>0.9: k='BROW'
            elif len(vs)==72: k='TEETH'
            elif p[:,2].max()-p[:,2].min()>0.08: k='EYEBALL'
            else: k='EYE'
        elif c==top[0]: k='TOP_TORSO'
        elif jn=='Spine2':
            if abs(u-0.314)<0.03 and abs(v-0.175)<0.03: k='TEE'
            elif u>0.8: k='BAG_STRAP'
            else: k='BAG'
        elif jn=='Hips': k='SHORTS'
        elif jn in ('LeftFoot','RightFoot'): k='SHOE'
        elif 'Hand' in jn: k='SKIN_HAND'
        elif jn in ('LeftUpLeg','RightLeg','LeftLeg','RightUpLeg'): k='LEG'
        vlab[vs]=L[k]
    # triangle labels with zones
    tri=d['idx']; tl=vlab[tri[:,0]].copy(); cen=P[tri].mean(1)
    tv=P[vlab==L['TOP_TORSO']]; xmax=np.abs(tv[:,0]).max(); ymax=tv[:,1].max(); ymin=tv[:,1].min()
    t=tl==L['TOP_TORSO']; ax=np.abs(cen[:,0]); y=cen[:,1]
    tl[t&(ax>0.105)]=L['TOP_UPPER']; tl[t&(ax>0.17)]=L['TOP_FORE']; tl[t&(ax>xmax-0.032)]=L['TOP_CUFF']
    tl[t&(ax<=0.105)&(y>ymax-0.03)]=L['TOP_COLLAR']; tl[t&(ax<=0.105)&(y<ymin+0.028)]=L['TOP_HEM']
    tl[(tl==L['SHOE'])&(cen[:,1]<0.02)]=L['SOLE']
    return vlab,tl,lab

def features(d,vlab):
    P=d['pos']; uv=d['uv']; hs=vlab==L['SKIN_HEAD']; H=P[hs]; HU=uv[hs]
    eb=[P[(vlab==L['EYEBALL'])&(np.sign(P[:,0])==s)].mean(0) for s in (1,-1)]   # +x first
    teeth=P[vlab==L['TEETH']].mean(0); f={}
    f['eyeP']=eb[0]; f['eyeN']=eb[1]
    def front(x,y,r=0.012):
        m=(np.abs(H[:,0]-x)<r)&(np.abs(H[:,1]-y)<r); i=np.where(m)[0]; k=i[H[i,2].argmin()]; return H[k],HU[k]
    def uvnear(pt,r=0.05):
        dd=np.linalg.norm(H[:,:2]-pt[:2],axis=1); m=(dd<r)&(H[:,2]<pt[2]+0.06); w=1/(dd[m]+1e-3); return (HU[m]*w[:,None]).sum(0)/w.sum()
    my=teeth[1]-0.004; f['mouth'],f['mouthUV']=front(0,my)
    ny=(my+eb[0][1])/2-0.006; f['nose'],f['noseUV']=front(0,ny)
    for s,nm in ((1,'P'),(-1,'N')):
        e=eb[0] if s>0 else eb[1]
        f['eye'+nm+'UV']=uvnear(e,0.045)
        f['cheek'+nm],f['cheek'+nm+'UV']=front(e[0]*1.05,my+0.035,0.015)
        side=H[np.sign(H[:,0])==s]; ear=side[np.abs(side[:,0])>np.abs(side[:,0]).max()-0.03]; lobe=ear[ear[:,1].argmin()]
        f['ear'+nm]=np.array([lobe[0],lobe[1]+0.012,lobe[2]])
        f['brow'+nm]=P[(vlab==L['BROW'])&(np.sign(P[:,0])==s)].mean(0)
    f['chin'],f['chinUV']=front(0,H[:,1][H[:,2]<-0.1].min()+0.01,0.015)
    f['headTop']=np.array([0,H[:,1].max(),H[:,2][H[:,1]>H[:,1].max()-0.02].mean()]); f['headCenter']=H.mean(0)
    f['headR']=float(np.abs(H[:,0]).max())
    T=P[vlab==L['TOP_TORSO']]; f['neck']=np.array([0,T[:,1].max(),T[np.abs(T[:,0])<0.05][:,2].mean()])
    f['chestFront']=float(T[(np.abs(T[:,0])<0.05)&(T[:,1]>T[:,1].max()-0.1)][:,2].min())
    f['torsoBack']=float(T[(np.abs(T[:,0])<0.08)][:,2].max()); f['torsoHalfW']=float(np.abs(T[np.abs(T[:,1]-T[:,1].max()+0.07)<0.02][:,0]).max())
    f['topY']=[float(T[:,1].min()),float(T[:,1].max())]
    S=P[vlab==L['SHORTS']]; f['hipsY']=float(S[:,1].max()); f['hipsHalfW']=float(np.abs(S[np.abs(S[:,1]-S[:,1].max())<0.03][:,0]).max())
    f['hipsFront']=float(S[np.abs(S[:,1]-S[:,1].max()+0.02)<0.02][:,2].min()); f['hipsBack']=float(S[np.abs(S[:,1]-S[:,1].max()+0.02)<0.02][:,2].max())
    for s,nm in ((1,'P'),(-1,'N')):
        Hd=P[(vlab==L['SKIN_HAND'])&(np.sign(P[:,0])==s)]; w=Hd[np.abs(Hd[:,0]).argmin()]; f['wrist'+nm]=w
    G=P[vlab==L['LEG']]; f['legY']=[float(G[:,1].min()),float(G[:,1].max())]
    return {k:(v.round(5).tolist() if hasattr(v,'tolist') else v) for k,v in f.items()}

def main():
    patch_male_legs()
    mask=np.zeros((1024,1024),np.uint8); owner=np.zeros((1024,1024),np.uint8); conflicts=0
    out={}
    for name in ('female','male'):
        d=mesh(ROOT+f'juanita_{name}.glb'); vlab,tl,lab=classify(d)
        im=Image.new('L',(1024,1024),0); dr=ImageDraw.Draw(im)
        order=np.argsort(tl,kind='stable')
        for ti in order:
            if tl[ti]==0: continue
            dr.polygon([tuple(d['uv'][k]*1024) for k in d['idx'][ti]],fill=int(tl[ti]))
        a=np.array(im); m=(a>0)&(mask>0)&(a!=mask); conflicts+=int(m.sum())
        mask=np.where(mask==0,a,mask)
        ibm={b:d['ibm'][d['jnames'].index(b)].reshape(-1).round(6).tolist() for b in ('Head','Neck','Spine2','Hips','LeftHand','RightHand','LeftFoot','RightFoot','LeftLeg','RightLeg')}
        out[name]=dict(vertexCount=len(d['pos']),triCount=len(tl),labels=L,vertexPart=base64.b64encode(vlab.tobytes()).decode(),triPart=base64.b64encode(tl.tobytes()).decode(),features=features(d,vlab),ibm=ibm)
        counts={k:int((vlab==v).sum()) for k,v in L.items() if (vlab==v).sum()}
        print(name,counts); print(' feat',{k:out[name]['features'][k] for k in ('eyeP','mouth','nose','earP','headTop','neck','mouthUV','eyePUV','eyeNUV','noseUV','cheekPUV')})
        json.dump(out[name],open(ROOT+f'juanita_{name}.parts.json','w'),separators=(',',':'))
    print('mask texel conflicts',conflicts)
    # dilate labels (max filter on labelled areas only) so bilinear sampling at island borders stays labelled
    im=Image.fromarray(mask); grown=im
    for _ in range(4):
        g=np.array(grown.filter(ImageFilter.MaxFilter(3))); cur=np.array(grown); cur=np.where(cur==0,g,cur); grown=Image.fromarray(cur)
    grown.save(ROOT+'atlas_mask.png',optimize=True)
main()
