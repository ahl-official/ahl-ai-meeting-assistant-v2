// ============================================================
// AI Meeting Assistant — Google Apps Script REST API
// ============================================================
// SETUP:
// 1. Open script.google.com → New Project
// 2. Paste this entire file
// 3. Update SHEET_ID below with your Google Sheet ID
// 4. Deploy → New Deployment → Web App
//    - Execute as: Me
//    - Who has access: Anyone
// 5. Copy the Web App URL → paste into NEXT_PUBLIC_APPS_SCRIPT_URL in Vercel
// ============================================================

const SHEET_ID = '1K_Kr_htFuRd9nx6T3GjUUy5cgy1sTJeCAy1qn0sd1Qw'; // ← REPLACE THIS

// ── Helpers ──────────────────────────────────────────────────

function getSpreadsheet() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function ok(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, ...data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function err(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

function hashPassword(password) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function ensureAuthSheet(ss) {
  const sheet = getOrCreateSheet(ss, 'AUTH');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['email', 'username', 'password_hash', 'created_at']);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  }
  return sheet;
}

function getUserRow(authSheet, email) {
  const data = authSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) return { row: i + 1, data: data[i] };
  }
  return null;
}

function getUserSheet(ss, email) {
  // Tab name = sanitised email
  const tabName = 'user_' + email.replace(/[@.]/g, '_').toLowerCase();
  const sheet = getOrCreateSheet(ss, tabName);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['id', 'title', 'transcript', 'summary', 'action_points', 'decisions', 'next_steps', 'duration', 'type', 'created_at', 'updated_at']);
    sheet.getRange(1, 1, 1, 11).setFontWeight('bold');
  }
  return sheet;
}

// ── Router ───────────────────────────────────────────────────

function doPost(e) {
  try {
    const params = e.parameter;
    const action = params.action;
    const body = e.postData?.contents ? JSON.parse(e.postData.contents) : {};

    switch (action) {
      case 'login':      return handleLogin(body);
      case 'register':   return handleRegister(body);
      case 'getMeetings': return handleGetMeetings(body);
      case 'saveMeeting': return handleSaveMeeting(body);
      case 'updateMeeting': return handleUpdateMeeting(body);
      case 'deleteMeeting': return handleDeleteMeeting(body);
      default:           return err('Unknown action: ' + action);
    }
  } catch (e) {
    return err('Server error: ' + e.message);
  }
}

function doGet(e) {
  // Allow GET for testing
  return doPost(e);
}

// ── Auth Handlers ─────────────────────────────────────────────

function handleRegister(body) {
  const { email, username, password } = body;
  if (!email || !username || !password) return err('Missing fields');

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  
  if (getUserRow(authSheet, email)) return err('Email already registered');

  authSheet.appendRow([
    email,
    username,
    hashPassword(password),
    new Date().toISOString()
  ]);

  // Create user data tab
  getUserSheet(ss, email);

  return ok({ username });
}

function handleLogin(body) {
  const { email, password } = body;
  if (!email || !password) return err('Missing fields');

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const userRow = getUserRow(authSheet, email);

  if (!userRow) return err('No account found with this email');

  const storedHash = userRow.data[2];
  if (storedHash !== hashPassword(password)) return err('Incorrect password');

  return ok({ username: userRow.data[1] });
}

// ── Meeting Handlers ──────────────────────────────────────────

function handleGetMeetings(body) {
  const { email } = body;
  if (!email) return err('Missing email');

  const ss = getSpreadsheet();
  const sheet = getUserSheet(ss, email);
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) return ok({ meetings: [] });

  const meetings = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; // skip empty rows
    try {
      meetings.push({
        id: String(row[0]),
        title: row[1],
        transcript: row[2],
        summary: row[3],
        actionPoints: JSON.parse(row[4] || '[]'),
        decisions: JSON.parse(row[5] || '[]'),
        nextSteps: row[6],
        duration: row[7],
        type: row[8],
        createdAt: row[9],
        updatedAt: row[10],
      });
    } catch (e) {
      // skip malformed rows
    }
  }

  // Sort newest first
  meetings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return ok({ meetings });
}

function handleSaveMeeting(body) {
  const { email, meeting } = body;
  if (!email || !meeting) return err('Missing fields');

  const ss = getSpreadsheet();
  const sheet = getUserSheet(ss, email);

  sheet.appendRow([
    meeting.id,
    meeting.title,
    meeting.transcript,
    meeting.summary,
    JSON.stringify(meeting.actionPoints || []),
    JSON.stringify(meeting.decisions || []),
    meeting.nextSteps || '',
    meeting.duration || 0,
    meeting.type || 'Meeting',
    meeting.createdAt || new Date().toISOString(),
    meeting.updatedAt || new Date().toISOString(),
  ]);

  return ok({ id: meeting.id });
}

function handleUpdateMeeting(body) {
  const { email, meetingId, updates } = body;
  if (!email || !meetingId || !updates) return err('Missing fields');

  const ss = getSpreadsheet();
  const sheet = getUserSheet(ss, email);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(meetingId)) {
      const row = i + 1;
      sheet.getRange(row, 2).setValue(updates.title ?? data[i][1]);
      sheet.getRange(row, 3).setValue(updates.transcript ?? data[i][2]);
      sheet.getRange(row, 4).setValue(updates.summary ?? data[i][3]);
      sheet.getRange(row, 5).setValue(JSON.stringify(updates.actionPoints ?? JSON.parse(data[i][4] || '[]')));
      sheet.getRange(row, 6).setValue(JSON.stringify(updates.decisions ?? JSON.parse(data[i][5] || '[]')));
      sheet.getRange(row, 7).setValue(updates.nextSteps ?? data[i][6]);
      sheet.getRange(row, 11).setValue(updates.updatedAt || new Date().toISOString());
      return ok({ id: meetingId });
    }
  }

  return err('Meeting not found');
}

function handleDeleteMeeting(body) {
  const { email, meetingId } = body;
  if (!email || !meetingId) return err('Missing fields');

  const ss = getSpreadsheet();
  const sheet = getUserSheet(ss, email);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(meetingId)) {
      sheet.deleteRow(i + 1);
      return ok({ deleted: true });
    }
  }

  return err('Meeting not found');
}
