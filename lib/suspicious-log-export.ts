// Turns log entries into CSV or plain text for export and copying. Pure, so the
// browser (copy) and the server (download) format a message the same way.

import { formatUtc } from './suspicious-log-query';

export type ExportRow = {
  sent_at: string;
  chatter_login: string;
  chatter_name: string;
  message_text: string;
  low_trust_status: string;
  detection_types: string[];
  ban_evasion_evaluation: string | null;
};

// Chat text is written by strangers. A cell that starts with one of these is
// run as a formula by Excel and Sheets, so it's stored as text instead.
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const CSV_HEADER = ['time_utc', 'username', 'display_name', 'status', 'detection', 'ban_evasion', 'message'];

export function toCsv(rows: ExportRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const row of rows) {
    lines.push(
      [
        formatUtc(row.sent_at),
        row.chatter_login,
        row.chatter_name,
        row.low_trust_status,
        row.detection_types.join(' '),
        row.ban_evasion_evaluation ?? '',
        row.message_text,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ');

/** `<time> <name>: <message>`, one line per message. */
export function toText(
  rows: Pick<ExportRow, 'sent_at' | 'chatter_name' | 'message_text'>[],
  formatTime: (iso: string) => string,
): string {
  return rows.map((row) => `${formatTime(row.sent_at)} ${row.chatter_name}: ${oneLine(row.message_text)}`).join('\n');
}
