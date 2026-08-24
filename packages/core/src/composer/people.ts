// src/engine/composer/people.ts — THE EXTRAS (the hook furnish.ts calls once per building, after every zone is furnished).
//
// THE CONTRACT. castPeople decides who stands in each room and what they say: the default people a recipe asks
// for ({ n, roles } per kind), thinned where the script's own cast already stands (ctx.zones[].cast), speaking
// lines that may be tt() templates with {name}-style holes filled from `Person.vars` (the engine calls
// tt(line, vars) — so "Have you seen {who}?" with vars { who: 'Biscuit' } is one translatable key). `ctx.rng`
// is seeded from brief.seed, never from the layout seed: the same script casts the same extras on every seed.
// Spots and routes come from furnish's own validated machinery (ctx.spotIn / ctx.routeIn) — a route returned by
// routeIn is a closed loop whose every leg clears the room's colliders, so the engine walks it unprobed.
//
// WHAT THE EXTRAS ARE FOR. They are the story's chorus: the people who point the player onward. Three rules —
//   ROLES fit the building AND the story: every extra is a role the room's recipe lists (a prison stays full of
//     guards and inmates), picked by the brief's themes (a heist favours the guard and the clerk, a night ward
//     the nurses) and never a role word the named cast already owns (one chef, not two — story.roleWordOf).
//     The recipe's {n} is the count; the mood scales it (festive +1, eerie ≤ 1 per room, grim halves).
//   PLACEMENT fits the plot: extras cluster where the chain starts (the entrance, the first beat's room), never
//     stand where the story ends (the last beat's room, a boss room, a threat's room) nor in the authored key
//     item's room; a role whose work is a room stands in it (guards at the gate, cooks in the kitchen) because
//     the recipe of that room is where the role is listed. Corridors stay empty as before.
//   LINES are the point: 2–3 per extra, the first always ABOUT the story (a cast name, the quest item, the
//     boss) and TRUE for this map (a room is named only when the entity really stands there — ctx.zones says
//     where), the second by theme, the third a flavour line of the role (or the archetype's chatter). Picked
//     from the template bank below with a die seeded from (brief.seed, zone.id, i) only — never the layout —
//     so the same script puts the same words in the same mouths on every seed (the layout decides only whether
//     a room is populated and where in it each extra stands). No line repeats in a room.
import type { Archetype, Person, RoomRecipe, Spot } from './types';
import { corridorKindOf } from './types';
import { sub, type Rng } from './rng';
import { roleWordOf, type BriefCast, type BriefItem, type BriefThreat, type StoryBrief, type Theme } from './story';
import type { DressZone } from './dressing';
const deaccent = (s: string): string => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_\s]+/g, ' ').trim();

export interface CastContext {
  brief: StoryBrief;
  arch: Archetype;
  /** Every room, with the named cast / items / threats already known per zone so defaults do not duplicate them. */
  zones: DressZone[];
  /** The recipe's default presence per room KIND: how many extras and what they are. */
  recipes: Record<string, NonNullable<RoomRecipe['people']>>;
  /** Seeded from brief.seed — the story's die. */
  rng: Rng;
  /** The zone's standing spots (furnish's validated npc spots: lane cells ≥ 3 u apart, door fans excluded),
   *  `opts.taken` excluded, at most `opts.n` (default: all). Index 0 is the room's best stand. */
  spotIn(zone: string, opts?: { taken?: Spot[]; n?: number }): Spot[];
  /** A walk loop inside the zone starting at `start` (or out through a door into the corridor and back);
   *  [] when the room is too cramped to walk — such a person stands still. Every leg is collider-clear. */
  routeIn(zone: string, start: Spot): Spot[];
  /** Today's default people (recipe n/roles, layout-seeded, archetype chatter) — what the stub returns. */
  defaults(): Person[];
}

