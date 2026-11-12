# What the full Gateway installer must provide for Terminal

This is an application-derived handoff, not a request to expand the current
minimal Apps implementation and not an approved new manifest schema.

**Host-terminal correction:** the intended shell runs on the Gateway machine as
the authorized host user, not in the App's Linux guest. The current standalone
payload below still contains its original guest PTY backend. Developer preview
now demonstrates the intended routing: HTTP UI to Microsandbox, `/api/terminal`
WebSocket to a host service reusing the session protocol. Gateway must provide
that host PTY service and client authorization before this is a full installation.
Statements below about guest shell HOME/Bash/Perl describe the existing payload,
not the required host-terminal behavior. `node-pty` and platform dependencies
ultimately belong on the host service side; no host runtime installation or
guest-to-host shell bridge should be added to the App installer as a workaround.

The developer's only delivery operation is **Prepare Pioneer application** in
GitHub Actions (also triggered by pushing main). The result is one directory with
App metadata, two prebuilt runtime artifacts and their integrity/size reports.
Pioneer must consume that result without rebuilding or installing dependencies.

## Installation inputs

1. Valid `app.json` and referenced icons. Terminal currently declares no Skills,
   MCP servers or localizations. Its browser UI is not itself a model tool.
2. An artifact for exactly one Linux guest architecture (`linux-x64` or
   `linux-arm64`), plus its SHA-256 and file index. Do not unpack both by default.
3. A pinned runtime image, its architecture digests, required Node ABI and entry
   command from the candidate `runtime.proposal.json`. The installed application
   payload does not contain Node itself. Shared image storage is separate from
   the per-installation payload.

Verify archive paths/types, integrity, architecture and compatibility before
publishing the installed runtime. Preserve executable modes. Do not reinterpret a
host-native payload as Linux. The tar files contain regular files/directories,
not package-manager symlinks. Install from a complete immutable artifact, never
from the developer checkout.

## Execution environment

- Microsandbox on the Gateway is mandatory. There is no direct-host process,
  system Node/Python or Docker execution fallback. CI containers build artifacts
  only and are not involved in Gateway operation.
- The execution image candidate is pinned node:22-bookworm-slim. The full
  node:22-bookworm image is only the CI builder; do not use its digest as the
  installed runtime just because compilation happened there.
- Extract the selected archive. Its root is `runtime/`; execute
  `node start.cjs` there. The launcher checks platform, architecture and Node ABI.
  It applies production mode and Next's serialized production config before
  loading the ready custom server.
- Provide an absolute persistent `PIONEER_APP_DATA` directory private to the App
  installation/execution's authorized user scope. The launcher uses its `home/`
  for shell HOME. Provide a private disposable writable runtime/cache layer for
  Next; do not mutate a shared runtime image or share mutable App data.
- Supply `PIONEER_APP_TOKEN` (random, at least 32 characters) and
  `PIONEER_APP_ORIGIN` (the public HTTP(S) origin without a path). They are
  mandatory for packaged mode. These names define a proposed concrete app-side
  adapter seam; a future approved Gateway contract can replace it explicitly.
- Default guest listener: `HOST=0.0.0.0`, `PORT=3000`. Keep it behind Gateway
  routing. Shells and filesystem access remain inside the sandbox. Guest Bash
  and Perl are required; Perl sets PTY pixel dimensions for terminal graphics.

## UI transport

Use a dedicated stable App origin and route the root paths unchanged. Terminal
uses root-relative assets, WebSocket URLs and origin-scoped browser storage; it
does not currently support hosting under an arbitrary URL subpath.

Gateway authenticates and authorizes the client first, then forwards HTTP and
WebSocket upgrades to the execution with `x-pioneer-app-token` injected
server-side. Do not expose that token to browser JavaScript. Preserve the public
WebSocket Origin; the backend checks it against PIONEER_APP_ORIGIN. Do not share
one user's Terminal execution/sessions with other users merely because they can
see the App installation.

Required routes: `/`, `/_next/*`, `/ghostty-vt.wasm`, `/api/terminal` (WebSocket),
and authenticated `GET /healthz`. Readiness reports ready only after Next has
prepared and the HTTP listener is available. This proposed private header is not
a substitute for Gateway-side client authorization or network isolation.

## Lifecycle

- After successful install, start the enabled App automatically. On Gateway
  restart restore enabled Apps, independent of connected clients. UI open/close
  only attaches/detaches the viewer, not the backend.
- On disable/update/remove revoke routes and stop the execution. SIGTERM/SIGINT
  closes PTYs, sockets and HTTP; app-side shutdown deadline is ten seconds.
  Gateway still needs its own bounded stop/escalation and crash reconciliation.
- Browser reconnection can resume an existing in-memory shell session. Backend
  restart loses live PTYs/tokens; persistent HOME is not a process snapshot.
- Startup failure affects this App, not Gateway availability or other Apps.
  Do not mark an installed artifact runtime-ready before actual readiness.

## Qualification still required

The app-side pipeline builds and checks artifact integrity without running
unit/e2e/smoke tests or starting the backend. A dependency trace reduces delivery
size; it does not prove every dynamic runtime path. Preserve tracer diagnostics
for review. Real HTTP/WS/PTY/auth/reconnect/shutdown checks must follow explicit
authorization of runtime validation and integration with Microsandbox.

Host support is conditional on Microsandbox: macOS Apple Silicon, Windows/WHP,
Linux/KVM and individual architectures require qualification. The current
Microsandbox macOS requirement excludes Intel Mac; having an x64 payload does not
fix that provider gap. See the host matrix in pioneer-packaging.md.
