package expo.modules.audiodecode

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AudioDecodeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AudioDecode")

    // AsyncFunction roda fora da main thread por padrao.
    AsyncFunction("decodeToWav") { sourcePath: String, targetPath: String ->
      AudioDecoder.decodeToWav(sourcePath, targetPath)
      targetPath
    }
  }
}
