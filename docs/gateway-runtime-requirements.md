# Terminal integration with Gateway Apps

This source targets the implemented Apps contract on Gateway's
`feature/apps-initial` worktree. Terminal consumes that contract without changing
Gateway or introducing a Terminal-specific route there. The previously published
0.10 archive is unchanged and does not contain these changes.

## Transport and authority

```text
Opaque App WebView
    | relative HTTP /state and WebSocket /terminal (App-owned routes)
Terminal Node backend inside Microsandbox
    | shared execution-authenticated JSON-RPC WebSocket /apps/host
Gateway Host API: host.pty
    | portable PTY under the Gateway OS account
Host shell
```

The backend reads the private JSON file named by `PIONEER_BOOTSTRAP`. It requires
`execution_id`, `ui_proxy.credential` and the nullable `host_api` declaration.
Gateway supplies `APP_DATA`; the launcher uses the read-only `/payload` mount.
Neither bootstrap credential is exposed in HTML, browser state, URLs or logs.
Every HTTP request, readiness request and WebSocket upgrade checks
`Pioneer-App-Execution-Credential` against the independent UI proxy nonce.
Production refuses to start without valid bootstrap/data configuration.

A current installed/enabled App execution connects to the supported Host API using
its backend-only execution credential. Bootstrap capabilities describe available
services; they are not requested permissions or saved consent decisions. An absent
PTY service is reported as unavailable. There is no production local-shell or
guest-shell fallback. `dev-server.ts` remains an explicitly local
development entry point and is excluded from the packaged server.

One backend WebSocket uses the Host API bearer and no Origin header. It shares
`host.pty.create/input/subscribe/ack/keepalive/resize/close` across at most eight live terminals.
Requests use 21-character IDs. Create keys and input sequences are stable for a
single ambiguous-transport retry. Host domain failures are not retried. Browser
input is acknowledged only after Host API acceptance; acceptance means queued,
not executed by the shell. Unknown input outcomes end the session visibly.

Output subscriptions use absolute byte cursors and events carrying at most
16 KiB of data. Gateway permits at most 64 KiB and 64 data frames in flight per
subscription, reclaimed only by cumulative cursor acknowledgments. The backend
stops acknowledging when its bounded output owner pauses; reconnect subscribes
from bytes already handed to that owner, fencing old frames with a stream ID.
There is no changed-notification/read round trip in the interactive path. A
ten-second keepalive maintains the explicit session lease and detects silent
transport failure; it neither reads output nor queries the database. A cursor gap
or expired/revoked session is reported explicitly, without silently recreating a
process or skipping output. Disconnecting a view retains a session for up to five
minutes; explicit terminal close and backend shutdown close owned host PTYs.
Gateway revocation remains authoritative regardless of App-side timers.

The App omits the optional command so Gateway selects the host account's login
shell on macOS/Linux or `ComSpec` (normally cmd.exe) on Windows, with the host home
as cwd. Explicit commands, including PowerShell, remain supported. The App does
not use guest `HOME`, `SHELL` or `/data` as host paths. The label "Gateway shell"
does not claim to track the host working directory. Host PTYs use Unix PTYs on
macOS/Linux and ConPTY on Windows; these source paths still require native validation.

## WebView and persistence

Next assets, WASM, state fetches and the App WebSocket use relative URLs. The HTML
base consumes Gateway's relative `Pioneer-App-Base-Path` header, preserving scoped
grants and reverse-proxy mount prefixes. System font stacks avoid next/font's
absolute asset-prefix requirement and remote font fetching at build time.
The browser never contacts Host API.

The App does not require cookies, localStorage, sessionStorage, IndexedDB or
workers. It hydrates an in-memory state mirror from its authenticated backend.
Settings, workspace layout and bounded replay records are stored atomically in
`APP_DATA/terminal-state.json`, partitioned by authenticated user. Writes are
serialized and batched (250 ms), with
6 MiB request and 16 MiB stored-state limits. A visible warning reports persistence
failure. An abrupt WebView/process termination can lose the latest uncommitted
batch; this is not synchronous or fsync-level durability. Missing replay prefixes
fail restoration rather than starting a replacement shell. Backend execution
changes discard old session recovery and retain preferences.

Installation remains workspace-scoped. Within an installation, each authenticated
Gateway principal owns its own appearance, shortcuts, pane layout, recovery logs
and PTY sessions. Multiple views/devices belonging to that same user share this
state and can reattach to the same recorded sessions. A different user cannot
attach to those PTYs even with a known session token; a rejected attachment does
not interrupt the owner's live connection. Limits remain bounded across the
installation (16 MiB total state and the existing total session cap).

