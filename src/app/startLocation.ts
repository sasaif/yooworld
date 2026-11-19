/** Where the game starts. Pure + unit-tested.
 *  1. deep link ?lieu=plage|beach|appart|home|maison wins;
 *  2. else a build default (VITE_DEFAULT_LIEU, e.g. the /plage/ test build opens on the beach), once per browser session,
 *     except for the apartment size comparison links (?v=1|2|3), which open in the apartment;
 *  3. else null = the saved location. */
const ALIAS: Record<string, string> = { plage: 'beach', beach: 'beach', appart: 'home', home: 'home', maison: 'home' };
export function startLocation(search: string, buildDefault: string | undefined, defaultUsedThisSession: boolean): string | null {
  const sp = new URLSearchParams(search); const q = sp.get('lieu')?.toLowerCase().trim();
  if (q && ALIAS[q]) return ALIAS[q];
  if (sp.has('v')) return 'home';
  if (buildDefault && ALIAS[buildDefault] && !defaultUsedThisSession) return ALIAS[buildDefault];
  return null;
}
/** Deep link to a place that is never remembered as the current location (?lieu=club|jeux → Yoo Games Club): the game
 *  boots normally (saved place, nothing written) and then travels there. Pure + unit-tested. */
export function deepLinkPlace(search: string): string | null {
  const q = new URLSearchParams(search).get('lieu')?.toLowerCase().trim();
  return q === 'club' || q === 'jeux' ? 'club' : null;
}
