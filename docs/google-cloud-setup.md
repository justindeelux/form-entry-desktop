# Google connection for Form Entry Desktop

Configure this once as the app owner. Users click **Kết nối Google**, sign in, consent, and choose a Sheets file. They never configure Google Cloud.

1. Create a Google Cloud project you control.
2. Enable **Google Sheets API**, **Google Drive API**, and **Google Picker API** in that project.
3. In **Google Auth Platform**, configure the app name, support email, audience and developer contact. Use **External** for personal Gmail accounts or users outside your Workspace organization. During **Testing**, add the intended Google accounts as test users.
4. Add only `https://www.googleapis.com/auth/drive.file` to Data Access. The app uses the native desktop Picker during OAuth to grant access to selected files; it does not request access to every spreadsheet.
5. Create an OAuth client with application type **Desktop app**. Download its JSON credentials. Save the downloaded file as `google-oauth.json` at the project root (next to `package.json`). The app accepts the standard `installed.client_id` and `installed.client_secret` fields. `google-oauth.example.json` shows the shape; replace its placeholders with your own client values. Do not use a Web or service-account client.
6. Start the development app with `npm start`. Click **Kết nối Google** and choose an editable Sheets file. Select the desired tab, configure mapping and load your Form. For another file, click **Chọn Sheets** to grant access through the Picker again.
7. Keep `google-oauth.json` present when packaging with `npm run make`. The shared Desktop client identifies the app; each user's refresh token is separate and encrypted locally. The Desktop client is distributed with the app and cannot be treated as a server-side secret. No service-account key should be distributed.

For development, the pair `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` can override the file. End-user machines should use the bundled file, without environment variables. Restart the app after changing developer configuration.

OAuth opens the user's default system browser, uses PKCE and a random state, and receives its callback on a randomly allocated `127.0.0.1` port. The native Picker uses `trigger_onepick=true` and returns the selected file ID. No API key, website hosting or JavaScript-origin configuration is required for this flow. The app offers cancellation and expires pending authorization after five minutes.

Before broad distribution, move out of Testing and complete the Google requirements for the chosen audience and scopes. Testing has a test-user cap and typically expires refresh tokens after seven days for this scope. Even with `drive.file`, brand/basic verification may apply. See Google's current requirements rather than treating Testing as the production configuration.

Google Form submission remains browser automation. The OAuth connection authorizes Sheets access; it does not sign the tool's separate Chrome profile into a Form that requires login. Keep **Yêu cầu đăng nhập Google** enabled for such Forms.

Reconnecting preserves pending confirmed Form submissions, but **Xóa profile** discards all local state and credentials, including those recovery records. It does not delete Sheets or Form responses on Google. Without resetting the profile, a pending confirmed Form submission can still be completed with **Cập nhật Sheets**, without submitting again. Keep the original file, tab, row position and mapped control columns for recovery. Use one app instance per Sheets tab: checking a row and writing it are separate requests, not a compare-and-swap transaction.

Sources:

- [Desktop/mobile Google Picker](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker)
- [Desktop OAuth with PKCE and loopback callbacks](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes)
- [OAuth publication states](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)
