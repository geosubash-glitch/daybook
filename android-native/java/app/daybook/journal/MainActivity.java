package app.daybook.journal;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // When you leave the app, refresh the home-screen widget so it shows what you just wrote.
    @Override
    public void onPause() {
        super.onPause();
        TodayWidget.refreshAll(this);
    }
}
