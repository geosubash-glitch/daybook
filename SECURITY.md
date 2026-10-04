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
- Passcode: PBKDF2 (150,000 rounds, random salt) checked on the device. It is a screen lock, not encryption.
- Fingerprint (optional, Android): confirms you, then opens the same screen lock. The passcode is always the fallback.
- When it locks (Settings): only at start, every time you return, or after 1 / 2 / 5 / 15 minutes away. The default is 2 minutes, so tapping the widget right after writing does not ask again.
- The lock screen is drawn before any entry is loaded, so nothing is readable before unlocking.

## Database (Firestore rules, reviewed)
- Each account can reach only `users/{its own id}`; everything else is closed.
- Every write is checked for shape and size (entry text 200,000 characters, 24 photos, small settings documents).
- Settings now allow only the `autoFix` preference. The old unused AI-key fields are gone from the rules (republish `firestore.rules` in the Firebase console to apply).
- Not yet done (see PUBLISHING.md): App Check, API-key restrictions, budget alerts.

## Grammar service
- Only the text being corrected (the entry, or the paragraph being written) goes to the public LanguageTool API. No account details, no other entries.
- First use asks for confirmation on that device. Leave it off for very private writing.

## Backup and restore
- A backup is one plain JSON file, not encrypted. Keep it somewhere private. Restore only adds missing days and never overwrites; a failed restore can leave unused photo records (harmless storage).

## End-to-end encryption: assessment (not built)
Entries are readable by the project owner in the Firebase console, as with any Firebase app. True end-to-end encryption would fix that, but changes what the app can do:
- Key: derived from the passcode (or a separate key). Forget it and every entry is gone for good, so the recovery word would have to become a real key backup, not a reset.
- Search, the widget streak, the grammar check and the PDF would all need the key unlocked on the device; the server could no longer search or help.
- Every earlier entry must be re-encrypted once, and phones must share the key safely.
Recommendation: do it only if you want the project owner unable to read journals. It is a few days of careful work and needs a tested recovery flow first.

## Samsung-only extras (not built)
Lock-screen widget, Now Bar and a Quick Settings tile depend on the Galaxy F56 and its One UI version. Each needs testing on the real phone before building; none should show journal text.
