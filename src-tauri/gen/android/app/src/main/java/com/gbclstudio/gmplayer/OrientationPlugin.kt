package com.gbclstudio.gmplayer

import android.app.Activity
import android.content.pm.ActivityInfo
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class SetOrientationArgs {
    lateinit var orientation: String
}

@TauriPlugin
class OrientationPlugin(private val activity: Activity) : Plugin(activity) {

    @Command
    fun setOrientation(invoke: Invoke) {
        val args = invoke.parseArgs(SetOrientationArgs::class.java)

        val requestedOrientation = when (args.orientation) {
            "landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            "auto" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR
            else -> ActivityInfo.SCREEN_ORIENTATION_SENSOR
        }

        activity.runOnUiThread {
            activity.requestedOrientation = requestedOrientation
            Log.d("OrientationPlugin", "Orientation set to: ${args.orientation} ($requestedOrientation)")
        }

        invoke.resolve()
    }
}
