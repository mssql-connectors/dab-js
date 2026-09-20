# Repository setup

The workflows are committed to the repository, but maintainers must connect the
external services and configure repository permissions before every job can
succeed.

## Required checks

After the first workflow run, add these checks to the `main` branch protection
rule:

- `Unit and package`
- `DAB integration`

Both run for pull requests and for pushes to `main`. The JavaScript integration
job starts SQL Server 2022 and DAB 2.0.12 in disposable containers, creates its
own sample database, runs the SDK against DAB's REST endpoint, and removes the
containers. It does not need a persistent database or database secret. Add
language-specific checks to the same workflow when the Rust crate is created.

## Codecov

1. Install or authorize the Codecov GitHub App for
   `mssql-connectors/dab-js`.
2. Add the repository in Codecov.
3. Copy its repository upload token.
4. Add a GitHub Actions repository secret named `CODECOV_TOKEN`.
5. Keep `codecov.yml` at the repository root. It requires 80% patch coverage
   and allows the overall project coverage to fall by at most one percentage
   point.
6. Optionally make the resulting Codecov project and patch checks required in
   the `main` branch protection rule.

The repository is public, so Codecov can support tokenless uploads in some
cases. The explicit token is still configured for reliable uploads from the
main repository. GitHub does not pass repository secrets to untrusted fork
workflows; Codecov handles public fork pull requests through its fork flow. The
upload step is skipped until `CODECOV_TOKEN` exists, while tests and local
coverage thresholds continue to run.

## Release Please

Release Please reads `release-please-config.json` and
`.release-please-manifest.json`. It opens or updates a release pull request when
Conventional Commits reach `main`. Merging that release pull request creates a
GitHub release and tag, then the same workflow publishes the package to npm.
The JavaScript SDK is tracked at `sdks/javascript` and uses tags such as
`javascript-v0.2.0`. Add the Rust package to both files when its `Cargo.toml`
exists; keeping it out until then avoids empty or invalid crate releases.

Create a fine-grained personal access token or GitHub App token with access to
this repository and these permissions:

- Contents: read and write
- Pull requests: read and write
- Issues: read and write

Add it as a GitHub Actions repository secret named
`RELEASE_PLEASE_TOKEN`. Configure the token's resource owner as the
`mssql-connectors` organization and restrict repository access to `dab-js`.
A token other than the workflow's default
`GITHUB_TOKEN` is deliberate: pull requests and tags created with the default
token do not trigger normal GitHub Actions workflows.

If organization policy uses SAML SSO, authorize the token for the organization.
If Release Please uses the default `GITHUB_TOKEN` instead, enable **Settings >
Actions > General > Workflow permissions > Allow GitHub Actions to create and
approve pull requests**. That setting is not required when the configured token
itself creates the pull request.

Use Conventional Commit subjects for merged changes:

```text
feat: add OpenAPI entity discovery
fix: encode composite key values
docs: explain cursor pagination
```

`feat` produces a minor release, `fix` produces a patch release, and a
`BREAKING CHANGE` footer produces the appropriate major release.

## npm publishing

The package is configured as the public scoped package
`@azure/data-api-builder-js`. Before the first release:

1. Confirm that the package name and the `@azure` npm scope are available to
   this repository's maintainers.
2. Choose the package license and add the matching `license` field and license
   file. This repository intentionally does not guess an organizational legal
   choice.
3. Create a granular npm access token that can publish packages in the
   `@azure` scope. Limit it to this package when npm permits package-level
   selection, enable read and write package permissions, and set an expiration
   that matches the organization's rotation policy.
4. Add it as a GitHub Actions repository secret named `NPM_TOKEN`.
5. Merge a Conventional Commit and then merge the Release Please release pull
   request.

After the first npm publication, trusted publishing is preferred over the
long-lived token:

1. In the package settings on npmjs.com, add a GitHub Actions trusted publisher.
2. Set organization or user to the repository owner, repository to `dab-js`,
   and workflow filename to `release-please.yml`.
3. Remove `NODE_AUTH_TOKEN` from the publish step and delete `NPM_TOKEN`. The
   workflow already grants the `id-token: write` permission trusted publishing
   requires.
4. Optionally configure npm publishing access to require two-factor
   authentication and disallow traditional tokens.

The package metadata includes the repository URL and public access setting.
`npm run check:package`, run from `sdks/javascript`, builds the package and
displays the exact tarball contents without publishing it.

## GitHub repository settings

The workflows request only the permissions they need. The repository currently
uses read-only default workflow permissions, which is compatible with the
explicit workflow permissions in this repository.

Recommended additional settings:

- Require pull requests and the two CI checks before merging to `main`.
- Require the branch to be up to date before merging.
- Enable secret scanning and push protection.
- Restrict release and npm environment access to maintainers if a GitHub
  `release` environment is added later.
