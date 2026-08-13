# Teaching Matrix — GitHub-backed curriculum matrix

All matrix data lives as **CSV files in this repository** (`data/`). Every change goes
through a **pull request**, so the full history, discussion, and approval trail lives in
GitHub. Two zero-install web apps (plain HTML, no server, no build step) ride along in the
repo and are served by GitHub Pages:

| App | File | Who | What it does |
|---|---|---|---|
| **Editor** | `index.html` | contributors | view the matrix, edit cells (click to cycle blank → I → D → E), add courses/topics, submit changes as a PR, track your requests |
| **Maintainer console** | `maintain.html` | maintainers | review the PR queue with **cell-level matrix diffs**, approve / request changes / merge / close, compare any two versions, browse history |

Data files:

- `data/matrix.csv` — coarse matrix (114 topics × courses). Columns: `Category, Topic, <course…>`
- `data/granular.csv` — granular matrix (277 sub-topics). Columns: `Category, ID, Sub-topic, <course…>`

Cell values: blank (not covered) · `I` introduced · `D` developed · `E` emphasized.
A GitHub Action (`.github/workflows/validate-csv.yml`) validates every PR: rectangular CSV,
unique columns and topic keys, and only legal cell values.

---

## One-time setup (maintainer, ~5 minutes)

1. **Create the repository and push** (from this directory):

   ```bash
   git init -b main
   git add -A
   git commit -m "Teaching matrix system"
   gh repo create TeachingMatrix --public --source . --push   # or --private
   ```

   > A **public** repo lets anyone view the matrix without signing in; contributors still
   > need to be collaborators to submit changes. A **private** repo requires sign-in for
   > everything.

2. **Enable GitHub Pages**: repo → Settings → Pages → Source: *Deploy from a branch* →
   Branch: `main`, folder `/ (root)` → Save. After a minute the apps are live at:

   - `https://<owner>.github.io/TeachingMatrix/` — editor
   - `https://<owner>.github.io/TeachingMatrix/maintain.html` — maintainer console

   (The apps auto-detect the owner/repo from the Pages URL; `config.json` is the fallback —
   edit it if you host elsewhere.)

3. **Protect `main`** (this is what forces the merge-request workflow):
   Settings → Branches → Add branch ruleset → target `main` → enable
   *Require a pull request before merging* (+ *Require status checks: Validate matrix CSVs*).

4. **Add contributors**: Settings → Collaborators → add faculty with **Write** access.
   (Write access + branch protection = they can open PRs but not push to `main`.)

## Contributor workflow

1. Open the Pages URL, paste your GitHub token, **Sign in** (one time — the token is kept in
   your browser's localStorage and sent only to `api.github.com`).
   - Token: GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new;
     Repository access: *Only select repositories* → this repo;
     Permissions: **Contents: Read and write**, **Pull requests: Read and write**.
2. Pick a matrix (coarse/granular), then:
   - **click a cell** to cycle blank → I → D → E,
   - **＋ Add course** for a new column,
   - **＋ Add topic** for a new row (asks for the category and key fields).
3. The pending-changes panel lists every edit (with per-edit revert). Click
   **Submit as Pull Request** — the app creates a branch (`matrix-edit/<you>-<id>`), commits
   the updated CSV, and opens a PR whose description contains a readable change table.
4. Track it under **My Requests** (open / approved / changes requested / merged), or in
   GitHub's normal PR UI — they're the same thing.

## Maintainer workflow

Open `maintain.html`, sign in with a token that has maintainer rights:

- **Request queue** — every open change request with a *matrix-level* diff (only the changed
  rows/columns, old → new per cell). Approve, request changes (with a comment), merge, or
  close, without leaving the page.
- **Compare versions** — render the cell diff between any two refs (branches, tags, commit
  SHAs) of either matrix.
- **History** — the commit log of each CSV; one click loads any commit into Compare.

Versions are just git: tag releases (`git tag draft-4 && git push --tags`) and compare tags
in the console. Nothing is ever lost — every merged PR is a commit.

## Notes & limits

- Concurrent PRs editing **different rows** merge cleanly (CSV is line-per-topic). Two PRs
  touching the **same row** will conflict on the second merge — GitHub flags it; the second
  author re-submits from the updated matrix (a few clicks).
- The editor targets collaborators (write access). Outside contributors would need the
  fork flow, which the app doesn't automate — add people as collaborators instead.
- Everything is vanilla HTML/JS — no dependencies, no build, nothing to install; the pages
  talk only to `api.github.com`.
- `TeachingMatrix.prompt.md` records the original design brief for this system.

## Updating the data from the curriculum-review pipeline

The seed CSVs came from the Draft-4 teaching-matrix review (`Teaching_Matrix_Draft.csv` /
`Teaching_Matrix_Granular.csv`). To re-import a new draft wholesale, replace the files in
`data/` on a branch and open a PR — the maintainer console will show the full cell diff.