// ---------------------------------------------------------------------------
// The template bank — tt() keys with {who} / {item} / {room} / {boss} holes
// ---------------------------------------------------------------------------
/** KEY MARKER, not a translation: the lines below are stored untranslated (Person.lines are tt() keys the engine
 *  translates at spawn — game.ts tt(l, p.vars)). Writing each one as tt('…') here is what lets the dictionary
 *  guard (scripts/i18n-ui-check.mjs) collect them, so every language file must carry them. */
const tt = (en: string): string => en;
type Hole = 'who' | 'item' | 'room' | 'boss';
interface Tpl { key: string; needs: Hole[] }
const T = (key: string): Tpl => ({ key, needs: [...new Set([...key.matchAll(/\{(who|item|room|boss)\}/g)].map((m) => m[1] as Hole))] });

/** STORY lines — one per extra, always about an entity of the script; `…Room` variants name the room that really holds it. */
const HINTS = {
  castRoom: [
    T(tt('Have you seen {who}? Try the {room}.')),
    T(tt('{who}? In the {room}, last I looked.')),
    T(tt('If it is {who} you want, the {room} is where you will find them.')),
    T(tt('{who} has not left the {room} all day.')),
  ],
  cast: [
    T(tt('Everyone wants a word with {who} today.')),
    T(tt('Whatever {who} tells you, listen twice.')),
    T(tt('Nobody has seen {who} smile all week.')),
  ],
  itemRoom: [
    T(tt('Looking for the {item}? Try the {room}.')),
    T(tt('The {item}? Somebody carried it into the {room}.')),
    T(tt('Check the {room} if you want the {item}. Do not say I told you.')),
    T(tt('The {room} is where they keep the {item}.')),
  ],
  item: [
    T(tt('Everyone is talking about the {item}.')),
    T(tt('The whole place has turned upside down over one {item}.')),
    T(tt('Find the {item} and half the trouble here goes away.')),
  ],
  bossRoom: [
    T(tt('{boss} has not come out of the {room} in days.')),
    T(tt('Stay out of the {room}. {boss} is in there.')),
    T(tt('Whatever you do, keep away from the {room}. {boss} waits there.')),
  ],
  boss: [
    T(tt('If you hear {boss} coming, do not wait to see.')),
    T(tt('{boss} is about. Keep your voice down.')),
  ],
  goalTalkRoom: [T(tt('Start with {who}, in the {room}. Nobody else will tell you anything.'))],
  goalTalk: [T(tt('Start with {who}. {who} knows more than anyone here.'))],
  goalItemRoom: [T(tt('It all comes down to the {item}. Try the {room} first.'))],
  goalItem: [T(tt('It all comes down to the {item}.'))],
  goalBoss: [T(tt('This ends with {boss}. Everyone here knows it.'))],
};

