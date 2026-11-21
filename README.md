# makefun-csv-reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/mikaelkarlmax/makefun-csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/mikaelkarlmax/makefun-csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A dependency-free CSV reader that returns csv-reader 1.0.0's exact answer — `{columns, rows, errors}`, broken rows and all — in a fraction of the CPU time. `solve.js` exports `run({text, header})`; `main.ts` is the harness driver that reads `/input/cases.json` and writes `/output/answers.json`.

## How it is faster

The reference reader builds every field character by character. This one never concatenates a field's characters at all:

- **Plain fields** are scanned by one tight character loop that only inspects, then taken as a single `slice` — a stray CR (dropped, reported `stray_cr`) is the only thing that splits a field into more than one slice.
- **Quoted fields** are assembled from the slices between their quotes, located with `String#indexOf`; CR/CRLF normalisation is applied per slice, with a character loop only for slices that actually contain a CR, and the common single-slice field skips the chunk array and join entirely.
- Every scan is bounded by the characters it consumes, so no input shape — a text with no CRs, no LFs, no commas, or nothing but unclosed quotes — can turn the walk quadratic.
- All of the reference's broken-row policy is reproduced exactly, in its order: `stray_cr`, `quote_junk`, `unterminated_quote` (the quote becomes a literal and the text is re-read unquoted), `short_row` / `long_row`, and each error's record-start line and row index.

Correctness was checked differentially against the reference itself: the kit's practice set (6/6 identical), 52,000 seeded fuzz inputs of deliberately broken CSV, and 158 hand-picked pathological inputs — zero mismatches. On the practice set (10.2M characters over 6 cases) the parse itself runs at a median of 0.130s against the reference's 0.466s (**~3.6×**), and the whole program end to end at ~0.73s against ~1.52s (**~2.1×**), on this machine.

## Run it

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=q8z3gt64&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
