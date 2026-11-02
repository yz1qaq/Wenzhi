"""The Makefile launches the real local web + AI API, without any model call."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import time
import unittest
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


class MakefileTests(unittest.TestCase):
    def test_help_explains_unified_service(self):
        result = subprocess.run(['make', 'help'], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('make run', result.stdout)
        self.assertIn('PORT=8766', result.stdout)
        self.assertIn('Ctrl+C', result.stdout)

    def test_run_launches_web_and_ai_health_together(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        proc = subprocess.Popen(['make', 'run', f'PORT={port}'], cwd=ROOT,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, start_new_session=True)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            deadline = time.monotonic() + 8
            health = None
            while time.monotonic() < deadline:
                if proc.poll() is not None:
                    self.fail('make run exited before startup: ' + proc.stdout.read())
                try:
                    with opener.open(f'http://127.0.0.1:{port}/api/health', timeout=.3) as response:
                        health = json.load(response)
                    break
                except OSError:
                    time.sleep(.05)
            self.assertEqual(health, {'ok': True, 'service': 'wenzhi'})
            with opener.open(f'http://127.0.0.1:{port}/', timeout=2) as response:
                self.assertIn('learning.js', response.read().decode())
            with opener.open(f'http://127.0.0.1:{port}/console.css', timeout=2) as response:
                self.assertEqual(response.status, 200)
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGINT)
            try:
                output = proc.communicate(timeout=4)[0]
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGTERM)
                output = proc.communicate(timeout=2)[0]
        self.assertIn('AI', output)
        self.assertIn(str(port), output)
        with socket.socket() as sock:
            sock.settimeout(.5)
            self.assertNotEqual(sock.connect_ex(('127.0.0.1', port)), 0, 'Ctrl+C must stop the service')

    def test_occupied_port_has_actionable_error(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            sock.listen()
            port = sock.getsockname()[1]
            result = subprocess.run(['make', 'run', f'PORT={port}'], cwd=ROOT,
                                    capture_output=True, text=True, timeout=8)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('端口', result.stderr)
        self.assertIn('PORT=', result.stderr)
        self.assertNotIn('Traceback', result.stderr)
