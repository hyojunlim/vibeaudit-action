# VibeAudit Scan · GitHub Action

Pre-launch security and bug scan for apps built with AI coding tools. On every pull request it posts a launch-readiness score and the top findings (missing auth, leaked keys, billing bugs, IDOR, unbounded AI endpoints…), with a link to the full report and a paste-ready fix prompt per finding.

```yaml
# .github/workflows/vibeaudit.yml
name: VibeAudit
on:
  pull_request:
jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      id-token: write        # proves to vibeaudit.sh which repo is calling (no API key needed)
      pull-requests: write   # to post the summary comment
    steps:
      - uses: hyojunlim/vibeaudit-action@v1
```

That's the whole setup. No account, no token, no secrets.

## What you get

- A comment on the PR (updated in place on every push) with the score, readiness verdict and top 5 findings.
- The same summary in the job summary.
- Outputs `score` and `report-url` for other steps.

```yaml
      - uses: hyojunlim/vibeaudit-action@v1
        with:
          fail-below: 70     # optional: fail the job if the score is below 70
          comment: "true"    # default; set "false" to only write the job summary
```

## How it works

The whole action is one dependency-free file, [`src/index.js`](src/index.js) — read it before you trust it.

The action requests the workflow's OIDC token from GitHub and sends it to `vibeaudit.sh`, which verifies it against GitHub's public keys and reads the `repository` claim. The service then downloads the public repository tarball, selects the highest-risk files, and runs a Claude quick scan. Nothing is cloned to the runner and nothing from your repo is stored beyond the report.

Limits: public repositories only; one free quick scan per repository per day (further runs that day reuse the report). The full deep audit of the whole codebase, with a fix prompt for every finding, is available from the report page.

## Privacy

Only the repository name leaves the runner (inside a token GitHub signed for this purpose). Source is fetched from GitHub by the service, not uploaded by the action. See [vibeaudit.sh/privacy](https://vibeaudit.sh/privacy).

## License

MIT
