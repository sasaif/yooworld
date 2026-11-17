import sys,os; sys.path.insert(0,'/workspace/yooville/pair/work'); from lib import *
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree
P=json.load(open('/workspace/yooville/pair/work/params.json')); P.update(json.loads(os.environ.get('POVR','{}'))); TAG=os.environ.get('TAG','')
arm,me=load()
mesh=me.data
# ---- 1. capture shape-key deltas by original vertex index, then drop keys
keys=[k.name for k in mesh.shape_keys.key_blocks][1:]
basis=[v.co.copy() for v in mesh.vertices]
deltas={k:[(mesh.shape_keys.key_blocks[k].data[i].co-basis[i]) for i in range(len(basis))] for k in keys}
me.shape_key_clear()
bm=bmesh.new(); bm.from_mesh(mesh); bm.verts.ensure_lookup_table()
cm,nc=comps(bm)
oid=bm.verts.layers.int.new('oid'); cid=bm.verts.layers.int.new('cid')
for v in bm.verts: v[oid]=v.index; v[cid]=cm[v.index]
dl=bm.verts.layers.deform.active; uvl=bm.loops.layers.uv.active
G={vg.name:vg.index for vg in me.vertex_groups}
def C(v): return v[cid]
# original leg/arm geometry for later weight lookups
orig_pos={v.index:v.co.copy() for v in bm.verts}
# ---- 2. delete female-only parts
DEL=set(P['delete'])
bmesh.ops.delete(bm,geom=[v for v in bm.verts if C(v) in DEL],context='VERTS')
bm.verts.ensure_lookup_table()
HC=Vector(P['head_center'])
def smooth(e0,e1,x):
    t=max(0,min(1,(x-e0)/(e1-e0))); return t*t*(3-2*t)
# ---- 3. hair cap (A = 50,54): lift the front hairline along meridians, add volume
for v in bm.verts:
    if C(v) in (50,54):
        d=v.co-HC; r=d.length; horiz=math.hypot(d.x,d.y)
        el=math.degrees(math.atan2(d.z,horiz)); az=math.atan2(d.x,d.y)  # az=0 -> +Y (front)
        w=smooth(P['front_w0'],P['front_w1'],math.cos(az))
        e0,emax=P['el_lo'],P['el_hi']; e1=P['el_new_lo']+P['hl_asym']*math.sin(az)-P['notch']*math.exp(-(math.degrees(az)/P['notch_w'])**2)
        if el<emax:
            f=e1+(el-e0)*(emax-e1)/(emax-e0) if el>e0 else e1-(e0-el)*0.3
            el2=el+w*(f-el)
        else: el2=el
        top=smooth(P['vol_el0'],P['vol_el1'],el2)
        r2=r*(1+P['vol_side'])+P['vol_top']*top
        # side trim: pull sides (non-front) below ear level up a bit
        side=1-w
        if el2<P['side_el']: el2=el2+side*(P['side_el']-el2)*P['side_pull']
        e=math.radians(el2); h=r2*math.cos(e)
        v.co=HC+Vector((h*math.sin(az),h*math.cos(az),r2*math.sin(e)))

# ---- 3b. rebuild a clean front hairline: stretch each meridian so the cap edge lands on a target curve
if P.get('hairline_fix'):
    hv0=[v for v in bm.verts if C(v) in (50,54)]
    def sp(co):
        d=co-HC; r=d.length; h=math.hypot(d.x,d.y); return r,math.degrees(math.atan2(d.z,h)),math.degrees(math.atan2(d.x,d.y))
    bnd={}
    for v in hv0:
        if v.is_boundary:
            r,el,az=sp(v.co)
            if abs(az)<70: k=int(round(az/3)); bnd[k]=min(bnd.get(k,99),el)
    ks=sorted(bnd)
    def eb(az):
        k=az/3; lo=max([x for x in ks if x<=k],default=ks[0]); hi=min([x for x in ks if x>=k],default=ks[-1])
        if hi==lo: return bnd[lo]
        t=(k-lo)/(hi-lo); return bnd[lo]*(1-t)+bnd[hi]*t
    EM=P['hf_emax']
    for v in hv0:
        r,el,az=sp(v.co)
        if abs(az)>=65 or el>=EM: continue
        w=smooth(65,45,abs(az))
        b=eb(az); t=P['hf_base']+P['hf_asym']*math.sin(math.radians(az))
        t=b+(t-b)*w
        if el<b-1: continue
        el2=t+(el-b)*(EM-t)/max(EM-b,1e-3)
        e=math.radians(el2); a=math.radians(az); h=r*math.cos(e)
        v.co=HC+Vector((h*math.sin(a),h*math.cos(a),r*math.sin(e)))
