// packages/core/src/lib/uiText.ts — the translator hole.
//
// The engine modules call tt('Front Desk') on every user-visible string. Upstream that reached a
// runtime i18n dictionary; here English IS the output and tt() only fills {holes}. The call sites
// stay identical, so a consumer that wants localisation replaces this one file (and gets the same
// English-as-key fallback for free).
export function tt(en: string, vars?: Record<string, string | number>): string {
  let out = en;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}
