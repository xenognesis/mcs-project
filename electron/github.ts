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
    return { value: JSON.parse(Buffer.from(item.content, 'base64').toString('utf8')) as T, sha: item.sha };
  }
  async putJson(repo: RepoRef, file: string, value: unknown, sha?: string, message = `Update ${file}`) {
    const response = await fetch(this.url(repo, file), { method: 'PUT', headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content: Buffer.from(JSON.stringify(value, null, 2)).toString('base64'), sha, branch: repo.branch ?? 'main' }) });
    if (!response.ok) throw new Error(`GitHub: ${response.status} al actualizar ${file}`);
  }
  async acquireLease(repo: RepoRef, lease: Lease): Promise<boolean> {
    const current = await this.getJson<Lease>(repo, 'server-status.json');
    if (current && !isStale(current.value)) return false;
    try { await this.putJson(repo, 'server-status.json', lease, current?.sha, `Acquire lease for ${lease.hostName}`); return true; } catch { return false; }
  }
  async renewLease(repo: RepoRef, sessionId: string, lease: Lease): Promise<boolean> {
    const current = await this.getJson<Lease>(repo, 'server-status.json');
    if (!current || current.value.sessionId !== sessionId) return false;
    try { await this.putJson(repo, 'server-status.json', lease, current.sha, 'Renew server lease'); return true; } catch { return false; }
  }
  async releaseLease(repo: RepoRef, sessionId: string) {
    const current = await this.getJson<Lease>(repo, 'server-status.json');
    if (current?.value.sessionId === sessionId) await this.putJson(repo, 'server-status.json', { ...current.value, heartbeatAt: '1970-01-01T00:00:00.000Z' }, current.sha, 'Release server lease');
  }
}
export const isStale = (lease: Lease) => Date.now() - Date.parse(lease.heartbeatAt) > 3 * 60_000;
