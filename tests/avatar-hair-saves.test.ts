import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, parseLook, serializeLook } from '../src/fashion/look';
import { resolveLook, hasHat, HAT_MODELS } from '../src/render/avatar/custom/spec';
import { BUN_UNDER } from '../src/render/avatar/custom/builders';

/** Saves written by the 4d1cb95 test build (serializeLook output captured on that commit, verbatim). */
const SAVED_4D1CB95: Record<string, string> = {
  f_bun: "{\"v\":1,\"body\":\"f\",\"slots\":{\"skin\":\"skin_peach\",\"faceShape\":\"face_round\",\"eyes\":\"eyes_round\",\"eyeColor\":\"eyecol_plum\",\"brows\":\"brow_natural\",\"nose\":\"nose_base\",\"mouth\":\"mouth_base\",\"hair\":\"hair_bun_high\",\"hairColor\":\"haircol_pink\",\"details.blush\":\"det_blush\",\"top\":\"tee_cheese\",\"jacket\":\"jacket_green\",\"pants\":\"pants_shorts_black\",\"shoes\":\"shoes_lime\",\"acc.bag\":\"acc_backpack\"}}",
  f_bun_cap: "{\"v\":1,\"body\":\"f\",\"slots\":{\"skin\":\"skin_peach\",\"faceShape\":\"face_round\",\"eyes\":\"eyes_round\",\"eyeColor\":\"eyecol_plum\",\"brows\":\"brow_natural\",\"nose\":\"nose_base\",\"mouth\":\"mouth_base\",\"hair\":\"hair_bun_high\",\"hairColor\":\"haircol_pink\",\"details.blush\":\"det_blush\",\"top\":\"tee_cheese\",\"jacket\":\"jacket_green\",\"pants\":\"pants_shorts_black\",\"shoes\":\"shoes_lime\",\"acc.bag\":\"acc_backpack\",\"acc.hat\":\"acc_cap\"}}",
  f_braids_straw: "{\"v\":1,\"body\":\"f\",\"slots\":{\"skin\":\"skin_peach\",\"faceShape\":\"face_round\",\"eyes\":\"eyes_round\",\"eyeColor\":\"eyecol_plum\",\"brows\":\"brow_natural\",\"nose\":\"nose_base\",\"mouth\":\"mouth_base\",\"hair\":\"hair_braids\",\"hairColor\":\"haircol_pink\",\"details.blush\":\"det_blush\",\"top\":\"tee_cheese\",\"jacket\":\"jacket_green\",\"pants\":\"pants_shorts_black\",\"shoes\":\"shoes_lime\",\"acc.bag\":\"acc_backpack\",\"acc.hat\":\"acc_strawhat\"}}",
  m_bun_phones: "{\"v\":1,\"body\":\"m\",\"slots\":{\"skin\":\"skin_peach\",\"faceShape\":\"face_round\",\"eyes\":\"eyes_round\",\"eyeColor\":\"eyecol_brown\",\"brows\":\"brow_thick\",\"nose\":\"nose_base\",\"mouth\":\"mouth_base\",\"hair\":\"hair_bun_high\",\"hairColor\":\"haircol_pink\",\"beard\":\"beard_none\",\"top\":\"tee_cheese\",\"jacket\":\"jacket_green\",\"pants\":\"pants_black\",\"shoes\":\"shoes_lime\",\"acc.head2\":\"acc_headphones\"}}",
  m_braids_crown: "{\"v\":1,\"body\":\"m\",\"slots\":{\"skin\":\"skin_peach\",\"faceShape\":\"face_round\",\"eyes\":\"eyes_round\",\"eyeColor\":\"eyecol_brown\",\"brows\":\"brow_thick\",\"nose\":\"nose_base\",\"mouth\":\"mouth_base\",\"hair\":\"hair_braids\",\"hairColor\":\"haircol_brown\",\"beard\":\"beard_none\",\"top\":\"tee_cheese\",\"jacket\":\"jacket_green\",\"pants\":\"pants_black\",\"shoes\":\"shoes_lime\",\"acc.hat\":\"acc_crown\"}}",
  f_pony_beanie: "{\"v\":1,\"body\":\"f\",\"slots\":{\"skin\":\"skin_peach\",\"faceShape\":\"face_round\",\"eyes\":\"eyes_round\",\"eyeColor\":\"eyecol_plum\",\"brows\":\"brow_natural\",\"nose\":\"nose_base\",\"mouth\":\"mouth_base\",\"hair\":\"hair_pony\",\"hairColor\":\"haircol_pink\",\"details.blush\":\"det_blush\",\"top\":\"tee_cheese\",\"jacket\":\"jacket_green\",\"pants\":\"pants_shorts_black\",\"shoes\":\"shoes_lime\",\"acc.bag\":\"acc_backpack\",\"acc.hat\":\"acc_beanie\"}}",
};
/** Default looks as saved before Phase A/B (119643c), verbatim: default hairs hair_buns / hair_quiff. */
const SAVED_DEFAULTS: Record<string, string> = { f: '{"v":1,"body":"f","slots":{"skin":"skin_peach","faceShape":"face_round","eyes":"eyes_round","eyeColor":"eyecol_plum","brows":"brow_natural","nose":"nose_base","mouth":"mouth_base","hair":"hair_buns","hairColor":"haircol_pink","details.blush":"det_blush","top":"tee_cheese","jacket":"jacket_green","pants":"pants_shorts_black","shoes":"shoes_lime","acc.bag":"acc_backpack"}}', m: '{"v":1,"body":"m","slots":{"skin":"skin_peach","faceShape":"face_round","eyes":"eyes_round","eyeColor":"eyecol_brown","brows":"brow_thick","nose":"nose_base","mouth":"mouth_base","hair":"hair_quiff","hairColor":"haircol_brown","beard":"beard_none","top":"tee_cheese","jacket":"jacket_green","pants":"pants_black","shoes":"shoes_lime"}}' };

describe('save compatibility (v:1) after the bun / hat changes', () => {
  it('default saves and DEFAULT_LOOK are byte-identical', () => {
    for (const [b, s] of Object.entries(SAVED_DEFAULTS)) { expect(serializeLook(parseLook(s))).toBe(s); expect(serializeLook(DEFAULT_LOOK[b as 'f' | 'm'])).toBe(s); }
    expect(resolveLook(parseLook(SAVED_DEFAULTS.f)).hair).toBe('buns'); expect(resolveLook(parseLook(SAVED_DEFAULTS.m)).hair).toBe('quiff');
  });
  it('looks saved on 4d1cb95 with hair_bun_high / hair_braids (+ hats, headphones) load identically', () => {
    for (const s of Object.values(SAVED_4D1CB95)) { const l = parseLook(s); expect(serializeLook(l)).toBe(s); expect(JSON.parse(s).v).toBe(1); expect(l.slots).toEqual(JSON.parse(s).slots); }
    expect(resolveLook(parseLook(SAVED_4D1CB95.f_bun)).hair).toBe('bun_high'); expect(resolveLook(parseLook(SAVED_4D1CB95.m_braids_crown)).hair).toBe('braids');
    expect(hasHat(resolveLook(parseLook(SAVED_4D1CB95.f_bun_cap)))).toBe(true);
  });
  it('every headwear model has a bun variant (no bob fallback left)', () => {
    for (const h of [...HAT_MODELS, 'headphones']) expect(BUN_UNDER[h]).toBeDefined();
    expect(BUN_UNDER.cap).toBe('nape'); expect(BUN_UNDER.crown).toBe('crown'); expect(BUN_UNDER.headphones).toBe('phones');
  });
});
