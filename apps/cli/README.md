# @mapart/cli

Single CLI entry for everything ad-hoc. Run via `pnpm mapart <subcommand>` (or `tsx apps/cli/bin/mapart.ts` directly).

This is meant for debugging only, specially for AI Coding Agents to easily test our code and packages without interacting with the UI.

```bash
pnpm mapart --help
pnpm mapart db --help
pnpm mapart storage list
pnpm mapart tiles for-point --lat 40.7 --lng -74 --zoom 18
```

## Layout

```
apps/cli/
  bin/mapart.ts        # entry; wires register*(parent) calls
  src/commands/
    db.ts              # mapart db status|migrate|reset|projects|sql
    storage.ts         # mapart storage list|put|get|delete
    models.ts          # mapart models generate
    render.ts          # mapart render (end-to-end test against apps/worker-render dev endpoint)
    tiles.ts           # mapart tiles for-point|bounds|for-bbox|for-circle
```

Each command file exports `registerXxxCommands(parent: Command)` that hangs subcommands off a Commander parent. The entry wires them all together.

## Adding a command

1. Pick the right domain file (or add a new one if you're introducing a new domain).
2. `parent.command('foo').description(…).action(async (opts) => {…})`
3. If you added a new domain file, register it in `bin/mapart.ts`.
4. Subcommand should call into `packages/*` for actual work — keep CLI files thin (parse args, route to package, format output).

## Not the place for

- **Long-running processes.** CLIs exit. Long-running work belongs in a named worker (e.g. `apps/worker-render`).
- **HTTP endpoints.** Those live in `apps/web` server actions / API routes.
- **Business logic.** Goes in `packages/*`. The CLI is a thin dispatcher.
