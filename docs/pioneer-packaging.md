# Preparing Terminal for Pioneer

This repository prepares a **developer preview for the future Gateway App
runtime**. It does not implement that runtime and the resulting directory is not
yet accepted by the minimal Apps installer. No fields have been added to the
agreed `app.json` schema. The separate `runtime.proposal.json` is a handoff for
designing the next installation contract, not an authoritative Pioneer format.

## Build on the developer side, execute on the Gateway

The developer or GitHub Actions builds Next.js, bundles the custom server and
prepares production dependencies. The Gateway must not run Bun, npm, a compiler,
or dependency installation for this package. It provides Node.js 22 through
Microsandbox and executes the ready `runtime/start.cjs`.

`next start` and the default Next standalone server do not implement this
application's terminal WebSocket/PTY backend. We bundle `server.ts` plus its local
imports into `server.cjs`, with npm dependencies external. We use only the traced
production dependencies from Next's standalone output, then add the custom
server's `ws` and `node-pty` file closure using Next's pinned Node File Trace tool.
The generated standalone `server.js` is not executed; our launcher supplies Next's
serialized standalone config to the custom server. There is no dependency on
`tsx` or Bun during execution and no wholesale copy of production node_modules.

The custom server bundle explicitly defines `process.env.NODE_ENV` as
`"production"`. Bun substitutes this expression while bundling; setting the
environment only in the runtime launcher cannot correct a bundle already built
with development mode enabled. Source development still uses `server.ts` directly.

## GitHub Actions

Push to `main` or run **Prepare Pioneer application** manually. The workflow:

1. Runs native `linux-x64` and `linux-arm64` builders independently.
2. Uses a digest-pinned full Debian Bookworm Node.js 22 build container on each runner, keeping the native
   addon glibc baseline consistent with the separate slim runtime candidate. This Docker
   container is **only a CI build tool**, not a Gateway execution provider.
3. Installs from `bun.lock` with scripts disabled, builds the UI and server, and
   explicitly rebuilds `node-pty` for the builder's Linux architecture and Node ABI.
4. Copies Next's production file closure and traces the custom server separately.
   Materializes dependency symlinks, checks the PTY ELF target, and rejects leaked
   compiler/dev tools or musl binaries in this glibc package. Next caches and the
   duplicate standalone tree are omitted. A 100 MiB unpacked-runtime budget catches
   regressions; exceeding it fails the build rather than deleting arbitrary files.
   Produces a tar archive with Linux permissions, per-file hashes and trace/size reports.
5. Verifies both artifacts against the same app manifest, lockfile, assets and
   source commit; combines them into one directory and uploads
   `pioneer-terminal.tar.gz` in the **pioneer-terminal** Actions artifact.
6. Before publishing, verifies every archive file's content, size and executable
   mode, checks native ELF architecture and enforces the size budget. This static
   artifact verification never starts the backend or executes its binaries.

The workflow performs builds and artifact-integrity checks, not unit/browser/
runtime tests. A green workflow alone does not qualify Wry, Microsandbox, HTTP/WS
proxying, sandbox shell behavior or mobile clients.

Download it, for example:

```sh
gh run list --repo pioneerdotai/pioneer-terminal --workflow package.yml
gh run download RUN_ID --repo pioneerdotai/pioneer-terminal \
  --name pioneer-terminal --dir dist/download
tar -xzf dist/download/pioneer-terminal.tar.gz -C dist/download
```

The extracted application directory contains:

```text
terminal-0.1.0/
  app.json
  assets/logo.png
  runtime.proposal.json
  INSTALLATION-NOTES.txt
  SHA256SUMS
  runtime-artifacts/
    terminal-0.1.0-linux-x64.tar.gz
    terminal-0.1.0-linux-arm64.tar.gz
    linux-x64.files.json
    linux-arm64.files.json
    linux-x64.dependency-trace.json
    linux-arm64.dependency-trace.json
    linux-x64.packaging-stats.json
    linux-arm64.packaging-stats.json
```

Each architecture archive contains `runtime/`: `start.cjs`, bundled `server.cjs`,
`runtime-target.json`, `.next/`, `public/`, `next.config.mjs`, `package.json`, and
the selected runtime subset of `node_modules/`. No original source checkout or development dependency
installation is needed to execute it. Terminal currently declares no Skill/MCP;
the original finance scratch files remain local and are excluded from Git and
packaging. The current icon is the PNG already embedded in the starter favicon,
copied unchanged as a placeholder until a Terminal icon is supplied.

## Developer commands

