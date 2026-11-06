import {createHash} from 'node:crypto';
import type {HttpRequest, HttpResponseInit, InvocationContext} from '@azure/functions';
import {parseFeed} from '../../../src/shared/today.ts';

type LoadFeed = () => Promise<unknown>;
const unavailable = (): HttpResponseInit => ({status: 503, headers: {'cache-control': 'no-store', 'retry-after': '10'}, jsonBody: {error: 'Demo feed unavailable'}});

export function createHandlers(load: LoadFeed) {
  return {
    async today(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
      try {
        const feed = parseFeed(await load());
        const etag = '"' + createHash('sha256').update(JSON.stringify(feed)).digest('hex') + '"';
        const headers = {'cache-control': 'public, max-age=60', etag};
        const validators = (request.headers.get('if-none-match') ?? '').split(',').map(value => value.trim().replace(/^W\//, ''));
        if (validators.includes('*') || validators.includes(etag)) return {status: 304, headers};
        return {status: 200, headers, jsonBody: feed};
      } catch {
        context.warn('Public demo feed read failed');
        return unavailable();
      }
    },
    async health(_request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
      try {
        parseFeed(await load());
        return {status: 200, headers: {'cache-control': 'no-store'}, jsonBody: {status: 'ok', fictional: true, schemaVersion: 1}};
      } catch {
        context.warn('Public demo feed readiness failed');
        return unavailable();
      }
    },
  };
}
