"""Static dev server that disables caching, so ES modules always reload fresh.

    python3 serve.py [port]   (default 8010)
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8010
handler = partial(NoCache, directory=str(Path(__file__).parent))
print(f"halftoner on http://localhost:{port}")
ThreadingHTTPServer(("", port), handler).serve_forever()
