package com.gbclstudio.gmplayer

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat

class MainActivity : TauriActivity() {

    // 申请通知权限（Android 13+ 必需）
    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted: Boolean ->
        if (isGranted) {
            Log.d("MainActivity", "Notification permission granted")
        } else {
            Log.w("MainActivity", "Notification permission denied")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // 启用全屏设计
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        
        val rootView = findViewById<View>(R.id.main) ?: findViewById<View>(android.R.id.content)
        
        // Edge-to-edge 安全区处理
        ViewCompat.setOnApplyWindowInsetsListener(rootView) { v, insets ->
            ViewCompat.onApplyWindowInsets(v, insets)
        }

        checkAndRequestPermissions()
    }

    private fun checkAndRequestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                requestPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }
}
