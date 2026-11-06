package com.eventlaya.eventlaya_scanner

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

/**
 * Creates the push channel when the process starts. A push wakes this process (FirebaseMessagingService
 * runs in it), so the channel exists before FCM shows the first notification, even on an install that was
 * upgraded and not opened since. lib/core/notification_service.dart creates the same channel (same values).
 */
class EventlayaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        // Channel settings are fixed once created, so a changed channel gets a new id; drop the old one.
        nm.deleteNotificationChannel(LEGACY_CHANNEL_ID)
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, "Eventlaya alerts", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Booking requests, team chat messages and gate alerts"
            enableVibration(true)
            setShowBadge(true)
            // Lock-screen privacy is set per notification (VISIBILITY_PRIVATE in the FCM payload and the
            // local notifications): Android ignores a channel's lockscreenVisibility set by the app.
        }
        nm.createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "eventlaya_alerts"
        const val LEGACY_CHANNEL_ID = "eventlaya_scanner"
    }
}
