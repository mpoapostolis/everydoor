// src/engine/composer/archetypes/generic.ts — a COMPLETE minimal archetype factory. Used as the
// placeholder for archetypes not yet authored, as the test archetype, and as the fallback
// when a script names a building we have no data for. Every real archetype follows this shape.
import type { Archetype, ArchetypeId, Layout, RoomRecipe } from '../types';
import { CELL } from '../types';
import type { WorldType } from '../../types';

const room = (kind: string, over: Partial<RoomRecipe> = {}): RoomRecipe => ({
  kind, size: [3, 5], ceil: 14,
  anchors: [{ tag: 'surface', n: [0, 1], place: 'wall' }],
  wallItems: { tags: ['wall'], density: 0.3 },
  clutter: { tags: ['clutter'], perCell: 0.05, minDoorDist: 2 },
  light: 'lamp', hideMin: 1, lootMin: 1, npcStand: true,
  people: { n: [0, 1], roles: ['resident'] },
  ...over,
});

export function genericArchetype(id: ArchetypeId, worldType: WorldType, layout: Layout, style = 'house.cozy'): Archetype {
  return {
    id, worldType, layout, style, styleVariants: {}, keywords: [id],
    indoor: layout !== 'settlement', wallH: 14, cell: CELL,
    weenie: { topological: true },
    roleMap: {
      entrance: ['hall'], hub: ['hall'], corridor: ['corridor'], combat: ['room'], elite: ['room'], puzzle: ['room'],
      key: ['store'], lock: ['vault'], treasure: ['vault'], secret: ['store'], npc: ['room'], rest: ['room'],
      vantage: ['room'], boss: ['great'], exit: ['hall'], plain: ['room'], work: ['room'], stairs: ['stairs'],
    },
    kinds: {
      hall: room('hall', { size: [3, 4], anchors: [], people: { n: [1, 2], roles: ['greeter'] } }),
      corridor: room('corridor', { size: [2, 2], anchors: [], clutter: { tags: ['clutter'], perCell: 0, minDoorDist: 2 }, hideMin: 0, lootMin: 0, npcStand: false, people: { n: [0, 0], roles: [] } }),
      room: room('room'),
      store: room('store', { anchors: [{ tag: 'hide', n: [1, 2], place: 'wall' }, { tag: 'loot', n: [1, 1], place: 'floor', focal: true }], hideMin: 1, lootMin: 1 }),
      vault: room('vault', { anchors: [{ tag: 'loot', n: [1, 2], place: 'floor', focal: true }], lootMin: 2 }),
      great: room('great', { size: [5, 7], anchors: [{ tag: 'focal', n: [1, 1], place: 'wall', focal: true }], people: { n: [0, 0], roles: [] } }),
      stairs: room('stairs', { size: [2, 4], anchors: [], clutter: { tags: [], perCell: 0, minDoorDist: 0 }, hideMin: 0, lootMin: 0, npcStand: false, light: 'none' }),
    },
    flows: [
      { id: 'linear-6', tier: 'easy',
        nodes: [{ id: 'n0', role: 'entrance' }, { id: 'n1', role: 'plain' }, { id: 'n2', role: 'key' }, { id: 'n3', role: 'lock' }, { id: 'n4', role: 'rest' }, { id: 'n5', role: 'boss' }],
        edges: [['n0', 'n1'], ['n1', 'n2'], ['n1', 'n3'], ['n3', 'n4'], ['n4', 'n5']], loops: [] },
      { id: 'loop-lock-key', tier: 'easy',
        nodes: [{ id: 'n0', role: 'entrance' }, { id: 'n1', role: 'hub' }, { id: 'n2', role: 'plain' }, { id: 'n3', role: 'key' }, { id: 'n4', role: 'combat' }, { id: 'n5', role: 'rest' }, { id: 'n6', role: 'lock' }, { id: 'n7', role: 'boss' }],
        edges: [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3'], ['n1', 'n4'], ['n4', 'n5'], ['n5', 'n6'], ['n3', 'n6'], ['n6', 'n7']], loops: [['n1', 'n2', 'n3', 'n6', 'n5', 'n4']] },
    ],
    cycles: ['lock-and-key', 'hidden-shortcut', 'two-paths'],
    injections: [{ id: 'npc', role: 'npc', p: 0.6, off: ['hub', 'plain', 'rest'] }, { id: 'secret', role: 'secret', p: 1, off: ['plain', 'rest', 'hub'] }],
    adjacency: { prefer: [], forbid: [] },
    naming: { hall: ['Hall', 'Back Hall'], corridor: ['Corridor'], room: ['Room', 'Second Room', 'Third Room'], store: ['Store Room'], vault: ['Vault'], great: ['Great Room'], stairs: ['Stairs'] },
    aliases: { hall: 'hall', room: 'room', store: 'store', vault: 'vault', 'great room': 'great', boss: '*boss', key: '*key', door: '*door' },
    bossArena: { minCells: 5, pillars: 2, ceilMul: 1.4 },
    lockKit: { key: 'core_key', door: 'core_door_locked' },
    chatter: ['Lovely weather for it.', 'Have you seen my keys?', 'Mind the step.', 'They say the vault is locked.'],
    spine: { len: [4, 6], ribs: [1, 2], hubAtEnd: true },
  };
}
