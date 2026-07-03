# PlugIdle — iOS App Store Launch (Design Spec)

- **Date:** 2026-06-18
- **Status:** Approved design → ready for implementation plan
- **Owner:** Nick Overstreet (solo dev, Windows; no Mac)

## 1. Summary

Ship **PlugIdle** to the Apple App Store reusing the existing single codebase. The app
is already a Capacitor 8 project shipping on Android; iOS is added as a **second native
target**, not a rewrite. Because the developer has no Mac, the iOS Xcode project is
**generated in CI (Codemagic) on every build from declarative config** and never
committed. The launch ships **in-app purchases only** (the same six products as Android,
via Apple IAP); rewarded AdMob ads are explicitly deferred to a v1.1 so the first
submission carries no IDFA / App Tracking Transparency / ad-privacy surface.

## 2. Current state (facts grounding this design)

- Vanilla JS/HTML/CSS PWA, no build step; repo root is the source of truth.
- Capacitor 8 wrapper; **`android/` is committed**. No `ios/` exists.
- `scripts/build-www.mjs` stages web assets into a gitignored `www/` (Capacitor `webDir`).
- Monetization bridge `js/monetize.js`: rewarded ads via `@capacitor-community/admob`,
  IAP via `cordova-plugin-purchase`, all gated behind `Capacitor.isNativePlatform()`.
  **IAP code currently hardcodes `Platform.GOOGLE_PLAY` in five places.**
- Repo is **public** on GitHub (`NickOverstreet/PlugIdle`); Pages deploys via Actions.
- Six IAP products defined in `store/play-console-checklist.md`:
  `supporter_pack`, `boost_production_25`, `starter_cores` (non-consumable),
  `timewarp_4h`, `timewarp_24h` (consumable), `theme_pack_phosphor` (non-consumable).

## 3. Decisions locked during brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Build/submit environment | **Cloud CI (no Mac)** | Developer is on Windows; never needs to own a Mac. |
| CI service | **Codemagic** | Automatic iOS code signing via App Store Connect API key (manages cert + profile); built-in TestFlight/App Store publishing; free tier covers a small app. |
| `ios/` project | **CI-generated, NOT committed** | No Mac to generate/maintain a committed project; forces config-as-code; fully reproducible from Windows. |
| Launch monetization | **IAP only** | De-risks first review; no ATT prompt / SKAdNetwork / app-ads.txt; captures higher-margin revenue. |
| AdMob on iOS | **Excluded from the build at launch** | Avoids the `GADApplicationIdentifier`-or-crash requirement and all IDFA/ATT/privacy surface. Returns in v1.1 with a proper ATT flow. |
| Apple Developer Program | **Already enrolled** | App Store Connect is available immediately. |

## 4. Goals / Non-goals

**Goals**
- A signed iOS release of the full game, built Mac-free, delivered to TestFlight and
  then submitted to the App Store.
- The six IAP products working on iOS via Apple IAP, sharing the Android product-ID strings.
- The web PWA and Android app behavior unchanged.
- Project docs (`CLAUDE.md`, `GOAL.md`, `README.md`) reflect the iOS pipeline.

**Non-goals (this launch)**
- Rewarded ads / AdMob on iOS (deferred to v1.1).
- App Tracking Transparency, SKAdNetwork, `app-ads.txt`.
- iPad-optimized layouts (ship iPhone-only; iPhone screenshots only).
- Cloud save / Game Center (future, mirrors Android backlog).
- Committing the `ios/` project.

## 5. Architecture

One codebase. `build:www` stages the same web assets used by Android and Pages.
Capacitor's iOS platform wraps them in a WKWebView shell. All iOS-specific native
configuration is **declarative** so Codemagic can regenerate `ios/` from scratch each
build and produce an identical, signable archive:

```
repo root (web source of truth)
  └─ build:www ──► www/ (gitignored)
        └─ Capacitor iOS target (CI-generated each build)
              ├─ capacitor.config.json   → ios block (background, content inset)
              ├─ scripts/patch-ios-plist  → Info.plist keys (orientation, encryption)
              ├─ @capacitor/assets        → icon set + CRT-dark splash from assets/
              └─ Codemagic                → automatic signing → archive → TestFlight
```

## 6. Components

### 6.1 Capacitor iOS target
- Add `@capacitor/ios` to `package.json` `dependencies` (where `@capacitor/android`
  already lives; match the `^8` version line).
