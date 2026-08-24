// src/engine/composer/archetypes/office.ts — the OFFICE archetype as data (docs/design §6): a company
// floor, a startup, an HQ. Rides on `house` with the modern style, plan layout, one storey: lobby in,
// the open plan as the hub, meeting rooms and the boss's office off a corridor, a server room that is
// locked (the keycard lives in the kitchenette or a meeting room), a storage room to hide in.
// Props by TAG from the home / shop / core families (§5.2).
import type { Archetype, Flow, RoomRecipe } from '../types';
import { CELL } from '../types';
import { FINISH } from './finishes';

const room = (kind: string, over: Partial<RoomRecipe> = {}): RoomRecipe => ({
  kind, size: [4, 6], ceil: 12,
  anchors: [{ tag: 'surface', n: [0, 1], place: 'wall' }],
  // 'office' is the family pseudo-tag the office_* props register under; 'home' stays for the desks and chairs
  wallItems: { tags: ['office', 'home', 'wall'], density: 0.25 },
  clutter: { tags: ['office', 'home', 'floor'], perCell: 0.04, minDoorDist: 2 },
  surfaceFill: { tags: ['office', 'home', 'item'], p: 0.5 },
  light: 'panel', hideMin: 1, lootMin: 1, npcStand: true,
  people: { n: [0, 1], roles: ['developer'] },
  finish: FINISH.office,
  ...over,
});

