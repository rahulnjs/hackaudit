# Hackaudit — Participant setup

Before you start coding, set up Hackaudit once in **each codebase** your team will submit.

**Prerequisite:** Node.js 18 or later, with `npx` available.

## 1. Initialize each codebase

From the root of each codebase, run:

```sh
npx hackaudit init team-nova
```

Replace `team-nova` with your registered team name. Use the same name across your team's codebases.

## 2. Give your coding agent the project rules

Open the generated `.hack/agent-rules.md` and add its contents to your coding agent's project instructions before the first AI-assisted edit. If you use more than one agent on the codebase, give each agent the same rules.

Tell your agent to use `npx hackaudit log` to record each file it edits. It should use the same UTC timestamp in the source header and the log entry. The command updates both `.hack/audit.log` and `.hack/usage.jsonl`. If token counts are unavailable, the agent should omit them.

## 3. Include the audit files in your submission

Keep the generated `.hack/` directory in each codebase throughout the event. Include it when you submit the codebase, including if you submit a ZIP. Git commits are optional for this setup.
