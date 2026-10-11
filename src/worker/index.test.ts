import { describe, expect, it } from 'vitest';
import app from './index.js';

describe('worker smoke test', () => {
  it('loads and serves /health', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'driveiq-api' });
  });
});
