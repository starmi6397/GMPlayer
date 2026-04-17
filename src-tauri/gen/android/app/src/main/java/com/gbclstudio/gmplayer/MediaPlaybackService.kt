package com.gbclstudio.gmplayer

import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.media.session.MediaButtonReceiver

class MediaPlaybackService : Service() {

    companion object {
        const val CHANNEL_ID      = "media_playback_channel"
        const val NOTIFICATION_ID = 1
    }

    lateinit var mediaSession: MediaSessionCompat
    private var hasStartedForeground = false

    private var currentTitle = "GMPlayer"
    private var currentArtist = ""
    private var currentAlbum = ""
    private var currentIsPlaying = false
    private var currentPosition = 0L
    private var currentDuration = 0L
    private var currentArtwork: Bitmap? = null

    inner class LocalBinder : Binder() {
        fun getService() = this@MediaPlaybackService
    }
    private val binder = LocalBinder()

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        setupMediaSession()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Handle media button intents (from notification or external hardware)
        MediaButtonReceiver.handleIntent(mediaSession, intent)

        // Avoid resetting to an "initializing" notification on every start.
        ensureNotificationShown()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        mediaSession.isActive = false
        mediaSession.release()
        super.onDestroy()
    }

    // ─── Public methods for Plugin ──────────────────────────────────────────

    fun updateMediaSessionMeta(
        title:    String,
        artist:   String,
        album:    String,
        duration: Long,
        artwork:  Bitmap?,
    ) {
        currentTitle = title
        currentArtist = artist
        currentAlbum = album
        currentDuration = duration
        currentArtwork = artwork

        val metadataBuilder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE,     title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST,    artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM,     album)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION,    duration)
        
        artwork?.let {
            metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, it)
            metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it)
        }
        
        mediaSession.setMetadata(metadataBuilder.build())
    }

    fun updatePlaybackState(isPlaying: Boolean, position: Long, duration: Long) {
        currentIsPlaying = isPlaying
        currentPosition = position
        currentDuration = duration

        val stateCode = if (isPlaying)
            PlaybackStateCompat.STATE_PLAYING
        else
            PlaybackStateCompat.STATE_PAUSED

        mediaSession.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setState(stateCode, position, if (isPlaying) 1f else 0f)
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY             or
                    PlaybackStateCompat.ACTION_PAUSE            or
                    PlaybackStateCompat.ACTION_PLAY_PAUSE       or
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT     or
                    PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                    PlaybackStateCompat.ACTION_STOP             or
                    PlaybackStateCompat.ACTION_SEEK_TO,
                )
                .build()
        )

        // Keep the foreground notification in sync with playback state.
        updateNotificationInternal()
    }

    fun hideNotification() {
        stopForeground(true)
        notificationManager().cancel(NOTIFICATION_ID)
        hasStartedForeground = false
        stopSelf()
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "Media Playback",
                NotificationManager.IMPORTANCE_LOW,
            ).apply { 
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            getSystemService(NotificationManager::class.java)
                .createNotificationChannel(channel)
        }
    }

    private fun setupMediaSession() {
        mediaSession = MediaSessionCompat(this, "SPlayerMediaSession").apply {
            setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS,
            )
            isActive = true
        }
    }

    private fun ensureNotificationShown() {
        if (!hasStartedForeground) {
            startForeground(NOTIFICATION_ID, buildNotification())
            hasStartedForeground = true
        } else {
            updateNotificationInternal()
        }
    }

    private fun updateNotificationInternal() {
        val notification = buildNotification()

        if (currentIsPlaying) {
            // Some OEM ROMs require startForeground() to actually replace the foreground
            // service notification; notify() alone may leave the initial one stuck.
            startForeground(NOTIFICATION_ID, notification)
            hasStartedForeground = true
        } else {
            // Keep a non-ongoing notification when paused, so user can resume.
            // We do NOT drop foreground status via stopForeground(true) because that would
            // remove the notification; instead we stop being foreground but keep it shown.
            if (hasStartedForeground) stopForeground(false)
            notificationManager().notify(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val playPauseAction = if (currentIsPlaying) {
            NotificationCompat.Action(
                android.R.drawable.ic_media_pause,
                "Pause",
                MediaButtonReceiver.buildMediaButtonPendingIntent(
                    this,
                    PlaybackStateCompat.ACTION_PLAY_PAUSE,
                ),
            )
        } else {
            NotificationCompat.Action(
                android.R.drawable.ic_media_play,
                "Play",
                MediaButtonReceiver.buildMediaButtonPendingIntent(
                    this,
                    PlaybackStateCompat.ACTION_PLAY_PAUSE,
                ),
            )
        }

        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val deleteIntent = MediaButtonReceiver.buildMediaButtonPendingIntent(
            this,
            PlaybackStateCompat.ACTION_STOP,
        )

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(currentTitle.ifBlank { "GMPlayer" })
            .setContentText(currentArtist)
            .setSubText(currentAlbum.takeIf { it.isNotBlank() })
            .setLargeIcon(currentArtwork)
            .setContentIntent(contentIntent)
            .setDeleteIntent(deleteIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setOngoing(currentIsPlaying)
            .addAction(
                android.R.drawable.ic_media_previous,
                "Previous",
                MediaButtonReceiver.buildMediaButtonPendingIntent(
                    this,
                    PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS,
                ),
            )
            .addAction(playPauseAction)
            .addAction(
                android.R.drawable.ic_media_next,
                "Next",
                MediaButtonReceiver.buildMediaButtonPendingIntent(
                    this,
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT,
                ),
            )
            .setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2),
            )

        if (currentDuration > 0) {
            val max = currentDuration.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
            val progress = currentPosition.coerceIn(0, currentDuration).toInt()
            builder.setProgress(max, progress, false)
        } else {
            builder.setProgress(0, 0, false)
        }

        return builder.build()
    }

    private fun notificationManager(): NotificationManager =
        getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
}