package app.daybook.journal;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home-screen widget: today's date, whether you have written today, your streak,
 * and this month as a grid of dots (bright = written, dim = missed, ring = today).
 * It is resizable: the amount of information adapts to the size the user drags it to
 * (date only, + weekday, + status, + streak, + month grid as it gets bigger).
 * The app keeps the list of written days in its local storage; the widget only reads it.
 */
public class TodayWidget extends AppWidgetProvider {
    private static final int INK = 0xFFF2EFE8, SOFT = 0xFFC9C6BE, MISSED = 0x99F2EFE8, FUTURE = 0x40F2EFE8;

    public static void refreshAll(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, TodayWidget.class));
        if (ids != null && ids.length > 0) new TodayWidget().onUpdate(ctx, m, ids);
    }

    private static Set<String> writtenDays(Context ctx) {
        Set<String> days = new HashSet<>();
        try {
            SharedPreferences sp = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            String json = sp.getString("daybook.widget", null);
            if (json == null) return days;
            JSONArray arr = new JSONObject(json).getJSONArray("days");
            for (int i = 0; i < arr.length(); i++) days.add(arr.getString(i));
        } catch (Exception ignored) { }
        return days;
    }

    private static String key(Calendar c) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(c.getTime());
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        Calendar now = Calendar.getInstance();
        Set<String> days = writtenDays(context);
        boolean today = days.contains(key(now));

        // Streak: consecutive written days ending today (or yesterday, if today is still open).
        Calendar c = (Calendar) now.clone();
        if (!today) c.add(Calendar.DAY_OF_MONTH, -1);
        int streak = 0;
        while (days.contains(key(c)) && streak < 3660) { streak++; c.add(Calendar.DAY_OF_MONTH, -1); }

        String weekday = new SimpleDateFormat("EEEE", Locale.ENGLISH).format(now.getTime()).toUpperCase(Locale.ENGLISH);
        String date = new SimpleDateFormat("d MMMM", Locale.ENGLISH).format(now.getTime());
        String shortDate = new SimpleDateFormat("d MMM", Locale.ENGLISH).format(now.getTime());
        String status = today ? "Written today" : "Nothing yet today";
        String detail = streak > 1 ? streak + "-day streak" : (today ? "A good start" : "Tap to write");

        Bitmap grid = drawMonth(now, days);
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent tap = open == null ? null : PendingIntent.getActivity(context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        for (int id : ids) {
            Bundle o = manager.getAppWidgetOptions(id);
            int w = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250);
            int h = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 110);
            // Tiers, smallest first: each step up in size adds one more thing.
            boolean micro = w < 110 || h < 55;                 // short date only
            boolean tiny = !micro && (w < 150 || h < 70);      // + weekday
            boolean showStatus = !micro && !tiny;              // + written / not yet
            boolean showDetail = showStatus && h >= 100 && w >= 160;  // + streak line
            boolean showGrid = w >= 230 && h >= 135;           // + month grid
            RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_today);
            v.setTextViewText(R.id.w_weekday, weekday);
            v.setTextViewText(R.id.w_date, micro ? shortDate : date);
            v.setTextViewText(R.id.w_status, status);
            v.setTextViewText(R.id.w_detail, detail);
            v.setTextColor(R.id.w_status, today ? INK : SOFT);
            v.setTextViewTextSize(R.id.w_date, TypedValue.COMPLEX_UNIT_SP, micro ? 16 : tiny ? 19 : (showGrid ? 26 : 24));
            v.setViewVisibility(R.id.w_weekday, micro ? View.GONE : View.VISIBLE);
            v.setViewVisibility(R.id.w_status, showStatus ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.w_detail, showDetail ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.w_grid, showGrid ? View.VISIBLE : View.GONE);
            int pad = Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, micro ? 8 : tiny ? 12 : 18,
                    context.getResources().getDisplayMetrics()));
            v.setViewPadding(android.R.id.background, pad, pad, pad, pad);
            if (showGrid) v.setImageViewBitmap(R.id.w_grid, grid);
            if (tap != null) v.setOnClickPendingIntent(android.R.id.background, tap);
            manager.updateAppWidget(id, v);
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        onUpdate(context, manager, new int[] { id });
    }

    private static Bitmap drawMonth(Calendar now, Set<String> days) {
        Calendar first = (Calendar) now.clone();
        first.set(Calendar.DAY_OF_MONTH, 1);
        int offset = first.get(Calendar.DAY_OF_WEEK) - 1;             // Sunday first
        int dim = now.getActualMaximum(Calendar.DAY_OF_MONTH);
        int rows = (offset + dim + 6) / 7;
        int cell = 56, head = 44;
        Bitmap b = Bitmap.createBitmap(cell * 7, head + cell * rows, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

        p.setColor(SOFT);
        p.setTextSize(22);
        p.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        p.setTextAlign(Paint.Align.CENTER);
        String letters = "SMTWTFS";
        for (int i = 0; i < 7; i++) cv.drawText(String.valueOf(letters.charAt(i)), cell * i + cell / 2f, 26, p);

        int todayNum = now.get(Calendar.DAY_OF_MONTH);
        Calendar d = (Calendar) first.clone();
        for (int n = 1; n <= dim; n++) {
            d.set(Calendar.DAY_OF_MONTH, n);
            int pos = offset + n - 1;
            float cx = cell * (pos % 7) + cell / 2f, cy = head + cell * (pos / 7) + cell / 2f;
            boolean written = days.contains(key(d));
            p.setStyle(Paint.Style.FILL);
            if (written) { p.setColor(INK); cv.drawCircle(cx, cy, 13, p); }
            else if (n < todayNum) { p.setColor(MISSED); cv.drawCircle(cx, cy, 8, p); }
            else if (n > todayNum) { p.setColor(FUTURE); cv.drawCircle(cx, cy, 8, p); }
            if (n == todayNum) {
                if (!written) { p.setColor(MISSED); cv.drawCircle(cx, cy, 8, p); }
                p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(3); p.setColor(INK);
                cv.drawCircle(cx, cy, 21, p);
            }
        }
        return b;
    }
}
