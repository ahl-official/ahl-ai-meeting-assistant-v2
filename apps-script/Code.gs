// ============================================================
// AI Meeting Assistant — Google Apps Script REST API
// Version 2.1 — TEST MODE (plaintext passwords)
// ⚠️ REVERT handleRegister & handleGetPassword before production
// Sheet structure: UNCHANGED from original
// ============================================================

const SHEET_ID = '1K_Kr_htFuRd9nx6T3GjUUy5cgy1sTJeCAy1qn0sd1Qw';

// ── Sheet name constants ─────────────────────────────────────
const AUTH_TAB = 'Auth';
const LOGS_TAB = 'Logs';

// ── AUTH tab columns (0-indexed) ─────────────────────────────
// email | phone | username | password_hash | active | created_at | is_admin | password_enc
const A_EMAIL    = 0;
const A_PHONE    = 1;
const A_USERNAME = 2;
const A_HASH     = 3;
const A_ACTIVE   = 4;
const A_CREATED  = 5;
const A_ADMIN    = 6;
const A_PASSWORD = 7; // password_enc — ⚠️ TEST MODE: storing plaintext here

// ── User meeting tab columns (0-indexed) ─────────────────────
const M_ID         = 0;
const M_TITLE      = 1;
const M_TRANSCRIPT = 2;
const M_SUMMARY    = 3;
const M_ACTIONS    = 4;
const M_DECISIONS  = 5;
const M_NEXT_STEPS = 6;
const M_DURATION   = 7;
const M_TYPE       = 8;
const M_CREATED_AT = 9;
const M_UPDATED_AT = 10;

// ── LOGS tab columns ──────────────────────────────────────────
const L_TIMESTAMP = 0;
const L_LEVEL     = 1;
const L_ACTION    = 2;
const L_USER      = 3;
const L_STEP      = 4;
const L_MESSAGE   = 5;
const L_DETAIL    = 6;
const L_LATENCY   = 7;

// ============================================================
// ── Core helpers ─────────────────────────────────────────────
// ============================================================

function getSpreadsheet() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function ok(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, ...data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function fail(msg, detail) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: msg, detail: detail || null }))
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

// Kept for prod revert — not used in test mode
function encryptPassword(password) {
  return Utilities.base64Encode(password + '|ama_salt_2026');
}

function decryptPassword(enc) {
  try {
    const decoded = Utilities.newBlob(
      Utilities.base64Decode(enc, Utilities.Charset.UTF_8)
    ).getAsString();
    const salt = '|ama_salt_2026';
    return decoded.endsWith(salt) ? decoded.slice(0, -salt.length) : null;
  } catch {
    return null;
  }
}

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function safeJSON(val, fallback) {
  try { return JSON.parse(val || fallback); } catch { return JSON.parse(fallback); }
}

function isAdminUser(rowData) {
  return rowData[A_ADMIN] === true ||
    String(rowData[A_ADMIN]).toLowerCase() === 'true';
}

// ============================================================
// ── Logging ──────────────────────────────────────────────────
// ============================================================

function ensureLogsSheet(ss) {
  const sheet = getOrCreateSheet(ss, LOGS_TAB);
  if (sheet.getLastRow() === 0) {
    const headers = ['timestamp', 'level', 'action', 'user', 'step', 'message', 'detail', 'latency_ms'];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 180);
    sheet.setColumnWidth(6, 300);
    sheet.setColumnWidth(7, 400);
  }
  return sheet;
}

function log(level, action, user, step, message, detail, latencyMs) {
  try {
    const ss = getSpreadsheet();
    const sheet = ensureLogsSheet(ss);
    const row = [
      new Date().toISOString(),
      level,
      action   || '',
      user     || '',
      step     || '',
      message  || '',
      detail ? (typeof detail === 'object' ? JSON.stringify(detail) : String(detail)) : '',
      latencyMs || ''
    ];
    sheet.appendRow(row);

    const bgColors = { ERROR: '#ffebee', WARN: '#fff8e1', INFO: '#f1f8e9', DEBUG: '#e8eaf6' };
    if (bgColors[level]) {
      sheet.getRange(sheet.getLastRow(), 1, 1, row.length).setBackground(bgColors[level]);
    }
  } catch (e) {
    console.error('Log write failed:', e.message);
  }
}

// ============================================================
// ── AUTH sheet setup ─────────────────────────────────────────
// ============================================================

