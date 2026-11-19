import { useEffect } from 'react';

type Disposable = { dispose: () => void };

/**
 * Dispose a mesh's own geometry + material (not for shared / cached resources), and the object itself when it owns
 * GPU data of its own. An `InstancedMesh` keeps `instanceMatrix` / `instanceColor` (and `morphTexture`) outside its
 * geometry: only `InstancedMesh.dispose()` tells the renderer to free those buffers. Without it every unmounted
 * `<primitive>` InstancedMesh left 1–2 WebGL buffers behind (+7 per apartment ↔ beach round trip).
 * R3F already does this for JSX `<instancedMesh>`; this helper is for imperatively created ones.
 */
export function disposeMesh(obj: { geometry?: Disposable; material?: Disposable | Disposable[] | null; dispose?: () => unknown }) {
  obj.geometry?.dispose();
  const m = obj.material;
  if (Array.isArray(m)) m.forEach((x) => x.dispose());
  else m?.dispose();
  if (typeof obj.dispose === 'function') obj.dispose();
}

/** Dispose the resource(s) when the component unmounts or the identity changes. */
export function useDispose(resource: Disposable | Disposable[] | null | undefined) {
  useEffect(() => () => {
    if (!resource) return;
    if (Array.isArray(resource)) resource.forEach((x) => x.dispose());
    else resource.dispose();
  }, [resource]);
}
