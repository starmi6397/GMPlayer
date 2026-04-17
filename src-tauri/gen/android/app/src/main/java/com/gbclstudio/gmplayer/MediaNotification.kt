package com.gbclstudio.gmplayer

import android.app.*
import android.content.*
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.IBinder
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import kotlinx.coroutines.*
import java.net.URL

@TauriPlugin
class MediaNotification(private val activity: Activity) : Plugin(activity) {

    companion object {
        private const val CHANNEL_ID      = "media_playback_channel"
        private const val NOTIFICATION_ID = 1
    }

    private var playbackService: MediaPlaybackService? = null
    private var isBound = false

    private var pendingFlush: (() -> Unit)? = null

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val localBinder = binder as MediaPlaybackService.LocalBinder
            playbackService = localBinder.getService()
            isBound = true
            // Link the media session callbacks to notify JS
            playbackService?.setMediaSessionCallback(mediaSessionCallback)
            pendingFlush?.invoke()
            pendingFlush = null
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            isBound = false
            playbackService = null
        }
    }

    private val mediaSessionCallback = object : android.support.v4.media.session.MediaSessionCompat.Callback() {
        override fun onPlay()             { notifyJS("play") }
        override fun onPause()            { notifyJS("pause") }
        override fun onSkipToNext()       { notifyJS("next") }
        override fun onSkipToPrevious()   { notifyJS("previous") }
        override fun onStop()             { notifyJS("stop") }
        override fun onSeekTo(pos: Long)  { notifyJS("seek", pos) }
    }

    private var currentTitle      = ""
    private var currentArtist     = ""
    private var currentAlbum      = ""
    private var currentIsPlaying  = false
    private var currentPosition   = 0L
    private var currentDuration   = 0L
    private var currentArtwork: Bitmap? = null
    private var lastArtworkUrl    = ""

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    override fun load(webView: WebView) {
        super.load(webView)
        startAndBindService()
    }

    override fun onDestroy() {
        scope.cancel()
        if (isBound) {
            activity.unbindService(serviceConnection)
            isBound = false
        }
        super.onDestroy()
    }

    private fun startAndBindService() {
        val intent = Intent(activity, MediaPlaybackService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.startForegroundService(intent)
        } else {
            activity.startService(intent)
        }
        activity.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
    }

    @Command
    fun updateNotification(invoke: Invoke) {
        val args = invoke.getArgs()
        currentTitle     = args.getString("title", "") ?: ""
        currentArtist    = args.getString("artist", "") ?: ""
        currentAlbum     = args.getString("album", "") ?: ""
        currentIsPlaying = args.getBoolean("isPlaying", false)
        currentPosition  = args.getInteger("position")?.toLong() ?: 0L
        currentDuration  = args.getInteger("duration")?.toLong() ?: 0L

        val artworkUrl = args.getString("artworkUrl", "") ?: ""

        scope.launch {
            if (artworkUrl.isNotBlank() && artworkUrl != lastArtworkUrl) {
                currentArtwork  = fetchBitmap(artworkUrl)
                lastArtworkUrl  = artworkUrl
            }

            val apply = apply@{
                val service = playbackService ?: return@apply
                service.updateMediaSessionMeta(
                    currentTitle,
                    currentArtist,
                    currentAlbum,
                    currentDuration,
                    currentArtwork,
                )
                service.updatePlaybackState(currentIsPlaying, currentPosition, currentDuration)
            }

            if (playbackService == null) {
                // Service binding may lag behind the first JS update; cache and flush on connect.
                pendingFlush = apply
            } else {
                apply()
            }
            invoke.resolve()
        }
    }

    @Command
    fun updateProgress(invoke: Invoke) {
        val args = invoke.getArgs()
        currentIsPlaying = args.getBoolean("isPlaying", currentIsPlaying)
        currentPosition  = args.getInteger("position")?.toLong() ?: currentPosition

        scope.launch {
            val apply = apply@{
                val service = playbackService ?: return@apply
                service.updatePlaybackState(currentIsPlaying, currentPosition, currentDuration)
            }

            if (playbackService == null) {
                pendingFlush = apply
            } else {
                apply()
            }
            invoke.resolve()
        }
    }

    @Command
    fun hideNotification(invoke: Invoke) {
        notificationManager().cancel(NOTIFICATION_ID)
        playbackService?.hideNotification()
        activity.stopService(Intent(activity, MediaPlaybackService::class.java))
        invoke.resolve()
    }

    private suspend fun fetchBitmap(url: String): Bitmap? = withContext(Dispatchers.IO) {
        runCatching { URL(url).openStream().use { BitmapFactory.decodeStream(it) } }.getOrNull()
    }

    private fun notifyJS(action: String, seekPos: Long? = null) {
        val payload = JSObject().apply {
            put("action", action)
            seekPos?.let { put("position", it) }
        }
        trigger("mediaAction", payload)
    }

    private fun notificationManager() = activity.getSystemService(NotificationManager::class.java)
}