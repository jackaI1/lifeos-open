import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, RefreshControl } from 'react-native';
import feed from '../../public/lifeos-demo.json';
import { AgendaScreen } from '../AgendaScreen';
import { createRepository, CACHE_KEY } from '../repository';
import { resolveFeed } from '../dates';

const now = () => new Date(2026, 10, 5, 9);
const response = (value: unknown = feed) => ({ ok: true, json: async () => value }) as Response;
function setup(fetcher: typeof fetch, saved?: string, failsSave = false) {
  const data = new Map(saved ? [[CACHE_KEY, saved]] : []);
  const storage = { getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => { if (failsSave) throw Error('disk'); data.set(key, value); } };
  const repository = createRepository({ storage, fetcher, now });
  const view = render(<AgendaScreen repository={repository} now={now} />);
  return { ...view, data };
}

test('shows live schedule, unfinished deadlines and next steps after loading', async () => {
  const { data } = setup(async () => response());
  expect(await screen.findByText('Workshop')).toBeOnTheScreen();
  expect(screen.getByText('Fictional design studio')).toBeOnTheScreen();
  expect(screen.getByText('List the system inputs and sketch one feedback loop.')).toBeOnTheScreen();
  expect(screen.getByText('Date not confirmed')).toBeOnTheScreen();
  expect(screen.getByText(/Updated/)).toBeOnTheScreen();
  expect(data.has(CACHE_KEY)).toBe(true);
});

test('shows saved data before a slow fetch finishes and preserves it on failure', async () => {
  let reject!: (reason: Error) => void;
  setup(() => new Promise<Response>((_resolve, fail) => { reject = fail; }), JSON.stringify(resolveFeed(feed, now())));
  expect(await screen.findByText('Workshop')).toBeOnTheScreen();
  expect(screen.getByText(/Saved snapshot/)).toBeOnTheScreen();
  await act(async () => reject(Error('offline')));
  expect(await screen.findByText(/Could not refresh/)).toBeOnTheScreen();
  expect(screen.getByText('Workshop')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
});

test('recovers from an offline first launch with Retry', async () => {
  let online = false;
  setup(async () => { if (!online) throw Error('offline'); return response(); });
  expect(await screen.findByText(/No saved snapshot yet/)).toBeOnTheScreen();
  online = true;
  fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Workshop')).toBeOnTheScreen();
  expect(screen.queryByText(/No saved snapshot yet/)).toBeNull();
});

test('pull to refresh replaces data and does not overlap requests', async () => {
  let finish!: (value: Response) => void;
  let slow = false;
  const fetcher = jest.fn(async () => slow ? new Promise<Response>(resolve => { finish = resolve; }) : response());
  setup(fetcher);
  await screen.findByText('Workshop');
  slow = true;
  const refresh = screen.UNSAFE_getByType(RefreshControl);
  fireEvent(refresh, 'refresh');
  fireEvent(refresh, 'refresh');
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  const changed = { ...feed, schedule: [{ ...feed.schedule[0], title: 'Updated workshop' }] };
  await act(async () => finish(response(changed)));
  expect(await screen.findByText('Updated workshop')).toBeOnTheScreen();
  expect(screen.queryByText('Workshop')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('explains empty schedule and completed deadlines', async () => {
  setup(async () => response({ ...feed, schedule: [], deadlines: feed.deadlines.map(d => ({ ...d, done: true })) }));
  expect(await screen.findByText('No events today.')).toBeOnTheScreen();
  expect(screen.getByText('No unfinished deadlines.')).toBeOnTheScreen();
});

test('shows fresh content even when saving offline data fails', async () => {
  setup(async () => response(), undefined, true);
  expect(await screen.findByText('Workshop')).toBeOnTheScreen();
  expect(screen.getByText(/could not save/)).toBeOnTheScreen();
});

test('ignores corrupt cache and retries invalid remote data without crashing', async () => {
  let valid = false;
  setup(async () => response(valid ? feed : { version: 8 }), 'broken json');
  await screen.findByText(/No saved snapshot yet/);
  valid = true;
  fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Workshop')).toBeOnTheScreen();
});

test('recalculates today on foreground while an offline refresh retains the original dates', async () => {
  let day = now();
  const repository = createRepository({ storage: { getItem: async () => JSON.stringify(resolveFeed(feed, now())), setItem: async () => {} }, fetcher: async () => { throw Error('offline'); } });
  const listener = jest.mocked(AppState.addEventListener);
  const original = listener.getMockImplementation();
  let onChange!: (state: 'active') => void;
  listener.mockImplementation((_event, handler) => { onChange = handler; return { remove: jest.fn() }; });
  const { unmount } = render(<AgendaScreen repository={repository} now={() => day} />);
  await screen.findByText('Workshop');
  await screen.findByText(/Could not refresh/);
  day = new Date(2026, 10, 6, 9);
  await act(async () => onChange('active'));
  await waitFor(() => expect(screen.getByText('No events today.')).toBeOnTheScreen());
  expect(screen.getByText('Map the feedback loop')).toBeOnTheScreen();
  unmount();
  listener.mockImplementation(original!);
});

test('aborts the active request when leaving the screen', async () => {
  let signal: AbortSignal | null | undefined;
  const { unmount } = setup(async (_url, init) => { signal = init?.signal; return new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort', () => reject(Error('cancelled')))); });
  await waitFor(() => expect(signal).toBeDefined());
  unmount();
  expect(signal!.aborted).toBe(true);
});

test('does not describe unsaved data as a saved snapshot after a later network failure', async () => {
  let online = true;
  setup(async () => { if (!online) throw Error('offline'); return response(); }, undefined, true);
  await screen.findByText('Workshop');
  online = false;
  fireEvent.press(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText(/Showing last loaded data/)).toBeOnTheScreen();
  expect(screen.queryByText(/Saved snapshot/)).toBeNull();
  expect(screen.getByText(/could not save/)).toBeOnTheScreen();
});
