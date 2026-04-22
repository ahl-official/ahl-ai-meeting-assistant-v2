// ============================================================
// AI Meeting Assistant — Google Apps Script REST API
// Version 2.3 — TEST MODE (plaintext passwords)
// ⚠️  REVERT handleRegister & handleGetPassword before production
// Fix v2.3: explicit username→email→tab resolution in all handlers
//           hardened tabNameFromEmail with trim()
//           explicit debug logging at every resolution step
// ============================================================

const SHEET_ID = '1K_Kr_htFuRd9nx6T3GjUUy5cgy1sTJeCAy1qn0sd1Qw';

// ── Sheet name constants ─────────────────────────────────────
const AUTH_TAB = 'Auth';
const LOGS_TAB = 'Logs';

// ── AUTH tab columns (0-indexed) ─────────────────────────────
const A_EMAIL    = 0;
const A_PHONE    = 1;
const A_USERNAME = 2;
const A_HASH     = 3;
const A_ACTIVE   = 4;
const A_CREATED  = 5;
const A_ADMIN    = 6;
const A_PASSWORD = 7;

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
const M_TASKS      = 11;

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
 * Single source of truth — must stay consistent everywhere.
 * e.g. dhristi@gmail.com → user_dhristi_gmail_com
 * v2.3: added .trim() to prevent silent whitespace mismatches
 */
function tabNameFromEmail(email) {
  return String(email).trim().toLowerCase().replace(/[@.]/g, '_');
}

/**
 * Look up a user row in the Auth sheet by username (case-insensitive).
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
 * Resolve username → email → sheet tab.
 * Returns { sheet, email, username, error } 
 * error is a human-readable string if resolution failed at any step.
 * This is the SINGLE resolution function all handlers must use.
 */
function resolveUserSheet(ss, authSheet, username, create) {
  // Step 1: find user row by username
  const userRow = findUserByUsername(authSheet, username);
  if (!userRow) {
    return { sheet: null, email: null, error: 'Username not found in Auth tab: ' + username };
  }

  // Step 2: extract and validate email
  const email = String(userRow.data[A_EMAIL] || '').trim().toLowerCase();
  if (!email) {
    return { sheet: null, email: null, error: 'No email mapped to username: ' + username };
  }

  // Step 3: derive tab name and get sheet
  const expectedTab = tabNameFromEmail(email);
  const sheet = getSheetForEmail(ss, email, create || false);

  if (!sheet) {
    return {
      sheet: null,
      email,
      expectedTab,
      error: 'Sheet tab not found: ' + expectedTab + ' (email: ' + email + ')'
    };
  }

  return { sheet, email, expectedTab, error: null };
}

/**
 * Get (or create) the meeting sheet for a user identified by email.
 * create=false → returns null if tab doesn't exist, NEVER creates one.
 * create=true  → creates tab with headers if missing.
 */
