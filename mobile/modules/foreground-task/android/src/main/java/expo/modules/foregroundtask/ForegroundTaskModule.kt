package expo.modules.foregroundtask

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ForegroundTaskModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ForegroundTask")

    /** Inicia (ou reatualiza) a tarefa em primeiro plano. `percent` < 0 = sem barra. */
    AsyncFunction("start") { title: String, text: String, percent: Int ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val intent = Intent(context, TaskService::class.java).apply {
        action = TaskService.ACTION_START
        putExtra(TaskService.EXTRA_TITLE, title)
        putExtra(TaskService.EXTRA_TEXT, text)
        putExtra(TaskService.EXTRA_PERCENT, percent)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      true
    }

    /** Atualiza a notificacao (texto e barra) da tarefa que ja esta rodando. */
    AsyncFunction("update") { title: String, text: String, percent: Int ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val intent = Intent(context, TaskService::class.java).apply {
        action = TaskService.ACTION_UPDATE
        putExtra(TaskService.EXTRA_TITLE, title)
        putExtra(TaskService.EXTRA_TEXT, text)
        putExtra(TaskService.EXTRA_PERCENT, percent)
      }
      // O servico ja esta em primeiro plano: startService so entrega o novo
      // conteudo. startForegroundService de novo, vindo do background, pode ser
      // recusado pelas restricoes do Android 12+.
      context.startService(intent)
      true
    }

    AsyncFunction("stop") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      context.stopService(Intent(context, TaskService::class.java))
      true
    }
  }
}
