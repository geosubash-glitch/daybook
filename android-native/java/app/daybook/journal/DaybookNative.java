package app.daybook.journal;

import android.os.Build;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Small native helpers for privacy: fingerprint unlock and hiding the journal in the recent-apps screen. */
@CapacitorPlugin(name = "DaybookNative")
public class DaybookNative extends Plugin {
    private static final int AUTH = BiometricManager.Authenticators.BIOMETRIC_STRONG
            | BiometricManager.Authenticators.BIOMETRIC_WEAK;

    @PluginMethod
    public void biometricAvailable(PluginCall call) {
        JSObject r = new JSObject();
        boolean ok = BiometricManager.from(getContext()).canAuthenticate(AUTH) == BiometricManager.BIOMETRIC_SUCCESS;
        r.put("available", ok);
        call.resolve(r);
    }

    @PluginMethod
    public void biometricAuth(final PluginCall call) {
        final FragmentActivity act = getActivity();
        if (act == null) { call.reject("No screen"); return; }
        final String title = call.getString("title", "Unlock Daybook");
        act.runOnUiThread(() -> {
            try {
                BiometricPrompt prompt = new BiometricPrompt(act, ContextCompat.getMainExecutor(act),
                        new BiometricPrompt.AuthenticationCallback() {
                            @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                                call.resolve();
                            }
                            @Override public void onAuthenticationError(int code, CharSequence msg) {
                                call.reject(String.valueOf(msg));
                            }
                        });
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setNegativeButtonText("Use passcode")
                        .setAllowedAuthenticators(AUTH)
                        .build();
                prompt.authenticate(info);
            } catch (Exception e) {
                call.reject("Fingerprint is not available");
            }
        });
    }

    /** On Android 13+, keeps the journal out of the recent-apps thumbnail. Screenshots still work. */
    @PluginMethod
    public void setRecentsPrivacy(final PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        final android.app.Activity act = getActivity();
        if (act != null && Build.VERSION.SDK_INT >= 33) {
            act.runOnUiThread(() -> { try { act.setRecentsScreenshotEnabled(!on); } catch (Exception ignored) { } });
        }
        call.resolve();
    }
}