function getSheetForEmail(ss, email, create) {
  const tabName = tabNameFromEmail(email);
  let sheet = ss.getSheetByName(tabName);

  if (!sheet) {
    if (!create) return null;
    sheet = ss.insertSheet(tabName);
    const headers = [
      'id', 'title', 'transcript', 'summary',
      'action_points', 'decisions', 'next_steps',
      'duration', 'type', 'created_at', 'updated_at', 'tasks'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(3, 400);
    sheet.setColumnWidth(4, 300);
    sheet.setColumnWidth(5, 300);
    sheet.setColumnWidth(12, 350);
  }
  return sheet;
}

// ── kept for backward compat but all handlers now use resolveUserSheet ──
function resolveSheetByUsername(ss, authSheet, username, create) {
  const result = resolveUserSheet(ss, authSheet, username, create);
  return { sheet: result.sheet, email: result.email };
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
      case 'register':            return handleRegister(body, t0);
      case 'login':               return handleLogin(body, t0);
      case 'getUser':             return handleGetUser(body, t0);
      case 'setActive':           return handleSetActive(body, t0);
      case 'getMeetings':         return handleGetMeetings(body, t0);
      case 'saveMeeting':         return handleSaveMeeting(body, t0);
      case 'updateMeeting':       return handleUpdateMeeting(body, t0);
      case 'deleteMeeting':       return handleDeleteMeeting(body, t0);
      case 'saveTranscript':      return handleSaveTranscript(body, t0);
      case 'saveAnalysis':        return handleSaveAnalysis(body, t0);
      case 'pipelineLog':         return handlePipelineLog(body, t0);
      case 'getAllUsers':          return handleGetAllUsers(body, t0);
      case 'getPassword':         return handleGetPassword(body, t0);
      case 'setAdmin':            return handleSetAdmin(body, t0);
      case 'getAllMeetings':       return handleGetAllMeetings(body, t0);
      case 'backfillUserSheets':  return handleBackfillUserSheets(body, t0);
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
    hashPassword(password),
    true,
    new Date().toISOString(),
    false,
    password, // ⚠️ TEST MODE — revert to encryptPassword(password) for prod
  ]);

  if (email) {
    getSheetForEmail(ss, email, true);
    log('INFO', 'register', username, 'AUTH', 'User sheet tab created', { tab: tabNameFromEmail(email) });
  }

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

  // ── Resolve username → email → sheet tab ──────────────────
  const resolved = resolveUserSheet(ss, authSheet, username, false);

  if (resolved.error) {
    log('WARN', 'getMeetings', username, 'SHEETS_READ', resolved.error, {
      expectedTab: resolved.expectedTab || null,
      email:       resolved.email       || null,
    });
    return ok({ meetings: [] });
  }

  const sheet = resolved.sheet;
  const data  = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    log('INFO', 'getMeetings', username, 'SHEETS_READ', '0 meetings found', { email: resolved.email });
    return ok({ meetings: [] });
  }

  const meetings = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[M_ID]) continue;
    try {
      meetings.push({
        id:           String(row[M_ID]),
        title:        row[M_TITLE]      || '',
        transcript:   row[M_TRANSCRIPT] || '',
        summary:      row[M_SUMMARY]    || '',
        actionPoints: safeJSON(row[M_ACTIONS],   '[]'),
        decisions:    safeJSON(row[M_DECISIONS], '[]'),
        nextSteps:    row[M_NEXT_STEPS] || '',
        duration:     row[M_DURATION]   || 0,
        type:         row[M_TYPE]       || 'Meeting',
        createdAt:    row[M_CREATED_AT] || '',
        updatedAt:    row[M_UPDATED_AT] || '',
        tasks:        safeJSON(row[M_TASKS], '[]'),
      });
    } catch (ex) {
      log('WARN', 'getMeetings', username, 'SHEETS_READ', 'Skipped malformed row ' + i, ex.message);
    }
  }

  meetings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  log('INFO', 'getMeetings', username, 'SHEETS_READ',
    `Returned ${meetings.length} meetings for ${username} (${resolved.email})`,
    null, Date.now() - t0);
  return ok({ meetings });
}

function handleSaveMeeting(body, t0) {
  const { username, meeting } = body;
  if (!username || !meeting) return fail('username and meeting required');

  const ss        = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);

  const resolved = resolveUserSheet(ss, authSheet, username, true);
  if (resolved.error) {
    log('ERROR', 'saveMeeting', username, 'SHEETS_WRITE', resolved.error);
    return fail('User not found: ' + resolved.error);
  }

  resolved.sheet.appendRow([
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
    JSON.stringify(meeting.tasks        || []),
  ]);

  log('INFO', 'saveMeeting', username, 'SHEETS_WRITE', 'Meeting saved',
    { id: meeting.id, title: meeting.title, email: resolved.email }, Date.now() - t0);
  return ok({ id: meeting.id });
}

function handleSaveTranscript(body, t0) {
  const { username, meetingId, title, transcript, duration, type } = body;
  if (!username || !transcript) return fail('username and transcript required');

  const id        = meetingId || Utilities.getUuid();
  const ss        = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);

  const resolved = resolveUserSheet(ss, authSheet, username, true);
  if (resolved.error) {
    log('ERROR', 'saveTranscript', username, 'DEEPGRAM→SHEETS', resolved.error);
    return fail('User not found: ' + resolved.error);
  }

  resolved.sheet.appendRow([
    id,
    title    || 'Untitled Meeting',
    transcript,
    '', '[]', '[]', '',
    duration || 0,
    type     || 'Meeting',
    new Date().toISOString(),
    new Date().toISOString(),
    '[]', // tasks — filled in by saveAnalysis
  ]);

  log('INFO', 'saveTranscript', username, 'DEEPGRAM→SHEETS', 'Transcript saved', {
    id, chars: transcript.length, duration, email: resolved.email
  }, Date.now() - t0);

  return ok({ id });
}

