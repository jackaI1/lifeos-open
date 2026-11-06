import { expect, it, vi } from 'vitest';
vi.mock('../lib/db', () => ({ listRuns: vi.fn().mockResolvedValue({runs:[],total:0}) }));
import { GET } from '../app/api/runs/route';
it('returns an empty page and parsed filters as JSON', async () => {
 const res = await GET(new Request('http://localhost/api/runs?status=failed&page=2'));
 expect(res.status).toBe(200);
 expect(await res.json()).toMatchObject({runs:[],total:0,filters:{status:'failed',page:2}});
});
