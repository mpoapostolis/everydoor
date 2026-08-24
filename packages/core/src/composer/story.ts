// src/engine/composer/story.ts — THE STORY BRIEF.
// storyBrief(def) reads a WorldScript (title, cast, items, enemies, quests, dialogue, the win rules) and
// distils what the INTERIOR must say about it: a theme, a mood, who stands where and as what, which item is
// the key, the order the player is meant to do things in, and the handful of nouns the building may talk
// about. Pure, deterministic and cheap (well under a millisecond): the same script gives the same brief on
// every seed, so a room's story content is a function of the script while its layout may still vary.
//
// The brief is the contract the other composer lanes build against: composedPlaceReqs (worldFactory) turns
// it into PlaceReqs with kind / step / label, dressing.ts dresses rooms from it, people.ts casts the extras.
// Plan-only: no three.js, no DOM, no Math.random — hash32 (rng.ts) is the only randomness and it is keyed.
import type { DlgNode, NpcDef, WorldScript } from '../types';
import type { RoomKind } from './types';
import { hash32 } from './rng';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
/** The fixed theme vocabulary — at most three per story, strongest first. */
export const THEMES = [
  'crime', 'heist', 'missing', 'party', 'wedding', 'exam', 'ghost', 'siege', 'escape', 'illness',
  'market', 'trial', 'treasure', 'romance', 'sports', 'rescue',
] as const;
export type Theme = (typeof THEMES)[number];
export type Mood = 'calm' | 'tense' | 'grim' | 'festive' | 'eerie';

export interface BriefCast { id: string; name: string; roleWord?: string; place?: string; kind?: RoomKind }
export interface BriefItem { id: string; name: string; place?: string; kind?: RoomKind; questTarget: boolean; isKey: boolean }
export interface BriefThreat { id: string; name: string; place?: string; boss: boolean }
export interface BriefStep { step: number; kind: 'talk' | 'collect' | 'kill' | 'reach'; targetId: string; place?: string }
export interface StoryBrief {
  /** Hash of the STORY CONTENT (never the layout seed): the same script ⇒ the same seed on every load. */
  seed: number;
  title: string;
  theme: Theme[];
  mood: Mood;
  cast: BriefCast[];
  items: BriefItem[];
  threats: BriefThreat[];
  /** What the player is expected to do, in order (quests first, then the win rules, then item-gated beats). */
  chain: BriefStep[];
  /** The 6–12 most story-specific words: character names, the missing thing, the place words. */
  nouns: string[];
}

