package expo.modules.foregroundtask

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Servico em primeiro plano para manter o processo vivo durante uma tarefa longa
 * (transcricao/revisao/analise no aparelho). Mostra uma notificacao discreta
 * enquanto roda e aceita atualizacao de progresso (0..100), para o usuario
 * acompanhar pela barra de notificacoes.
 *
 * O wakelock parcial mantem a CPU acordada com a tela apagada. Sem ele o
 * sistema pode suspender a thread no meio da passada; o processo continua vivo,
 * mas o trabalho para e o usuario ve a nota travada.
 */
class TaskService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent == null) {
      // O Android recriou o servico sem o comando original (processo morto).
      // Sem o JS nao ha trabalho: nao deixa uma notificacao presa.
      stopSelf()
      return START_NOT_STICKY
    }
    when (intent.action) {
      ACTION_STOP -> {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_UPDATE -> {
        // Nao reabre o servico nem chama startForeground de novo: so troca o
        // conteudo da notificacao que ja esta na tela.
        if (isRunning) {
          showNotification(
            this,
            intent.getStringExtra(EXTRA_TITLE) ?: "Processando",
            intent.getStringExtra(EXTRA_TEXT) ?: "",
            intent.getIntExtra(EXTRA_PERCENT, -1),
          )
        }
        return START_NOT_STICKY
      }
    }

    ensureChannel(this)
    acquireWakeLock()
    val title = intent.getStringExtra(EXTRA_TITLE) ?: "Processando"
    val text = intent.getStringExtra(EXTRA_TEXT) ?: ""
    val percent = intent.getIntExtra(EXTRA_PERCENT, -1)
    val notification = buildNotification(this, title, text, percent)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (error: Exception) {
      // Permissao/tipo de servico recusado pelo sistema: nao segura o processo
      // com uma notificacao orfa. O JS decide retomar depois.
      releaseWakeLock()
      stopSelf()
      return START_NOT_STICKY
    }
    isRunning = true
    // NAO reiniciar sozinho: se o processo morrer no meio, o Android
    // ressuscitaria o servico sem o JS, com uma notificacao presa e sem
    // ninguem para atualiza-la ou para-lo. A transcricao retoma no proximo
    // ciclo do app (checkpoint no banco).
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    isRunning = false
    releaseWakeLock()
    try {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } catch (error: Exception) {
      // servico ja saiu do primeiro plano
    }
    super.onDestroy()
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val manager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "dyarium:heavy-task").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun releaseWakeLock() {
    wakeLock?.let { lock ->
      if (lock.isHeld) lock.release()
    }
    wakeLock = null
  }

  companion object {
    const val ACTION_START = "expo.modules.foregroundtask.START"
    const val ACTION_UPDATE = "expo.modules.foregroundtask.UPDATE"
    const val ACTION_STOP = "expo.modules.foregroundtask.STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_PERCENT = "percent"
    private const val CHANNEL_ID = "dyarium-task"
    private const val NOTIFICATION_ID = 4711

    /** O servico esta em primeiro plano agora (o JS usa para nao reabri-lo). */
    @Volatile
    var isRunning = false

    fun showNotification(context: Context, title: String, text: String, percent: Int) {
      if (!isRunning) return
      ensureChannel(context)
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(NOTIFICATION_ID, buildNotification(context, title, text, percent))
    }

    fun cancelNotification(context: Context) {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.cancel(NOTIFICATION_ID)
    }

    private fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
          manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Transcricao", NotificationManager.IMPORTANCE_LOW),
          )
        }
      }
    }

    private fun buildNotification(
      context: Context,
      title: String,
      text: String,
      percent: Int,
    ): Notification {
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(context, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context)
      }
      builder
        .setContentTitle(title)
        .setContentText(text)
        .setSmallIcon(context.applicationInfo.icon)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
      if (percent in 0..100) {
        // Barra de progresso determinada: o usuario ve a porcentagem sem abrir o app.
        builder.setProgress(100, percent, false)
      }
      return builder.build()
    }
  }
}
