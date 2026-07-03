# Codemagic Publishing Playbook (Capacitor → Google Play + App Store)

A reusable, project-neutral guide for shipping a **Capacitor** app to the Google
Play Store and/or the Apple App Store through **Codemagic** CI. Copy this into a
new repo and fill in the placeholders — the hard-won gotchas (§9) are the reason
this doc exists.

> **Why this exists:** the first time through has ~6 separate one-time setup
> steps across 4 consoles (GitHub, Codemagic, Google Cloud, Play Console / App
> Store Connect) and several non-obvious failure modes. This front-loads them.

### Placeholders used throughout — substitute your values

| Placeholder | Meaning | Example |
|---|---|---|
| `<app>` | short lowercase slug (keystore names, SKU) | `myapp` |
| `<App>` | public display name | `My App` |
| `<BUNDLE_ID>` | reverse-DNS app id (permanent — see §6) | `com.example.myapp` |
| `<BRAND_BG>` | icon/splash background hex | `#070a0f` |
| `<app>_upload_keystore` | Codemagic Android keystore reference name | — |
| `<App> ASC Key` | Codemagic App Store Connect key label | — |
| `google_play` / `ios_credentials` | Codemagic env-var group names | — |
| `build:www` | your repo's "stage web assets into `www/`" command | `npm run build:www` |
| `bump` | however your repo bumps the version | `npm run bump` |

This guide assumes the common Capacitor layout: web assets are staged into a
gitignored `www/` by your build command, `android/` **is** committed, and `ios/`
is **not** committed (generated fresh in CI). Adjust if your repo differs.

---

## 0. Mental model

- **The repo is the source of truth.** `codemagic.yaml` defines the build; the
  committed `android/` Gradle project + `capacitor.config.json` define the
  Android app. The `ios/` project is generated fresh in CI each build. Web
  assets are staged into a gitignored `www/`, then `cap sync` copies them into
  the native project.
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
- Toolchain versions Capacitor needs, pinned in `codemagic.yaml`: current
  **Capacitor CLI requires Node ≥ 22**, and the **Capacitor Android library
  compiles against JDK 21**. Pin `node: 22` and `java: 21` (see §9). Re-check
  these against your Capacitor major version — they climb over time.

---

## 2. `codemagic.yaml` structure

Two workflows, both triggered on `v*.*.*` tags:

- **`android-release`** (Linux): `npm ci` → `build:www` → `cap sync android` →
  `gradlew bundleRelease` → publish AAB to Play **internal** track.
- **`ios-release`** (macOS): `npm ci` → `build:www` →
  `cap add ios --packagemanager cocoapods` → generate icons → patch Info.plist →
  `cap sync ios` → `pod install` → create signing files → build IPA → publish to
  TestFlight.

Key fields to keep correct:

```yaml
# android-release
environment:
  node: 22                         # MUST be >= 22 for the Capacitor CLI
  java: 21                         # Capacitor's android lib compiles against Java 21
  android_signing:
    - <app>_upload_keystore        # reference name of the keystore in the Codemagic UI
  groups:
    - google_play                  # env-var group holding the Play SA JSON
publishing:
  google_play:
    credentials: $GCLOUD_SERVICE_ACCOUNT_CREDENTIALS
    track: internal
    submit_as_draft: false         # true = land as a draft, gate rollout manually

# ios-release
integrations:
  app_store_connect: <App> ASC Key # label of the ASC API key added in the Codemagic UI
environment:
  node: 22
  xcode: latest
  cocoapods: default
  groups:
    - ios_credentials              # holds CERTIFICATE_PRIVATE_KEY (§8d, step 2)
publishing:
  app_store_connect:
    auth: integration
    submit_to_testflight: true
    submit_to_app_store: false     # flip to true to promote to App Store review
```

The Android signing block in `android/app/build.gradle` reads env vars Codemagic
sets from the uploaded keystore: `CM_KEYSTORE_PATH`, `CM_KEYSTORE_PASSWORD`,
`CM_KEY_ALIAS`, `CM_KEY_PASSWORD`. Local builds without those vars stay unsigned
(by design).

