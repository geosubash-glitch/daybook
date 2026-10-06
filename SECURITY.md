# Daybook privacy and security review

Reviewed 4 Oct 2026. Honest notes on what protects the journal, and what does not.

## What shows where
| Place | What it shows |
|---|---|
| Home-screen widget | Dates and whether a day has writing. Never a title, excerpt or text. |
| Reminder notification | Fixed text: "A few lines about today?". Never journal content. |
| Recent-apps screen | Blank thumbnail by default (Android 13+). Setting: Privacy. |
| Lock screen of the phone | Only the generic reminder text above. |

## Locking
- Passcode: PBKDF2 (150,000 rounds, random salt) checked on the device. It is a screen lock, not encryption. Encryption is separate, in Settings > Encryption.
- Fingerprint (optional, Android): confirms you, then opens the same screen lock. The passcode is always the fallback.
- When it locks (Settings): only at start, every time you return, or after 1 / 2 / 5 / 15 minutes away. The default is 2 minutes, so tapping the widget right after writing does not ask again.
- The lock screen is drawn before any entry is loaded, so nothing is readable before unlocking.

## Database (Firestore rules, reviewed)
- Each account can reach only `users/{its own id}`; everything else is closed.
- Every write is checked for shape and size (entry text 200,000 characters, 24 photos, small settings documents).
- Settings now allow only the `autoFix` preference. The old unused AI-key fields are gone from the rules (republish `firestore.rules` in the Firebase console to apply).
- Rules are tested on every push in the Firebase emulator (`tests/rules.test.mjs`, workflow `tests`).
- Console items still to do by hand: see Abuse and cost protection below.

## Grammar service
- Only the text being corrected (the entry, or the paragraph being written) goes to the public LanguageTool API. No account details, no other entries.
- First use asks for confirmation on that device. Leave it off for very private writing.

## Backup and restore
- A backup is one plain JSON file, not encrypted. Keep it somewhere private. Restore only adds missing days and never overwrites; a failed restore can leave unused photo records (harmless storage).

## End-to-end encryption (optional, built)
Settings > Encryption > "Encrypt my journal". Off until the person turns it on.
- A random 256-bit data key encrypts every entry (title and text) and photo on the device with AES-GCM before upload. Each item is bound to its date or id, so a row cannot be swapped for another.
- The data key is wrapped twice, with a passphrase (8+ characters) and with a random recovery key (100 bits), each through PBKDF2-SHA256 at 600,000 rounds. Only the wrapped copies are stored (`settings/keys`).
- Turning it on: shows the recovery key, requires a plain backup file first, then encrypts every entry and photo and re-opens each one to check it before replacing the plain copy. If it is interrupted it resumes the next time the app opens.
- Once finished, the database rules refuse plain writes, so an old copy or bug cannot quietly save plain text again.
- Each phone asks for the passphrase once, then keeps the key as a non-extractable key in the browser's IndexedDB (switch off: "Remember on this phone"). Signing out removes it.
- Forget the passphrase and the recovery key and the journal is permanently unreadable. There is no reset.
- What is NOT hidden: entry dates, how many photos a day has, and when it was saved. The developer can see those, not the writing.
- What is NOT built: turning encryption off again (a plain backup can be exported). The old 4-character passcode stays a screen lock only.
- Weak spot to know: a short or guessable passphrase can be guessed offline by anyone who gets a copy of the database. Use a long one.
- Tested: `tests/e2ee.test.mjs` (round trips, wrong keys, migration, new phone, recovery, interrupted rows). Not tested: a real phone and the live Firebase project.

## Abuse and cost protection
- App Check support is in the web app but off until `appCheckKey` (a reCAPTCHA v3 site key) is added to `docs/config.js`. Do NOT switch enforcement on for Firestore until the Android app also has an App Check provider (Play Integrity), or the app will stop saving. Without enforcement it protects nothing.
- Firestore rules cannot count documents or limit write speed. Per-item limits are enforced (text size, 24 photos per entry, dates 1900 to 2100). A per-account total cap needs App Check plus the budget alerts below.
- Console steps for you: (1) Google Cloud > APIs & Services > Credentials > the Browser key > restrict by HTTP referrer to `geosubash-glitch.github.io/*` and `localhost`, and to the Identity Toolkit, Firestore and Token Service APIs; (2) Billing > Budgets & alerts > a small budget with 50 / 90 / 100 percent emails; (3) Firebase > App Check > register the web app with reCAPTCHA v3.

## Content security policy
`docs/index.html` carries a CSP that allows only the app's own files, Google sign-in, Firebase, and the LanguageTool grammar service. It was tested in a headless browser against the local test build, not against live Firebase sign-in or the Android WebView. If sign-in or grammar stops working after this release, a blocked address is the first suspect (browser console shows "Refused to ...").

## Samsung-only extras (not built)
Lock-screen widget, Now Bar and a Quick Settings tile depend on the Galaxy F56 and its One UI version. Each needs testing on the real phone before building; none should show journal text.
