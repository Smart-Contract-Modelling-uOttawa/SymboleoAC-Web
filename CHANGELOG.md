# Changelog

All notable changes to SymboleoAC-Web are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/): the version applies to the whole
deliverable (front end, bridge, language-server jar and codegen jar together).

## [Unreleased]

### Added

- **Compare** ([#15](https://github.com/Smart-Contract-Modelling-uOttawa/SymboleoAC-Web/issues/15)):
  a baseline (a snapshot of the current text, or a file) can be
  compared with the contract being edited.
  - Side-by-side **text diff** in the editor slot (Monaco diff editor; the right-hand
    side is the live editor model, so editing continues with diagnostics and
    completion), toggled with the **Diff** button.
  - **Changes in meaning** at the top of the Explain tab: norms added, removed,
    renamed and changed, with the fact-sheet slots that differ (added and removed
    clauses, before/after values); declarations, domain types and access rules
    added, removed, renamed or changed; overview slots that differ. Renames are
    detected on the normalized model and applied before comparing, so renaming a
    role does not report every norm that mentions it as rewritten. Formatting and
    comment edits are neutral by construction.
  - Change badges on the norm blocks and inline marks in the fact sheet (added
    items highlighted, removed items struck through, "was: …" for scalar slots);
    **Copy change note** exports the changes as Markdown.
  - Outline markers (A / M / R, removed entries struck through) and editor gutter
    bars (green added, blue modified, red deleted lines) while a baseline is set.
  - A **Changes** toggle (off by default) in the Domain, Rules and Policy views:
    unchanged elements are dimmed to greys, added ones get a thick white outline,
    removed ones are drawn as dashed grey ghosts from the baseline, and labels carry
    a badge (+, ~, −, old → new); a changed permission reads old → new on its edge
    or in its cell. The category, Grant/Revoke and obligation/power colours are left
    untouched, so the views keep their meaning while the differences stand out.

### Planned

- Change note in the documentation export; side-by-side baseline/current diagrams ([#15](https://github.com/Smart-Contract-Modelling-uOttawa/SymboleoAC-Web/issues/15)).
- Executable tests generated from the Gherkin features ([#14](https://github.com/Smart-Contract-Modelling-uOttawa/SymboleoAC-Web/issues/14)).

## [1.0.0] — 2026-09-14

First public release. A browser IDE for SymboleoAC, backed by the same Xtext
engine as the Eclipse plugin, plus derived views, plain-language explanations,
and a documentation export. Live at
<https://smart-contract-modelling-uottawa.github.io/SymboleoAC-Web/>.

### Editor and language services

- Monaco editor connected over WebSocket to a per-session Xtext language server
  (LSP 3.17); live diagnostics from SymboleoAC's own validation rules, completion,
  and a code formatter (`Shift+Alt+F`).
- Signature help for obligation/power constructors, predicates, and
  `Math`/`String`/`Date` functions.
- Semantic highlighting: identifiers coloured by kind (types, enumeration values,
  attributes, parameters, roles/assets, events, obligations/powers, access rules),
  with a dedicated editor theme.
- Name-based navigation for identifiers the grammar does not cross-reference:
  Go to Definition (`F12`), Find References (`Shift+F12`), Hover (kind, declaration,
  specifier's comment), and Rename (`F2`, refusing keywords and clashes).
- Structured outline (Domain and Declarations by category, Obligations, Powers,
  AC Policy) with click-to-navigate.
- Open / Save / Save As with the File System Access API where available, a
  download fallback elsewhere; Share by URL with no server-side storage.
- Built-in examples: `MeatSale`, `VaccineProcurement`, the Incoterms 2020 `FOB`
  term, and a `Tutorial` contract with 22 commented mistakes to fix.

### Derived views

- Domain view: the domain model as a UML class diagram (inheritance, stereotypes,
  named associations), zoom and relayout, SVG export.
- Rules view: parties, obligations, powers and access rules as a network
  (green Grant / red Revoke), with rule details on hover.
- Policy view: the access-control policy as a roles × resources matrix, with
  CSV and HTML export.

### Explain tab

- Plain-language explanation of every obligation, surviving obligation and
  power, and of the contract as a whole, generated deterministically from a
  structured explanation model extracted by the language engine; no language
  model involved.
- Three styles: fact sheet, plain-English clause, and Gherkin (Feature / Rule /
  Scenario, Scenario Outline for disjunctive triggers, quoted identifiers) that
  parses with the reference `@cucumber/gherkin` parser; Brief / Full detail.
- Idioms that collapse repeated formal patterns (correlated identifiers, absence,
  ranges, same-verb alternatives, same event before several points, and others).
- Identifiers shown exactly as written and linked to their declaration;
  cross-norm hyperlinks; specifier's comments shown apart as "Specifier's note".
- Explanations shown only for specifications without validation errors.
- Exports: Copy / Save Markdown, Save `.feature`, and Documentation: one
  self-contained HTML file with the overview, both diagrams in two layouts, the
  policy matrix and rule list, the explanations in all three styles, and the
  specification coloured as in the editor with hyperlinked references.

### Code generation

- One-click JavaScript generation (`Symboleo2SC`, Hyperledger Fabric target) with
  a file tree, syntax-highlighted viewer, Copy, and Download .zip.
- Codegen fixes over the vendored upstream: obligation creation routed on the
  antecedent, event-relative deadlines (`Date.add` on an event's occurrence time),
  on-chain transfer transactions for transferable resources, generated code
  self-checked with `node --check`, and a fix for specifications without an
  `ACPolicy` section.
- Additional validator rules and clearer diagnostic messages in the vendored
  language.

### Infrastructure

- Node bridge (Express + ws) exposing `/lsp`, `/generate` and `/model`, with
  per-session JVMs, idle reaping, session and concurrency caps, rate limiting,
  body limits and CORS.
- Turnkey Docker Compose stack (bridge builds both jars from source; Caddy for
  automatic TLS) and a GitHub Pages workflow for the front end.
- Corpus tool (`tools/explain-corpus`) that rebuilds the thirteen-contract corpus
  and recomputes the verbalizer's coverage statistics.

### Upstream

- Vendors [SymboleoAC-IDE](https://github.com/Smart-Contract-Modelling-uOttawa/SymboleoAC-IDE)
  at commit `dec00792` with the local modifications listed in
  `upstream/UPSTREAM_PROVENANCE.md`.

[Unreleased]: https://github.com/Smart-Contract-Modelling-uOttawa/SymboleoAC-Web/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Smart-Contract-Modelling-uOttawa/SymboleoAC-Web/releases/tag/v1.0.0
