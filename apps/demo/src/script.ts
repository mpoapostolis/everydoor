// apps/demo/src/script.ts — a story per building, so the rooms have a reason to exist.
//
// A composed interior does not need a script: `createInterior({ seed, archetype })` gives you a
// perfectly good building. But then the plan has nothing to arrange itself around, and every house
// is the same kind of house. A WorldScript changes that — the composer reads it (composer/story.ts)
// and the rooms that the cast, the key and the boss NAME are the rooms it plans, in the order the
// story is played, with the key room locked behind the door it opens.
//
// These are demo stories: one per archetype, short enough to read, specific enough that you can walk
// in and see the plan obeyed them. Swap in your own and the buildings change shape.
import type { WorldScript } from '@everydoor/core';

interface Sketch {
  title: string;
  cast: [name: string, role: string, place: string][];
  key: [name: string, place: string];
  boss?: [name: string, place: string];
  goal: string;
}

const SKETCHES: Record<string, Sketch> = {
  house: {
    title: 'The Cat Came Back',
    cast: [['Yiayia Rena', 'the grandmother', 'kitchen'], ['Petros', 'her grandson', 'living room']],
    key: ['attic key', "janitor's closet"],
    goal: 'Biscuit the cat is shut in the attic and nobody can find the key.',
  },
  shop: {
    title: 'Closing Time',
    cast: [['Mara', 'the baker', 'kitchen'], ['Kostas', 'the delivery boy', 'storefront']],
    key: ['till key', 'stockroom'],
    goal: 'The till will not open and the last tray of bread is still in the oven.',
  },
  school: {
    title: 'The Missing Trophy',
    cast: [['Miss Ada', 'the teacher', 'classroom'], ['Nikos', 'the caretaker', 'gym']],
    key: ['locker key', 'lockers'],
    boss: ['the Prank Club', 'old gym'],
    goal: 'The cup vanished the night before the match.',
  },
  office: {
    title: 'Late Shift',
    cast: [['Elena', 'the analyst', 'office'], ['Security Sam', 'the guard', 'reception']],
    key: ['pass card', 'server room'],
    goal: 'The quarterly file is on a machine nobody has the badge for.',
  },
  hospital: {
    title: 'Ward Four',
    cast: [['Nurse Temi', 'the night nurse', 'ward'], ['Dr Palis', 'the surgeon', 'surgery']],
    key: ['pharmacy key', 'pharmacy'],
    goal: 'A patient in the night ward needs a drug the pharmacy is locked around.',
  },
  prison: {
    title: 'Yard Rules',
    cast: [['Warden Kyr', 'the warden', "warden's office"], ['Old Tasos', 'the inmate', 'cell block a']],
    key: ['gate key', 'control room'],
    boss: ['the Bruiser', 'exercise yard'],
    goal: 'The gate key sits in the control room and the yard is not friendly.',
  },
  haunted: {
    title: 'Room 13',
    cast: [['The Concierge', 'the desk clerk', 'lobby'], ['Mira', 'the guest who never left', 'room 13']],
    key: ['brass key', 'boiler room'],
    boss: ['the Shade', 'ballroom'],
    goal: 'The hotel keeps its guests. One of them would like to leave.',
  },
  castle: {
    title: 'The Crown Beneath',
    cast: [['King Aldric', 'the king', 'throne room'], ['Bram', 'the cook', 'kitchen']],
    key: ['iron key', 'armoury'],
    boss: ['the Wyrm', 'the oubliette'],
    goal: 'The crown is in the vault and the vault is under the keep.',
  },
  dungeon: {
    title: 'Down the Long Stair',
    cast: [['Pell', 'the lost scout', 'guardroom']],
    key: ['rusted key', 'crypt'],
    boss: ['the Golem', 'treasury'],
    goal: 'Something walked out of the treasury and Pell walked in.',
  },
};

/** The demo story for an archetype, as a WorldScript. Unknown archetypes get a bare script — the
 *  plan still composes, it just has no plot to shape it. */
export function demoScript(archetype: string, seed = 0): WorldScript {
  const s = SKETCHES[archetype];
  if (!s) return { world: { archetype, seed } };
  return {
    world: { archetype, seed },
    title: s.title,
    story: { goal: s.goal },
    npcs: s.cast.map(([name, role, place], i) => ({
      id: `npc${i}`, name, role, place,
      dialogue: [`${s.goal}`, `Try the ${s.key[1]}.`],
      // the first character hands out the quest, so the chain starts where they stand
      ...(i === 0 ? { givesQuest: 'q1' } : {}),
    })),
    items: [{ id: 'key1', name: s.key[0], kind: 'key', place: s.key[1] }],
    enemies: s.boss ? [{ id: 'boss1', name: s.boss[0], bossPattern: 'charge', place: s.boss[1] }] : [],
    quests: [{ id: 'q1', title: s.title, desc: s.goal, objective: { type: 'collect', targetId: 'key1' }, turnIn: 'npc0', chainStep: 0 }],
    winItems: ['key1'],
  };
}

export const demoArchetypes = Object.keys(SKETCHES);