/** Lower-case, accents stripped (Greek tonos included), whitespace collapsed. */
const deaccent = (s: string): string => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\s]+/g, ' ').trim();
/** Strip the emoji / symbol glyph an item name may start with ("📜 ledger" → "ledger"). */
const plainName = (s: string): string => String(s || '').replace(/[\p{Extended_Pictographic}️‍]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Keyword table per theme — a word scores its theme once per occurrence; the title counts triple. */
const THEME_WORDS: Record<Theme, string[]> = {
  crime: ['crime', 'murder', 'killer', 'poison', 'poisoned', 'bribe', 'bribed', 'ledger', 'evidence', 'culprit', 'suspect', 'detective', 'inspector', 'alibi', 'confess', 'blackmail', 'forged', 'forgery', 'smuggl', 'fraud', 'witness', 'clue', 'egklima', 'έγκλημα', 'εγκλημα', 'dolofon', 'δολοφον'],
  heist: ['heist', 'steal', 'stole', 'stolen', 'thief', 'thieves', 'rob', 'robbery', 'loot', 'sneak', 'guard', 'guards', 'security', 'badge', 'vault', 'safe', 'break in', 'get it back', 'took it', 'the job', 'day shift', 'night shift', 'alarm', 'drone', 'camera', 'lifted', 'kleft', 'κλέφτ', 'κλεφτ', 'klepsi', 'κλέψ', 'κλεψ'],
  missing: ['missing', 'is gone', 'has gone', 'lost', 'find him', 'find her', 'find it', 'find the', 'disappeared', 'vanished', 'where is', 'not in', 'ran off', 'wandered', 'loose', 'last seen', 'nobody has seen', 'xathike', 'χάθηκε', 'χαθηκε', 'exafanis', 'εξαφανίσ', 'εξαφανισ'],
  party: ['party', 'birthday', 'celebration', 'cake', 'balloons', 'guests', 'invite', 'invitation', 'dance', 'music', 'band', 'surprise party', 'festival', 'feast', 'fireworks', 'giorti', 'γιορτή', 'γιορτη', 'parti', 'πάρτι', 'παρτι', 'genethlia', 'γενέθλια', 'γενεθλια'],
  wedding: ['wedding', 'bride', 'groom', 'vows', 'ring', 'rings', 'altar', 'marry', 'married', 'marriage', 'honeymoon', 'gamos', 'γάμος', 'γαμος', 'nyfi', 'νύφη', 'νυφη'],
  exam: ['exam', 'exams', 'test', 'homework', 'grade', 'grades', 'revision', 'study', 'essay', 'quiz', 'detention', 'teacher', 'pupil', 'class', 'lesson', 'principal', 'school', 'diagonisma', 'διαγώνισμα', 'διαγωνισμα', 'exetaseis', 'εξετάσεις', 'εξετασεις', 'mathima', 'μάθημα', 'μαθημα'],
  ghost: ['ghost', 'ghosts', 'haunted', 'haunt', 'spirit', 'spirits', 'spectre', 'phantom', 'seance', 'séance', 'apparition', 'cold spot', 'candles go out', 'the dead', 'graveyard', 'curse', 'cursed', 'possessed', 'fantasma', 'φάντασμα', 'φαντασμα', 'stoixeio', 'στοιχειω', 'στοιχειό'],
  siege: ['siege', 'besieged', 'battlements', 'ramparts', 'walls hold', 'army', 'invaders', 'invasion', 'attack', 'defend', 'defence', 'defense', 'muster', 'garrison', 'catapult', 'archers', 'barricade', 'horde', 'poliorkia', 'πολιορκία', 'πολιορκια', 'epithesi', 'επίθεση', 'επιθεση'],
  escape: ['escape', 'break out', 'breakout', 'get out', 'way out', 'tunnel', 'duct', 'vent', 'cell block', 'prisoner', 'warden', 'parole', 'release', 'smuggle out', 'lockdown', 'apodrasi', 'απόδραση', 'αποδραση', 'fylaki', 'φυλακή', 'φυλακη'],
  illness: ['illness', 'ill', 'sick', 'fever', 'plague', 'cure', 'medicine', 'doctor', 'nurse', 'patient', 'patients', 'ward', 'hospital', 'surgery', 'infection', 'outbreak', 'quarantine', 'pills', 'dying', 'bed seven', 'arrostos', 'άρρωστος', 'αρρωστος', 'giatros', 'γιατρός', 'γιατρος', 'nosokom', 'νοσοκομ'],
  market: ['market', 'shop', 'sell', 'sold', 'buy', 'customer', 'customers', 'orders', 'order', 'delivery', 'stock', 'price', 'coins', 'gold', 'bakery', 'pizza', 'bread', 'trade', 'merchant', 'stall', 'agora', 'αγορά', 'αγορα', 'magazi', 'μαγαζί', 'μαγαζι', 'pelatis', 'πελάτ', 'πελατ'],
  trial: ['trial', 'judge', 'jury', 'verdict', 'accused', 'accuse', 'council', 'vote', 'votes', 'hearing', 'testimony', 'court', 'chancellor', 'the seat', 'dikastirio', 'δικαστήριο', 'δικαστηριο', 'diki', 'δίκη', 'δικη'],
  treasure: ['treasure', 'gold', 'hoard', 'relic', 'crown', 'jewel', 'jewels', 'gem', 'chest', 'buried', 'ancient', 'tomb', 'crypt', 'artifact', 'artefact', 'thisavros', 'θησαυρός', 'θησαυρος', 'chrysos', 'χρυσός', 'χρυσος'],
  romance: ['love', 'loves', 'loved', 'kiss', 'heart', 'date', 'sweetheart', 'letter for', 'love letter', 'crush', 'valentine', 'romance', 'agapi', 'αγάπη', 'αγαπη', 'erotas', 'έρωτας', 'ερωτας'],
  sports: ['match', 'goal', 'team', 'coach', 'race', 'trophy', 'tournament', 'score', 'pitch', 'gym', 'training', 'championship', 'football', 'basketball', 'swim', 'agonas', 'αγώνας', 'αγωνας', 'omada', 'ομάδα', 'ομαδα'],
  rescue: ['rescue', 'save', 'saved', 'help him', 'help her', 'trapped', 'stuck', 'drowning', 'fire', 'flood', 'injured', 'bring him back', 'bring her back', 'walk him back', 'carry', 'before it is too late', 'sose', 'σώσε', 'σωσε', 'voithia', 'βοήθεια', 'βοηθεια'],
};
/** What a building is usually about when the script says nothing louder. */
const ARCH_THEME: Record<string, Theme> = { haunted: 'ghost', hospital: 'illness', school: 'exam', prison: 'escape', shop: 'market', castle: 'siege', dungeon: 'treasure', office: 'crime', house: 'missing' };
const THEME_MOOD: Record<Theme, Mood> = {
  crime: 'grim', heist: 'tense', missing: 'tense', party: 'festive', wedding: 'festive', exam: 'calm', ghost: 'eerie', siege: 'tense',
  escape: 'tense', illness: 'grim', market: 'festive', trial: 'grim', treasure: 'calm', romance: 'calm', sports: 'festive', rescue: 'tense',
};

/** Role words a name or a line may carry ("Nurse Temi", "Dr Reyes", "the Warden", "I clean the lab"). Order matters: first hit wins. */
const ROLE_WORDS: [RegExp, string][] = [
  [/\b(dr|doctor|doc|physician|surgeon|giatros|γιατρος)\b/, 'doctor'], [/\bnurse\b|\bnosokoma\b|\bνοσοκομ/, 'nurse'],
  [/\b(queen|vasilissa|βασιλισσα)\b/, 'queen'], [/\b(king|vasilias|βασιλιας)\b/, 'king'], [/\b(prince|princess|lord|lady|duke|duchess|baron|baroness|count|countess)\b/, 'noble'],
  [/\b(chancellor|steward|seneschal|chamberlain|minister|councillor|councilor)\b/, 'steward'], [/\b(chaplain|priest|bishop|monk|nun|father|sister|abbot|papas|παπας)\b/, 'priest'],
  [/\b(general|captain|commander|sergeant|lieutenant|marshal|knight|sir)\b/, 'captain'], [/\b(guard|guards|sentry|watchman|warder|gatekeeper|porter|doorman|bouncer|fylakas|φυλακας)\b/, 'guard'],
  [/\b(warden|governor)\b/, 'warden'], [/\b(prisoner|inmate|convict|kratoumenos|κρατουμενος)\b/, 'prisoner'],
  [/\b(principal|headmaster|headmistress|head teacher|dean|dieythyntis|διευθυντης)\b/, 'principal'], [/\b(teacher|professor|tutor|daskalos|δασκαλος)\b/, 'teacher'],
  [/\b(librarian|vivliothikarios|βιβλιοθηκαριος)\b/, 'librarian'], [/\b(janitor|caretaker|cleaner|custodian|epistatis|επιστατης)\b/, 'janitor'],
  [/\b(cook|chef|baker|scullion|mageiras|μαγειρας|fournaris|φουρναρης)\b/, 'chef'], [/\b(waiter|waitress|barista|barman|bartender|servitoros|σερβιτορος)\b/, 'waiter'],
  [/\b(merchant|shopkeeper|trader|vendor|cashier|clerk|manager|magazatoras|μαγαζατορας|pelatis|πελατης)\b/, 'merchant'], [/\b(detective|inspector|constable|officer|sheriff|astynomos|αστυνομος)\b/, 'detective'],
  [/\b(scientist|researcher|chemist|engineer|technician|pilot|mechanic|epistimonas|επιστημονας)\b/, 'scientist'], [/\b(ghost|spirit|phantom|spectre|fantasma|φαντασμα)\b/, 'ghost'],
  [/\b(pupil|student|kid|boy|girl|mathitis|μαθητης)\b/, 'pupil'], [/\b(patient|asthenis|ασθενης)\b/, 'patient'], [/\b(driver|courier|postman|messenger|odigos|οδηγος)\b/, 'courier'],
  [/\b(grandma|grandmother|granny|grandpa|grandfather|giagia|γιαγια|pappous|παππους)\b/, 'elder'], [/\b(mum|mom|mother|dad|father|mama|μαμα|babas|μπαμπας)\b/, 'parent'],
  [/\b(wizard|witch|mage|sorcerer|magos|μαγος)\b/, 'wizard'], [/\b(farmer|gardener|shepherd|agrotis|αγροτης)\b/, 'farmer'], [/\b(soldier|squire|archer|stratiotis|στρατιωτης)\b/, 'soldier'],
];
/** Things a character says about their own work, when the name carries no title. */
const SELF_ROLE: [RegExp, string][] = [
  [/\bi (?:clean|mop|sweep)\b/, 'janitor'], [/\bi (?:cook|bake)\b/, 'chef'], [/\bi (?:teach|mark)\b/, 'teacher'], [/\bi (?:guard|patrol)\b/, 'guard'],
  [/\bi (?:sell|run the shop|run this shop|run the till)\b/, 'merchant'], [/\bi hear confessions\b/, 'priest'], [/\bmy (?:ward|patients)\b/, 'nurse'], [/\bmy (?:pupils|class)\b/, 'teacher'],
  [/\bi (?:deliver|drive)\b/, 'courier'], [/\bi (?:research|study the|run the lab)\b/, 'scientist'],
];

/** Canonical room kinds the brief speaks in, and the words that name each. Archetype-specific kinds are
 *  resolved later (worldFactory.nearestKind) — the brief only says what KIND OF ROOM the author meant. */
export const KIND_WORDS: Record<RoomKind, string[]> = {
  kitchen: ['kitchen', 'kitchens', 'scullery', 'pantry', 'kitchenette', 'galley', 'buttery', 'bakehouse', 'prep kitchen', 'kouzina', 'κουζινα'],
  bedroom: ['bedroom', 'bed', 'suite', 'dorm', 'dormitory', 'nursery', 'room 13', 'room 7', 'room 101', 'guest room', 'hotel room', 'kids room', 'master bedroom', 'ypnodomatio', 'υπνοδωματιο', 'krevatokamara', 'κρεβατοκαμαρα', 'domatio', 'δωματιο'],
  treasure: ['treasury', 'treasure', 'vault', 'strongroom', 'strong room', 'safe', 'hoard', 'hoard room', 'thisavros', 'θησαυρος'],
  cell: ['cell', 'cells', 'cell block', 'cell block a', 'cell block b', 'cell block c', 'dungeon cells', 'lower cells', 'the oubliette', 'oubliette', 'dungeon', 'keli', 'κελι', 'kelia', 'κελια'],
  throne: ['throne', 'throne room', 'audience chamber', 'hall of the crown', 'thronos', 'θρονος'],
  hall: ['hall', 'great hall', 'feast hall', 'lesser hall', 'ballroom', 'ball room', 'main hall', 'atrium', 'concourse', 'salon', 'living', 'living room', 'lounge', 'sitting room', 'saloni', 'σαλονι'],
  dining: ['dining', 'dining room', 'dining hall', 'breakfast room', 'mess hall', 'cafeteria', 'canteen', 'food court', 'chow line', 'lunch room', 'trapezaria', 'τραπεζαρια', 'kylikeio', 'κυλικειο'],
  lobby: ['lobby', 'foyer', 'grand foyer', 'entrance', 'entrance hall', 'front door', 'reception', 'front desk', 'waiting room', 'gatehouse', 'front gate', 'main gate', 'gate', 'intake', 'storefront', 'shop floor', 'front of house', 'eisodos', 'εισοδος', 'ypodoxi', 'υποδοχη'],
  library: ['library', 'reading room', 'archive', 'records', 'vivliothiki', 'βιβλιοθηκη'],
  office: ['office', 'study', 'den', "warden's office", "warden's suite", "principal's office", 'head office', 'staff room', 'back office', "manager's office", 'security office', 'boardroom', 'meeting room', 'grafeio', 'γραφειο'],
  lab: ['lab', 'laboratory', 'research lab', 'pathology lab', 'science lab', 'ergastirio', 'εργαστηριο'],
  ward: ['ward', 'ward a', 'ward b', 'ward c', 'wards', 'sick bay', 'infirmary', 'thalamos', 'θαλαμος'],
  surgery: ['surgery', 'operating room', 'operating theatre', 'theatre', 'theatre two', 'cheirourgeio', 'χειρουργειο'],
  morgue: ['morgue', 'back morgue', 'cold room', 'crypt', 'tomb', 'nekrotomeio', 'νεκροτομειο'],
  control: ['control', 'control room', "nurses' station", 'nurses station', 'security desk', 'security', 'guard station', 'guard post', 'watch post', 'comms room', 'server room', 'elenchos', 'ελεγχος'],
  storage: ['storage', 'store room', 'storeroom', 'stockroom', 'supply room', 'supply closet', 'closet', 'coat closet', 'linen closet', 'broom cupboard', 'cupboard', 'box room', 'attic', 'loft', 'clock loft', 'pharmacy', 'linen store', "janitor's closet", 'janitors closet', 'apothiki', 'αποθηκη', 'sofita', 'σοφιτα'],
  cellar: ['cellar', 'basement', 'undercroft', 'boiler room', 'ypogeio', 'υπογειο'],
  chapel: ['chapel', 'shrine', 'altar', 'crypt chapel', 'candle chapel', 'ekklisaki', 'εκκλησακι'],
  armoury: ['armoury', 'armory', 'arsenal', 'barracks', 'guardroom', 'oplostasio', 'οπλοστασιο'],
  tower: ['tower', 'watch tower', 'watchtower', 'keep', 'keep tower', 'east tower', 'west tower', 'lookout', 'balcony', 'pyrgos', 'πυργος'],
  yard: ['yard', 'courtyard', 'garden', 'back yard', 'backyard', 'front yard', 'lawn', 'exercise yard', 'the yard', 'north yard', 'field', 'playground', 'pitch', 'sports field', 'back lot', 'parking lot', 'inner bailey', 'outer bailey', 'avli', 'αυλη', 'kipos', 'κηπος'],
  gym: ['gym', 'gymnasium', 'old gym', 'sports hall', 'bleachers', 'stands', 'gymnastirio', 'γυμναστηριο'],
  classroom: ['classroom', 'class', 'art room', 'music room', 'classroom 1a', 'classroom 2b', 'taxi', 'ταξη', 'aithousa', 'αιθουσα'],
  bath: ['bath', 'bathroom', 'toilet', 'toilets', 'restroom', 'loo', 'laundry', 'laundry chute', 'banio', 'μπανιο', 'toualeta', 'τουαλετα'],
  garage: ['garage', 'workshop', 'delivery', 'delivery door', 'loading bay', 'sally port', 'postern gate', 'gkaraz', 'γκαραζ'],
  corridor: ['corridor', 'hallway', 'passage', 'secret passage', 'hidden passage', 'hidden way', 'tunnel', 'air duct', 'vent', 'vent shaft', 'crawlspace', 'west corridor', 'east corridor', 'long corridor', 'locker hall', 'lockers', 'diadromos', 'διαδρομος'],
  shop: ['shop', 'store', 'counter', 'till', 'toy store', 'pet store', 'bookshop', 'sweet shop', 'music store', 'phone store', 'shoe store', 'clothes store', 'service desk', 'magazi', 'μαγαζι'],
  containment: ['containment', 'isolation', 'quarantine', 'isolation unit', 'apomonosi', 'απομονωση'],
};
const KIND_OF_WORD = new Map<string, RoomKind>();
for (const [kind, words] of Object.entries(KIND_WORDS)) for (const w of words) KIND_OF_WORD.set(deaccent(w), kind);

/** The canonical room kind an author's place word implies, or undefined ("room 13" → bedroom, "the vault" → treasure). */
export function kindOfPlace(place: string | undefined): RoomKind | undefined {
  const w = deaccent(place ?? '').replace(/^(the|a|an|to|o|i|to|η|ο|το|στο|στη|στην|στον)\s+/, '');
  if (!w) return undefined;
  const direct = KIND_OF_WORD.get(w); if (direct) return direct;
  // possessives and adjectives: "mira's bedroom", "old gym", "back kitchen" — the last word(s) carry the kind
  const parts = w.split(' ');
  for (let i = 1; i < parts.length; i++) { const k = KIND_OF_WORD.get(parts.slice(i).join(' ')); if (k) return k; }
  // ordinals / numbers: "cell 3", "ward 4"
  const m = w.match(/^(.+?)\s+(?:#?\d+|[a-z])$/); if (m) { const k = KIND_OF_WORD.get(m[1]); if (k) return k; }
  return undefined;
}

/** A role word parsed from a name ("Nurse Temi" → nurse), the authored role, or the character's own lines. */
export function roleWordOf(name: string, role?: string, lines: string[] = []): string | undefined {
  const probe = (s: string): string | undefined => { const d = ' ' + deaccent(s).replace(/[.,!?'"’]/g, ' ') + ' '; for (const [re, w] of ROLE_WORDS) if (re.test(d)) return w; return undefined; };
  return probe(name) ?? (role ? probe(role) : undefined) ?? (() => { const d = ' ' + deaccent(lines.slice(0, 3).join(' ')) + ' '; for (const [re, w] of SELF_ROLE) if (re.test(d)) return w; return undefined; })();
}

const KEYISH = /\bkey(card)?s?\b|\bkleidi\b|\bκλειδι\b|\bpass(card)?\b|\bbadge\b|\bkarta\b|\bκαρτα\b/;
const isKeyItem = (it: { kind?: string; name: string; id: string }): boolean => it.kind === 'key' || KEYISH.test(deaccent(plainName(it.name))) || /(^|[-_])key(card)?($|[-_])/.test(it.id.toLowerCase());

const dlgNodes = (n: NpcDef): DlgNode[] => (Array.isArray(n.dialogue) && n.dialogue.length && typeof n.dialogue[0] !== 'string') ? (n.dialogue as DlgNode[]) : [{ t: (n.dialogue as string[]) ?? [] }];
const dlgText = (n: NpcDef): string[] => dlgNodes(n).flatMap((d) => d.t ?? []);

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------
export function storyBrief(def: WorldScript): StoryBrief {
  const npcs = def.npcs ?? [], items = def.items ?? [], enemies = def.enemies ?? [], quests = def.quests ?? [];
  const title = String(def.title ?? '');
  const placeOfNpc = new Map(npcs.map((n) => [n.id, n.place]));
  const placeOfItem = new Map(items.map((i) => [i.id, i.place]));
  const placeOfEnemy = new Map(enemies.map((e) => [e.id, e.place]));
  const placeOfTarget = (kind: BriefStep['kind'], id: string): string | undefined =>
    kind === 'talk' ? placeOfNpc.get(id) : kind === 'collect' ? placeOfItem.get(id) : kind === 'kill' ? placeOfEnemy.get(id) : undefined;

  // ---- cast / items / threats ----
  const cast: BriefCast[] = npcs.map((n) => ({ id: n.id, name: n.name, roleWord: roleWordOf(n.name, n.role, dlgText(n)), place: n.place?.trim() || undefined, kind: kindOfPlace(n.place) }));
  const questTargets = new Set<string>();
  for (const q of quests) if (q.objective.type === 'collect' && q.objective.targetId) questTargets.add(q.objective.targetId);
  for (const id of def.winItems ?? []) questTargets.add(id);
  if (def.winItem) questTargets.add(def.winItem);
  for (const n of npcs) for (const d of dlgNodes(n)) for (const t of (d.need ?? '').split(',')) { const m = t.trim().match(/^item:(.+)$/); if (m) questTargets.add(m[1]); }
  const briefItems: BriefItem[] = items.map((i) => ({ id: i.id, name: i.name, place: i.place?.trim() || undefined, kind: kindOfPlace(i.place), questTarget: questTargets.has(i.id), isKey: isKeyItem(i) }));
  const threats: BriefThreat[] = enemies.map((e) => ({ id: e.id, name: e.name ?? e.id, place: e.place?.trim() || undefined, boss: !!e.bossPattern }));

  // ---- chain: quests in chain order, then the win rules, then item-gated beats ----
  const chain: BriefStep[] = [];
  // one step per (kind, target): a character you talk to twice (quest giver and turn-in) is one place in the building
  const push = (kind: BriefStep['kind'], targetId: string) => {
    if (!targetId || chain.some((s) => s.kind === kind && s.targetId === targetId)) return;
    chain.push({ step: chain.length, kind, targetId, place: placeOfTarget(kind, targetId) });
  };
  const sortedQuests = quests.slice().sort((a, b) => (a.chainStep ?? 0) - (b.chainStep ?? 0));
  for (const q of sortedQuests) {
    const giver = npcs.find((n) => n.givesQuest === q.id);
    if (giver) push('talk', giver.id);
    if (q.objective.targetId) push(q.objective.type, q.objective.targetId);
    if (q.turnIn) push('talk', q.turnIn);
  }
  for (const id of def.winItems ?? []) push('collect', id);
  if (def.winItem) push('collect', def.winItem);
  for (const id of def.winNpcs ?? []) push('talk', id);
  // a beat gated on holding an item: fetch the item, then the talk; win beats come last
  const gated: { npc: string; item: string; win: boolean }[] = [];
  for (const n of npcs) for (const d of dlgNodes(n)) {
    const need = d.need ?? ''; const m = need.split(',').map((t) => t.trim().match(/^item:(.+)$/)).find(Boolean);
    if (!m) continue;
    const win = (d.c ?? []).some((c) => c[1] === 'f:win') || !!d.end;
    gated.push({ npc: n.id, item: m[1], win });
  }
  for (const g of gated.filter((x) => !x.win)) { push('collect', g.item); push('talk', g.npc); }
  for (const g of gated.filter((x) => x.win)) { push('collect', g.item); push('talk', g.npc); }
  for (const e of enemies) if (e.bossPattern) push('kill', e.id);
  // a bare win on a character's last node: the talk that ends the game
  for (const n of npcs) if (!chain.some((s) => s.kind === 'talk' && s.targetId === n.id) && dlgNodes(n).some((d) => !d.need && (d.c ?? []).some((c) => c[1] === 'f:win'))) push('talk', n.id);

  // ---- theme ----
  const corpus = [
    ...npcs.flatMap((n) => [n.name, n.role ?? '', ...dlgText(n)]),
    ...items.flatMap((i) => [plainName(i.name), i.desc ?? '']),
    ...enemies.map((e) => e.name ?? e.id),
    ...quests.flatMap((q) => [q.title, q.desc]),
    ...(def.story?.intro ?? []), def.story?.outro ?? '', def.story?.goal ?? '', def.subtitle ?? '',
    ...Object.values(def.endings ?? {}),
  ].map(deaccent).join(' \n ');
  const titleD = deaccent(title);
  const score = new Map<Theme, number>();
  for (const th of THEMES) {
    let s = 0;
    for (const w of THEME_WORDS[th]) { const d = deaccent(w); if (!d) continue; s += count(corpus, d); s += 3 * count(titleD, d); }
    if (s > 0) score.set(th, s);
  }
  const archTheme = ARCH_THEME[String(def.world.archetype ?? '')];
  if (archTheme) score.set(archTheme, (score.get(archTheme) ?? 0) + 3);
  const theme = [...score.entries()].sort((a, b) => b[1] - a[1] || THEMES.indexOf(a[0]) - THEMES.indexOf(b[0])).slice(0, 3).map(([t]) => t);

  // ---- mood ----
  let mood: Mood = theme.length ? THEME_MOOD[theme[0]] : 'calm';
  if (mood === 'calm' && threats.some((t) => t.boss)) mood = 'tense';
  if (theme.includes('ghost') && mood !== 'eerie' && theme[0] !== 'party') mood = 'eerie';

  // ---- nouns ----
  const nouns: string[] = [];
  const addNoun = (s: string | undefined) => { const w = plainName(s ?? '').trim(); if (!w) return; if (nouns.some((n) => deaccent(n) === deaccent(w))) return; nouns.push(w); };
  for (const it of briefItems.filter((i) => i.questTarget || i.isKey)) addNoun(it.name);
  for (const c of cast) addNoun(c.name);
  for (const s of chain) if (s.place) addNoun(s.place);
  for (const t of threats) addNoun(t.name);
  for (const it of briefItems) addNoun(it.name);
  for (const c of cast) addNoun(c.place);
  for (const w of title.split(/\s+/)) if (/^[A-ZΑ-Ω]/.test(w) && w.length > 3 && !/^(The|And|For|With|Before|After|What|Who|Is|Are)$/.test(w)) addNoun(w.replace(/[^\p{L}\p{N}'’]/gu, ''));
  const nounsOut = nouns.slice(0, 12);

  // ---- seed: the story content, never the layout ----
  const sig = JSON.stringify([title, theme, mood, cast.map((c) => [c.id, c.name, c.roleWord ?? '', c.place ?? '', c.kind ?? '']), briefItems.map((i) => [i.id, i.name, i.place ?? '', i.questTarget, i.isKey]), threats.map((t) => [t.id, t.name, t.place ?? '', t.boss]), chain.map((s) => [s.kind, s.targetId, s.place ?? ''])]);
  const seed = hash32(0x5709, sig);

  return { seed, title, theme, mood, cast, items: briefItems, threats, chain, nouns: nounsOut };
}

/** Occurrences of `needle` in `hay` (whole-word when it starts and ends on a letter). */
function count(hay: string, needle: string): number {
  let n = 0, i = 0;
  for (;;) {
    const j = hay.indexOf(needle, i); if (j < 0) return n;
    const before = j === 0 ? ' ' : hay[j - 1], after = j + needle.length >= hay.length ? ' ' : hay[j + needle.length];
    const startOk = !/[\p{L}\p{N}]/u.test(before), endOk = !/[\p{L}]/u.test(after);   // "poison" counts "poisoned"? no: "poisoned" is listed; plurals are listed too
    if (startOk && endOk) n++;
    i = j + needle.length;
  }
}
