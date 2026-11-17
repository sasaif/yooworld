"""Mobile optimisation of an avatar GLB (no Blender needed).
- resize the base-colour texture (default 1024) and re-encode as JPEG (opaque material)
- drop KHR_materials_unlit so the model is lit like the room (roughness 1, metal 0)
usage: python3 tools/optimize_avatar.py in.glb out.glb [size] [quality]
"""
import json, struct, sys, io
from PIL import Image

def read(p):
    b = open(p, 'rb').read(); n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n]); off = 20 + n; bl = struct.unpack('<I', b[off:off + 4])[0]
    return j, bytearray(b[off + 8: off + 8 + bl])

def write(p, j, views):
    out = bytearray(); 
    for i, data in enumerate(views):
        while len(out) % 4: out.append(0)
        j['bufferViews'][i]['byteOffset'] = len(out); j['bufferViews'][i]['byteLength'] = len(data); j['bufferViews'][i]['buffer'] = 0
        out += data
    while len(out) % 4: out.append(0)
    j['buffers'] = [{'byteLength': len(out)}]
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(p, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total)); f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(out), 0x004E4942)); f.write(out)

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]; size = int(sys.argv[3]) if len(sys.argv) > 3 else 1024; q = int(sys.argv[4]) if len(sys.argv) > 4 else 88
    j, bn = read(src)
    views = [bytes(bn[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]) for v in j['bufferViews']]
    for im in j.get('images', []):
        i = im['bufferView']; pic = Image.open(io.BytesIO(views[i])).convert('RGB').resize((size, size), Image.LANCZOS)
        buf = io.BytesIO(); pic.save(buf, 'JPEG', quality=q, optimize=True); views[i] = buf.getvalue(); im['mimeType'] = 'image/jpeg'
    for m in j['materials']:
        m.get('extensions', {}).pop('KHR_materials_unlit', None)
        if not m.get('extensions'): m.pop('extensions', None)
        pbr = m.setdefault('pbrMetallicRoughness', {}); pbr['metallicFactor'] = 0.0; pbr['roughnessFactor'] = 1.0
    for k in ('extensionsUsed', 'extensionsRequired'):
        if k in j:
            j[k] = [e for e in j[k] if e != 'KHR_materials_unlit']
            if not j[k]: j.pop(k)
    write(dst, j, views)
    print(dst, 'ok')
