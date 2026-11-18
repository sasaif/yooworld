import type { NetStatus } from './NetworkTransport';
/** What the HUD says about connectivity. Pure + unit-tested: the offline prototype must never look like multiplayer.
 *  `onlinePlayers` only ever comes from a real server's presence list (there is none yet). */
export interface NetBadge { label: string; short: string; tone: 'local' | 'connecting' | 'online'; detail: string }
export function netBadge(status: NetStatus, onlinePlayers = 0): NetBadge {
  if (status === 'online') return { label: `En ligne · ${onlinePlayers} joueur${onlinePlayers > 1 ? 's' : ''}`, short: 'En ligne', tone: 'online', detail: 'Connecté au serveur YooWorld : les autres joueurs présents voient tes messages.' };
  if (status === 'connecting') return { label: 'Connexion…', short: 'Connexion…', tone: 'connecting', detail: 'Connexion au serveur en cours. Rien n’est encore partagé.' };
  return {
    label: 'Mode local', short: 'Local', tone: 'local',
    detail: 'Prototype hors ligne : aucun serveur, aucun autre joueur. Tes messages, ta maison et tes achats restent sur cet appareil. Juan/Juanita est un personnage local de test, pas un joueur en ligne.',
  };
}
/** Line shown in the chat panel. */
export const chatScopeNote = (status: NetStatus) => (status === 'online' ? 'Visible par les joueurs présents dans ce lieu.' : 'Mode local : seuls tes avatars sur cet appareil voient ces messages. Le multijoueur en ligne n’est pas encore branché.');
