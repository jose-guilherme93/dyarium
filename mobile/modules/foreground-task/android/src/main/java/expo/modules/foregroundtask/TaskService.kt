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

/**
 * Servico em primeiro plano para manter o processo vivo durante uma tarefa longa
 * (transcricao no aparelho). Mostra uma notificacao discreta enquanto roda e
 * aceita atualizacao de progresso (0..100), para o usuario acompanhar pela
 * barra de notificacoes.
 */
class TaskService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    ensureChannel()
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Processando"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
    val percent = intent?.getIntExtra(EXTRA_PERCENT, -1) ?: -1
    val notification = buildNotification(title, text, percent)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_STICKY
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Transcricao", NotificationManager.IMPORTANCE_LOW),
        )
      }
    }
  }

  private fun buildNotification(title: String, text: String, percent: Int): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    builder
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
    if (percent in 0..100) {
      // Barra de progresso determinada: o usuario ve a porcentagem sem abrir o app.
      builder.setProgress(100, percent, false)
    }
    return builder.build()
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
  }
}