// Daylight and teal: desk pods on the floor, a boardroom table under a screen, a corner office with a view
// of its own bookshelves, a server room that is actually racks. office_* ids by name in `vignettes`.
const kinds: Record<string, RoomRecipe> = {
  lobby: room('lobby', {
    size: [4, 6],
    anchors: [{ tag: 'workstation', n: [1, 1], place: 'wall', focal: true }, { tag: 'seat', n: [1, 3], place: 'wall' }],
    vignettes: [{ id: 'vig_reception_set', p: 0.8 }, { id: 'vig_nurse_station', p: 0.4 }, { id: 'office_plant', p: 0.7 }, { id: 'sign_directory', p: 0.5 }, { id: 'office_water_cooler', p: 0.3 }],
    hideMin: 0, people: { n: [1, 2], roles: ['receptionist', 'intern'] },
    finish: FINISH.shop,
  }),
  open_plan: room('open_plan', {
    size: [7, 10], ceil: 14,
    anchors: [{ tag: 'workstation', n: [3, 6], place: 'floor' }, { tag: 'seat', n: [2, 4], place: 'floor' }, { tag: 'surface', n: [1, 2], place: 'wall' }, { tag: 'hide', n: [1, 2], place: 'wall' }],
    vignettes: [{ id: 'vig_desk_cluster', p: 0.95 }, { id: 'vig_desk_set', p: 0.6 }, { id: 'office_desk', p: 0.8 }, { id: 'office_chair', p: 0.8 }, { id: 'office_sofa', p: 0.5 }, { id: 'office_printer', p: 0.5 }, { id: 'office_plant', p: 0.6 }],
    surfaceFill: { tags: ['office', 'home', 'item'], p: 0.6 },
    clutter: { tags: ['office', 'home', 'floor'], perCell: 0.03, minDoorDist: 3 },
    hideMin: 2, people: { n: [2, 4], roles: ['developer', 'intern', 'manager'] },
    finish: FINISH.office,
  }),
  meeting: room('meeting', {
    size: [4, 6],
    anchors: [{ tag: 'surface', n: [1, 1], place: 'floor', focal: true }, { tag: 'seat', n: [2, 4], place: 'floor' }, { tag: 'focal', n: [1, 1], place: 'wall' }],
    vignettes: [{ id: 'vig_meeting_set', p: 0.95 }, { id: 'office_whiteboard', p: 0.8 }, { id: 'vig_dining_set', p: 0.3 }, { id: 'office_plant', p: 0.4 }],
    surfaceFill: { tags: ['office', 'home', 'item'], p: 0.4 },
    people: { n: [0, 3], roles: ['manager', 'developer'] },
    finish: { floor: 'carpet', wall: 'panel', trim: 'none' },
  }),
  boss_office: room('boss_office', {
    size: [5, 7], ceil: 14, symmetric: true,
    anchors: [{ tag: 'workstation', n: [1, 1], place: 'wall', focal: true }, { tag: 'seat', n: [1, 2], place: 'floor' }, { tag: 'storage', n: [1, 2], place: 'wall' }, { tag: 'cover', n: [1, 2], place: 'corner' }],
    wallItems: { tags: ['office', 'home', 'wall'], density: 0.3 },
    vignettes: [{ id: 'vig_desk_set', p: 0.9 }, { id: 'vig_library_wall', p: 0.6 }, { id: 'office_chair', p: 0.6 }, { id: 'office_plant', p: 0.7 }, { id: 'home_picture', p: 0.6 }],
    surfaceFill: { tags: ['office', 'home', 'item'], p: 0.5 },
    lootMin: 2, people: { n: [0, 1], roles: ['manager'] },
    finish: { floor: 'carpet', wall: 'wallpaper', trim: 'wood' },
  }),
  server_room: room('server_room', {
    size: [4, 5], ceil: 12, light: 'panel',
    anchors: [{ tag: 'storage', n: [2, 4], place: 'wall' }, { tag: 'loot', n: [1, 1], place: 'floor', focal: true }, { tag: 'cover', n: [1, 2], place: 'floor' }],
    wallItems: { tags: ['office', 'scifi', 'wall'], density: 0.15 },
    clutter: { tags: ['office', 'storage', 'core', 'floor'], perCell: 0.05, minDoorDist: 2 },
    vignettes: [{ id: 'office_server_rack', p: 0.95 }, { id: 'med_xray_board', p: 0.6 }, { id: 'office_monitor', p: 0.4 }],
    hideMin: 1, lootMin: 2, people: { n: [0, 1], roles: ['developer', 'sysadmin'] },
    finish: { floor: 'panel', wall: 'panel', trim: 'metal' },
  }),
  kitchenette: room('kitchenette', {
    size: [4, 5],
    anchors: [{ tag: 'workstation', n: [1, 2], place: 'wall' }, { tag: 'surface', n: [1, 1], place: 'floor' }, { tag: 'seat', n: [1, 2], place: 'floor' }],
    wallItems: { tags: ['kitchen', 'office', 'wall'], density: 0.35 },
    clutter: { tags: ['kitchen', 'office', 'floor'], perCell: 0.05, minDoorDist: 2 },
    surfaceFill: { tags: ['kitchen', 'item'], p: 0.6 },
    vignettes: [{ id: 'office_water_cooler', p: 0.8 }, { id: 'office_coffee_machine', p: 0.7 }, { id: 'kitchen_fridge', p: 0.5 }],
    people: { n: [1, 2], roles: ['intern', 'developer'] },
    finish: FINISH.wet,
  }),
  bathroom: room('bathroom', {
    size: [3, 3],
    anchors: [{ tag: 'surface', n: [1, 1], place: 'wall' }, { tag: 'hide', n: [0, 1], place: 'wall' }],
    clutter: { tags: ['home', 'floor'], perCell: 0.02, minDoorDist: 1 },
    vignettes: [{ id: 'home_toilet', p: 0.9 }, { id: 'home_bath_set', p: 0.5 }],
    lootMin: 0, people: { n: [0, 0], roles: [] },
    finish: FINISH.wet,
  }),
  storage: room('storage', {
    size: [3, 4], light: 'lamp',
    anchors: [{ tag: 'hide', n: [2, 3], place: 'wall' }, { tag: 'loot', n: [1, 1], place: 'floor', focal: true }, { tag: 'storage', n: [1, 2], place: 'wall' }],
    clutter: { tags: ['office', 'storage', 'core', 'floor'], perCell: 0.08, minDoorDist: 1 },
    vignettes: [{ id: 'vig_crate_cluster', p: 0.6 }, { id: 'office_filing', p: 0.6 }, { id: 'office_printer', p: 0.3 }],
    hideMin: 2, lootMin: 1, people: { n: [0, 0], roles: [] },
    finish: FINISH.workshop,
  }),
  corridor: room('corridor', {
    size: [3, 6], anchors: [], wallItems: { tags: ['office', 'sign', 'wall'], density: 0.15 }, clutter: { tags: [], perCell: 0, minDoorDist: 2 },
    vignettes: [{ id: 'office_plant', p: 0.5 }, { id: 'sign_exit', p: 0.6 }, { id: 'home_picture', p: 0.4 }],
    hideMin: 0, lootMin: 0, npcStand: false, people: { n: [0, 1], roles: ['intern'] },
    finish: { floor: 'carpet', wall: 'plaster', trim: 'none' },
  }),
  course: room('course', {
    size: [5, 8], ceil: 16,
    anchors: [], wallItems: { tags: [], density: 0 }, clutter: { tags: [], perCell: 0, minDoorDist: 0 },
    hideMin: 0, lootMin: 0, npcStand: false, people: { n: [0, 0], roles: [] },
    course: { len: [6, 10], checkpointEvery: [3, 4], killP: 0.2 },
    finish: FINISH.workshop,
  }),
};

