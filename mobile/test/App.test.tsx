import React from 'react';
import {readFileSync} from 'node:fs';
import {act, render, screen, fireEvent, waitFor} from '@testing-library/react-native';
import {AppState} from 'react-native';
import {TodayScreen} from '../src/TodayScreen';
import {createFeedClient} from '../src/feed';
const template = JSON.parse(readFileSync('../public/demo/today.json', 'utf8'));
const now = Date.parse('2026-11-05T16:00:00Z');
function setup() {
  let saved: string | null = null;
  const storage = {getItem: jest.fn(async () => saved), setItem: jest.fn(async (_key: string, value: string) => {saved = value;})};
  const download = jest.fn(async () => template);
  return {download, client: createFeedClient({storage, download, now: () => now})};
}
test('loads schedule, deadlines and unknown dates with a fictional-data notice', async () => {
  const {client} = setup();
  await render(<TodayScreen client={client} clock={() => now} />);
  expect(await screen.findByText('Workshop')).toBeTruthy();
  expect(screen.getByText('Systems pre-lab checklist')).toBeTruthy();
  expect(screen.getByText('Check the workshop reflection deadline')).toBeTruthy();
  expect(screen.getByText(/Fictional public demo/)).toBeTruthy();
  expect(screen.getByText(/Saved for offline use/)).toBeTruthy();
});
test('first offline launch offers Retry and recovers on press', async () => {
  const {client, download} = setup();
  download.mockRejectedValueOnce(new Error('offline'));
  await render(<TodayScreen client={client} clock={() => now} />);
  expect(await screen.findByText(/No saved day yet/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', {name: 'Retry'}));
  expect(await screen.findByText('Workshop')).toBeTruthy();
});
test('shows persisted content immediately during refresh, then offline and stale-date labels', async () => {
  const {client, download} = setup();
  await client.refresh();
  let fail!: (error: Error) => void;
  download.mockImplementation(() => new Promise((_resolve, reject) => {fail = reject;}));
  await render(<TodayScreen client={client} clock={() => now + 86400000} />);
  expect(await screen.findByText('Systems pre-lab checklist')).toBeTruthy();
  expect(screen.getByText(/Refreshing/)).toBeTruthy();
  expect(screen.getByText(/Saved for 2026-11-05/)).toBeTruthy();
  fail(new Error('offline'));
  await waitFor(() => expect(screen.getByText(/Could not refresh/)).toBeTruthy());
  expect(screen.getAllByText(/^Overdue · /).length).toBeGreaterThan(0);
  expect(screen.queryByText('Workshop')).toBeNull();
});
test('explains a failed offline save while keeping the downloaded schedule', async () => {
  const client = createFeedClient({storage: {getItem: async () => null, setItem: async () => {throw Error('disk');}}, download: async () => template, now: () => now});
  await render(<TodayScreen client={client} clock={() => now} />);
  expect(await screen.findByText(/Could not save for offline use/)).toBeTruthy();
  expect(screen.getByText('Workshop')).toBeTruthy();
});
test('empty feed has explicit schedule and deadline empty states', async () => {
  const client = createFeedClient({storage: {getItem: async () => null, setItem: async () => {}}, download: async () => ({...template, events: [], tasks: []}), now: () => now});
  await render(<TodayScreen client={client} clock={() => now} />);
  expect(await screen.findByText('No scheduled events today.')).toBeTruthy();
  expect(screen.getByText('No deadlines in the next seven days.')).toBeTruthy();
});
test('unmount aborts the request and removes the day timer and foreground listener', async () => {
  let signal: AbortSignal | undefined;
  const remove = jest.fn();
  const listener = jest.mocked(AppState.addEventListener);
  const original = listener.getMockImplementation();
  listener.mockReturnValueOnce({remove});
  const client = createFeedClient({storage: {getItem: async () => null, setItem: async () => {}}, download: current => {signal = current; return new Promise(() => {});}, now: () => now});
  jest.useFakeTimers();
  const scheduled = jest.spyOn(global, 'setTimeout');
  const cleared = jest.spyOn(global, 'clearTimeout');
  try {
    const view = await render(<TodayScreen client={client} clock={() => now} />);
    const index = scheduled.mock.calls.findIndex(call => Number(call[1]) > 3600000);
    expect(index).toBeGreaterThanOrEqual(0);
    const dayTimer = scheduled.mock.results[index].value;
    expect(signal?.aborted).toBe(false);
    await view.unmount();
    expect(signal?.aborted).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(cleared).toHaveBeenCalledWith(dayTimer);
  } finally {scheduled.mockRestore(); cleared.mockRestore(); jest.useRealTimers(); if (original) listener.mockImplementation(original);}
});
test('rollover refresh failure keeps saved dates fixed and updates the visible day', async () => {
  let current = Date.parse('2026-11-06T09:59:59Z'); // Toronto, just before 5am
  const clock = () => current;
  const {client, download} = setup();
  await client.refresh();
  download.mockRejectedValue(new Error('offline'));
  jest.useFakeTimers();
  try {
    const view = await render(<TodayScreen client={client} clock={clock} />);
    await act(async () => {await Promise.resolve();});
    expect(screen.getByText('Workshop')).toBeTruthy();
    current += 1001;
    await act(async () => {await jest.advanceTimersByTimeAsync(1001);});
    expect(screen.getByText('2026-11-06')).toBeTruthy();
    expect(screen.queryByText('Workshop')).toBeNull();
    expect(screen.getByText(/Saved for 2026-11-05/)).toBeTruthy();
    expect(download).toHaveBeenCalledTimes(3);
    await view.unmount();
  } finally {jest.useRealTimers();}
});
