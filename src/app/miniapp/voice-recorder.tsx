"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./miniapp.module.css";

type MiniAppEventPayload = {
  uid: string;
  title: string;
  start: string;
  end: string;
  timezone: string;
};

type VoiceApiResponse =
  | {
      ok: true;
      transcript: string;
      event: MiniAppEventPayload;
      provider: string;
    }
  | {
      ok: false;
      error: string;
      question?: string;
      transcript?: string;
    };

const MAX_RECORDING_MS = 90_000;

export function MiniAppVoiceRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const autoStopRef = useRef<number | null>(null);

  const [initData, setInitData] = useState("");
  const [isTelegram, setIsTelegram] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<VoiceApiResponse | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (autoStopRef.current) {
      window.clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) {
      return;
    }
    for (const track of stream.getTracks()) {
      track.stop();
    }
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) {
      return;
    }

    tg.ready();
    tg.expand();
    setInitData(tg.initData ?? "");
    setIsTelegram(Boolean(tg.initData));
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
      stopStream();
    };
  }, [clearTimers, stopStream]);

  const recordLabel = useMemo(() => {
    if (isUploading) {
      return "Обрабатываю...";
    }
    if (isRecording) {
      return `Стоп · ${formatElapsed(elapsedSec)}`;
    }
    return "Начать запись";
  }, [elapsedSec, isRecording, isUploading]);

  const uploadAudio = useCallback(
    async (blob: Blob) => {
      if (!initData) {
        setError("Mini App должен быть открыт из Telegram.");
        return;
      }

      setIsUploading(true);
      setError("");
      setResponse(null);

      try {
        const fileType = blob.type || "audio/webm";
        const extension = fileType.includes("ogg") ? "ogg" : "webm";
        const formData = new FormData();
        formData.append("audio", blob, `voice.${extension}`);
        formData.append("initData", initData);

        const apiResponse = await fetch("/api/miniapp/voice", {
          method: "POST",
          body: formData
        });
        const payload = (await apiResponse.json()) as VoiceApiResponse;

        if (!apiResponse.ok || !payload || !("ok" in payload) || !payload.ok) {
          setResponse(payload);
          setError(payload && "error" in payload ? payload.error : "Не удалось обработать запись.");
          return;
        }

        setResponse(payload);
      } catch {
        setError("Ошибка сети. Проверьте соединение и повторите.");
      } finally {
        setIsUploading(false);
      }
    },
    [initData]
  );

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return;
    }
    recorder.stop();
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecording || isUploading) {
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setError("Браузер не поддерживает запись аудио через MediaRecorder.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      chunksRef.current = [];
      recorderRef.current = recorder;
      streamRef.current = stream;
      setError("");
      setResponse(null);
      setElapsedSec(0);
      setIsRecording(true);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        clearTimers();
        stopStream();
        setIsRecording(false);
        setElapsedSec(0);

        if (blob.size === 0) {
          setError("Запись получилась пустой. Попробуйте еще раз.");
          return;
        }

        await uploadAudio(blob);
      };

      recorder.start(250);
      timerRef.current = window.setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);
      autoStopRef.current = window.setTimeout(() => {
        stopRecording();
      }, MAX_RECORDING_MS);
    } catch {
      setError("Не удалось получить доступ к микрофону.");
      clearTimers();
      stopStream();
      setIsRecording(false);
    }
  }, [clearTimers, isRecording, isUploading, stopRecording, stopStream, uploadAudio]);

  const handleRecordClick = useCallback(() => {
    if (isRecording) {
      stopRecording();
      return;
    }
    void startRecording();
  }, [isRecording, startRecording, stopRecording]);

  return (
    <div className={styles.recorderWrap}>
      <button
        type="button"
        className={`${styles.recordButton} ${isRecording ? styles.recording : ""}`}
        onClick={handleRecordClick}
        disabled={isUploading}
      >
        <span className={styles.buttonDot} />
        {recordLabel}
      </button>

      <p className={styles.hint}>
        {isTelegram
          ? "После остановки запись автоматически распознается и событие будет добавлено."
          : "Откройте эту страницу через кнопку из Telegram-бота."}
      </p>

      {error ? <p className={styles.error}>{error}</p> : null}

      {response && response.ok ? (
        <div className={styles.resultCard}>
          <p className={styles.resultTitle}>Событие добавлено</p>
          <p className={styles.resultLine}>Название: {response.event.title}</p>
          <p className={styles.resultLine}>Начало: {formatDate(response.event.start, response.event.timezone)}</p>
          <p className={styles.resultMeta}>UID: {response.event.uid}</p>
          <p className={styles.resultMeta}>Текст: {response.transcript}</p>
        </div>
      ) : null}

      {response && !response.ok && response.question ? (
        <div className={styles.resultCard}>
          <p className={styles.resultTitle}>Нужно уточнение</p>
          <p className={styles.resultLine}>{response.question}</p>
          {response.transcript ? <p className={styles.resultMeta}>Текст: {response.transcript}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function pickRecorderMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return null;
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatDate(iso: string, timezone: string): string {
  try {
    const value = new Date(iso);
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: timezone
    }).format(value);
  } catch {
    return iso;
  }
}
