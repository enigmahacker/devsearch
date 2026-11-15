# Contributing to DevSearch

Thanks for helping. Bug reports, fixes, new connectors and docs improvements are all welcome.

By taking part, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Report a bug or ask for a feature

Open an [issue](https://github.com/enigmahacker/devsearch/issues) with:

- what you ran (`ds`, a search, a question) and what you expected
- what happened instead, with any error from the terminal or browser console
- your OS, Node version (`node -v`), and DevSearch version (`npm ls -g @aryptn/devsearch`)

Never paste API keys or `.env` contents into an issue.

## Report a security problem

Don't open a public issue. Report it privately through the repository's [Security tab](https://github.com/enigmahacker/devsearch/security) ("Report a vulnerability"), with the steps to reproduce it. You'll get an answer before any details are made public.

## Set up for development

You need Node.js 20.12+, Docker and [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/enigmahacker/devsearch.git
cd devsearch
node bin/devsearch.mjs .     # starts the stores, API and web app from your checkout
```

Or run each part by hand, as described in the README under "Develop from source".

| Folder | What lives there |
|---|---|
| `bin/` | The `ds` command |
| `api/` | FastAPI service: search, answers, models, rate limits |
| `workers/` | Crawlers (docs, GitHub, Stack Overflow), chunking, embedding, indexing |
| `web/` | Next.js app: search page, answer panel, settings, setup popup |

## Before you open a pull request

Run the checks and make sure they pass:

```bash
uv run pytest                          # API and worker tests
npm --prefix web run lint
(cd web && npx tsc --noEmit)           # type check
```

Then:

1. Branch from `main` and keep each pull request to one change.
2. Add or update tests when you change behavior. Python tests live in `api/tests` and `workers/tests`.
3. Write commit messages in [Conventional Commits](https://www.conventionalcommits.org) style, as the history does: `fix: ...`, `feat: ...`, `docs: ...`.
4. Update the README if you change commands, settings or setup steps.
5. Describe what changed and how you tested it in the pull request.

## Guidelines

- **Keep it local.** DevSearch runs on the user's machine. Don't add telemetry, hosted services or calls to new third-party endpoints without discussing it in an issue first.
- **Protect keys.** Provider keys stay in the browser and are sent only with each question. Never log, store or echo them, including in error messages.
- **Treat crawled content as untrusted.** It's shown to users and sent to models, so escape it, and only link to `http(s)` URLs.
- **Respect sources.** Connectors must honor `robots.txt`, crawl delays and the source's license.
- **Keep dependencies few.** Explain any new dependency in the pull request.

## Releasing (maintainers)

1. Bump `version` in `package.json` and commit.
2. `npm publish --access public` (approve the sign-in in your browser).
3. `gh release create v<version> --generate-notes`. The **GitHub Packages** workflow then mirrors that version to GitHub Packages.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
