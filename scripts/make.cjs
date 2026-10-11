const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');

function run(cli, args) {
  const result = spawnSync(process.execPath, [require.resolve(cli), ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const args = process.argv.slice(2);
run('@electron-forge/cli/dist/electron-forge.js', ['make', ...args]);
if (process.platform === 'win32') {
  const packaged = join('out', 'Form Entry Desktop-win32-x64');
  const { name, repository } = require('../package.json');
  const [owner, repo] = new URL(repository.url).pathname.replace(/\.git$/, '').split('/').filter(Boolean);
  // Builder skips its afterPack hook when reusing Forge's package.
  writeFileSync(join(packaged, 'resources', 'app-update.yml'), JSON.stringify({ provider: 'github', owner, repo, updaterCacheDirName: `${name}-updater` }));
  run('electron-builder/cli.js', ['--win', 'nsis', '--x64', '--prepackaged', packaged, '--config', 'electron-builder.yml', '--publish', 'never']);
}
