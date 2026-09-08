# "Explain" tab — plan for plain-language explanations of a SymboleoAC contract

Companion to `symboleoac-web-BUILD-PLAN.md` and `CLAUDE.md`. Goal: a new right-hand tab
in the web IDE that gives **laypeople** (lawyers, procurement officers, students) a succinct
but *precise* description of (1) every obligation, surviving obligation and power, and
(2) the contract as a whole — derived from the whole specification, not just the norm text.

Worked examples of the candidate styles are in `docs/explain-styles.html` (also published
as an artifact) using `VaccineProcurement.symboleo`.

---

## 1. Design principles

1. **Faithful by construction.** Explanations are generated deterministically from the
   Xtext AST by a rule-based *verbalizer*. No LLM in the loop by default. Every sentence
   maps back to a construct, and every identifier in the explanation is clickable
   (jumps to the source line, as the Outline does), and every mention of another
   obligation or power is a hyperlink to that norm's explanation, in every style.
2. **Exploit the whole spec.** Every section contributes something (see §3): domain types
   supply *what kind of thing* an identifier is and who performs it; the contract signature
   says what is fixed at instantiation; declarations bind event instances to parties;
   preconditions/postconditions/constraints frame the contract; ACPolicy rules are
   attached to the norms whose resources they touch; cross-references between norms give
   "depends on / feeds into" links.
3. **Structure first, prose second.** Java produces a *structured explanation model*
   (an intermediate representation, IR); TypeScript renders it in one of several styles.
   Styles and wording iterate without touching the JVM.
4. **Only for error-free specifications.** The extractor still runs best-effort (so the
   rest of `--model` keeps working while editing), but it reports `hasErrors`, and the tab
   shows the explanation only when the specification has no validation errors. Warnings
   are tolerated and listed. With errors, the tab says so and points to Diagnostics.
5. **Never hide semantics.** Lay wording must not soften the formal meaning: an antecedent
   is "becomes binding when", a consequent is "must bring about", violation is stated,
   `Shappens`/`Whappens` become "strictly before" / "on or before", a `true` antecedent
   is "immediately".

---

## 2. Architecture

```
web/src/explain/types.ts             TypeScript shape of the `explain` block
web/src/explain/verbalize.ts         IR -> phrase fragments (idioms, humanized names, slots)
web/src/explain/ExplainView.tsx      tab: style switcher (A/B/C), Brief/Full, overview, the three renderers
web/src/explain/markdown.ts          Markdown export; shared slot->rows logic for styles B and C
web/src/explain/document.ts          E5: self-contained HTML documentation (diagrams, matrix, explanations, source)
codegen-cli/.../ExplainJson.java     IR extraction, hooked into the existing --model output
bridge/test-explain.mjs              smoke test of /model's explain + diagnostics blocks
bridge                                no code change (IR travels in the /model response)
```

**Why IR-in-Java + rendering-in-TS.** `/model` already spawns a JVM per edit; a second
endpoint would double that. `ModelJson` already resolves types, positions and controllers,
so the IR is an extension of it (new top-level key `explain`). Rendering in TS makes
style switching instant and keeps wording out of the compiled jar.

**IR sketch** (per norm; `ref` objects carry `{name, line, col}` for navigation):

