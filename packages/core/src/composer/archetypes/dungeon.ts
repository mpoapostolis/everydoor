// src/engine/composer/archetypes/dungeon.ts — the DUNGEON archetype as data (docs/design §6): a
// crypt, a labyrinth, a cave under the castle. Rides on `dungeon`, plan layout, one storey: the
// entrance hall, chambers off wide corridors, the cells (a key behind bars), a shrine to rest at,
// a treasury that is locked, a trap hall on the dangerous route and the boss hall at the far end.
// Anchors by TAG (phase-0 families); castle_* / spooky_* ids appear only in `vignettes`.
import type { Archetype, Flow, RoomRecipe } from '../types';
import { CELL } from '../types';
import { FINISH } from './finishes';

const room = (kind: string, over: Partial<RoomRecipe> = {}): RoomRecipe => ({
  kind, size: [4, 6], ceil: 12,
  anchors: [{ tag: 'surface', n: [0, 1], place: 'wall' }],
  // castle + spooky are the family pseudo-tags the crypt dresses from; 'wall' alone falls back to storage / hide
  wallItems: { tags: ['castle', 'spooky', 'wall'], density: 0.3 },
  clutter: { tags: ['castle', 'clutter', 'storage'], perCell: 0.05, minDoorDist: 2 },
  surfaceFill: { tags: ['spooky', 'castle', 'item'], p: 0.4 },
  light: 'torch', hideMin: 1, lootMin: 1, npcStand: true,
  people: { n: [0, 1], roles: ['lost adventurer'] },
  finish: FINISH.stone,
  ...over,
});

