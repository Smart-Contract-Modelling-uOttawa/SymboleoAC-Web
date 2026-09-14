import * as monacoNs from '@codingame/monaco-vscode-editor-api';

export const SYMBOLEOAC_THEME_ID = 'symboleoac-dark';
const THEME_KEY = 'symboleoac.theme';

/**
 * Editor themes: a base (vs-dark or vs) plus one distinct colour per kind of
 * SymboleoAC element.
 *
 * Client-side (Monarch) tokens colour keywords, strings, numbers, comments and
 * operators as soon as the page loads; identifiers stay neutral. Once the
 * language server has parsed the contract, its semantic tokens (see
 * `SymboleoHighlightingCalculator` in language-server) colour every identifier
 * by what it is; the standalone theme service looks the token type name up in
 * the rules below (with modifiers appended, e.g. "event.declaration").
 *
 * Monaco's theme is global: the main editor, the diff view and the generated-code
 * viewer all share it, so no `monaco.editor.create(...)` may pass a `theme`
 * option; `applySymboleoacTheme` is the single place that sets it.
 */
export type SemanticPalette = {
  type: string;        // domain types, enumerations            (class, enum)
  enumMember: string;  // enumeration values                    (enumMember)
  attribute: string;   // attributes, also after "."            (property)
  parameter: string;   // contract parameters                   (parameter)
  instance: string;    // role / asset / data-transfer instances (variable)
  event: string;       // event instances                        (event)
  norm: string;        // obligations and powers                 (function)
  rule: string;        // access-control rules                   (macro)
};

/** Default palette; also used by the documentation export to colour the specification. */
export const SEMANTIC_COLOURS: SemanticPalette = {
  type: '4EC9B0', enumMember: '4FC1FF', attribute: '9CDCFE', parameter: 'D7BA7D',
  instance: 'FFB86C', event: 'FF79C6', norm: 'C3E88D', rule: 'F78C6C',
};

type Syntax = { keyword: string; control: string; predefined: string; identifier: string; number: string; string: string; comment: string; operator: string };
const DARK_SYNTAX: Syntax = { keyword: '569CD6', control: 'C586C0', predefined: 'DCDCAA', identifier: 'D4D4D4', number: 'B5CEA8', string: 'CE9178', comment: '6A9955', operator: 'D4D4D4' };
const LIGHT_SYNTAX: Syntax = { keyword: '0000FF', control: 'AF00DB', predefined: '795E26', identifier: '1E1E1E', number: '098658', string: 'A31515', comment: '008000', operator: '1E1E1E' };

function themeData(base: 'vs' | 'vs-dark', syntax: Syntax, sem: SemanticPalette | null): monacoNs.editor.IStandaloneThemeData {
  const s = sem ?? { type: syntax.identifier, enumMember: syntax.identifier, attribute: syntax.identifier, parameter: syntax.identifier, instance: syntax.identifier, event: syntax.identifier, norm: syntax.identifier, rule: syntax.identifier };
  return {
    base, inherit: true, colors: {},
    rules: [
      // Monarch (client-side) tokens
      { token: 'keyword', foreground: syntax.keyword },
      { token: 'keyword.control', foreground: syntax.control },
      { token: 'predefined', foreground: syntax.predefined },
      { token: 'identifier', foreground: syntax.identifier },
      { token: 'number', foreground: syntax.number },
      { token: 'string', foreground: syntax.string },
      { token: 'comment', foreground: syntax.comment },
      { token: 'operator', foreground: syntax.operator },
      { token: 'delimiter', foreground: syntax.operator },
      // Semantic tokens, named after the LSP token types (not TextMate scopes).
      { token: 'class', foreground: s.type },
      { token: 'enum', foreground: s.type },
      { token: 'enumMember', foreground: s.enumMember },
      { token: 'property', foreground: s.attribute },
      { token: 'parameter', foreground: s.parameter, fontStyle: sem ? 'italic' : '' },
      { token: 'variable', foreground: s.instance },
      { token: 'event', foreground: s.event },
      { token: 'function', foreground: s.norm },
      { token: 'macro', foreground: s.rule },
    ],
  };
}

export type ThemeChoice = { id: string; label: string; hint: string; data: monacoNs.editor.IStandaloneThemeData };

export const THEMES: ThemeChoice[] = [
  { id: SYMBOLEOAC_THEME_ID, label: 'SymboleoAC dark', hint: 'Default: dark editor, one distinct colour per kind of element (teal types, orange roles/assets, pink events, green norms, coral rules, light-blue attributes, gold parameters).',
    data: themeData('vs-dark', DARK_SYNTAX, SEMANTIC_COLOURS) },
  { id: 'symboleoac-vivid', label: 'SymboleoAC vivid', hint: 'Dark editor with brighter, higher-contrast element colours.',
    data: themeData('vs-dark', DARK_SYNTAX, { type: '2EE6C5', enumMember: '66D9FF', attribute: 'B8E6FF', parameter: 'FFD75E', instance: 'FFA347', event: 'FF5FC8', norm: 'B4FF5C', rule: 'FF6E4A' }) },
  { id: 'symboleoac-light', label: 'SymboleoAC light', hint: 'Light editor (the rest of the IDE stays dark) with the element colours adapted to a white background.',
    data: themeData('vs', LIGHT_SYNTAX, { type: '267F99', enumMember: '0070C1', attribute: '001080', parameter: '795E26', instance: 'B35900', event: 'AF00DB', norm: '3B7A00', rule: 'C72E2E' }) },
  { id: 'symboleoac-plain', label: 'Plain dark', hint: 'Dark editor with syntax colours only: identifiers are not coloured by kind.',
    data: themeData('vs-dark', DARK_SYNTAX, null) },
];

/** The theme the user picked (persisted), or the default. */
export function currentThemeId(): string {
  try { const id = localStorage.getItem(THEME_KEY); if (id && THEMES.some((t) => t.id === id)) return id; } catch { /* ignore */ }
  return SYMBOLEOAC_THEME_ID;
}

/** Register every theme (safe to call repeatedly). */
export function defineSymboleoacThemes(monaco: typeof monacoNs): void {
  for (const t of THEMES) monaco.editor.defineTheme(t.id, t.data);
}

/** Register the themes and make the selected one active. Safe to call more than once. */
export function applySymboleoacTheme(monaco: typeof monacoNs, id: string = currentThemeId()): void {
  defineSymboleoacThemes(monaco);
  monaco.editor.setTheme(id);
}

/** Persist a choice and apply it (also the way to re-apply the current theme). */
export function selectTheme(id: string): void {
  try { localStorage.setItem(THEME_KEY, id); } catch { /* ignore */ }
  applySymboleoacTheme(monacoNs, id);
}

/** Kept for callers that only need the default theme's data. */
export const symboleoacTheme = THEMES[0].data;
