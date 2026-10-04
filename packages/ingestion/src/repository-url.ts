import { ImportFailure } from './errors';
export function parseRepositoryUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ImportFailure(
      'INVALID_REPOSITORY_URL',
      'Enter a GitHub repository URL such as https://github.com/owner/project.',
    );
  }
  const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    parts.length !== 2
  )
    throw new ImportFailure(
      'INVALID_REPOSITORY_URL',
      'Use https://github.com/owner/project without credentials, query parameters or a branch path.',
    );
  const owner = parts[0]!,
    name = parts[1]!.replace(/\.git$/, '');
  if (
    ![owner, name].every(
      (part) =>
        /^[a-zA-Z0-9_.-]{1,100}$/.test(part) && !['.', '..'].includes(part),
    )
  )
    throw new ImportFailure(
      'INVALID_REPOSITORY_URL',
      'The GitHub owner or repository name is invalid.',
    );
  return { owner, name };
}
