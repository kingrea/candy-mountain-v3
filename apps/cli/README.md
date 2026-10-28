# @candy-mountain/cli

`candy-mountain` runs the built daemon (`apps/daemon/dist`) and web server (`apps/web/.output`) like an app: in the background, or as a systemd user service that starts at boot.

## Setup

```bash
pnpm install && pnpm build
ln -s "$PWD/apps/cli/dist/index.mjs" ~/.local/bin/candy-mountain
```

The CLI finds the repository from its own real path, so the checkout must stay where it is and the symlink must point into it. Before linking, `node apps/cli/dist/index.mjs <command>` works from any directory.

## Commands

| Command | What it does |
| --- | --- |
| `start` | Starts both in the background, waits until each is healthy |
| `stop` | Stops web then daemon (SIGTERM, SIGKILL after `--timeout`, default 15 s) |
| `restart` | `stop`, then `start` |
| `status` | One line per process with URL, pid and health; exit 3 if either is down |
| `logs` | Tails the daemon log; `--web`, `--all`, `-n <lines>`, `--no-follow` |
| `run` | Runs both in the foreground until SIGTERM; this is what the service runs |
| `install-service` | Installs and starts the systemd user service (below) |
| `uninstall-service` | Stops, disables and removes it |

Configuration comes from `CM_DATA_DIR`, `CM_DAEMON_HOST`, `CM_DAEMON_PORT`, `CM_WEB_HOST`, `CM_WEB_PORT` (see `apps/daemon/README.md`). Logs go to `<data dir>/logs/`, pid files to `<data dir>/run/`.

## Running as a systemd user service

A user service keeps Candy Mountain running across reboots without root. It needs systemd as the init system and a reachable user manager (`systemctl --user status` works). Without them `install-service` explains what is missing, exits 1 and writes nothing; `candy-mountain start` still works.

### WSL: turn systemd on first

WSL boots without systemd unless asked. Add this to `/etc/wsl.conf` (as root, alongside any existing sections):

```ini
[boot]
systemd=true
```

Then run `wsl.exe --shutdown` from Windows (PowerShell or cmd), open a new WSL terminal, and check that `systemctl --user status` no longer prints `Failed to connect to bus`.

WSL only boots its VM when something opens it, and it can stop an idle distro after the last WSL terminal closes even while services run. So on WSL "survives a reboot" means the service comes back without any command once WSL is running again; it does not by itself start WSL at Windows logon. A plain Linux server starts it at boot.

### Install

```bash
pnpm build
candy-mountain install-service
```

This:

1. Checks that systemd user services are available and that the CLI, daemon and web server are built.
2. Stops any copy started with `candy-mountain start`, so the service can take over the ports.
3. Creates `~/.config/candy-mountain/service.env` (mode 0600) if it does not exist, with the resolved `CM_DATA_DIR`, ports, and your current `PATH` (the service does not read your shell profile, and the daemon runs tools such as `git` and `bd`). An existing file is kept as is.
4. Writes `~/.config/systemd/user/candy-mountain.service`: `Type=simple`, `ExecStart=<absolute node> <repo>/apps/cli/dist/index.mjs run`, `EnvironmentFile=` the file above, `Restart=on-failure`, `TimeoutStopSec=45`, `WantedBy=default.target`.
5. Runs `systemctl --user daemon-reload`, `systemctl --user enable --now candy-mountain.service` (plus `restart` when it was already running on an older unit), and `loginctl enable-linger $USER`, printing each command.
6. Waits for both health checks and prints the URL.

Lingering lets your user manager, and so the service, start at boot without a login session. If `loginctl enable-linger` is refused, run `sudo loginctl enable-linger $USER`.

The unit holds the absolute path of the node that ran `install-service`. After switching node versions with nvm, run `install-service` again so the unit follows; it also picks up a moved checkout.

### Secrets key and other settings

Secrets never go in the unit. Set the key in the environment file and restart:

```bash
$EDITOR ~/.config/candy-mountain/service.env    # uncomment CM_SECRETS_KEY=<openssl rand -base64 32>
systemctl --user restart candy-mountain
```

Keep a copy of the key somewhere other than the data directory. Ports and the data directory are changed in the same file. While the service is installed the CLI reads `CM_*` values from this file in preference to the shell, so `status` and `logs` look where the service actually runs.

### Day to day

With the service installed, `candy-mountain start`, `stop` and `restart` call `systemctl --user start|stop|restart candy-mountain.service`, and `status` adds a `service` line with the unit's active and enabled state. `candy-mountain logs` still tails the daemon and web logs; journald (`journalctl --user -u candy-mountain`) only holds the supervisor's own lines.

### Checking after a reboot

```bash
systemctl --user status candy-mountain   # active (running)
candy-mountain status                    # daemon and web running, healthy; service active, enabled
loginctl show-user "$USER" --property=Linger   # Linger=yes
```

### Uninstall

```bash
candy-mountain uninstall-service
```

Runs `systemctl --user disable --now candy-mountain.service`, deletes the unit, then `daemon-reload` and `reset-failed`. It keeps `~/.config/candy-mountain/service.env` (it may hold your secrets key) and leaves lingering on, since other user services may rely on it; `loginctl disable-linger $USER` turns it off. If systemd is no longer available it just removes the unit file.
