// ============================================================
// pages/api/transcribe.js
// Chunked AssemblyAI transcription pipeline (300s chunks)
// ============================================================

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';

export const config = {
    api: {
        bodyParser: false,   // we read the raw stream ourselves
        responseLimit: false,
    },
};

const execFileAsync = promisify(execFile);
const CHUNK_SECONDS = 300;
const MAX_CONCURRENT_CHUNKS = 5;
const POLL_INTERVAL_MS = 2500;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRequestBuffer(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function cleanTranscript(text) {
    if (!text) return '';
    const FILLER = /^(hmm+|uh+|um+|ah+|oh+|huh|mm+|err+|hm+)\.?$/i;
    return String(text)
        .split('\n')
        .filter((line) => !FILLER.test(line.trim()))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function formatSrtTime(ms) {
    const totalMs = Math.max(0, Math.floor(ms));
    const hours = Math.floor(totalMs / 3_600_000);
    const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
    const seconds = Math.floor((totalMs % 60_000) / 1_000);
    const millis = totalMs % 1_000;
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

function speakerPrefix(speaker) {
    if (speaker === undefined || speaker === null || speaker === '') return '';
    const speakerNum = Number(speaker);
    if (Number.isFinite(speakerNum)) return `Speaker ${speakerNum + 1}: `;
    return `Speaker ${String(speaker)}: `;
}

function buildCuesFromUtterances(utterances, offsetMs) {
    if (!Array.isArray(utterances) || !utterances.length) return [];
    return utterances
        .filter((u) => u && typeof u.text === 'string' && u.text.trim())
        .map((u) => {
            const startMs = (Number(u.start) || 0) + offsetMs;
            const endMs = (Number(u.end) || Number(u.start) || 0) + offsetMs;
            return {
                startMs,
                endMs: Math.max(endMs, startMs + 800),
                text: `${speakerPrefix(u.speaker)}${u.text.trim()}`,
            };
        });
}

function buildCuesFromWords(words, offsetMs) {
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

        if (endsSentence || tooLongByWords || tooLongByTime) flush();
    }

    flush();
    return cues;
}

function buildSrtFromChunks(chunkResults) {
    const cues = [];

    for (const chunk of chunkResults) {
        const offsetMs = Number(chunk.offsetMs) || 0;
        const utterances = Array.isArray(chunk.utterances) ? chunk.utterances : [];
        const words = Array.isArray(chunk.words) ? chunk.words : [];

        if (utterances.length) {
            cues.push(...buildCuesFromUtterances(utterances, offsetMs));
        } else if (words.length) {
            cues.push(...buildCuesFromWords(words, offsetMs));
        } else if (chunk.text?.trim()) {
            cues.push({
                startMs: offsetMs,
                endMs: offsetMs + CHUNK_SECONDS * 1000,
                text: chunk.text.trim(),
            });
        }
    }

    cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

    return (
        cues
            .map((cue, i) => `${i + 1}\n${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}\n${cue.text}`)
            .join('\n\n') + (cues.length ? '\n' : '')
    );
}

async function splitAudioIntoChunks(inputPath, outputDir) {
    if (!ffmpegPath) {
        throw new Error(
            'ffmpeg-static binary not found. Install ffmpeg-static or provide ffmpeg on the server.'
        );
    }

    const outputPattern = path.join(outputDir, 'chunk_%03d.mp3');

    await execFileAsync(
        ffmpegPath,
        [
            '-y',
            '-i', inputPath,
            '-map', '0:a:0',
            '-vn',
            '-acodec', 'libmp3lame',
            '-b:a', '128k',
            '-f', 'segment',
            '-segment_time', String(CHUNK_SECONDS),
            '-reset_timestamps', '1',
            outputPattern,
        ],
        { windowsHide: true, maxBuffer: 1024 * 1024 * 16 }
    );
}

async function uploadChunkToAssemblyAI(chunkBuffer, apiKey) {
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST',
        headers: {
            Authorization: apiKey,
            'Content-Type': 'application/octet-stream',
        },
        body: chunkBuffer,
    });

    if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`AssemblyAI upload failed (${uploadRes.status}): ${errText}`);
    }

    const uploadData = await uploadRes.json();
    if (!uploadData.upload_url) throw new Error('AssemblyAI upload returned no upload_url');
    return uploadData.upload_url;
}

async function startTranscriptJob(uploadUrl, apiKey) {
    const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: {
            Authorization: apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            audio_url: uploadUrl,
            speech_models: ['universal-2'],
            speaker_labels: true,
            punctuate: true,
            format_text: true,
            disfluencies: false,
            auto_highlights: false,
        }),
    });

    if (!transcriptRes.ok) {
        const errText = await transcriptRes.text();
        throw new Error(`AssemblyAI transcript start failed (${transcriptRes.status}): ${errText}`);
    }

    const transcriptData = await transcriptRes.json();
    if (!transcriptData.id) throw new Error('AssemblyAI transcript job returned no id');
    return transcriptData.id;
}

