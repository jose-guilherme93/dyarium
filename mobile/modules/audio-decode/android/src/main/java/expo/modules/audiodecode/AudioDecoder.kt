package expo.modules.audiodecode

import android.media.MediaCodec
import android.media.MediaFormat
import android.net.Uri
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Decodifica AAC em ADTS (o formato gravado pelo MediaRecorder) para WAV PCM
 * 16-bit mono a 16 kHz, que e o que o whisper.rn consome.
 *
 * O MediaExtractor nao le ADTS cru, entao o cabecalho de cada frame e lido aqui
 * e o payload AAC vai direto para o MediaCodec. O PCM e reamostrado para 16 kHz
 * em streaming (media de caixa), sem carregar o audio inteiro decodificado.
 */
object AudioDecoder {
  private const val OUT_RATE = 16000
  private const val TIMEOUT_US = 10_000L
  private val RATES = intArrayOf(
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
    16000, 12000, 11025, 8000, 7350, 0, 0, 0,
  )

  fun decodeToWav(sourceUri: String, targetUri: String) {
    val source = File(toPath(sourceUri))
    require(source.exists()) { "audio de origem nao existe" }
    val target = File(toPath(targetUri))
    target.parentFile?.mkdirs()

    val bytes = source.readBytes()
    val frames = ArrayList<ByteArray>()
    var sampleRateIndex = 3
    var channels = 1
    var profile = 1
    var offset = 0

    while (offset + 7 <= bytes.size) {
      if ((bytes[offset].toInt() and 0xFF) != 0xFF || (bytes[offset + 1].toInt() and 0xF0) != 0xF0) {
        offset += 1
        continue
      }
      val protectionAbsent = bytes[offset + 1].toInt() and 0x01
      val headerSize = if (protectionAbsent == 1) 7 else 9
      profile = ((bytes[offset + 2].toInt() and 0xC0) ushr 6) + 1
      sampleRateIndex = (bytes[offset + 2].toInt() and 0x3C) ushr 2
      channels = ((bytes[offset + 2].toInt() and 0x01) shl 2) or
        ((bytes[offset + 3].toInt() and 0xC0) ushr 6)
      val frameLength = ((bytes[offset + 3].toInt() and 0x03) shl 11) or
        ((bytes[offset + 4].toInt() and 0xFF) shl 3) or
        ((bytes[offset + 5].toInt() and 0xE0) ushr 5)
      if (frameLength < headerSize || offset + frameLength > bytes.size) break
      frames.add(bytes.copyOfRange(offset + headerSize, offset + frameLength))
      offset += frameLength
    }
    require(frames.isNotEmpty()) { "nenhum frame AAC encontrado" }

    val sampleRate = RATES.getOrElse(sampleRateIndex) { 0 }.let { if (it > 0) it else 48000 }
    val channelCount = if (channels > 0) channels else 1

    val audioSpecificConfig = byteArrayOf(
      ((profile shl 3) or (sampleRateIndex ushr 1)).toByte(),
      (((sampleRateIndex and 1) shl 7) or (channelCount shl 3)).toByte(),
    )

    val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channelCount)
    format.setByteBuffer("csd-0", ByteBuffer.wrap(audioSpecificConfig))

    val codec = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    codec.configure(format, null, null, 0)
    codec.start()

    val output = BufferedOutputStream(FileOutputStream(target))
    output.write(ByteArray(44)) // cabecalho WAV (preenchido depois)

    val resampler = Resampler(sampleRate, OUT_RATE) { sample ->
      output.write(sample.toInt() and 0xFF)
      output.write((sample.toInt() ushr 8) and 0xFF)
    }
    val info = MediaCodec.BufferInfo()

    fun drain(endOfStream: Boolean) {
      while (true) {
        val index = codec.dequeueOutputBuffer(info, if (endOfStream) TIMEOUT_US else 0L)
        if (index == MediaCodec.INFO_TRY_AGAIN_LATER) {
          if (endOfStream) return
          break
        }
        if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED || index < 0) continue
        val buffer = codec.getOutputBuffer(index)
        if (buffer != null && info.size > 0) {
          buffer.position(info.offset)
          buffer.limit(info.offset + info.size)
          val shorts = buffer.order(ByteOrder.nativeOrder()).asShortBuffer()
          var sum = 0
          var count = 0
          while (shorts.hasRemaining()) {
            sum += shorts.get().toInt()
            count += 1
            if (count == channelCount) {
              resampler.push(sum.toFloat() / (channelCount * 32768f))
              sum = 0
              count = 0
            }
          }
        }
        codec.releaseOutputBuffer(index, false)
        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
      }
    }

    for (frame in frames) {
      var inputIndex = -1
      var attempts = 0
      while (inputIndex < 0 && attempts < 200) {
        inputIndex = codec.dequeueInputBuffer(TIMEOUT_US)
        attempts += 1
      }
      if (inputIndex < 0) break
      val input = codec.getInputBuffer(inputIndex)
      if (input != null) {
        input.clear()
        input.put(frame)
        codec.queueInputBuffer(inputIndex, 0, frame.size, 0, 0)
      }
      drain(false)
    }

    val endIndex = codec.dequeueInputBuffer(TIMEOUT_US)
    if (endIndex >= 0) {
      codec.queueInputBuffer(endIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
    }
    drain(true)

    codec.stop()
    codec.release()
    resampler.flush()
    output.flush()
    output.close()

    val pcmBytes = (target.length() - 44).toInt()
    val file = RandomAccessFile(target, "rw")
    file.seek(0)
    file.write(wavHeader(pcmBytes))
    file.close()
  }

  private fun wavHeader(dataBytes: Int): ByteArray {
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    header.put("RIFF".toByteArray())
    header.putInt(36 + dataBytes)
    header.put("WAVE".toByteArray())
    header.put("fmt ".toByteArray())
    header.putInt(16)
    header.putShort(1) // PCM
    header.putShort(1) // mono
    header.putInt(OUT_RATE)
    header.putInt(OUT_RATE * 2) // byte rate = rate * canais * bytes por amostra
    header.putShort(2) // block align
    header.putShort(16) // bits por amostra
    header.put("data".toByteArray())
    header.putInt(dataBytes)
    return header.array()
  }

  private fun toPath(uri: String): String {
    return if (uri.startsWith("file://")) {
      Uri.parse(uri).path ?: uri.removePrefix("file://")
    } else {
      uri
    }
  }

  /** Reamostragem em streaming para 16 kHz (media de caixa ao reduzir). */
  private class Resampler(srcRate: Int, dstRate: Int, private val sink: (Short) -> Unit) {
    private val src = srcRate.toDouble()
    private val dst = dstRate.toDouble()
    private val passthrough = srcRate <= dstRate
    private var sum = 0.0
    private var count = 0
    private var acc = 0.0

    fun push(sample: Float) {
      if (passthrough) {
        emit(sample)
        return
      }
      sum += sample
      count += 1
      acc += dst
      while (acc >= src) {
        acc -= src
        emit((sum / count).toFloat())
        sum = 0.0
        count = 0
      }
    }

    fun flush() {
      if (!passthrough && count > 0) {
        emit((sum / count).toFloat())
        sum = 0.0
        count = 0
      }
    }

    private fun emit(value: Float) {
      val clamped = if (value < -1f) -1f else if (value > 1f) 1f else value
      sink((clamped * 32767f).toInt().toShort())
    }
  }
}
