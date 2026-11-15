import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import App from '../src/App.vue';

const feed = {
  schemaVersion: 1, fictional: true, anchorDate: '2026-10-06', timeZone: 'America/Toronto',
  events: [{id: 'ev-lab', title: 'Fictional lab', start: '2026-10-06T14:00:00Z', end: '2026-10-06T16:00:00Z'}],
  tasks: [],
};

afterEach(() => { vi.restoreAllMocks(); });

describe('App states', () => {
  it('shows a loading status first, then the week when the feed loads', async () => {
    let finish: (response: Response) => void = () => {};
    const fetchImpl = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })) as unknown as typeof fetch;
    const wrapper = mount(App, {props: {fetchImpl}});
    expect(wrapper.find('[role="status"]').text()).toContain('Loading the week');
    finish(new Response(JSON.stringify(feed), {status: 200}));
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Fictional lab');
  });

  it('shows an offline message and a retry button when the network is unreachable', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const wrapper = mount(App, {props: {fetchImpl}});
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('could not be reached');
    expect(wrapper.find('button').text()).toBe('Try again');
  });

  it('shows the offline message without trying the network when the browser reports offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const wrapper = mount(App, {props: {fetchImpl}});
    await flushPromises();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toContain('You are offline');
  });

  it('shows a readable error for a server failure and for a feed in the wrong shape', async () => {
    const serverDown = mount(App, {props: {fetchImpl: vi.fn(async () => new Response('', {status: 500})) as unknown as typeof fetch}});
    await flushPromises();
    expect(serverDown.get('[role="alert"]').text()).toContain('could not be read');
    const wrongShape = mount(App, {props: {fetchImpl: vi.fn(async () => new Response('{"schemaVersion":2}', {status: 200})) as unknown as typeof fetch}});
    await flushPromises();
    expect(wrongShape.get('[role="alert"]').text()).toContain('could not be read');
  });

  it('retries when the user presses Try again', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('', {status: 500}))
      .mockResolvedValueOnce(new Response(JSON.stringify(feed), {status: 200})) as unknown as typeof fetch;
    const wrapper = mount(App, {props: {fetchImpl}});
    await flushPromises();
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('Fictional lab');
  });
});
