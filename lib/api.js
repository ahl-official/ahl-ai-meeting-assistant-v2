// ============================================================
// lib/api.js — Apps Script API client
// All calls go through the single Apps Script Web App URL.
// The action is passed as a query param; the body as POST JSON.
// ============================================================

const PROXY_URL = '/api/apps-script';

function summarizeResponseText(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'No response body.';
  if (/<!doctype html>|<html[\s>]/i.test(raw)) {
    return 'Received HTML instead of API JSON. Check NEXT_PUBLIC_APPS_SCRIPT_URL is a deployed Apps Script Web App /exec URL.';
  }
  return raw.slice(0, 220);
}

async function request(action, payload = {}) {
  try {
    const res = await fetch(`${PROXY_URL}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    if (!res.ok) {
      const errText = await res.text();
      let message = summarizeResponseText(errText);
      if (/<!doctype html>|<html[\s>]/i.test(errText)) {
        message = 'Received HTML error from server. Check that NEXT_PUBLIC_APPS_SCRIPT_URL is a deployed Apps Script Web App /exec URL.';
      } else if (contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(errText);
          if (parsed?.error) message = parsed.error;
          if (parsed?.detail) message = `${message} (${parsed.detail})`;
        } catch (e) { }
      }
      throw new Error(`Request failed (${res.status}): ${message}`);
    }

    if (!contentType.includes('application/json')) {
      const bodyText = await res.text();
      throw new Error(`Invalid API response: ${summarizeResponseText(bodyText)}`);
    }

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error from Apps Script');
    return data;
  } catch (err) {
    console.error(`API ${action} failed:`, err);
    throw err;
  }
}

// ── Auth ──────────────────────────────────────────────────────

/**
 * login({ identifier, password })
 * identifier = email OR phone OR username
 * Returns { user: { email, phone, username, active, createdAt, isAdmin } }
 */
export const login = (identifier, password) =>
  request('login', { identifier, password });

/**
 * register({ email, phone, username, password })
 * email and phone are stored in separate Auth sheet columns.
 */
export const register = ({ email, phone, username, password }) =>
  request('register', { email, phone, username, password });

export const getUser = (identifier) =>
  request('getUser', { identifier });

/**
 * setActive — activate or deactivate a user account
 * identifier: email, phone, or username of the target user
 */
export const setActive = (identifier, active) =>
  request('setActive', { identifier, active });

// ── Meetings ──────────────────────────────────────────────────

/** Fetch all meetings for a user (sorted newest first) */
export const getMeetings = (identifier) =>
  request('getMeetings', { username: identifier });

/** Save a complete meeting record */
export const saveMeeting = (username, meeting) =>
  request('saveMeeting', { username, meeting });

/**
 * saveTranscript — call RIGHT after transcription finishes.
 * Creates a new row with transcript only (analysis fields blank).
 * Returns { id } — use this id to call saveAnalysis.
 */
export const saveTranscript = (username, { meetingId, title, transcript, duration, type }) =>
  request('saveTranscript', { username, meetingId, title, transcript, duration, type });

/**
 * saveAnalysis — call after AI analysis returns.
 * Finds the row by meetingId and fills in summary/actionPoints/decisions/nextSteps/tasks.
 * IMPORTANT: analysis object must include tasks array — never omit it.
 */
export const saveAnalysis = (username, meetingId, analysis) =>
  request('saveAnalysis', { username, meetingId, analysis });

/**
 * updateMeeting — partial update of any meeting fields.
 * updates object is passed through as-is; do NOT strip tasks or actionPoints before calling.
 */
export const updateMeeting = (username, meetingId, updates) =>
  request('updateMeeting', { username, meetingId, updates });

export const deleteMeeting = (username, meetingId) =>
  request('deleteMeeting', { username, meetingId });

// ── Pipeline logging ──────────────────────────────────────────

export const pipelineLog = (username, { action, step, level = 'INFO', message, detail, latencyMs }) =>
  request('pipelineLog', { username, action, step, level, message, detail, latencyMs })
    .catch(() => { }); // Never let logging crash the main flow

// ── Admin ─────────────────────────────────────────────────────

/**
 * getAllUsers — fetch every user's profile.
 * adminUsername must belong to an admin account.
 * Returns { users: [{ email, phone, username, active, createdAt, isAdmin }] }
 */
export const getAllUsers = (adminUsername) =>
  request('getAllUsers', { adminUsername });

/**
 * getAllMeetings — fetch every meeting from every user.
 * Returns { meetings: [{ owner, id, title, summary, actionPoints, tasks, ... }] }
 */
export const getAllMeetings = (adminUsername) =>
  request('getAllMeetings', { adminUsername });

/**
 * getPassword — retrieve a user's plaintext password.
 * adminUsername: the calling admin's username (verified server-side).
 * targetUsername: the user whose password you want.
 * Returns { username, email, phone, password }
 */
export const getPassword = (adminUsername, targetUsername) =>
  request('getPassword', { adminUsername, targetUsername });

/**
 * setAdmin — grant or revoke admin access for a user.
 * adminUsername: calling admin (must already be admin).
 * targetUsername: user to update.
 * isAdmin: true to grant, false to revoke.
 */
export const setAdmin = (adminUsername, targetUsername, isAdmin) =>
  request('setAdmin', { adminUsername, targetUsername, isAdmin });
