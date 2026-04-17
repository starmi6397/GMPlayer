package com.gbclstudio.gmplayer

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // 启用全屏设计
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    
    // 获取根视图 (优先寻找 layout 中的 main，否则使用 android.R.id.content)
    val rootView = findViewById<View>(R.id.main) ?: findViewById<View>(android.R.id.content)
    
    // 注意：installCompatInsetsDispatch 仅在某些 androidx.core 版本中作为内部/实验性 API 存在。
    // 如果该方法不可用，通常 enableEdgeToEdge() 已经处理了大部分分发逻辑。

    // Edge-to-edge：不在原生层做 padding 偏移；安全区交给前端用 CSS 变量处理。
    ViewCompat.setOnApplyWindowInsetsListener(rootView) { v, insets ->
      // 保持 insets 继续分发给子视图（包括 WebView），让前端能拿到真实 safe-area。
      ViewCompat.onApplyWindowInsets(v, insets)
    }
  }
}