const flows: Flow[] = [
  { id: 'nine-to-five', tier: 'easy',
    // lobby → open plan hub → meeting rooms; the kitchenette has the keycard, the server room is locked, the boss is behind it
    nodes: [
      { id: 'n0', role: 'entrance', kind: 'lobby' }, { id: 'n1', role: 'hub', kind: 'open_plan' }, { id: 'n2', role: 'npc', kind: 'meeting' },
      { id: 'n3', role: 'plain', kind: 'meeting' }, { id: 'n4', role: 'key', kind: 'kitchenette' }, { id: 'n5', role: 'plain', kind: 'bathroom' },
      { id: 'n6', role: 'lock', kind: 'server_room' }, { id: 'n7', role: 'boss', kind: 'boss_office' },
    ],
    edges: [['n0', 'n1'], ['n1', 'n2'], ['n1', 'n3'], ['n1', 'n4'], ['n4', 'n5'], ['n1', 'n6'], ['n6', 'n7']], loops: [] },
  { id: 'loop-lock-key', tier: 'easy',
    // the lock-and-key loop: open plan → kitchenette (key) → meeting → server room (lock) ← meeting ← open plan
    nodes: [
      { id: 'n0', role: 'entrance', kind: 'lobby' }, { id: 'n1', role: 'hub', kind: 'open_plan' }, { id: 'n2', role: 'key', kind: 'kitchenette' },
      { id: 'n3', role: 'plain', kind: 'meeting' }, { id: 'n4', role: 'lock', kind: 'server_room' }, { id: 'n5', role: 'npc', kind: 'meeting' },
      { id: 'n6', role: 'rest', kind: 'storage' }, { id: 'n7', role: 'boss', kind: 'boss_office' },
    ],
    edges: [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3'], ['n3', 'n4'], ['n1', 'n5'], ['n5', 'n4'], ['n4', 'n6'], ['n6', 'n7']],
    loops: [['n1', 'n2', 'n3', 'n4', 'n5']] },
  { id: 'after-hours', tier: 'hard',
    nodes: [
      { id: 'n0', role: 'entrance', kind: 'lobby' }, { id: 'n1', role: 'plain', kind: 'corridor' }, { id: 'n2', role: 'combat', kind: 'open_plan' },
      { id: 'n3', role: 'puzzle', kind: 'meeting' }, { id: 'n4', role: 'key', kind: 'meeting' }, { id: 'n5', role: 'rest', kind: 'kitchenette' },
      { id: 'n6', role: 'lock', kind: 'server_room' }, { id: 'n7', role: 'secret', kind: 'storage' }, { id: 'n8', role: 'boss', kind: 'boss_office' },
    ],
    edges: [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3'], ['n3', 'n4'], ['n2', 'n5'], ['n5', 'n6'], ['n4', 'n6'], ['n6', 'n8'], ['n2', 'n7']],
    loops: [['n2', 'n3', 'n4', 'n6', 'n5']] },
  { id: 'two-keys', tier: 'hard', symmetric: true,
    // two meeting rooms hold half a password each; the server room opens on both
    nodes: [
      { id: 'n0', role: 'entrance', kind: 'lobby' }, { id: 'n1', role: 'hub', kind: 'open_plan' },
      { id: 'n2', role: 'key', kind: 'meeting' }, { id: 'n3', role: 'plain', kind: 'kitchenette' },
      { id: 'n4', role: 'key', kind: 'meeting' }, { id: 'n5', role: 'plain', kind: 'bathroom' },
      { id: 'n6', role: 'lock', kind: 'server_room' }, { id: 'n7', role: 'rest', kind: 'storage' }, { id: 'n8', role: 'boss', kind: 'boss_office' },
    ],
    edges: [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3'], ['n1', 'n4'], ['n4', 'n5'], ['n1', 'n6'], ['n3', 'n6'], ['n5', 'n6'], ['n6', 'n7'], ['n7', 'n8']],
    loops: [['n1', 'n2', 'n3', 'n6'], ['n1', 'n4', 'n5', 'n6']] },
  { id: 'fire-drill', tier: 'easy',
    nodes: [
      { id: 'n0', role: 'entrance', kind: 'lobby' }, { id: 'n1', role: 'hub', kind: 'open_plan' }, { id: 'n2', role: 'npc', kind: 'kitchenette' },
      { id: 'n3', role: 'plain', kind: 'storage' }, { id: 'n4', role: 'course', kind: 'course' }, { id: 'n5', role: 'exit', kind: 'boss_office' },
    ],
    edges: [['n0', 'n1'], ['n1', 'n2'], ['n1', 'n3'], ['n3', 'n4'], ['n4', 'n5']], loops: [] },
];

export const OFFICE: Archetype = {
  id: 'office', worldType: 'house', layout: 'plan',
  keywords: ['office', 'offices', 'grafeio', 'grafeia', 'γραφείο', 'γραφειο', 'γραφεία', 'γραφεια', 'company', 'etaireia', 'εταιρεία', 'εταιρεια', 'startup', 'start up', 'hq', 'headquarters', 'workplace', 'corporate', 'firm', 'agency'],
  style: 'house.modern',
  styleVariants: { modern: 'house.modern', new: 'house.modern', cozy: 'house.cozy', old: 'haunted', haunted: 'haunted', abandoned: 'haunted', spooky: 'haunted', lab: 'lab', tech: 'lab', space: 'lab', school: 'school' },
  indoor: true, wallH: 20, cell: CELL,
  weenie: { topological: true },
  roleMap: {
    entrance: ['lobby'], hub: ['open_plan', 'lobby'], corridor: ['corridor'],
    combat: ['open_plan', 'storage'], elite: ['server_room'], puzzle: ['meeting', 'server_room'],
    key: ['kitchenette', 'meeting'], lock: ['server_room', 'boss_office'], treasure: ['boss_office', 'server_room'], secret: ['storage'],
    npc: ['meeting', 'kitchenette', 'lobby'], rest: ['kitchenette', 'storage', 'meeting'], vantage: ['boss_office'],
    boss: ['boss_office'], exit: ['lobby', 'boss_office'], finish: ['lobby'], plain: ['meeting', 'bathroom', 'open_plan', 'corridor'],
    work: ['open_plan', 'meeting', 'kitchenette'], course: ['course'], checkpoint: ['corridor'], plot: ['lobby'],
  },
  kinds,
  flows,
  cycles: ['lock-and-key', 'two-keys', 'hidden-shortcut', 'two-paths', 'foreshadow'],
  injections: [
    { id: 'secret-storage', role: 'secret', kind: 'storage', p: 1, off: ['plain', 'rest', 'hub', 'corridor'] },
    { id: 'bathroom', role: 'plain', kind: 'bathroom', p: 0.6, off: ['plain', 'hub', 'corridor'] },
    { id: 'npc-meeting', role: 'npc', kind: 'meeting', p: 0.5, off: ['hub'] },
  ],
  adjacency: {
    prefer: [['lobby', 'open_plan'], ['open_plan', 'meeting'], ['open_plan', 'kitchenette'], ['boss_office', 'meeting'], ['server_room', 'storage'], ['corridor', 'bathroom']],
    forbid: [['lobby', 'server_room'], ['lobby', 'boss_office'], ['kitchenette', 'server_room'], ['bathroom', 'kitchenette'], ['bathroom', 'boss_office']],
  },
  naming: {
    lobby: ['Reception', 'Front Desk'],
    open_plan: ['Open Plan', 'The Floor', 'Dev Floor'],
    meeting: ['Meeting Room A', 'Meeting Room B', 'The Fishbowl', 'Boardroom', 'Huddle Room'],
    boss_office: ["CEO's Office", 'Corner Office'],
    server_room: ['Server Room', 'Comms Room'],
    kitchenette: ['Kitchenette', 'Break Room', 'Coffee Corner'],
    bathroom: ['Bathroom', 'Second Bathroom'],
    storage: ['Stationery Cupboard', 'Store Room', 'Archive'],
    corridor: ['Corridor', 'East Corridor', 'West Corridor'],
    course: ['Fire Drill', 'Cable Run'],
  },
  aliases: {
    lobby: 'lobby', reception: 'lobby', 'front desk': 'lobby', entrance: 'lobby', eisodos: 'lobby', εισοδος: 'lobby', ypodoxi: 'lobby', υποδοχη: 'lobby',
    'open plan': 'open_plan', 'the floor': 'open_plan', desks: 'open_plan', 'dev floor': 'open_plan', office: 'open_plan', grafeio: 'open_plan', γραφειο: 'open_plan', grafeia: 'open_plan', γραφεια: 'open_plan',
    meeting: 'meeting', 'meeting room': 'meeting', boardroom: 'meeting', 'board room': 'meeting', fishbowl: 'meeting', 'huddle room': 'meeting', 'aithousa synedriaseon': 'meeting', 'αιθουσα συνεδριασεων': 'meeting', synedriasi: 'meeting', συνεδριαση: 'meeting',
    'boss office': 'boss_office', 'the boss office': 'boss_office', 'ceo office': 'boss_office', 'corner office': 'boss_office', 'grafeio afentikou': 'boss_office', 'γραφειο αφεντικου': 'boss_office', 'grafeio dieythynti': 'boss_office', 'γραφειο διευθυντη': 'boss_office',
    'server room': 'server_room', servers: 'server_room', 'comms room': 'server_room', 'it room': 'server_room', 'server': 'server_room', 'servers room': 'server_room', 'domatio server': 'server_room', 'δωματιο server': 'server_room',
    kitchenette: 'kitchenette', kitchen: 'kitchenette', 'break room': 'kitchenette', 'coffee corner': 'kitchenette', kouzina: 'kitchenette', κουζινα: 'kitchenette', 'kouzinaki': 'kitchenette', κουζινακι: 'kitchenette',
    bathroom: 'bathroom', toilet: 'bathroom', toilets: 'bathroom', restroom: 'bathroom', toualeta: 'bathroom', τουαλετα: 'bathroom', banio: 'bathroom', μπανιο: 'bathroom',
    storage: 'storage', cupboard: 'storage', 'store room': 'storage', archive: 'storage', 'stationery cupboard': 'storage', apothiki: 'storage', αποθηκη: 'storage',
    corridor: 'corridor', hallway: 'corridor', diadromos: 'corridor', διαδρομος: 'corridor',
    door: '*door', porta: '*door', πορτα: '*door', 'locked door': '*door',
    boss: '*boss', 'the boss': '*boss', ceo: '*boss', 'boss room': '*boss', afentiko: '*boss', αφεντικο: '*boss', key: '*key', keycard: '*key', card: '*key', karta: '*key', καρτα: '*key', kleidi: '*key', κλειδι: '*key',
    vantage: '*vantage', lookout: '*vantage', balcony: '*vantage',
    course: '*course', obby: '*course', parkour: '*course', 'fire drill': '*course', 'obstacle course': '*course',
    plot: '*plot',
  },
  bossArena: { minCells: 5, pillars: 2, ceilMul: 1.2 },
  lockKit: { key: 'core_keycard', door: 'core_door_locked' },
  chatter: [
    'The printer is out of toner. It has been out of toner since the merger.',
    'Please do not reply all. Please. Do not.',
    'The meeting could have been an email. The email could have been nothing.',
    'Somebody ate my yoghurt. It had my name on it. In two places.',
    'The server room is the only room with working air conditioning. Nobody is allowed in.',
    'The CEO is in a meeting. The CEO is always in a meeting.',
    'Standup is at nine. It ends at ten. Nobody stands.',
    'If the coffee machine asks you to descale it, ignore it. It is bluffing.',
    'The boardroom chairs are ergonomic. That is why they are uncomfortable.',
    'Badge in, badge out. Badge in, badge out. That is the job, mostly.',
    'The intern fixed the wifi by turning it off and on. We promoted him.',
    'We have a ping-pong table. It is where the boxes go.',
    'The fishbowl is booked until Thursday. By whom, nobody knows.',
    'Q3 targets are on the whiteboard. So is a drawing of a duck.',
    'The fire exit is past the kitchenette, through the door that says do not use.',
    'Somebody deployed on a Friday. Somebody is working this weekend.',
  ],
};