# ---- 4. quiff: weld halves, smooth front, add swept bump; vertex colours for hair tint
hv=[v for v in bm.verts if C(v) in (50,54)]
cen=[v for v in hv if v.is_boundary and abs(v.co.x)<P['seam_x']]
print('seam verts',len(cen),'max|x|',max([abs(v.co.x) for v in cen] or [0]))
for v in cen: v.co.x=0.0
A=[v for v in cen if C(v)==50]; Bq=[v for v in cen if C(v)==54]
npair=0
for a in A:
    if not Bq: break
    b=min(Bq,key=lambda q:(q.co-a.co).length)
    if (b.co-a.co).length<P.get('seam_pair',0.015):
        m=(a.co+b.co)/2; a.co=m; b.co=m.copy(); npair+=1
print('seam pairs',npair)
bmesh.ops.remove_doubles(bm,verts=hv,dist=P['seam_merge'])
bm.verts.ensure_lookup_table()
hv=[v for v in bm.verts if v.is_valid and C(v) in (50,54)]
def sph(co):
    d=co-HC; r=d.length; h=math.hypot(d.x,d.y); return r,math.degrees(math.atan2(d.z,h)),math.degrees(math.atan2(d.x,d.y))
def unsph(r,el,az):
    e=math.radians(el); a=math.radians(az); h=r*math.cos(e); return HC+Vector((h*math.sin(a),h*math.cos(a),r*math.sin(e)))
for it in range(P['smooth_it']):
    sel=[v for v in hv if sph(v.co)[1]>20 and abs(sph(v.co)[2])<60]
    bmesh.ops.smooth_vert(bm,verts=sel,factor=0.5,use_axis_x=True,use_axis_y=True,use_axis_z=True)
for v in hv:
    r,el,az=sph(v.co)
    b_el=math.exp(-((el-P['q_el'])/P['q_elw'])**2)
    b_az=math.exp(-((az-P['q_az'])/P['q_azw'])**2)
    b=b_el*b_az
    r+=P['q_amp']*b
    az+=P['q_twist']*b
    el+=P['q_lift']*b
    # slim the back
    back=smooth(0.2,0.9,-math.cos(math.radians(az)))
    r-=P['back_slim']*back*smooth(-10,30,el)
    v.co=unsph(r,el,az)

# ---- 4b. swept fringe lock over the forehead (duplicate of a front patch of the cap)
if P['lock']:
    hv=[v for v in bm.verts if v.is_valid and C(v) in (50,54)]
    lf=[f for f in bm.faces if all(C(v) in (50,54) for v in f.verts) and all(P['lock_el'][0]<=sph(v.co)[1]<=P['lock_el'][1] and P['lock_az'][0]<=sph(v.co)[2]<=P['lock_az'][1] for v in f.verts)]
    r=bmesh.ops.duplicate(bm,geom=lf)
    dv=[g for g in r['geom'] if isinstance(g,bmesh.types.BMVert)]
    el0,el1=P['lock_el']; a0,a1=P['lock_az']
    for v in dv:
        rr,el,az=sph(v.co)
        t=(el1-el)/(el1-el0)          # 0 at top, 1 at bottom of the lock
        u=(az-a0)/(a1-a0)
        edge=math.sin(math.pi*max(0,min(1,u)))  # thicker in the middle of the lock
        rr+=P['lock_off']*(0.3+0.7*edge)*(1-0.5*t)
        el-=P['lock_droop']*t**1.3
        az+=P['lock_sweep']*t
        v.co=unsph(rr,el,az)
# ---- 5. brows: thicker, a bit lower & straighter
for side in (167,168):
    vs=[v for v in bm.verts if C(v)==side]
    if not vs: continue
    c=sum((v.co for v in vs),Vector())/len(vs)
    for v in vs:
        d=v.co-c; d.z*=P['brow_thick']; d.x*=P['brow_len']
        v.co=c+d+Vector((0,0,P['brow_dz']))
