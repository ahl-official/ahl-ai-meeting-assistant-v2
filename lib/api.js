// ============================================================
// lib/api.js — Apps Script API client
// All calls go through the single Apps Script Web App URL.
// The action is passed as a query param; the body as POST JSON.
// ============================================================

const BASE_URL = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;

/**
 * Core request wrapper.
 * Apps Script requires Content-Type: text/plain to avoid CORS preflight.
 */
async function request(action, payload = {}) {
  if (!BASE_URL) throw new Error('NEXT_PUBLIC_APPS_SCRIPT_URL is not set');

  const url = new URL(BASE_URL);
  url.searchParams.set('action', action);

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });

  if (!res.ok) throw new Error(`Network error: ${res.status}`);

  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Unknown error from Apps Script');
  return data;
}

// ── Auth ─────────────────────────────────────────────────────

/**
 * login({ identifier, password })
 * identifier = email OR phone number
 * Returns { user: { email, phone, username, active, createdAt } }
 */
export const login = (identifier, password) =>
  request('login', { identifier, password });

/**
 * register({ email, phone, username, password })
 * email OR phone must be provided (or both)
 */
export const register = ({ email, phone, username, password }) =>
  request('register', { email, phone, username, password });

export const getUser = (identifier) =>
  request('getUser', { identifier });

export const setActive = (identifier, active) =>
  request('setActive', { identifier, active });

// ── Meetings ─────────────────────────────────────────────────

/** Fetch all meetings for a user (sorted newest first) */
export const getMeetings = (username) =>
  request('getMeetings', { username });

/** Save a complete meeting record */
export const saveMeeting = (username, meeting) =>
  request('saveMeeting', { username, meeting });

/**
 * saveTranscript — call RIGHT after Deepgram finishes.
 * Creates a new row with transcript only (analysis fields blank).
 * Returns { id } — use this id to call saveAnalysis.
 */
export const saveTranscript = (username, { meetingId, title, transcript, duration, type }) =>
  request('saveTranscript', { username, meetingId, title, transcript, duration, type });

/**
 * saveAnalysis — call after OpenRouter returns.
 * Finds the row by meetingId and fills in summary/actionPoints/decisions/nextSteps.
 */
export const saveAnalysis = (username, meetingId, analysis) =>
  request('saveAnalysis', { username, meetingId, analysis });

export const updateMeeting = (username, meetingId, updates) =>
  request('updateMeeting', { username, meetingId, updates });

export const deleteMeeting = (username, meetingId) =>
  request('deleteMeeting', { username, meetingId });

// ── Pipeline logging ─────────────────────────────────────────
// Call this from the frontend at each step of the audio pipeline.
// It writes directly to the LOGS tab in Sheets.

export const pipelineLog = (username, { action, step, level = 'INFO', message, detail, latencyMs }) =>
  request('pipelineLog', { username, action, step, level, message, detail, latencyMs })
    .catch(() => { }); // Never let logging crash the main flow