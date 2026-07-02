import { spawnSync } from 'node:child_process';

const result = spawnSync('zip', [
  '-r', '../gemive.zip', '.',
  '-x', '*.DS_Store',
  '-x', '.git/*',
  '-x', 'node_modules/*',
  '-x', 'dist/*',
  '-x', 'build/*',
  '-x', 'coverage/*',
  '-x', '*.ts',
  '-x', 'tsconfig.json',
  '-x', 'types/*',
  '-x', '*.tsbuildinfo',
  '-x', 'gemive.zip'
], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'inherit'
});

process.exit(result.status ?? 1);