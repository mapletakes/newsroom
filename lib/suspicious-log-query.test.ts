import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOG_FILTERS,
  escapeLike,
  formatLogTime,
  groupByDay,
  localDayKey,
  localDayToIso,
  parseLogFilters,
  toLogSearchParams,
} from './suspicious-log-query';

describe('parseLogFilters', () => {
  it('defaults to everything on the first page', () => {
    expect(parseLogFilters(new URLSearchParams())).toEqual(DEFAULT_LOG_FILTERS);
  });

  it('normalises usernames', () => {
    expect(parseLogFilters(new URLSearchParams('user=@SomeViewer')).user).toBe('someviewer');
  });

  it('drops values outside what the log supports', () => {
    const filters = parseLogFilters(
      new URLSearchParams('status=banned&type=unknown&chatterId=1;drop&from=nope&page=-4'),
    );
    expect(filters).toEqual(DEFAULT_LOG_FILTERS);
    expect(parseLogFilters(new URLSearchParams('type=toString')).type).toBe('');
  });

  it('survives a round trip through the URL', () => {
    const filters = {
      ...DEFAULT_LOG_FILTERS,
      q: 'hello there',
      user: 'viewer',
      chatterId: '123',
      status: 'restricted' as const,
      type: 'ban_evader',
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-02T00:00:00.000Z',
      order: 'oldest' as const,
      page: 3,
    };
    expect(parseLogFilters(toLogSearchParams(filters))).toEqual(filters);
  });

  it('shows the newest first unless asked otherwise, without cluttering the URL', () => {
    expect(parseLogFilters(new URLSearchParams('order=sideways')).order).toBe('newest');
    expect(parseLogFilters(new URLSearchParams('order=oldest')).order).toBe('oldest');
    expect(toLogSearchParams(DEFAULT_LOG_FILTERS).toString()).toBe('');
  });
});

describe('log line formatting', () => {
  it('writes the time as a fixed-width local clock', () => {
    const iso = new Date(2026, 10, 18, 7, 5, 9).toISOString();
    expect(formatLogTime(iso)).toBe('07:05:09');
  });

  it('keys a message by its local calendar day', () => {
    expect(localDayKey(new Date(2026, 10, 18, 23, 59).toISOString())).toBe('2026-11-18');
    expect(localDayKey(new Date(2026, 0, 2, 0, 1).toISOString())).toBe('2026-01-02');
  });

  it('groups consecutive messages by day and keeps their order', () => {
    const at = (day: number, hour: number) => ({ sent_at: new Date(2026, 10, day, hour).toISOString() });
    const items = [at(19, 1), at(18, 23), at(18, 9), at(17, 12)];

    const groups = groupByDay(items);

    expect(groups.map((g) => g.key)).toEqual(['2026-11-19', '2026-11-18', '2026-11-17']);
    expect(groups.map((g) => g.items.length)).toEqual([1, 2, 1]);
    expect(groups[1].items).toEqual([items[1], items[2]]);
  });

  it('returns no groups for an empty page', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('escapeLike', () => {
  it('treats search wildcards as ordinary characters', () => {
    expect(escapeLike('100%_real\\deal')).toBe('100\\%\\_real\\\\deal');
  });
});

describe('localDayToIso', () => {
  it('moves forward by whole calendar days', () => {
    const start = new Date(localDayToIso('2026-11-18'));
    const next = new Date(localDayToIso('2026-11-18', 1));
    expect(next.getDate()).toBe(19);
    expect(start.getHours()).toBe(0);
  });

  it('returns nothing for an empty or invalid day', () => {
    expect(localDayToIso('')).toBe('');
    expect(localDayToIso('soon')).toBe('');
  });
});
