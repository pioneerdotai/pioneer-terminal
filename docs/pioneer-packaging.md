# Building Pioneer Terminal

Terminal targets Gateway's managed `node` environment (Node 26 / glibc). Gateway
selects its runtime image. The App includes no Node distribution, shell, package
manager, Microsandbox executable or local PTY addon.

## Build and delivery

The existing **Prepare Pioneer application** workflow builds native Linux x64 and
arm64 payloads with a digest-pinned Node 26 / Debian Trixie builder. Bun installs
the locked developer dependencies with scripts disabled. Next produces the UI;
Bun bundles the production custom server. Next's pinned tracer collects its
standalone dependencies plus the backend's `ws` transport. The two optional `ws` native acceleration addons are disabled; their absence is
recorded explicitly by the tracer. All other unresolved dependencies fail packaging.
Local `node-pty`,
compilers, test runners and preview code remain outside the runtime closure.

Per-architecture CI artifacts are intermediate tar archives that preserve Linux
file modes. Assembly checks source revision, manifest, lockfile, shared icons,
version and archive checksums. A bounded indexed extractor rejects links, special
files and unsafe paths and checks each file before producing ready directories.
**No nested runtime archive remains in the installable App package.**

```text
terminal-0.1.0/
  app.json
  assets/logo.png
  runtime/start.cjs
  runtime-artifacts/
    linux-amd64/
      server.cjs
      runtime-target.json
      package.json
      next.config.mjs
      .next/
      public/
      node_modules/
    linux-arm64/
      # Same layout, with the matching native dependency closure.
  build-info.json
  linux-x64.files.json
  linux-arm64.files.json
  # Dependency traces and packaging statistics for each target.
  SHA256SUMS
```

The source manifest declares `linux/amd64` and `linux/arm64` directory members.
Its all-zero SHA-256 fields are build-template placeholders: **the checkout cannot
be installed**. Assembly replaces both with the exact canonical member snapshot
digest used by `pioneer-packages`, including directory and executable file modes.
The final verifier independently recomputes that digest and checks file indices,
ELF architectures, Node ABI metadata and the 100 MiB budget per payload. These
checks inspect artifact data; they do not execute the App or constitute signing.

Gateway installs only the matching guest payload. It mounts that tree at
`/payload`, the common App files at `/app`, and writable App data at `/data`.
The manifest's `cwd: "runtime"` is a common directory disjoint from the artifact
roots. `node /app/runtime/start.cjs` validates the selected ABI, consumes the
private bootstrap and starts `/payload/server.cjs` with Next's serialized
production configuration. No build or dependency installation occurs on Gateway.
Linux guest payloads serve supported Gateway hosts; current host support is
macOS arm64 and GNU Linux amd64/arm64, subject to Gateway virtualization gates.

## Developer commands

On Node 26 / Bun 1.4.3 and each matching native Linux build architecture:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build:pioneer
bun run package:pioneer
```

With both outputs under `dist/pioneer-targets/linux-x64` and `linux-arm64`:

```sh
bun run assemble:pioneer
python3 scripts/pioneer/verify-package.py
```

For a local installation check, build only the Linux guest architecture used by
the development Gateway. Use the same Linux Node 26 builder and build/package
commands on an isolated source copy, then assemble that target explicitly:

```sh
node scripts/pioneer/assemble.mjs --target linux-arm64 --output /path/to/local/terminal
python3 scripts/pioneer/verify-package.py /path/to/local/terminal
tar -czf /path/to/local/pioneer-terminal-local-linux-arm64.tar.gz -C /path/to/local terminal
```

The resulting manifest contains only the built architecture and its real tree
checksum. `--target linux-x64` selects amd64 instead. Omitting `--target` retains
the two-architecture release build. A macOS-native build must not be labelled as
a Linux payload. Local assembly does not publish or modify a GitHub release.

Pushes to `main` and manual dispatch produce the combined tarball and SHA-256 file
in the `pioneer-terminal` Actions artifact (30-day retention). Numeric tags without
`v` also publish both files in GitHub Releases. The `0.1.0` production release uses tag `0.1.0`. Existing published releases
are immutable; further source changes require a new version/tag.
Do not change source, manifest, lockfile or icons between build and assembly.

Download the packaged release archive, not GitHub's automatic source archive.
Gateway's common App installer accepts the packaged archive or extracted App
folder. Package installation, backend readiness and availability of the `host.pty`
service are separate states. There is no separate App consent/grant UI; a current
installed/enabled App execution uses the supported Host API through its backend
credential. See [the runtime contract](gateway-runtime-requirements.md).

The initial adaptation was source-only. A subsequent local Linux arm64 build on
November 13, 2026 passed compilation, TypeScript checking and package verification.
An isolated Microsandbox builder used the existing pinned CI image and Bun 1.4.3;
the resulting archive was not published. No automated tests, Gateway build, App
installation or App execution were performed. The commands above also document
the unchanged two-architecture release path.
