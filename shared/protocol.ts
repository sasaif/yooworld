/** Client <-> room messages (versioned). Milestone 1: types only; RoomCore implements them in a later milestone. */
export interface Vec { x: number; z: number }
export interface AvatarState { id: string; pos: Vec }
export type ClientMsg =
  | { t: 'move'; x: number; z: number; run?: boolean; seq: number }
  | { t: 'chat'; text: string; cid: string }
  | { t: 'emote'; e: string }
  | { t: 'sit'; seat: string }
  | { t: 'kick'; target: string; reason?: string }
  | { t: 'game'; seq: number; move: unknown };
export type ServerMsg =
  | { t: 'welcome'; you: string; players: AvatarState[]; v: 1 }
  | { t: 'joined' | 'left'; id: string; reason?: string }
  | { t: 'snap'; seq: number; at: number; p: [string, number, number][] }
  | { t: 'chat'; id: string; from: string; text: string; at: number }
  | { t: 'correct'; pos: Vec; reason: string }
  | { t: 'kicked'; until: number }
  | { t: 'error'; code: string };
export const PROTOCOL_VERSION = 1 as const;
