/**
 * lib/audio-processor.js
 * Browser-side audio chunking, downsampling, and WAV encoding.
 * This avoids audio corruption and ensures valid chunks for AssemblyAI.
 */

/**
 * Decodes an audio file into an AudioBuffer.
 */
export async function decodeAudioFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    try {
        return await audioCtx.decodeAudioData(arrayBuffer);
    } finally {
        await audioCtx.close();
    }
}

/**
 * Splits an AudioBuffer into smaller chunks (WAV blobs).
 * Each chunk will be mono, 16kHz for efficiency and compatibility.
 */
export async function splitAudioBufferIntoWavChunks(audioBuffer, secondsPerChunk = 60) {
    const targetSampleRate = 16000;
    const totalDuration = audioBuffer.duration;
    const chunks = [];

    for (let start = 0; start < totalDuration; start += secondsPerChunk) {
        const end = Math.min(start + secondsPerChunk, totalDuration);
        const duration = end - start;
        const numberOfSamples = Math.floor(duration * targetSampleRate);

        // Use OfflineAudioContext to downsample and convert to mono
        const offlineCtx = new OfflineAudioContext(1, numberOfSamples, targetSampleRate);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        // Start playing from the offset
        source.start(0, start, duration);

        const renderedBuffer = await offlineCtx.startRendering();
        const wavBlob = encodeWAV(renderedBuffer.getChannelData(0), targetSampleRate);

        chunks.push({
            blob: wavBlob,
            startMs: start * 1000,
            durationMs: duration * 1000
        });
    }

    return chunks;
}

/**
 * Simple WAV encoder for 16-bit mono PCM.
 */
function encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    /* RIFF identifier */
    writeString(view, 0, 'RIFF');
    /* RIFF chunk length */
    view.setUint32(4, 36 + samples.length * 2, true);
    /* RIFF type */
    writeString(view, 8, 'WAVE');
    /* format chunk identifier */
    writeString(view, 12, 'fmt ');
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw) */
    view.setUint16(20, 1, true);
    /* channel count */
    view.setUint16(22, 1, true);
    /* sample rate */
    view.setUint32(24, sampleRate, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, sampleRate * 2, true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, 2, true);
    /* bits per sample */
    view.setUint16(34, 16, true);
    /* data chunk identifier */
    writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, samples.length * 2, true);

    // Write PCM samples
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([view], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatSrtTime(ms) {
    const totalMs = Math.max(0, Math.floor(ms));
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const millis = totalMs % 1000;

    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

export function speakerPrefix(speaker) {
    if (speaker === undefined || speaker === null || speaker === '') return '';
    const speakerNum = Number(speaker);
    if (Number.isFinite(speakerNum)) return `Speaker ${speakerNum + 1}: `;
    return `Speaker ${String(speaker)}: `;
}

export function buildCuesFromUtterances(utterances, offsetMs) {
    if (!Array.isArray(utterances) || !utterances.length) return [];

    return utterances
        .filter(u => u && typeof u.text === 'string' && u.text.trim())
        .map(u => {
            const startMs = (Number(u.start) || 0) + offsetMs;
            const endMs = (Number(u.end) || Number(u.start) || 0) + offsetMs;
            return {
                startMs,
                endMs: Math.max(endMs, startMs + 800),
                text: `${speakerPrefix(u.speaker)}${u.text.trim()}`,
            };
        });
}

export function buildCuesFromWords(words, offsetMs) {
    if (!Array.isArray(words) || !words.length) return [];

    const cues = [];
    let buffer = [];
    let cueStart = null;
    let cueEnd = null;

    const flush = () => {
        if (!buffer.length || cueStart === null || cueEnd === null) return;
        cues.push({
            startMs: cueStart,
            endMs: Math.max(cueEnd, cueStart + 800),
            text: buffer.join(' ').trim(),
        });
        buffer = [];
        cueStart = null;
        cueEnd = null;
    };

    for (const w of words) {
        const text = String(w.text || '').trim();
        if (!text) continue;

        const startMs = (Number(w.start) || 0) + offsetMs;
        const endMs = (Number(w.end) || Number(w.start) || 0) + offsetMs;

        if (cueStart === null) cueStart = startMs;
        cueEnd = endMs;
        buffer.push(text);

        const endsSentence = /[.?!]$/.test(text);
        const tooLongByWords = buffer.length >= 12;
        const tooLongByTime = cueEnd - cueStart >= 4500;

        if (endsSentence || tooLongByWords || tooLongByTime) {
            flush();
        }
    }

    flush();
    return cues;
}

/**
 * Assembles SRT from multiple chunk results, respecting their actual time offsets.
 */
export function buildSrtFromResults(results) {
    const cues = [];

    results.forEach((res) => {
        const offsetMs = res.offsetMs || 0;
        if (res.utterances && res.utterances.length) {
            cues.push(...buildCuesFromUtterances(res.utterances, offsetMs));
        } else if (res.words && res.words.length) {
            cues.push(...buildCuesFromWords(res.words, offsetMs));
        }
    });

    // Final sort and re-index
    cues.sort((a, b) => a.startMs - b.startMs);

    return cues
        .map((cue, index) => {
            return `${index + 1}\n${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}\n${cue.text}`;
        })
        .join('\n\n') + (cues.length ? '\n' : '');
}
