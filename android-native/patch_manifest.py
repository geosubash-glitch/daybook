# Adds the home-screen widget to the Android manifest that Capacitor generates.
import sys
p = 'android/app/src/main/AndroidManifest.xml'
s = open(p).read()
rx = '''        <receiver android:name=".TodayWidget" android:exported="false" android:label="@string/widget_label">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_today_info" />
        </receiver>
    </application>'''
if 'TodayWidget' not in s:
    s = s.replace('    </application>', rx, 1)
open(p, 'w').write(s)
print('manifest patched' if 'TodayWidget' in s else 'FAILED'); sys.exit(0 if 'TodayWidget' in s else 1)
