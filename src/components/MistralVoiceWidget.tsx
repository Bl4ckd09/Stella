"use client";

import { useRef, useState } from "react";

/**
 * Floating Mistral Voxtral voice widget.
 *
 * Records microphone audio as 16 kHz mono WAV, sends turns to the server-side
 * Mistral agent, plays returned MP3 audio when available, and keeps a compact
 * local transcript.
 */
interface Turn {
  role: "user" | "assistant";
  content: string;
}

interface VoiceResponse {
  user_text: string;
  reply_text: string;
  audio_base64: string | null;
  audio_format: "mp3";
  history: Turn[];
  timings?: { total_ms?: number };
  error?: string;
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function downsample(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const sample of samples) {
    const s = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export default function MistralVoiceWidget() {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [latency, setLatency] = useState<number | null>(null);
  const chunks = useRef<Float32Array[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const source = useRef<MediaStreamAudioSourceNode | null>(null);
  const processor = useRef<ScriptProcessorNode | null>(null);

  async function startRecording() {
    setError(null);
    setLatency(null);
    try {
      chunks.current = [];
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      context.current = new AudioContext();
      source.current = context.current.createMediaStreamSource(stream.current);
      processor.current = context.current.createScriptProcessor(4096, 1, 1);
      processor.current.onaudioprocess = (event) => {
        chunks.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.current.connect(processor.current);
      processor.current.connect(context.current.destination);
      setRecording(true);
    } catch {
      setError("Microphone permission was denied");
      cleanupAudio();
    }
  }

  function cleanupAudio() {
    processor.current?.disconnect();
    source.current?.disconnect();
    stream.current?.getTracks().forEach((track) => track.stop());
    void context.current?.close();
    processor.current = null;
    source.current = null;
    stream.current = null;
    context.current = null;
  }

  async function stopAndSend() {
    const sampleRate = context.current?.sampleRate ?? 48000;
    setRecording(false);
    cleanupAudio();
    const pcm = downsample(mergeChunks(chunks.current), sampleRate, 16000);
    chunks.current = [];
    if (!pcm.length) return;

    setBusy(true);
    setError(null);
    try {
      const wav = encodeWav(pcm, 16000);
      const res = await fetch("/api/mistral-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio_base64: base64(wav),
          audio_format: "audio/wav",
          history,
          phone,
        }),
      });
      const data = await res.json().catch(() => ({})) as VoiceResponse;
      if (!res.ok) {
        setError(res.status === 503 ? "Voice is not configured on this deployment" : data.error || "Network failure");
        return;
      }
      setHistory(data.history);
      setLatency(typeof data.timings?.total_ms === "number" ? data.timings.total_ms : null);
      if (data.audio_base64) {
        const audio = new Audio(`data:audio/mp3;base64,${data.audio_base64}`);
        await audio.play().catch(() => undefined);
      }
    } catch {
      setError("Network failure");
    } finally {
      setBusy(false);
    }
  }

  const panelOpen = history.length > 0 || Boolean(error) || busy || recording;

  return (
    <div style={styles.root}>
      {panelOpen && (
        <div style={styles.panel}>
          <div style={styles.transcript}>
            {history.slice(-6).map((turn, i) => (
              <div key={`${turn.role}-${i}`} style={turn.role === "user" ? styles.userTurn : styles.assistantTurn}>
                <span style={styles.turnLabel}>{turn.role === "user" ? "You" : "Stella"}</span>
                {turn.content}
              </div>
            ))}
            {busy && <div style={styles.muted}>Thinking...</div>}
            {recording && <div style={styles.muted}>Listening...</div>}
            {error && <div style={styles.error}>{error}</div>}
          </div>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+44..."
            aria-label="Phone number for claim letter text"
            style={styles.phone}
          />
          <div style={styles.caption}>
            <span>Powered by Mistral Voxtral</span>
            {latency !== null && <span>{latency}ms</span>}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={recording ? stopAndSend : startRecording}
        disabled={busy}
        aria-label={recording ? "Stop recording" : "Start voice"}
        style={{
          ...styles.button,
          ...(recording ? styles.buttonRecording : null),
          ...(busy ? styles.buttonBusy : null),
        }}
      >
        {recording ? "Stop" : busy ? "..." : "Mic"}
      </button>
    </div>
  );
}

const styles = {
  root: {
    position: "fixed",
    right: 18,
    bottom: 18,
    zIndex: 80,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 10,
    maxWidth: "calc(100vw - 28px)",
  },
  panel: {
    width: "min(360px, calc(100vw - 28px))",
    maxHeight: "52vh",
    overflow: "hidden",
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    boxShadow: "0 16px 44px rgba(0,0,0,.38)",
    padding: 12,
  },
  transcript: {
    maxHeight: "36vh",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  userTurn: {
    alignSelf: "flex-end",
    maxWidth: "88%",
    background: "var(--accent)",
    color: "#fff",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 13,
    lineHeight: 1.35,
  },
  assistantTurn: {
    alignSelf: "flex-start",
    maxWidth: "88%",
    background: "var(--panel-2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 13,
    lineHeight: 1.35,
  },
  turnLabel: {
    display: "block",
    opacity: 0.7,
    fontSize: 11,
    marginBottom: 2,
  },
  muted: {
    color: "var(--muted)",
    fontSize: 13,
  },
  error: {
    color: "var(--red)",
    fontSize: 13,
  },
  phone: {
    marginTop: 10,
    padding: "9px 10px",
    fontSize: 13,
    borderRadius: 8,
  },
  caption: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    color: "var(--muted)",
    fontSize: 11,
    marginTop: 8,
  },
  button: {
    width: 64,
    height: 64,
    borderRadius: 999,
    border: "1px solid var(--border)",
    background: "var(--accent)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 10px 30px rgba(0,0,0,.36)",
  },
  buttonRecording: {
    background: "var(--red)",
  },
  buttonBusy: {
    opacity: 0.65,
    cursor: "default",
  },
} as const;
