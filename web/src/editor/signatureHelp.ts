import type * as monaco from '@codingame/monaco-vscode-editor-api';

// ── Signature table ──────────────────────────────────────────────────────────
// Mirrors the callable built-ins in Symboleo.xtext. name → ordered params.
// 1:1 by name (the grammar gives each name one arity), so a flat map is enough.
// Extend freely; this is the high-value subset.
type Param = { label: string; doc?: string };
type Sig = { params: Param[]; doc?: string };

const TABLE: Record<string, Sig> = {
  // Norm constructors — the headline case
  O:          { doc: 'Obligation', params: [
    { label: 'debtor' }, { label: 'creditor' },
    { label: 'antecedent' }, { label: 'consequent' } ] },
  Obligation: { doc: 'Obligation', params: [
    { label: 'debtor' }, { label: 'creditor' },
    { label: 'antecedent' }, { label: 'consequent' } ] },
  P:          { doc: 'Power', params: [
    { label: 'creditor' }, { label: 'debtor' },
    { label: 'antecedent' }, { label: 'consequent' } ] },
  Power:      { doc: 'Power', params: [
    { label: 'creditor' }, { label: 'debtor' },
    { label: 'antecedent' }, { label: 'consequent' } ] },

  // Predicate functions
  Happens:          { params: [{ label: 'event' }] },
  WhappensBefore:   { params: [{ label: 'event' }, { label: 'point' }] },
  ShappensBefore:   { params: [{ label: 'event' }, { label: 'point' }] },
  HappensWithin:    { params: [{ label: 'event' }, { label: 'interval' }] },
  WhappensBeforeE:  { params: [{ label: 'event1' }, { label: 'event2' }] },
  ShappensBeforeE:  { params: [{ label: 'event1' }, { label: 'event2' }] },
  HappensAfter:     { params: [{ label: 'event' }, { label: 'point' }] },
  Occurs:           { params: [{ label: 'situation' }, { label: 'interval' }] },
  IsEqual:          { params: [{ label: 'arg1' }, { label: 'arg2' }] },
  IsOwner:          { params: [{ label: 'arg1' }, { label: 'arg2' }] },
  CannotBeAssigned: { params: [{ label: 'arg' }] },

  // Math / String / Date
  'Math.pow':         { params: [{ label: 'a' }, { label: 'b' }] },
  'Math.max':         { params: [{ label: 'a' }, { label: 'b' }] },
  'Math.min':         { params: [{ label: 'a' }, { label: 'b' }] },
  'String.substring': { params: [{ label: 'str' }, { label: 'start' }, { label: 'end' }] },
  'String.replaceAll':{ params: [{ label: 'str' }, { label: 'target' }, { label: 'replacement' }] },
  'String.concat':    { params: [{ label: 'a' }, { label: 'b' }] },
  'Date.add':         { params: [{ label: 'point' }, { label: 'value' }, { label: 'timeUnit' }] },
  Interval:           { params: [{ label: 'start' }, { label: 'end' }] },
};

const signatureLabel = (name: string, sig: Sig) =>
  `${name}(${sig.params.map((p) => p.label).join(', ')})`;

// ── Locate the active call ───────────────────────────────────────────────────
// Forward-scan the text before the cursor, tracking a stack of open calls and
// skipping string literals. The innermost still-open call is the active one,
// and its argIndex (commas seen at that depth) is the active parameter.
function identBefore(s: string, openParen: number): string {
  let i = openParen - 1;
  while (i >= 0 && /\s/.test(s[i])) i--;
  const end = i + 1;
  while (i >= 0 && /[A-Za-z0-9_.]/.test(s[i])) i--;
  return s.slice(i + 1, end);
}

function locateCall(prefix: string): { name: string; arg: number } | null {
  const stack: { name: string; arg: number }[] = [];
  for (let i = 0; i < prefix.length; i++) {
    const c = prefix[i];
    if (c === '"') {                       // skip a string literal
      for (i++; i < prefix.length && prefix[i] !== '"'; i++) if (prefix[i] === '\\') i++;
      continue;
    }
    if (c === '(') stack.push({ name: identBefore(prefix, i), arg: 0 });
    else if (c === ')') stack.pop();
    else if (c === ',' && stack.length) stack[stack.length - 1].arg++;
  }
  return stack.length ? stack[stack.length - 1] : null;
}

// ── Provider ─────────────────────────────────────────────────────────────────
/**
 * Register a client-side signature-help provider for SymboleoAC's built-in
 * callables (norm constructors, predicate/Math/String/Date functions). Pure
 * front end — independent of the language server; works even with no backend.
 * Returns the IDisposable so the caller can unregister it if needed.
 */
export function registerSymboleoacSignatureHelp(
  m: typeof monaco,
  languageId: string,
): monaco.IDisposable {
  return m.languages.registerSignatureHelpProvider(languageId, {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [',', ')'],
    provideSignatureHelp(model, position) {
      const prefix = model.getValueInRange({
        startLineNumber: 1, startColumn: 1,
        endLineNumber: position.lineNumber, endColumn: position.column,
      });
      const call = locateCall(prefix);
      const sig = call && TABLE[call.name];
      if (!call || !sig) return null;

      const signature: monaco.languages.SignatureInformation = {
        label: signatureLabel(call.name, sig),
        documentation: sig.doc,
        parameters: sig.params.map((p) => ({ label: p.label, documentation: p.doc })),
      };
      return {
        value: {
          signatures: [signature],
          activeSignature: 0,
          activeParameter: Math.min(call.arg, sig.params.length - 1),
        },
        dispose() {},
      };
    },
  });
}
