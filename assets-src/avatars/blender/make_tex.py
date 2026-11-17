import numpy as np, colorsys, json
from PIL import Image
im=np.asarray(Image.open('albedo.png').convert('RGB')).astype(np.float32)/255; W=im.shape[0]
out=im.copy()
def box(u0,v0,u1,v1): return slice(int((1-v1)*W),int((1-v0)*W)), slice(int(u0*W),int(u1*W))
def rgb2hsv(a):
    r,g,b=a[...,0],a[...,1],a[...,2]; mx=a.max(-1); mn=a.min(-1); d=mx-mn+1e-9
    h=np.where(mx==r,((g-b)/d)%6,np.where(mx==g,(b-r)/d+2,(r-g)/d+4))/6.0
    h=np.where(mx-mn<1e-6,0,h); s=np.where(mx>0,(mx-mn)/(mx+1e-9),0); return np.stack([h,s,mx],-1)
def hsv2rgb(a):
    h,s,v=a[...,0]*6,a[...,1],a[...,2]; i=np.floor(h).astype(int)%6; f=h-np.floor(h)
    p=v*(1-s); q=v*(1-s*f); t=v*(1-s*(1-f))
    r=np.choose(i,[v,q,p,p,t,v]); g=np.choose(i,[t,v,v,q,p,p]); b=np.choose(i,[p,p,t,v,v,q]); return np.stack([r,g,b],-1)
# 1. hair region (cap A + any pink hair pixels in its box) -> neutral light strands (for vertex-colour tint)
ys,xs=box(0.356,0.304,0.6,0.68); reg=out[ys,xs]; h=rgb2hsv(reg)
pink=(h[...,1]>0.35)&(h[...,0]>0.80)
lum=reg.max(-1)  # value
# normalise value so strands keep contrast around ~0.85
v=np.clip(lum/ max(np.percentile(lum[pink],90),1e-3)*0.9,0,1)
grey=np.stack([v*1.0,v*0.97,v*0.95],-1)
reg[pink]=grey[pink]; out[ys,xs]=reg
# 2. brows -> dark brown
ys,xs=box(0.955,0.0,0.995,0.12); reg=out[ys,xs]; h=rgb2hsv(reg); m=h[...,1]>0.3
hv=h.copy(); hv[...,0]=0.07; hv[...,1]=0.55; hv[...,2]=h[...,2]*0.32; reg[m]=hsv2rgb(hv)[m]; out[ys,xs]=reg
# 3. iris magenta -> warm brown
ys,xs=box(0.479,0.782,0.615,0.92); reg=out[ys,xs]; h=rgb2hsv(reg); m=(h[...,1]>0.25)&((h[...,0]>0.75)|(h[...,0]<0.05))
hv=h.copy(); hv[...,0]=0.075; hv[...,1]=np.clip(h[...,1]*0.9,0,1); hv[...,2]=h[...,2]*0.85; reg[m]=hsv2rgb(hv)[m]; out[ys,xs]=reg
# 4. reduce blush on the face (front head island)
ys,xs=box(0.004,0.005,0.407,0.41); reg=out[ys,xs]
skin=np.array([0.905,0.70,0.60])  # sampled forehead tone approx
h=rgb2hsv(reg); isskin=(reg.sum(-1)>1.2)&(h[...,0]<0.08)
red=np.clip((reg[...,0]-reg[...,1])-(skin[0]-skin[1]),0,1)  # excess redness
k=np.clip(red*6,0,1)[...,None]*0.85
blend=reg*(1-k)+np.array([reg[...,0].mean()*0+0.90,0.70,0.60])*k
reg[isskin]=blend[isskin]; out[ys,xs]=reg
Image.fromarray((np.clip(out,0,1)*255).astype(np.uint8)).save('male_albedo.png')
print('ok', pink.sum())