- Add an `ios` block to `capacitor.config.json`: `backgroundColor: "#070a0f"`,
  `contentInset: "never"`.
- Add npm scripts: `sync:ios` (`build:www` + `cap sync ios`) and `open:ios` for parity,
  understanding `open:ios` is only usable on a Mac.
- `ios/` and `www/` remain gitignored (no `.gitignore` change needed for `ios/` if the
  build outputs are covered; add `ios/` explicitly to be safe).
- Do **not** lower the minimum iOS deployment target produced by the generated project.

### 6.2 iOS IAP path (`js/monetize.js`)
- Introduce a single `STORE_PLATFORM` constant chosen at init:
  `Capacitor.getPlatform() === 'ios' ? Platform.APPLE_APPSTORE : Platform.GOOGLE_PLAY`.
- Replace the five hardcoded `Platform.GOOGLE_PLAY` references (`register`, `initialize`,
  `pushPrices` get, `buy` get) with `STORE_PLATFORM`.
- Reuse the **same six product-ID strings**; they are created per-store but the strings
  match, so no game-side or catalog divergence.
- Existing behavior preserved: idempotent local grants, restore-purchases button,
  `PAYMENT_CANCELLED` suppression. Consumables (`timewarp_*`) are consumed immediately;
  Apple does not restore consumables, which matches current Android behavior.

### 6.3 AdMob excluded from iOS
- Gate ad initialization to Android only at launch (e.g. an `ADS_PLATFORM === 'android'`
  guard around `initAds`/`adsAvailable`), so `Monetize.adsAvailable()` is false on iOS and
  the game renders no ad UI.
- **Exclude the Google Mobile Ads SDK from the iOS build** so the binary carries no IDFA
  symbols. Mechanism (decide in plan): a `cap add ios` post-step that removes the AdMob
  pod from the generated `Podfile` before `pod install`, or Capacitor's per-platform
  plugin exclusion. Verify the archived app contains no `GADApplicationIdentifier`
  requirement and launches cleanly.

### 6.4 iOS assets
- Add an `assets/` source dir with a **1024×1024** `icon.png` (App Store marketing icon)
  and a CRT-dark `splash.png`. Extend the existing pure-Python PNG encoder
  (`scripts/make_icons.py` family) to emit the 1024 icon, keeping the dependency-free
  approach; the splash can be a solid `#070a0f` with the logo.
- Generate the iOS icon set + splash with `npx @capacitor/assets generate --ios`
  (cross-platform Node; runs in CI after `cap add ios`).

### 6.5 Native config / Info.plist (`scripts/patch-ios-plist`)
A committed script run in CI after `cap add ios`, applied with PlistBuddy on the macOS
runner, sets:
- `CFBundleDisplayName` = `PlugIdle`
- Bundle id = `com.ignyte.plugidle` (set by Capacitor `appId`; verified by script)
- `UISupportedInterfaceOrientations` = portrait only (matches Android portrait lock)
- `ITSAppUsesNonExemptEncryption` = `NO` (export-compliance exempt; skips the per-build
  encryption questionnaire)
- **No** ATT / `NSUserTrackingUsageDescription` keys (no tracking at launch)

### 6.6 Codemagic pipeline (`codemagic.yaml`)
- Trigger: manual and on `v*` git tags.
- macOS instance. Steps:
  1. `npm ci`
  2. `npm run build:www`
  3. `npx cap add ios` (ephemeral) → AdMob pod exclusion step → `npx cap sync ios`
  4. `npx @capacitor/assets generate --ios`
  5. `scripts/patch-ios-plist` (PlistBuddy)
  6. **Automatic signing** via App Store Connect API key (Codemagic-managed distribution
     cert + provisioning profile)
  7. `xcode-project build-ipa` / `xcodebuild` archive + export
  8. Publish to **TestFlight** (and to App Store review when promoting a release)
- Secrets stored **in Codemagic, not the repo**: ASC API key `.p8`, issuer id, key id,
  bundle id, Apple team id. (User supplies these from App Store Connect → Users and
  Access → Integrations → App Store Connect API.)

### 6.7 App Store Connect setup (user, from a written checklist)
New `store/app-store-connect-checklist.md` covering:
- Register the App ID / bundle id; create the app record (name, primary language, SKU).
- **Sign the Paid Apps agreement; complete banking + tax** (hard prerequisite — IAP will
  not load or pass review without it).
