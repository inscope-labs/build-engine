#!/usr/bin/env python3
"""A local stand-in for the GitHub contents API, so the production gateway can be exercised
without touching GitHub and without a credential.

It serves exactly what the real API serves for the call the gateway makes:

    GET /repos/{owner}/{repo}/contents/{path}?ref={sha}

  - a blob at that commit: 200, the raw bytes, with the raw media type
  - anything else (missing path, a directory, an unknown commit): 404

It also implements the JSON media type, so that a caller asking for metadata gets what GitHub
would return, including a directory listing. The gateway must refuse that: a listing is not the
named file. That is the guard the production code has, and the stub is what proves it.

Two additions, both for the operational checks of Stage 4.3:

  --record FILE   append one JSON line per request to FILE. The line holds the method, the
                  path, the query and whether an Authorization header was present. It does NOT
                  hold the credential: only the fact that one was sent, and its scheme. A
                  request log that carried the token would be a second copy of it.

  --mode-file FILE  a file whose contents select how the stub behaves, so that a test can make
                  the provider fail while the gateway is running. The modes are:
                    ok               serve the repository (the default)
                    server-error     500 on every call
                    unauthorized     401 on every call
                    rate-limited     429 on every call
                    slow             answer after a long delay, past the gateway's timeout
                    unreachable       close the connection without answering
                    repository-missing  404 on every call, as if the repository were gone

Not shipped in releases: it is a test fixture.
"""
import base64
import json
import os
import socket
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

RAW_ACCEPT = "application/vnd.github.raw"

# How long the "slow" mode takes before it answers. The gateway's SOURCE_TIMEOUT_MS is 5000
# by default, so 8 seconds is comfortably past it.
SLOW_SECONDS = 8


class Repo:
    """Reads blobs out of a local git repository, the way the contents API reads them."""

    def __init__(self, path):
        self.path = str(path)

    def _git(self, *args):
        return subprocess.run(["git", "-C", self.path] + list(args), capture_output=True)

    def commit_exists(self, ref):
        return self._git("cat-file", "-e", ref + "^{commit}").returncode == 0

    def blob(self, ref, path):
        """Return (kind, content). kind is 'blob', 'tree' or 'missing'."""
        if not self.commit_exists(ref):
            return "missing", b""
        spec = "%s:%s" % (ref, path)
        kind = self._git("cat-file", "-t", spec)
        if kind.returncode != 0:
            return "missing", b""
        if kind.stdout.strip() == b"tree":
            return "tree", b""
        if kind.stdout.strip() != b"blob":
            return "missing", b""
        content = self._git("cat-file", "blob", spec).stdout
        return "blob", content

    def entries(self, ref, path):
        """The names under a directory at that commit."""
        out = self._git("ls-tree", "--name-only", "%s:%s" % (ref, path))
        return out.stdout.decode("utf-8").splitlines()


