import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const outputIndex = join(process.cwd(), 'web', 'out', 'index.html');

if (existsSync(outputIndex)) {
  process.exit(0);
}

console.log('web/out is missing; building the KoeScope static UI before start...');

const result = spawnSync('npm', ['run', 'web:build'], {
  cwd: process.cwd(),
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Failed to run npm run web:build: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