---

## 3. Codemagic account / team setup

1. **Connect the repo as an app in Codemagic** via the Codemagic **GitHub App**
   integration (Apps → Add application). That connection auto-creates the GitHub
   webhook that delivers tag pushes. **Without it the `triggering:` blocks do
   nothing** — a `v*.*.*` tag won't start a build because Codemagic never hears
   the push. Verify: GitHub repo → Settings → Webhooks should list a
   `codemagic.io` hook with recent successful deliveries. (Connecting via a raw
   token/SSH can skip the webhook; reconnect via the GitHub App if tag pushes
   don't auto-trigger.)
2. If using a **Team**, do ALL secret/keystore/integration setup **inside that
   team's context** (top-left switcher). **Env vars, secrets, keystores, and
   integrations do NOT transfer between accounts/teams.** Switching accounts is
   the #1 cause of "it worked yesterday" breakage.
3. Set the app's **Build configuration** to use `codemagic.yaml` (not the
   Workflow Editor), or the workflows won't be found.

---

## 4. Android: signing keystore

You sign with an **upload key**; Google holds the real **app signing key** (Play
App Signing). The keystore is permanent — **back it up.**

### 4a. Generate the keystore (once per app)

`keytool` ships with the JDK. On macOS/Linux with a JDK on PATH it's just
`keytool`; on Windows it usually isn't on PATH — call it from your JDK, e.g. the
Android Studio JBR:

```
C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe
```

Run from **outside the repo** (e.g. your home folder). On Windows PowerShell use
`&` for the spaced path and keep it one line (PowerShell doesn't use `\` for line
continuation):

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v -keystore <app>-upload.keystore -alias <app>-upload -keyalg RSA -keysize 2048 -validity 10000 -storetype JKS
```

macOS/Linux equivalent:

```bash
keytool -genkeypair -v -keystore <app>-upload.keystore -alias <app>-upload \
  -keyalg RSA -keysize 2048 -validity 10000 -storetype JKS
