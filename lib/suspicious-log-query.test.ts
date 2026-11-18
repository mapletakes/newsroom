import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOG_FILTERS,
  escapeLike,
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
      page: 3,
    };
    expect(parseLogFilters(toLogSearchParams(filters))).toEqual(filters);
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
