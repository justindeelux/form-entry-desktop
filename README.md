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

Packaged apps are in `out/`; Windows ZIPs are in `out/make/zip/win32/x64/`. Extract the ZIP and run `Form Entry Desktop.exe` with all accompanying files. The packaged app does not require Node.js or npm. Current builds are portable ZIPs without an installer or updater.

If native dependency compilation fails on Windows, install Python 3 and Visual Studio Build Tools with **Desktop development with C++**.

The included **Build Windows** GitHub Actions workflow builds only Windows x64 on pushes to `main` or manual dispatch. It runs typecheck, unit tests, and a packaged smoke check with local fixtures, then uploads the **Form-Entry-Desktop-Windows-x64** artifact.
