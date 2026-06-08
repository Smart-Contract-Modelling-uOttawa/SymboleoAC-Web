// Registers compact Monarch grammars for `javascript` and `json` so the
// generated-files viewer is colorized. We use Monarch (not the VS Code
// TextMate grammars) because Monarch is already proven to work in this
// monaco-vscode-api stack (the SymboleoAC editor uses it) and needs no extra
// @codingame/*-default-extension packages. Idempotent.
import * as monaco from '@codingame/monaco-vscode-editor-api';

let registered = false;

const jsKeywords = [
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if',
  'import', 'in', 'instanceof', 'new', 'return', 'super', 'switch', 'this', 'throw',
  'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'async',
  'await', 'of', 'get', 'set', 'null', 'undefined', 'true', 'false',
];

const javascriptMonarch: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.js',
  keywords: jsKeywords,
  // eslint-disable-next-line no-useless-escape
  symbols: /[=><!~?:&|+\-*\/\^%]+/,
  escapes: /\\(?:[abfnrtv\\"'`]|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4})/,
  tokenizer: {
    root: [
      [/[a-zA-Z_$][\w$]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
      { include: '@whitespace' },
      [/[{}()\[\]]/, '@brackets'],
      [/\d*\.\d+(?:[eE][\-+]?\d+)?/, 'number.float'],
      [/0[xX][0-9a-fA-F]+/, 'number.hex'],
      [/\d+/, 'number'],
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/'([^'\\]|\\.)*$/, 'string.invalid'],
      [/"/, { token: 'string.quote', bracket: '@open', next: '@dstring' }],
      [/'/, { token: 'string.quote', bracket: '@open', next: '@sstring' }],
      [/`/, { token: 'string.quote', bracket: '@open', next: '@template' }],
      [/@symbols/, { cases: { '@default': 'operator' } }],
      [/[;,.]/, 'delimiter'],
    ],
    whitespace: [
      [/[ \t\r\n]+/, ''],
      [/\/\*/, 'comment', '@comment'],
      [/\/\/.*$/, 'comment'],
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],
    dstring: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
    ],
    sstring: [
      [/[^\\']+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/'/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
    ],
    template: [
      [/[^\\`$]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\$\{/, { token: 'delimiter.bracket', next: '@root' }],
      [/`/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
    ],
  },
};

const jsonMonarch: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.json',
  tokenizer: {
    root: [
      [/"([^"\\]|\\.)*"(?=\s*:)/, 'type'],          // object keys
      [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
      [/-?\d+\.?\d*(?:[eE][\-+]?\d+)?/, 'number'],
      [/\b(?:true|false|null)\b/, 'keyword'],
      [/[{}\[\]]/, '@brackets'],
      [/[,:]/, 'delimiter'],
      [/\s+/, ''],
    ],
    string: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
    ],
  },
};

/** Register the viewer languages once. Safe to call repeatedly. */
export function ensureGeneratedFileLanguages(): void {
  if (registered) return;
  registered = true;
  const langs = new Set(monaco.languages.getLanguages().map((l) => l.id));
  if (!langs.has('javascript')) {
    monaco.languages.register({ id: 'javascript', extensions: ['.js', '.mjs', '.cjs'], aliases: ['JavaScript', 'js'] });
  }
  if (!langs.has('json')) {
    monaco.languages.register({ id: 'json', extensions: ['.json'], aliases: ['JSON', 'json'] });
  }
  monaco.languages.setMonarchTokensProvider('javascript', javascriptMonarch);
  monaco.languages.setMonarchTokensProvider('json', jsonMonarch);
}