/** THEME lines — three per theme; the ones with a hole are used only when the building has someone / something to fill it. */
const THEME_LINES: Record<Theme, Tpl[]> = {
  crime: [T(tt('Nobody in this place is telling the whole truth.')), T(tt('Somebody here knows exactly what happened. Somebody always does.')), T(tt('Ask {who} what they were doing last night. Watch the face, not the answer.'))],
  heist: [T(tt('Keep your head down and your hands where they can see them.')), T(tt('Security has been jumpy since the {item} went missing.')), T(tt('Every door here has a key somewhere. Stupid system. Good for you.'))],
  missing: [T(tt('Still no sign of the {item}. Everyone has been looking since this morning.')), T(tt('If it is lost, it is somewhere. That is the only comfort I have.')), T(tt('{who} has been looking all morning too. Ask around; somebody saw something.'))],
  party: [T(tt('Is it true there is a feast tonight? Nobody tells me anything.')), T(tt('I have been told to look cheerful. I am trying.')), T(tt('Ask {who} whether the cake is real. I have my doubts.'))],
  wedding: [T(tt('Sunday cannot come fast enough. Or slow enough. Depends who you ask.')), T(tt('The whole house smells of flowers and panic.')), T(tt('Somebody should check on {who} before the vows.'))],
  exam: [T(tt('Second period and already a disaster.')), T(tt('If anyone asks, I was studying.')), T(tt('{who} will know. {who} always knows, worse luck.'))],
  ghost: [T(tt('Do not go upstairs after dark. Nobody does.')), T(tt('The candles went out again. On their own.')), T(tt('You heard it too, did you not. Then I am not imagining it.'))],
  siege: [T(tt('They are on the ridge. We are in here. That is the whole situation.')), T(tt('Count the bread, not the days.')), T(tt('The walls will hold. The walls always hold. Ask {who} if you do not believe me.'))],
  escape: [T(tt('Nobody gets out of here without a stamp or a tunnel.')), T(tt('Do not run. Walk. Running is how they notice you.')), T(tt('Whatever {who} offers you, ask what it costs.'))],
  illness: [T(tt('Nobody sleeps on this ward. Not really.')), T(tt('Three in the morning. The building hums and so do I.')), T(tt('If you see a patient walking, walk with them.'))],
  market: [T(tt('Friday. It is always Friday when something breaks.')), T(tt('Mind the queue. It bites.')), T(tt('Everyone in the queue is asking about the {item}.'))],
  trial: [T(tt('Everyone here has already decided how to vote.')), T(tt('The council sits soon. Nobody is smiling.')), T(tt('Whatever {who} says in there, somebody wrote it down first.'))],
  treasure: [T(tt('They say it is somewhere under this floor. They have said that for years.')), T(tt('Everyone who came looking for it is still looking.')), T(tt('The {item} is worth more than this whole building. That is the problem.'))],
  romance: [T(tt('Somebody left a letter on the stairs. I did not read it. Much.')), T(tt('Half the building is in love with {who}. The other half has not met them.')), T(tt('Love letters and locked doors. Every single time.'))],
  sports: [T(tt('Big match tonight. Everyone is nervous and pretending not to be.')), T(tt('Coach says run, so I run.')), T(tt('The trophy cabinet has one gap and everyone stares at it.'))],
  rescue: [T(tt('Go quickly. I will keep the door.')), T(tt('Somebody is still in there. Somebody always is.')), T(tt('Find {who} and bring them back. The rest can wait.'))],
};

