# Juanita pair (female + male) – Yooville

- juanita_female.glb / .vrm : "Juanita" from 100Avatars Round 3 by Polygonal Mind, unchanged (GLB = straight re-export of the original VRM).
- juanita_male.glb : male derivative built procedurally in Blender 4.2 (work/build_male.py + work/params.json + work/make_tex.py) from Juanita's own mesh, rig (41 Mixamo bones, unchanged names), morphs (11) and texture.
- juanita_male.vrm : experimental (VRM0 extension grafted from the original, 30 humanoid bones; not validated in three-vrm).

Licence: CC0 1.0 (original VRM meta: CC0, creditNotation "Unnecessary"). No credit required; courtesy credit: "Base avatar: Juanita, 100Avatars by Polygonal Mind (CC0)".
No Daydaze or other restricted asset is used.

Rebuild: cd work && python3 make_tex.py && blender -b --python build_male.py && blender -b --python export_male.py -- ../juanita_male.glb && python3 vrm_graft.py juanita_src.glb ../juanita_male.glb ../juanita_male.vrm "Juanita Male"
