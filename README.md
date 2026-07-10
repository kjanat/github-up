# github-down

[![NPM Version](https://img.shields.io/npm/v/github-down?logo=npm&labelColor=CB3837&color=black)](https://npm.im/github-down)
[![pkg.pr.new](https://pkg.pr.new/badge/kjanat/github-down)](https://pkg.pr.new/~/kjanat/github-down)

is github down (again) (maybe). booga check, you no doomscroll.

GitHub no work? maybe you. maybe GitHub. booga look two places same time:

- **www.githubstatus.com** - what GitHub admit to.
- **Downdetector** - what everyone else screaming about, usually first.

## or just watch the page

no install, no terminal. page poll itself, you stare:

[https://github-down.kjanat.dev/][site]

or pop it from the cli:

```bash
github-down web
# or
github-down site
```

## get booga

run direct, no install:

```bash
bunx github-down status
# or
npx -y github-down status
```

or keep forever:

```bash
bun install -g github-down
# or
npm install -g github-down
```

<details>
<summary>fresh builds (every commit)</summary>

every push + PR get published to [pkg.pr.new]. bot drop the url in the PR. run
any sha:

```bash
bunx https://pkg.pr.new/kjanat/github-down@<sha> status   # or npx / pnpx
```

</details>

## how use

### words for human

`status` give indicator, lil description, details from both place.

```bash
github-down status
```

### words for robot

json for scripts and little monitoring guys.

```bash
github-down status --json
```

### no words, just number

exit code always tell truth (see [the numbers](#the-numbers)), output or not.
slap `-q`/`--quiet` in CI when you only care about number.

```bash
github-down status -q
```

### pick your place

default check uses GitHub Status and Downdetector. use subcommand or `--source`;
`--source` eat commas and repeats. Downdetector may report unavailable if
Cloudflare challenge automated checks.

```bash
# subcommand
github-down github
github-down downdetector

# flag
github-down status --source github
github-down status -s downdetector

# many
github-down status --source github,downdetector
github-down status -s github -s downdetector
```

### pick your part

only care about one thing? every GitHub component got shorthand flag.
`--component` eat commas and repeats too, same as `--source`.

```bash
# is Actions cooked?
github-down status --actions

# many worry
github-down status --pr --pages
github-down github --component git,api
```

full set: `--actions`, `--api`, `--codespaces`, `--copilot`, `--git`,
`--issue`/`--issues`, `--packages`, `--pages`, `--pr`/`--prs`, `--webhooks`.

filter look at incident + component names, and severity come from what
actually matched: degraded = exit `1`, real outage = exit `2`, nothing
mention your thing = exit `0`. broad incident like "multiple GitHub services"
count for whatever you asked. downdetector no know components; its row pass
through whole.

## use in browser

browser-safe door, GitHub Status only (downdetector need real chromium, no work
in browser).

```typescript
import { checkGitHub } from "github-down/browser";

const result = await checkGitHub();

if (result.kind === "ok") {
  console.log(result.summary.status.description);
  console.log(result.summary.status.indicator);
  console.log(result.summary.incidents);
  console.log(result.summary.components);
} else {
  console.error(result.reason);
}
```

## the numbers

exit code = how bad. set every run (not just `--quiet`), worst source win.

|   Code | Vibe      | what happen                                             |
| -----: | :-------- | :------------------------------------------------------ |
|  **0** | all good  | everything work. go back to your life.                  |
|  **1** | meh       | minor thing, or GitHub got live incident.               |
|  **2** | cooked    | major/critical outage, or downdetector say GitHub down. |
| **21** | who knows | every source booga try was unreachable.                 |

source booga no reach = unknown, NOT down. `21` only when EVERY source dead, so
one flaky downdetector scrape no ruin your day.

## who do all this

booga no write flag parser. booga no write `--help`, tab-complete, json mode,
exit codes. all that [dreamcli]. booga just point at GitHub and shitpost.

you want make own CLI look this clean? -> [dreamcli]

## hack on it

```bash
bun install   # setup
bun run build # build
bun test      # test
```

## license

[MIT][LICENSE] © 2026 Kaj Kowalski

[LICENSE]: https://github.com/kjanat/github-down/blob/master/LICENSE
[dreamcli]: https://github.com/kjanat/dreamcli
[pkg.pr.new]: https://pkg.pr.new
[site]: https://github-down.kjanat.dev
