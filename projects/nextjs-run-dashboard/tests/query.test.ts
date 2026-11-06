import { describe, expect, it } from 'vitest';
import { parseFilters } from '../lib/filters';
describe('run filters', () => {
 it('accepts search and bounds page and sort parameters', () => {
  expect(parseFilters(new URLSearchParams('q=checkout&status=failed&sort=duration&page=2'))).toEqual({q:'checkout',status:'failed',sort:'duration',page:2});
  expect(parseFilters(new URLSearchParams('status=bad&sort=bad&page=-9'))).toEqual({q:'',status:'all',sort:'newest',page:1});
 });
});
