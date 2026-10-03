package app.daybook.journal;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Home-screen widget: today's date. Tapping it opens Daybook on today's page. */
public class TodayWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        Date now = new Date();
        String weekday = new SimpleDateFormat("EEEE", Locale.ENGLISH).format(now).toUpperCase(Locale.ENGLISH);
        String date = new SimpleDateFormat("d MMMM", Locale.ENGLISH).format(now);
        String year = new SimpleDateFormat("yyyy", Locale.ENGLISH).format(now);
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent tap = open == null ? null : PendingIntent.getActivity(context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        for (int id : ids) {
            RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_today);
            v.setTextViewText(R.id.w_weekday, weekday);
            v.setTextViewText(R.id.w_date, date);
            v.setTextViewText(R.id.w_year, year);
            if (tap != null) v.setOnClickPendingIntent(android.R.id.background, tap);
            manager.updateAppWidget(id, v);
        }
    }
}
