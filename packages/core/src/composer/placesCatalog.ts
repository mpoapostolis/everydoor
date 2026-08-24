// src/engine/composer/placesCatalog.ts — EVERY place the composer can generate, as data for the
// editor's autocomplete and the dev switcher: archetype → kinds → display names + aliases.
// Derived from the archetype registry, so a new kind in an archetype file shows up everywhere.
import { ARCHETYPES, archetypeIds } from './archetypes/index';
import type { ArchetypeId, RoomKind } from './types';

export interface PlaceEntry { archetype: ArchetypeId; kind: RoomKind; names: string[]; aliases: string[]; roles: string[]; people: string[] }

export function placesCatalog(): PlaceEntry[] {
  const out: PlaceEntry[] = [];
  for (const id of archetypeIds()) {
    const a = ARCHETYPES[id]!;
    for (const kind of Object.keys(a.kinds)) {
      const roles = (Object.keys(a.roleMap) as (keyof typeof a.roleMap)[]).filter((r) => a.roleMap[r]?.includes(kind)) as string[];
      const aliases = Object.entries(a.aliases).filter(([, v]) => v === kind).map(([k]) => k);
      out.push({ archetype: id, kind, names: a.naming[kind] ?? [kind], aliases, roles, people: a.kinds[kind].people?.roles ?? [] });
    }
  }
  return out;
}

/** Flat list of words a kid can type after `at:` / `in the` — names + aliases, deduped, per archetype. */
export function placeWords(archetype?: ArchetypeId): string[] {
  const seen = new Set<string>();
  for (const e of placesCatalog()) {
    if (archetype && e.archetype !== archetype) continue;
    for (const w of [...e.names, ...e.aliases]) seen.add(w.toLowerCase());
  }
  return [...seen].sort();
}

/** Archetype words a kid can write after `World:` — ids + keywords. */
export function worldWords(): { archetype: ArchetypeId; words: string[] }[] {
  return archetypeIds().map((id) => ({ archetype: id, words: [id, ...ARCHETYPES[id]!.keywords] }));
}

/** DISPLAY names only (no aliases, no Greeklish) — what the editor SHOWS after `at:`; aliases still resolve. */
export function placeNames(archetype?: ArchetypeId): string[] {
  const seen = new Set<string>();
  for (const e of placesCatalog()) {
    if (archetype && e.archetype !== archetype) continue;
    for (const n of e.names) seen.add(n.toLowerCase());
  }
  return [...seen].sort();
}

/** One clean option per archetype for the `World:` completion — the id plus its best English synonym. */
export function worldOptions(): { archetype: ArchetypeId; label: string; alt?: string }[] {
  const PRETTY: Partial<Record<ArchetypeId, [string, string?]>> = {
    house: ['house', 'mansion'], school: ['school'], shop: ['shop', 'pizza shop'], office: ['office'],
    haunted: ['haunted house', 'hotel'], castle: ['castle', 'fortress'], dungeon: ['dungeon', 'crypt'],
    prison: ['prison', 'jail'], hospital: ['hospital', 'clinic'],
  };
  return archetypeIds().map((id) => { const [label, alt] = PRETTY[id] ?? [id]; return { archetype: id, label, alt }; });
}