function handleSaveAnalysis(body, t0) {
  const { username, meetingId, analysis } = body;
  if (!username || !meetingId || !analysis) return fail('username, meetingId and analysis required');

  const ss        = getSpreadsheet();
  const authSheet = ensureAuthSheet(ss);

  const resolved = resolveUserSheet(ss, authSheet, username, false);
  if (resolved.error) {
    log('ERROR', 'saveAnalysis', username, 'OPENROUTER→SHEETS', resolved.error);
    return fail('User sheet not found: ' + resolved.error);
  }

  const data = resolved.sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][M_ID]) === String(meetingId)) {
      const rowNum = i + 1;
      resolved.sheet.getRange(rowNum, M_SUMMARY    + 1).setValue(analysis.summary    || '');
      resolved.sheet.getRange(rowNum, M_ACTIONS    + 1).setValue(JSON.stringify(analysis.actionPoints || []));
      resolved.sheet.getRange(rowNum, M_DECISIONS  + 1).setValue(JSON.stringify(analysis.decisions    || []));
      resolved.sheet.getRange(rowNum, M_NEXT_STEPS + 1).setValue(analysis.nextSteps  || '');
      resolved.sheet.getRange(rowNum, M_UPDATED_AT + 1).setValue(new Date().toISOString());
      resolved.sheet.getRange(rowNum, M_TASKS      + 1).setValue(JSON.stringify(analysis.tasks || []));

      log('INFO', 'saveAnalysis', username, 'OPENROUTER→SHEETS', 'Analysis saved', {
        id: meetingId,
        actionCount:   (analysis.actionPoints || []).length,
        taskCount:     (analysis.tasks        || []).length,
        decisionCount: (analysis.decisions    || []).length,
        email:         resolved.email,
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

  const resolved = resolveUserSheet(ss, authSheet, username, false);
  if (resolved.error) {
    log('ERROR', 'updateMeeting', username, 'SHEETS_WRITE', resolved.error);
    return fail('User sheet not found: ' + resolved.error);
  }

  const data = resolved.sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][M_ID]) === String(meetingId)) {
      const rowNum = i + 1;
      if (updates.title        !== undefined) resolved.sheet.getRange(rowNum, M_TITLE       + 1).setValue(updates.title);
      if (updates.transcript   !== undefined) resolved.sheet.getRange(rowNum, M_TRANSCRIPT  + 1).setValue(updates.transcript);
      if (updates.summary      !== undefined) resolved.sheet.getRange(rowNum, M_SUMMARY     + 1).setValue(updates.summary);
      if (updates.actionPoints !== undefined) resolved.sheet.getRange(rowNum, M_ACTIONS     + 1).setValue(JSON.stringify(updates.actionPoints));
      if (updates.decisions    !== undefined) resolved.sheet.getRange(rowNum, M_DECISIONS   + 1).setValue(JSON.stringify(updates.decisions));
      if (updates.nextSteps    !== undefined) resolved.sheet.getRange(rowNum, M_NEXT_STEPS  + 1).setValue(updates.nextSteps);
      if (updates.type         !== undefined) resolved.sheet.getRange(rowNum, M_TYPE        + 1).setValue(updates.type);
      if (updates.tasks        !== undefined) resolved.sheet.getRange(rowNum, M_TASKS       + 1).setValue(JSON.stringify(updates.tasks));
      resolved.sheet.getRange(rowNum, M_UPDATED_AT + 1).setValue(new Date().toISOString());

      log('INFO', 'updateMeeting', username, 'SHEETS_WRITE', 'Meeting updated', {
        meetingId, updatedFields: Object.keys(updates), email: resolved.email
      }, Date.now() - t0);
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

  const resolved = resolveUserSheet(ss, authSheet, username, false);
  if (resolved.error) {
    log('ERROR', 'deleteMeeting', username, 'SHEETS_WRITE', resolved.error);
    return fail('User sheet not found: ' + resolved.error);
  }

  const data = resolved.sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][M_ID]) === String(meetingId)) {
      resolved.sheet.deleteRow(i + 1);
      log('INFO', 'deleteMeeting', username, 'SHEETS_WRITE', 'Meeting deleted',
        { meetingId, email: resolved.email }, Date.now() - t0);
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
 * ⚠️ TEST MODE: reads plaintext from password_enc col (A_PASSWORD)
 * PROD REVERT: swap `password: String(raw)` to `password: decryptPassword(raw)`
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
    password: String(raw), // ⚠️ TEST MODE — revert to decryptPassword(raw) for prod
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

/**
 * getAllMeetings
 * Returns all meetings across all users for the admin portal.
 * Uses resolveUserSheet for consistent username→email→tab resolution.
 * debug array shows per-user resolution status for the admin portal.
 */
function handleGetAllMeetings(body, t0) {
  const check = requireAdmin(body);
  if (check.error) return check.error;

  const authData    = check.authSheet.getDataRange().getValues();
  const allMeetings = [];
  const debugInfo   = [];

  for (let u = 1; u < authData.length; u++) {
    const username = authData[u][A_USERNAME];
    const email    = String(authData[u][A_EMAIL] || '').trim().toLowerCase();
    if (!username || !email) continue;

    const expectedTab = tabNameFromEmail(email);
    const userSheet   = getSheetForEmail(check.ss, email, false);

    debugInfo.push({
      username,
      email,
      expectedTab,
      found:    !!userSheet,
      meetings: userSheet ? Math.max(0, userSheet.getLastRow() - 1) : 0,
    });

    if (!userSheet || userSheet.getLastRow() <= 1) continue;

    const rows = userSheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[M_ID]) continue;
      try {
        allMeetings.push({
          owner:        username,
          id:           String(row[M_ID]),
          title:        row[M_TITLE]      || '',
          transcript:   row[M_TRANSCRIPT] || '',
          summary:      row[M_SUMMARY]    || '',
          actionPoints: safeJSON(row[M_ACTIONS],   '[]'),
          decisions:    safeJSON(row[M_DECISIONS], '[]'),
          nextSteps:    row[M_NEXT_STEPS] || '',
          duration:     row[M_DURATION]   || 0,
          type:         row[M_TYPE]       || 'Meeting',
          createdAt:    row[M_CREATED_AT] || '',
          updatedAt:    row[M_UPDATED_AT] || '',
          tasks:        safeJSON(row[M_TASKS], '[]'),
        });
      } catch (ex) {
        log('WARN', 'getAllMeetings', body.adminUsername, 'ADMIN',
          `Skipped malformed row for ${username}`, ex.message);
      }
    }
  }

  allMeetings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  log('INFO', 'getAllMeetings', body.adminUsername, 'ADMIN',
    `Fetched ${allMeetings.length} total meetings`, { userResolution: debugInfo }, Date.now() - t0);

  return ok({ meetings: allMeetings, debug: debugInfo });
}

