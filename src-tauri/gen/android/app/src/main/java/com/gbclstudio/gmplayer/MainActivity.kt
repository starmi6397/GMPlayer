package com.gbclstudio.gmplayer

import android.os.Bundle
import android.view.View
import android.view.ViewGroup.MarginLayoutParams
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updateLayoutParams
import androidx.core.view.updatePadding

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // 启用全屏设计
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    
    // 获取根视图 (优先寻找 layout 中的 main，否则使用 android.R.id.content)
    val rootView = findViewById<View>(R.id.main) ?: findViewById<View>(android.R.id.content)
    
    // 注意：installCompatInsetsDispatch 仅在某些 androidx.core 版本中作为内部/实验性 API 存在。
    // 如果该方法不可用，通常 enableEdgeToEdge() 已经处理了大部分分发逻辑。

    // 处理系统栏、刘海屏及手势区域的边衬
    ViewCompat.setOnApplyWindowInsetsListener(rootView) { v, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars()
          or WindowInsetsCompat.Type.displayCutout()
      )
      
      // 1. 将边衬应用为 Padding (确保内容避开刘海和状态栏)
      v.updatePadding(
        left = bars.left,
        top = 0,
        right = bars.right,
        bottom = bars.bottom,
      )
      
      // 2. 处理系统手势边衬 (如果需要针对手势区域做特殊 Margin 避让)
      val gestures = insets.getInsets(WindowInsetsCompat.Type.systemGestures())
      // 示例：如果有 FAB，可以在此处根据 gestures 处理其 Margin

      // 返回 CONSUMED 停止分发，防止重复偏移
      WindowInsetsCompat.CONSUMED
    }
  }
}
