import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./design-tokens.mjs', import.meta.url));
const root = dirname(dirname(script));

test('arquivos gerados estao em sincronia com docs/design/tokens.json', () => {
  const result = spawnSync(process.execPath, [script, '--check'], {
    cwd: root,
    encoding: 'utf8',
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(result.status, 0, `drift nos tokens gerados:\n${output}`);
});
