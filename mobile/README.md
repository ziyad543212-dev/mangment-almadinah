# AlMadinah Android app (React Native)

This is a React Native/Expo application containing the management UI
in `react-native-webview`. Version 1.3.0 (Android versionCode 4) bundles the
complete interface, styles and logo inside the APK, so opening screens no longer
depends on downloading a page from the server. PostgreSQL, authentication and
OCR remain on the existing AlMadinah server.
The APK does not contain backend secrets or the Gemini key.

On the login screen, **فتح الواجهات دون اتصال** opens an empty preview without
signing in. After an online login, operational records already viewed can be
read offline for up to 24 hours. The cache is limited, separated by account and
role, excludes financial fields, and clears on logout or expired authentication.
Previously unopened screens may have no records. First login, saving changes,
payments, account administration and passport recognition require the server.
Offline changes are rejected; there is no pending-write queue or automatic
resubmission. The app checks for reconnection and reloads the current screen.

Version 1.2.0 (Android versionCode 3) adds employee accounts and removes the native
refresh/server-settings toolbar. Managers create employees from Settings; staff
retain operational screens while payment records, financial summaries, costs,
payment actions and database backups remain manager-only. The API enforces these
permissions independently of the interface and strips financial fields from
nested operational responses. Staff cannot delete a trip or pilgrim that has
payments, because that would also delete payment records.

The phone layout has bottom navigation,
labeled record cards, single-column forms and full-screen dialogs. Dialogs keep
their header and actions visible while the form scrolls, including when the
keyboard reduces the available height. Desktop tables and printed manifests
retain their columns. The launcher icons use the existing AlMadinah logo with
padding for Android adaptive icon masks. The existing signing key is retained
so this version installs as an update.

UI checks: run `npm --prefix mobile run bundle:ui` from the root, then
`npm run test:mobile` from `frontend/`. These use
headless Microsoft Edge and synthetic API responses; they never access the
live database. They cover widths 320, 360, 390, 430 and 844, dialog scrolling,
focus, desktop tables, print layout, first launch without networking, cached
records, blocked offline writes, reconnection and account isolation.
Phone screenshots are written under
`mobile/artifacts/qa/`. A physical-device test is still recommended.

The application address is set when building the APK. The bundled interface opens
directly without asking the user for connection settings. Connection failures
show an offline notice inside the interface without displaying the address or
native WebView error details. A network endpoint remains part of app configuration.
Do not use `localhost`: on a phone that address points to the phone itself.

## Local computer as server

1. Build the current frontend: `npm --prefix frontend run build` from the repo root.
2. Start the normal backend. It now serves `frontend/dist` and `/api` together
   on port 3001, so the phone does not need access to the Vite dev server.
3. Put the phone and computer on the same network. Use the computer's LAN IPv4
   address and permit the Node server on the private network if Windows asks.
4. Keep the computer/server running for login, up-to-date data and saving.
   The bundled interface and available cached records can open while it is off.

The local/cloud OCR choice selects how the **server** reads a passport. It
does not install PaddleOCR on the phone. Android file selection/camera is
provided through WebView. Report downloads use Android's share/save sheet;
printing uses the Android print dialog. Login and data operations use the
authenticated APIs; navigation uses the installed interface.

## Build APK on Windows

Prerequisites: Node.js, JDK 21 and Android SDK. Android Studio supplies the JDK
and SDK. `JAVA_HOME` and `ANDROID_HOME` may point to other installed locations.
If Java is present but the SDK is missing, the optional
`node scripts/install-android-sdk.js` command downloads verified Google tools
and the React Native SDK/NDK dependencies under ignored `mobile/.toolchain/`.
Running it accepts the required package licenses and can download over 1 GB.

```powershell
cd mobile
npm ci
npm run typecheck
npm test
npm run build:apk -- --app-url=http://192.168.1.10:3001
```

The builder first bundles the current frontend, then generates the native
Android project and an optimized, signed,
standalone APK at `mobile/artifacts/AlMadinah.apk`. It does not need Metro or
Expo Go after installation. The signing key and credentials stay under the
ignored `mobile/.signing/`; keep a private backup to sign future updates with
the same identity. Do not share those files with the APK.

Provide the address using `--app-url` or `EXPO_PUBLIC_APP_URL` before building.
The local builder rejects missing/invalid addresses. It is a public application
address, not a place for API secrets. A new address requires a new APK build.

## Cloud build alternative

With an authenticated Expo account and an initialized Expo project, the
`preview` profile in `eas.json` produces an installable APK:

```powershell
npx eas-cli build --platform android --profile preview
```

This requires Expo account access and uploads the app sources to Expo Build.
It has not been initialized with an invented project ID. The production
profile produces an Android App Bundle for store distribution instead.
Run `npm run bundle:ui` first and include the generated UI in the uploaded
sources when using this alternative; the local APK builder handles this step.

References: [WebView](https://docs.expo.dev/versions/latest/sdk/webview/),
[APK builds](https://docs.expo.dev/build-reference/apk/),
[local release builds](https://docs.expo.dev/guides/local-app-production/).