/** FLAVOUR lines per role family (a recipe role word maps to a family through ROLE_FAMILY); one is the third line of an extra. */
const ROLE_LINES: Record<string, Tpl[]> = {
  guard: [T(tt('Move along. Nothing to see. Officially.')), T(tt('I walk this post all night. The night walks back.'))],
  chef: [T(tt('Out of my kitchen unless you are carrying something.')), T(tt('Forty covers and one oven. Do the sums.'))],
  cashier: [T(tt('Card or cash? The machine is having a day.'))],
  manager: [T(tt('I am not hiding in here. I am reviewing the numbers.'))],
  shopkeeper: [T(tt('We are closed. Unless you are buying, in which case we are open.'))],
  clerk: [T(tt('If it is not on the shelf, it is in the back. If it is not in the back, it never existed.'))],
  customer: [T(tt('I only came in for one thing. I have been here an hour.')), T(tt('Is there a queue, or is this just where people stand?'))],
  prisoner: [T(tt('Year four. I stopped counting days and started counting guards.')), T(tt('Keep your voice down. The walls take notes.'))],
  warden: [T(tt('I do not make the same offer twice.'))],
  caretaker: [T(tt('Keys, torch, a list of doors. The list says nothing about this.'))],
  janitor: [T(tt('I clean this place. I see things. I do not say them.'))],
  ghost: [T(tt('Oh. You can see me. Most of them walk straight through.')), T(tt('I have been here longer than the wallpaper.'))],
  guest: [T(tt('I have stayed here every year. It gets quieter.'))],
  pupil: [T(tt('I did not do it. Whatever it was.')), T(tt('The bell goes in twenty minutes. It always does.'))],
  kid: [T(tt('Mum says I am not allowed in the cellar. So that is where I go.'))],
  teen: [T(tt('I am not listening. I am just standing here with my ears on.'))],
  teacher: [T(tt('Hands up if you know. Hands down if you do not. Good, now we know where we are.'))],
  coach: [T(tt('Two laps. Then we talk.'))],
  principal: [T(tt('My door is always open. It is also locked. Both things are true.'))],
  librarian: [T(tt('Quiet, please. The books are listening.'))],
  nurse: [T(tt('Forty beds, one of me. Ask quickly.')), T(tt('Take something warm with you. Everyone here is cold.'))],
  doctor: [T(tt('I was not asleep. Nobody sleeps on this shift.'))],
  patient: [T(tt('They keep moving the wards. I keep finding them.'))],
  receptionist: [T(tt('Sign here, and here, and do not ask what the third line is for.'))],
  scientist: [T(tt('Do not touch that. It is either harmless or very much not.'))],
  courtier: [T(tt('A cupbearer in the hall. How very modern.'))],
  squire: [T(tt('I polish it, he wears it, they dent it. That is the arrangement.'))],
  steward: [T(tt('The numbers are fine. The numbers are perfectly fine.'))],
  priest: [T(tt('I hear confessions. I do not repeat them.'))],
  parent: [T(tt('Shoes off. I just did the floors.'))],
  elder: [T(tt('In my day we had one key and we knew where it was.'))],
  neighbour: [T(tt('I am only here because I heard a noise. That is my whole reason.'))],
  developer: [T(tt('It worked on my machine. My machine is not here.'))],
  intern: [T(tt('I was told to look busy. This is me looking busy.'))],
  sysadmin: [T(tt('The backup of the backup did not. Do not touch that.'))],
  courier: [T(tt('Sign for it and I am gone. I have nine more of these.'))],
  adventurer: [T(tt('I came in for the gold. I would settle for the exit.'))],
  cultist: [T(tt('The chant is optional. The robe is not.'))],
  resident: [T(tt('Mind the step. Everyone minds the step eventually.'))],
};
/** Recipe role word → flavour family. Unlisted words fall back to the archetype's chatter. */
const ROLE_FAMILY: Record<string, string> = {
  guards: 'guard', guard: 'guard', 'security guard': 'guard', 'night guard': 'guard',
  cook: 'chef', baker: 'chef', chef: 'chef', cashier: 'cashier', manager: 'manager', shopkeeper: 'shopkeeper', 'stock clerk': 'clerk',
  customer: 'customer', shopper: 'customer', inmates: 'prisoner', inmate: 'prisoner', prisoner: 'prisoner', prisoners: 'prisoner', warden: 'warden',
  caretaker: 'caretaker', janitor: 'janitor', ghost: 'ghost', guest: 'guest', pupil: 'pupil', kid: 'kid', teen: 'teen', teacher: 'teacher', coach: 'coach',
  principal: 'principal', librarian: 'librarian', nurse: 'nurse', doctor: 'doctor', patient: 'patient', receptionist: 'receptionist', scientist: 'scientist',
  courtier: 'courtier', squire: 'squire', steward: 'steward', priest: 'priest', mum: 'parent', dad: 'parent', grandma: 'elder', grandpa: 'elder',
  neighbour: 'neighbour', developer: 'developer', intern: 'intern', sysadmin: 'sysadmin', 'delivery driver': 'courier', 'lost adventurer': 'adventurer',
  cultist: 'cultist', resident: 'resident', greeter: 'receptionist',
};
/** Which recipe roles a theme puts forward (the strongest theme counts most). */
const THEME_ROLES: Record<Theme, string[]> = {
  crime: ['guards', 'security guard', 'manager', 'steward', 'janitor', 'caretaker', 'warden', 'receptionist'],
  heist: ['guards', 'security guard', 'cashier', 'stock clerk', 'janitor', 'sysadmin', 'receptionist', 'intern'],
  missing: ['kid', 'pupil', 'janitor', 'caretaker', 'neighbour', 'nurse', 'customer', 'shopper', 'mum', 'dad'],
  party: ['guest', 'courtier', 'cook', 'baker', 'customer', 'shopper', 'kid', 'squire'],
  wedding: ['guest', 'courtier', 'priest', 'cook', 'mum', 'grandma'],
  exam: ['pupil', 'teacher', 'librarian', 'principal'],
  ghost: ['caretaker', 'ghost', 'guest', 'priest', 'lost adventurer'],
  siege: ['guards', 'squire', 'cook', 'steward', 'courtier'],
  escape: ['inmates', 'prisoner', 'prisoners', 'guards', 'cook'],
  illness: ['nurse', 'doctor', 'patient', 'receptionist'],
  market: ['customer', 'shopper', 'cashier', 'cook', 'baker', 'delivery driver', 'shopkeeper'],
  trial: ['courtier', 'steward', 'priest', 'guards'],
  treasure: ['lost adventurer', 'cultist', 'prisoners', 'squire'],
  romance: ['guest', 'teen', 'courtier', 'pupil', 'customer'],
  sports: ['coach', 'pupil', 'kid', 'teen'],
  rescue: ['nurse', 'doctor', 'guards', 'neighbour', 'dad', 'mum'],
};
/** The rooms a role's work is: a role listed in such a room's recipe wins the draw there (guards at the gate, cooks in the kitchen). */
const ROLE_HOME: Record<string, string[]> = {
  guards: ['gate', 'gatehouse', 'main_gate', 'watchtower', 'tower', 'control'], 'security guard': ['concourse'],
  cook: ['kitchen', 'cafeteria', 'food_court'], baker: ['kitchen'], cashier: ['counter'], receptionist: ['lobby', 'reception'],
  librarian: ['library'], coach: ['gym', 'field', 'bleachers'], teacher: ['classroom'], principal: ['office'], janitor: ['janitor', 'lobby'],
  caretaker: ['foyer'], nurse: ['ward', 'control'], doctor: ['ward', 'surgery'], patient: ['ward', 'reception'], warden: ['warden'],
  inmates: ['cell_block', 'yard'], priest: ['chapel'], steward: ['great_hall', 'throne'], courtier: ['throne', 'great_hall'], squire: ['armoury', 'courtyard'],
  manager: ['office', 'boss_office'], 'stock clerk': ['storage'], 'delivery driver': ['delivery'], shopkeeper: ['store'], developer: ['open_plan', 'server_room'],
  sysadmin: ['server_room'], intern: ['kitchenette'], mum: ['kitchen'], dad: ['garage', 'study'], kid: ['bedroom', 'yard'], grandma: ['living'], grandpa: ['dining'],
  ghost: ['cellar', 'library', 'loft'], guest: ['ballroom', 'suite', 'dining'], cultist: ['shrine'], 'lost adventurer': ['entrance', 'chamber'],
};

