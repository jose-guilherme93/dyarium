#!/usr/bin/env bash
# Measures the peak resident set size (RSS) of whisper-cli for the configured
# models. It generates a deterministic fixture with ffmpeg, so no binary sample
# is versioned in the repository.
set -euo pipefail

WHISPER_BIN="${DIARY_WHISPER_BIN:-whisper-cli}"
FFMPEG_BIN="${DIARY_FFMPEG_BIN:-ffmpeg}"
MODELS_DIR="${DIARY_MODELS_DIR:-models}"
MODELS="${BENCH_MODELS:-small-q5_1 medium-q5_0}"
SECONDS_FIXTURE="${BENCH_SECONDS:-60}"
RUNS="${BENCH_RUNS:-3}"

if ! command -v "$WHISPER_BIN" >/dev/null 2>&1; then
  echo "whisper-cli nao encontrado (DIARY_WHISPER_BIN=$WHISPER_BIN)."
  echo "O benchmark de transcricao exige o whisper-cli e os modelos ggml."
  exit 1
fi

if ! command -v "$FFMPEG_BIN" >/dev/null 2>&1; then
  echo "ffmpeg nao encontrado (DIARY_FFMPEG_BIN=$FFMPEG_BIN)."
  exit 1
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

fixture="$workdir/fixture.wav"
echo "gerando fixture sintetico de ${SECONDS_FIXTURE}s em ${fixture}"
"$FFMPEG_BIN" -hide_banner -loglevel error \
  -f lavfi -i "anoisesrc=d=${SECONDS_FIXTURE}:c=pink:r=16000" \
  -ac 1 -ar 16000 -y "$fixture"

for model in $MODELS; do
  path="$MODELS_DIR/ggml-$model.bin"
  if [ ! -f "$path" ]; then
    echo "modelo ausente: $path (rode: make models)"
    continue
  fi

  echo "== modelo $model =="
  # Warm-up run, not measured.
  /usr/bin/time -v "$WHISPER_BIN" -m "$path" -f "$fixture" -np >/dev/null 2>"$workdir/warm.log" || true

  for i in $(seq 1 "$RUNS"); do
    log="$workdir/run_$i.log"
    /usr/bin/time -v "$WHISPER_BIN" -m "$path" -f "$fixture" -np >/dev/null 2>"$log" || true
    rss="$(grep -E "Maximum resident set size" "$log" | awk '{print $NF}')"
    echo "  execucao $i: pico de RSS = ${rss:-indisponivel} KiB"
  done
done

echo "observacao: o pico reportado e o do subprocesso whisper-cli, medido com /usr/bin/time -v."