```

It prompts for a **keystore password**, a name/org, and a **key password** (press
Enter to reuse the keystore password — simplest).

- ⚠️ **Record both passwords in a password manager and back up the `.keystore`
  file** (offline copy). With Play App Signing, loss is recoverable but painful.
- The "JKS is a proprietary format… migrate to PKCS12" message is a **warning —
  ignore it.** JKS works fine with Codemagic/Gradle.

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
   governance.
2. **APIs & Services → Library →** enable **"Google Play Android Developer API"**
   (in this project).
3. **IAM & Admin → Service Accounts → Create service account** → name it (e.g.
   `<app>-play-publisher`) → you can skip granting project roles → **Done**.
4. Open the service account → **Keys → Add key → Create new key → JSON →
   Create.** A `.json` downloads. **This is the secret.** Note its `client_email`
   (e.g. `<app>-play-publisher@<project>.iam.gserviceaccount.com`).

### 5b. Play Console — grant the service account access

**Play Console → Users and permissions → Invite new users**:

- **Email:** the service-account `client_email` from 5a.
- **Permissions:** app access with at least **"Release to testing tracks"**
  (app-level **Admin** is simplest if unsure).
- **Invite.** Service accounts take effect immediately (nothing to "accept").

Both halves are required: API enabled **in the SA's project** AND the email
granted access **in Play Console**.

### 5c. Codemagic — store the JSON

App / Team **Environment variables** (in the correct team):

- **Variable name:** `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` (exact, case-sensitive)
- **Value:** the **entire JSON file contents** (open the `.json`, select all,
  copy, paste — multi-line is fine, starts with `{`). **Not a file path, not a
  fragment.**
- **Group:** `google_play` (must match `groups:` in the YAML)
- **Secure:** ✅ checked

---

## 6. The package name is PERMANENT — get it right BEFORE creating the app

Once you create the app in Play Console / App Store Connect, the package
(`applicationId` / bundle id) **can never be changed.** An uploaded bundle's
package must match the store app exactly, or you can't upload it.

- Decide the final id (`<BUNDLE_ID>`) up front.
- It must be identical in **all** of these:
  - `android/app/build.gradle` → `applicationId` **and** `namespace`
  - `capacitor.config.json` → `appId`
  - `codemagic.yaml` → iOS `bundle_identifier` (and the `fetch-signing-files` id)
  - the app record in Play Console / App Store Connect
- After any rename, `grep -ri "com.old.id"` the repo to catch stragglers.

---

## 7. The release flow (every version)

1. Bump the version (`bump`, or edit `versionName` in
   `android/app/build.gradle`). `versionCode` must **strictly increase** on every
   Play upload — the Android workflow derives it from Codemagic's per-PROJECT
   build counter (`-PversionCode=$PROJECT_BUILD_NUMBER`), so you don't bump it by
   hand. (PROJECT, not per-workflow: a per-workflow counter restarts at 1 and
   Play rejects the lower code.)
2. **Tag and push:** `git tag -a vX.Y.Z -m "<App> vX.Y.Z"` then
   `git push origin vX.Y.Z`. One tag builds **both** platforms.
   - The tag must point at the commit you actually want. If you tagged before a
     fix landed, re-point it:
     ```
     git tag -d vX.Y.Z
     git push origin :refs/tags/vX.Y.Z
     git pull --ff-only
     git tag -a vX.Y.Z -m "<App> vX.Y.Z"
     git push origin vX.Y.Z
     ```
   - Or just **Start new build → branch `main`** in Codemagic (avoids tag
     surgery; the tag is mainly for marking releases + auto-trigger).
3. Watch the build. Download artifacts (`.aab` / `.ipa`) if needed.

### THE FIRST ANDROID UPLOAD MUST BE MANUAL (per app, once)

Google's Play API **rejects the very first upload** of an app — it must be done
by hand in the Play Console. Expect the **first** Android build's `Publishing`
step to fail even when everything is configured correctly.

1. Download the `.aab` from the build's **Artifacts**.
2. **Play Console → Testing → Internal testing → Create new release** → accept
   **Play App Signing** enrollment → upload the `.aab` → **Review → Start rollout
   to Internal testing.**
3. **Testers** tab → add your tester email list → copy the **opt-in URL** → send
   to testers (they must open it, accept, then install from Play).
4. After this one manual upload, **every future tag auto-publishes** to the
   internal track.

Before you can roll out, clear **Policy → App content** (privacy policy, ads,
data safety, content rating, target audience, etc.).

### Path to Production (new personal accounts)

- **Internal testing** → sanity check.
- **Closed testing** → needs **12+ testers opted in for 14 continuous days**
  before "Apply for production" unlocks. Start this early.
- **Production** → staged rollout (20% → 50% → 100%).

---

## 8. iOS — App Store Connect (if shipping iOS)

The build pipeline is the `ios-release` workflow; the work is almost all
**Apple-side account setup**. There's no keystore/service-account like Android —
a single **App Store Connect API key** handles *both* signing and TestFlight
upload.

### 8a. App Store Connect API key (the iOS analog of the keystore + SA)
1. **App Store Connect → Users and Access → Integrations → App Store Connect
   API → Team Keys → ＋**. (First time: click to enable the API.)
2. **Access role: Admin.** A Developer/lower role (and sometimes even App
   Manager) **cannot create** the distribution certificate + profile, which fails
   the build later — use **Admin** to be safe.
3. Collect three things: the **`.p8`** key file (downloads **once** — save it),
   the **Key ID**, and the **Issuer ID** (top of the page).
4. **Codemagic → Team settings → Integrations → Developer Portal → Manage keys**
   → add it, named **exactly** to match `integrations: app_store_connect:` in
   `codemagic.yaml` (e.g. `<App> ASC Key`). You **also** need a persistent
   certificate private key (§8d, step 2) — those two are the Codemagic-side iOS
   secrets.

### 8b. Register the App ID + create the app record
- **Apple Developer → Certificates, Identifiers & Profiles → Identifiers → ＋ →
  App IDs → App** → type **Explicit**, Bundle ID `<BUNDLE_ID>`. Enable only the
  capabilities you actually use (In-App Purchase is on by default; leave
  Push/Sign-in/etc. off unless needed). The **Description** field rejects special
  characters — use plain text (no hyphen).
- **App Store Connect → Apps → ＋ → New App** → iOS, public **Name** (must be
  unique on the App Store), select the bundle ID, a version-free **SKU** (e.g.
  `<app>-ios`), User Access Full.

### 8c. Paid Apps agreement (only if you ship IAP; long lead — start early)
ASC → **Business** → accept the **Paid Applications Agreement** (Account Holder
only) → tax forms → bank + contact. It goes **Active in ~24h**, and **IAPs won't
load or pass review until it is.** It doesn't block the build, so kick it off
first. (Skip entirely for a free app with no IAP.)

### 8d. iOS signing & build — the working recipe

Five pieces must all line up. Miss any one and the build fails at a *different*
step, which is what makes this a slog — fix them all up front.

1. **ASC API key role = Admin** (see 8a). Lower roles can't create the
   distribution cert/profile → "No matching profiles found".

2. **Provide a persistent certificate private key.** `--create` can't mint a
   distribution certificate without a private key to build it from (→ "Cannot
   save Signing Certificates without certificate private key", which cascades to
   "no profile"). Generate one **once**:
   ```bash
   ssh-keygen -t rsa -b 2048 -m PEM -f codemagic_private_key -q -N ""
   ```
   Add the full PEM (incl. the `BEGIN/END RSA PRIVATE KEY` lines) to Codemagic
   env vars as **`CERTIFICATE_PRIVATE_KEY`** (Secure), in a group (e.g.
   `ios_credentials`) referenced via `environment.groups`. This reuses ONE cert
   across builds instead of minting throwaway certs each run.

3. **Do NOT use the `ios_signing:` environment block** on a first build. Its
   pre-build prep only *fetches* existing profiles and aborts ("No matching
   profiles found") **before** your scripts run — so the create step never
   happens. Do signing entirely in a script:
   ```
   keychain initialize
   app-store-connect fetch-signing-files "<BUNDLE_ID>" \
     --type IOS_APP_STORE \
     --certificate-key @env:CERTIFICATE_PRIVATE_KEY \
     --create
   keychain add-certificates
   xcode-project use-profiles
   ```
   `build-ipa` archives fine from the project settings that `use-profiles`
   writes — the `ios_signing` block isn't needed.

4. **Force CocoaPods** (Capacitor 8 defaults to SPM → no Podfile):
   `npx cap add ios --packagemanager cocoapods`. Run `pod install` **after**
   `cap add`/`cap sync` (Capacitor generates the Podfile at that point).

5. **Match device family to your orientation support.** A **portrait-locked** app
   can't satisfy Apple's "iPad apps must support all four orientations" rule, so a
   universal binary is rejected with **error 90474**. Either ship **iPhone-only**
   (`TARGETED_DEVICE_FAMILY = 1` in `project.pbxproj` + drop the iPad orientation
   slice), **or** support all four orientations. Pick based on your design; a
   plist-patch script can enforce whichever you choose deterministically each
   build.

**Also: iOS app icons must be fully opaque.** A transparent icon passes the local
archive but Apple **invalidates the build during processing (ITMS-90717)** with
email as the only signal. Flatten the source onto your `<BRAND_BG>` before
generating the AppIcon set so a stray alpha channel can't slip through.

### 8e. Version numbers, build → TestFlight → submit
- **Set the marketing version + build number in CI** so the store build shows the
  real version (not Capacitor's template `1.0`): marketing version
  (`CFBundleShortVersionString`) from your single version source, build number
  (`CFBundleVersion`) from Codemagic's monotonic `$BUILD_NUMBER` (Apple rejects
  duplicates). e.g. `agvtool new-marketing-version "$VERSION"` +
  `agvtool new-version -all "$BUILD_NUMBER"`.
- Build `ios-release` (tag or branch `main`) → uploads to **TestFlight** (~5–15
  min Apple processing before it's testable).
- In ASC, fill **App Privacy**, **age rating**, **screenshots** (per current
  required device sizes), and the **listing** copy. If you ship IAP, create the
  products (reuse the Android product IDs) + a **sandbox tester** and sandbox-test
  on a real device via TestFlight.
- Add **App Review notes** → submit.

> **App Privacy must match what you actually ship.** If the app includes an ad
> SDK (e.g. AdMob) or any analytics, you must declare the collected data types
> **and Tracking** in App Store Connect — "Data Not Collected" is only correct
> for an app that genuinely collects nothing. An ad SDK also requires
> `GADApplicationIdentifier`, an ATT `NSUserTrackingUsageDescription`, and
> `SKAdNetworkItems` in Info.plist (stamped by your plist-patch script), and the
> ad SDK pod present in `Podfile.lock`.

Notes: macOS build minutes are **paid** (no free iOS CI). Keep ad/IAP config in
sync with the Android side so the two platforms don't diverge.

---

## 9. Troubleshooting — errors seen in practice

| Symptom | Cause | Fix |
|---|---|---|
| **`No keystores with reference '<app>_upload_keystore' were found`** | Keystore not uploaded, or reference name mismatch | Upload it (§4b); the reference name must exactly match `android_signing` in the YAML |
| **401 when uploading the keystore** | Stale session after switching Codemagic accounts/teams, or wrong team/role | Fully log out and back in; confirm the right **team** with **owner/admin** role; try incognito |
| **`The selected instance type is not available with the current billing plan`** | Free plan can't run `linux_x2` / `mac_mini_m2`; macOS is always paid | Upgrade to the **Team plan** (or downgrade the instance type for Android-only) |
| **`Google Play service account credentials could not be used: Expecting value: line 1 column 1 (char 0)`** | `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` is **empty** (often wiped by an account/team switch) — JSON parser hit an empty string | Add the var in the **current team**, group `google_play`, value = the **full JSON**, Secure (§5c) |
| **`The Capacitor CLI requires NodeJS >=22.0.0`** | `codemagic.yaml` pinned an older Node | Set `node: 22` in **both** workflows |
| **`error: invalid source release: 21`** (Gradle `compileReleaseJavaWithJavac`) | Build machine's JDK older than 21; Capacitor's android lib needs Java 21 | Add `java: 21` to the android workflow's `environment` |
| **`Publishing` fails on the very first Android build** | Expected — Google blocks the first API upload | Do the **manual first upload** in Play Console (§7); auto-publish works after |
| **Bundle rejected: package name mismatch** | Bundle's `applicationId` ≠ the Play app's package | Package is permanent — make the repo match the store app (§6) |
| **Build ran the wrong commit / old package** | Tag points to a pre-fix commit | Re-point the tag, or build branch `main` (§7) |
| **Tag push doesn't start a build** | Repo connected without the GitHub App → no webhook | Reconnect via the Codemagic **GitHub App**; verify the webhook exists (§3) |
| **(iOS) `No matching profiles found … distribution type "app_store"`** | The `ios_signing` block's prep ran (fetch-only → aborts before `--create`), or no cert/profile got created | **Remove** the `ios_signing` block; create explicitly with `--certificate-key --create`; ASC key must be **Admin** (§8d, 1–3) |
| **(iOS) `Cannot save Signing Certificates without certificate private key`** | `--create` has no private key to mint the cert from | Add a persistent **`CERTIFICATE_PRIVATE_KEY`** and pass `--certificate-key @env:CERTIFICATE_PRIVATE_KEY` (§8d, 2) |
| **(iOS) `No 'Podfile' found in the project directory`** | Capacitor 8 defaults to **SPM**, so `cap add ios` made an SPM project with no Podfile | `npx cap add ios --packagemanager cocoapods`; `pod install` after `cap add`/`sync` (§8d, 4) |
| **(iOS) upload rejected `90474` — orientations / iPad multitasking** | Portrait-locked app shipped as a universal (iPad-capable) binary | Ship **iPhone-only** (`TARGETED_DEVICE_FAMILY = 1` + drop iPad orientation slice), or support all 4 orientations (§8d, 5) |
| **(iOS) build invalidated after upload — `ITMS-90717` (transparent icon)** | App icon has an alpha channel | Flatten the icon onto an opaque background before generating the AppIcon set (§8d) |
| **`keytool` not recognized** (Windows) | JDK not on PATH | Call it by full path from the Android Studio JBR (§4a) |
| **"JKS is a proprietary format… migrate to PKCS12"** | Informational warning | Ignore — JKS is fine |
| **`cap sync` changed `capacitor.build.gradle` locally** | Generated-file churn (often just CRLF/LF) | `git checkout -- android/app/capacitor.build.gradle android/capacitor.settings.gradle` |
| **Play warning: "No deobfuscation file associated with this App Bundle"** | R8/ProGuard off (`minifyEnabled false`) → no mapping file | **Safe to ignore** — code isn't obfuscated, so traces are readable. Optionally enable R8 later (below) |

### Optional: R8 / ProGuard (smaller app + the deobfuscation file)

Shipping with `minifyEnabled false` means the app isn't shrunk or obfuscated, and
Play shows *"No deobfuscation file associated with this App Bundle"* — **a
harmless warning, not a blocker.** Enabling R8 is a good **post-launch** task:

1. Set `minifyEnabled true` in `android/app/build.gradle`.
2. **Test thoroughly** — R8 renames/strips code and can break reflection-based
   pieces: the **Capacitor WebView bridge, Capacitor plugins, ad SDKs, and Play
   Billing**. Add `-keep` rules in `android/app/proguard-rules.pro` as needed.
3. Once enabled, AGP **embeds the mapping file in the AAB automatically**, so Play
   associates it on upload and the warning disappears — no manual upload. Keep a
   `mapping.txt` artifact glob in `codemagic.yaml` (harmlessly skipped until R8 is
   on).

---

## 10. Quick checklist for a NEW app

- [ ] Pick the **final package id** (`<BUNDLE_ID>`) — set it in build.gradle
      (`applicationId` + `namespace`), capacitor.config.json (`appId`), and
      codemagic.yaml (iOS `bundle_identifier` + `fetch-signing-files`).
- [ ] Create the app in **Play Console** (and App Store Connect for iOS) with
      that exact id.
- [ ] Connect the repo in Codemagic via the **GitHub App**; confirm the webhook
      exists; set build config to `codemagic.yaml`.
- [ ] `codemagic.yaml`: `node: 22` (+ `java: 21` on Android); keystore reference
      name; `google_play` group; `track`.
- [ ] Generate the upload keystore (§4a) → back it up → upload to Codemagic (§4b).
- [ ] Google Cloud: project (no org) → enable Play Developer API → service
      account → JSON key (§5a).
- [ ] Play Console → Users and permissions → invite the SA email (§5b).
- [ ] Codemagic: `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` (full JSON, Secure, group
      `google_play`) (§5c).
- [ ] **iOS only:** ASC **API key (Admin)** registered as `<App> ASC Key`;
      generate + add **`CERTIFICATE_PRIVATE_KEY`** (Secure, group
      `ios_credentials`); register the **App ID** + create the **app record**;
      start the **Paid Apps agreement** if shipping IAP. In `codemagic.yaml`:
      **no** `ios_signing` block, `cap add ios --packagemanager cocoapods`, the
      `--certificate-key --create` signing step, opaque icon flatten, and device
      family matching your orientation support (§8).
- [ ] Clear **Policy → App content** forms in Play Console; fill **App Privacy**
      in ASC to match what you actually ship (ads/analytics = declare it).
- [ ] Tag `vX.Y.Z` (or build branch `main`) → build → **first Android publish
      will fail** → download `.aab` → **manual first upload** to Internal testing
      (§7).
- [ ] Add testers, share the opt-in link.
- [ ] Confirm a second build's `Publishing` step now succeeds.
- [ ] Start **closed testing** early if you need the 14-day production clock.
- [ ] *(Optional, post-launch)* enable R8/ProGuard — test Capacitor plugins / ads
      / IAP and add keep rules first.

---

*Project-neutral template. Fill in the placeholders (top) and keep this alongside
your repo's `codemagic.yaml`.*
