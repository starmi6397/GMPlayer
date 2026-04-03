package com.gbclstudio.gmplayer

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import app.tauri.plugin.PluginManager

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    registerPlugin(MediaNotification::class.java)
    super.onCreate(savedInstanceState)
  }
}