function ensureAuthSheet(ss) {
  const sheet = getOrCreateSheet(ss, AUTH_TAB);

  if (sheet.getLastRow() === 0) {
    // Exact original headers — unchanged
    const headers = [
      'email', 'phone', 'username', 'password_hash',
      'active', 'created_at', 'is_admin', 'password_enc'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    return sheet;
  }

  // Existing sheet — check if new columns are missing and add them
  const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const lastCol = currentHeaders.length;

  if (!currentHeaders.includes('is_admin')) {
    sheet.getRange(1, lastCol + 1).setValue('is_admin');
    sheet.getRange(1, lastCol + 1)
      .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
  }

  if (!currentHeaders.includes('password_enc')) {
    const encCol = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].length + 1;
    sheet.getRange(1, encCol).setValue('password_enc');
    sheet.getRange(1, encCol)
      .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
  }

  return sheet;
}

function findUserRow(authSheet, identifier) {
  const data = authSheet.getDataRange().getValues();
  const id = String(identifier).toLowerCase().trim();
  for (let i = 1; i < data.length; i++) {
    const email = String(data[i][A_EMAIL]).toLowerCase().trim();
    const phone = String(data[i][A_PHONE]).replace(/\s+/g, '');
    const uname = String(data[i][A_USERNAME]).toLowerCase().trim();
    if (email === id || phone === id || uname === id) {
      return { row: i + 1, data: data[i] };
    }
  }
  return null;
}

// ============================================================
// ── User meeting tab ─────────────────────────────────────────
// ============================================================

/**
 * Derive the sheet tab name from an email address.
 * This is the ONLY naming convention used — consistent with the original script.
 * e.g. dhristi@gmail.com → user_dhristi_gmail_com
 */
function tabNameFromEmail(email) {
  return 'user_' + String(email).replace(/[@.]/g, '_').toLowerCase();
}

/**
 * Look up a user row in the Auth sheet by username (case-insensitive).
 * Returns { row, data } or null.
 */
function findUserByUsername(authSheet, username) {
  const data  = authSheet.getDataRange().getValues();
  const uname = String(username).toLowerCase().trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][A_USERNAME]).toLowerCase().trim() === uname) {
      return { row: i + 1, data: data[i] };
    }
  }
  return null;
}

/**
 * Get the meeting sheet for a user, identified by email.
 * READ mode  (create=false): returns null if tab doesn't exist — NEVER creates one.
 * WRITE mode (create=true):  creates tab with headers if missing (first save for new user).
 */
