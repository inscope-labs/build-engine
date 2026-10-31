#!/usr/bin/env python3
"""Stopping a process tree.

`wrangler dev` starts the Cloudflare runtime, and the runtime is started in a process group
of its own. Stopping the launcher therefore does NOT stop the runtime: it is orphaned, it
keeps the port, it keeps the binary open, and it keeps running after the test that started it
has finished.

That matters in three ways, and all three have bitten:

  - a "restart" in a test is not a restart at all, because the old Worker is still there
    answering with the settings it had before. A test that believes it restarted the gateway
    has tested nothing;
  - the port is not released, so the next run cannot bind it;
  - the runtime's binary stays open, so `npm ci` cannot remove node_modules.

So the whole tree is stopped, not just the launcher.

Not shipped in releases: it is a test fixture.
"""
import os
import signal
import subprocess
import time
from pathlib import Path


def _children():
    """Every process's parent, read from /proc."""
    children = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / "stat").read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        # The command field may contain spaces and parentheses, so the fields after it are
        # counted from the last ')'.
        try:
            tail = stat[stat.rindex(")") + 2:].split()
            children.setdefault(int(tail[1]), []).append(int(entry.name))
        except (ValueError, IndexError):
            continue
    return children


def descendants(pid):
    """Every descendant of a process."""
    children = _children()
    out = []
    stack = [pid]
    seen = set()
    while stack:
        current = stack.pop()
        for child in children.get(current, []):
            if child in seen:
                continue
            seen.add(child)
            out.append(child)
            stack.append(child)
    return out


def stop(process, timeout=20):
    """Stop a process and everything it started, and wait until they are gone.

    The launcher is stopped FIRST, on purpose. The runtime is started in a process group of
    its own and the launcher will start it again if it notices that it died - so a teardown
    that kills the runtime first and the launcher second is a race, and the runtime that
    comes back survives the sweep. Stopping the launcher first means nothing can be started
    after the sweep.
    """
    if process is None:
        return
    tree = descendants(process.pid)

    # 1. the launcher
    _signal(process.pid, signal.SIGTERM)
    deadline = time.time() + min(timeout, 5)
    while time.time() < deadline and process.poll() is None:
        time.sleep(0.1)
    if process.poll() is None:
        _signal(process.pid, signal.SIGKILL)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass

    # 2. what it had started
    for pid in reversed(tree):
        _signal(pid, signal.SIGTERM)
    deadline = time.time() + min(timeout, 5)
    while time.time() < deadline and _alive(tree):
        time.sleep(0.1)
    for pid in reversed(tree):
        _signal(pid, signal.SIGKILL)

    # 3. anything the launcher left orphaned when it died
    sweep_orphans()


def _signal(pid, sig):
    try:
        os.kill(pid, sig)
    except (ProcessLookupError, PermissionError, OSError):
        pass


# The runtime binaries this repository's tests start. A process that is running one of them
# and has no parent is one whose launcher died, and it has to go too.
RUNTIME_MARKERS = (
    "@cloudflare/workerd-linux-64/bin/workerd",
    "@esbuild/linux-x64/bin/esbuild",
)


def sweep_orphans():
    """Stop the runtime processes that were orphaned when their launcher died."""
    for pid, ppid, cmdline in _processes():
        if ppid != 1:
            continue
        if not any(marker in cmdline for marker in RUNTIME_MARKERS):
            continue
        _signal(pid, signal.SIGTERM)
    time.sleep(0.5)
    for pid, ppid, cmdline in _processes():
        if ppid != 1:
            continue
        if not any(marker in cmdline for marker in RUNTIME_MARKERS):
            continue
        _signal(pid, signal.SIGKILL)


def _processes():
    """Every process: its pid, its parent and its command line."""
    out = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        try:
            stat = (entry / "stat").read_text(encoding="utf-8", errors="replace")
            cmdline = (entry / "cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
        except OSError:
            continue
        try:
            ppid = int(stat[stat.rindex(")") + 2:].split()[1])
            state = stat[stat.rindex(")") + 2:].split()[0]
        except (ValueError, IndexError):
            continue
        if state == "Z":
            # A zombie holds nothing: it has released its files and its ports.
            continue
        out.append((pid, ppid, cmdline))
    return out


def _alive(pids):
    for pid in pids:
        try:
            os.kill(pid, 0)
        except (ProcessLookupError, PermissionError, OSError):
            continue
        # A zombie is not running: it holds no resources but its own table entry.
        try:
            stat = Path("/proc/%d/stat" % pid).read_text(encoding="utf-8", errors="replace")
            if stat[stat.rindex(")") + 2:].split()[0] == "Z":
                continue
        except (OSError, ValueError, IndexError):
            continue
        return True
    return False
