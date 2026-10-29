# AGENTS.md

Repo-specific rules for agents working in **Aki Agent Skills**. Apply these on top of the conventions in `README.md`.

## Language

- All repository files are in English: `SKILL.md`, `AGENTS.md`, README, code, comments, examples, commit messages. No mixed languages.
- Chat replies to the user follow the user's language (Spanish by default). The repository stays English regardless.

## Writing style

- Be concrete: flags, numbers, file paths, measured runtimes. No filler, no marketing, no restating the obvious.
- Every number must come from a real run. If something was not measured, say so or leave it out.
- State limitations as facts, not as disclaimers at the end.
- Prefer short tables and bullets over prose paragraphs.

## Structure

- One skill, one folder: `skills/<name>/SKILL.md` + `skills/<name>/scripts/`.
- Skill-specific content never goes into repo-level files (`README.md`, `AGENTS.md`, `LICENSE`). Repo-level files hold rules shared by every skill.
- Every new skill is added to the table in `README.md`.
- `SKILL.md` frontmatter has `name` and `description`; the description states what the skill does **and when to use it**, so the agent can auto-discover it.

## Engineering rules

- **Idempotent bootstrap:** the sandbox can be recreated and lose installed packages. The script installs what it needs on every run and must survive a second run.
- **Persistent paths:** models and intermediate artifacts go to `/workspace/.cache/<tool>`; only throwaway files go to `/tmp`.
- **Dual output:** human-readable text plus a structured JSON version.
- **Honest errors:** surface the underlying tool's error verbatim. Never fabricate output or a success message.
- **Distinguish causes:** "sandbox unavailable" (no container, no output) is not the same as "script failed" (real exit code and stderr). Do not report one as the other.
- **Pin breaking dependencies.** Known example: `av==12.3.0` for `faster-whisper`; `av>=13` fails with `metadata_errors`.
- **Output files are git-ignored** (`.mp3`, `.srt`, `.json`, transcript folders). Never commit generated artifacts.

## Verification before committing

1. Run the skill end-to-end on a real input.
2. Measure and record the runtime.
3. Test the failure path (no subtitles, bad URL) and check the error message is real.
4. Review the full diff for personal data.

## Privacy audit (public repo)

Before every push, grep the tree for: emails, `ghp_`/`gho_`/`AKIA`, IPv4 addresses, `/home/<user>`, absolute local paths, tokens, and real third-party URLs. Replace real video IDs or content with placeholders such as `<VIDEO_ID>`. Never commit transcripts containing personal data.

## Git

- Commit messages in English, imperative, short: `add <skill>`, `fix <thing>`, `docs: <change>`.
- Commit identity: `RealAkiAgent <aki.agent@aki.ar>`.
- Verify the push landed (`git status` against the remote) before reporting it as published.
