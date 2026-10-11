# Form Entry Desktop

A local desktop app that reads a Google Sheets tab and submits its rows to a Google Form. Built with Electron, TypeScript, React, Mantine, React Flow, Playwright, and SQLite. The interface is in Vietnamese.

## Usage

1. Open the desired Sheets tab and copy its full URL, including `gid`.
2. Paste the Sheets URL and Form URL into the app. Enable Google login only when needed, then load the data.
3. Map columns to Form fields and optionally set defaults or formatting.
4. Submit the rows, or schedule submissions while the app is open.

Google Chrome must be installed. Row 1 is the header; blank rows are skipped. Only single-page Forms are supported. Sheets input is limited to 10 MB, 200 columns, and 10,000 data rows. No Google API key is required.

Configuration, the private Chrome profile, and submission history are stored locally. **Settings → Xóa profile** resets all app data, including sent history and duplicate protection. Google Form responses remain, so previously sent rows can be submitted again.

## Development

Requires Node.js 24, npm, and Google Chrome.

```sh
npm ci
npm start
```

```sh
npm run typecheck
npm test
npm run build
```

## Build

Build on the target operating system:

```sh
npm run package
npm run make
```

For Windows x64, run on Windows:

```sh
npm run make -- --platform=win32 --arch=x64
```

Packaged apps are in `out/`. Windows installers are in `out/make/nsis/`; run `FormEntryDesktop-Setup-<version>.exe` to install. The wizard shows an introduction, lets you choose the installation folder, and offers a launch checkbox when finished. Portable ZIPs are in `out/make/zip/win32/x64/`; extract and run `FormEntryDesktop.exe` with all accompanying files. The packaged app does not require Node.js or npm.

If native dependency compilation fails on Windows, install Python 3 and Visual Studio Build Tools with **Desktop development with C++**.

## Releases and updates

The **Release Windows** workflow runs only for `v*` tags or manual dispatch. It tests and builds Windows x64, checks the packaged and installed apps with local fixtures, and uploads the installer and portable ZIP. Manual runs create artifacts only.

To prepare a release, bump `version` in `package.json` and `package-lock.json`, commit, then push a matching tag:

```sh
git tag -a v0.4.0 -m "Release v0.4.0"
git push origin v0.4.0
```

Tag runs create a **draft GitHub Release**. Review its assets and publish it when ready. Keep `latest.yml`, the installer, and its `.blockmap` attached; the NSIS updater needs them. Updates use stable public GitHub Releases from the repository in `package.json`.

The old Squirrel release (`v0.3.0`) cannot update to this installer automatically. Uninstall it through Windows Settings, then install the new version. App data is retained; do not use **Xóa profile** during migration.

Installed Windows apps check at startup and every ten minutes. **Settings → Kiểm tra cập nhật** checks manually. The app shows checking status and download percentage, including outside Settings. Updates download in the background; restart is offered only when no operation or schedule is active, and existing shutdown cleanup finishes before installation. Updating opens the installer progress window; finish it to reopen the app. Configuration, history, and Chrome sessions are retained. Portable builds, development runs, and smoke tests do not auto-update. Windows builds are currently unsigned.
