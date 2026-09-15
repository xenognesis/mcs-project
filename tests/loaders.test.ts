import { describe, expect, it } from 'vitest';
import { FabricAdapter } from '../electron/loaders';
import { isStale } from '../electron/github';

describe('FabricAdapter', () => {
  it('acepta un manifiesto Fabric completo', () => {
    expect(new FabricAdapter().validate({ version: '1.0.0', minecraftVersion: '1.21.1', loader: 'fabric', serverJar: 'server.jar', clientArchive: 'client.zip', files: [{ path: 'mods/a.jar', sha256: 'abc', url: 'https://example.test/a.jar' }] })).toEqual([]);
  });
  it('rechaza un manifiesto incompleto', () => {
    expect(new FabricAdapter().validate({ version: '1.0.0', minecraftVersion: '', loader: 'fabric', serverJar: '', clientArchive: '', files: [] })).toHaveLength(3);
  });
});

describe('leases', () => {
  it('considera obsoleto un heartbeat de más de tres minutos', () => {
    expect(isStale({ sessionId: 'x', hostName: 'Aira', ip: '26.1.1.1', port: 25565, packVersion: '1', startedAt: '', heartbeatAt: new Date(Date.now() - 181_000).toISOString() })).toBe(true);
  });
});
