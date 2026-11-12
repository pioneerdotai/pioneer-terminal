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

The UI still runs from compiled files inside the VM, without a source checkout
mount. A developer-only host process listens on the printed loopback port. It
streams HTTP to the guest through a separate temporary loopback port, but handles
`/api/terminal` WebSocket upgrades on the host. No guest-to-host network grant or
host HOME mount is needed.

**Terminal sessions are real shells of the computer running this command**, under
your user account with its HOME, login shell, files and installed programs. Commands
have the same effects as in your ordinary local terminal. For example, `uname -s`
and `pwd` on a Mac report Darwin and your Mac home, rather than the guest Linux
environment. This is a stand-in for the future Gateway host PTY service; it does
not add that service to Pioneer or change the production runtime contract.

The helper reuses the existing PTY/session implementation through the local
developer dependencies `tsx`, `ws` and host-native `node-pty` in `node_modules`.
It does not install or rebuild them. The native addon must support the host OS,
architecture and developer Node version. The Linux addon in the App archive is
not used for host shells.

Only `dist/microsandbox-preview-data/<arch>` is mounted read/write as `/data` for
the guest process. That directory is not the host terminal's HOME. The private
working root/cache disappears with the unnamed ephemeral sandbox; the mounted
guest data remains between runs. Stopping the helper closes its host terminal
sessions as well as stopping the sandbox. An interrupted WebSocket retains a
session for the existing bounded reconnect grace period while the helper lives.

Only `127.0.0.1:<port>` is published, not a LAN address. The explicit developer
entry point checks that the browser's expected origin is loopback. The server
checks that Origin and Host on terminal WebSocket upgrades. Open the exact printed `127.0.0.1` URL,
not `localhost` under a different origin.

This preview deliberately has **no Gateway HTTP header authentication** and is
for a trusted local development machine only. `packaging/local-preview.cjs` is
added to the temporary runtime tree before its single copy into the VM and is
NOT in production artifacts.
The real `runtime/start.cjs` still requires the Gateway token/origin/data contract;
its checks were not relaxed. The host service also checks HTTP Host and owns
sessions, resize, flow control, reconnect and cleanup; guest terminal upgrades
are not forwarded. This helper is not an alternative Gateway runtime.

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