// Each chamber has one thing to walk toward (a sarcophagus, an altar with a ritual circle, the hoard, the
// throne of bones), braziers and torches by id, and the spooky dressing (cobwebs, bones) the crypt is for.
const kinds: Record<string, RoomRecipe> = {
  entrance: room('entrance', {
    size: [4, 6], ceil: 14,
    anchors: [{ tag: 'cover', n: [1, 2], place: 'corner' }, { tag: 'hide', n: [0, 1], place: 'wall' }],
    vignettes: [{ id: 'castle_torch', p: 0.9 }, { id: 'vig_crate_cluster', p: 0.4 }, { id: 'spooky_cobweb', p: 0.5 }, { id: 'vig_checkpoint_gate', p: 0.3 }, { id: 'castle_barrel', p: 0.4 }],
    hideMin: 1, lootMin: 0,
    people: { n: [1, 1], roles: ['lost adventurer'] },
  }),
  chamber: room('chamber', {
    size: [5, 7], ceil: 14,
    anchors: [{ tag: 'cover', n: [1, 3], place: 'floor' }, { tag: 'loot', n: [0, 1], place: 'floor' }, { tag: 'hide', n: [1, 1], place: 'corner' }],
    clutter: { tags: ['castle', 'clutter', 'storage', 'cover'], perCell: 0.05, minDoorDist: 2 },
    vignettes: [{ id: 'spooky_coffin', p: 0.6 }, { id: 'castle_brazier', p: 0.6 }, { id: 'spooky_cobweb', p: 0.6 }, { id: 'spooky_skull_pile', p: 0.5 }, { id: 'vig_crate_cluster', p: 0.4 }, { id: 'castle_barrel', p: 0.4 }],
    hideMin: 1, lootMin: 1,
    people: { n: [0, 1], roles: ['cultist', 'lost adventurer'] },
  }),
  cells: room('cells', {
    size: [4, 6], ceil: 11,
    anchors: [{ tag: 'hide', n: [1, 2], place: 'wall' }, { tag: 'loot', n: [1, 1], place: 'floor', focal: true }, { tag: 'cover', n: [0, 1], place: 'corner' }],
    wallItems: { tags: ['castle', 'spooky', 'wall'], density: 0.2 },
    clutter: { tags: ['castle', 'clutter'], perCell: 0.04, minDoorDist: 2 },
    vignettes: [{ id: 'vig_cell_furnished', p: 0.8 }, { id: 'castle_cell_bars', p: 0.8 }, { id: 'vig_torture_corner', p: 0.5 }, { id: 'spooky_cobweb', p: 0.5 }, { id: 'spooky_skull_pile', p: 0.5 }, { id: 'spooky_candles', p: 0.4 }],
    light: 'candle', hideMin: 1, lootMin: 1,
    people: { n: [1, 2], roles: ['prisoners'] },
    finish: FINISH.cell,
  }),
  shrine: room('shrine', {
    size: [4, 6], ceil: 16, symmetric: true,
    anchors: [{ tag: 'focal', n: [1, 1], place: 'wall', focal: true }, { tag: 'seat', n: [0, 2], place: 'floor' }],
    wallItems: { tags: ['spooky', 'castle', 'wall'], density: 0.25 },
    clutter: { tags: ['spooky', 'castle', 'decor'], perCell: 0.02, minDoorDist: 2 },
    vignettes: [{ id: 'vig_altar_candles', p: 0.9 }, { id: 'vig_altar_spooky', p: 0.7 }, { id: 'castle_candle_stand', p: 0.7 }, { id: 'spooky_candles', p: 0.6 }, { id: 'vig_shrine', p: 0.3 }],
    light: 'candle', hideMin: 1, lootMin: 1,
    people: { n: [0, 1], roles: ['cultist'] },
    finish: { floor: 'flagstone', wall: 'plaster', trim: 'stone' },
  }),
  treasury: room('treasury', {
    size: [4, 6], ceil: 12,
    anchors: [{ tag: 'loot', n: [2, 3], place: 'floor', focal: true }, { tag: 'hide', n: [1, 1], place: 'wall' }, { tag: 'cover', n: [1, 1], place: 'corner' }],
    clutter: { tags: ['castle', 'storage', 'clutter'], perCell: 0.08, minDoorDist: 2 },
    vignettes: [{ id: 'vig_treasure_pile', p: 0.9 }, { id: 'spooky_coffin', p: 0.5 }, { id: 'castle_weapon_rack', p: 0.4 }, { id: 'vig_armoury_wall', p: 0.3 }, { id: 'castle_brazier', p: 0.5 }],
    hideMin: 1, lootMin: 3,
    people: { n: [0, 0], roles: [] },
    finish: FINISH.crypt,
  }),
  trap_hall: room('trap_hall', {
    size: [5, 8], ceil: 14,
    anchors: [{ tag: 'cover', n: [2, 4], place: 'floor' }],
    wallItems: { tags: ['castle', 'spooky', 'wall'], density: 0.2 },
    clutter: { tags: ['castle', 'cover'], perCell: 0.03, minDoorDist: 3 },
    vignettes: [{ id: 'spooky_cage', p: 0.9 }, { id: 'castle_torch', p: 0.7 }, { id: 'spooky_skull_pile', p: 0.6 }, { id: 'castle_brazier', p: 0.3 }],
    hideMin: 1, lootMin: 1,
    people: { n: [0, 0], roles: [] },
  }),
  boss_hall: room('boss_hall', {
    size: [7, 10], ceil: 20, symmetric: true,
    anchors: [{ tag: 'focal', n: [1, 1], place: 'wall', focal: true }, { tag: 'cover', n: [2, 4], place: 'corner' }],
    wallItems: { tags: ['castle', 'spooky', 'wall'], density: 0.4 },
    clutter: { tags: ['castle', 'decor', 'cover'], perCell: 0.02, minDoorDist: 3 },
    vignettes: [{ id: 'vig_throne_dais', p: 0.8 }, { id: 'castle_brazier', p: 0.9 }, { id: 'spooky_skull_pile', p: 0.6 }, { id: 'castle_banner', p: 0.5 }, { id: 'castle_chandelier', p: 0.3 }, { id: 'castle_torch', p: 0.6 }],
    hideMin: 1, lootMin: 1,
    people: { n: [0, 1], roles: ['cultist'] },
    finish: FINISH.throne,
  }),
  corridor: room('corridor', {
    size: [3, 6], ceil: 12,
    anchors: [], wallItems: { tags: ['castle', 'spooky', 'wall'], density: 0.3 }, clutter: { tags: [], perCell: 0, minDoorDist: 2 },
    vignettes: [{ id: 'castle_torch', p: 0.9 }, { id: 'spooky_cobweb', p: 0.4 }],
    hideMin: 0, lootMin: 0, npcStand: false, people: { n: [0, 1], roles: ['lost adventurer'] },
  }),
  course: room('course', {
    size: [5, 8], ceil: 18, anchors: [], light: 'torch',
    clutter: { tags: [], perCell: 0, minDoorDist: 0 },
    hideMin: 0, lootMin: 0, npcStand: false, people: { n: [0, 0], roles: [] },
    course: { len: [6, 10], checkpointEvery: [2, 3], killP: 0.35 },
  }),
};

