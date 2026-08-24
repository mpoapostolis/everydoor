// src/engine/props/families/index.ts — registration order = catalogue order (docs §5.2 build order).
// Each family lives in ITS OWN file (one owner per file when authored in parallel).
import { registerProps } from '../library';
import { CORE } from './core';
import { HOME } from './home';
import { KITCHEN } from './kitchen';
import { SCHOOL } from './school';
import { SHOP } from './shop';
import { OBBY } from './obby';
import { NATURE } from './nature';
import { STRUCTURE } from './structure';
import { MEDICAL } from './medical';
import { PRISON } from './prison';
import { OFFICE } from './office';
import { VIGNETTES } from './vignettes';
import { CASTLE } from './castle';
import { SPOOKY } from './spooky';

registerProps([...CORE, ...HOME, ...KITCHEN, ...SCHOOL, ...SHOP, ...OBBY, ...NATURE, ...STRUCTURE, ...MEDICAL, ...PRISON, ...OFFICE, ...VIGNETTES, ...CASTLE, ...SPOOKY]);
