# Building Pioneer Terminal

Terminal is a production App for the managed `node` environment (Node 26,
glibc). The Gateway selects its shared runtime image; the application does not
bundle Node, Microsandbox, a shell, or a package manager.

## Build and delivery

The **Prepare Pioneer application** workflow builds on native Linux x64 and
arm64 runners using a digest-pinned Node 26 / Debian Trixie builder. This matches
the managed runtime's major version and libc baseline. Build tools run in CI,
never on the Gateway or in its execution sandbox.

The workflow installs `bun.lock` with dependency scripts disabled, builds Next.js
and the production server, then copies Next's standalone dependency closure and
traces the custom server using Next's own pinned tracer. It materializes symlinks,
omits caches and development tools, preserves executable modes, and records file
hashes and sizes. No local PTY service, node-pty addon, or preview launcher is
included. The build fails if such dependencies enter the runtime trace.

Each architecture archive contains:

```text
runtime/
  start.cjs
  server.cjs
  runtime-target.json
  package.json
  next.config.mjs
  .next/
  public/
  node_modules/
```

Next's generated standalone `server.js` is not executed. `start.cjs` applies the
serialized production config and starts our HTTP server. The bundle explicitly
substitutes production mode at build time. The launcher validates Linux target,
architecture, Node major version and ABI before loading it.

Assembly checks that both artifacts share the same manifest, lockfile, icons,
version and source revision. It produces one installable directory layout:

```text
terminal-0.10.0/
  app.json
  assets/logo.png
  build-info.json
  SHA256SUMS
  runtime-artifacts/
    terminal-0.10.0-linux-x64.tar.gz
    terminal-0.10.0-linux-arm64.tar.gz
    linux-x64.files.json
    linux-arm64.files.json
    # Per-target dependency traces and size reports are also retained.
```

`app.json` is the runtime/UI declaration. `build-info.json` contains packaging
provenance and integrity data, not a separate runtime contract or image selector.
The verifier checks hashes, file sizes/modes, archive paths and file types,
architecture metadata, ELF headers where present, and a 100 MiB unpacked size
budget. This is artifact inspection, not execution testing or signing.

## Developer commands

Use Node 26 and Bun 1.4.3 on the matching native Linux build architecture:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build:pioneer
bun run package:pioneer
```

After obtaining both architecture outputs under
`dist/pioneer-targets/linux-x64/` and `dist/pioneer-targets/linux-arm64/`:

```sh
bun run assemble:pioneer
python3 scripts/pioneer/verify-package.py
```

Pushes to `main` and manual dispatch produce `pioneer-terminal-VERSION.tar.gz`
and its SHA-256 file in the `pioneer-terminal` Actions artifact (30-day retention).
Numeric version tags additionally publish both files permanently in GitHub
Releases, after both builds, assembly and artifact verification succeed. Tags
have no `v` prefix. Use `0.10` for package version `0.10.0`; full `x.y.z` tags are
also supported. Existing published releases are never overwritten.

Download the archive from Releases and extract it to obtain the directory above.
Do not select GitHub's automatically generated source-code archives; they are
source checkouts, not the application package.

Do not change source, manifest, lockfile or icons between builds and assembly.
Failed builds discard their successful build receipt. Packaging and verification
never start the application or run unit/browser tests.

## Installation and launch

Gateway selects one Linux guest architecture from `runtime.artifacts`, validates
it, and extracts its `runtime/` directory into the installation. It supplies the
managed `node` runtime, working directory and environment, then runs:

```sh
node start.cjs
```

No dependency installation, Bun, tsx or compilation is needed at installation or
startup. Linux guest artifacts are used on supported macOS, Windows and Linux
Gateway hosts; actual host and virtualization support depends on Microsandbox.

The production HTTP backend requires Gateway authentication and routing. It does
not open a guest shell. See [Gateway requirements](gateway-runtime-requirements.md)
for the host terminal route and remaining integration obligations. New manifest
fields still require Gateway implementation; this package is not compatible with
the existing minimal installer until that implementation is complete.

Existing unit/browser tests and `dev-server.ts` remain developer tools. They are
excluded from application artifacts. Temporary Microsandbox previews and scratch
finance MCP/Skill files are not part of the application.
