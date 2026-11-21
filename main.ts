// The driver the harness runs (Node 22, `node /bot/main.ts`): read every case from
// cases.json in the input directory, answer each one with run() from ./solve.js, and
// write the answers, in the cases' order, to answers.json in the output directory.
// Outside the sandbox, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input
// and /output so the same program can be graded and timed locally.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Match the house baseline's runtime tuning: V8's incremental marking off, set before
// solve.js is loaded so every parse in this process runs under it.
setFlagsFromString('--no-incremental-marking');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: { text: unknown; header: unknown }) => unknown;
};

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as Array<{
  id: string;
  input: { text: unknown; header: unknown };
}>;

const answers: unknown[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) answers[i] = run(cases[i].input);

writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
