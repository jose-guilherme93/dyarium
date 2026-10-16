package expo.modules.foregroundtask

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ForegroundTaskModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ForegroundTask")

    AsyncFunction("start") { title: String, text: String ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val intent = Intent(context, TaskService::class.java).apply {
        action = TaskService.ACTION_START
        putExtra(TaskService.EXTRA_TITLE, title)
        putExtra(TaskService.EXTRA_TEXT, text)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      true
    }

    AsyncFunction("stop") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      context.stopService(Intent(context, TaskService::class.java))
      true
    }
  }
}
