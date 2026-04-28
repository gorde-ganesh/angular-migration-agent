# Angular Migration Agent

A full **Angular project health + migration orchestrator** powered by Claude AI. Point it at any Angular project and it audits, plans, and executes a complete version migration — with a self-healing executor/validator loop.

---

## Architecture

```
User Input (Angular project root)
        ↓
 [Audit Agent]                    reads package.json, fetches npm registry,
                                  detects version gaps, flags deprecated APIs
        ↓
 [Docs Fetcher Agent]             fetches changelogs from GitHub (Angular, NgRx,
                                  Material, RxJS), chunks + stores for RAG
        ↓
 [Compatibility Resolver Agent]   cross-checks peer deps, builds constraint graph,
                                  produces safe incremental upgrade order
        ↓
 [Planner Agent]                  queries RAG, creates ordered step-by-step plan
        ↓
 [Executor Agent]  ←── tools: read/write files, run commands, semantic_search
                                  executes each step with full tool use
        ↓
 [Validator Agent]                runs tsc --noEmit, parses errors, returns to
                                  Executor with context (self-healing loop, up to N retries)
        ↓
 migration-report.md              full audit, plan, diff log, manual steps
```

---

## What It Migrates

| Angular Version Gap | Automated Migrations |
|---|---|
| Any → 15+ | `HttpClientModule` → `provideHttpClient()` |
| Any → 15+ | `RouterModule.forRoot()` → `provideRouter()` |
| Any → 17+ | `*ngIf` / `*ngFor` → `@if` / `@for` control flow |
| Any → 17+ | `@Input()` → `input()` signal |
| Any → 17+ | `@Output()` → `output()` signal |
| Any → 19+ | NgModule → Standalone components |
| All | Incremental `npm install` per major version |
| All | TypeScript upgrade before Angular |

---

## Key Gen AI Concepts Demonstrated

| Concept | Where |
|---|---|
| Multi-agent orchestration | 6 specialised agents called in sequence |
| Tool use / function calling | Each agent defines and calls its own tools |
| RAG (retrieval-augmented generation) | Docs Fetcher + semantic_search in Planner/Executor |
| Structured JSON outputs | Every agent returns typed data via output tool |
| Self-healing agentic loop | Executor → Validator → retry with error context |
| Prompt caching | `cache_control: ephemeral` on all system prompts + large doc payloads |
| Dependency graph reasoning | Compatibility Resolver topological sort |

---

## Getting Started

### 1. Install

```bash
git clone <this-repo>
cd angular-migration-agent
npm install
```

### 2. Set API Key

```bash
cp .env.example .env
# edit .env and add your ANTHROPIC_API_KEY
export ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Run

```bash
# Full migration (with changes)
npm run dev -- migrate --project ./fixtures/angular14-sample

# Dry run — audit + plan, no file writes
npm run dev -- migrate --project ./fixtures/angular14-sample --dry-run

# Just audit (fastest, cheapest)
npm run dev -- audit --project ./fixtures/angular14-sample
```

### Build & use as CLI

```bash
npm run build
node dist/cli.js migrate --project /path/to/your/angular-project
```

---

## CLI Reference

```
angular-migrate migrate [options]

Options:
  -p, --project <path>      Angular project root (required)
  -t, --target <version>    Target Angular version (default: latest)
  -d, --dry-run             Plan only — no writes or installs
  -r, --max-retries <n>     Self-healing retries per step (default: 3)
      --skip-docs           Skip changelog fetching (faster)
  -v, --verbose             Show detailed error output
  -o, --output <path>       Custom path for migration-report.md

angular-migrate audit [options]

Options:
  -p, --project <path>      Angular project root (required)
```

---

## Project Structure

```
src/
├── cli.ts                           CLI entry point (Commander.js)
├── orchestrator.ts                  Phase sequencer + self-healing loop
├── types.ts                         Shared TypeScript types
├── agents/
│   ├── audit-agent.ts               Reads package.json, fetches npm registry
│   ├── docs-fetcher-agent.ts        Fetches changelogs, stores in RAG
│   ├── compatibility-resolver-agent.ts  Peer dep graph + safe upgrade order
│   ├── planner-agent.ts             Ordered step plan via RAG queries
│   ├── executor-agent.ts            Reads/writes files, runs commands
│   └── validator-agent.ts           tsc --noEmit, parses errors
├── tools/
│   ├── file-tools.ts                read_file / write_file / list_files
│   ├── npm-registry.ts              fetch_npm_registry (live API)
│   ├── web-fetch.ts                 web_fetch (changelogs, guides)
│   ├── command-runner.ts            run_command (npm, tsc, ng)
│   ├── semver-utils.ts              version comparison + incremental paths
│   └── doc-store.ts                 In-memory RAG: chunk + keyword search
└── reporter/
    └── migration-reporter.ts        Markdown report generator

fixtures/
└── angular14-sample/                Sample Angular 14 project with:
    ├── package.json                   @angular/core 14, NgRx 14, Material 14
    └── src/app/
        ├── app.module.ts              NgModule + RouterModule + HttpClientModule
        ├── app.component.ts           @Input/@Output decorators, ngOnChanges
        ├── app.component.html         *ngIf / *ngFor templates
        ├── users/                     Components using structural directives
        └── store/                     NgRx actions/reducer/effects/selectors
```

---

## Self-Healing Loop Detail

```
Executor runs: npm install @angular/core@17
      ↓
Validator runs: npx tsc --noEmit
      ↓
Fails: TS2345 in app.component.ts:12
      ↓
Validator sends errors back to Executor with file + line context
      ↓
Executor calls semantic_search("TS2345 Angular 17 input signal")
      ↓
Executor reads app.component.ts, patches @Input() → input()
      ↓
Validator runs again → pass → next step
```

---

## Stack

- **Runtime:** Node.js 18+, TypeScript 5.4
- **LLM:** Anthropic Claude (`claude-sonnet-4-6`) via `@anthropic-ai/sdk`
- **CLI:** Commander.js
- **Versioning:** semver
- **RAG:** In-memory keyword search (no external vector DB needed)
