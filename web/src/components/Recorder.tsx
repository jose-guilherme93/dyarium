import { useEffect, useRef, useState } from "react";
import { uploadFile } from "../api";
import { formatDuration } from "../lib/format";
import { MicIcon } from "./icons";

interface RecorderProps {
  onUploaded: () => void;
  // entryId, when set, adds the recording to an existing note.
  entryId?: string;
}

// Recorder captures audio in the browser and uploads it as a new note (or adds
// it to an existing note when entryId is given).
export function Recorder({ onUploaded, entryId }: RecorderProps) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
    };
  }, []);

  const finish = async (mimeType: string) => {
    const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
    const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm";
    const file = new File([blob], `gravacao.${ext}`, { type: mimeType || "audio/webm" });
    setBusy(true);
    setError("");
    try {
      await uploadFile(file, undefined, entryId);
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao enviar a gravacao");
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        void finish(recorder.mimeType);
      };
      recorder.start();
      recorderRef.current = recorder;
      setSeconds(0);
      setRecording(true);
      timerRef.current = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch {
      setError("Nao foi possivel acessar o microfone.");
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
  };

  if (recording) {
    return (
      <div className="recorder recorder--live">
        <span className="recorder-dot" aria-hidden="true" />
        <span className="recorder-time">{formatDuration(seconds)}</span>
        <button type="button" className="recorder-stop" onClick={stop}>
          Parar
        </button>
      </div>
    );
  }

  return (
    <div className="recorder">
      <button type="button" className="recorder-start" onClick={() => void start()} disabled={busy}>
        <MicIcon size={16} />
        {busy ? "Enviando..." : "Gravar"}
      </button>
      {error && <span className="error">{error}</span>}
    </div>
  );
}

export default Recorder;
