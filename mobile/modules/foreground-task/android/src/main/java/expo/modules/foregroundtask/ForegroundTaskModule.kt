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
      // Ja ha um servico na frente: so troca a notificacao. Chamar
      // startForegroundService de novo a partir do fundo e recusado no
      // Android 12+ e derrubaria a cadeia transcricao -> revisao.
      if (TaskService.isRunning) {
        TaskService.showNotification(context, title, text, percent)
        return@AsyncFunction true
      }
      val intent = Intent(context, TaskService::class.java).apply {
        action = TaskService.ACTION_START
        putExtra(TaskService.EXTRA_TITLE, title)
        putExtra(TaskService.EXTRA_TEXT, text)
        putExtra(TaskService.EXTRA_PERCENT, percent)
      }
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
        true
      } catch (error: Exception) {
        // Android 12+ recusa abrir um servico em primeiro plano a partir do
        // fundo. O trabalho continua; a proxima etapa tenta de novo quando o
        // app estiver na frente.
        false
      }
    }

    /** Atualiza a notificacao (texto e barra) da tarefa que ja esta rodando. */
    AsyncFunction("update") { title: String, text: String, percent: Int ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      if (!TaskService.isRunning) return@AsyncFunction false
      // Notificacao direta: nao reabre o servico nem depende de startService,
      // que o Android restringe quando o app esta em segundo plano.
      TaskService.showNotification(context, title, text, percent)
      true
    }

    AsyncFunction("stop") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      context.stopService(Intent(context, TaskService::class.java))
      TaskService.cancelNotification(context)
      true
    }
  }
}