function getSheetForEmail(ss, email, create) {
  const tabName = tabNameFromEmail(email);
  let sheet = ss.getSheetByName(tabName);

  if (!sheet) {
    if (!create) return null; // read — don't create
    sheet = ss.insertSheet(tabName);
    const headers = [
      'id', 'title', 'transcript', 'summary',
      'action_points', 'decisions', 'next_steps',
      'duration', 'type', 'created_at', 'updated_at'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(3, 400);
    sheet.setColumnWidth(4, 300);
    sheet.setColumnWidth(5, 300);
  }
  return sheet;
}

/**
 * Resolve the meeting sheet from a username.
 * Steps: username → Auth sheet lookup → email → tab name → sheet
 * Returns { sheet, email } or { sheet: null, email } if tab not found.
 */
function resolveSheetByUsername(ss, authSheet, username, create) {
  const userRow = findUserByUsername(authSheet, username);
  if (!userRow) return { sheet: null, email: null };

  const email = userRow.data[A_EMAIL];
  if (!email) return { sheet: null, email: null };

  const sheet = getSheetForEmail(ss, email, create || false);
  return { sheet, email };
}

// ============================================================
// ── Router ───────────────────────────────────────────────────
// ============================================================

function doPost(e) {
  const t0 = Date.now();
  try {
    const action = (e.parameter && e.parameter.action) || '';
    const body   = (e.postData && e.postData.contents) ? JSON.parse(e.postData.contents) : {};

    log('DEBUG', action, body.identifier || body.email || body.username || body.adminUsername || '?', 'ROUTER', 'Incoming request', { action, keys: Object.keys(body) });

    switch (action) {
      case 'register':       return handleRegister(body, t0);
      case 'login':          return handleLogin(body, t0);
      case 'getUser':        return handleGetUser(body, t0);
      case 'setActive':      return handleSetActive(body, t0);
      case 'getMeetings':    return handleGetMeetings(body, t0);
      case 'saveMeeting':    return handleSaveMeeting(body, t0);
      case 'updateMeeting':  return handleUpdateMeeting(body, t0);
      case 'deleteMeeting':  return handleDeleteMeeting(body, t0);
      case 'saveTranscript': return handleSaveTranscript(body, t0);
      case 'saveAnalysis':   return handleSaveAnalysis(body, t0);
      case 'pipelineLog':    return handlePipelineLog(body, t0);
      case 'getAllUsers':     return handleGetAllUsers(body, t0);
      case 'getPassword':    return handleGetPassword(body, t0);
      case 'setAdmin':       return handleSetAdmin(body, t0);
      case 'getAllMeetings':  return handleGetAllMeetings(body, t0);
      default:
        log('WARN', action, '', 'ROUTER', 'Unknown action: ' + action);
        return fail('Unknown action: ' + action);
    }
  } catch (ex) {
    log('ERROR', 'doPost', '', 'ROUTER', 'Unhandled exception', ex.message);
    return fail('Server error: ' + ex.message);
  }
}

function doGet(e) {
  if (e.parameter && e.parameter.action) return doPost(e);
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'AMA API is live', ts: new Date().toISOString() }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// ── Auth handlers ────────────────────────────────────────────
// ============================================================

function handleRegister(body, t0) {
  const { email, phone, username, password } = body;

  if (!username || !password) {
    log('WARN', 'register', username || '?', 'AUTH', 'Missing required fields');
    return fail('username and password are required');
  }
  if (!email && !phone) {
    log('WARN', 'register', username, 'AUTH', 'Must provide email or phone');
    return fail('Provide at least an email or phone number');
  }

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);

  if (email && findUserRow(authSheet, email)) {
    log('WARN', 'register', username, 'AUTH', 'Duplicate email', email);
    return fail('An account with this email already exists');
  }
  if (phone && findUserRow(authSheet, phone)) {
    log('WARN', 'register', username, 'AUTH', 'Duplicate phone', phone);
    return fail('An account with this phone number already exists');
  }

  authSheet.appendRow([
    email    || '',
    phone    || '',
    username,
    hashPassword(password), // hash kept so login still works
    true,
    new Date().toISOString(),
    false,
    password, // ⚠️ TEST MODE: plaintext in password_enc col — revert to encryptPassword(password) for prod
  ]);

  getUserSheet(ss, username);

  log('INFO', 'register', username, 'AUTH', 'User registered', { email, phone }, Date.now() - t0);
  return ok({ username });
}

function handleLogin(body, t0) {
  const { identifier, password } = body;
  if (!identifier || !password) {
    log('WARN', 'login', identifier || '?', 'AUTH', 'Missing identifier or password');
    return fail('identifier (email or phone) and password are required');
  }

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const userRow = findUserRow(authSheet, identifier);

  if (!userRow) {
    log('WARN', 'login', identifier, 'AUTH', 'No account found');
    return fail('No account found with that email or phone number');
  }
  if (!userRow.data[A_ACTIVE]) {
    log('WARN', 'login', identifier, 'AUTH', 'Account inactive');
    return fail('This account has been deactivated. Contact support.');
  }
  if (userRow.data[A_HASH] !== hashPassword(password)) {
    log('WARN', 'login', identifier, 'AUTH', 'Wrong password');
    return fail('Incorrect password');
  }

  const user = {
    email:     userRow.data[A_EMAIL],
    phone:     userRow.data[A_PHONE],
    username:  userRow.data[A_USERNAME],
    active:    userRow.data[A_ACTIVE],
    createdAt: userRow.data[A_CREATED],
    isAdmin:   isAdminUser(userRow.data),
  };

  log('INFO', 'login', user.username, 'AUTH', 'Login successful', null, Date.now() - t0);
  return ok({ user });
}

function handleGetUser(body, t0) {
  const { identifier } = body;
  if (!identifier) return fail('identifier required');

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const userRow = findUserRow(authSheet, identifier);

  if (!userRow) return fail('User not found');

  return ok({
    user: {
      email:     userRow.data[A_EMAIL],
      phone:     userRow.data[A_PHONE],
      username:  userRow.data[A_USERNAME],
      active:    userRow.data[A_ACTIVE],
      createdAt: userRow.data[A_CREATED],
      isAdmin:   isAdminUser(userRow.data),
    }
  });
}

function handleSetActive(body, t0) {
  const { identifier, active } = body;
  if (!identifier) return fail('identifier required');

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const userRow = findUserRow(authSheet, identifier);

  if (!userRow) return fail('User not found');

  authSheet.getRange(userRow.row, A_ACTIVE + 1).setValue(active !== false);
  log('INFO', 'setActive', identifier, 'AUTH', `Account set to active=${active}`, null, Date.now() - t0);
  return ok({ active });
}