class Handler(BaseHTTPRequestHandler):
    repo: Repo = None  # type: ignore[assignment]
    record_path: str = None  # type: ignore[assignment]
    mode_path: str = None  # type: ignore[assignment]

    def log_message(self, *a):
        pass

    def mode(self):
        """How the stub is currently behaving. The default is to serve the repository."""
        if not self.mode_path:
            return "ok"
        try:
            return Path(self.mode_path).read_text(encoding="utf-8").strip() or "ok"
        except OSError:
            return "ok"

    def record(self, method):
        """Append one line describing the request. The credential is never written down."""
        if not self.record_path:
            return
        url = urlparse(self.path)
        authorization = self.headers.get("Authorization", "")
        entry = {
            "method": method,
            "path": url.path,
            "query": url.query,
            "authorization_present": bool(authorization),
            "authorization_scheme": authorization.split(" ")[0] if authorization else "",
            "accept": self.headers.get("Accept", ""),
            "api_version": self.headers.get("X-GitHub-Api-Version", ""),
            "user_agent": self.headers.get("User-Agent", ""),
        }
        try:
            with open(self.record_path, "a", encoding="utf-8") as handle:
                handle.write(json.dumps(entry, sort_keys=True) + "\n")
        except OSError:
            pass

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _unreachable(self):
        """Close the connection without answering, as an unreachable provider would."""
        self.close_connection = True
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            self.connection.close()
        except OSError:
            pass

    def do_GET(self):
        self.record("GET")
        mode = self.mode()

        if mode == "unreachable":
            self._unreachable()
            return
        if mode == "server-error":
            return self._json(500, {"message": "Server Error"})
        if mode == "unauthorized":
            return self._json(401, {"message": "Bad credentials"})
        if mode == "rate-limited":
            return self._json(429, {"message": "API rate limit exceeded"})
        if mode == "repository-missing":
            return self._json(404, {"message": "Not Found"})
        if mode == "slow":
            time.sleep(SLOW_SECONDS)

        url = urlparse(self.path)
        parts = url.path.split("/")
        # /repos/{owner}/{repo}/contents/{path...}
        if len(parts) < 5 or parts[1] != "repos" or parts[4] != "contents":
            return self._json(404, {"message": "Not Found"})
        path = "/".join(unquote(p) for p in parts[5:])
        ref = ""
        for pair in url.query.split("&"):
            if pair.startswith("ref="):
                ref = unquote(pair[4:])
        if not ref:
            return self._json(422, {"message": "ref is required"})

        kind, content = self.repo.blob(ref, path)
        accept = self.headers.get("Accept", "")

        if kind == "blob":
            if RAW_ACCEPT in accept:
                body = content
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self._json(200, {
                    "type": "file",
                    "name": path.rsplit("/", 1)[-1],
                    "path": path,
                    "sha": ref,
                    "size": len(content),
                    "content": base64.b64encode(content).decode("ascii"),
                    "encoding": "base64",
                })
            return
        if kind == "tree":
            # GitHub returns the directory listing as JSON even when the raw media type was
            # asked for. The gateway must not serve it: a listing is not the named file.
            return self._json(200, [{"type": "file", "name": n, "path": path + "/" + n}
                                    for n in self.repo.entries(ref, path)])
        return self._json(404, {"message": "Not Found"})

    def do_POST(self):
        # The gateway must never write to the repository. If it ever does, this records it.
        self.record("POST")
        return self._json(405, {"message": "Method Not Allowed"})

    def do_PUT(self):
        self.record("PUT")
        return self._json(405, {"message": "Method Not Allowed"})

    def do_PATCH(self):
        self.record("PATCH")
        return self._json(405, {"message": "Method Not Allowed"})

    def do_DELETE(self):
        self.record("DELETE")
        return self._json(405, {"message": "Method Not Allowed"})


def serve(repo_dir, host="127.0.0.1", port=0, record_path=None, mode_path=None):
    handler = type("BoundHandler", (Handler,), {
        "repo": Repo(repo_dir),
        "record_path": record_path,
        "mode_path": mode_path,
    })
    server = ThreadingHTTPServer((host, port), handler)
    return server


def main():
    record_path = None
    mode_path = None
    args = sys.argv[1:]
    positional = []
    index = 0
    while index < len(args):
        if args[index] == "--record":
            record_path = args[index + 1]
            index += 2
        elif args[index] == "--mode-file":
            mode_path = args[index + 1]
            index += 2
        else:
            positional.append(args[index])
            index += 1

    if len(positional) < 1:
        print("usage: github_stub.py REPO_DIR [PORT] [--record FILE] [--mode-file FILE]", file=sys.stderr)
        return 2
    server = serve(positional[0],
                   port=int(positional[1]) if len(positional) > 1 else 0,
                   record_path=record_path,
                   mode_path=mode_path)
    print("github stub listening on http://%s:%d" % server.server_address[:2], flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
