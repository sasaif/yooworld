import { EXPRESSIONS, PRESETS, type Expression } from '../../avatar/expressions/presets';
/** Mood/Emotes menu entries (pure data, unit-tested): order, emoji, accessible label. */
export interface MoodItem { id: Expression; emoji: string; label: string; aria: string }
export const moodItems = (): MoodItem[] => EXPRESSIONS.map((id) => ({ id, emoji: PRESETS[id].emoji, label: PRESETS[id].label, aria: `Humeur : ${PRESETS[id].label}` }));
