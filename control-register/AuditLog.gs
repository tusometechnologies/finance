/**
 * TUSOME Finance & Procurement Control Register: audit trail.
 *
 * Writes one row to the "Change Log" tab for every edit, so the auditor
 * (view-only access) can see who changed what and when.
 *
 * Install (owner account only, once):
 *   1. Open the register > Extensions > Apps Script.
 *   2. Paste this file, save.
 *   3. Run installAuditTriggers and accept the permissions prompt.
 * The triggers run as the owner, which is why the Change Log tab can stay
 * protected against everyone else.
 */
const LOG_SHEET = 'Change Log';
const ALLOWED_DOMAINS = ['tusome.ac.tz']; // users outside these domains are flagged in the log

function installAuditTriggers() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('logEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('logChange').forSpreadsheet(ss).onChange().create();
}

function editorEmail_(e) {
  const fromEvent = e && e.user && e.user.getEmail ? e.user.getEmail() : '';
  return fromEvent || Session.getActiveUser().getEmail() || 'Not identified (check version history)';
}

function flag_(email) {
  const domain = (email.split('@')[1] || '').toLowerCase();
  return ALLOWED_DOMAINS.includes(domain) ? '' : ' [outside TUSOME domain]';
}

function append_(row) {
  const log = SpreadsheetApp.getActive().getSheetByName(LOG_SHEET);
  if (log) log.appendRow(row);
}

function logEdit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() === LOG_SHEET) return;
  const email = editorEmail_(e);
  const multi = e.range.getNumRows() > 1 || e.range.getNumColumns() > 1;
  const oldV = multi ? '(multi-cell edit)' : (e.oldValue === undefined ? '' : e.oldValue);
  const newV = multi ? '(multi-cell edit)' : (e.value === undefined ? e.range.getDisplayValue() : e.value);
  const type = multi ? 'Bulk edit' : (oldV === '' ? 'Added' : (newV === '' ? 'Cleared' : 'Changed'));
  append_([new Date(), email + flag_(email), sheet.getName(), e.range.getA1Notation(), oldV, newV, type]);
}

function logChange(e) {
  if (e.changeType === 'EDIT') return; // already logged by logEdit
  const email = editorEmail_(e);
  const tab = SpreadsheetApp.getActive().getActiveSheet().getName();
  append_([new Date(), email + flag_(email), tab, '', '', '', 'Structure: ' + e.changeType]);
}
