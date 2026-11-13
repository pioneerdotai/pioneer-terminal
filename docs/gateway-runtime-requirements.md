# Gateway requirements for Terminal

The App declares its backend and UI in `app.json`. It selects the managed `node`
environment; Gateway owns the exact shared image digest and Microsandbox setup.
Node 26 and the corresponding Linux/glibc architecture are required. This document
records the integration boundary; it does not claim that Gateway implements it.

## Install and lifecycle

Select and verify one archive from `runtime.artifacts`, preserve file modes, and
extract its `runtime/` directory. Run `node start.cjs` in that directory. Do not
install packages or run build tools on the user's machine.

Start the enabled application after installation and restore it after Gateway
restart, independent of open clients. Disable/update/remove must revoke routes
and stop the execution. SIGTERM/SIGINT closes the HTTP server with a ten-second
application deadline; Gateway owns escalation and crash recovery.

## Production HTTP adapter

Supply these application adapter values:

- `PIONEER_APP_TOKEN`: a random per-execution credential of at least 32 characters.
- `PIONEER_APP_ORIGIN`: the dedicated public HTTP(S) origin, with no path or
  trailing slash. Root-relative asset URLs and origin-scoped browser storage
  currently require this routing model.
- `PIONEER_APP_DATA`: an absolute, writable, private persistent data directory.
  The launcher uses it for HOME; it is not a host shell home directory.
- `HOST=0.0.0.0` and `PORT=3000` by default inside the guest. Gateway publishes
  the authenticated route, not a directly accessible unauthenticated guest port.

Provide writable `/tmp` and a private runtime/cache layer for Next.js. The shared
base image must remain immutable. Forward UI HTTP requests with
`x-pioneer-app-token` injected server-side; never expose this credential to
browser JavaScript. Serve `/`, `/_next/*` and `/ghostty-vt.wasm` unchanged.
Authenticated `GET /healthz` returns readiness after Next.js prepares and the
listener starts. These adapter values need explicit Gateway wiring; they are not
additional public manifest fields.

## Host terminal transport

The browser connects to `/api/terminal` on the App origin. Gateway must route that
WebSocket to its own authorized host PTY service, not the App's sandbox. The
production HTTP server returns 503 for terminal upgrades that reach it, rather
than falling back to a shell in the guest.

Gateway authenticates the client, checks the App's host terminal permission,
validates the Origin, isolates users' sessions, and starts shells as the authorized
Gateway host user. It must support the protocol in `lib/terminal-protocol.ts`:
attachment/resume, sequenced input acknowledgments, resize including pixel sizes,
binary output, output acknowledgments and working-directory updates. The existing
local-development session service demonstrates the protocol but is not a bundled
host service or an instruction to install Node on the Gateway machine.

Reconnect can retain a live host session; persistent App data is not a snapshot
of shell processes. Host session lifecycle and cleanup belong to Gateway.

## Qualification

Package integrity checks do not qualify actual execution. Before declaring full
installation support, verify the published Node runtime in Microsandbox, HTTP
readiness/authentication, asset loading, host PTYs, WebSocket routing, reconnect,
resize, shutdown, and isolation on supported hosts. There is no host process or
system-runtime fallback for the App backend.
