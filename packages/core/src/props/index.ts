// src/engine/props/index.ts — the library's public surface. Importing this registers every family.
import './families/index';
export * from './types';
export { VOX, buildGeo, flattenOps, propBounds } from './voxel';
export { STYLES, DEFAULT_STYLE, styleIds, styleOf } from './styles';
export { registerProps, propDef, propIds, allProps, propsOfFamily, buildProp, librarySize, disposeLibrary, propMesh, PROP_MATERIALS, propMeta, propsWithTag } from './library';