/** The bank, flat — for tests and audits (size per family). */
export const PEOPLE_TEMPLATES: { family: string; key: string }[] = [
  ...Object.entries(HINTS).flatMap(([k, v]) => v.map((t) => ({ family: 'hint:' + k, key: t.key }))),
  ...Object.entries(THEME_LINES).flatMap(([k, v]) => v.map((t) => ({ family: 'theme:' + k, key: t.key }))),
  ...Object.entries(ROLE_LINES).flatMap(([k, v]) => v.map((t) => ({ family: 'role:' + k, key: t.key }))),
];

// ---------------------------------------------------------------------------
// Facts — what the extras may truthfully say about THIS building
// ---------------------------------------------------------------------------
/** One thing an extra can say: the templates that fit it and the vars they need. `about` = the entity, `zone` = where
 *  it stands (when a PlaceReq bound it), `weight` = how much the chorus wants to say it. */
interface Fact { tpls: Tpl[]; vars: Record<string, string>; about: string; zone?: string; weight: number }

/** Strip the emoji a script may prefix an item name with ("📜 ledger" → "ledger"). */
const plain = (s: string): string => String(s || '').replace(/[\p{Extended_Pictographic}️‍]+/gu, ' ').replace(/\s+/g, ' ').trim();

function factsOf(brief: StoryBrief, zones: DressZone[]): { facts: Fact[]; goal?: Fact } {
  const chainIds = new Set(brief.chain.map((s) => s.targetId));
  const zoneOfCast = (c: BriefCast) => zones.find((z) => z.cast.some((e) => e.id === c.id));
  const zoneOfItem = (i: BriefItem) => zones.find((z) => z.items.some((e) => e.id === i.id));
  const zoneOfThreat = (t: BriefThreat) => zones.find((z) => z.threats.some((e) => e.id === t.id));
  const facts: Fact[] = [];
  for (const c of brief.cast) {
    const z = zoneOfCast(c); const inChain = chainIds.has(c.id);
    if (!z && !inChain) continue;                                   // a character of another world, or one nobody needs: not our business
    const w = inChain ? 2 : 1;
    if (z) facts.push({ tpls: HINTS.castRoom, vars: { who: c.name, room: z.name }, about: c.id, zone: z.id, weight: w + 1 });
    facts.push({ tpls: HINTS.cast, vars: { who: c.name }, about: c.id, zone: z?.id, weight: w });
  }
  for (const it of brief.items) {
    const z = zoneOfItem(it); const matters = it.questTarget || it.isKey || chainIds.has(it.id);
    if (!z && !matters) continue;
    const name = plain(it.name); if (!name) continue;
    const w = matters ? 2 : 1;
    if (z) facts.push({ tpls: HINTS.itemRoom, vars: { item: name, room: z.name }, about: it.id, zone: z.id, weight: w + 1 });
    facts.push({ tpls: HINTS.item, vars: { item: name }, about: it.id, zone: z?.id, weight: w });
  }
  for (const t of brief.threats) {
    const z = zoneOfThreat(t); const name = plain(t.name); if (!name) continue;
    const w = t.boss ? 2 : 1;
    if (z) facts.push({ tpls: HINTS.bossRoom, vars: { boss: name, room: z.name }, about: t.id, zone: z.id, weight: w + 1 });
    facts.push({ tpls: HINTS.boss, vars: { boss: name }, about: t.id, zone: z?.id, weight: w });
  }
  // the first beat of the chain: what the people at the door send you towards
  let goal: Fact | undefined;
  const first = brief.chain[0];
  if (first) {
    if (first.kind === 'talk') {
      const c = brief.cast.find((x) => x.id === first.targetId); const z = c && zoneOfCast(c);
      if (c) goal = z ? { tpls: HINTS.goalTalkRoom, vars: { who: c.name, room: z.name }, about: c.id, zone: z.id, weight: 3 } : { tpls: HINTS.goalTalk, vars: { who: c.name }, about: c.id, weight: 3 };
    } else if (first.kind === 'collect') {
      const it = brief.items.find((x) => x.id === first.targetId); const z = it && zoneOfItem(it); const name = plain(it?.name ?? '');
      if (it && name) goal = z ? { tpls: HINTS.goalItemRoom, vars: { item: name, room: z.name }, about: it.id, zone: z.id, weight: 3 } : { tpls: HINTS.goalItem, vars: { item: name }, about: it.id, weight: 3 };
    } else if (first.kind === 'kill') {
      const t = brief.threats.find((x) => x.id === first.targetId); const name = plain(t?.name ?? '');
      if (t && name) goal = { tpls: HINTS.goalBoss, vars: { boss: name }, about: t.id, zone: zoneOfThreat(t)?.id, weight: 3 };
    }
  }
  return { facts, goal };
}

