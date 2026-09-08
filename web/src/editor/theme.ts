import type * as monacoNs from '@codingame/monaco-vscode-editor-api';

export const SYMBOLEOAC_THEME_ID = 'symboleoac-dark';

/**
 * Editor theme: vs-dark plus one distinct colour per kind of SymboleoAC element.
 *
 * Client-side (Monarch) tokens colour keywords, strings, numbers, comments and
 * operators as soon as the page loads; identifiers stay neutral. Once the
 * language server has parsed the contract, its semantic tokens (see
 * `SymboleoHighlightingCalculator` in language-server) colour every identifier
 * by what it is; the standalone theme service looks the token type name up in
 * the rules below (with modifiers appended, e.g. "event.declaration").
 */
export const SEMANTIC_COLOURS = {
  type: '4EC9B0',        // domain types, enumerations            (class, enum)
  enumMember: '4FC1FF',  // enumeration values                    (enumMember)
  attribute: '9CDCFE',   // attributes, also after "."            (property)
  parameter: 'D7BA7D',   // contract parameters                   (parameter)
  instance: 'FFB86C',    // role / asset / data-transfer instances (variable)
  event: 'FF79C6',       // event instances                        (event)
  norm: 'C3E88D',        // obligations and powers                 (function)
  rule: 'F78C6C',        // access-control rules                   (macro)
} as const;

export const symboleoacTheme: monacoNs.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  colors: {},
  rules: [
    // Monarch (client-side) tokens
    { token: 'keyword', foreground: '569CD6' },
    { token: 'keyword.control', foreground: 'C586C0' },
    { token: 'predefined', foreground: 'DCDCAA' },
    { token: 'identifier', foreground: 'D4D4D4' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'comment', foreground: '6A9955' },
    { token: 'operator', foreground: 'D4D4D4' },
    { token: 'delimiter', foreground: 'D4D4D4' },
    // Semantic tokens. Monaco's standalone theme service matches a semantic token by
    // its type name plus modifiers ("event", "event.declaration", ...), so the rules
    // are named after the LSP token types, not after TextMate scopes.
    { token: 'class', foreground: SEMANTIC_COLOURS.type },
    { token: 'enum', foreground: SEMANTIC_COLOURS.type },
    { token: 'enumMember', foreground: SEMANTIC_COLOURS.enumMember },
    { token: 'property', foreground: SEMANTIC_COLOURS.attribute },
    { token: 'parameter', foreground: SEMANTIC_COLOURS.parameter, fontStyle: 'italic' },
    { token: 'variable', foreground: SEMANTIC_COLOURS.instance },
    { token: 'event', foreground: SEMANTIC_COLOURS.event },
    { token: 'function', foreground: SEMANTIC_COLOURS.norm },
    { token: 'macro', foreground: SEMANTIC_COLOURS.rule },
  ],
};

/** Register the theme and make it the active one. Safe to call more than once. */
export function applySymboleoacTheme(monaco: typeof monacoNs): void {
  monaco.editor.defineTheme(SYMBOLEOAC_THEME_ID, symboleoacTheme);
  monaco.editor.setTheme(SYMBOLEOAC_THEME_ID);
}
