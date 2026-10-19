import { afterEach, describe, expect, it, vi } from 'vitest';
import { announceRelease, noticeReleaseOnce, releaseMessage, type ReleaseNotice } from '../electron/releases';

describe('electron/releases', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('arma el aviso con la versión y el enlace a la release', () => {
    expect(releaseMessage('1.7.1')).toBe('Versión 1.7.1 ya disponible\nhttps://github.com/xenognesis/mcs-project/releases/tag/v1.7.1');
  });

  it('publica el aviso en el canal indicado como el bot', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: { headers: Record<string, string>; body: string }) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await announceRelease('TOKEN', '1561576254111613040', '1.7.1')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://discord.com/api/v10/channels/1561576254111613040/messages');
    expect(init.headers.Authorization).toBe('Bot TOKEN');
    expect(JSON.parse(init.body).content).toBe(releaseMessage('1.7.1'));
  });

  it('no llama a Discord si faltan el token, el canal o la versión', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await announceRelease('', 'canal', '1.7.1')).toBe(false);
    expect(await announceRelease('TOKEN', '', '1.7.1')).toBe(false);
    expect(await announceRelease('TOKEN', 'canal', '')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('avisa con el error de Discord si la publicación falla', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('sin permisos', { status: 403 })));
    await expect(announceRelease('TOKEN', 'canal', '1.7.1')).rejects.toThrow('HTTP 403');
  });
});

describe('electron/releases noticeReleaseOnce', () => {
  afterEach(() => vi.unstubAllGlobals());

  const options = (overrides: Partial<Parameters<typeof noticeReleaseOnce>[0]> = {}) => ({
    token: 'TOKEN',
    channelId: 'canal',
    version: '1.7.1',
    by: 'Aira',
    alreadyNoticed: async () => false,
    remember: vi.fn(async (_notice: ReleaseNotice) => undefined),
    log: vi.fn(),
    ...overrides
  });

  it('avisa y registra la versión cuando no se avisó antes', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const opts = options();
    expect(await noticeReleaseOnce(opts)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(opts.remember).toHaveBeenCalledTimes(1);
    expect(opts.remember.mock.calls[0][0]).toMatchObject({ version: '1.7.1', by: 'Aira' });
    expect(opts.log).toHaveBeenCalledWith('[Versión] Aviso publicado en Discord: v1.7.1.');
  });

  it('no repite el aviso si esa versión ya se avisó', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const opts = options({ alreadyNoticed: async () => true });
    expect(await noticeReleaseOnce(opts)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(opts.remember).not.toHaveBeenCalled();
  });

  it('no registra el aviso si Discord falla, para reintentarlo después', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 500 })));
    const opts = options();
    expect(await noticeReleaseOnce(opts)).toBe(false);
    expect(opts.remember).not.toHaveBeenCalled();
    expect(String(opts.log.mock.calls[0][0])).toContain('No se pudo avisar');
  });

  it('sin token o sin canal no consulta ni publica', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const sinToken = options({ token: '' });
    const sinCanal = options({ channelId: '' });
    expect(await noticeReleaseOnce(sinToken)).toBe(false);
    expect(await noticeReleaseOnce(sinCanal)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sinToken.remember).not.toHaveBeenCalled();
  });
});