const flows: Flow[] = [
  { id: 'crypt-linear', tier: 'easy',
    // entrance → chamber → cells (key) → locked treasury → shrine → boss hall
    nodes: [
      { id: 'n0', role: 'entrance', kind: 'entrance' }, { id: 'n1', role: 'hub', kind: 'chamber' }, { id: 'n2', role: 'key', kind: 'cells' },
      { id: 'n3', role: 'lock', kind: 'treasury' }, { id: 'n4', role: 'rest', kind: 'shrine' }, { id: 'n5', role: 'boss', kind: 'boss_hall' },
    ],
    edges: [['n0', 'n1'], ['n1', 'n2'], ['n1', 'n3'], ['n3', 'n4'], ['n4', 'n5']], loops: [] },
  { id: 'loop-lock-key', tier: 'easy',
    nodes: [
      { id: 'n0', role: 'entrance', kind: 'entrance' }, { id: 'n1', role: 'hub', kind: 'chamber' }, { id: 'n2', role: 'plain', kind: 'chamber' },
      { id: 'n3', role: 'key', kind: 'cells' }, { id: 'n4', role: 'combat', kind: 'chamber' }, { id: 'n5', role: 'rest', kind: 'shrine' },
      { id: 'n6', role: 'lock', kind: 'treasury' }, { id: 'n7', role: 'boss', kind: 'boss_hall' },
    ],
    edges: [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3'], ['n1', 'n4'], ['n4', 'n5'], ['n5', 'n6'], ['n3', 'n6'], ['n6', 'n7']],
    loops: [['n1', 'n2', 'n3', 'n6', 'n5', 'n4']] },
  { id: 'trap-route', tier: 'hard',
    // two paths to the treasury: the long safe way through the shrine, or the short dangerous one through the trap hall
    nodes: [
      { id: 'n0', role: 'entrance', kind: 'entrance' }, { id: 'n1', role: 'hub', kind: 'chamber' }, { id: 'n2', role: 'key', kind: 'cells' },
      { id: 'n3', role: 'combat', kind: 'trap_hall' }, { id: 'n4', role: 'plain', kind: 'chamber' }, { id: 'n5', role: 'rest', kind: 'shrine' },
      { id: 'n6', role: 'lock', kind: 'treasury' }, { id: 'n7', role: 'boss', kind: 'boss_hall' }, { id: 'n8', role: 'secret', kind: 'cells' },
    ],
    edges: [['n0', 'n1'], ['n1', 'n2'], ['n1', 'n3'], ['n3', 'n6'], ['n1', 'n4'], ['n4', 'n5'], ['n5', 'n6'], ['n6', 'n7'], ['n4', 'n8']],
    loops: [['n1', 'n3', 'n6', 'n5', 'n4']] },
  { id: 'two-keys', tier: 'hard', symmetric: true,
    nodes: [
      { id: 'n0', role: 'entrance', kind: 'entrance' }, { id: 'n1', role: 'hub', kind: 'chamber' },
      { id: 'n2', role: 'combat', kind: 'chamber' }, { id: 'n3', role: 'key', kind: 'cells' },
      { id: 'n4', role: 'combat', kind: 'trap_hall' }, { id: 'n5', role: 'key', kind: 'shrine' },
      { id: 'n6', role: 'lock', kind: 'treasury' }, { id: 'n7', role: 'rest', kind: 'shrine' }, { id: 'n8', role: 'boss', kind: 'boss_hall' },
    ],
    edges: [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3'], ['n1', 'n4'], ['n4', 'n5'], ['n1', 'n6'], ['n3', 'n6'], ['n5', 'n6'], ['n6', 'n7'], ['n7', 'n8']],
    loops: [['n1', 'n2', 'n3', 'n6'], ['n1', 'n4', 'n5', 'n6']] },
  { id: 'cultist-hideout', tier: 'hard',
    nodes: [
      { id: 'n0', role: 'entrance', kind: 'entrance' }, { id: 'n1', role: 'plain', kind: 'corridor' }, { id: 'n2', role: 'combat', kind: 'chamber' },
      { id: 'n3', role: 'puzzle', kind: 'shrine' }, { id: 'n4', role: 'key', kind: 'cells' }, { id: 'n5', role: 'lock', kind: 'treasury' },
      { id: 'n6', role: 'elite', kind: 'trap_hall' }, { id: 'n7', role: 'rest', kind: 'chamber' }, { id: 'n8', role: 'boss', kind: 'boss_hall' },
    ],
    edges: [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3'], ['n3', 'n4'], ['n2', 'n5'], ['n5', 'n6'], ['n6', 'n7'], ['n7', 'n8']], loops: [] },
  { id: 'pit-course', tier: 'hard',
    nodes: [
      { id: 'n0', role: 'entrance', kind: 'entrance' }, { id: 'n1', role: 'hub', kind: 'chamber' }, { id: 'n2', role: 'key', kind: 'cells' },
      { id: 'n3', role: 'course', kind: 'course' }, { id: 'n4', role: 'lock', kind: 'treasury' }, { id: 'n5', role: 'rest', kind: 'shrine' },
      { id: 'n6', role: 'boss', kind: 'boss_hall' },
    ],
    edges: [['n0', 'n1'], ['n1', 'n2'], ['n1', 'n3'], ['n3', 'n4'], ['n2', 'n4'], ['n4', 'n5'], ['n5', 'n6']],
    loops: [['n1', 'n2', 'n4', 'n3']] },
];

export const DUNGEON: Archetype = {
  id: 'dungeon', worldType: 'dungeon', layout: 'plan',
  keywords: ['dungeon', 'crypt', 'catacombs', 'labyrinth', 'maze', 'cave', 'tomb', 'lair', 'underground', 'boudroumi', 'μπουντρούμι', 'μπουντρουμι', 'krypti', 'κρύπτη', 'κρυπτη', 'lavyrinthos', 'λαβύρινθος', 'λαβυρινθος', 'spilia', 'σπηλιά', 'σπηλια', 'tafos', 'τάφος', 'ταφος', 'ypogeio', 'υπόγειο', 'υπογειο'],
  style: 'dungeon',
  styleVariants: { dark: 'dungeon', ruined: 'dungeon', castle: 'castle', stone: 'castle', winter: 'castle.winter', haunted: 'haunted', spooky: 'haunted', lab: 'lab', candy: 'candy', space: 'space', reef: 'reef' },
  indoor: true, wallH: 28, cell: CELL,
  weenie: { topological: true },
  roleMap: {
    entrance: ['entrance'], hub: ['chamber'], corridor: ['corridor'],
    combat: ['chamber', 'trap_hall'], elite: ['trap_hall', 'chamber'], puzzle: ['shrine', 'chamber'],
    key: ['cells', 'shrine'], lock: ['treasury', 'boss_hall'], treasure: ['treasury'], secret: ['cells', 'treasury'],
    npc: ['shrine', 'cells', 'chamber'], rest: ['shrine', 'chamber'], vantage: ['trap_hall'], boss: ['boss_hall'],
    exit: ['entrance', 'boss_hall'], plain: ['chamber', 'corridor'], work: ['shrine'], course: ['course'], checkpoint: ['corridor'],
  },
  kinds,
  flows,
  cycles: ['lock-and-key', 'two-keys', 'hidden-shortcut', 'foreshadow', 'false-goal', 'two-paths', 'dangerous-route', 'blocked-retreat'],
  injections: [
    { id: 'npc', role: 'npc', p: 0.5, off: ['hub', 'plain', 'rest'] },
    { id: 'secret', role: 'secret', kind: 'cells', p: 1, off: ['plain', 'rest', 'hub', 'corridor'] },
    { id: 'chamber', role: 'plain', kind: 'chamber', p: 0.5, off: ['hub', 'corridor'] },
  ],
  adjacency: {
    prefer: [['entrance', 'corridor'], ['corridor', 'chamber'], ['chamber', 'cells'], ['shrine', 'boss_hall'], ['trap_hall', 'treasury'], ['cells', 'treasury']],
    forbid: [['entrance', 'boss_hall'], ['entrance', 'treasury'], ['shrine', 'cells'], ['entrance', 'trap_hall']],
  },
  naming: {
    entrance: ['Crypt Entrance', 'Cave Mouth', 'Broken Stair'],
    chamber: ['Bone Chamber', 'Old Chamber', 'Flooded Chamber', 'Pillar Chamber', 'Echo Chamber'],
    cells: ['Cells', 'The Oubliette', 'Lower Cells'],
    shrine: ['Shrine', 'Forgotten Altar', 'Candle Chapel'],
    treasury: ['Treasury', 'Vault', 'Hoard Room'],
    trap_hall: ['Trap Hall', 'Hall of Blades', 'Spike Gallery'],
    boss_hall: ['Boss Hall', 'Throne of Bones', 'The Deep Hall'],
    corridor: ['Passage', 'Low Tunnel', 'Dripping Corridor'],
    course: ['Pit Run', 'Lava Crossing'],
  },
  aliases: {
    entrance: 'entrance', 'crypt entrance': 'entrance', 'cave mouth': 'entrance', 'eisodos': 'entrance', 'είσοδος': 'entrance', 'εισοδος': 'entrance',
    chamber: 'chamber', room: 'chamber', 'bone chamber': 'chamber', 'thalamos': 'chamber', 'θάλαμος': 'chamber', 'θαλαμος': 'chamber', 'domatio': 'chamber', 'δωμάτιο': 'chamber', 'δωματιο': 'chamber',
    cells: 'cells', cell: 'cells', prison: 'cells', 'keli': 'cells', 'κελί': 'cells', 'κελι': 'cells', 'kelia': 'cells', 'κελιά': 'cells', 'κελια': 'cells',
    shrine: 'shrine', altar: 'shrine', chapel: 'shrine', 'vomos': 'shrine', 'βωμός': 'shrine', 'βωμος': 'shrine', 'iero': 'shrine', 'ιερό': 'shrine', 'ιερο': 'shrine',
    treasury: 'treasury', vault: 'treasury', hoard: 'treasury', 'treasure room': 'treasury', 'thisavros': 'treasury', 'θησαυρός': 'treasury', 'θησαυρος': 'treasury', 'thisavrofylakio': 'treasury', 'θησαυροφυλάκιο': 'treasury', 'θησαυροφυλακιο': 'treasury',
    'trap hall': 'trap_hall', traps: 'trap_hall', 'hall of blades': 'trap_hall', 'pagida': 'trap_hall', 'παγίδα': 'trap_hall', 'παγιδα': 'trap_hall', 'pagides': 'trap_hall', 'παγίδες': 'trap_hall', 'παγιδες': 'trap_hall',
    'boss hall': 'boss_hall', 'deep hall': 'boss_hall', 'throne of bones': 'boss_hall', 'lair': 'boss_hall', 'fwlia': 'boss_hall', 'φωλιά': 'boss_hall', 'φωλια': 'boss_hall',
    corridor: 'corridor', passage: 'corridor', tunnel: 'corridor', 'diadromos': 'corridor', 'διάδρομος': 'corridor', 'διαδρομος': 'corridor', 'tounel': 'corridor', 'τούνελ': 'corridor', 'τουνελ': 'corridor',
    boss: '*boss', 'the boss': '*boss', 'boss room': '*boss', 'afentiko': '*boss', 'αφεντικό': '*boss', 'αφεντικο': '*boss', 'teras': '*boss', 'τέρας': '*boss', 'τερας': '*boss',
    key: '*key', 'kleidi': '*key', 'κλειδί': '*key', 'κλειδι': '*key',
    door: '*door', gate: '*door', 'porta': '*door', 'πόρτα': '*door', 'πορτα': '*door',
    lookout: '*vantage', course: '*course', 'pit run': '*course', obby: '*course',
  },
  bossArena: { minCells: 7, pillars: 4, ceilMul: 1.5 },
  lockKit: { key: 'core_key', door: 'core_gate' },
  chatter: [
    'I came down here for the treasure. I stayed because the stairs went missing.',
    'The cultists meet on Tuesdays. They bring snacks. It is the only nice thing about them.',
    'If the torches are lit, someone lit them. Think about that.',
    'The cells are full. The jailer left years ago. Nobody has tried the doors.',
    'The shrine is safe. Probably. It has been safe so far.',
    'Do not step on the tiles with the faces. Or do. I am not your mother.',
    'Three of us came down. I am the one who reads maps. The others are also down here.',
    'The treasury key is in the cells. The cells are where they keep the key. That is the joke.',
    'The boss hall is at the end. Everything down here is at the end.',
    'The water in the flooded chamber is ankle deep. The things in it are not.',
    'Mind the gap. Mind the spikes in the gap.',
    'We chant on the hour. Join in or look busy.',
    'There is a draft from the deep hall. It smells of old coins.',
    'My lantern has ten minutes left. My optimism has fewer.',
    'Do not feed the prisoners. Do not listen to the prisoners. Do wave at the prisoners.',
    'Whatever is in the boss hall has not eaten in a century. Bear that in mind.',
  ],
};
