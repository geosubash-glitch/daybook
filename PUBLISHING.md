# Publishing Daybook as a real app

This is the checklist, in order. Items marked **done** are already in this repository.

## What Google Play requires, and where Daybook stands

| Requirement | Status |
|---|---|
| Targets Android 16 (API 36). Required for new apps since 31 Aug 2026 | **done**. The build fails on purpose if it ever drops below 36 |
| Privacy policy on a public web page | **done**: `docs/privacy.html` |
| Terms of use | **done**: `docs/terms.html` |
| Delete account from inside the app | **done**: Settings, then Delete account |
| Delete account web page, entered in the Data safety form | **done**: `docs/delete-account.html` |
| Store artwork: 512 px icon, 1024x500 feature graphic, phone screenshots | **done**: `docs/icons/icon-512.png`, `store/` |
| Store text and form answers | **done**: `store/listing.md` |
| A properly signed release bundle (.aab) | step 3 below |
| Developer account | step 1 below |
| Closed test, then production access | step 5 below |

## Step 1. Create the Play developer account (you do this)
1. Go to https://play.google.com/console and sign up. One-time fee of 25 US dollars.
2. Choose **Personal** (you as an individual) or **Organisation** (needs a registered business and a D-U-N-S number).
3. Verify your identity as asked.

**Know this before you start:** a new personal account must run a **closed test with at least 12 testers, all opted in for 14 days in a row**, before it may apply for public release. Line up 12 friends or family with Gmail accounts now. An organisation account does not have this rule.

## Step 2. Add the Play signing fingerprint to Firebase
Google Sign-In on the phone checks the app's signing fingerprint. When the app is on Play, Google re-signs it with its own key.
1. Play Console, then your app, then **Test and release**, then **App integrity**, then **App signing**. Copy the **SHA-1** of the "App signing key certificate" and also of the "Upload key certificate".
2. Firebase console, then Project settings, then your Android app, then **Add fingerprint**. Add both.

## Step 3. Make a private upload key, then build the bundle
1. On any computer with Java: `keytool -genkeypair -v -keystore upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000`
2. **Keep `upload.keystore` and its passwords somewhere safe, outside this repository.** Losing it is recoverable through Play support but slow.
3. Turn it into text: `base64 -w0 upload.keystore` (on Mac: `base64 -i upload.keystore`).
4. GitHub, then this repository, then Settings, then Secrets and variables, then Actions. Add four secrets: `UPLOAD_KEYSTORE_BASE64` (the text from step 3), `UPLOAD_KEYSTORE_PASSWORD`, `UPLOAD_KEY_ALIAS` (`upload`), `UPLOAD_KEY_PASSWORD`.
5. Actions tab, then **Build Play Store bundle**, then Run workflow. Download `app-release.aab` from the finished run.

The `debug.keystore` in `signing/` is public and is only for the test APK on your own phone. Never upload anything signed with it to Play.

## Step 4. Fill in the store listing and forms
Everything to paste is in `store/listing.md`: description, categories, privacy policy URL, the account deletion URL, and the answers for Data safety and content rating. Upload `docs/icons/icon-512.png`, `store/feature-graphic-1024x500.png` and the pictures in `store/screenshots/`. Create a **test Google account** for the reviewer and put its details in App access.

## Step 5. Test, then release
1. Create a **closed testing** release, upload the .aab, add your 12 testers by email, and send them the opt-in link.
2. Keep it running 14 days with 12 opted in. Then apply for production access on the Dashboard.
3. After approval, promote the same release to production. First review usually takes a few days.

## Keep it safe and healthy (backend)
Already in place: owner-only database rules with size and shape checks on everything written, sign-in with Google, email enumeration protection, no server code or secrets in the app, a delete-everything path.

Do these as the app grows:
- **App Check** (Firebase console, then App Check): turn on Play Integrity for Android and reCAPTCHA for the web, then enforce it for Firestore. Stops other programs from using your database quota.
- **Restrict the web API key** (Google Cloud console, then APIs and Services, then Credentials): limit it to the Firebase and Identity Toolkit APIs, and to the website `geosubash-glitch.github.io` plus the Android app. Check sign-in still works after each change.
- **Free plan limits** (Firestore Spark): 1 GiB stored, 50,000 reads and 20,000 writes a day, for all users together. If many people join, move to the Blaze plan **and set a budget alert** (Billing, then Budgets) before you do.
- **Backups**: Firestore, then Disaster Recovery, to schedule automatic backups once you are on Blaze.
- **Updates**: the Android target level rises every year in August. Change the Capacitor version in the workflows and rebuild.

## Honest limits
- Entries are protected by sign-in and Google's encryption, but are not end-to-end encrypted. The privacy policy says this. If you want true end-to-end encryption, it is a big redesign (and a forgotten key then means lost writing).
- The legal pages are plain-language drafts, not legal advice. If Daybook grows, have a lawyer read them, especially for GDPR (Europe) and India's DPDP Act.
