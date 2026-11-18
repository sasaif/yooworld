import { useEffect } from 'react';

type Disposable = { dispose: () => void };

/** Dispose a mesh's own geometry + material (not for shared / cached resources). */
export function disposeMesh(obj: { geometry?: Disposable; material?: Disposable | Disposable[] | null }) {
  obj.geometry?.dispose();
  const m = obj.material;
  if (Array.isArray(m)) m.forEach((x) => x.dispose());
  else m?.dispose();
}

/** Dispose the resource(s) when the component unmounts or the identity changes. */
export function useDispose(resource: Disposable | Disposable[] | null | undefined) {
  useEffect(() => () => {
    if (!resource) return;
    if (Array.isArray(resource)) resource.forEach((x) => x.dispose());
    else resource.dispose();
  }, [resource]);
}
