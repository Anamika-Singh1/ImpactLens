import { describe, it, expect } from 'vitest';
import { parseRepositoryUrl } from './repository-url';
import { GitHubClient } from './github';
describe('public GitHub imports', () => {
  it('accepts repository URLs and rejects credentials, extra paths and non-GitHub destinations', () => {
    expect(parseRepositoryUrl('https://github.com/team/shop.git/')).toEqual({
      owner: 'team',
      name: 'shop',
    });
    for (const input of [
      'not a url',
      'http://github.com/team/shop',
      'https://user:secret@github.com/team/shop',
      'https://example.com/team/shop',
      'https://github.com/team/shop/tree/main',
      'https://github.com/team/shop?token=secret',
      'https://github.com/team/shop#readme',
    ])
      expect(() => parseRepositoryUrl(input)).toThrow();
  });
  it('uses anonymous GitHub metadata and pinned codeload URLs without authorization headers', async () => {
    const requests: { url: string; authorization: unknown }[] = [];
    const transport = async (url: URL | RequestInfo, options?: RequestInit) => {
      requests.push({
        url: String(url),
        authorization: (options?.headers as Record<string, string>)
          ?.Authorization,
      });
      if (String(url).includes('api.github.com'))
        return new Response(
          JSON.stringify({
            id: 12,
            name: 'shop',
            owner: { login: 'team' },
            private: false,
            disabled: false,
            default_branch: 'main',
          }),
          { status: 200 },
        );
      return new Response('archive', { status: 200 });
    };
    const github = new GitHubClient(
      { GITHUB_APP_ID: '', GITHUB_PRIVATE_KEY_BASE64: '' },
      transport as typeof fetch,
    );
    const repo = await github.publicRepository('team', 'shop');
    await github.downloadPublic(
      repo,
      'a'.repeat(40),
      AbortSignal.timeout(1000),
    );
    expect(requests.map((item) => item.authorization)).toEqual([
      undefined,
      undefined,
    ]);
    expect(requests[1]?.url).toBe(
      `https://codeload.github.com/team/shop/tar.gz/${'a'.repeat(40)}`,
    );
  });
  it('refuses private metadata in anonymous imports and explains empty repositories', async () => {
    const github = new GitHubClient(
      { GITHUB_APP_ID: '', GITHUB_PRIVATE_KEY_BASE64: '' },
      (async () =>
        new Response(JSON.stringify({ private: true }), {
          status: 200,
        })) as typeof fetch,
    );
    await expect(github.publicRepository('team', 'shop')).rejects.toMatchObject(
      { code: 'ACCESS_UNAVAILABLE' },
    );
    const empty = new GitHubClient(
      { GITHUB_APP_ID: '', GITHUB_PRIVATE_KEY_BASE64: '' },
      (async () => new Response('{}', { status: 409 })) as typeof fetch,
    );
    await expect(empty.publicRepository('team', 'shop')).rejects.toMatchObject({
      code: 'EMPTY_REPOSITORY',
    });
  });
});
