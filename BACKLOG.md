# Backlog

## Skill-driven audit and leaderboard

Status: proposed; awaiting workflow decisions. No implementation requested yet.

### Proposed commands

```text
/hackaudit audit <codebase-directory> --statement <problem-statement.md> --out <target-directory>
/hackaudit leaderboard <target-directory>
```

### Audit workflow

- Use the existing coding agent to review the codebase, root `hackathon.json`, and `.hack/` evidence.
- Verify logs and assess the submission against the organizer's statement and fixed rubric.
- Produce evidence-backed scores, findings, limitations, and judge questions.
- Generate consistent JSON and HTML from the shared report template in a submission-specific folder under the target directory.
- Treat `hackathon.json` as the canonical participant manifest throughout the workflow.

### Leaderboard workflow

- Discover recognized audit-report JSON files recursively in the target directory.
- Select the latest valid assessment per submission, avoiding duplicate or superseded reports.
- Compare existing assessments without rescoring codebases.
- Generate aggregate JSON and HTML; the leaderboard template is still to be decided.
- Keep submissions awaiting demo/Q&A scores, review resolution, or sign-off provisional.
- Flag incompatible rubrics and assessed denominators before ranking.

### Open decisions

- Does a target directory represent one problem statement or several?
- If several, should rankings stay separate by problem, or can organizers explicitly enable a shared ranking?
- What is the leaderboard's shared UI and data template?

Suggested output layout, pending approval:

```text
results/
  team-nova-project-a/
    report.json
    report.html
  team-orbit-project-b/
    report.json
    report.html
  leaderboard.json
  leaderboard.html
```
