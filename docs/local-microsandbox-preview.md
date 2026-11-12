# Local preview with Microsandbox

From this repository on a machine with developer Node/Bun and `msb 0.7.14`:

```sh
cd /Users/alexander/Code/pioneer/pioneer-terminal
bun run preview:microsandbox
```

Wait for `Local Terminal ready`, then open **http://127.0.0.1:3000**. If that
port is in use, run `bun run preview:microsandbox --port 3001` and open the URL
printed by the script. Stop with Ctrl+C.

The helper reads the existing built package under `dist/pioneer/terminal-<version>`;
it does not build the application or install dependencies. It chooses the native
Linux architecture, checks the archive hash, unpacks locally, then invokes msb
with the digest-pinned **node:22-bookworm-slim** image. The full Bookworm image is
retained only for CI compilation. The runtime image has about 80 MB of compressed
OCI layers per supported architecture; this is separate from App payload size.

The helper copies compiled files into the VM instead of mounting the source
checkout. Only `dist/microsandbox-preview-data/<arch>` is mounted read/write as
`/data`; the shell HOME is `/data/home`. Your real host HOME is not mounted. The
shell is inside the Linux VM. The private working root/cache disappears with the
unnamed ephemeral sandbox; the mounted preview HOME remains between runs.

Only `127.0.0.1:<port>` is published, not a LAN address. The explicit developer
entry point checks that the browser's expected origin is loopback. The server
checks that Origin on WebSocket upgrades. Open the exact printed `127.0.0.1` URL,
not `localhost` under a different origin.

This preview deliberately has **no Gateway HTTP header authentication** and is
for a trusted local development machine only. `packaging/local-preview.cjs` is
copied separately by this developer helper and is NOT in production artifacts.
The real `runtime/start.cjs` still requires the Gateway token/origin/data contract;
its checks were not relaxed. This helper is not an alternative Gateway runtime.

The `msb` command is foreground and the sandbox is unnamed, so the CLI owns its
ephemeral lifecycle. If interrupted abnormally, inspect `msb ls` before removing
only a leftover sandbox that belongs to this preview. Do not clear the entire
Microsandbox cache or other sandboxes.

Prerequisites still apply: compatible virtualization/provider support, native
architecture and enough disk/memory. The script requests 1 GiB RAM and two vCPUs.
On macOS the current provider requires Apple Silicon. No host execution fallback
is attempted. On first invocation msb may download the image/runtime artifacts.

Only CLI help/syntax and static image metadata were inspected while preparing
this command; no sandbox or backend was started automatically. Use this command
to perform the actual manual trial and retain its logs if startup fails.
