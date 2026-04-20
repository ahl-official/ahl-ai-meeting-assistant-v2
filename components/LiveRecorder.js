import React, { useRef, useState } from "react";

const MAX_BATCH_BYTES = 2 * 1024 * 1024; // 2MB safe

export default function LiveRecorder({ onComplete }) {
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);

  const pendingChunksRef = useRef([]);
  const pendingSizeRef = useRef(0);

  const transcriptPartsRef = useRef([]);

  const [recording, setRecording] = useState(false);

  // 🔹 Send chunk to backend
  async function transcribeChunk(blob) {
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: blob,
    });

    if (!res.ok) {
      throw new Error("Transcription failed");
    }

    const data = await res.json();
    return data.transcript;
  }

  // 🔹 Flush batch when limit reached
  async function flushBatch() {
    if (pendingChunksRef.current.length === 0) return;

    const blob = new Blob(pendingChunksRef.current, {
      type: "audio/webm",
    });

    pendingChunksRef.current = [];
    pendingSizeRef.current = 0;

    const transcript = await transcribeChunk(blob);
    transcriptPartsRef.current.push(transcript);
  }

  // 🔹 Start recording
  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const recorder = new MediaRecorder(stream, {
      mimeType: "audio/webm",
    });

    recorder.ondataavailable = async (e) => {
      if (!e.data.size) return;

      pendingChunksRef.current.push(e.data);
      pendingSizeRef.current += e.data.size;

      // 🚨 Flush before hitting Vercel limit
      if (pendingSizeRef.current >= MAX_BATCH_BYTES) {
        recorder.pause();
        await flushBatch();
        recorder.resume();
      }
    };

    recorder.start(1000); // 1 sec chunks
    mediaRecorderRef.current = recorder;
    setRecording(true);
  }

  // 🔹 Stop recording
  async function stopRecording() {
    mediaRecorderRef.current.stop();
    streamRef.current.getTracks().forEach((t) => t.stop());

    setRecording(false);

    // Flush remaining
    await flushBatch();

    const finalTranscript = transcriptPartsRef.current.join(" ");

    transcriptPartsRef.current = [];

    onComplete(finalTranscript);
  }

  return (
    <div>
      {!recording ? (
        <button onClick={startRecording}>Start Recording</button>
      ) : (
        <button onClick={stopRecording}>Stop Recording</button>
      )}
    </div>
  );
}