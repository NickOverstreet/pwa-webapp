# Codemagic Publishing Playbook (Capacitor → Google Play + App Store)

A reusable guide for shipping a Capacitor app to the Google Play Store (and the
Apple App Store) through Codemagic CI. Written from the PlugIdle setup, but
generalized so the next app is faster. Where you see a value like
`com.ignyte.<app>` or `<app>_upload_keystore`, substitute your app's value.

> **Why this exists:** the first time through has ~6 separate one-time setup
> steps across 4 different consoles (GitHub, Codemagic, Google Cloud, Play
> Console / App Store Connect), and several non-obvious failure modes. This
> doc front-loads all of them.

---

## 0. Mental model

- **The repo is the source of truth.** `codemagic.yaml` defines the build; the
  committed `android/` Gradle project + `capacitor.config.json` define the
  Android app. The `ios/` project is **not** committed — it's generated fresh in
  CI each build. Web assets are staged into a gitignored `www/` by
  `npm run build:www`, then `cap sync` copies them into the native project.
- **Secrets never live in the repo.** Signing keystores, service-account JSON,
  and API keys all live in the Codemagic UI and are injected as environment
  variables / code-signing identities at build time.
- **Builds are triggered by git tags** matching `v*.*.*` (or started manually in
  the Codemagic UI). One tag push builds **both** iOS and Android.

---

## 1. Prerequisites (per app, one time)

- A Google Play **developer account** ($25 one-time) and the app **created** in
  Play Console (this fixes the package name forever — see §6).
- An Apple **Developer Program** membership ($99/yr) and the app record in App
  Store Connect (only if shipping iOS).
- A **Codemagic Team plan** if you need:
  - macOS build machines (iOS builds — **macOS minutes are never free**), or
  - the larger Linux/instance types this config requests (`linux_x2`,
    `mac_mini_m2`). The free tier won't run them (see §9, "instance type").
- Toolchain versions Capacitor needs, pinned in `codemagic.yaml`: the
  **Capacitor CLI requires Node ≥ 22**, and the **Capacitor Android library
  compiles against JDK 21**. Pin `node: 22` and `java: 21` (see §9).

---

## 2. `codemagic.yaml` structure (already in the repo)

Two workflows, both triggered on `v*.*.*` tags:

- **`android-release`** (Linux): `npm ci` → `build:www` → `cap sync android` →
  `gradlew bundleRelease` → publish AAB to Play **internal** track.
- **`ios-release`** (macOS): `npm ci` → `build:www` →
  `cap add ios --packagemanager cocoapods` → generate icons → patch Info.plist →
  `cap sync ios` → `pod install` → create signing files → build IPA → publish to
  TestFlight.

Key fields to keep correct:

```yaml
environment:
  node: 22                         # MUST be >= 22 for Capacitor CLI
  java: 21                         # Capacitor's android lib compiles against Java 21
  android_signing:
    - <app>_upload_keystore        # reference name of keystore in Codemagic UI
  groups:
    - google_play                  # env-var group holding the Play SA JSON
publishing:
  google_play:
    credentials: $GCLOUD_SERVICE_ACCOUNT_CREDENTIALS
    track: internal
    submit_as_draft: true
```

The Android signing block in `android/app/build.gradle` reads these env vars
(Codemagic sets them from the uploaded keystore):
`CM_KEYSTORE_PATH`, `CM_KEYSTORE_PASSWORD`, `CM_KEY_ALIAS`, `CM_KEY_PASSWORD`.
Local builds without those vars stay unsigned (by design).

---

## 3. Codemagic account / team setup

1. Connect the GitHub repo as an **app** in Codemagic.
2. If using a **Team**, do ALL of the following **inside that team's context**
   (top-left account/team switcher). **Env vars, secrets, keystores, and
   integrations do NOT transfer between accounts/teams.** Switching accounts is
   the #1 cause of "it worked yesterday" breakage.
3. Set the app's **Build configuration** to use `codemagic.yaml` (not the
   Workflow Editor), or the workflows won't be found.

---

## 4. Android: signing keystore

You sign with an **upload key**; Google holds the real **app signing key** (Play
App Signing). The keystore is permanent — **back it up.**

### 4a. Generate the keystore (once per app)

`keytool` ships with the JDK but usually isn't on PATH. On this machine it's at:

```
C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe
```

