# Explain-corpus: coverage statistics of the plain-language verbalizer

Reproduces the coverage figures of the Explain tab's verbalizer over a corpus of
SymboleoAC contracts: the bundled examples plus the eleven Incoterms 2020 terms from
[SymboleoAC-Incoterms](https://github.com/Smart-Contract-Modelling-uOttawa/SymboleoAC-Incoterms)
(FOB is already bundled, so it is counted once).

```bash
bash tools/explain-corpus/build-corpus.sh
```

Prerequisites: `java`, the codegen jar (`cd codegen-cli && mvn -B clean package`), and the
bridge's Node dependencies (`cd bridge && npm ci`, for `tsx`). The script fetches the
Incoterms specifications into `specs/` (git-ignored) on first run; extra contracts can be
dropped there as `*.symboleo` files.

Outputs, in `out/` (git-ignored):

| File | Content |
|---|---|
| `corpus/*.json` | the `--model` output (structured model, explanation model, diagnostics) per contract |
| `corpus-stats.md` | per-contract table, idiom firings, and the rule table (construct, occurrences, phrasing) |
| `corpus-tables.tex` | the same as LaTeX (booktabs) tables |
| `vaccine-style-{a,b,c}.md` | the VaccineProcurement explanations in the three styles, via the tab's Markdown export |

Only contracts without validation errors are counted (the tutorial is excluded by design).
The "generic fallback" rows measure how often the verbalizer had to use the escape-hatch
phrasings (`<party> performs <event> (Type)`, "it is not the case that"); a non-zero count
points at event types missing from the verb lexicon in `web/src/explain/verbalize.ts`.