Use Bun 1.4.3 (also pinned in packageManager/workflow) and Node.js 22 in the Linux
Bookworm build environment, with Python 3, make, a C++ compiler and GNU tar:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build:pioneer
bun run package:pioneer
```

`build:pioneer` works on native macOS/Windows for developer build diagnostics too,
but `package:pioneer` deliberately accepts only native Linux x64/arm64 + Node 22.
Setting a target label cannot turn macOS `node-pty` into a Linux binary. Build the
other architecture on its own runner; no silent emulation/cross-compilation.

Download the two individual Actions artifacts into
`dist/pioneer-targets/linux-x64/` and `dist/pioneer-targets/linux-arm64/`, then:

```sh
bun run assemble:pioneer
python3 scripts/pioneer/verify-package.py
```

To use another download directory:

```sh
bun run assemble:pioneer --input /absolute/path/to/artifacts
```

Do not edit source/manifest/lock/assets between target jobs and assembly. Failed
builds have no successful build receipt; partial staging directories are removed
on normal error settlement. The final hashes detect mismatched artifacts and
corruption; they are not publisher signatures.

## Gateway platform matrix

The **host OS** runs Gateway + Microsandbox. The application itself runs in the
Linux guest, so two Linux payloads cover the guest architectures rather than
requiring macOS/Windows application binaries:

| Gateway host         | Intended payload            | Qualification                                                                                  |
| -------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| macOS Apple Silicon  | linux-arm64                 | Requires compatible Microsandbox; not runtime-tested here                                      |
| macOS Intel          | linux-x64 would be needed   | **Provider gap:** current Microsandbox README lists macOS Apple Silicon only; no host fallback |
| Windows x64          | linux-x64                   | Requires compatible Microsandbox/WHP; not runtime-tested here                                  |
| Windows arm64        | linux-arm64 would be needed | Exact provider/runtime support must be qualified; not claimed from an ARM archive alone        |
| Linux x64 with KVM   | linux-x64                   | Requires compatible Microsandbox; not runtime-tested here                                      |
| Linux arm64 with KVM | linux-arm64                 | Exact provider/runtime support must be qualified; not claimed from an ARM archive alone        |

See the [Microsandbox host requirements](https://github.com/superradcompany/microsandbox#-getting-started).
Pioneer Gateway distributing a host binary does not establish that Microsandbox
supports that host. Unsupported virtualization/provider configurations must fail
clearly rather than install Node on the host or run the App directly.

## Candidate runtime contract to qualify next

- Provider: Microsandbox only. Candidate runtime image: `node:22-bookworm-slim` with the
  immutable OCI index and architecture digests in `packaging/runtime-image.json`.
  CI intentionally uses a separate full Bookworm builder with the same Node 22/glibc baseline.
  The slim Debian base includes Bash and perl-base; no apt/npm install is needed during preview.
  The future integration must check
  actual Node ABI and required commands and qualify this image with Microsandbox;
  it must not silently select a mutable tag or a runtime from host PATH.
- Select exactly one matching architecture archive and extract it in the App's
  runtime area. Start `node start.cjs` with working directory `runtime/`.
- Provide an app-private persistent directory in `PIONEER_APP_DATA`. The launcher
  creates its shell home there. Allow a private disposable writable runtime layer
  for Next caches; do not mutate a shared base or another App's files.
- Supply `PIONEER_APP_ORIGIN`, the stable **dedicated public origin** of this App,
  and a random per-execution `PIONEER_APP_TOKEN` of at least 32 characters. The
  packaged launcher refuses to start without these values. This is a proposed
  integration seam, not an existing Gateway API.
- Proxy every HTTP request and WebSocket upgrade through the authenticated
  Gateway route, adding `x-pioneer-app-token` server-side. The credential never
  goes into client JavaScript or the PTY environment. WebSocket Origin must match
  the public App origin. The listener is guest-internal; do not expose it directly
  or share the route across users without per-user isolation/authorization.
- `GET /healthz` with the private token returns readiness only after Next has
  prepared and the listener is accepting requests. HTTP and WS are on the same
  guest port (`PORT`, default 3000; `HOST`, default 0.0.0.0 in packaged mode).
- Route `/`, `/_next/*`, `/ghostty-vt.wasm` and `/api/terminal` without losing
  WebSocket upgrades. The current frontend uses root-relative URLs and browser
  storage. Serving at an arbitrary URL subpath is **not** currently supported.
- SIGTERM/SIGINT closes PTYs/WebSockets and the HTTP server with a bounded shutdown
  deadline. The Gateway owns automatic startup/recovery independent of open UI.
- Shells run **inside the sandbox**, not on the host/client. Reconnect can preserve
  a live shell during a connection loss, but restarting the backend loses its
  in-memory PTYs/tokens; persistent HOME is not a live-process snapshot.

The next App-runtime implementation must adopt or revise these candidate fields,
add authenticated client routing, qualify the pinned runtime image and test the real
HTTP/WS/PTY path. It must not change the already-running minimal Apps task just to
accept this preview directory.

For the concrete installation/launch requirements derived from Terminal, see
[Gateway runtime requirements](gateway-runtime-requirements.md). NFT reports the
optional ws accelerators `bufferutil` and `utf-8-validate` as absent; ws provides
fallbacks and these are deliberately not runtime requirements. Other unresolved
custom-server dependencies fail packaging instead of being silently accepted.

For the manual loopback-only trial, see [Local Microsandbox preview](local-microsandbox-preview.md).
