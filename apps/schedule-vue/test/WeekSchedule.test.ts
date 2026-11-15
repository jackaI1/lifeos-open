import {describe, expect, it} from 'vitest';
import {mount} from '@vue/test-utils';
import WeekSchedule from '../src/components/WeekSchedule.vue';
import type {WeekDay} from '../src/week.ts';

const days: WeekDay[] = [
  {date: '2026-11-16', isToday: true, events: [{id: 'ev-lab', title: 'Fictional lab', start: '2026-11-16T19:00:00.000Z', end: '2026-11-16T21:00:00.000Z', location: 'Room A'}], deadlines: []},
  {date: '2026-11-17', isToday: false, events: [], deadlines: [{id: 't-old', title: 'Old reading', due: '2026-11-17', overdue: true}]},
];

describe('WeekSchedule', () => {
  it('renders each day with its events, its deadlines and the today marker', () => {
    const wrapper = mount(WeekSchedule, {props: {days, timeZone: 'America/Toronto'}});
    const items = wrapper.findAll('li');
    expect(wrapper.findAll('h2')).toHaveLength(2);
    expect(wrapper.text()).toContain('(today)');
    expect(wrapper.text()).toContain('Fictional lab, Room A');
    expect(wrapper.text()).toContain('Due: Old reading (overdue)');
    expect(items.length).toBeGreaterThan(2);
  });

  it('says when a day is empty', () => {
    const wrapper = mount(WeekSchedule, {props: {days: [{date: '2026-11-18', isToday: false, events: [], deadlines: []}], timeZone: 'America/Toronto'}});
    expect(wrapper.text()).toContain('Nothing planned.');
  });
});
