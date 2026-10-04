import { ImportFailure } from './errors';
import { LIMITS } from './archive';
import { appJwt } from './crypto';
export type GitHubConfig = {
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY_BASE64: string;
};
export type GitHubRepository = {
  description?: string | null;
  private?: boolean;
  size?: number;
  id: number;
  name: string;
  owner: { login: string };
  default_branch: string;
  archived: boolean;
  disabled: boolean;
};
export type Installation = {
  id: number;
  app_id: number;
  account: { login: string };
  suspended_at: string | null;
};
export function githubError(response: Response): ImportFailure {
  if (response.status === 409)
    return new ImportFailure(
      'EMPTY_REPOSITORY',
      'This repository is empty or has no commits to analyze. Push source code first.',
    );
  if (response.status === 401)
    return new ImportFailure(
      'AUTH_EXPIRED',
      'GitHub authorization expired or was revoked. Reconnect GitHub in Settings.',
    );
  const rate =
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' ||
        response.headers.has('retry-after')));
  if (rate) {
    const seconds = Number(response.headers.get('retry-after'));
    const reset =
      Number(response.headers.get('x-ratelimit-reset')) * 1000 - Date.now();
    return new ImportFailure(
      'RATE_LIMITED',
      'GitHub rate limit reached. Wait before retrying.',
      true,
      Math.max(
        1000,
        Math.min(
          3600000,
          seconds > 0 ? seconds * 1000 : reset > 0 ? reset : 60000,
        ),
      ),
    );
  }
  if ([403, 404, 410].includes(response.status))
    return new ImportFailure(
      'ACCESS_UNAVAILABLE',
      'Repository or installation is unavailable. Check your GitHub access and the App installation repository selection.',
    );
  if (response.status >= 500)
    return new ImportFailure(
      'GITHUB_UNAVAILABLE',
      'GitHub is temporarily unavailable. Retry shortly.',
      true,
    );
  return new ImportFailure(
    'GITHUB_REQUEST',
    'GitHub rejected the request. Check the selected repository, branch and App configuration.',
  );
}
async function bytes(response: Response, limit: number, signal: AbortSignal) {
  if (Number(response.headers.get('content-length') ?? 0) > limit) {
    await response.body?.cancel();
    throw new ImportFailure(
      'DOWNLOAD_LIMIT',
      'GitHub response exceeds the download limit. Select a smaller repository.',
    );
  }
  if (!response.body)
    throw new ImportFailure(
      'GITHUB_RESPONSE',
      'GitHub returned an empty response.',
    );
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let count = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      count += value.length;
      if (count > limit)
        throw new ImportFailure(
          'DOWNLOAD_LIMIT',
          'GitHub response exceeds the download limit. Select a smaller repository.',
        );
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export class GitHubClient {
  constructor(
    private readonly config: GitHubConfig,
    private readonly transport: typeof fetch = fetch,
  ) {}
  private async request(
    url: URL,
    token: string | undefined,
    method = 'GET',
    body?: object,
    signal?: AbortSignal,
  ) {
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      !['api.github.com', 'github.com', 'codeload.github.com'].includes(
        url.hostname,
      )
    )
      throw new ImportFailure(
        'UNSAFE_URL',
        'GitHub returned an unsupported download destination.',
      );
    try {
      return await this.transport(url, {
        method,
        redirect: 'manual',
        signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ImpactLens',
          'X-GitHub-Api-Version': '2026-03-10',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ImportFailure(
        'NETWORK_ERROR',
        'GitHub connection timed out or failed. Retry shortly.',
        true,
      );
    }
  }
  async json<T>(
    path: string,
    token: string,
    method = 'GET',
    body?: object,
    outerSignal?: AbortSignal,
  ): Promise<T> {
    if (
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('..') ||
      path.includes('\\')
    )
      throw new ImportFailure('UNSAFE_URL', 'Invalid GitHub API path.');
    const signal = AbortSignal.any([
      AbortSignal.timeout(15000),
      ...(outerSignal ? [outerSignal] : []),
    ]);
    const response = await this.request(
      new URL('https://api.github.com' + path),
      token,
      method,
      body,
      signal,
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw githubError(response);
    }
    try {
      return JSON.parse(
        (await bytes(response, 4 * 1024 * 1024, signal)).toString('utf8'),
      ) as T;
    } catch (error) {
      if (error instanceof ImportFailure) throw error;
      throw new ImportFailure(
        'GITHUB_RESPONSE',
        'GitHub returned an invalid response. Retry shortly.',
        true,
      );
    }
  }
  async exchange(
    code: string,
    verifier: string,
    clientId: string,
    clientSecret: string,
    callback: string,
  ) {
    const signal = AbortSignal.timeout(15000);
    const response = await this.request(
      new URL('https://github.com/login/oauth/access_token'),
      undefined,
      'POST',
      {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: callback,
      },
      signal,
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw githubError(response);
    }
    const result = JSON.parse(
      (await bytes(response, 16384, signal)).toString(),
    ) as { access_token?: string; expires_in?: number; error?: string };
    if (!result.access_token || result.error)
      throw new ImportFailure(
        'AUTH_EXPIRED',
        'GitHub authorization was denied or expired. Reconnect GitHub.',
      );
    return {
      token: result.access_token,
      expiresAt: new Date(
        Date.now() + Math.min(result.expires_in ?? 28800, 28800) * 1000,
      ),
    };
  }
  async installations(token: string, page = 1) {
    return this.json<{ installations: Installation[]; total_count: number }>(
      `/user/installations?per_page=100&page=${page}`,
      token,
    );
  }
  async verifyInstallation(token: string, installationId: string) {
    let found: Installation | undefined;
    for (let page = 1; page <= 20; page++) {
      const data = await this.installations(token, page);
      found = data.installations.find((i) => String(i.id) === installationId);
      if (found || data.installations.length < 100) break;
    }
    if (
      !found ||
      String(found.app_id) !== this.config.GITHUB_APP_ID ||
      found.suspended_at
    )
      throw new ImportFailure(
        'ACCESS_UNAVAILABLE',
        'Your GitHub account cannot access this active App installation.',
      );
    const installation = await this.json<Installation>(
      `/app/installations/${installationId}`,
      appJwt(this.config.GITHUB_APP_ID, this.config.GITHUB_PRIVATE_KEY_BASE64),
    );
    if (
      installation.suspended_at ||
      String(installation.app_id) !== this.config.GITHUB_APP_ID
    )
      throw new ImportFailure(
        'ACCESS_UNAVAILABLE',
        'App installation was suspended or revoked.',
      );
    return installation;
  }
  repositories(token: string, installationId: string, page = 1) {
    return this.json<{ repositories: GitHubRepository[]; total_count: number }>(
      `/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
      token,
    );
  }
  async repository(
    token: string,
    installationId: string,
    repositoryId: string,
    signal?: AbortSignal,
  ) {
    for (let page = 1; page <= 100; page++) {
      const data = await this.json<{ repositories: GitHubRepository[] }>(
        `/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
        token,
        'GET',
        undefined,
        signal,
      );
      const repo = data.repositories.find((r) => String(r.id) === repositoryId);
      if (repo) {
        if (
          repo.disabled ||
          !/^[a-zA-Z0-9_.-]+$/.test(repo.owner.login) ||
          !/^[a-zA-Z0-9_.-]+$/.test(repo.name)
        )
          throw new ImportFailure(
            'ACCESS_UNAVAILABLE',
            'Repository is unavailable.',
          );
        return repo;
      }
      if (data.repositories.length < 100) break;
    }
    throw new ImportFailure(
      'ACCESS_UNAVAILABLE',
      'Your GitHub account and the App must both have access to this repository.',
    );
  }
  branches(token: string, repo: GitHubRepository, page = 1) {
    return this.json<{ name: string; commit: { sha: string } }[]>(
      `/repos/${repo.owner.login}/${repo.name}/branches?per_page=100&page=${page}`,
      token,
    );
  }
  async resolve(token: string, repo: GitHubRepository, branch: string) {
    let result: { commit: { sha: string } };
    try {
      result = await this.json<{ commit: { sha: string } }>(
        `/repos/${repo.owner.login}/${repo.name}/branches/${encodeURIComponent(branch)}`,
        token,
      );
    } catch (error) {
      if (error instanceof ImportFailure && error.code === 'ACCESS_UNAVAILABLE')
        throw new ImportFailure(
          repo.size === 0 ? 'EMPTY_REPOSITORY' : 'BRANCH_UNAVAILABLE',
          repo.size === 0
            ? 'The repository has no available commits. Push code first.'
            : 'The selected branch is unavailable. Check its name and your repository access.',
        );
      throw error;
    }
    if (!/^[a-f0-9]{40}$/.test(result.commit.sha))
      throw new ImportFailure(
        'INVALID_SHA',
        'GitHub did not return a full immutable commit SHA.',
      );
    return result.commit.sha;
  }
  async download(
    installationId: string,
    repo: GitHubRepository,
    sha: string,
    signal: AbortSignal,
  ) {
    if (!/^[a-f0-9]{40}$/.test(sha))
      throw new ImportFailure(
        'INVALID_SHA',
        'Import requires a full commit SHA.',
      );
    const access = await this.json<{ token: string }>(
      `/app/installations/${installationId}/access_tokens`,
      appJwt(this.config.GITHUB_APP_ID, this.config.GITHUB_PRIVATE_KEY_BASE64),
      'POST',
      { repository_ids: [repo.id], permissions: { contents: 'read' } },
      signal,
    );
    try {
      const response = await this.request(
        new URL(
          `https://api.github.com/repos/${repo.owner.login}/${repo.name}/tarball/${sha}`,
        ),
        access.token,
        'GET',
        undefined,
        signal,
      );
      if (response.status !== 302) {
        await response.body?.cancel();
        throw githubError(response);
      }
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location)
        throw new ImportFailure(
          'GITHUB_RESPONSE',
          'GitHub did not provide a repository archive.',
        );
      const url = new URL(location);
      const expected = `/${repo.owner.login}/${repo.name}/`;
      if (
        url.hostname !== 'codeload.github.com' ||
        !url.pathname.startsWith(expected) ||
        ![`legacy.tar.gz/${sha}`, `tar.gz/${sha}`].includes(
          url.pathname.slice(expected.length),
        )
      )
        throw new ImportFailure(
          'UNSAFE_URL',
          'GitHub archive redirect was rejected.',
        );
      // Never forward installation credentials to the archive host.
      const archive = await this.request(
        url,
        undefined,
        'GET',
        undefined,
        signal,
      );
      if (!archive.ok) {
        await archive.body?.cancel();
        throw githubError(archive);
      }
      return await bytes(archive, LIMITS.download, signal);
    } finally {
      // Tokens are short-lived and never persisted. Best-effort early revocation.
      const revokeSignal = AbortSignal.timeout(3000);
      await this.request(
        new URL('https://api.github.com/installation/token'),
        access.token,
        'DELETE',
        undefined,
        revokeSignal,
      )
        .then((r) => r.body?.cancel())
        .catch(() => undefined);
    }
  }

  async commit(token: string, repo: GitHubRepository, sha: string) {
    if (!/^[a-f0-9]{40}$/.test(sha))
      throw new ImportFailure(
        'INVALID_SHA',
        'A full 40-character commit SHA is required.',
      );
    const result = await this.json<{ sha: string }>(
      `/repos/${repo.owner.login}/${repo.name}/commits/${sha}`,
      token,
    );
    if (result.sha !== sha)
      throw new ImportFailure(
        'INVALID_SHA',
        'GitHub returned a different commit.',
      );
    return sha;
  }
  async pullComparison(token: string, repo: GitHubRepository, number: number) {
    const prefix = `/repos/${repo.owner.login}/${repo.name}`;
    const pull = await this.json<{
      number: number;
      base: { sha: string; repo: { id: number } };
      head: { sha: string; repo: { id: number } | null };
    }>(`${prefix}/pulls/${number}`, token);
    if (
      pull.number !== number ||
      pull.base.repo.id !== repo.id ||
      !/^[a-f0-9]{40}$/.test(pull.base.sha) ||
      !/^[a-f0-9]{40}$/.test(pull.head.sha)
    )
      throw new ImportFailure(
        'INVALID_SHA',
        'Pull request does not match this repository or has invalid commits.',
      );
    const comparison = await this.json<{ merge_base_commit: { sha: string } }>(
      `${prefix}/compare/${pull.base.sha}...${pull.head.sha}?per_page=1`,
      token,
    );
    const baseSha = comparison.merge_base_commit?.sha;
    if (!baseSha || !/^[a-f0-9]{40}$/.test(baseSha))
      throw new ImportFailure(
        'INVALID_SHA',
        'GitHub did not return an immutable merge base.',
      );
    return {
      baseSha,
      headSha: pull.head.sha,
      pullBaseSha: pull.base.sha,
      headRepositoryId: pull.head.repo ? String(pull.head.repo.id) : 'deleted',
    };
  }
  async publicRepository(owner: string, name: string, signal?: AbortSignal) {
    const repo = await this.json<GitHubRepository>(
      `/repos/${owner}/${name}`,
      '',
      'GET',
      undefined,
      signal,
    );
    if (
      !repo ||
      repo.private !== false ||
      repo.disabled ||
      !Number.isSafeInteger(repo.id) ||
      !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo.owner?.login ?? '') ||
      !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo.name ?? '')
    )
      throw new ImportFailure(
        'ACCESS_UNAVAILABLE',
        'The repository is unavailable or private. Connect GitHub to grant access.',
      );
    return repo;
  }
  async downloadPublic(
    repo: GitHubRepository,
    sha: string,
    signal: AbortSignal,
  ) {
    if (repo.private !== false || !/^[a-f0-9]{40}$/.test(sha))
      throw new ImportFailure(
        'ACCESS_UNAVAILABLE',
        'Public import requires a public repository and an exact commit.',
      );
    const response = await this.request(
      new URL(
        `https://codeload.github.com/${repo.owner.login}/${repo.name}/tar.gz/${sha}`,
      ),
      undefined,
      'GET',
      undefined,
      signal,
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw githubError(response);
    }
    return bytes(response, LIMITS.download, signal);
  }
}
