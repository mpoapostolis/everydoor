// ============================================================================
// CITY LOT WORDS — the three-free half of the lot table: the kinds a city door can be, the
// archetype each opens onto and the words a script may call one by. Lives apart from
// cityWorld.ts so the script compiler (and the API routes that run it) can resolve
// `Win when: reach the bakery` without pulling three.js in behind it.
// ============================================================================

/** The ARCHETYPE a lot kind opens onto. `precinct` is the prison plan with its jail flow;
 *  `hotel` is the haunted plan (the design's hotel alias) — every other kind is its own. */
export type CityLotKind = 'house' | 'shop' | 'school' | 'office' | 'hospital' | 'precinct' | 'hotel';
export const LOT_ARCHETYPE: Record<CityLotKind, string> = {
  house: 'house', shop: 'shop', school: 'school', office: 'office', hospital: 'hospital', precinct: 'prison', hotel: 'haunted',
};
/** The words a script may use for a lot (`at: bakery`, `reach the police station`), deaccented,
 *  lower-case. One kind per word; a word that is not here is not a lot and stays a free place. */
const LOT_WORDS: Record<string, CityLotKind> = {
  house: 'house', home: 'house', flat: 'house', apartment: 'house', shack: 'house',
  shop: 'shop', store: 'shop', bakery: 'shop', pizza: 'shop', pizzeria: 'shop', market: 'shop', cafe: 'shop', restaurant: 'shop',
  arcade: 'shop', 'noodle bar': 'shop', 'toy shop': 'shop', 'book shop': 'shop',
  school: 'school', classroom: 'school', gym: 'school',
  office: 'office', bank: 'office', work: 'office', 'post office': 'office',
  hospital: 'hospital', clinic: 'hospital', pharmacy: 'hospital', lab: 'hospital',
  precinct: 'precinct', police: 'precinct', 'police station': 'precinct', jail: 'precinct', prison: 'precinct', station: 'precinct',
  hotel: 'hotel', motel: 'hotel', inn: 'hotel', 'haunted house': 'hotel', haunted: 'hotel', 'ghost house': 'hotel',
};
/** The lot KIND a free-text place names, or undefined when the words are not a building. */
export function lotKindForWord(place: string | undefined): CityLotKind | undefined {
  const w = String(place ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^(the|a|an|my|to|at|in)\s+/g, '').trim();
  if (!w) return undefined;
  if (LOT_WORDS[w]) return LOT_WORDS[w];
  for (const [k, v] of Object.entries(LOT_WORDS)) if (w.endsWith(' ' + k) || w.startsWith(k + ' ')) return v;
  return undefined;
}

