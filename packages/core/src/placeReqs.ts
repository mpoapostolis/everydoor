// packages/core/src/placeReqs.ts — SCRIPT → PLACE REQUESTS.
//
// The bridge between a WorldScript and the composer: every character, item and threat that names a
// `place` asks the planner to bind a zone to that word, so the building is planned AROUND the story
// ("the throne room" exists because the King lives there). The brief supplies the rest — `kind` (the
// planner makes the kitchen a kitchen, or the nearest kind THIS archetype has), `step` (the chain
// order, so early rooms sit shallow and the last beat deepest), `item` (a key-like item makes its
// room the key room), `boss`, and `label` (the author's own words, which become the zone's name).
import type { Archetype, PlaceReq, RoomKind } from './composer/types';
import { deaccent } from './composer/typeAndName';
import { storyBrief, type StoryBrief } from './composer/story';
import { lotKindForWord } from './cityLots';
import type { WorldScript } from './types';

const NEAREST_KIND: Record<string, string[]> = {
  kitchen: ['kitchen', 'kitchenette', 'scullery', 'cafeteria', 'dining', 'food_court', 'counter'],
  bedroom: ['bedroom', 'suite', 'ward', 'cells', 'dorm', 'room', 'living'],
  treasure: ['treasury', 'vault', 'strongroom', 'storage', 'cellar', 'store', 'office', 'closet'],
  cell: ['cells', 'cell', 'cell_block', 'containment', 'closet', 'storage', 'janitor', 'bathroom', 'bath'],
  throne: ['throne', 'ballroom', 'great', 'hall', 'living', 'boardroom', 'meeting', 'office', 'lobby'],
  hall: ['hall', 'great', 'ballroom', 'living', 'lobby', 'foyer', 'concourse', 'atrium', 'courtyard', 'gym', 'cafeteria', 'reception'],
  dining: ['dining', 'cafeteria', 'food_court', 'kitchen', 'kitchenette', 'living', 'hall'],
  lobby: ['foyer', 'lobby', 'reception', 'gatehouse', 'gate', 'storefront', 'entrance', 'hall'],
  library: ['library', 'study', 'office', 'archive', 'classroom', 'meeting'],
  office: ['office', 'study', 'warden', 'control', 'meeting', 'boardroom', 'reception', 'library'],
  lab: ['lab', 'laboratory', 'classroom', 'surgery', 'workshop', 'garage', 'study'],
  ward: ['ward', 'suite', 'bedroom', 'cells', 'classroom', 'dorm'],
  surgery: ['surgery', 'lab', 'ward', 'kitchen', 'bath', 'bathroom'],
  morgue: ['morgue', 'cellar', 'storage', 'crypt', 'cells', 'containment', 'cold'],
  control: ['control', 'office', 'warden', 'reception', 'security', 'study', 'gatehouse', 'lobby'],
  storage: ['storage', 'closet', 'store', 'cellar', 'janitor', 'loft', 'armoury', 'delivery', 'garage'],
  cellar: ['cellar', 'storage', 'morgue', 'cells', 'garage', 'closet', 'delivery'],
  chapel: ['chapel', 'shrine', 'library', 'ballroom', 'living', 'study', 'suite'],
  armoury: ['armoury', 'garage', 'storage', 'control', 'janitor', 'gym'],
  tower: ['tower', 'watchtower', 'loft', 'storage', 'control', 'bleachers', 'vents'],
  yard: ['yard', 'courtyard', 'field', 'garden', 'delivery', 'gym', 'foyer'],
  gym: ['gym', 'bleachers', 'field', 'yard', 'courtyard', 'ballroom', 'hall'],
  classroom: ['classroom', 'library', 'meeting', 'office', 'study', 'dining'],
  bath: ['bath', 'bathroom', 'closet', 'storage', 'janitor', 'vents'],
  garage: ['garage', 'delivery', 'storage', 'cellar', 'yard', 'armoury', 'gatehouse'],
  corridor: ['corridor', 'hallway', 'passage', 'locker_hall', 'vents'],
  shop: ['store', 'storefront', 'counter', 'concourse', 'kitchen', 'cafeteria', 'living'],
  containment: ['containment', 'cells', 'storage', 'closet', 'cellar', 'morgue'],
};

/** "janitor's closet" → "Janitor's Closet": the author's words, capitalised for a name plate. */
function labelOf(alias: string): string {
  return alias.trim().split(/\s+/).map((w, i) => (i > 0 && /^(of|the|and|a|an|in|at|on|tou|tis|του|της|στο|στη)$/i.test(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** The archetype kind a request's alias / brief kind should plan as: the arch's own alias table first, then the
 *  nearest kind the archetype actually has for the brief's canonical kind. undefined = let the role decide. */
export function nearestKind(arch: Archetype, alias: string, canonical: string | undefined): RoomKind | undefined {
  const own = arch.aliases[deaccent(alias)];
  if (own && !own.startsWith('*')) return own;
  if (own && own.startsWith('*')) return undefined;           // '*boss', '*key' … — a role word, not a room
  if (!canonical) return undefined;
  if (arch.kinds[canonical]) return canonical;
  for (const k of NEAREST_KIND[canonical] ?? []) if (arch.kinds[k]) return k;
  return undefined;
}

/** The PLACE REQUESTS a script makes of a composed world. `arch` is the archetype being planned:
 *  without it every request stays kind-less and the mission decides by role alone. */
export function placeReqsOf(def: WorldScript, arch?: Archetype, brief: StoryBrief = storyBrief(def)): PlaceReq[] {
  const reqs: PlaceReq[] = [];
  const byAlias = new Map<string, PlaceReq>();
  // a CITY LOT interior: `place: bakery` names the LOT, not a room inside it — the word must not
  // become a zone alias the composer then fails to bind ("no place called bakery" inside the bakery).
  const inLot = !!def.world.lot;
  const stepOf = (kind: 'talk' | 'collect' | 'kill', id: string): number | undefined => brief.chain.find((s) => s.kind === kind && s.targetId === id)?.step;
  const add = (alias: string | undefined, role: PlaceReq['role'], canonical: string | undefined, step: number | undefined, extra: Partial<PlaceReq> = {}) => {
    const a = String(alias ?? '').trim();
    if (!a) return;
    if (inLot && lotKindForWord(a)) return;
    const key = a.toLowerCase();
    const have = byAlias.get(key);
    if (have) {
      // the same room asked for twice: the earliest step wins, a key / boss upgrades the role
      if (step !== undefined && (have.step === undefined || step < have.step)) have.step = step;
      if (extra.item && !have.item) { have.item = extra.item; have.role = 'key'; }
      if (extra.boss && !have.boss) { have.boss = extra.boss; have.role = 'boss'; }
      return;
    }
    const kind = arch ? nearestKind(arch, a, canonical) : undefined;
    const req: PlaceReq = { alias: a, role };
    if (kind) req.kind = kind;
    if (step !== undefined) req.step = step;
    if (extra.item) req.item = extra.item;
    if (extra.boss) req.boss = extra.boss;
    req.label = labelOf(a);
    byAlias.set(key, req); reqs.push(req);
  };
  for (const n of brief.cast) add(n.place, 'npc', n.kind, stepOf('talk', n.id));
  for (const it of brief.items) add(it.place, it.isKey ? 'key' : 'treasure', it.kind, stepOf('collect', it.id), it.isKey ? { item: it.name } : {});
  for (const e of brief.threats) add(e.place, e.boss ? 'boss' : 'combat', undefined, stepOf('kill', e.id), e.boss ? { boss: e.name } : {});
  return reqs;
}