Gateway injects `Pioneer-App-User-Id` into both proxied HTTP requests and WebSocket
handshakes from the admitted view's stable `principal_id`, never from a browser
header, query parameter or request body. This ID is stable across login sessions
and devices; the installation's data directory supplies the workspace boundary.
Terminal requires it after authenticating `Pioneer-App-Execution-Credential` and
rejects requests without identity. The credential-authenticated `/healthz` probe
does not require user identity. Direct development mode uses one fixed local
owner and ignores supplied user headers. Browser/provider credentials and cookies
are not forwarded. No new database lookup, timer or Host API connection per user
is introduced. Existing grant revocation still fences UI access.

The platform supplies identity without forcing every App's data to be personal:
an App may keep shared installation data alongside user-owned state. Terminal
uses personal state throughout. Updated Terminal source requires a Gateway with
this user-identity header.
This isolates App state and sessions; shells still run as the Gateway host OS
account, not as separate OS users or filesystem sandboxes.

`pioneer.theme` messages are accepted only from the embedding parent, with
validated palette colors. System appearance follows the parent palette; explicit
light/dark preferences remain user-controlled.

## Interactive Host API changes (source only, November 14)

Host API request and output dispatch no longer share a 20 ms timer. Durable
App/workspace/execution validation occurs at connection admission; subsequent
messages check the issued execution's in-memory cancellation authority. Existing
App lifecycle reconciliation (the `apps.lifecycle` work signal), execution lease
cleanup and committed workspace invalidation revoke that authority. Package
publication fences disabled/non-installed Apps before notification I/O; explicit
stop fences authority before awaiting VM cleanup. No per-message
SQL, TTL authorization cache or additional lifecycle poller was introduced.

Terminal allows up to eight ordered Host input RPCs in flight instead of waiting
for an RPC acknowledgment between keystrokes. Browser acknowledgments still cover
only a contiguous accepted prefix. Gateway retains bounded sequence-and-byte
history (64 input frames / 128 KiB) so a lost acknowledgment followed by later
accepted input does not make a reconnect write those bytes twice. A mismatched or
expired input identity fails explicitly. Acceptance remains queue admission, not
shell execution.

Gateway streams output with `host.pty.subscribe` / `host.pty.output` /
`host.pty.ack`. Input, output acknowledgments and resize remain ordinary JSON-RPC
requests on the same execution-authenticated WebSocket. Legacy `read` / `changed`
clients remain supported on non-streaming connections while installed payloads
are rebuilt. The updated Terminal requires the streaming-capable Gateway.

Gateway enables TCP_NODELAY on accepted sockets and on its App WebSocket proxy's
upstream connection; Node's `ws` already enables it. These transport and protocol
changes use shared macOS/Linux/Windows code. The subsequent Windows host PTY
integration is described below; no native cross-platform qualification is claimed.

These changes modify source in Gateway and Terminal. Existing packaged payloads
are not rewritten. No builds, automated tests, application launches or latency
measurements have been run for these changes. Equal latency to browser dev mode
has not yet been established.

## Host shell, text encoding and bounded control requests (source only)

Terminal now omits the optional `host.pty.create.command`: Gateway resolves the
host account's login shell and home through portable-pty instead of requesting
`/bin/sh -l`. This requires the updated Gateway. Explicit-command clients remain
valid. Child environment setup retains standard locale variables and chooses an
installed UTF-8 locale when inherited LC_ALL/LANG/LC_CTYPE would not provide UTF-8.
macOS/Linux canonical PTY input enables IUTF8 so erase does not split a Cyrillic
character. User shell/profile scripts remain user-owned.

Resize storms keep one RPC in flight per terminal plus the latest desired size;
lease heartbeats cannot overlap per session. A live socket has one output
subscription per terminal. ACKs use that same socket; a stale ACK cannot advance
its replacement's cursor. Disconnect cleanup removes RPCs and their timers by
socket ownership even when the replacement was selected before the old close.
The request cap is not increased. These source changes have not been built,
packaged, run or verified with automated tests.

## User selection copy (source only)

Desktop now includes localized Edit menu actions using GPUI's native OS editing
selectors and the existing Input actions/keybindings. On macOS this gives the
focused WKWebView the Copy/Cut/Paste/Select All responder path required by Wry.
Windows/Linux retain their existing input action bindings and native WebView
keyboard paths.

