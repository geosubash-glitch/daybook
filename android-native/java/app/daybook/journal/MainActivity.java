package app.daybook.journal;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DaybookNative.class);
        super.onCreate(savedInstanceState);
        // Let the page run under a camera notch instead of leaving a black band.
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        // Belt and braces: the classic fullscreen flag plus the modern insets call.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        hideStatusBar();
        getWindow().getDecorView().post(this::hideStatusBar);
    }

    // Immersive: no clock, battery or signal strip while you write. A swipe down from the top
    // shows it briefly and it hides itself again.
    private void hideStatusBar() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsetsCompat.Type.statusBars());
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) { hideStatusBar(); getWindow().getDecorView().postDelayed(this::hideStatusBar, 300); }
    }

    @Override
    public void onResume() {
        super.onResume();
        hideStatusBar();
    }

    // When you leave the app, refresh the home-screen widget so it shows what you just wrote.
    @Override
    public void onPause() {
        super.onPause();
        TodayWidget.refreshAll(this);
    }
}
