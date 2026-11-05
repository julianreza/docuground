import { expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('benchmark CLI rejects a mismatched instruction', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'docuground-benchmark-'));
  try {
    const gold = join(dir, 'gold.json');
    const report = join(dir, 'report.json');
    await writeFile(gold, JSON.stringify({sourceHash:'hash', instruction:'Extract Acme', purpose:'development', coverage:'partial', items:[{id:'a'}]}));
    await writeFile(report, JSON.stringify({sourceHash:'hash', instruction:'Extract Beta', mode:'live', status:'complete', items:[]}));
    const proc = Bun.spawn(['bun', 'scripts/benchmark.ts', gold, report], {stdout:'pipe', stderr:'pipe'});
    const stderr = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(1);
    expect(stderr).toContain('instruction does not match');
  } finally {
    await rm(dir, { recursive:true, force:true });
  }
});
