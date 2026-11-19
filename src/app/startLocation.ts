/** Where the game starts. Pure + unit-tested.
 *  1. deep link ?lieu=plage|beach|appart|home|maison wins;
 *  2. else a build default (VITE_DEFAULT_LIEU, e.g. the /plage/ test build opens on the beach), once per browser session,
 *     except for the apartment size comparison links (?v=1|2|3), which open in the apartment;
 *  3. else null = the saved location. */
const ALIAS: Record<string, string> = { plage: 'beach', beach: 'beach', appart: 'home', home: 'home', maison: 'home', club: 'club', jeux: 'club' };
export function startLocation(search: string, buildDefault: string | undefined, defaultUsedThisSession: boolean): string | null {
  const sp = new URLSearchParams(search); const q = sp.get('lieu')?.toLowerCase().trim();
  if (q && ALIAS[q]) return ALIAS[q];
  if (sp.has('v')) return 'home';
  if (buildDefault && ALIAS[buildDefault] && !defaultUsedThisSession) return ALIAS[buildDefault];
  return null;
}
