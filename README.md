# Squill

[![CI](https://github.com/MaxHalford/squill/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/MaxHalford/squill/actions/workflows/ci.yml)

I write a lot of SQL queries. I enjoy the experience provided by canvas tools such as [Count.co](https://count.co/). But they're either too expensive or too feature-bloated for my needs. So I made [Squill](https://squill.dev) — a lightweight, open-source SQL editor and database client that runs (as much as possible) in your browser.

## Desktop app

Native binaries for macOS, Windows, and Linux are published on the [releases page](https://github.com/MaxHalford/squill/releases).

### macOS — first launch

The `.dmg` is unsigned (Squill does not have an Apple Developer ID — that costs $99/yr and there's no open-source exemption). After dragging Squill to `/Applications`, run this once to remove the Gatekeeper quarantine attribute:

```sh
xattr -dr com.apple.quarantine /Applications/Squill.app
```

If you'd rather not use the terminal, double-click Squill, hit Cancel on the warning, then go to **System Settings → Privacy & Security** and click **Open Anyway** at the bottom.

### Windows

The `.msi` is unsigned. SmartScreen may warn — click **More info → Run anyway**.

### Linux

`.AppImage` is portable (`chmod +x` and run). `.deb` and `.rpm` are also published for system-level install.
