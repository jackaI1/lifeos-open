import { append, button, busy, el, empty, errorNotice, field, getDisplayTimeZone, modal, replace, status, toast } from '../ui.js';
import { presenceStatus, presenceLabel } from '../presence-status.js';

// Credentials bypass drafts and the mutation outbox. A lost response requires revocation.
export async function mountDevices(root, ctx) {
  let disposed = false, credentialInput = null;
  const list = el('div'), notice = el('div'), observations = el('section', { 'aria-label': 'iPhone Shortcuts status' });
  const localTime = value => value ? new Date(value).toLocaleString(undefined, { timeZone: getDisplayTimeZone(), month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : 'Time unavailable';
  const clearCredential = () => { if (credentialInput) credentialInput.value = ''; credentialInput = null; };
  async function refresh() {
    try {
      const result = await ctx.request('/api/devices');
      if (disposed) return;
      try {
        const received = await ctx.request('/api/records/presence?limit=1000');
        if (disposed) return;
        const view = presenceStatus(result.devices, received.items || []);
        replace(observations, el('h3', {}, 'iPhone Shortcuts'), status(view.connected ? 'Credential connected' : 'No active credential', view.connected ? 'saved' : 'unknown'),
          view.events.length ? el('p', {}, `${presenceLabel(view.events[0])}, ${localTime(view.events[0].occurredAt)}`) : empty('No real Shortcut event has been received.'),
          view.events.length ? el('p', { class: 'save-meta' }, `Last received ${localTime(view.events[0].receivedAt)}, Toronto time`) : null,
          el('details', {}, el('summary', {}, 'Four automations and recent events'),
            view.automations.map(item => el('p', { class: 'save-meta' }, `${presenceLabel(item)}: ${item.latest ? localTime(item.latest.occurredAt) : 'Not seen in loaded history. This is not evidence of failure.'}`)),
            view.events.slice(0, 12).map(item => el('p', { class: 'save-meta' }, `${presenceLabel(item)}, ${localTime(item.occurredAt)}, Accepted`))));
      } catch (error) { replace(observations, errorNotice(error)); }
      replace(list, ...(result.devices?.length ? result.devices.map(device => el('div', { class: 'practice-row' },
        el('div', { class: 'row' }, el('h3', {}, device.label || 'Unnamed device'), status(device.revoked ? 'Revoked' : 'Credential active', device.revoked ? 'unknown' : 'saved')),
        el('p', { class: 'save-meta' }, device.createdAt ? `Created ${new Date(device.createdAt).toLocaleString()}` : 'Creation date unavailable'),
        !device.revoked ? button('Revoke credential', event => busy(event.currentTarget, async () => { await revoke(device.id); }), 'quiet compact') : null
      )) : [empty('No device credentials. Create one on production when you are ready to set up Shortcuts.')]));
    } catch (error) { if (!disposed) replace(list, errorNotice(error)); }
  }
  async function revoke(id) {
    await ctx.request('/api/devices/revoke', { method: 'POST', body: { id, mutationId: crypto.randomUUID() } });
    clearCredential(); toast('Device credential revoked.'); await refresh();
  }
  function showCredential(result) {
    clearCredential();
    let token = typeof result.token === 'string' ? result.token : '';
    result.token = null;
    if (disposed) return;
    if (!token) {
      modal('Credential cannot be retrieved', el('div', { class: 'form-stack' }, el('p', {}, 'The credential appears only in its first successful response. Revoke this device and create a new credential before configuring Shortcuts.'), button('Revoke this device', event => busy(event.currentTarget, async () => { await revoke(result.id); document.querySelector('#dialog').close(); }))));
      return;
    }
    const secret = field('Device credential, shown once', { type: 'password', value: token, readonly: true, autocomplete: 'off', spellcheck: 'false' });
    token = '';
    modal('Save your Shortcuts credential', el('div', { class: 'form-stack' },
      el('p', {}, 'Copy this into your personal Shortcuts authorization header. Closing this window clears it. You can revoke it below if setup is interrupted.'), secret.node,
      button('Copy credential', event => busy(event.currentTarget, async () => {
        if (!secret.input.value) throw new Error('The credential was cleared. Revoke this device and create another.');
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable. Select the credential field and use your device copy command.');
        await navigator.clipboard.writeText(secret.input.value); toast('Credential copied. Paste it only into your personal Shortcuts authorization header.');
      })),
      el('p', { class: 'notice' }, 'This credential can report named-zone arrivals and departures only. It cannot read your LifeOS records.')
    ), { onclose: clearCredential });
    credentialInput = secret.input;
  }
  const label = field('Device name', { value: 'My iPhone', required: true, maxlength: 100, autocomplete: 'off' });
  const create = button('Create device credential', event => busy(event.currentTarget, async () => {
    if (!label.input.reportValidity() || !label.input.value.trim()) return;
    replace(notice);
    try {
      const result = await ctx.request('/api/devices', { method: 'POST', body: { label: label.input.value.trim(), mutationId: crypto.randomUUID() } });
      showCredential(result); await refresh();
    } catch {
      if (!disposed) replace(notice, el('p', { class: 'notice', role: 'alert' }, 'Creation was not confirmed. If a new device appears below, revoke it and create another. A credential from a lost response cannot be retrieved.'));
      await refresh();
    }
  }));
  append(root,
    (ctx.state.session?.environment === 'production'||ctx.state.session?.mode) ? el('div', { class: 'form-stack' }, label.node, create, notice) : el('p', { class: 'notice' }, 'Create phone credentials on production. Beta cannot issue them.'),
    observations, el('details', {}, el('summary', {}, 'Manage device credentials'), list), button('Refresh Shortcut status', event => busy(event.currentTarget, refresh), 'text-button'),
    el('details', {}, el('summary', {}, 'Set up the four personal automations'),
      el('ol', {},
        el('li', {}, 'In Shortcuts, create personal automations for arriving home, leaving home, arriving on campus and leaving campus. Approve location and automation permissions on your iPhone.'),
        el('li', {}, `Use Get Contents of URL with HTTPS POST to ${location.origin}/api/presence.`),
        el('li', {}, 'Add the Authorization header with Bearer followed by a space and your credential. Set Content-Type to application/json.'),
        el('li', {}, 'Use a JSON body with eventId set to a newly generated UUID, zone set to home or campus, type set to arrival or departure, and occurredAt set to the current ISO 8601 date and time including its timezone offset.'),
        el('li', {}, 'Run a test and check the recorded zone and time in Today. Then test a real arrival and departure. Review whether iOS requires confirmation or a location permission change.')
      ))
  );
  await refresh();
  return { destroy() { disposed = true; clearCredential(); } };
}
