package com.gbclstudio.gmplayer

import android.app.*
import android.content.*
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.IBinder
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
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

    // ─── Service 绑定 ──────────────────────────────────────────────────────────

    private var playbackService: MediaPlaybackService? = null
    private var isBound = false

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            playbackService = (binder as MediaPlaybackService.LocalBinder).getService()
            isBound = true
            playbackService?.mediaSession?.setCallback(mediaSessionCallback)
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            isBound = false
            playbackService = null
        }
    }

    // ─── MediaSession 回调（通知栏按钮 → JS）─────────────────────────────────

    private val mediaSessionCallback = object : MediaSessionCompat.Callback() {
        override fun onPlay()             { notifyJS("play") }
        override fun onPause()            { notifyJS("pause") }
        override fun onSkipToNext()       { notifyJS("next") }
        override fun onSkipToPrevious()   { notifyJS("previous") }
        override fun onStop()             { notifyJS("stop") }
        override fun onSeekTo(pos: Long)  { notifyJS("seek", pos) }
    }

    // ─── 当前状态缓存 ──────────────────────────────────────────────────────────

    private var currentTitle      = ""
    private var currentArtist     = ""
    private var currentAlbum      = ""
    private var currentIsPlaying  = false
    private var currentPosition   = 0L   // ms
    private var currentDuration   = 0L   // ms
    private var currentArtwork: Bitmap? = null
    private var lastArtworkUrl    = ""

    // ─── 协程 ──────────────────────────────────────────────────────────────────

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var progressJob: Job? = null

    // ─── 生命周期 ──────────────────────────────────────────────────────────────

    override fun load() {
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

    // ─── Service 启动 & 绑定 ───────────────────────────────────────────────────

    private fun startAndBindService() {
        val intent = Intent(activity, MediaPlaybackService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.startForegroundService(intent)
        } else {
            activity.startService(intent)
        }
        activity.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
    }

    // ─── Commands ──────────────────────────────────────────────────────────────

    /**
     * 更新完整元数据 + 封面 + 播放状态
     *
     * 参数：
     *   title, artist, album  — String
     *   artworkUrl            — http(s) 封面图片 URL（相同 URL 不重复下载）
     *   isPlaying             — Boolean
     *   position              — Long (ms)
     *   duration              — Long (ms)，未知传 0
     */
    @Command
    fun updateNotification(invoke: Invoke) {
        currentTitle     = invoke.getString("title")     ?: ""
        currentArtist    = invoke.getString("artist")    ?: ""
        currentAlbum     = invoke.getString("album")     ?: ""
        currentIsPlaying = invoke.getBoolean("isPlaying") ?: false
        currentPosition  = invoke.getLong("position")    ?: 0L
        currentDuration  = invoke.getLong("duration")    ?: 0L

        val artworkUrl = invoke.getString("artworkUrl") ?: ""

        scope.launch {
            // 仅在 URL 变化时重新下载封面
            if (artworkUrl.isNotBlank() && artworkUrl != lastArtworkUrl) {
                currentArtwork  = fetchBitmap(artworkUrl)
                lastArtworkUrl  = artworkUrl
            }

            val service = playbackService ?: run {
                invoke.reject("Service not bound yet")
                return@launch
            }

            service.updateMediaSessionMeta(
                title    = currentTitle,
                artist   = currentArtist,
                album    = currentAlbum,
                duration = currentDuration,
                artwork  = currentArtwork,
            )
            service.updatePlaybackState(
                isPlaying = currentIsPlaying,
                position  = currentPosition,
                duration  = currentDuration,
            )
            service.updateNotification(buildNotification())

            if (currentIsPlaying) startProgressTick() else stopProgressTick()

            invoke.resolve()
        }
    }

    /**
     * 仅同步进度（高频调用，不重新下载封面）
     *
     * 参数：
     *   isPlaying  — Boolean
     *   position   — Long (ms)
     */
    @Command
    fun updateProgress(invoke: Invoke) {
        currentIsPlaying = invoke.getBoolean("isPlaying") ?: currentIsPlaying
        currentPosition  = invoke.getLong("position")    ?: currentPosition

        scope.launch {
            val service = playbackService ?: run {
                invoke.reject("Service not bound yet")
                return@launch
            }

            service.updatePlaybackState(
                isPlaying = currentIsPlaying,
                position  = currentPosition,
                duration  = currentDuration,
            )
            service.updateNotification(buildNotification())

            if (currentIsPlaying) startProgressTick() else stopProgressTick()

            invoke.resolve()
        }
    }

    /**
     * 隐藏通知并停止前台 Service
     */
    @Command
    fun hideNotification(invoke: Invoke) {
        stopProgressTick()
        notificationManager().cancel(NOTIFICATION_ID)
        activity.stopService(Intent(activity, MediaPlaybackService::class.java))
        invoke.resolve()
    }

    // ─── 进度本地自走（减少 JS IPC 频率）─────────────────────────────────────

    private fun startProgressTick() {
        if (progressJob?.isActive == true) return   // 已在跑，不重复启动
        progressJob = scope.launch {
            while (isActive) {
                delay(1000)
                if (!currentIsPlaying || currentDuration <= 0) continue
                currentPosition = (currentPosition + 1000).coerceAtMost(currentDuration)

                val service = playbackService ?: continue
                service.updatePlaybackState(
                    isPlaying = true,
                    position  = currentPosition,
                    duration  = currentDuration,
                )
                service.updateNotification(buildNotification())
            }
        }
    }

    private fun stopProgressTick() {
        progressJob?.cancel()
        progressJob = null
    }

    // ─── 构建通知 ──────────────────────────────────────────────────────────────

    private fun buildNotification(): Notification {
        val service = playbackService
            ?: error("buildNotification called before service bound")

        val playPauseIcon  = if (currentIsPlaying)
            android.R.drawable.ic_media_pause
        else
            android.R.drawable.ic_media_play
        val playPauseLabel = if (currentIsPlaying) "Pause" else "Play"

        return NotificationCompat.Builder(activity, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist)
            .setSubText(currentAlbum)
            .setLargeIcon(currentArtwork)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .setOngoing(currentIsPlaying)
            // 进度条（duration=0 时显示不定态）
            .setProgress(
                currentDuration.toInt(),
                currentPosition.toInt(),
                currentDuration <= 0,
            )
            // 操作按钮
            .addAction(
                android.R.drawable.ic_media_previous,
                "Previous",
                pendingIntent("previous"),
            )
            .addAction(playPauseIcon, playPauseLabel, pendingIntent("play_pause"))
            .addAction(
                android.R.drawable.ic_media_next,
                "Next",
                pendingIntent("next"),
            )
            // 关联 MediaSession（锁屏 & 系统媒体控件生效）
            .setStyle(
                MediaStyle()
                    .setMediaSession(service.mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .build()
    }

    // ─── 工具 ──────────────────────────────────────────────────────────────────

    private fun pendingIntent(action: String): PendingIntent {
        val intent = Intent(activity, activity::class.java).apply {
            this.action = "MEDIA_$action"
        }
        return PendingIntent.getActivity(
            activity,
            action.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** IO 线程下载封面，失败静默返回 null */
    private suspend fun fetchBitmap(url: String): Bitmap? =
        withContext(Dispatchers.IO) {
            runCatching {
                URL(url).openStream().use { BitmapFactory.decodeStream(it) }
            }.getOrNull()
        }

    private fun notifyJS(action: String, seekPos: Long? = null) {
        val payload = JSObject().apply {
            put("action", action)
            seekPos?.let { put("position", it) }
        }
        trigger("mediaAction", payload)
    }

    private fun notificationManager() =
        activity.getSystemService(NotificationManager::class.java)
}