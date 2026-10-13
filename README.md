# Form Entry Desktop

A local desktop app that reads a Google Sheets tab and submits its rows to a Google Form. Built with Electron, TypeScript, React, Mantine, React Flow, and Playwright. The interface is in Vietnamese.

## Usage

1. Open the desired Sheets tab and copy its full URL, including `gid`.
2. Paste the Sheets URL and Form URL into the app. Sign in with a Google account that can edit the tab, then load the data.
3. Map columns to Form fields and optionally set defaults or formatting. In **Cột lưu trạng thái trên Sheets**, explicitly select **Kết quả** and **Gửi lúc**. Each control must use a distinct column; the app never chooses columns from header names.
4. Submit the rows, or schedule submissions while the app is open.

Google Chrome must be installed. Row 1 is the header; blank rows are skipped. Only single-page Forms are supported. Sheets input is limited to 10 MB, 200 columns, and 10,000 data rows. No Google API key is required.

A tab with headers and no data rows can be loaded or reloaded. Configure mapping and start a schedule while it is empty; later scheduled passes read newly added rows.

After a confirmed submission, the app writes **Đã gửi** and a full timestamp into the selected columns. The history table reads the current Sheet; Form previews use the current mapping and values. **Đánh dấu chưa gửi** changes the selected result to **Chưa gửi**, clears the sent time and resets the repeat counter on Sheets.

For automatic repeats, explicitly select all three additional columns: **Lặp lại** (maximum additional sends), **Lặp lại sau (ngày)** (whole days, at least 1), and **Đã nhập lại (số lần)** (completed additional sends). Repeats run only while a schedule is active. A blank limit or interval skips repetition; a blank completed count means zero. Each scheduled pass sends at most one repeat per due row, increments its counter and replaces its sent timestamp. The next due date is based on this latest timestamp. Invalid repeat controls or a missing/invalid timestamp on otherwise eligible rows stop the schedule. Days and times use the computer's local timezone.

Row data and sent state stay on Sheets. The app keeps configuration, its private Chrome profile, and a small JSON recovery journal locally. This journal contains row hashes, positions and control updates, without storing Form payloads. If a Form was submitted but the Sheet write failed, **Cập nhật Sheets** completes the write without submitting again. Uncertain submissions require checking the Form responses before choosing **đã gửi** or **chưa gửi**. Keep the original row position and contents until recovery finishes.

Existing SQLite history is opened read-only for migration. On the next send with explicit control mapping, matching old sent records are marked on Sheets before new submissions; the old database is preserved. Unknown legacy submissions still require review. **Settings → Xóa profile** clears login and local preferences; Sheet data and unresolved recovery records remain.

Run only one app against a given tab at a time. The app checks for edits before submitting and writing, but Google Form submission and Sheet updates are separate operations, so simultaneous writers cannot be made atomic. Keep the tab editable and the app open while its schedule runs.

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

The SQLite native dependency is no longer required.

The integration checks use local Form/Sheets fixtures and never submit a real Google Form. To run them against the installed development Electron runtime after building:

```sh
node tests/packaged-smoke.cjs <electron-executable> --development
node tests/packaged-history.cjs <electron-executable> --development
node tests/packaged-close.cjs <electron-executable> --development
```

## Releases and updates

The **Release Windows** workflow runs only for `v*` tags or manual dispatch. It tests and builds Windows x64, checks the packaged and installed apps with local fixtures, and uploads the installer and portable ZIP. Manual runs create artifacts only.

To prepare a release, bump `version` in `package.json` and `package-lock.json`, commit, then push a matching tag:

```sh
git tag -a v0.4.0 -m "Release v0.4.0"
git push origin v0.4.0
```

Tag runs create a **draft GitHub Release**. Review its assets and publish it when ready. Keep `latest.yml`, the installer, and its `.blockmap` attached; the NSIS updater needs them. Updates use stable public GitHub Releases from the repository in `package.json`.

The old Squirrel release (`v0.3.0`) cannot update to this installer automatically. Uninstall it through Windows Settings, then install the new version. App data is retained; do not use **Xóa profile** during migration.

Installed Windows apps check at startup and every ten minutes. When a new version is available, the update modal opens with its changelog. **Cập nhật** opens the modal manually; **Kiểm tra cập nhật** checks without downloading. **Cập nhật ngay** downloads with progress and installs once no operation or schedule is active. If work starts during the download, restart manually from the modal after it finishes. Existing shutdown cleanup runs before installation; finish the installer to reopen the app. Configuration, history, and Chrome sessions are retained. Portable builds, development runs, and smoke tests do not auto-update. Windows builds are currently unsigned.
