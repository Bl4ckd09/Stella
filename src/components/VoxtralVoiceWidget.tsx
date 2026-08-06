"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  normalizeGatewayUrl,
  OUTPUT_SAMPLE_RATE,
  pcm16ToFloat32,
  shouldResetPlaybackQueue,
} from "@/lib/voiceAudio";

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
  recoverable?: boolean;
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

  const stateRef = useRef<VoiceState>("idle");
  const socketRef = useRef<WebSocket | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const muteRef = useRef<GainNode | null>(null);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextAudioTimeRef = useRef(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);

  function transition(next: VoiceState) {
    stateRef.current = next;
    setState(next);
  }

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

  async function cleanupResources(closeSocket = true) {
    abortRef.current?.abort();
    abortRef.current = null;
    const socket = socketRef.current;
    socketRef.current = null;
    if (closeSocket && socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "client_closed");
    }
    if (workletRef.current) workletRef.current.port.onmessage = null;
    mediaSourceRef.current?.disconnect();
    workletRef.current?.disconnect();
    muteRef.current?.disconnect();
    mediaSourceRef.current = null;
    workletRef.current = null;
    muteRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    stopPlayback();
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") await context.close().catch(() => undefined);
  }

  async function stopSession() {
    transition("idle");
    setPartial("");
    await cleanupResources();
  }

  async function failSession(message: string) {
    setReply(message);
    setPartial("");
    transition("error");
    await cleanupResources();
  }

  useEffect(() => () => {
    void cleanupResources();
  }, []);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      void stopSession();
      launcherRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function playPcm(bytes: ArrayBuffer, sampleRate = OUTPUT_SAMPLE_RATE) {
    const context = audioContextRef.current;
    if (!context || !bytes.byteLength) return;
    if (shouldResetPlaybackQueue(context.currentTime, nextAudioTimeRef.current)) stopPlayback();
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

  async function handleGatewayEvent(event: GatewayEvent) {
    switch (event.type) {
      case "ready":
      case "turn_end":
        transition("listening");
        inputRef.current?.focus();
        break;
      case "speech_started":
        setPartial("");
        transition("listening");
        break;
      case "transcript_partial":
      case "transcript_final":
        setPartial(event.text || "");
        if (event.type === "transcript_final") transition("thinking");
        break;
      case "reply_text":
        setReply(event.text || "");
        transition("thinking");
        break;
      case "audio_start":
        stopPlayback();
        transition("speaking");
        break;
      case "audio_end":
        transition("listening");
        break;
      case "playback_cancel":
        stopPlayback();
        transition("listening");
        break;
      case "error":
        if (event.recoverable) {
          setReply(event.message || "Please try again.");
          setPartial("");
          transition("listening");
        } else {
          await failSession(event.message || "Voice is unavailable. Try again.");
        }
        break;
    }
  }

  async function startMicrophone(socket: WebSocket, context: AudioContext) {
    await context.audioWorklet.addModule("/voxtral-audio-worklet.js");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (socketRef.current !== socket || audioContextRef.current !== context) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    const source = context.createMediaStreamSource(stream);
    mediaSourceRef.current = source;
    const worklet = new AudioWorkletNode(context, "stella-pcm-processor", {
      processorOptions: { targetSampleRate: 16_000 },
    });
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(worklet);
    worklet.connect(mute);
    mute.connect(context.destination);
    worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (socketRef.current === socket && socket.readyState === WebSocket.OPEN) socket.send(event.data);
    };
    workletRef.current = worklet;
    muteRef.current = mute;
  }

  async function startSession() {
    if (stateRef.current !== "idle" && stateRef.current !== "error") return;
    await cleanupResources();
    setOpen(true);
    transition("connecting");
    setReply("Connecting to Stella...");
    setPartial("");
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const context = new AudioContext();
      audioContextRef.current = context;
      await context.resume();
      const response = await fetch("/api/voice/session", { method: "POST", signal: abort.signal });
      if (!response.ok) throw new Error("Voice session could not start");
      const session = await response.json() as SessionResponse;
      if (abort.signal.aborted) return;
      const endpoint = new URL(normalizeGatewayUrl(session.gateway_url));
      if (endpoint.pathname === "/") endpoint.pathname = "/ws";
      endpoint.searchParams.delete("token");
      let sessionToken = session.token;

      const socket = new WebSocket(endpoint);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onopen = async () => {
        if (socketRef.current !== socket) return;
        socket.send(JSON.stringify({ type: "auth", token: sessionToken }));
        sessionToken = "";
      };
      socket.onmessage = async (event) => {
        if (socketRef.current !== socket) return;
        if (event.data instanceof ArrayBuffer) {
          playPcm(event.data);
          return;
        }
        try {
          const gatewayEvent = JSON.parse(String(event.data)) as GatewayEvent;
          if (gatewayEvent.type === "ready") {
            try {
              await startMicrophone(socket, context);
            } catch {
              setReply("Microphone access is off. Use the text box instead.");
            }
          }
          await handleGatewayEvent(gatewayEvent);
        } catch {
          void failSession("The voice gateway sent an invalid response.");
        }
      };
      socket.onerror = () => {
        if (socketRef.current === socket) void failSession("The voice connection failed. Try again.");
      };
      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        void cleanupResources(false).then(() => {
          if (stateRef.current !== "error") transition("idle");
        });
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      await failSession("Voice is unavailable. Try again or use the main form.");
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
    transition("thinking");
  }

  function closePanel() {
    setOpen(false);
    void stopSession();
    launcherRef.current?.focus();
  }

  const sessionActive = state !== "idle" && state !== "error";
  const canSend = sessionActive && state !== "connecting" && socketRef.current?.readyState === WebSocket.OPEN;

  return (
    <aside className={`voice-widget ${open ? "open" : ""}`} aria-label="Stella voice assistant">
      {open && (
        <div
          id="voice-panel"
          ref={panelRef}
          className="voice-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="voice-panel-title"
          aria-describedby="voice-panel-message voice-panel-privacy"
          tabIndex={-1}
        >
          <div className="voice-panel-head">
            <div>
              <strong id="voice-panel-title">Talk to Stella</strong>
              <span className={`voice-state ${state}`} aria-live="polite">{labels[state]}</span>
            </div>
            <button className="voice-close" aria-label="Close voice assistant" onClick={closePanel}>×</button>
          </div>
          <p id="voice-panel-message" className="voice-transcript" aria-live="polite">
            {partial || reply}
          </p>
          {state !== "error" && (
            <form className="voice-text-form" onSubmit={submitText}>
              <input
                ref={inputRef}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Or type your business and postcode"
                aria-label="Message Stella"
                disabled={!canSend}
              />
              <button type="submit" disabled={!text.trim() || !canSend}>Send</button>
            </form>
          )}
          <p id="voice-panel-privacy" className="voice-privacy">
            Stella does not save audio or transcripts. Voice providers process them during this session.
          </p>
        </div>
      )}
      <button
        ref={launcherRef}
        className={`voice-launcher ${state}`}
        onClick={sessionActive ? () => void stopSession() : () => void startSession()}
        aria-expanded={open}
        aria-controls="voice-panel"
      >
        <span className="voice-pulse" aria-hidden="true" />
        {open ? labels[state] : "Talk to Stella"}
      </button>
    </aside>
  );
}