```jsonc
{
  "kind": "obligation" | "survivingObligation" | "power",
  "name": "oDeliver", "line": 89, "col": 2,
  "authorNote": "A delivery obligation is achieved if ...",   // // comment(s) right above the norm
  "debtor":  { "var": "pfizer", "type": "Manufacturer", "thirdParty": false, "fromParam": "pfizerP" },
  "creditor":{ "var": "mcdc",   "type": "Government",   "thirdParty": false, "fromParam": "mcdcP" },
  "controller": { "var": "regulator", "type": "Regulator", "thirdParty": true },   // or null
  "trigger":    "<Prop> | null",
  "antecedent": "<Prop>",           // {"lit": true} when unconditional
  "consequent": "<Prop>",           // powers: {"effect": "Terminated", "target": "self" | norm ref}
  "deadlines":  [ { "event": "paid", "before": "strict", "anchor": "invoiced.date", "offset": 30, "unit": "days" } ],
  "dependsOn":  [ "oAgreedOnRequest" ],   // norms referenced via Fulfilled(obligations.X) etc.
  "feeds":      [ "oAssign", "oPay", "oRequestVaccineDosage" ],  // norms that reference this one
  "touches":    [ "vaccineDose.FDAapproval", "delivered", "temperature" ],  // resources read
  "assigns":    [ { "target": "remain.value", "expr": "<Expr>" } ],
  "acRules":    [ "Rule1", "Rule2", "Rule3", "Rule4" ]   // rules whose resource is in touches/assigns
}
```

`<Prop>` is a small JSON AST mirroring the grammar's `Proposition` (and/or/not, comparisons,
`Happens`, `ShappensBefore`, `HappensWithin`, `Date.add`, obligation/power/contract events,
`HappensAssign`/`Assign`). Each event reference is *resolved*: variable -> declared type ->
ontology category (Event / DataTransfer / Asset), performer, controller, `Env` attributes.

