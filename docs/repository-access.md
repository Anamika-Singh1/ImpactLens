# Add your repository through the frontend

Open **Repositories** as a workspace Owner or Engineer, click **Add Repository**, and enter `https://github.com/owner/project`. Leave **Branch** empty to use GitHub's default branch, or select a branch by name. Click **Analyze Repository**. Public repositories work without a GitHub connection or provider credentials.

The application resolves the branch to an exact commit, creates or reuses the repository, queues the existing background worker, and opens its details page. The displayed stages come from actual processing: Queued → Fetching repository → Scanning files → Analyzing code → Preparing overview → Completed. Repeated submissions of the same commit reuse its job. Failed imports offer **Retry analysis**; cancellation and import history are also available under **GitHub access, sample imports and import history**.

Use **Overview** for metadata, detected technologies, counts, directories, an understandable summary and limitations; **Structure** for searchable files and read-only source; **Dependencies** for manifest declarations and available npm lockfile resolutions; **API Routes** for supported direct Express registrations; and **Features** for evidence-backed suggestions and the existing confirm/edit/reject/manual mapping workflow. Generated output, dependencies, binaries and likely secrets are excluded. Overview generation does not require a pull request, another commit, a coverage upload or manual mappings. **Analyze Changes** remains the separate comparison workflow.

**Find a feature or implementation…** searches retained paths, symbols, routes, source text and currently resolved confirmed mappings. Results contain source lines, excerpts, reasons and an **Open file** link. Inferences are candidates, never verified behavior. Basic search requires no AI. An empty result explains that no reliable candidate was found in the retained index.

For private repositories, use **Connect GitHub** in the expanded access panel or Settings. A workspace Owner opens **Choose repository access on GitHub**, installs the configured ImpactLens App for selected repositories, returns to ImpactLens and clicks **Refresh available accounts**. Select the account and click **Link GitHub account**. You can then use the URL form or choose a **Linked GitHub account**, **GitHub repository** and **Branch** and click **Import repository snapshot**. Never put credentials in repository URLs.

Owners manage workspace installation links. Engineers can authorize their own GitHub account and import repositories from linked installations, subject to their actual GitHub access. Viewers can open completed imports but cannot authorize, link or import. Existing **Settings → Members** controls let an Owner add an already registered teammate as Viewer or Engineer.

## One-time server configuration

The authenticated GitHub integration is disabled by default. Public URL analysis and **Import sample repository** remain available to Owners/Engineers without provider credentials. Metadata registration alone does not fetch code.

An administrator must register a GitHub App and supply its credentials before private imports work. See GitHub's [App registration guide](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app) and [repository archive permission requirements](https://docs.github.com/en/rest/repos/contents#download-a-repository-archive-tar) (checked 2026-10-01).

Use Contents read permission and the automatically required Metadata permission. This integration uses its own **Connect GitHub** authorization flow: leave **Request user authorization during installation** disabled. Webhooks are unused. Configure the callback to match `GITHUB_CALLBACK_URL`, locally `http://localhost:5173/api/github/callback`; production must use the actual HTTPS origin. Allow installation on any account if other users need to install the App.

Set `GITHUB_ENABLED=true`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY_BASE64`, `GITHUB_CALLBACK_URL` and `CREDENTIAL_ENCRYPTION_KEY` in the API's server environment. The worker needs GitHub enabled, the App ID/private key and the same encryption key. See [environment reference](environment.md). Keep credentials in server configuration; users grant access on GitHub without pasting tokens into the frontend. Restart API and worker after changing configuration.

The worker must run for imports to complete (`npm run dev` includes it). Real GitHub authorization requires a configured App and explicit user consent on GitHub; local verification does not provision an App.

## Verification

`npx playwright test tests/e2e/repository-access.spec.ts` exercises authorized account linking, pagination, expired-access recovery, selected branch payloads, progress polling, cancellation/retry and Viewer restrictions using mocked provider responses. A separate case imports the owned sample through the actual database/queue/worker and opens its source. It starts a temporary worker only when the local worker is unavailable. Real GitHub OAuth is not claimed as verified without App credentials.