// ============================================================
// ── Meeting handlers ─────────────────────────────────────────
// ============================================================

function handleGetMeetings(body, t0) {
  const { username } = body;
  if (!username) return fail('username required');

  const ss        = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const { sheet } = resolveSheetByUsername(ss, authSheet, username, false);

  if (!sheet) {
    log('INFO', 'getMeetings', username, 'SHEETS_READ', 'No sheet found for user');
    return ok({ meetings: [] });
  }

  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    log('INFO', 'getMeetings', username, 'SHEETS_READ', '0 meetings found');
    return ok({ meetings: [] });
  }

  const meetings = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[M_ID]) continue;
    try {
      meetings.push({
        id:           String(row[M_ID]),
        title:        row[M_TITLE]       || '',
        transcript:   row[M_TRANSCRIPT]  || '',
        summary:      row[M_SUMMARY]     || '',
        actionPoints: safeJSON(row[M_ACTIONS],   '[]'),
        decisions:    safeJSON(row[M_DECISIONS], '[]'),
        nextSteps:    row[M_NEXT_STEPS]  || '',
        duration:     row[M_DURATION]    || 0,
        type:         row[M_TYPE]        || 'Meeting',
        createdAt:    row[M_CREATED_AT]  || '',
        updatedAt:    row[M_UPDATED_AT]  || '',
      });
    } catch (ex) {
      log('WARN', 'getMeetings', username, 'SHEETS_READ', 'Skipped malformed row ' + i, ex.message);
    }
  }

  meetings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  log('INFO', 'getMeetings', username, 'SHEETS_READ', `Returned ${meetings.length} meetings`, null, Date.now() - t0);
  return ok({ meetings });
}

function handleSaveMeeting(body, t0) {
  const { username, meeting } = body;
  if (!username || !meeting) return fail('username and meeting required');

  const ss        = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const { sheet } = resolveSheetByUsername(ss, authSheet, username, true); // create=true
  if (!sheet) return fail('User not found');

  sheet.appendRow([
    meeting.id                          || Utilities.getUuid(),
    meeting.title                       || 'Untitled Meeting',
    meeting.transcript                  || '',
    meeting.summary                     || '',
    JSON.stringify(meeting.actionPoints || []),
    JSON.stringify(meeting.decisions    || []),
    meeting.nextSteps                   || '',
    meeting.duration                    || 0,
    meeting.type                        || 'Meeting',
    meeting.createdAt                   || new Date().toISOString(),
    meeting.updatedAt                   || new Date().toISOString(),
  ]);

  log('INFO', 'saveMeeting', username, 'SHEETS_WRITE', 'Meeting saved', { id: meeting.id, title: meeting.title }, Date.now() - t0);
  return ok({ id: meeting.id });
}

function handleSaveTranscript(body, t0) {
  const { username, meetingId, title, transcript, duration, type } = body;
  if (!username || !transcript) return fail('username and transcript required');

  const id        = meetingId || Utilities.getUuid();
  const ss        = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const { sheet } = resolveSheetByUsername(ss, authSheet, username, true); // create=true
  if (!sheet) return fail('User not found');

  sheet.appendRow([
    id,
    title    || 'Untitled Meeting',
    transcript,
    '', '[]', '',
    '',
    duration || 0,
    type     || 'Meeting',
    new Date().toISOString(),
    new Date().toISOString(),
  ]);

  log('INFO', 'saveTranscript', username, 'DEEPGRAM→SHEETS', 'Transcript saved', {
    id, chars: transcript.length, duration
  }, Date.now() - t0);

  return ok({ id });
}

function handleSaveAnalysis(body, t0) {
  const { username, meetingId, analysis } = body;
  if (!username || !meetingId || !analysis) return fail('username, meetingId and analysis required');

  const ss        = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const { sheet } = resolveSheetByUsername(ss, authSheet, username, false);
  if (!sheet) return fail('User sheet not found');

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][M_ID]) === String(meetingId)) {
      const rowNum = i + 1;
      sheet.getRange(rowNum, M_SUMMARY    + 1).setValue(analysis.summary    || '');
      sheet.getRange(rowNum, M_ACTIONS    + 1).setValue(JSON.stringify(analysis.actionPoints || []));
      sheet.getRange(rowNum, M_DECISIONS  + 1).setValue(JSON.stringify(analysis.decisions    || []));
      sheet.getRange(rowNum, M_NEXT_STEPS + 1).setValue(analysis.nextSteps  || '');
      sheet.getRange(rowNum, M_UPDATED_AT + 1).setValue(new Date().toISOString());

      log('INFO', 'saveAnalysis', username, 'OPENROUTER→SHEETS', 'Analysis saved', {
        id: meetingId,
        actionCount:   (analysis.actionPoints || []).length,
        decisionCount: (analysis.decisions    || []).length
      }, Date.now() - t0);

      return ok({ id: meetingId });
    }
  }

  log('ERROR', 'saveAnalysis', username, 'SHEETS_WRITE', 'Meeting not found for analysis', { meetingId });
  return fail('Meeting not found');
}

