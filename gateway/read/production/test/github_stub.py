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

Not shipped in releases: it is a test fixture.
"""
import base64
import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

RAW_ACCEPT = "application/vnd.github.raw"


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

    def log_message(self, *a):
        pass

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
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


def serve(repo_dir, host="127.0.0.1", port=0):
    handler = type("BoundHandler", (Handler,), {"repo": Repo(repo_dir)})
    server = ThreadingHTTPServer((host, port), handler)
    return server


def main():
    if len(sys.argv) < 3:
        print("usage: github_stub.py REPO_DIR [PORT]", file=sys.stderr)
        return 2
    server = serve(sys.argv[1], port=int(sys.argv[2]) if len(sys.argv) > 2 else 0)
    print("github stub listening on http://%s:%d" % server.server_address[:2], flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
