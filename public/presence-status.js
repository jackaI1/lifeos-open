export const presenceLabel = event => `${event.type === 'arrival' ? 'Arrived' : 'Left'} ${event.zone}`;
export function presenceStatus(devices = [], records = []) {
  const events = records.map(record => ({ id: record.id, ...record.data })).filter(event => event.source === 'shortcut' && event.authenticated === true && ['home', 'campus'].includes(event.zone) && ['arrival', 'departure'].includes(event.type)).sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  return { connected: devices.some(device => !device.revoked), events, automations: ['home', 'campus'].flatMap(zone => ['departure', 'arrival'].map(type => ({ zone, type, latest: events.find(event => event.zone === zone && event.type === type) }))) };
}