/**
 * backfillUserSheets — ONE-TIME MIGRATION
 * Creates missing sheet tabs for users registered before the tab-creation fix.
 * Safe to call multiple times — only creates tabs that are missing.
 */
function handleBackfillUserSheets(body, t0) {
  const check = requireAdmin(body);
  if (check.error) return check.error;

  const authData = check.authSheet.getDataRange().getValues();
  const results  = [];

  for (let u = 1; u < authData.length; u++) {
    const email    = String(authData[u][A_EMAIL]    || '').trim().toLowerCase();
    const username = String(authData[u][A_USERNAME] || '').trim();
    if (!email || !username) continue;

    const tab      = tabNameFromEmail(email);
    const existing = check.ss.getSheetByName(tab);

    if (!existing) {
      getSheetForEmail(check.ss, email, true);
      results.push({ username, email, tab, action: 'created' });
      log('INFO', 'backfillUserSheets', body.adminUsername, 'ADMIN',
        `Created missing tab for ${username}`, { tab });
    } else {
      results.push({ username, email, tab, action: 'already_exists' });
    }
  }

  log('INFO', 'backfillUserSheets', body.adminUsername, 'ADMIN',
    `Backfill complete — ${results.length} users processed`, null, Date.now() - t0);
  return ok({ results });
}