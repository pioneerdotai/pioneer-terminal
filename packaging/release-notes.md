Terminal 0.1.0 for Pioneer Gateway.

Download **pioneer-terminal-0.1.0.tar.gz** and its adjacent `.sha256` file.
Extract the archive and install the `terminal-0.1.0` directory, or use the
packaged archive with Gateway's App installer. GitHub's automatic source archives
are not installable App packages.

The package contains checksummed Linux amd64 and arm64 payload directories for
Pioneer's managed Node 26 runtime. It includes no Node installation, sandbox
image, local PTY service or runtime build tools. Both payloads support clients
on macOS, Linux and Windows; the Gateway provides the host PTYs.

This release uses the current Apps runtime and Host API contract. Gateway
provides execution credentials and authenticated user identity; no separate App
consent/grant step is required. Settings, layouts and session recovery are
personal to each user within the workspace installation.

Includes pushed terminal output, bounded input and resize handling, UTF-8 input,
clipboard handling, persistent preferences and host theme integration.
