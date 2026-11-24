# Hackaudit — organizer review

Requires Node.js 18 or later. Participants initialize their own repositories with the separate `hackbase` package and submit their code together with `.hack/`.

## Verify a submission

Clone the submission or extract its ZIP. From its root, run trusted organizer-installed tooling:

```sh
node /path/to/trusted/hackaudit/bin/hackaudit.js audit --html --out /path/to/organizer/reports
```

Use an absolute trusted CLI path when working inside a submission so participant-local executables cannot shadow organizer tooling. This reads the evidence and writes forensic JSON/HTML. It never runs the participant's logging runtime or application. Git is optional. A clean integrity result is not a hackathon score or proof of complete logging. Missing organizer toolkit files in a participant repository are not violations.

## Score with an existing coding agent

Give the organizer's agent the submission, problem statement and trusted `src/toolkit/auditor/SKILL.md` from this repository. The skill performs the requirements/code review, assigns evidence-backed scores and creates a separate sealed assessed report. The CLI does not launch a model or choose scores. Live Demo and Q&A remains judge-owned.

```sh
npx hackaudit render /path/to/assessed.json --out /path/to/organizer/assessed-reports
```

The shared report template and contract are under `src/toolkit/report/`. Token summaries are available with `npx hackaudit usage --report` from a submission root.

## Build the leaderboard

Ask the organizer's existing agent to follow trusted `src/toolkit/leaderboard/SKILL.md` over the event's assessed reports. It verifies report links and evidence, separates pending/review/quarantined submissions, then produces leaderboard HTML and CSV. Only finalized, signed-off assessments enter the final ranking.

Organizer skills, rubric, manifest schema and report templates stay in this package. Do not install or execute a participant-provided copy of organizer tooling.
