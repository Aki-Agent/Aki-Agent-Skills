# Aki Agent Skills

> [!WARNING]
> **100% AI-GENERATED REPOSITORY.** Every file here — skills, scripts, documentation and commit history — is created and maintained by AI agents, not by humans. Code may be wrong, incomplete or untested in your environment. Review it before running it and validate every output yourself.
>
> Maintained by AI agents. Human supervision is limited to reviewing and approving what gets published.

Reusable skills for [Aki Agent](https://aki.ar). A skill is a self-contained folder an agent loads to perform a specific task reproducibly.

## Available skills

| Skill | What it does | Status |
|---|---|---|
| [youtube-transcriber](skills/youtube-transcriber/) | Downloads a YouTube video's audio and outputs a transcript with timestamps: `.txt`, `.md`, `.json`, `.srt` | stable |

## Repository layout

```
.
├── README.md
├── AGENTS.md
├── LICENSE
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md        # frontmatter (name, description) + instructions
│       └── scripts/        # code the skill runs
└── .gitignore
```

## Using a skill

1. Copy or clone the skill folder into your agent's skills directory.
2. The agent discovers it through `name` / `description` in the `SKILL.md` frontmatter.
3. Dependencies install inside the script itself (idempotent bootstrap); no manual setup required.

To run it by hand, follow the **Quick test** section in the skill's `SKILL.md`.

## Adding a skill

1. Create `skills/<name>/SKILL.md` with frontmatter:

   ```yaml
   ---
   name: skill-name
   description: What it does and when to use it, in one or two sentences.
   ---
   ```

2. Put the code in `skills/<name>/scripts/`; the script must resolve its own dependencies.
3. Document usage, flags, measured runtimes, and real limitations (no invented estimates).
4. Add the skill to the table above.
5. Verify an end-to-end run before committing.

### Conventions

- **English only:** every file in this repository is written in English — `SKILL.md`, `AGENTS.md`, code, comments, examples and commit messages. Skills follow the user's language at runtime, but their source never mixes languages.
- **One skill, one folder:** everything a skill needs lives inside `skills/<name>/`. Repo-level files hold shared rules only; anything skill-specific stays in that skill's `SKILL.md`.
- **Idempotent:** the environment can be recreated and lose installed packages. A script must run twice without breaking.
- **Persistent paths:** cache models and intermediate artifacts in a persistent directory, not `/tmp`.
- **Honest errors:** surface the real error from the underlying tool; never invent output.
- **No sensitive data:** no credentials, tokens, personal data, or usernames in paths, code, or examples.
- **Dual output:** plain text plus a structured (JSON) version for downstream steps.

## Privacy

This repository is public. Examples use placeholders such as `<VIDEO_ID>`, never real third-party content. Review your diff before pushing: no private video IDs, credentials, personal paths, or transcripts containing personal data.

## License

MIT — see [LICENSE](LICENSE).
