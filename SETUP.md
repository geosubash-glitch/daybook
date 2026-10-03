# Daybook: set-up guide

Daybook is your journal as a website (for the laptop) and an Android app (for the phone).
Your entries are stored online in **your own** free Firebase account, so they do not depend on Claude, on this
project's author, or on any subscription. You can write with no internet; it uploads when you are back online.

Do the steps in order. It takes about 30 minutes, once.

## 1. Make the online storage (Firebase, free)

1. Go to https://console.firebase.google.com and sign in with your Google account.
2. **Create a project**. Name it `daybook`. Turn Google Analytics **off**.
3. In the left menu open **Build, then Authentication**. Press **Get started**, choose **Email/Password**, switch it on, Save.
4. Still in Authentication, open the **Users** tab, press **Add user**, and type your email and a strong password.
   This is how you sign in to Daybook. Write the password down somewhere safe.
5. Open Authentication, **Sign-in method**, and also switch on **Google** (pick your email as the support email). Then **Settings**, **User actions**, and keep **Enable create (sign-up)** ticked so other people can join with Google. To make Daybook just yours instead, untick it.
   Now nobody else can make an account.
6. Open **Build, then Firestore Database**. Press **Create database**, choose **Production mode**, and pick the
   location nearest to you (for India, `asia-south1` Mumbai). You cannot change the location later.
7. In Firestore, open the **Rules** tab. Delete what is there, paste in everything from the file `firestore.rules`
   in this folder, and press **Publish**. This is what keeps your journal private to you.
8. Press the gear icon, **Project settings**, scroll to **Your apps**, press the web icon `</>`, name it `daybook`,
   and register it. You will see a block of settings. Copy `apiKey`, `authDomain`, `projectId` and `appId`.
9. Open `docs/config.js` in this folder with any text editor and replace the four `PASTE_...` values with those.
   (These are not secrets. Your journal is protected by your sign-in and the rules from step 7.)

## 2. Put the website online (GitHub Pages, free)

1. Make a free account at https://github.com.
2. Press **New repository**. Name it `daybook`. Choose **Public**. Create it.
3. Upload this whole folder: **Add file, Upload files**, drag everything in, **Commit**.
   If the hidden folder `.github` did not upload, press **Add file, Create new file**, type
   `.github/workflows/android.yml` as the name, paste the contents of that file, and commit.
4. Open the repository **Settings, then Pages**. Under **Branch** choose `main` and the folder `/docs`. Save.
5. After a minute your site is at `https://YOUR-GITHUB-NAME.github.io/daybook/`. Open it and sign in with the email
   and password from step 1.4.
6. Back in Firebase, open Authentication, **Settings, Authorized domains**, add `YOUR-GITHUB-NAME.github.io`.

## 3. Get the Android app (APK)

1. In your GitHub repository open the **Actions** tab. If asked, press the green button to enable workflows.
2. Choose **Build Android APK** and press **Run workflow**. It also runs by itself whenever you change the website.
   It takes about 5 to 10 minutes.
3. When it finishes, open the repository front page and press **Releases** on the right, then **Daybook Android app**.
4. On your phone, download `app-debug.apk` from that page and open it. Android will ask to allow installs from
   this source. Allow it. Sign in once with the same email and password.

If the build fails, open the failed run in Actions and send the red error to me. Plan B that needs no build:
open the website in Chrome on your phone and choose **Install app** (or Add to Home screen).

## 4. Use it

- Settings (the sliders icon): set a **passcode** and a recovery word. Grammar fixing needs no setup.
  (https://aistudio.google.com/apikey) to switch on scanning handwritten pages and fixing spelling and grammar.
- Print or PDF: pick the time span; the sheet is A4 landscape with two days per sheet, one day per A5 page.
- Plain text saves only your writing with its dates.
- **Full backup** saves every entry and photo into one file. Do it once a month and keep it in two places.
- Moving from the earlier Claude version: in that version open Browse, Print and export, Backup, then here use
  **Restore backup**. Text carries over; photos from that version cannot.

## Good to know

- The passcode is a screen lock. Your entries are protected by your sign-in and the rules, but they are not
  end-to-end encrypted, so Google's systems can technically store and read them as with any Firebase app.
- Offline: writing is kept on the device and uploads on its own. Do not clear the app's data or uninstall it while
  it still says it is waiting to upload. Scanning, settings, backups and restoring need internet.
- The free Firebase plan (Spark) is far above what a journal needs: 1 GiB storage and tens of thousands of reads and
  writes a day. Photos are shrunk before saving so they stay small.
- Google changes AI model names now and then. If scanning stops working, change the model name in Settings.
- Everything is plain files: `docs/` is the whole app. `docs/store-firebase.js` is the only file that talks to
  Firebase, so the storage can be moved to another service someday without rewriting the app.
