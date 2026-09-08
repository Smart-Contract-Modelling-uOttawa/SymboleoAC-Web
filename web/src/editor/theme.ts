import type * as monacoNs from '@codingame/monaco-vscode-editor-api';

export const SYMBOLEOAC_THEME_ID = 'symboleoac-dark';

/**
 * Editor theme: vs-dark plus one distinct colour per kind of SymboleoAC element.
 *
 * Client-side (Monarch) tokens colour keywords, strings, numbers, comments and
 * operators as soon as the page loads; identifiers stay neutral. Once the
 * language server has parsed the contract, its semantic tokens (see
 * `SymboleoHighlightingCalculator` in language-server) colour every identifier
 * by what it is. Semantic token types reach the theme through VS Code's default
 * TextMate scopes, so each rule below names that scope.
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
    // Semantic tokens (LSP type -> default scope -> colour)
    { token: 'entity.name.type.class', foreground: SEMANTIC_COLOURS.type },          // class
    { token: 'entity.name.type.enum', foreground: SEMANTIC_COLOURS.type },           // enum
    { token: 'variable.other.enummember', foreground: SEMANTIC_COLOURS.enumMember }, // enumMember
    { token: 'variable.other.property', foreground: SEMANTIC_COLOURS.attribute },    // property
    { token: 'variable.parameter', foreground: SEMANTIC_COLOURS.parameter, fontStyle: 'italic' }, // parameter
    { token: 'variable.other.readwrite', foreground: SEMANTIC_COLOURS.instance },    // variable
    { token: 'entity.name.variable', foreground: SEMANTIC_COLOURS.instance },        // variable (alt. probe)
    { token: 'variable.other.event', foreground: SEMANTIC_COLOURS.event },           // event
    { token: 'entity.name.function', foreground: SEMANTIC_COLOURS.norm },            // function
    { token: 'entity.name.function.preprocessor', foreground: SEMANTIC_COLOURS.rule }, // macro
  ],
};

/** Register the theme and make it the active one. Safe to call more than once. */
export function applySymboleoacTheme(monaco: typeof monacoNs): void {
  monaco.editor.defineTheme(SYMBOLEOAC_THEME_ID, symboleoacTheme);
  monaco.editor.setTheme(SYMBOLEOAC_THEME_ID);
}
