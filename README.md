## Angular Migration Agent — Brainstorm

---

### Core Concept
An agentic CLI tool that accepts an Angular component (or entire module) and autonomously migrates it to a target Angular version, using a plan → execute → validate loop.

---

### Problem It Solves
Angular has had **massive breaking changes** across v14→v19:
- Module-based → Standalone components
- `@Input()` decorators → Signal inputs (`input()`)
- `ngOnChanges` → `effect()`
- `HttpClient` providers → `provideHttpClient()`
- `RouterModule` → `provideRouter()`
- Zone.js → Zoneless change detection
- Old `ngIf`/`ngFor` → `@if` / `@for` control flow

Doing this manually is tedious, error-prone, and repetitive — a perfect agent job.

---

### Agent Architecture

```
User Input (file/folder)
        ↓
  [Planner Agent]
  Analyzes code, detects Angular version,
  lists all migration tasks
        ↓
  [Executor Agent]  ←──── has tools (read/write/lint)
  Works task by task, rewrites code
        ↓
  [Validator Agent]
  Runs ng build / eslint, checks for errors,
  sends failures back to Executor (self-healing loop)
        ↓
  Output: migrated file + migration report
```

---

### Tools the Agent Would Have
- `read_file` — read source `.ts` / `.html` files
- `write_file` — write transformed output
- `run_command` — execute `ng build`, `ng lint`, `tsc --noEmit`
- `search_angular_docs` — RAG over Angular changelog/migration guides
- `diff_viewer` — show before/after for each change

---

### Key Gen AI / Agentic Concepts You'd Learn

| Concept | Where it appears |
|---|---|
| **Planning agent** | Decomposing migration into ordered tasks |
| **Tool use** | File I/O, shell commands |
| **Self-reflection / retry loops** | Validator sends errors back to Executor |
| **RAG** | Grounding on Angular docs to avoid hallucinations |
| **Structured outputs** | Migration plan as JSON, report as markdown |
| **Context management** | Handling large codebases within token limits |

---

### Phases to Build It

**Phase 1 — Single file, one migration rule**
Migrate `*ngIf` → `@if` in one component. Get the loop working end to end.

**Phase 2 — Multi-rule planner**
Planner detects all applicable rules in a file and sequences them safely.

**Phase 3 — Validation loop**
Integrate `tsc --noEmit` output as feedback. Agent fixes its own errors.

**Phase 4 — Multi-file / project-level**
Walk an entire `src/` directory, maintain cross-file context (shared services, module imports).

**Phase 5 — RAG layer**
Embed Angular migration guides so the agent can look up rules it's unsure about.

---

### Stack Suggestion

- **Language:** TypeScript (Node.js) — stays in your ecosystem
- **LLM:** Anthropic Claude API (claude-sonnet-4)
- **Agent framework:** Raw API calls first → then optionally LangGraph or Mastra
- **CLI:** Commander.js or yargs
- **Testing:** Vitest with fixture components at each Angular version

---

### What Makes It Portfolio-Worthy

1. Solves a **real pain point** every Angular team has
2. Demonstrates you understand Angular deeply (signals, standalone, control flow)
3. Shows agentic patterns: plan → execute → validate → retry
4. Directly relevant to **Senior Frontend roles** — you're solving your own domain's problems with AI

---

Want to go even deeper on the architecture, or start mapping out Phase 1 in detail?
