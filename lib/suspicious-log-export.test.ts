import { describe, expect, it } from 'vitest';
import { csvCell, toCsv, toText, type ExportRow } from './suspicious-log-export';

const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  sent_at: '2026-11-18T19:09:24.448Z',
  chatter_login: 'viewer',
  chatter_name: 'Viewer',
  message_text: 'hello',
  low_trust_status: 'restricted',
  detection_types: ['manually_added', 'ban_evader'],
  ban_evasion_evaluation: 'likely',
  ...over,
});

describe('csvCell', () => {
  it('leaves plain text alone', () => {
    expect(csvCell('hello world')).toBe('hello world');
  });

  it('quotes text that holds a comma, a quote or a line break, doubling the quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"');
  });

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])('stops %j running as a formula', (text) => {
    expect(csvCell(text).replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('does not touch text that only contains those characters further in', () => {
    expect(csvCell('a=b')).toBe('a=b');
    expect(csvCell('1-2')).toBe('1-2');
  });
});

describe('toCsv', () => {
  it('writes a header and one CRLF-ended line per message, in UTC', () => {
    expect(toCsv([row()])).toBe(
      'time_utc,username,display_name,status,detection,ban_evasion,message\r\n' +
        '2026-11-18 19:09:24,viewer,Viewer,restricted,manually_added ban_evader,likely,hello\r\n',
    );
  });

  it('leaves the ban evasion column empty when Twitch gave none', () => {
    expect(toCsv([row({ ban_evasion_evaluation: null })])).toContain(',manually_added ban_evader,,hello');
  });

  it('is just the header for no messages', () => {
    expect(toCsv([])).toBe('time_utc,username,display_name,status,detection,ban_evasion,message\r\n');
  });
});

describe('toText', () => {
  const at = (iso: string) => `[${iso.slice(11, 19)}]`;

  it('writes one line per message', () => {
    expect(toText([row(), row({ chatter_name: 'Other', message_text: 'bye' })], at)).toBe(
      '[19:09:24] Viewer: hello\n[19:09:24] Other: bye',
    );
  });

  it('keeps a multi-line message on one line', () => {
    expect(toText([row({ message_text: 'one\r\n\n  two' })], at)).toBe('[19:09:24] Viewer: one two');
  });

  it('is empty for no messages', () => {
    expect(toText([], at)).toBe('');
  });
});
