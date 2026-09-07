import importlib.machinery
import importlib.util
import unittest
import struct
from unittest.mock import patch
from pathlib import Path

path = str(Path(__file__).with_name('game-focus'))
loader = importlib.machinery.SourceFileLoader('game_focus', path)
spec = importlib.util.spec_from_loader(loader.name, loader)
focus = importlib.util.module_from_spec(spec)
loader.exec_module(focus)


class Selection(unittest.TestCase):
    def test_background_wrapper(self):
        self.assertEqual(focus.select(553850, [('gamescope', False), ('terminal', True)], [553850]), 'desktop')

    def test_foreground_wrapper(self):
        self.assertEqual(focus.select(553850, [('gamescope', True), ('terminal', False)], [553850]), 'game')

    def test_ambiguity_never_guesses(self):
        for windows, owners in [
            ([('gamescope', False)], [553850]),
            ([('gamescope', False), ('terminal', True)], [570]),
            ([('gamescope', True), ('gamescope', False)], [553850]),
            ([('gamescope', False), ('terminal', True)], [553850, 570]),
            ([('gamescope', True), ('terminal', True)], [553850]),
            ([('terminal', True)], [553850]),
        ]:
            self.assertEqual(focus.select(553850, windows, owners), 'unknown')


class Protocol(unittest.TestCase):
    def snapshot(self, messages):
        class Socket:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def settimeout(self, value): pass
            def connect(self, address): pass
            def sendall(self, message): pass
            def recv(self, size):
                # Fragment headers and payloads like a stream socket can.
                result = self.data[:3]
                self.data = self.data[3:]
                return result
        sock = Socket()
        sock.data = messages
        with patch.object(focus.socket, 'socket', return_value=sock), patch.dict(focus.os.environ, {
            'WAYLAND_DISPLAY': 'wayland-test', 'XDG_RUNTIME_DIR': '/tmp',
        }):
            return focus.windows()

    def message(self, obj, opcode, body=b''):
        return struct.pack('=II', obj, ((8 + len(body)) << 16) | opcode) + body

    def string(self, value):
        raw = value.encode() + b'\0'
        return struct.pack('=I', len(raw)) + raw + b'\0' * (-len(raw) % 4)

    def test_fragmented_snapshot(self):
        u = lambda n: struct.pack('=I', n)
        m = self.message
        stream = m(2, 0, u(9) + self.string('zwlr_foreign_toplevel_manager_v1') + u(3))
        stream += m(3, 0, u(0)) + m(4, 0, u(100))
        stream += m(100, 1, self.string('gamescope')) + m(100, 4, u(4) + u(2))
        stream += m(100, 5) + m(5, 0, u(0))
        self.assertEqual(self.snapshot(stream), [['gamescope', True]])

    def test_unsupported_protocol(self):
        self.assertEqual(self.snapshot(self.message(3, 0, struct.pack('=I', 0))), [])

    def test_disconnect_is_not_desktop(self):
        with self.assertRaises(EOFError):
            self.snapshot(b'')

    def test_invalid_header_is_not_desktop(self):
        with self.assertRaises(ValueError):
            self.snapshot(struct.pack('=II', 2, 4 << 16))


if __name__ == '__main__':
    unittest.main()