function handleUpdateMeeting(body, t0) {
  const { username, meetingId, updates } = body;
  if (!username || !meetingId || !updates) return fail('username, meetingId and updates required');

  const ss        = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const { sheet } = resolveSheetByUsername(ss, authSheet, username, false);
  if (!sheet) return fail('User sheet not found');

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][M_ID]) === String(meetingId)) {
      const rowNum = i + 1;
      if (updates.title        !== undefined) sheet.getRange(rowNum, M_TITLE       + 1).setValue(updates.title);
      if (updates.transcript   !== undefined) sheet.getRange(rowNum, M_TRANSCRIPT  + 1).setValue(updates.transcript);
      if (updates.summary      !== undefined) sheet.getRange(rowNum, M_SUMMARY     + 1).setValue(updates.summary);
      if (updates.actionPoints !== undefined) sheet.getRange(rowNum, M_ACTIONS     + 1).setValue(JSON.stringify(updates.actionPoints));
      if (updates.decisions    !== undefined) sheet.getRange(rowNum, M_DECISIONS   + 1).setValue(JSON.stringify(updates.decisions));
      if (updates.nextSteps    !== undefined) sheet.getRange(rowNum, M_NEXT_STEPS  + 1).setValue(updates.nextSteps);
      if (updates.type         !== undefined) sheet.getRange(rowNum, M_TYPE        + 1).setValue(updates.type);
      sheet.getRange(rowNum, M_UPDATED_AT + 1).setValue(new Date().toISOString());

      log('INFO', 'updateMeeting', username, 'SHEETS_WRITE', 'Meeting updated', { meetingId, updatedFields: Object.keys(updates) }, Date.now() - t0);
      return ok({ id: meetingId });
    }
  }

  log('WARN', 'updateMeeting', username, 'SHEETS_WRITE', 'Meeting not found', { meetingId });
  return fail('Meeting not found');
}

function handleDeleteMeeting(body, t0) {
  const { username, meetingId } = body;
  if (!username || !meetingId) return fail('username and meetingId required');

  const ss        = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const { sheet } = resolveSheetByUsername(ss, authSheet, username, false);
  if (!sheet) return fail('User sheet not found');

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][M_ID]) === String(meetingId)) {
      sheet.deleteRow(i + 1);
      log('INFO', 'deleteMeeting', username, 'SHEETS_WRITE', 'Meeting deleted', { meetingId }, Date.now() - t0);
      return ok({ deleted: true });
    }
  }

  log('WARN', 'deleteMeeting', username, 'SHEETS_WRITE', 'Meeting not found for delete', { meetingId });
  return fail('Meeting not found');
}

// ============================================================
// ── Pipeline logging ─────────────────────────────────────────
// ============================================================

function handlePipelineLog(body, t0) {
  const { username, action, step, level, message, detail, latencyMs } = body;
  log(
    level    || 'INFO',
    action   || 'pipeline',
    username || '?',
    step     || 'UNKNOWN',
    message  || '',
    detail   || null,
    latencyMs || null
  );
  return ok({ logged: true });
}

// ============================================================
// ── Admin helpers ─────────────────────────────────────────────
// ============================================================

function requireAdmin(body) {
  const adminUsername = String(body.adminUsername || '').trim();
  if (!adminUsername) return { error: fail('adminUsername required') };

  const ss = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);
  const adminRow = findUserRow(authSheet, adminUsername);

  if (!adminRow)                   return { error: fail('Admin user not found') };
  if (!isAdminUser(adminRow.data)) return { error: fail('Access denied: Admin only') };

  return { authSheet, ss };
}

// ============================================================
// ── Admin handlers ────────────────────────────────────────────
// ============================================================

