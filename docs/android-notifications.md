# Making low-balance alerts show up inside the Android app

The web app already warns about a low balance two ways: a toast while you're
looking at it, and a browser notification via the `Notification` API /
service worker. That second kind mostly does **not** show as a real Android
notification inside a Capacitor-wrapped app, because Android's WebView
doesn't implement it the way Chrome does.

To get a real, native Android notification, add Capacitor's own
**Local Notifications** plugin to the Android project (not this repo — the
Android Studio project you build the APK from). The web app already looks
for this plugin at runtime (`public/js/app.js`, `nativeNotifier()`) and uses
it automatically once it's present; nothing else in the web app needs to
change.

## One-time setup, in the Capacitor/Android project

```bash
npm install @capacitor/local-notifications
npx cap sync android
```

Then in Android Studio:

1. **Build → Clean Project**, then **Build → Build APK(s)**.
2. Install the new APK on the phone (uninstall the old one first if it's
   still giving you trouble).
3. Open the app, go to **Settings → Low balance → Notifications** and turn
   it on. Android 13+ will prompt for the notification permission — tap
   **Allow**. (On older Android versions there's no prompt; notifications
   are allowed by default unless you've turned them off for the app under
   *Settings → Apps → PrepaidPro → Notifications*.)
4. Tap **Test** next to "Notifications" in the app to confirm a real
   notification appears in the Android notification shade.

No manifest editing is needed — the plugin adds the permission it needs by
itself when you run `npx cap sync`.

## What this does and doesn't fix

- **Fixes:** notifications not appearing at all while the app is open or
  sitting in the background (recent apps), which is what the web
  `Notification` API usually can't do inside a WebView.
- **Does not fix:** alerts while the app process has been fully killed
  (swiped away) or the phone has been asleep for a long time. The low-balance
  check runs as a timer inside the open app (every 30 seconds), so for a
  truly "checks itself even if you never open the app" alert, the balance
  check would have to move to the server with a real push-notification
  subscription — a bigger change, and one that would need the server to be
  able to check your DESCO balance without the app open, which today it
  deliberately cannot do (your DESCO password is never stored anywhere
  server-side). Ask if you'd like that trade-off explained in more detail.
