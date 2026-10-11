# Project Instructions

## Scope

Form Entry Desktop is a local Electron app that reads a selected Google Sheets tab and submits mapped rows to a Google Form. Keep the Vietnamese UI and existing workflow. Make the smallest complete change; reuse existing helpers and dependencies. Do not add an installer, updater, cloud service, or new product flow without a request.

## Structure

- `src/main/`: Electron lifecycle, validated IPC, SQLite persistence, scheduling, and browser worker management.
- `src/preload/`: the typed, narrow bridge exposed as `window.desktop`.
- `src/renderer/`: React UI, Mantine controls, React Flow mapping, and local settings.
- `src/automation/`: Playwright worker, Form inspection/filling, and manual login browser lifecycle.
- `src/sources/`: Sheets CSV loading and parsing.
- `src/shared/`: Zod contracts, mapping, option matching, date parsing, row filtering, and scheduling rules.
- `tests/`: Vitest unit tests and local fixture checks for packaged Electron apps.
- `assets/`: application icons.
- `.github/workflows/release.yml`: Windows x64 installer/ZIP, fixture checks, and draft Releases for version tags; manual runs create artifacts only.

## Data and behavior

- Select the Sheets tab using URL `gid`; row 1 contains headers. Preserve physical row numbers, raw values, and duplicate or blank column identities. Optional start row must not change the header row.
- Support single-page Forms with text, paragraph, radio, dropdown, checkbox, date, and datetime fields. Reject unsupported controls and invalid data explicitly.
- Use IDs for mappings. Nonblank Sheets values take priority over defaults. Apply formatting only to outgoing payloads, never to raw rows or row hashes. Ambiguous choice matching requires explicit user confirmation.
- Persist renderer configuration immediately in localStorage. Restore mappings only when canonical source/Form URLs, ordered columns, and Form fingerprint match.
- Main owns SQLite history and checkpoints. Hash ordered raw headers and cells, scoped by Sheets tab and Form. Archive the source row and exact prepared Form payload only after confirmed submission.
- History expiry is opt-in. Deleting or expiring sent history permits resending and does not delete Google Form responses. Preserve uncertain checkpoints unless explicitly reconciled or the user confirms a full app reset.
- **Xóa profile** is a full app reset: close owned Chrome, refuse a remaining SingletonLock, remove the private profile, clear renderer storage/cache and all history/checkpoints, restore default preferences, and reload the UI. Keep the confirmation and explain that old rows may be sent again.

## Automation and safety

- Keep browser automation in the utility process, persistence in main, and renderer access behind validated IPC. Preserve URL/redirect validation, input limits, CSP, sandboxing, and context isolation.
- Use installed Google Chrome with the app-owned profile. Users complete login/MFA in ordinary Chrome. Only initiate login when requested by the login checkbox; never capture passwords, reuse personal browser cookies, or log sensitive data.
- Validate manual batches before sending. Recheck Form structure, fill and verify fields, persist submission intent, then click Submit once. Count success only after recognized confirmation; stop on failure or uncertainty and never automatically retry uncertain submissions.
- Schedules run only while the app is open and never resume automatically after restart. Pin their configuration, serialize operations, and preserve validation/checkpoint protections.
- On stop or close, cancel waiting and preparation before the next submission, finish recording any Submit already started, and close only browser processes owned by the app. Check window lifetime before accessing webContents.
- UI text is not selectable outside editable controls. Preserve keyboard navigation, labels, focus handling, and editing/copy/paste inside inputs.
- Handle Squirrel install/update/uninstall events before starting the app. Auto-updates are limited to installed Windows production builds and the public repository in package.json. Preserve app identity and userData across versions. Never install an update during an active operation/schedule; use existing shutdown cleanup before quitAndInstall. Keep GitHub tokens in CI, never in the app.

## Verification

- Read touched code and its callers, contracts, tests, and persisted-data effects before editing.
- Use `npm run typecheck` and focused `npm test -- <test files>` checks; run broader tests when the change warrants them.
- For native SQLite, IPC, browser lifecycle, or submission changes, build and run the relevant `tests/packaged-*.cjs` checks against the packaged executable.
- Use local fixtures and temporary profiles for submission tests. Never submit test data to real Google Forms or reset real user data without explicit authorization.
- Keep README commands accurate. Report only checks actually run and any remaining limitations.
