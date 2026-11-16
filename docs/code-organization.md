# Project code map

## Entry points and boundaries

| Location | Owns |
| --- | --- |
| `app/page.tsx` | Mounting the Terminal feature at `/` |
| `app/layout.tsx`, `app/globals.css` | Document metadata, authenticated base path and global CSS |
| `features/terminal/terminal-app.tsx` | Preference loading, live connection shutdown and workspace mounting |
| `client/pioneer.ts` | One browser SDK connection, initialized before page load and excluded from SSR |
| `client/host-theme.ts` | Complete SDK theme snapshot subscription |
| `client/state.ts` | Storage-compatible preference mirror, pending changes and flush scheduling |
| `client/state-transport.ts` | SDK-relative HTTP state requests and response validation |
| `shared/terminal-protocol.ts` | Messages, dimensions and limits shared by browser and backend |
| `server.ts` | Stable production bundle export used by `packaging/start.cjs` |
| `dev-server.ts` | Explicit local PTY injection for development |

Views use feature hooks and browser integration. Pure feature models do not
import React views or server modules. Browser code never imports `server/`.
The production server reaches the Gateway provider through the server SDK;
only the development entry imports the local `node-pty` provider.

## Interface and workspace

| Change | Owner |
| --- | --- |
| Change App placement / close controls | `features/terminal/workspace/app-view-controls.tsx` |
| Change toolbar composition | `features/terminal/workspace/workspace-toolbar.tsx` |
| Change tabs or close an individual shell session | `features/terminal/workspace/session-tabs.tsx` |
| Change the workspace composition | `features/terminal/workspace/workspace-view.tsx` |
| Change placement or visibility of terminal panes | `features/terminal/workspace/workspace-panes.tsx` |
| Change split resizing controls | `features/terminal/workspace/pane-divider.tsx` |
| Change workspace actions and state transitions | `features/terminal/workspace/reducer.ts` |
| Change tree replacement, removal or visible-session traversal | `features/terminal/workspace/layout-tree.ts` |
| Change pane sizes or directional navigation | `features/terminal/workspace/geometry.ts` |
| Change session status labels or reported paths | `features/terminal/workspace/session-label.ts`, `working-directory.ts` |
| Change keyboard dispatch or IME/repeat handling | `features/terminal/workspace/use-workspace-shortcuts.ts` |
| Change host theme mapping and browser fallback | `features/terminal/theme.ts`, `app/globals.css` |
| Change mapping of native base colors to ANSI entries | `features/terminal/theme.ts` |
| Change font preferences | `features/terminal/settings/appearance.ts`, `use-appearance.ts`, `appearance-settings.tsx` |
| Change shortcut validation/defaults | `features/terminal/settings/shortcuts.ts` |
| Change shortcut recording or its controls | `features/terminal/settings/use-shortcut-recorder.ts`, `shortcut-list.tsx`, `shortcut-settings.tsx` |

The [feature map](../features/terminal/README.md) describes individual terminal
tools, Find, clipboard permission review and the accessible output reader.
Each dialog remains responsible for its own focus and cancellation behavior.

## Terminal lifecycle

- `session/use-session-terminal.ts` coordinates a live parser and connection.
- `session/live-connections.ts` tracks this document's connections and closes
  them on App close, page unload, or component teardown. Nothing is persisted.
- `session/use-terminal-core.ts`, `use-terminal-navigation.ts` and
  `use-terminal-clipboard.ts` own their respective lifetimes and interaction state.
- `session/transport/connection.ts` handles bounded output consumption and
  in-memory reconnection. `input-sequence.ts` never resends uncertain input.

Panes remain mounted at a stable level during tab/split/zoom changes. Reloading
or reopening creates a new workspace and new PTYs. Only preference records cross
the HTTP state boundary; old recovery records are removed by the backend store.

## Server

| Location | Owns |
| --- | --- |
| `server/start.ts`, `config.ts` | Composition and existing environment configuration |
| `server/auth.ts` | SDK service authentication and authenticated request owner |
| `server/routes.ts` | Health, state, Next requests, terminal upgrade and development HMR routing |
| `server/lifecycle.ts` | Signal handling, shutdown deadline and confirmed provider cleanup |
| `server/state/route.ts` | Existing state HTTP methods, status codes and request limit |
| `server/state/validation.ts` | Owner, state and changes validation with size limits |
| `server/state/store.ts` | Per-user snapshots, execution cleanup and serialized atomic file replacement |
| `server/terminal/service.ts` | Session registry and WebSocket server lifetime |
| `server/terminal/sessions.ts` | Admission, owner checks, attachment tokens and session capacity |
| `server/terminal/session.ts` | One PTY, attachment fencing, input delivery and expiry |
| `server/terminal/output.ts`, `output-queue.mts` | Bounded output, replay credit and pause/resume |
| `server/terminal/gateway-pty.ts` | SDK PTY adaptation, stream receipts and resize coalescing |
| `server/terminal/development.ts`, `local-pty.ts` | Local origin checks, shell spawning and development platform details |

Authentication order, owner isolation, limits, file names and state formats are
preserved. Persistent state stays outside the application payload, in the
existing application data directory.

## Build tools and tests

The command entry points stay `scripts/pioneer/build.mjs`, `package.mjs` and
`assemble.mjs`. `metadata.mjs` owns manifest/icon metadata; `runtime-payload.mjs`
copies the existing runtime payload; `trace-runtime.mjs` selects dependencies;
`files.mjs` owns indexing, path validation and digests. `common.mjs` contains
project-root, command and JSON helpers. Importing metadata does not run packaging.
Archive format, targets, launch paths and CI triggers are unchanged.

Tests stay in `tests/` with their existing test runner and browser fixtures.
Module imports follow the new owners; behavioral assertions remain intact.
Dependency versions, manifest, Next/TypeScript/lint configuration, launcher,
assets and CI configuration keep their existing responsibilities.

This refactor has received source review only. Builds, typechecks, linters,
formatters, tests and applications have not been run under the current execution
restriction. Runtime acceptance remains outstanding.
