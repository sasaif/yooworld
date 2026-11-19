import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { suspend } from 'suspend-react';
import { ANIM_LIBRARY, ATLAS_MASK, AVATARS, type AvatarDef } from '../../../data/avatars';
import type { Look } from '../../../fashion/types';
import { loadMask, loadParts } from './parts';
import { prepareSource } from './source';
import { buildCustomAvatar, setAtlasMask, type CustomAvatar } from './CustomAvatar';
/** Suspense hook: loads both bodies (hair/bag pieces are shared between them), labels, mask and anim library,
 *  builds one customisable avatar instance and keeps it in sync with `look`. */
export function useCustomAvatar(def: AvatarDef, look: Look, key = 'game'): CustomAvatar {
  const fG = useGLTF(AVATARS.f.url), mG = useGLTF(AVATARS.m.url), lib = useGLTF(ANIM_LIBRARY);
  const [fP, mP, mask] = suspend(() => Promise.all([loadParts(AVATARS.f.parts), loadParts(AVATARS.m.parts), loadMask(ATLAS_MASK)]), ['yw-avatar-data']);
  setAtlasMask(mask);
  const built = useMemo(() => {
    const fem = prepareSource(fG, fP, mask), mal = prepareSource(mG, mP, mask);
    return buildCustomAvatar(def.id === 'm' || def.url === AVATARS.m.url ? mal : fem, fem, mal, lib, def); // extra avatars (club bots) reuse a body by url
  }, [fG, mG, lib, fP, mP, mask, def, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useMemo(() => built.applyLook(look), [built, look]);
  useEffect(() => () => built.dispose(), [built]);
  return built;
}
useGLTF.preload(AVATARS.f.url); useGLTF.preload(AVATARS.m.url);
