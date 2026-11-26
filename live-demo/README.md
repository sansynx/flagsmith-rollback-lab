# Rollback Rehearsal

An open checkout can outlive the feature flag that selected it. Rollback Rehearsal reproduces the broken order against self-hosted Flagsmith, moves handler retirement behind a drain condition, and verifies the revised order against the same synthetic checkout journey.

## Reproduce locally

Install Node.js 24, Docker with Compose, Make, OpenSSL, and Python 3.

```sh
make demo
```

The command starts local Flagsmith and PostgreSQL, seeds a disposable organisation, and reproduces both paths. It verifies six scenarios. The original checkout returns HTTP 410 and the revised checkout returns HTTP 201. Both paths must assign a fresh visitor to control and end with the same flag and handler state. The command saves observed evidence to `.runtime/evidence.json` and exits nonzero when an assertion fails.

```sh
make web
```

Open `http://127.0.0.1:4197`. Pick a scenario, turn its Flagsmith switch on to capture an open session, then turn it off to rehearse the rollback. Compare the two plans under Run evidence and download the result. The site needs no login. Each active browser receives an isolated Flagsmith sandbox. The website talks only to the local demo API. Keep one runner per sandbox so two replays can't change the same flag independently.

## Stack

React, TypeScript, Vite, Tailwind CSS, shadcn/ui Dashboard-01, Tabler Icons, Recharts, Node.js and Express, and self-hosted Flagsmith with PostgreSQL in Docker Compose. The bounded planner derives a drain condition from a failed replay. The experiment uses a real Flagsmith flag and a synthetic checkout API. There are no real payments.

Design reference: [Tessory Dashboard 10](https://tessory.pages.dev/components/shadcnblocks--dashboard10). Source template: [official shadcn/ui Dashboard-01](https://ui.shadcn.com/blocks/dashboard-01).

The browser walkthrough and API contract are available at [/demo.md](public/demo.md).

The treatment switch uses the orange and violet pixel artwork from the [WeMakeDevs Toggle Wars event](https://www.wemakedevs.org/hackathons/flagsmith). Its checked state comes from the sandbox response.
