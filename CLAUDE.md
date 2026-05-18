# Claude Instructions — campaign-app

## Git workflow

### Autonomous (no approval needed)
- Create feature branches (`git checkout -b <branch>`)
- Stage and commit changes — always with a clear message summarising *why*
- Push feature branches to origin (`git push origin <feature-branch>`)
- Create PRs (`gh pr create`) — include summary, test plan, and link to any related task
- Check CI status (`gh run list`, `gh run view`)
- Fix CI failures and push follow-up commits to the same branch

### Always pause and wait for explicit "go ahead"
- **Merging a PR to main** (`gh pr merge`) — main auto-deploys to production
- **Pushing directly to main** — blocked in settings; if ever needed, ask first
- **Force-pushing anything** — blocked in settings; never bypass without discussion

### Communication
- After every commit, state: branch name, commit hash (short), and one-line summary
- After every push, confirm where it went and whether CI was triggered
- When creating a PR, share the URL so Peter can review before approving the merge
- If CI fails, diagnose and fix without asking — then report what was wrong and what changed

## Branch naming
`<type>/<short-description>` — e.g. `fix/campaign-date-filter`, `feat/pagination`, `chore/update-actions`

## Code quality (standing rule)
Every change must pass all four CI jobs: **Lint · Type-check · Unit tests · Build**.  
Never suppress lint errors with disable comments unless there is no correct refactor — always prefer fixing the root cause.

## Deployment
- `main` branch → auto-deploys to production via Vercel/hosting
- Do not merge until CI is green and Peter has approved the PR
