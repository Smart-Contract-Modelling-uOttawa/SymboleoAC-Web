#!/usr/bin/env bash
# Rebuild the explanation-model corpus and the coverage statistics of the Explain tab's
# verbalizer, and regenerate the Markdown/LaTeX tables and the VaccineProcurement
# explanations in all three styles.
#
# Usage (from the repository root, Git Bash or Linux):
#   bash tools/explain-corpus/build-corpus.sh
# Requires: java, node (with the bridge's node_modules installed: `cd bridge && npm ci`),
# the codegen jar (`cd codegen-cli && mvn -B clean package`), and network access to fetch
# the Incoterms 2020 specifications from SymboleoAC-Incoterms.
#
# Corpus = the bundled examples (web/public/*.symboleo) + the ten Incoterms terms not
# already bundled (FOB is). Extra contracts: drop *.symboleo files into
# tools/explain-corpus/specs/ (git-ignored). Output: tools/explain-corpus/out/.
set -e
cd "$(dirname "$0")/../.."
HERE=tools/explain-corpus
OUT=$HERE/out; CORPUS=$OUT/corpus; SPECS=$HERE/specs
mkdir -p "$CORPUS" "$SPECS"; rm -f "$CORPUS"/*.json
JAR=codegen-cli/target/symboleoac-codegen-cli-1.0.0-all.jar
[ -f "$JAR" ] || { echo "missing $JAR — build it with: cd codegen-cli && mvn -B clean package"; exit 1; }

INCOTERMS_RAW=https://raw.githubusercontent.com/Smart-Contract-Modelling-uOttawa/SymboleoAC-Incoterms/main/specs
for t in CFR CIF CIP CPT DAP DDP DPU EXW FAS FCA FOB; do
  [ -f "$SPECS/$t.symboleo" ] || curl -sSfL -o "$SPECS/$t.symboleo" "$INCOTERMS_RAW/$t.symboleo" || echo "could not fetch $t"
done

run() { local f="$1" n="$2"; java -jar "$JAR" --model --in "$f" > "$CORPUS/$n.json" 2>/dev/null || echo "FAILED $f"; }
for f in web/public/*.symboleo; do run "$f" "$(basename "${f%.symboleo}")"; done
for f in "$SPECS"/*.symboleo; do
  [ -f "$f" ] || continue
  b="$(basename "${f%.symboleo}")"
  [ -f "web/public/$b.symboleo" ] && { echo "skip $b (bundled sample)"; continue; }
  run "$f" "$b"
done
echo "$(ls "$CORPUS" | wc -l) models in $CORPUS"
( cd bridge && npx tsx ../tools/explain-corpus/stats.ts > /dev/null ) \
  && echo "wrote $OUT/corpus-stats.md, corpus-tables.tex, vaccine-style-{a,b,c}.md"
