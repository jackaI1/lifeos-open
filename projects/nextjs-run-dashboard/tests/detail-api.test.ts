import { expect, it, vi } from 'vitest';
vi.mock('../lib/db', () => ({ getRun: vi.fn().mockResolvedValue(null) }));
import { GET } from '../app/api/runs/[id]/route';
it('returns 404 for a missing run', async () => {
 const response=await GET(new Request('http://localhost/api/runs/999'),{params:Promise.resolve({id:'999'})});
 expect(response.status).toBe(404);
 expect(await response.json()).toEqual({error:'Run not found'});
});
