"""Regression coverage for smooth punch-in transitions."""
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from enhance import build_graph, _encode_enhanced_chunks
from ffmpeg_lib import run_ffmpeg, tool_path


class SmoothZoomTests(unittest.TestCase):
    def test_ramp_continues_across_chunk_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, full, chunked = (root / name for name in ("source.mp4", "full.mp4", "chunked.mp4"))
            run_ffmpeg(["-f", "lavfi", "-i", "color=black:s=160x240:r=30:d=2",
                        "-vf", "drawgrid=w=20:h=20:t=2:c=white",
                        "-c:v", "libx264", "-crf", "0", "-pix_fmt", "yuv420p", str(source)])
            events = [{"type": "punch", "start": 0.8, "end": 1.8,
                       "zoom": 1.5, "center": [0.5, 0.4], "index": 0}]
            _, graph = build_graph(events, 160, 240, None, fps=30)
            run_ffmpeg(["-i", str(source), "-filter_complex", graph, "-map", "[vout]",
                        "-an", "-c:v", "libx264", "-crf", "0", "-pix_fmt", "yuv420p", str(full)])
            _encode_enhanced_chunks(
                video=source, events=events, output=chunked, width=160, height=240,
                fps=30, duration=2, crf=0, preset="ultrafast", ass=None, audio_info=None,
                renders_dir=root, chunk_seconds=1, chunk_timeout=30, started=time.time())

            def frames(path):
                data = subprocess.run([tool_path("ffmpeg"), "-v", "error", "-i", str(path),
                                       "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                                      capture_output=True, check=True).stdout
                size = 160 * 240
                return [data[i:i + size] for i in range(0, len(data), size)]

            reference, pieces = frames(full), frames(chunked)
            self.assertEqual(len(reference), 60)
            self.assertEqual(len(pieces), len(reference))
            def difference(a, b):
                return sum(abs(x - y) for x, y in zip(a, b)) / len(a)
            self.assertGreater(difference(reference[24], reference[29]), 3)
            self.assertGreater(difference(reference[29], reference[33]), 3)
            for index in range(27, 35):
                self.assertLess(difference(reference[index], pieces[index]), 1,
                                f"zoom changed at frame {index}")


if __name__ == "__main__":
    unittest.main()