# ---- 6a. eye-liner flick: pull outer corner in/down
for side in (161,163):
    for v in [v for v in bm.verts if C(v)==side]:
        ax_=abs(v.co.x)
        if ax_>P['flick_x']:
            nx=P['flick_x']+(ax_-P['flick_x'])*P['flick_k']; v.co.x=math.copysign(nx,v.co.x)
            v.co.z=v.co.z-(v.co.z-P['flick_zc'])*(1-P['flick_k'])*0.6
# ---- 6. lashes: shrink
for side in (160,162):
    vs=[v for v in bm.verts if C(v)==side]
    if not vs: continue
    zmax=max(v.co.z for v in vs); xs=[v.co.x for v in vs]; xc=(min(xs)+max(xs))/2
    for v in vs:
        v.co.z=zmax-(zmax-v.co.z)*P['lash_scale']
        v.co.x=xc+(v.co.x-xc)*P['lash_w']

# ---- 7. body: longer legs (stretch between shoe top and hips), broader shoulders, wider torso
Z0,Z1,K=P['leg_z0'],P['leg_z1'],P['leg_k']
def fz(z): return z if z<=Z0 else (Z0+(z-Z0)*K if z<=Z1 else z+(Z1-Z0)*(K-1))
GN={i:n for n,i in G.items()}
ARM_L={G[n] for n in G if n.startswith('LeftArm') or n.startswith('LeftForeArm') or n.startswith('LeftHand')}
ARM_R={G[n] for n in G if n.startswith('RightArm') or n.startswith('RightForeArm') or n.startswith('RightHand')}
SH=P['shoulder_dx']
for v in bm.verts:
    ws=v[dl]; tot=sum(ws.values()) or 1
    al=(sum(w for g,w in ws.items() if g in ARM_L)+0.5*ws.get(G['LeftShoulder'],0))/tot
    ar=(sum(w for g,w in ws.items() if g in ARM_R)+0.5*ws.get(G['RightShoulder'],0))/tot
    x,y,z=v.co
    tw=smooth(P['torso_z0'],P['torso_z0']+0.04,z)*(1-smooth(P['torso_z1']-0.03,P['torso_z1'],z))*(1-min(1,al+ar))
    if C(v) not in (0,2,3,6) and z<0.5: x*=1+P['torso_sx']*tw
    x+= -SH*al + SH*ar
    v.co=Vector((x,y,fz(z)))
# ---- 8. joggers: inflate the leg-skin tubes (already weighted to the leg bones) into trouser legs
bones={b.name:(arm.matrix_world@b.head_local) for b in arm.data.bones}
U0,V0,U1,V1=P['pant_uv']
for cc_leg,cc_sh,bn in ((13,(33,34),'LeftLeg'),(14,(35,36),'RightLeg')):
    tv=[v for v in bm.verts if C(v)==cc_leg]
    sv=[v for v in bm.verts if C(v) in cc_sh]
    hz=min(v.co.z for v in sv)
    ax=Vector((sum(v.co.x for v in tv)/len(tv),sum(v.co.y for v in tv)/len(tv)))
    hem=[ (Vector((v.co.x,v.co.y))-ax).length for v in sv if v.co.z<hz+0.02]
    Rh=sum(hem)/len(hem)
    # bin radii by z
    bins={}
    for v in tv: bins.setdefault(round(v.co.z/0.008),[]).append((Vector((v.co.x,v.co.y))-ax).length)
    def rmean(z):
        k=round(z/0.008)
        for dk in (0,1,-1,2,-2,3,-3):
            if k+dk in bins: return sum(bins[k+dk])/len(bins[k+dk])
        return 0.03
    ztop=max(v.co.z for v in tv)
    prof=P['pant_prof']  # [[z_frac_from_hem_to_ankle, radius_scale_of_hem]]
    def rp(z):
        zs=[hz-(hz-0.10)*f for f,_ in prof]; rs=[r for _,r in prof]
        if z>=zs[0]: return Rh*rs[0]
        for i in range(len(zs)-1):
            if zs[i]>=z>=zs[i+1]:
                t=(zs[i]-z)/(zs[i]-zs[i+1]); return Rh*(rs[i]+(rs[i+1]-rs[i])*t)
        return Rh*rs[-1]
    for v in tv:
        d=Vector((v.co.x,v.co.y))-ax; sc=rp(v.co.z)/max(rmean(v.co.z),1e-4)
        d*=sc; v.co.x=ax.x+d.x; v.co.y=ax.y+d.y
    for f in {f for v in tv for f in v.link_faces}:
        for l in f.loops:
            p=l.vert.co; ang=(math.atan2(p.y-ax.y,p.x-ax.x)+math.pi)/(2*math.pi)
            l[uvl].uv=(U0+(U1-U0)*(0.15+0.7*abs(ang-0.5)*2), V0+(V1-V0)*min(1,max(0,(p.z-0.05)/0.2)))
