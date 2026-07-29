"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { normalizeGatewayUrl, OUTPUT_SAMPLE_RATE, pcm16ToFloat32 } from "@/lib/voiceAudio";

type VoiceState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

interface SessionResponse {
  token: string;
  gateway_url: string;
}

interface GatewayEvent {
  type: string;
  text?: string;
  message?: string;
  sample_rate?: number;
}

const labels: Record<VoiceState, string> = {
  idle: "Start voice",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Try again",
};

export default function VoxtralVoiceWidget() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [partial, setPartial] = useState("");
  const [reply, setReply] = useState("Ask Stella what your business can claim.");
  const [text, setText] = useState("");

  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const muteRef = useRef<GainNode | null>(null);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextAudioTimeRef = useRef(0);

  function stopPlayback() {
    for (const source of sourcesRef.current) {
      try {
        source.stop();
      } catch {
        // The source already stopped.
      }
    }
    sourcesRef.current.clear();
    nextAudioTimeRef.current = audioContextRef.current?.currentTime ?? 0;
  }

  async function stopSession() {
    socketRef.current?.close(1000, "client_closed");
    socketRef.current = null;
    workletRef.current?.disconnect();
    muteRef.current?.disconnect();
    workletRef.current = null;
    muteRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    stopPlayback();
    if (audioContextRef.current) await audioContextRef.current.close().catch(() => undefined);
    audioContextRef.current = null;
    setPartial("");
    setState("idle");
  }

  useEffect(() => () => {
    void stopSession();
  }, []);

  function playPcm(bytes: ArrayBuffer, sampleRate = OUTPUT_SAMPLE_RATE) {
    const context = audioContextRef.current;
    if (!context || !bytes.byteLength) return;
    const samples = pcm16ToFloat32(bytes);
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.015, nextAudioTimeRef.current);
    source.start(startAt);
    nextAudioTimeRef.current = startAt + buffer.duration;
    sourcesRef.current.add(source);
    source.onended = () => sourcesRef.current.delete(source);
  }

  function handleGatewayEvent(event: GatewayEvent) {
    switch (event.type) {
      case "ready":
      case "turn_end":
        setState("listening");
        break;
      case "speech_started":
        setPartial("");
        setState("listening");
        break;
      case "transcript_partial":
      case "transcript_final":
        setPartial(event.text || "");
        if (event.type === "transcript_final") setState("thinking");
        break;
      case "reply_text":
        setReply(event.text || "");
        setState("thinking");
        break;
      case "audio_start":
        stopPlayback();
        setState("speaking");
        break;
      case "audio_end":
        setState("listening");
        break;
      case "playback_cancel":
        stopPlayback();
        setState("listening");
        break;
      case "error":
        setReply(event.message || "Voice is unavailable. Use the text box or try again.");
        setState("error");
        break;
    }
  }

  async function startMicrophone(socket: WebSocket, context: AudioContext) {
    await context.audioWorklet.addModule("/voxtral-audio-worklet.js");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;
    const source = context.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(context, "stella-pcm-processor", {
      processorOptions: { targetSampleRate: 16_000 },
    });
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(worklet);
    worklet.connect(mute);
    mute.connect(context.destination);
    worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(event.data);
    };
    workletRef.current = worklet;
    muteRef.current = mute;
  }

  async function startSession() {
    if (state !== "idle" && state !== "error") return;
    setOpen(true);
    setState("connecting");
    setReply("Connecting to Stella…");
    setPartial("");
    try {
      const context = new AudioContext();
      audioContextRef.current = context;
      await context.resume();
      const response = await fetch("/api/voice/session", { method: "POST" });
      if (!response.ok) throw new Error("Voice session could not start");
      const session = (await response.json()) as SessionResponse;
      const endpoint = new URL(normalizeGatewayUrl(session.gateway_url));
      if (endpoint.pathname === "/") endpoint.pathname = "/ws";
      endpoint.searchParams.set("token", session.token);

      const socket = new WebSocket(endpoint);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onopen = async () => {
        try {
          await startMicrophone(socket, context);
        } catch {
          setReply("Microphone access is off. You can still use the text box.");
          setState("listening");
        }
      };
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          playPcm(event.data);
          return;
        }
        try {
          handleGatewayEvent(JSON.parse(String(event.data)) as GatewayEvent);
        } catch {
          setReply("The voice gateway sent an invalid response.");
          setState("error");
        }
      };
      socket.onerror = () => {
        setReply("The voice connection failed. Try again.");
        setState("error");
      };
      socket.onclose = () => {
        socketRef.current = null;
        if (state !== "idle") setState("idle");
      };
    } catch {
      await stopSession();
      setReply("Voice is unavailable. Try again or use the main form.");
      setState("error");
    }
  }

  function submitText(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    const socket = socketRef.current;
    if (!value || !socket || socket.readyState !== WebSocket.OPEN) return;
    stopPlayback();
    socket.send(JSON.stringify({ type: "text_input", text: value }));
    setPartial(value);
    setText("");
    setState("thinking");
  }

  return (
    <aside className={`voice-widget ${open ? "open" : ""}`} aria-label="Stella voice assistant">
      {open && (
        <div className="voice-panel">
          <div className="voice-panel-head">
            <div>
              <strong>Talk to Stella</strong>
              <span className={`voice-state ${state}`}>{labels[state]}</span>
            </div>
            <button className="voice-close" aria-label="Close voice assistant" onClick={() => { setOpen(false); void stopSession(); }}>×</button>
          </div>
          <p className="voice-transcript">{partial || reply}</p>
          <form className="voice-text-form" onSubmit={submitText}>
            <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Or type your business and postcode" aria-label="Message Stella" />
            <button type="submit" disabled={!text.trim() || !socketRef.current}>Send</button>
          </form>
          <p className="voice-privacy">Audio and transcripts are not stored.</p>
        </div>
      )}
      <button
        className={`voice-launcher ${state}`}
        onClick={open && state !== "idle" && state !== "error" ? () => void stopSession() : startSession}
        aria-expanded={open}
      >
        <span className="voice-pulse" aria-hidden="true" />
        {open ? labels[state] : "Talk to Stella"}
      </button>
    </aside>
  );
}
