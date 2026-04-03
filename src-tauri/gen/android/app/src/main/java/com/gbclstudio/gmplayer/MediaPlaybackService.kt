package com.gbclstudio.gmplayer

import android.app.*
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle

class MediaPlaybackService : Service() {

    companion object {
        private const val CHANNEL_ID      = "media_playback_channel"
        private const val NOTIFICATION_ID = 1
    }

    lateinit var mediaSession: MediaSessionCompat

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
        startForeground(NOTIFICATION_ID, buildInitialNotification())
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        mediaSession.release()
        super.onDestroy()
    }

    // ─── Plugin 调用的公开方法 ─────────────────────────────────────────────────

    fun updateMediaSessionMeta(
        title:    String,
        artist:   String,
        album:    String,
        duration: Long,
        artwork:  Bitmap?,
    ) {
        mediaSession.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE,     title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST,    artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM,     album)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION,    duration)
                .apply {
                    artwork?.let {
                        putBitmap(MediaMetadataCompat.METADATA_KEY_ART,       it)
                        putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it)
                    }
                }
                .build()
        )
    }

    fun updatePlaybackState(isPlaying: Boolean, position: Long, duration: Long) {
        val stateCode = if (isPlaying)
            PlaybackStateCompat.STATE_PLAYING
        else
            PlaybackStateCompat.STATE_PAUSED

        mediaSession.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setState(stateCode, position, if (isPlaying) 1f else 0f)
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY_PAUSE       or
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT     or
                    PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                    PlaybackStateCompat.ACTION_SEEK_TO,
                )
                .build()
        )
    }

    fun updateNotification(notification: Notification) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, notification)
    }

    // ─── 私有 ──────────────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "Media Playback",
                NotificationManager.IMPORTANCE_LOW,
            ).apply { setShowBadge(false) }
            getSystemService(NotificationManager::class.java)
                .createNotificationChannel(channel)
        }
    }

    private fun setupMediaSession() {
        mediaSession = MediaSessionCompat(this, "TauriMediaSession").apply {
            setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS,
            )
            isActive = true
        }
    }

    private fun buildInitialNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Loading...")
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setStyle(MediaStyle().setMediaSession(mediaSession.sessionToken))
            .build()
}