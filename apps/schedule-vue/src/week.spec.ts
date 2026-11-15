import {describe, expect, it} from 'vitest';
import {buildWeek} from './week';
import {parseFeed} from '../../../src/shared/today';
import {feed} from './fixtures';

const NOW = Date.parse('2026-10-06T16:00:00Z');
const parsed = parseFeed(feed);

describe('buildWeek', () => {
  it('lists seven local days starting today, with events on the right day', () => {
    const week = buildWeek(parsed, NOW);
    expect(week.start).toBe('2026-10-06');
    expect(week.days).toHaveLength(7);
    expect(week.days[0].events.map(event => event.title)).toEqual(['Workshop', 'Study group']);
    expect(week.days[2].date).toBe('2026-10-08');
    expect(week.days[2].events.map(event => event.title)).toEqual(['Office hours']);
  });

  it('places deadlines on their day and keeps overdue work apart', () => {
    const week = buildWeek(parsed, NOW);
    expect(week.days[2].deadlines.map(item => item.title)).toEqual(['Map the feedback loop']);
    expect(week.days[3].deadlines.map(item => item.title)).toEqual(['Read the watershed example']);
    expect(week.overdue.map(item => item.title)).toEqual(['Overdue reading']);
    expect(week.overdue[0].overdue).toBe(true);
  });

  it('ignores finished tasks and counts undated ones instead of guessing a day', () => {
    const week = buildWeek(parsed, NOW);
    const titles = week.days.flatMap(day => day.deadlines.map(item => item.title));
    expect(titles).not.toContain('Done already');
    expect(week.withoutDate).toBe(1);
  });
});
