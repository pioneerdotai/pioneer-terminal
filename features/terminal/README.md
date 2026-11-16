# Terminal code map

`app/` owns only Next.js routing, the root layout and global styles. The Terminal
feature owns the interactive application. Its client boundary is `TerminalApp`;
server configuration, credentials and PTY providers remain outside this feature.

## Where to change the interface

| Change | File |
| --- | --- |
| Change App placement / close controls | `workspace/app-view-controls.tsx` |
| Change toolbar composition | `workspace/workspace-toolbar.tsx` |
| Change session tabs or close one shell session | `workspace/session-tabs.tsx` |
| Change the workspace composition | `workspace/workspace-view.tsx` |
| Change pane positioning, visibility or the empty workspace | `workspace/workspace-panes.tsx` |
| Change pointer/keyboard split resizing | `workspace/pane-divider.tsx` |
| Change one terminal's composition | `session/session-terminal.tsx` |
| Change Find controls | `session/terminal-find-bar.tsx` |
| Change active-terminal tools and prompt navigation buttons | `session/terminal-tools.tsx` |
| Change connection/copy messages | `session/terminal-notices.tsx` |
| Change clipboard permission review | `session/clipboard-request.tsx` |
| Change the accessible output reader | `session/output-reader.tsx` |
| Change appearance or keyboard shortcut dialogs | `settings/*-settings.tsx` |

Application-level closing and closing a shell session are different actions.
The toolbar is the place for an App control; session tabs own individual sessions.
The SDK connection is available through `client/pioneer.ts`.

## State and lifecycle ownership

- `terminal-app.tsx` loads backend state before mounting the workspace and flushes
  preferences on page visibility/unload. It closes live connections on unload.
- `workspace/workspace-view.tsx` owns the session reducer and preference hooks.
  Views receive state and actions through typed props; they do not create another
  copy of the workspace or preference stores.
- `workspace/use-workspace-geometry.ts` owns viewport measurement. Pure geometry
  and reducer rules live in `workspace/geometry.ts`, `layout-tree.ts` and `reducer.ts`.
- `workspace/use-workspace-shortcuts.ts` owns command dispatch, IME/repeat guards
  and active-session Find/prompt registrations.
- `session/use-session-terminal.ts` coordinates one live connection per
  session; `use-terminal-core.ts` owns parser loading and disposal. `use-terminal-navigation.ts` and `use-terminal-clipboard.ts` own their
  separate interaction state. Views consume those hooks; their markup does not
  establish another connection.
- `settings/use-appearance.ts` and `settings/use-shortcuts.ts` own preference
  subscriptions and persistence. `use-shortcut-recorder.ts` owns shortcut recording;
  `shortcut-list.tsx` renders the editable list. Settings components compose dialogs.

Keep terminal panes keyed by session ID and mounted at one stable level. Hidden
tabs keep receiving output; changing split geometry or zoom must not recreate
their terminal cores or WebSockets. Portal destinations belong to the workspace;
only the active session contributes its tools. Dialog focus, ARIA labels and
keyboard behavior remain part of those components' contracts.

## Related code

- `workspace/model.ts`, `reducer.ts`, `layout-tree.ts` and `geometry.ts` define the
  workspace independently of React.
- `session/live-connections.ts` tracks open connections for immediate App shutdown;
  output and session identity never enter persistent storage.
- `session/transport/connection.ts` owns the browser WebSocket lifecycle and
  bounded output consumption; `input-sequence.ts` owns input IDs, pending wire
  lengths and acknowledgments.
- `session/use-terminal-text-input-guard.ts` prevents native arrow control
  characters from entering WTerm as text before the actual keydown. It leaves
  key encoding, paste and composition to WTerm, including explicit Ctrl keys.
- `client/` owns SDK integration and the backend state mirror.
- `server/` owns HTTP, storage, session admission and PTY providers.
- `shared/terminal-protocol.ts` is the common wire contract.

See the [complete project map](../../docs/code-organization.md) for server and
build-tool responsibilities. Startup commands and the live transport remain unchanged. The state endpoint
accepts only font/shortcut preferences; session recovery has been removed.

## Theme ownership

`client/host-theme.ts` retains the SDK palette. `theme.ts` maps it to all UI
variables and the terminal parser defaults; `app/globals.css` derives hover,
selection, search and backdrop colors. `TerminalApp` applies the palette to the
whole feature, including loading and error states. Every workspace and session
receives that same theme. Font preferences never override it. The complete SDK 0.2 snapshot includes both Light/Dark configs and every native
color role. UI colors and ANSI base colors are mapped from its resolved `colors`;
font families follow the host too. Only standalone/pre-handshake defaults remain
local. No projection or selected-key copy is kept in the host subscription.
