#!/usr/bin/env python3
"""Serve the atlas locally and tell the browser to re-check every file.

Python's built-in server sends no caching headers, so browsers may keep using
old copies of the scripts after an update. This one sends
`Cache-Control: no-cache`, which makes the browser revalidate each file (an
unchanged file still comes back as a cheap 304).

    python3 scripts/serve.py [port]    # default port 8001
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer(('', port), handler) as httpd:
        print(f'Serving the atlas at http://localhost:{port} (Ctrl+C to stop)')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