/** The holes a theme / flavour line may borrow: the story's most relevant name of each kind. */
function fillers(brief: StoryBrief, zones: DressZone[]): Partial<Record<Hole, string>> {
  const chainIds = brief.chain.map((s) => s.targetId);
  const here = (id: string) => zones.some((z) => z.cast.some((c) => c.id === id) || z.items.some((i) => i.id === id) || z.threats.some((t) => t.id === id));
  const rank = (id: string) => { const i = chainIds.indexOf(id); return (i < 0 ? 99 : i) - (here(id) ? 0.5 : 0); };
  const who = brief.cast.filter((c) => here(c.id) || chainIds.includes(c.id)).sort((a, b) => rank(a.id) - rank(b.id))[0];
  const item = brief.items.filter((i) => plain(i.name) && (i.questTarget || i.isKey || here(i.id) || chainIds.includes(i.id))).sort((a, b) => rank(a.id) - rank(b.id))[0];
  const boss = brief.threats.filter((t) => plain(t.name)).sort((a, b) => (b.boss ? 1 : 0) - (a.boss ? 1 : 0))[0];
  const out: Partial<Record<Hole, string>> = {};
  if (who) out.who = who.name; if (item) out.item = plain(item.name); if (boss) out.boss = plain(boss.name);
  return out;
}

