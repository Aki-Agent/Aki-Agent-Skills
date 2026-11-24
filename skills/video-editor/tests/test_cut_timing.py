"""Regression coverage for chunked cut duration validation."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from cuts import rebuild
from ffmpeg_lib import ToolError


class ChunkTimingTests(unittest.TestCase):
    def run_rebuild(self, chunk_duration=0.54, output_duration=5.4, audio_end=5.4):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output = root / "input.mp4", root / "output.mp4"
            video = {"codec_type": "video", "r_frame_rate": "30/1",
                     "start_time": "0", "duration": str(output_duration)}
            audio = {"codec_type": "audio", "sample_rate": "44100", "channels": 2,
                     "start_time": "0", "duration": str(audio_end)}

            def fake_probe(path):
                if Path(path) == source:
                    return {"streams": [video, audio]}
                if Path(path) == output:
                    return {"streams": [video, audio]}
                return {"format": {"duration": str(chunk_duration)}}

            ranges = [{"start": i * 1.0, "end": i + 0.5} for i in range(10)]
            with patch("cuts.probe", side_effect=fake_probe), \
                 patch("cuts.run_ffmpeg"), \
                 patch("cuts.output_report", return_value={"duration_seconds": output_duration}):
                return rebuild(source, ranges, output, True, chunked=True, chunk_seconds=60)

    def test_accepts_accumulated_encoder_padding(self):
        result = self.run_rebuild()
        self.assertEqual(result["duration_seconds"], 5.4)

    def test_rejects_incomplete_chunk(self):
        with self.assertRaisesRegex(ToolError, "Chunk 0 duration"):
            self.run_rebuild(chunk_duration=0.2)

    def test_rejects_incomplete_concatenation(self):
        with self.assertRaisesRegex(ToolError, "expected timeline"):
            self.run_rebuild(output_duration=4.8)

    def test_rejects_desynchronized_endpoints(self):
        with self.assertRaisesRegex(ToolError, "audio/video endpoints"):
            self.run_rebuild(audio_end=4.8)


if __name__ == "__main__":
    unittest.main()