Terminal explicitly supplies its cell-accurate selection to a native copy event for
trusted Command-C, Ctrl-C or Ctrl-Shift-C when its own terminal has nonempty
selection. Without selection Ctrl-C still reaches the PTY as interruption. Text
in other inputs, clipboard-request dialogs and non-terminal panes retains its own
editing behavior. No clipboard read, Host API endpoint, iframe-origin relaxation
or unrestricted JavaScript clipboard permission is introduced. OSC 52 application
clipboard requests continue through their separate review UI.

Syntax/source checks only; desktop builds, browser tests and native clipboard
interaction have not been run for this change.

## Windows Gateway integration (source only)

Gateway creates Windows ConPTY sessions through the published, unmodified
portable-pty 0.9.0 API from crates.io. No portable-pty patch or vendored source is
used. Resizes,
input identities/retries, retention, replay rings, cumulative stream credit and
execution revocation use the same owners and wire protocol as macOS/Linux.
The Windows input/output workers use synchronous pipes on separate threads;
output keeps draining until ConPTY closes, including after shell exit. Explicit
close, expiry and authority revocation close the console before waiting for the
shell, with the reader and cursor-reply path alive, then join its workers.
Windows process exit uses an owned wait handle rather than a polling timer.
After that handle signals, the public Child::wait API retrieves the exit code,
including 259. Gateway does not use the library's clone-killer return value.

Gateway prepares both I/O workers before opening the PTY and supplies their
streams before spawning the shell. It answers ConPTY's initial cursor-inheritance
query with the new session's empty-viewport position (1;1), using a bounded
internal control message; the answer still works during close without a view.
Only that first query is consumed, including across pipe-read boundaries;
subsequent application queries continue to the terminal renderer. This fulfills
the documented host duty for the creation flags selected by portable-pty. A local
startup guard releases the slave and worker launch channels before closing or
joining anything on failure. The Windows API export check rejects systems without
ConPTY before the library's unsupported-platform panic path.

The default host program comes from ComSpec, with an absolute System32 cmd.exe
fallback. The child receives only the allowlisted Windows shell environment;
Gateway/provider credentials are excluded. Host profile lookup supplies a home
if USERPROFILE is missing. ConPTY carries UTF-8 independently of POSIX locale
and termios settings; explicit invalid working directories are rejected.

App provisioning now selects Linux guest artifacts on Windows x64/ARM64 using
the pinned official Microsandbox SDK, without applying Unix socket pathname
limits to its Windows named pipes. The SDK's Windows runtime is upstream preview
and requires Windows Hypervisor Platform; see the
[versioned Windows guide](https://github.com/superradcompany/microsandbox/blob/v0.7.15/docs/troubleshooting/windows.mdx).
Host PTYs require ConPTY (Windows 10 1809 / Server 2019 or newer). No WSL,
Docker or host-process fallback has been introduced.

These are source changes only. Windows builds, SDK startup, App installation,
clipboard, input/Unicode, resize and teardown require native acceptance. Existing
Desktop/Gateway binaries and packaged Terminal payloads are not rewritten.

## Validation boundary

Initial architecture adaptation was inspected in source only. A subsequent local
Linux arm64 build on November 13, 2026 passed UI/server compilation, TypeScript
checking and package verification using the pinned Node 26 / Debian builder in
Microsandbox. The resulting development archive contains ready payloads and their
actual member-tree checksums. The build did not publish a release.

Automated tests, App installation, Gateway startup and App execution were not run.
WebView behavior and host terminal interaction still require manual acceptance.
A source checkout remains a build template rather than an installable package.

## Gateway WebAssembly UI policy

Gateway's App response policy includes `wasm-unsafe-eval` in `script-src` for all
installed App interfaces. This permits Ghostty 0.5.10's
`WebAssembly.compileStreaming` / `WebAssembly.compile` without enabling JavaScript
string evaluation (`unsafe-eval`), in accordance with
[CSP's WebAssembly compilation rules](https://www.w3.org/TR/CSP3/#can-compile-wasm-bytes).
This is a platform-wide App policy, with no Terminal-specific exception.

The missing directive identified during source review has been corrected in
Gateway source. The correction remains uncommitted and has not been validated in
a running WebView. Terminal still reports engine load failure if compilation or
asset loading fails. The managed `wasm` backend runtime is separate from browser
WebAssembly execution; an App can use browser WebAssembly with any backend runtime.