// ---------------------------------------------------------------------------
// Casting
// ---------------------------------------------------------------------------
/** Cast the extras of a building (see the header). Deterministic on brief.seed: layout only decides WHERE a
 *  role stands (the spot / the route), never WHO is cast or WHAT they say. */
export function castPeople(ctx: CastContext): Person[] {
  const { brief, arch, zones, recipes } = ctx;
  const mood = brief.mood;
  const corridor = corridorKindOf(arch);
  const castWords = new Set(brief.cast.map((c) => c.roleWord).filter((w): w is string => !!w));
  const { facts, goal } = factsOf(brief, zones);
  const fill = fillers(brief, zones);
  const themes = brief.theme.slice(0, 3);

  // ---- where the story starts and ends ----
  const last = brief.chain.length > 1 ? brief.chain[brief.chain.length - 1] : undefined;
  const holds = (z: DressZone, id: string) => z.cast.some((c) => c.id === id) || z.items.some((i) => i.id === id) || z.threats.some((t) => t.id === id);
  const first = brief.chain[0];
  const isFinal = (z: DressZone) => (!!last && holds(z, last.targetId)) || z.threats.length > 0 || z.role === 'boss' || z.role === 'exit' || z.reqs.some((r) => !!r.boss || r.role === 'boss' || r.role === 'key');
  /** The die key of a room: the story aliases bound here when the script named it (so the same script casts the same
   *  extras in "the kitchen" on every layout seed, whatever ordinal the kitchen zone got), else the zone id. */
  const dieKey = (z: DressZone) => z.reqs.length ? 'story:' + z.reqs.map((r) => deaccent(r.alias)).sort().join('+') : z.id;
  const isOpening = (z: DressZone) => z.isStart || (!!first && holds(z, first.targetId) && !isFinal(z));

  const out: Person[] = [];
  const order: { zone: DressZone; people: Person[] }[] = [];
  for (const zone of zones) {
    if (zone.kind === corridor) continue;                           // circulation stays empty (the patrol code is the guards' job)
    const cfg = recipes[zone.kind];
    if (!cfg) continue;
    const rz = sub(brief.seed, 'people', dieKey(zone));
    const [lo, hi] = cfg.n;
    // ---- count: the recipe's die, scaled by the mood, pulled towards the start, zero at the end ----
    let n = rz.int(lo, hi);
    if (mood === 'festive' && hi > 0) n = Math.min(hi + 1, n + 1);
    else if (mood === 'grim') n = Math.min(n, Math.max(lo, Math.ceil(n / 2)));
    const cap = mood === 'eerie' ? 1 : mood === 'festive' ? hi + 1 : Math.max(hi, 1);
    if (isOpening(zone) && hi > 0) n = Math.min(cap, Math.max(1, n + 1));
    if (zone.isStart) n = Math.max(n, 1);
    n = Math.min(n, cap);
    if (isFinal(zone)) n = 0;
    // ---- roles the recipe lists that the script's cast does not already own ----
    const roles = cfg.roles.filter((r) => { const w = roleWordOf(r); return !w || !castWords.has(w); });
    if (!roles.length && !(zone.isStart && !cfg.roles.length)) n = 0;
    if (n <= 0) continue;
    const spots = ctx.spotIn(zone.id);
    n = Math.min(n, spots.length);
    const usedKeys = new Set<string>();
    const usedRoles: string[] = [];
    const people: Person[] = [];
    for (let i = 0; i < n; i++) {
      const rp = sub(brief.seed, 'people', dieKey(zone), i);
      // ---- role: theme affinity × the room being the role's workplace, fresh roles first ----
      const role = roles.length ? rp.weighted(roles, (r) => {
        let w = 1;
        themes.forEach((th, k) => { if (THEME_ROLES[th]?.includes(r)) w += 3 - k; });
        if (ROLE_HOME[r]?.includes(zone.kind)) w += 3;
        if (usedRoles.includes(r) && roles.length > 1) w *= 0.35;
        return w;
      }) : 'resident';
      usedRoles.push(role);
      // ---- lines: story, theme, flavour — no key twice in a room, holes consistent within a person ----
      const vars: Record<string, string> = {};
      const lines: string[] = [];
      const take = (tpl: Tpl, v: Record<string, string>): boolean => {
        if (usedKeys.has(tpl.key)) return false;
        for (const h of tpl.needs) { const val = v[h]; if (val === undefined || (vars[h] !== undefined && vars[h] !== val)) return false; }
        for (const h of tpl.needs) vars[h] = v[h];
        usedKeys.add(tpl.key); lines.push(tpl.key); return true;
      };
      const k = rp.int(2, 3);
      // 1. the story line: the door points onward (the goal), everyone else gossips about the cast, the item, the threat.
      //    The pool is the same on every seed (no layout test here): an extra may name the very room it stands in.
      const pool = facts.filter((f) => f.tpls.some((t) => !usedKeys.has(t.key)));
      const cands: Fact[] = [];
      if (goal && goal.tpls.some((t) => !usedKeys.has(t.key))) cands.push({ ...goal, weight: zone.isStart ? 6 : 1 });
      cands.push(...pool);
      for (let tries = 0; tries < 4 && !lines.length && cands.length; tries++) {
        const f = rp.weighted(cands, (x) => x.weight);
        const open = f.tpls.filter((t) => !usedKeys.has(t.key));
        if (open.length) take(rp.pick(open), f.vars);
        cands.splice(cands.indexOf(f), 1);
      }
      // 2. a theme line (the strongest theme most often); a hole borrows the story's most relevant name
      const themeOpen = themes.flatMap((th, idx) => (THEME_LINES[th] ?? []).filter((t) => !usedKeys.has(t.key) && t.needs.every((h) => h === 'room' ? false : fill[h] !== undefined || vars[h] !== undefined)).map((t) => ({ t, w: 3 - idx })));
      if (themeOpen.length) { const c = rp.weighted(themeOpen, (x) => x.w); take(c.t, { ...fill, ...vars } as Record<string, string>); }
      // 3. flavour: the role's own line, else the archetype's chatter
      if (lines.length < k) {
        const fam = ROLE_FAMILY[role];
        const own = (fam && ROLE_LINES[fam] ? ROLE_LINES[fam] : []).filter((t) => !usedKeys.has(t.key));
        if (own.length) take(rp.pick(own), {});
        else if (arch.chatter.length) { const c = arch.chatter.filter((l) => !usedKeys.has(l)); if (c.length) { const l = rp.pick(c); usedKeys.add(l); lines.push(l); } }
      }
      if (!lines.length) continue;                                   // nothing left to say: stay out of the room
      const spot = spots[i];
      const route = ctx.routeIn(zone.id, spot);
      const person: Person = { id: zone.id + ':p' + i, zone: zone.id, role, spot, route: route.length >= 3 ? route : [], lines };
      if (Object.keys(vars).length) person.vars = vars;
      people.push(person);
    }
    if (people.length) order.push({ zone, people });
  }
  // the engine spawns the first few (cap 6 beside an authored cast): the door and the first beat's room go first
  const rank = (z: DressZone) => (z.isStart ? 0 : isOpening(z) ? 1 : 2);
  order.sort((a, b) => rank(a.zone) - rank(b.zone));
  for (const o of order) out.push(...o.people);
  return out;
}