- Create the six IAP products (reuse IDs; map types/prices from
  `store/play-console-checklist.md`); add localized names/descriptions; add a sandbox tester.
- App Privacy questionnaire: minimal — no tracking; purchases handled by Apple; saves are
  device-local. (Likely "Data Not Collected" aside from Apple-handled purchase data.)
- Age rating questionnaire.
- 6.7″ iPhone screenshots (reuse the Android shot list in `store/listing.md`).
- Privacy-policy URL = live `privacy.html`.
- App Review notes that pre-empt **Guideline 4.2** (full offline idle game, no login, not a
  web wrapper) and confirm **Guideline 3.1.1** (digital goods sold via Apple IAP).
- Listing copy in a new `store/app-store-listing.md` (mirrors `store/listing.md`, adjusts
  any Google-specific wording, "no forced ads / no pay-to-win").

### 6.8 Documentation updates
- **Create `CLAUDE.md`** (project root): concise operating guide for future sessions —
  the `build:www` staging model; **Android committed vs iOS CI-generated (never commit
  `ios/` or `www/`)**; monetization platform gating (`Platform.GOOGLE_PLAY` /
  `APPLE_APPSTORE`, ads Android-only at launch); Codemagic build flow; icon generation;
  the source-of-truth-at-root rule.
- **`GOAL.md`**: add an **"## iOS App Store Launch"** section (Codemagic, IAP-only,
  AdMob-deferred, the prerequisites and sprint steps), and broaden the Android-only framing
  in the Vision/intro to acknowledge the iOS target.
- **`README.md`**: add a **"🍏 iOS (Capacitor)"** section paralleling the Android one
  (Mac-free Codemagic flow, `ios/` is CI-generated); update the project-structure block;
  adjust the monetization sentence so it notes iOS ships IAP (ads later).

## 7. Responsibility split

| Stage | Where |
|---|---|
| All code, config, assets, scripts, `codemagic.yaml`, docs | Claude, on Windows |
| Build, sign, archive, upload to TestFlight / App Store | Codemagic (cloud macOS) |
| Supply ASC API key + team id to Codemagic | User |
| App record, Paid Apps agreement, IAP products, listing, screenshots, Submit | User, in App Store Connect |
| IAP sandbox testing on a real device via TestFlight | User |

## 8. Testing & verification

- **Build green** in Codemagic; archive uploads to TestFlight.
- **Launch smoke test** via TestFlight on a real device: game loads, saves persist across
  relaunch, portrait lock, CRT splash, no AdMob/crash.
- **IAP end-to-end** with a sandbox Apple ID: each of the six products purchases, grants
  the entitlement, and (for non-consumables) restores; prices display from the store.
- **Web + Android unchanged**: `Monetize.adsAvailable()` still true on Android; PWA renders
  zero monetization UI.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Guideline 4.2** web-wrapper rejection | Review notes emphasize offline depth, no login, native game; the app genuinely works offline. |
| Paid Apps agreement / banking not active → IAP fails | Flagged as a hard prerequisite before any IAP test or submission. |
| AdMob SDK in binary → `GADApplicationIdentifier` crash / privacy surface | Exclude the pod from iOS; verify archive launches and declares no tracking. |
| `cordova-plugin-purchase` StoreKit quirks under Capacitor | Validate via TestFlight + sandbox before submission; keep local idempotent grants. |
| Ephemeral `ios/` drift / non-reproducible config | All native config is declarative (config.json + plist script + assets); no manual Xcode edits. |
| Public repo leaking signing secrets | Secrets live in Codemagic, never in the repo; no signing material committed. |
| First archive needs the App ID/app record to exist | Checklist sequences App Store Connect setup before the first publishing build. |

## 10. Prerequisites the user must provide

1. App Store Connect API key (`.p8`), issuer id, key id (for Codemagic signing).
2. Apple Team ID.
3. Paid Apps agreement signed + banking/tax complete (for IAP).
4. A sandbox tester Apple ID (for IAP testing).

## 11. Out of scope (future)

- v1.1: rewarded AdMob ads on iOS with ATT consent + SKAdNetwork + `app-ads.txt`.
- iPad-optimized UI; Game Center; cloud save (mirror Android backlog).
