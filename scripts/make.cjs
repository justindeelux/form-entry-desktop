const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

function run(cli, args) {
  const result = spawnSync(process.execPath, [require.resolve(cli), ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const args = process.argv.slice(2);
run('@electron-forge/cli/dist/electron-forge.js', ['make', ...args]);
if (process.platform === 'win32') {
  run('electron-builder/cli.js', ['--win', 'nsis', '--x64', '--prepackaged', join('out', 'Form Entry Desktop-win32-x64'), '--config', 'electron-builder.yml', '--publish', 'never']);
}
