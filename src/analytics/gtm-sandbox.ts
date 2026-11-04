/**
 * Account-free QA for this project's GTM export. This deliberately supports only
 * its built-in Google tags, exact custom-event triggers and data-layer variables.
 * It resolves the checked-in configuration, not a second hard-coded event map.
 * It cannot certify Google's importer, runtime or delivery to a live property.
 */
type Parameter = {type: string; key?: string; value?: string; list?: Parameter[]; map?: Parameter[]};
type Entity = {name: string; type: string; parameter: Parameter[]};
type Tag = Entity & {tagId: string; firingTriggerId: string[]; consentSettings: {consentStatus: string; consentType: Parameter}};
type Trigger = {triggerId: string; type: string; customEventFilter: {type: string; parameter: Parameter[]}[]};
export interface ContainerExport {
  exportFormatVersion: number;
  containerVersion: {tag: Tag[]; trigger: Trigger[]; variable: Entity[]};
}
export interface TagHit {tag: string; event: string; measurementId: string; params: Record<string, string | boolean>}
const INITIALIZATION = '2147479573';
const field = (params: Parameter[], key: string): string => {
  const value = params.find(p => p.key === key)?.value;
  if (typeof value !== 'string') throw Error(`Missing GTM parameter: ${key}`);
  return value;
};

export function createGtmSandbox(container: ContainerExport): {push(message: unknown): void; hits: TagHit[]; configs: TagHit[]} {
  if (container.exportFormatVersion !== 2) throw Error('Expected GTM export format 2');
  const {tag: tags, trigger: triggers, variable: variables} = container.containerVersion;
  const model: Record<string, string> = {};
  const consents: Record<string, string> = {};
  const hits: TagHit[] = [], configs: TagHit[] = [];
  const variablePaths = new Map(variables.map(v => {
    if (v.type !== 'v' || field(v.parameter, 'dataLayerVersion') !== '2') throw Error(`Unsupported GTM variable: ${v.name}`);
    return [v.name, field(v.parameter, 'name')];
  }));
  const events = new Map(triggers.map(t => {
    if (t.type !== 'CUSTOM_EVENT' || t.customEventFilter.length !== 1) throw Error(`Unsupported GTM trigger: ${t.triggerId}`);
    const filter = t.customEventFilter[0];
    if (filter.type !== 'EQUALS' || field(filter.parameter, 'arg0') !== '{{_event}}') throw Error(`Unsupported GTM filter: ${t.triggerId}`);
    return [t.triggerId, field(filter.parameter, 'arg1')];
  }));
  const resolve = (value: string): string => value.replace(/\{\{([^}]+)\}\}/g, (_match, name: string) => {
    const path = variablePaths.get(name);
    if (!path) throw Error(`Unknown GTM variable: ${name}`);
    return model[path] ?? '';
  });
  for (const tag of tags) {
    if (!['googtag', 'gaawe'].includes(tag.type)) throw Error(`Unsupported GTM tag: ${tag.name}`);
    if (!tag.firingTriggerId.every(id => id === INITIALIZATION || events.has(id))) throw Error(`Unknown GTM trigger in ${tag.name}`);
    if (tag.consentSettings.consentStatus !== 'NEEDED' || !tag.consentSettings.consentType.list?.some(p => p.value === 'analytics_storage')) throw Error(`Missing analytics consent in ${tag.name}`);
    // Check unresolved references even in a tag whose trigger never fires.
    for (const ref of JSON.stringify(tag).match(/\{\{[^}]+\}\}/g) ?? []) resolve(ref);
  }
  function settings(tag: Tag): Record<string, string | boolean> {
    const table = tag.parameter.find(p => p.key === (tag.type === 'googtag' ? 'configSettingsTable' : 'eventSettingsTable'));
    if (!table?.list) throw Error(`Missing GTM settings table: ${tag.name}`);
    return Object.fromEntries(table.list.map(row => {
      if (!row.map) throw Error(`Invalid GTM settings row: ${tag.name}`);
      const value = resolve(field(row.map, 'parameterValue'));
      return [field(row.map, 'parameter'), value === 'true' ? true : value === 'false' ? false : value];
    }));
  }
  return {hits, configs, push(message) {
    if (!message || typeof message !== 'object') return;
    const command = message as ArrayLike<unknown>;
    if (typeof command.length === 'number') {
      if (command[0] === 'consent' && ['default', 'update'].includes(String(command[1]))) Object.assign(consents, command[2]);
      return;
    }
    const entry = message as Record<string, unknown>;
    for (const [key, value] of Object.entries(entry)) if (typeof value === 'string') model[key] = value;
    if (typeof entry.event !== 'string' || consents.analytics_storage !== 'granted') return;
    for (const tag of tags) {
      if (!tag.consentSettings.consentType.list?.every(p => p.value && consents[p.value] === 'granted')) continue;
      if (!tag.firingTriggerId.some(id => id === INITIALIZATION ? entry.event === 'gtm.js' : events.get(id) === entry.event)) continue;
      const measurementId = resolve(field(tag.parameter, tag.type === 'googtag' ? 'tagId' : 'measurementIdOverride'));
      if (!/^G-[A-Z0-9]{6,12}$/.test(measurementId)) throw Error(`Missing GA4 destination: ${tag.name}`);
      const hit = {tag: tag.name, event: tag.type === 'googtag' ? 'config' : resolve(field(tag.parameter, 'eventName')), measurementId, params: settings(tag)};
      (tag.type === 'googtag' ? configs : hits).push(hit);
    }
  }};
}