function handleGetAllUsers(body, t0) {
  const check = requireAdmin(body);
  if (check.error) return check.error;

  const data = check.authSheet.getDataRange().getValues();
  const users = [];

  for (let i = 1; i < data.length; i++) {
    if (!data[i][A_USERNAME]) continue;
    users.push({
      email:     data[i][A_EMAIL],
      phone:     data[i][A_PHONE],
      username:  data[i][A_USERNAME],
      active:    data[i][A_ACTIVE],
      createdAt: data[i][A_CREATED],
      isAdmin:   isAdminUser(data[i]),
    });
  }

  log('INFO', 'getAllUsers', body.adminUsername, 'ADMIN', `Fetched ${users.length} users`, null, Date.now() - t0);
  return ok({ users });
}

/**
 * getPassword
 * ⚠️ TEST MODE: reads plaintext directly from password_enc col (A_PASSWORD)
 * PROD REVERT: swap `password` line to `decryptPassword(targetRow.data[A_PASSWORD])`
 */
function handleGetPassword(body, t0) {
  const check = requireAdmin(body);
  if (check.error) return check.error;

  const targetUsername = String(body.targetUsername || '').trim();
  if (!targetUsername) return fail('targetUsername required');

  const targetRow = findUserRow(check.authSheet, targetUsername);
  if (!targetRow) return fail('User not found');

  const raw = targetRow.data[A_PASSWORD];

  if (!raw || String(raw).trim() === '') {
    return ok({
      username: targetRow.data[A_USERNAME],
      email:    targetRow.data[A_EMAIL],
      phone:    targetRow.data[A_PHONE],
      password: null,
      legacy:   true,
      message:  'Legacy user — manually enter password in sheet col H to test.',
    });
  }

  log('INFO', 'getPassword', body.adminUsername, 'ADMIN',
    `Password retrieved for ${targetUsername}`, null, Date.now() - t0);

  return ok({
    username: targetRow.data[A_USERNAME],
    email:    targetRow.data[A_EMAIL],
    phone:    targetRow.data[A_PHONE],
    password: String(raw), // ⚠️ TEST MODE: plaintext — revert to decryptPassword(raw) for prod
    legacy:   false,
  });
}

function handleSetAdmin(body, t0) {
  const check = requireAdmin(body);
  if (check.error) return check.error;

  const targetUsername = String(body.targetUsername || '').trim();
  if (!targetUsername) return fail('targetUsername required');

  const targetRow = findUserRow(check.authSheet, targetUsername);
  if (!targetRow) return fail('User not found');

  const newValue = body.isAdmin === true;
  check.authSheet.getRange(targetRow.row, A_ADMIN + 1).setValue(newValue);

  log('INFO', 'setAdmin', body.adminUsername, 'ADMIN',
    `Set isAdmin=${newValue} for ${targetUsername}`, null, Date.now() - t0);
  return ok({ updated: true, username: targetUsername, isAdmin: newValue });
}

function handleGetAllMeetings(body, t0) {
  const check = requireAdmin(body);
  if (check.error) return check.error;

  const authData = check.authSheet.getDataRange().getValues();
  const allMeetings = [];

  for (let u = 1; u < authData.length; u++) {
    const username = authData[u][A_USERNAME];
    const email    = authData[u][A_EMAIL];
    if (!username || !email) continue;

    // username → email → tab name → sheet (no auto-create)
    const userSheet = getSheetForEmail(check.ss, email, false);
    if (!userSheet || userSheet.getLastRow() <= 1) continue;

    const rows = userSheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[M_ID]) continue;
      try {
        allMeetings.push({
          owner:        username,
          id:           String(row[M_ID]),
          title:        row[M_TITLE]       || '',
          summary:      row[M_SUMMARY]     || '',
          actionPoints: safeJSON(row[M_ACTIONS],   '[]'),
          decisions:    safeJSON(row[M_DECISIONS], '[]'),
          nextSteps:    row[M_NEXT_STEPS]  || '',
          duration:     row[M_DURATION]    || 0,
          type:         row[M_TYPE]        || 'Meeting',
          createdAt:    row[M_CREATED_AT]  || '',
          updatedAt:    row[M_UPDATED_AT]  || '',
        });
      } catch (ex) {
        log('WARN', 'getAllMeetings', body.adminUsername, 'ADMIN',
          `Skipped malformed row for ${username}`, ex.message);
      }
    }
  }

  allMeetings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  log('INFO', 'getAllMeetings', body.adminUsername, 'ADMIN',
    `Fetched ${allMeetings.length} total meetings`, null, Date.now() - t0);
  return ok({ meetings: allMeetings });
}