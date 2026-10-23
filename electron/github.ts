import type { Lease, RepoRef } from './types';

type GitHubFile = { sha: string; content: string };
export class GitHubClient {
  constructor(private token: string) {}
  private headers() { return { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; }
  private url(repo: RepoRef, file: string) { return `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${file}?ref=${repo.branch ?? 'main'}`; }
  async getFile(repo: RepoRef, file: string): Promise<GitHubFile | null> {
    const response = await fetch(this.url(repo, file), { headers: this.headers() });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub: ${response.status} al leer ${file}`);
    return response.json() as Promise<GitHubFile>;
  }
  async getJson<T>(repo: RepoRef, file: string): Promise<{ value: T; sha: string } | null> {
    const item = await this.getFile(repo, file); if (!item) return null;
    const text = Buffer.from(item.content, 'base64').toString('utf8').trim();
    if (!text) throw new Error(`El archivo ${file} está vacío en GitHub.`);
    try { return { value: JSON.parse(text) as T, sha: item.sha }; }
    catch { throw new Error(`El archivo ${file} no contiene JSON válido en GitHub.`); }
  }
  async putJson(repo: RepoRef, file: string, value: unknown, sha?: string, message = `Update ${file}`) {
    const response = await fetch(this.url(repo, file), { method: 'PUT', headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content: Buffer.from(JSON.stringify(value, null, 2)).toString('base64'), sha, branch: repo.branch ?? 'main' }) });
    if (!response.ok) throw new Error(`GitHub: ${response.status} al actualizar ${file}`);
  }
  async acquireLease(repo: RepoRef, lease: Lease, file = 'server-status.json'): Promise<boolean> {
    // Un archivo de lease vacío o corrupto equivale a "libre"; no debe impedir iniciar.
    // Pero si el archivo existe, hay que conservar su `sha` para poder reemplazarlo:
    // GitHub rechaza un PUT sin sha cuando la ruta ya existe (aunque esté vacía).
    let item: GitHubFile | null = null;
    try { item = await this.getFile(repo, file); }
    catch (error) { throw new Error(`No se pudo leer ${file} en GitHub: ${errorText(error)}`); }
    let current: Lease | null = null;
    if (item) {
      const text = Buffer.from(item.content, 'base64').toString('utf8').trim();
      if (text) {
        try {
          const parsed: unknown = JSON.parse(text);
          current = isLease(parsed) ? parsed : null;
        } catch { current = null; }
      }
    }
    if (current && !isStale(current)) return false;
    try {
      await this.putJson(repo, file, lease, item?.sha, `Acquire lease for ${lease.hostName}`);
      return true;
    } catch (error) {
      throw new Error(`No se pudo reservar ${file} en GitHub: ${errorText(error)}`);
    }
  }
  async renewLease(repo: RepoRef, sessionId: string, lease: Lease, file = 'server-status.json'): Promise<boolean> {
    const current = await this.getJson<Lease>(repo, file);
    if (!current || current.value.sessionId !== sessionId) return false;
    try { await this.putJson(repo, file, lease, current.sha, 'Renew server lease'); return true; } catch { return false; }
  }
  async releaseLease(repo: RepoRef, sessionId: string, file = 'server-status.json') {
    const current = await this.getJson<Lease>(repo, file);
    if (current?.value.sessionId === sessionId) await this.putJson(repo, file, { ...current.value, heartbeatAt: '1970-01-01T00:00:00.000Z' }, current.sha, 'Release server lease');
  }
}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export const isLease = (value: unknown): value is Lease => {
  if (!value || typeof value !== 'object') return false;
  const lease = value as Partial<Lease>;
  return typeof lease.sessionId === 'string'
    && typeof lease.hostName === 'string'
    && typeof lease.ip === 'string'
    && typeof lease.port === 'number'
    && typeof lease.heartbeatAt === 'string'
    && !Number.isNaN(Date.parse(lease.heartbeatAt));
};
export const isStale = (lease: Lease) => Date.now() - Date.parse(lease.heartbeatAt) > 3 * 60_000;
