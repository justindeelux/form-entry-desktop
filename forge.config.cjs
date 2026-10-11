module.exports = {
  packagerConfig: {
    icon: require('node:path').join(__dirname, 'assets/app-icon'),
    asar: { unpack: '**/node_modules/playwright-core/**' },
    appBundleId: 'local.form-entry.desktop',
    executableName: 'FormEntryDesktop',
    ignore: [/^\/src($|\/)/, /^\/tests($|\/)/, /^\/\.local-checks($|\/)/],
  },
  rebuildConfig: { onlyModules: ['better-sqlite3'] },
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'win32', 'linux'] },
  ],
  plugins: [{ name: '@electron-forge/plugin-auto-unpack-natives', config: {} }],
};
