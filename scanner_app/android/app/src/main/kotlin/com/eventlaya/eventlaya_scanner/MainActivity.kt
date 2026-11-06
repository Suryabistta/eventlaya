package com.eventlaya.eventlaya_scanner

import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Hands App Links (https://eventlaya.com/e/…, /ticket/…) to Dart (lib/core/deep_links.dart):
 * `initialLink` returns the link the app was opened with (once), and links that arrive while the app is
 * running are sent with `link`. Flutter's own route-based deep linking is off in the manifest
 * (flutter_deeplinking_enabled=false) because the app navigates imperatively.
 */
class MainActivity : FlutterActivity() {
    private var channel: MethodChannel? = null
    private var initialLink: String? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        initialLink = linkOf(intent)
        channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).apply {
            setMethodCallHandler { call, result ->
                when (call.method) {
                    "initialLink" -> {
                        result.success(initialLink)
                        initialLink = null
                    }
                    else -> result.notImplemented()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        linkOf(intent)?.let { channel?.invokeMethod("link", it) }
    }

    private fun linkOf(intent: Intent?): String? =
        if (intent?.action == Intent.ACTION_VIEW) intent.dataString else null

    companion object {
        const val CHANNEL = "com.eventlaya/links"
    }
}