# ---- 9. vertex colours: hair tint + pink streaks, white elsewhere
col=bm.loops.layers.float_color.new('Col')
hairc=Vector(P['hair_col']); pinkc=Vector(P['hl_col'])
for f in bm.faces:
    for l in f.loops:
        v=l.vert
        if C(v) in (50,54):
            r_,el,az=sph(v.co)
            st=0
            if P['highlights']:
                for a0 in P['hl_az']:
                    st=max(st,math.exp(-((az-a0)/P['hl_w'])**2))
                st*=smooth(P['hl_el0'],P['hl_el0']+15,el)
            c=hairc.lerp(pinkc,st)
            l[col]=(c.x,c.y,c.z,1)
        else: l[col]=(1,1,1,1)

bm.to_mesh(mesh); bm.free()
mesh.update()
# ---- shape keys rebuilt
me.shape_key_add(name='Basis')
oidattr=mesh.attributes['oid'].data
for k in keys:
    kb=me.shape_key_add(name=k,from_mix=False)
    for i,v in enumerate(mesh.vertices):
        o=oidattr[i].value
        if o>=0: kb.data[i].co=v.co+deltas[k][o]

# ---- 10. material: male texture * vertex colour
mat=mesh.materials[0].copy(); mat.name='juanita_male_mat'; mesh.materials[0]=mat
nt=mat.node_tree; tex=[n for n in nt.nodes if n.type=='TEX_IMAGE'][0]
img=bpy.data.images.load('/workspace/yooville/pair/work/male_albedo.png'); img.name='juanita_male_albedo'; tex.image=img
bsdf=[n for n in nt.nodes if n.type=='EMISSION'][0]
ca=nt.nodes.new('ShaderNodeVertexColor'); ca.layer_name='Col'
mix=nt.nodes.new('ShaderNodeMix'); mix.data_type='RGBA'; mix.blend_type='MULTIPLY'; mix.inputs['Factor'].default_value=1.0
nt.links.new(tex.outputs['Color'],mix.inputs[6]); nt.links.new(ca.outputs['Color'],mix.inputs[7]); nt.links.new(mix.outputs[2],bsdf.inputs['Color'])
# ---- 11. armature rest pose to match
bpy.context.view_layer.objects.active=arm; bpy.ops.object.mode_set(mode='EDIT')
for eb in arm.data.edit_bones:
    n=eb.name; dx=0
    if n.startswith(('LeftArm','LeftForeArm','LeftHand')): dx=-SH
    if n.startswith(('RightArm','RightForeArm','RightHand')): dx=SH
    h=eb.head.copy(); t=eb.tail.copy()
    h.x+=dx; t.x+=dx
    if n=='LeftShoulder': t.x-=SH
    if n=='RightShoulder': t.x+=SH
    h.z=fz(h.z); t.z=fz(t.z); eb.head=h; eb.tail=t
bpy.ops.object.mode_set(mode='OBJECT')
me.name='juanita_male'; mesh.name='juanita_male'
bpy.ops.wm.save_as_mainfile(filepath=f'/workspace/yooville/pair/work/male_stage{TAG}.blend')
if P.get('render_head'):
    setup_render((700,700),16)
    for yaw,n in [(0,'f'),(35,'tq'),(90,'s'),(160,'b')]:
        cam(target=(0,0,0.72),yaw=yaw,ortho=0.62,dist=3); render(f'/workspace/yooville/pair/work/r/mh_{n}.png')
    cam(target=(0,0.1,0.66),yaw=15,ortho=0.32,dist=3); render('/workspace/yooville/pair/work/r/mface.png')
    cam(target=(0,0.05,0.78),yaw=20,pitch=12,ortho=0.45,dist=3); render(f'/workspace/yooville/pair/work/r/hairc{TAG}.png')
    if P.get('only_close'): raise SystemExit
    for yaw,n in [(0,'f'),(35,'tq'),(90,'s'),(180,'b')]:
        cam(target=(0,0,0.49),yaw=yaw,ortho=1.08,dist=3); render(f'/workspace/yooville/pair/work/r/mb_{n}.png')
