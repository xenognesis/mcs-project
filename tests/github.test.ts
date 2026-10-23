import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient } from '../electron/github';
import type { Lease } from '../electron/types';

const repo = { owner: 'owner', repo: 'coordination', branch: 'main' };
const lease: Lease = {
  sessionId: 'new-session',
  hostName: 'Rhazerok',
  ip: '26.51.59.94',
  port: 25566,
  packVersion: '1',
  startedAt: new Date().toISOString(),
  heartbeatAt: new Date().toISOString()
};

const response = (status: number, body = '{}') => new Response(body, { status });
const fileResponse = (content: string, sha: string) => response(200, JSON.stringify({
  content: Buffer.from(content).toString('base64'),
  sha
}));

describe('GitHubClient.acquireLease', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reemplaza un lease vacío conservando su sha', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fileResponse('', 'empty-sha'))
      .mockResolvedValueOnce(response(200));
    vi.stubGlobal('fetch', fetchMock);

    expect(await new GitHubClient('token').acquireLease(repo, lease, 'server-status-tests.json')).toBe(true);
    const [, init] = fetchMock.mock.calls[1];
    expect(JSON.parse(init.body).sha).toBe('empty-sha');
  });

  it('reemplaza un JSON con forma inválida', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fileResponse('{"foo":1}', 'bad-sha'))
      .mockResolvedValueOnce(response(200));
    vi.stubGlobal('fetch', fetchMock);

    expect(await new GitHubClient('token').acquireLease(repo, lease, 'server-status-tests.json')).toBe(true);
    const [, init] = fetchMock.mock.calls[1];
    expect(JSON.parse(init.body).sha).toBe('bad-sha');
  });

  it('respeta un lease vigente de otro jugador', async () => {
    const held: Lease = { ...lease, sessionId: 'other', hostName: 'Aira' };
    const fetchMock = vi.fn().mockResolvedValueOnce(fileResponse(JSON.stringify(held), 'held-sha'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await new GitHubClient('token').acquireLease(repo, lease, 'server-status.json')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('informa el error real si GitHub rechaza la escritura', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fileResponse('', 'empty-sha'))
      .mockResolvedValueOnce(response(409));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new GitHubClient('token').acquireLease(repo, lease, 'server-status-tests.json'))
      .rejects.toThrow('No se pudo reservar server-status-tests.json en GitHub: GitHub: 409 al actualizar server-status-tests.json');
  });
});
