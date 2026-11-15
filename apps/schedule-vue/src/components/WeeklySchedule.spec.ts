import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import WeeklySchedule from './WeeklySchedule.vue';
import {buildWeek} from '../week';
import {parseFeed} from '../../../../src/shared/today';
import {feed} from '../fixtures';

const week = buildWeek(parseFeed(feed), Date.parse('2026-10-06T16:00:00Z'));

describe('WeeklySchedule', () => {
  it('shows a loading message with a status role', () => {
    const wrapper = mount(WeeklySchedule, {props: {week: null, status: 'loading', message: null}});
    expect(wrapper.get('[role="status"]').text()).toBe('Loading the week…');
  });

  it('renders each day, its events and deadlines in the feed time zone', () => {
    const wrapper = mount(WeeklySchedule, {props: {week, status: 'ready', message: null}});
    expect(wrapper.findAll('article.day')).toHaveLength(7);
    expect(wrapper.text()).toContain('Workshop');
    expect(wrapper.text()).toContain('10:05');
    expect(wrapper.text()).toContain('Map the feedback loop due 2026-10-08');
    expect(wrapper.get('[aria-label="Overdue"]').text()).toContain('overdue');
    expect(wrapper.text()).toContain('1 open task(s) have no date yet.');
  });

  it('keeps the last week visible while offline, with a notice', () => {
    const wrapper = mount(WeeklySchedule, {props: {week, status: 'offline', message: 'You are offline.'}});
    expect(wrapper.get('[role="status"]').text()).toBe('You are offline.');
    expect(wrapper.findAll('article.day')).toHaveLength(7);
  });

  it('shows an error alert with a keyboard-reachable retry button that emits retry', async () => {
    const wrapper = mount(WeeklySchedule, {props: {week: null, status: 'error', message: 'The schedule could not be loaded. Try again.'}});
    expect(wrapper.get('[role="alert"]').text()).toContain('could not be loaded');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });
});