PowerShell (run from somewhere OUTSIDE the repo, e.g. your home folder; use `&`
because of the spaces in the path, and note PowerShell does NOT use `\` for line
continuation — keep it one line):

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v -keystore <app>-upload.keystore -alias <app>-upload -keyalg RSA -keysize 2048 -validity 10000 -storetype JKS
```

It prompts for a **keystore password**, a name/org, and a **key password**
(press Enter to reuse the keystore password — simplest).

- ⚠️ **Record both passwords in a password manager and back up the `.keystore`
  file** (offline copy). With Play App Signing, loss is recoverable but painful.
- The "JKS is a proprietary format… migrate to PKCS12" message is just a
  **warning — ignore it.** JKS works fine with Codemagic/Gradle.

### 4b. Upload it to Codemagic

Team settings → **Code signing identities → Android keystores → Add keystore**:

- **File:** your `<app>-upload.keystore`
- **Reference name:** `<app>_upload_keystore` (must EXACTLY match
  `android_signing` in `codemagic.yaml`)
- **Keystore password / key password:** what you chose
- **Key alias:** `<app>-upload`

---

## 5. Android: Google Play service account (for auto-publish)

This lets Codemagic upload to Play via the API. **The old Play Console "API
access" page has moved — service accounts are created in Google Cloud Console;
access is granted in Play Console → Users and permissions.**

### 5a. Google Cloud Console (`console.cloud.google.com`)

Sign in with the Google account tied to your Play developer account.

1. Create / select a **project**. **You do NOT need a Cloud "organization"** —
   "No organization" is correct unless you run Google Workspace and want central
   governance. Don't create an org just to publish an app.
2. **APIs & Services → Library →** enable **"Google Play Android Developer
   API"** (in this project).
3. **IAM & Admin → Service Accounts → Create service account** → name it (e.g.
   `<app>-play-publisher`) → you can skip granting project roles → **Done**.
4. Open the service account → **Keys → Add key → Create new key → JSON →
   Create.** A `.json` downloads. **This is the secret.** Note its
   `client_email` (e.g. `<app>-play-publisher@<project>.iam.gserviceaccount.com`).

### 5b. Play Console — grant the service account access

**Play Console → Users and permissions → Invite new users**:

- **Email:** the service-account `client_email` from 5a.
- **Permissions:** app access to your app with at least **"Release to testing
  tracks"** (app-level **Admin** is simplest if unsure).
- **Invite.** Service accounts take effect immediately (nothing to "accept").

Both halves are required: API enabled **in the SA's project** AND the email
granted access **in Play Console**.

### 5c. Codemagic — store the JSON

App / Team **Environment variables** (in the correct team):

- **Variable name:** `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` (exact, case-sensitive)
- **Value:** the **entire JSON file contents** (open the `.json`, Ctrl+A,
  Ctrl+C, paste — multi-line is fine, starts with `{`). **Not a file path, not a
  fragment.**
- **Group:** `google_play` (must match `groups:` in the YAML)
- **Secure:** ✅ checked

---

## 6. The package name is PERMANENT — get it right BEFORE creating the app

Once you create the app in Play Console / App Store Connect, the package
(`applicationId` / bundle id) **can never be changed.** An uploaded bundle's
package must match the store app exactly, or you can't upload it.

- Decide the final id (e.g. `com.ignyte.<app>`) up front.
- It must be identical in **all** of these:
  - `android/app/build.gradle` → `applicationId` **and** `namespace`
  - `capacitor.config.json` → `appId`
  - `codemagic.yaml` → iOS `bundle_identifier`
  - the app record in Play Console / App Store Connect
- After any rename, `grep -ri "com.old.id"` the repo to catch stragglers.

---

## 7. The release flow (every version)

1. Bump the version (`npm run bump`, or edit `versionName` in
   `android/app/build.gradle`). `versionCode` must **strictly increase** on every
   Play upload — the Android workflow derives it from Codemagic's per-PROJECT
   build counter automatically.
2. **Tag and push:** `git tag -a vX.Y.Z -m "<app> vX.Y.Z"` then
   `git push origin vX.Y.Z`. One tag builds **both** platforms.
   - The tag must point at the commit you actually want. If you tagged before a
     fix landed, re-point it:
     ```
     git tag -d vX.Y.Z
     git push origin :refs/tags/vX.Y.Z
     git pull --ff-only
     git tag -a vX.Y.Z -m "<app> vX.Y.Z"
     git push origin vX.Y.Z
     ```
   - Or just **Start new build → branch `main`** in Codemagic (avoids tag
     surgery; the tag is mainly for marking releases + auto-trigger).
3. Watch the build. Download artifacts (`.aab` / `.ipa`) if needed.

### THE FIRST UPLOAD MUST BE MANUAL (per app, once)

Google's Play API **rejects the very first upload** of an app — it must be done
by hand in the Play Console. So expect the **first** Android build's
`Publishing` step to fail even when everything is configured correctly.

1. Download the `.aab` from the build's **Artifacts**.
2. **Play Console → Testing → Internal testing → Create new release** → accept
   **Play App Signing** enrollment → upload the `.aab` → **Review → Start
   rollout to Internal testing.**
3. **Testers** tab → add your tester email list → copy the **opt-in URL** → send
   to testers (they must open it, accept, then install from Play).
4. After this one manual upload, **every future tag auto-publishes** to the
   internal track as a draft.

Before you can roll out, clear **Policy → App content** (privacy policy, ads,
data safety, content rating, target audience, etc.).

### Path to Production (new personal accounts)

- **Internal testing** → sanity check.
- **Closed testing** → needs **12+ testers opted in for 14 continuous days**
  before "Apply for production" unlocks. Start this early.
- **Production** → staged rollout (20% → 50% → 100%).

---

## 8. iOS — App Store Connect (if shipping iOS)

The build pipeline is the same `ios-release` workflow; the work is almost all
**Apple-side account setup**. There's no keystore/service-account like Android —
a single **App Store Connect API key** handles *both* signing and TestFlight
upload.

### 8a. App Store Connect API key (the iOS analog of the keystore + SA)
1. **App Store Connect → Users and Access → Integrations → App Store Connect
   API → Team Keys → ＋**. (First time: click to enable the API.)
2. **Access role: Admin.** A Developer/lower role (and sometimes even App
   Manager) **cannot create** the distribution certificate + profile, which
   fails the build later — use **Admin** to be safe.
3. Collect three things: the **`.p8`** key file (downloads **once** — save it),
   the **Key ID**, and the **Issuer ID** (shown at the top of the page).
4. **Codemagic → Team settings → Integrations → Developer Portal → Manage
   keys** → add it, named **exactly** to match `integrations: app_store_connect:`
   in `codemagic.yaml` (e.g. `<App> ASC Key`). You **also** need a persistent
   certificate private key (§8d, step 2) — those two are the Codemagic-side iOS
   secrets.

### 8b. Register the App ID + create the app record
- **Apple Developer → Certificates, Identifiers & Profiles → Identifiers → ＋ →
  App IDs → App** → type **Explicit**, Bundle ID `com.ignyte.<app>`. Leave **all
  capabilities unchecked** (In-App Purchase is on by default; no Push/Sign-in/etc.).
  The **Description** field rejects special characters — use plain text (no hyphen).
- **App Store Connect → Apps → ＋ → New App** → iOS, public **Name** (must be
  unique on the App Store), select the bundle ID, a version-free **SKU** (e.g.
  `ign-<app>-ios`), User Access Full.

### 8c. Paid Apps agreement (long lead — start early)
ASC → **Business** → accept the **Paid Applications Agreement** (Account Holder
only) → tax forms → bank + contact. It goes **Active in ~24h**, and **IAPs won't
load or pass review until it is.** It doesn't block the build, so kick it off first.

### 8d. iOS signing & build — the working recipe (this took ~10 builds; here's the distilled version)

Five pieces must all line up. Miss any one and the build fails at a *different*
step, which is what made this a slog — fix them all up front.

1. **ASC API key role = Admin** (see 8a). Lower roles can't create the
   distribution cert/profile → "No matching profiles found".

2. **Provide a persistent certificate private key.** `--create` can't mint a
   distribution certificate without a private key to build it from (→ "Cannot
   save Signing Certificates without certificate private key", which cascades to
   "no profile"). Generate one **once**:
   ```powershell
   ssh-keygen -t rsa -b 2048 -m PEM -f codemagic_private_key -q -N '""'
   ```
   Add the full PEM (incl. the `BEGIN/END RSA PRIVATE KEY` lines) to Codemagic
   env vars as **`CERTIFICATE_PRIVATE_KEY`** (Secure), in a group (e.g.
   `ios_credentials`) that the workflow references via `environment.groups`. This
   reuses ONE cert across builds instead of minting throwaway certs each run.

3. **Do NOT use the `ios_signing:` environment block** on a first build. Its
   pre-build prep only *fetches* existing profiles and aborts ("No matching
   profiles found") **before** your scripts run — so the create step never
   happens. Do signing entirely in a script:
   ```
   keychain initialize
   app-store-connect fetch-signing-files "com.ignyte.<app>" \
     --type IOS_APP_STORE \
     --certificate-key @env:CERTIFICATE_PRIVATE_KEY \
     --create
   keychain add-certificates
   xcode-project use-profiles
   ```
   `build-ipa` archives fine from the project settings that `use-profiles`
   writes — the `ios_signing` block isn't needed.

4. **Force CocoaPods** (Capacitor 8 defaults to SPM → no Podfile):
   `npx cap add ios --packagemanager cocoapods`.

5. **Ship iPhone-only.** A portrait-locked app can't satisfy Apple's "iPad apps
   must support all four orientations" rule, so the upload is rejected with
   **error 90474**. `scripts/patch-ios-plist.sh` drops the iPad orientation slice
   and sets `TARGETED_DEVICE_FAMILY = 1` in `project.pbxproj`. (Alternative:
   support all four orientations — but that breaks a portrait design.)

### 8e. Build → TestFlight → submit
1. Build `ios-release` (tag or branch `main`) → uploads to **TestFlight**
   (~5–15 min Apple processing before it's testable).
2. In ASC, create the **6 IAP products** (reuse the Android product IDs) + a
   **sandbox tester**; fill **App Privacy** (declare **AdMob data collection +
   Tracking** — the app is no longer "Data Not Collected"), **age rating** (4+),
   **screenshots** (6.9″), and the **listing** copy.
3. Sandbox-test IAP on a real device via TestFlight.
4. Add **App Review notes** → submit. Full detail: `store/app-store-connect-checklist.md`.

Notes: macOS build minutes are **paid** (no free iOS CI). **iOS ships rewarded
ads now** (AdMob), same as Android — `scripts/patch-ios-plist.sh` stamps the
required `GADApplicationIdentifier`, ATT `NSUserTrackingUsageDescription`, and
`SKAdNetworkItems`, and the workflow verifies the AdMob pod is present. (Still on
TEST ad units — swap real IDs before launch.)

---

## 9. Troubleshooting — every error we actually hit

| Symptom | Cause | Fix |
|---|---|---|
| **`No keystores with reference '<app>_upload_keystore' were found`** | Keystore not uploaded, or reference name mismatch | Upload it (§4b); the reference name must exactly match `android_signing` in the YAML |
| **401 when uploading the keystore** | Stale session after switching Codemagic accounts/teams, or wrong team/role | Fully log out and back in; confirm you're in the right **team** with **owner/admin** role; try incognito |
| **`The selected instance type is not available with the current billing plan`** | Free plan can't run `linux_x2` / `mac_mini_m2`; macOS is always paid | Upgrade to the **Team plan** (or downgrade the instance type for Android-only) |
| **`Provided Google Play service account credentials could not be used: Expecting value: line 1 column 1 (char 0)`** | `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` is **empty** (often wiped by an account/team switch) — JSON parser hit an empty string | Add the var in the **current team**, group `google_play`, value = the **full JSON**, marked Secure (§5c) |
| **`[fatal] The Capacitor CLI requires NodeJS >=22.0.0`** | `codemagic.yaml` pinned an older Node | Set `node: 22` in **both** workflows |
| **`error: invalid source release: 21`** (Gradle `compileReleaseJavaWithJavac`) | Build machine's JDK is older than 21; Capacitor's android lib needs Java 21 | Add `java: 21` to the android workflow's `environment` |
| **`Publishing` fails on the very first build** (Google API error about no existing app / first upload) | Expected — Google blocks the first API upload | Do the **manual first upload** in Play Console (§7); auto-publish works after |
| **Bundle rejected: package name mismatch** | App bundle's `applicationId` ≠ the Play app's package | Package is permanent — make the repo match the store app (§6) |
| **Build ran the wrong commit / old package** | Tag points to a pre-fix commit | Re-point the tag, or build branch `main` (§7) |
| **(iOS) `No matching profiles found for bundle identifier … distribution type "app_store"`** | Either the `ios_signing` block's prep ran (it only fetches → aborts before `--create`), or no cert/profile got created | **Remove** the `ios_signing` block; create explicitly with `--certificate-key --create`; ASC key must be **Admin** (§8d, steps 1–3) |
| **(iOS) `Cannot save Signing Certificates without certificate private key`** | `--create` has no private key to mint the distribution cert from → no cert, then no profile | Add a persistent **`CERTIFICATE_PRIVATE_KEY`** and pass `--certificate-key @env:CERTIFICATE_PRIVATE_KEY` (§8d, step 2) |
| **(iOS) `No 'Podfile' found in the project directory`** (CocoaPods install) | Capacitor 8 defaults to **SPM**, so `cap add ios` made an SPM project with no Podfile | `npx cap add ios --packagemanager cocoapods` (§8d, step 4) |
| **(iOS) upload rejected `90474` — UISupportedInterfaceOrientations / iPad multitasking** | Portrait-locked app shipped as a universal (iPad-capable) binary; iPad requires all 4 orientations | Ship **iPhone-only**: `TARGETED_DEVICE_FAMILY = 1` + drop the iPad orientation slice (§8d, step 5) |
| **`keytool` not recognized** | JDK not on PATH | Call it by full path from the Android Studio JBR (§4a) |
| **"JKS is a proprietary format… migrate to PKCS12"** | Informational warning only | Ignore — JKS is fine |
| **`cap sync` changed `capacitor.build.gradle` locally** | Generated-file churn (often just CRLF/LF) | `git checkout -- android/app/capacitor.build.gradle android/capacitor.settings.gradle` |
| **Play warning: "No deobfuscation file associated with this App Bundle"** | R8/ProGuard is off (`minifyEnabled false`), so there's no mapping file | **Safe to ignore** — code isn't obfuscated, so crash traces are already readable. Optionally enable R8 later (see note below) |

### Optional: R8 / ProGuard (smaller app + the deobfuscation file)

The build ships with `minifyEnabled false` in `android/app/build.gradle`, so the
app isn't shrunk or obfuscated, and Play shows *"No deobfuscation file
associated with this App Bundle"* — **a harmless warning, not a blocker.**

Enabling R8 is a good **post-launch** task (not a launch requirement):

1. Set `minifyEnabled true` in `android/app/build.gradle`.
2. **Test thoroughly** — R8 renames/strips code and can break reflection-based
   pieces: the **Capacitor WebView bridge, Capacitor plugins, AdMob, and Play
   Billing**. Add `-keep` rules in `android/app/proguard-rules.pro` as needed.
3. Once enabled, AGP **embeds the mapping file in the AAB automatically**, so
   Play associates it on upload and the warning disappears — no manual mapping
   upload. The `mapping.txt` artifact glob is already in `codemagic.yaml`.

---

## 10. Quick checklist for a NEW app

- [ ] Pick the **final package id** (`com.ignyte.<app>`) — set it in
      build.gradle (`applicationId` + `namespace`), capacitor.config.json
      (`appId`), and codemagic.yaml (iOS `bundle_identifier`).
- [ ] Create the app in **Play Console** (and App Store Connect for iOS) with
      that exact id.
- [ ] `codemagic.yaml`: `node: 22`; set keystore reference name + `google_play`
      group; set `track`.
- [ ] Generate the upload keystore (§4a) → back it up → upload to Codemagic (§4b).
- [ ] Google Cloud: project (no org) → enable Play Developer API → service
      account → JSON key (§5a).
- [ ] Play Console → Users and permissions → invite the SA email (§5b).
- [ ] Codemagic: `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` (full JSON, Secure, group
      `google_play`) (§5c).
- [ ] **iOS only:** ASC **API key (Admin)** registered as `<App> ASC Key`;
      generate + add **`CERTIFICATE_PRIVATE_KEY`** (Secure, group `ios_credentials`);
      register the **App ID** + create the **app record**; start the **Paid Apps
      agreement** (→ Active, ~24h). In `codemagic.yaml`: **no** `ios_signing`
      block, `cap add ios --packagemanager cocoapods`, the `--certificate-key
      --create` signing step, and **iPhone-only** (`TARGETED_DEVICE_FAMILY=1`) (§8).
- [ ] Clear **Policy → App content** forms in Play Console.
- [ ] Tag `vX.Y.Z` (or build branch `main`) → build → **first Android publish
      will fail** → download `.aab` → **manual first upload** to Internal testing
      (§7).
- [ ] Add testers, share the opt-in link.
- [ ] Confirm a second build's `Publishing` step now succeeds.
- [ ] Start **closed testing** early if you need the 14-day production clock.
- [ ] *(Optional, post-launch)* enable R8/ProGuard for a smaller, obfuscated
      build — test Capacitor plugins / AdMob / IAP and add keep rules first.

---

*Generated from the PlugIdle setup. Keep alongside the repo's `codemagic.yaml`
and `store/play-console-checklist.md`.*
