package com.gbclstudio.gmplayer

import android.app.*
import android.content.*
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.IBinder
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.webkit.WebView
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.media.session.MediaButtonReceiver
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

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val localBinder = binder as MediaPlaybackService.LocalBinder
            playbackService = localBinder.getService()
            isBound = true
            // Link the media session callbacks to notify JS
            playbackService?.mediaSession?.setCallback(mediaSessionCallback)
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            isBound = false
            playbackService = null
        }
    }

    private val mediaSessionCallback = object : MediaSessionCompat.Callback() {
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
    private var progressJob: Job? = null

    override fun load(webView: WebView) {
        super.load(webView)
        startAndBindService()
    }

    override fun onDestroy() {
        stopProgressTick()
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

            val service = playbackService ?: run {
                invoke.reject("Service not bound")
                return@launch
            }

            service.updateMediaSessionMeta(currentTitle, currentArtist, currentAlbum, currentDuration, currentArtwork)
            service.updatePlaybackState(currentIsPlaying, currentPosition, currentDuration)
            service.updateNotification(buildNotification())

            if (currentIsPlaying) startProgressTick() else stopProgressTick()
            invoke.resolve()
        }
    }

    @Command
    fun updateProgress(invoke: Invoke) {
        val args = invoke.getArgs()
        currentIsPlaying = args.getBoolean("isPlaying", currentIsPlaying)
        currentPosition  = args.getInteger("position")?.toLong() ?: currentPosition

        scope.launch {
            val service = playbackService ?: run {
                invoke.reject("Service not bound")
                return@launch
            }
            service.updatePlaybackState(currentIsPlaying, currentPosition, currentDuration)
            service.updateNotification(buildNotification())
            if (currentIsPlaying) startProgressTick() else stopProgressTick()
            invoke.resolve()
        }
    }

    @Command
    fun hideNotification(invoke: Invoke) {
        stopProgressTick()
        notificationManager().cancel(NOTIFICATION_ID)
        activity.stopService(Intent(activity, MediaPlaybackService::class.java))
        invoke.resolve()
    }

    private fun startProgressTick() {
        if (progressJob?.isActive == true) return
        progressJob = scope.launch {
            while (isActive) {
                delay(1000)
                if (!currentIsPlaying || currentDuration <= 0) continue
                currentPosition = (currentPosition + 1000).coerceAtMost(currentDuration)

                playbackService?.let {
                    it.updatePlaybackState(true, currentPosition, currentDuration)
                    it.updateNotification(buildNotification())
                }
            }
        }
    }

    private fun stopProgressTick() {
        progressJob?.cancel()
        progressJob = null
    }

    private fun buildNotification(): Notification {
        val service = playbackService ?: error("Service not bound")
        
        val playPauseIcon = if (currentIsPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val playPauseLabel = if (currentIsPlaying) "Pause" else "Play"

        val contentIntent = PendingIntent.getActivity(
            activity, 0,
            Intent(activity, activity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(activity, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist)
            .setSubText(currentAlbum)
            .setLargeIcon(currentArtwork)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .setOngoing(currentIsPlaying)
            .addAction(
                android.R.drawable.ic_media_previous, "Previous",
                MediaButtonReceiver.buildMediaButtonPendingIntent(activity, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
            )
            .addAction(
                playPauseIcon, playPauseLabel,
                MediaButtonReceiver.buildMediaButtonPendingIntent(activity, PlaybackStateCompat.ACTION_PLAY_PAUSE)
            )
            .addAction(
                android.R.drawable.ic_media_next, "Next",
                MediaButtonReceiver.buildMediaButtonPendingIntent(activity, PlaybackStateCompat.ACTION_SKIP_TO_NEXT)
            )
            .setStyle(
                MediaStyle()
                    .setMediaSession(service.mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .build()
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