**Contract-level IR**: parties split into signatories vs third parties (from the `thirdParty`
flag on the role type), parameters grouped (roles vs values), time granularity,
preconditions/postconditions/constraints as `<Prop>`, AC controllers, norm counts,
termination paths (powers whose effect is `Terminated(self)`), sensors (DataTransfer
variables), and *observations* derivable from the model (e.g. "`admin` is declared but
referenced by no norm or rule").

---

## 3. What each spec section contributes to the text

| Section | Used for |
|---|---|
| Domain | identifier gloss ("`requested` is a *Requested* event, performed by the Government"); `thirdParty` -> "third party, not a signatory"; `Env` attributes -> "data supplied by the environment"; `Asset` owner; `DataTransfer` -> "sensor / data feed"; enumerations -> readable values (`Location(Ottawa)`). |
| TimeGranularity | default unit when phrasing deadlines. |
| Contract signature | "fixed when the contract is instantiated: unit price, min/max quantity, FDA approval flag"; maps role parameters to declared parties (`pfizer` <- `pfizerP`). |
| Declarations | performer/controller of each event instance (who *does* the thing); initial asset values (`remain.value := maxQuantity` -> "starts at the maximum quantity"); sensor thresholds from `Alert` attributes ("temperature alert: value > -80, 5 readings in 10"). |
| Preconditions | "The contract can only come into force if ...". |
| Postconditions | "When the contract ends, the following must hold ...". |
| Obligations / Surviving | the per-norm explanations; surviving -> "remains enforceable after the contract ends". |
| Powers | "may ... / gains the right to ..."; effect verbalized from `PowerFunction` (terminate contract, suspend/resume/discharge obligation X). |
| ACPolicy | per-norm "Access" line: rules whose resource is one the norm reads or writes; contract-level "who controls access" (AC controllers); per-norm `with Controller` -> "the regulator administers access to this obligation". |
| Constraints | "Throughout the contract: ...". |
| `//` comments | optional "Author's note" (hidden leaf nodes preceding the norm). Displayed as a quote, clearly separated from the generated text. |

---

## 4. Verbalization rules (core idioms)

Fragment rules (TS, `verbalize.ts`), applied to `<Prop>`:

| Construct | Phrase |
|---|---|
| `Happens(e)` (variable event) | "*performer* *verbs* (`e`)" using the event type name, e.g. "the Government submits a request (`requested`)". The verb comes from a small lexicon keyed on the type name (*Requested* -> "submits a request"); fallback: "the `Requested` event occurs, performed by the Government". |
| `Happens(Fulfilled(obligations.X))` | "obligation `X` has been fulfilled" (likewise Violated, Terminated, Suspended...). |
| `Terminated(self)` etc. | "the contract is terminated". |
| `ShappensBefore(e, p)` / `WhappensBefore` | "`e` happens strictly before / on or before `p`". |
| `HappensWithin(e, Interval(a,b))` | "`e` happens between `a` and `b`". |
| `Date.add(x, n, u)` | "*n u* after *x*" -> "30 days after the invoice date". |
| `a.attr == b.attr` (same attr, two events) | correlation idiom, collected and emitted once: "all of these refer to the same request (`reqID`)". |
| `not Happens(e) or e.k != f.k` | "no `e` is raised for this *k*" (the vaccine sample's cold-chain pattern). Emitted once as a list: "no temperature, seal-opening, humidity, shock or light-exposure alert for this request". |
| `x.v >= lo and x.v <= hi` | "*x.v* is between *lo* and *hi*". |
| `HappensAssign(ev, t := e)` / `Assign` | "when `ev` occurs, *t* is set to *e*", arithmetic verbalized ("reduced by the delivered dosage", "dosage x unit price"). |
| `true` antecedent | "immediately (no further condition)". |
| no trigger | "in force from the start of the contract". |
| `and` | bullet list (cards) / "; and" (prose). `or` -> "either ... or ...". `not` -> "it is not the case that" only when no idiom applies. |

Identifiers are never humanized: they appear exactly as written, in code font, and jump
to the source. The declared type follows in parentheses where it adds information
(`leadtimeINform` (LeadtimeInformedNegotiated)); a small lexicon supplies verbs for known
event types (`Requested` -> "submits a request"), otherwise "`pfizer` performs `x` (Type)".

Obligation template (all styles share these slots):
**who owes -> to whom · created when (trigger) · becomes binding when (antecedent) · must
bring about (consequent) · deadline (if derivable) · otherwise (violation) · overseen by
(controller) · depends on / feeds · access rules.**

Power template: **who holds it -> over whom · arises when (trigger) · can be exercised when
(antecedent) · effect (consequent) · overseen by.**

---

## 5. Candidate styles (see `docs/explain-styles.html`)

| | A · Fact sheet | B · Plain-English clause | C · If / then / otherwise |
|---|---|---|---|
| Form | labelled fields, bullets | one paragraph per norm | conditional rule block |
| Best for | scanning, auditing, checking completeness | first reading, non-technical stakeholders, printed handouts | analysts, students learning the O/P semantics |
| Precision | highest (every slot visible, empty slots shown as "none") | good, but long conjunctions get heavy | high; mirrors trigger/antecedent/consequent 1:1 |
| Length (oDeliver) | ~12 lines | ~7 lines | ~10 lines |
| Risk | reads like a form | ambiguity when many "and"s | jargon creep ("antecedent") |

Contract-level: **Overview** (parties, what is fixed, precondition, how it can end, what
survives, who controls access, sensors) is the same across styles; a second variant,
**Lifecycle walkthrough**, narrates the normal flow request -> agreement -> notice -> confirm ->
deliver -> account -> invoice -> pay (derived from the `dependsOn` graph, topologically
ordered).

Decision: ship all three, **A as default**, selectable with a segmented control (choice
remembered in the browser). In every style, references to other obligations and powers
are hyperlinks to the corresponding explanation block; identifiers link to the source.

---

## 6. Milestones

Status (2026-09-07): **E1–E5 are implemented.** E5 (`web/src/explain/document.ts`): the
"Documentation" / "Save documentation…" buttons in the Explain tab build one self-contained
HTML file (no external resources) with a contents bar, the contract overview, the domain
class diagram and the parties/norms/rules diagram (Mermaid rendered to inline SVG at export
time), the access-control matrix plus rule list, the explanations in all three styles with the
Brief/Full toggle (client-side switching), and the specification source with line anchors;
identifiers jump to their declaration line, norm names to their block. Prints cleanly.
Refinements after review: both diagrams embed a left-to-right and a top-to-bottom layout
(per-figure toggle, plus Fit width / Actual size; the default is the layout closer to the
page's aspect ratio); the page is 1500px wide with prose kept at ~70 characters; the
specification is rendered single-spaced with the editor's Monarch token classes and dark
theme colours (`highlightSpec`), and every identifier occurrence is a link to its
declaration line.

Style C was later replaced by a **Gherkin** rendering (`web/src/explain/gherkin.ts`): one
`Rule` per norm with fulfilled/violated/exercised scenarios, Scenario Outlines for same-kind
disjunctive triggers, quoted identifiers; exported as `.feature` and verified against the
reference parser by `tools/explain-corpus` (13 contracts, 447 scenarios, all parse).

Earlier: **E1–E4 are implemented.** E3 adds the lifecycle walkthrough
("Normal course", obligations in dependency order), the Brief/Full toggle and Markdown
copy/save. E4 ran the idiom audit over all 40 local specifications (7 error-free): every
event type met in them has a verb in the lexicon, `IsEqual`/`IsOwner`/`CannotBeAssigned`
and negated comparisons are phrased, and "Before(e, p1) or Before(e, p2)" merges into one
clause; no generic fallback remains on the corpus. Slot labels carry glossary tooltips.
Naming decision: identifiers are always shown exactly as written (`mcdc`, `delivered.delAddr`);
no humanized names, the declared type is added in parentheses only where it informs
(parties in the overview, "Who owes" rows, events without a lexicon verb).

Earlier status: **E1 and E2 are implemented.** `ExplainJson.java` ships in the codegen
CLI (`--model` output now carries `explain` and `diagnostics`); the web tab "Explain" renders
styles A/B/C with a persisted selector, cross-norm hyperlinks, click-to-source and the
error gate. `bridge/test-explain.mjs` checks the four bundled samples against a running bridge.

| # | Deliverable | Verify |
|---|---|---|
| E1 | `ExplainJson.java`: IR for norms + contract, hooked into `--model`; resolves events, deadlines, dependsOn/feeds, touches->acRules, author notes | golden JSON for Vaccine, FOB, Tutorial samples under `codegen-cli/src/test/resources`; a `bridge/test-model.mjs` assertion that `explain` is present |
| E2 | `verbalize.ts` + Styles A, B, C with selector + new tab "Explain" in `App.tsx`; contract Overview; cross-norm hyperlinks; click-to-source; error gate; empty/invalid states | manual check on the four samples; no raw-formula fallbacks on VaccineProcurement |
| E3 | Lifecycle walkthrough, Brief/Full toggle, "Copy as Markdown" | Markdown export round-trips |
| E4 | Idiom pass driven by the 11 Incoterms specs (collect constructs the idioms miss; add rules); glossary tooltips | zero raw-formula fallbacks on the samples, or each fallback justified |
| E5 | **Integrated documentation**: one document combining the Domain class diagram, the Policy matrix and the explanations (all styles switchable), downloadable as a single self-contained interactive HTML file (inline SVG/CSS/JS, no network) | open the downloaded file offline; switch styles; follow cross-norm links |
| E6 | Optional LLM "polish" behind a flag (deterministic text stays the source of truth, output labelled) | - |

---

## 7. Open questions

- Verb lexicon for event types (Requested -> "submits a request"): hand-written map with
  fallback, or let authors add a `// @verb` comment? Start with the fallback + a small
  map for the sample corpus; measure how often the fallback fires (E4).
- `with Controller X` on a norm: describe as "administers access to" (the AC meaning), not
  "oversees"; confirm against the SymboleoAC semantics before fixing the wording.
- `Env` attributes: mention "provided by the environment/oracle" in Full mode only.
- Should "observations" (unused declarations, roles never a debtor/creditor) live in this
  tab or in Diagnostics? Proposal: Overview footer, marked "Observations", not errors.
