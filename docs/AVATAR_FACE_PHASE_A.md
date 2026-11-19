# Avatar face — Phase A (branch `feature/avatar-face`, base `119643c`)

Approved by Alessandro on 2026-11-19 (11:06, Paris time). This covers the smiling mouth, the iris and catchlights, the 5 expressions, the Mood menu, chat emojis, and the return to neutral.
Not included: the +8° head tilt, hair changes, and any change to furniture, skeleton, proportions, sitPose or interactionRegistry.

## What is on the branch (new modules + art-owned files only)
| File | Role |
|---|---|
| `src/avatar/face/faceV2.ts` | Smile painter and iris ×1.18 + catchlights painter (the prototype values), plus a pure `scaleIrisPixels` |
| `src/avatar/face/items.ts` | New items `mouth_smile` and `eyes_sparkle` (free, additive) |
| `src/fashion/types.ts`, `catalogue.ts`, `render/avatar/custom/spec.ts`, `decals.ts` | Small additive edits that register and paint the new items. These files are art-owned and **unchanged on `feature/gameplay-polish`** |
| `src/avatar/expressions/*` | Presets, emoji mapper, bus, `ExpressionLayer`, `faceMorphIndex`/`writeFaceMorphs`, `syncExpressionBadge`, chat bridge |
| `src/ui/mood/*` | `MoodMenu` (dock button + accessible popover), `ExpressionChatBridge`, `mood.css` (menu + "!" badge) |
| `tests/avatar-expressions.test.ts`, `tests/avatar-face-v2.test.ts` | 21 tests |

Saves: schema `{v:1, body, slots}` is unchanged. Existing ids and `DEFAULT_LOOK` are byte-identical (tested), so old saves render as before.
An older build that reads a save containing a new id falls back to the base option through `sanitizeLook`.

## Hooks still needed in files owned by YW Gameplay (NOT applied on this branch)
Exact diffs: `art/proposals/phaseA/hook_119643c_*.diff` and `hook_gp_*.diff`. The applier `apply_hooks.py` is anchored on strings and applies cleanly to both trees.
With the hooks applied in a scratch copy, `tsc` and `vitest` were checked on both trees.

### `src/render/Character.tsx`, inside `function Character`
| # | What | 119643c | gameplay-polish (de740be) |
|---|---|---|---|
| C1 | import | after l.13 | after l.13 |
| C2 | `face` useMemo + `badge` ref | l.36 (replace) | l.40 (replace) |
| C3 | per-frame face write in `useFrame` | l.149–150 (replace 2 lines) | l.156–157 (replace 2 lines) |
| C4 | badge element in `.tagwrap` | before l.175 (`bubble`) | before l.191 (`bubble`) |

```diff
 import { FaceAnimator, morphIndex } from './avatar/face';
+import { ExpressionLayer, expressionBus, faceMorphIndex, syncExpressionBadge, writeFaceMorphs } from '../avatar/expressions';
-  const face = useMemo(() => ({ anim: new FaceAnimator(), idx: built.faces.map((m) => morphIndex(m.morphTargetDictionary!)) }), [built]);
+  const face = useMemo(() => ({ anim: new FaceAnimator(), expr: new ExpressionLayer(c.id, expressionBus), idx: faceMorphIndex(built.faces) }), [built, c.id]); const badge = useRef<HTMLDivElement>(null);
-    const w = face.anim.update(dt, { emote: s.mode === 'emote', talking, sitting: s.mode === 'sitting', walking: s.mode === 'walk' });
-    built.faces.forEach((m, i) => { const ix = face.idx[i]; for (const k in w) { const j = ix[k as keyof typeof w]; if (j !== undefined) m.morphTargetInfluences![j] = w[k as keyof typeof w]; } });
+    const w = face.expr.apply(face.anim.update(dt, { emote: s.mode === 'emote', talking, sitting: s.mode === 'sitting', walking: s.mode === 'walk' }), dt, built.spec()?.morph);
+    writeFaceMorphs(built.faces, face.idx, w); syncExpressionBadge(badge.current, face.expr);
           <div className="tagwrap">
+            <div ref={badge} className="expr-badge" aria-hidden="true" />
             <div ref={bubble} className="bubble" />
```

### `src/ui/Hud.tsx`
| # | What | 119643c | gameplay-polish |
|---|---|---|---|
| H1 | import + stable `isChar` | after l.16 | after l.16 |
| H2 | chat bridge, in `Hud()` | after l.27 (dock line) | after l.27 |
| H3 | Mood button, in `PlayDock()` | after l.109 (Danse) | after l.109 |

```diff
 import { chatScopeNote, netBadge } from '../net/netStatus';
+import { MoodMenu, ExpressionChatBridge } from './mood/MoodMenu';
+const isChar = (id: string) => !!world.chars[id];
       {s.mode === 'play' ? <PlayDock /> : <EditDock />}
+      <ExpressionChatBridge chat={game.chat} isChar={isChar} />
       <button onClick={() => game.toggleEmote()} className={emote ? 'on' : ''}>🎉<span>Danse</span></button>
+      <MoodMenu charId={active} />
```

### Chat files (`social.ts`, `GameController.ts`, ChatSheet): **no change needed**
Chat emojis go through the public `game.chat.onMessage` API (`installChatExpressions`), which is mounted by H2.
