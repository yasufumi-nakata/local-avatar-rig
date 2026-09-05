import { useCallback, useEffect, useRef, useState } from "react";

function microphoneErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") return "マイクが許可されていません。ブラウザとmacOSのマイク許可をご確認ください。";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "利用できるマイクが見つかりませんでした。";
  if (name === "NotReadableError") return "マイクを別のアプリが使用中です。";
  return `マイク口パクを開始できませんでした。${name ? `（${name}）` : ""}`;
}

export function useMicrophoneLevel() {
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef(0);
  const sessionRef = useRef(0);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const supported = window.isSecureContext
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && (typeof window.AudioContext === "function" || typeof window.webkitAudioContext === "function");

  const releaseResources = useCallback(() => {
    window.cancelAnimationFrame(animationRef.current);
    animationRef.current = 0;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") void context.close();
  }, []);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    startingRef.current = false;
    releaseResources();
    if (mountedRef.current) {
      setStarting(false);
      setRunning(false);
      setSpeaking(false);
      setLevel(0);
      setMessage(null);
    }
  }, [releaseResources]);

  const start = useCallback(async () => {
    if (startingRef.current || streamRef.current) return;
    if (!supported) {
      setMessage("マイク口パクにはlocalhostまたはHTTPSと、対応ブラウザが必要です。");
      return;
    }

    const sessionId = sessionRef.current + 1;
    sessionRef.current = sessionId;
    startingRef.current = true;
    if (mountedRef.current) {
      setStarting(true);
      setMessage("マイクの許可と端末内音量解析を準備しています。");
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });
      if (sessionId !== sessionRef.current || !mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      // AudioContext初期化が失敗しても、取得済みtrackを必ず解放できるよう
      // getUserMedia成功直後から現在セッションの管理下へ置きます。
      streamRef.current = stream;
      const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
      const context = new AudioContextClass();
      contextRef.current = context;
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.74;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      startingRef.current = false;
      setStarting(false);
      setRunning(true);
      setMessage("音声はブラウザ内で音量だけに変換し、録音・送信しません。");

      const measure = () => {
        if (!streamRef.current) return;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const rms = Math.sqrt(sum / samples.length);
        const normalized = Math.max(0, Math.min(1, (rms - 0.012) * 8.5));
        setLevel((current) => Math.abs(current - normalized) > 0.015 ? normalized : current);
        setSpeaking((current) => {
          const next = normalized > (current ? 0.055 : 0.085);
          return current === next ? current : next;
        });
        animationRef.current = window.requestAnimationFrame(measure);
      };
      animationRef.current = window.requestAnimationFrame(measure);

      stream.getAudioTracks().forEach((track) => {
        track.addEventListener("ended", stop, { once: true });
      });
    } catch (error) {
      if (sessionId !== sessionRef.current) return;
      stop();
      if (mountedRef.current) setMessage(microphoneErrorMessage(error));
    } finally {
      if (sessionId === sessionRef.current && startingRef.current) {
        startingRef.current = false;
        if (mountedRef.current) setStarting(false);
      }
    }
  }, [stop, supported]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [stop]);

  return { supported, starting, running, speaking, level, message, start, stop };
}