async function waitForTranscript(transcriptId, apiKey) {
    while (true) {
        const statusRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
            method: 'GET',
            headers: { Authorization: apiKey },
        });

        if (!statusRes.ok) {
            const errText = await statusRes.text();
            throw new Error(`AssemblyAI status poll failed (${statusRes.status}): ${errText}`);
        }

        const data = await statusRes.json();

        if (data.status === 'completed') return data;
        if (data.status === 'error') throw new Error(data.error || 'AssemblyAI returned transcription error');

        await sleep(POLL_INTERVAL_MS);
    }
}

async function processChunk(chunkPath, chunkIndex, apiKey) {
    const chunkBuffer = await fs.readFile(chunkPath);
    const uploadUrl = await uploadChunkToAssemblyAI(chunkBuffer, apiKey);
    const transcriptId = await startTranscriptJob(uploadUrl, apiKey);
    const data = await waitForTranscript(transcriptId, apiKey);

    const offsetMs = chunkIndex * CHUNK_SECONDS * 1000;

    const utterances = Array.isArray(data.utterances)
        ? data.utterances.map((u) => ({
            speaker: u.speaker,
            text: u.text,
            start: (Number(u.start) || 0) + offsetMs,
            end: (Number(u.end) || Number(u.start) || 0) + offsetMs,
        }))
        : [];

    const words = Array.isArray(data.words)
        ? data.words.map((w) => ({
            text: w.text,
            start: (Number(w.start) || 0) + offsetMs,
            end: (Number(w.end) || Number(w.start) || 0) + offsetMs,
        }))
        : [];

    return { chunkIndex, offsetMs, text: String(data.text || '').trim(), utterances, words };
}

async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    let active = 0;

    return new Promise((resolve, reject) => {
        const launch = () => {
            if (nextIndex >= items.length && active === 0) {
                resolve(results);
                return;
            }
            while (active < limit && nextIndex < items.length) {
                const current = nextIndex++;
                active++;
                Promise.resolve(worker(items[current], current))
                    .then((result) => { results[current] = result; })
                    .catch(reject)
                    .finally(() => { active--; launch(); });
            }
        };
        launch();
    });
}

async function cleanupDir(dirPath) {
    try { await fs.rm(dirPath, { recursive: true, force: true }); } catch { /* ignore */ }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not set' });

    const contentType = (req.headers['content-type'] || '').toLowerCase();

    // ── Path A: Large file — client already uploaded to AssemblyAI ───────────
    // LiveRecorder POSTs { upload_url } as JSON when blob > LARGE_AUDIO_THRESHOLD.
    // We skip FFmpeg entirely and go straight to job creation + polling.
    if (contentType.includes('application/json')) {
        let body;
        try {
            body = await new Promise((resolve, reject) => {
                let raw = '';
                req.on('data', (chunk) => { raw += chunk; });
                req.on('end', () => {
                    try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
                });
                req.on('error', reject);
            });
        } catch {
            return res.status(400).json({ error: 'Invalid JSON body' });
        }

        const { upload_url } = body;
        if (!upload_url) return res.status(400).json({ error: 'Missing upload_url' });

        try {
            const transcriptId = await startTranscriptJob(upload_url, apiKey);
            const data = await waitForTranscript(transcriptId, apiKey);
            const transcript = cleanTranscript(String(data.text || '').trim());

            const singleChunk = {
                chunkIndex: 0,
                offsetMs: 0,
                text: String(data.text || '').trim(),
                utterances: Array.isArray(data.utterances) ? data.utterances : [],
                words: Array.isArray(data.words) ? data.words : [],
            };
            const srt = buildSrtFromChunks([singleChunk]);

            return res.status(200).json({ status: 'completed', transcript, srt, chunks: 1 });
        } catch (error) {
            return res.status(500).json({ error: `Transcription failed: ${error.message}` });
        }
    }

    // ── Path B: Small file — raw binary blob, FFmpeg pipeline ────────────────
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-audio-'));
    const inputPath = path.join(tempRoot, 'input.bin');
    const chunksDir = path.join(tempRoot, 'chunks');

    try {
        const audioBuffer = await readRequestBuffer(req);
        if (!audioBuffer.length) return res.status(400).json({ error: 'No audio data received' });

        await fs.writeFile(inputPath, audioBuffer);
        await fs.mkdir(chunksDir, { recursive: true });
        await splitAudioIntoChunks(inputPath, chunksDir);

        const chunkFiles = (await fs.readdir(chunksDir))
            .filter((name) => /^chunk_\d+\.mp3$/i.test(name))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        if (!chunkFiles.length) throw new Error('No audio chunks were created');

        const chunkItems = chunkFiles.map((fileName, index) => ({
            chunkIndex: index,
            chunkPath: path.join(chunksDir, fileName),
        }));

        const chunkResults = await mapWithConcurrency(
            chunkItems,
            MAX_CONCURRENT_CHUNKS,
            (item) => processChunk(item.chunkPath, item.chunkIndex, apiKey)
        );

        const ordered = chunkResults
            .filter(Boolean)
            .sort((a, b) => a.chunkIndex - b.chunkIndex);

        const transcript = cleanTranscript(
            ordered.map((c) => c.text).filter(Boolean).join('\n\n')
        );
        const srt = buildSrtFromChunks(ordered);

        return res.status(200).json({ status: 'completed', transcript, srt, chunks: ordered.length });
    } catch (error) {
        return res.status(500).json({ error: `Transcription failed: ${error.message}` });
    } finally {
        await cleanupDir(tempRoot);
    }
}