"""Focused regression tests for sandbox-derived video-editor fixes."""
from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from ffmpeg_lib import ToolError, run_ffmpeg, probe, duration_of, frame_rate_of, stream_of  # noqa: E402
from edit import cmd_trim, build_parser  # noqa: E402
from silence import (DEFAULT_MIN_SILENCE_SECONDS, DEFAULT_SPEECH_PAD_SECONDS,
                     keep_ranges, remove_silence)  # noqa: E402
from transcribe import _cached_model_path, default_cache_dir, _has_faster_whisper  # noqa: E402
from subtitles import cap_cues_to_duration  # noqa: E402
from cuts import _chunk_ranges  # noqa: E402
from enhance import _chunk_events, _slice_ass, _encode_enhanced_chunks, build_graph  # noqa: E402


class SubtitleDurationTests(unittest.TestCase):
    def test_caps_final_hold_to_ass_centisecond(self):
        cues = [{"start": 9.1, "end": 11.0, "duration": 1.9}]
        count = cap_cues_to_duration(cues, 10.123)
        self.assertEqual(count, 1)
        self.assertEqual(cues[0]["end"], 10.12)
        self.assertEqual(cues[0]["duration"], 1.02)

    def test_rejects_cue_start_outside_media(self):
        with self.assertRaisesRegex(ToolError, "outside the 10.000s video"):
            cap_cues_to_duration([{"start": 10.0, "end": 10.4}], 10.0)

    def test_rejects_non_positive_centisecond_duration(self):
        with self.assertRaisesRegex(ToolError, "no positive duration"):
            cap_cues_to_duration([{"start": 10.12, "end": 10.2}], 10.123)


class SilenceProfileTests(unittest.TestCase):
    def test_default_profile_is_tighter_than_original_conservative_values(self):
        self.assertEqual(DEFAULT_MIN_SILENCE_SECONDS, 0.8)
        self.assertEqual(DEFAULT_SPEECH_PAD_SECONDS, 0.08)
        self.assertLess(DEFAULT_SPEECH_PAD_SECONDS, 0.15)

    def test_kept_audio_ranges_retain_requested_pad(self):
        silences = [{"start": 1.0, "end": 2.0, "duration": 1.0}]
        ranges = keep_ranges(silences, total=4.0, pad=0.08)
        self.assertEqual(len(ranges), 2)
        self.assertAlmostEqual(ranges[0]["end"], 1.08)
        self.assertAlmostEqual(ranges[1]["start"], 1.92)

    def test_short_silence_inside_padding_does_not_create_duplicate_ranges(self):
        silences = [{"start": 1.0, "end": 1.1, "duration": 0.1}]
        ranges = keep_ranges(silences, total=4.0, pad=0.08)
        self.assertEqual(len(ranges), 1)
        self.assertAlmostEqual(ranges[0]["start"], 0.0)
        self.assertAlmostEqual(ranges[0]["end"], 4.0)


class TranscriptionCacheTests(unittest.TestCase):
    def test_probe_python_import_has_a_finite_timeout(self):
        from unittest.mock import patch
        import subprocess
        with patch('transcribe.subprocess.run', side_effect=subprocess.TimeoutExpired('python', 20)):
            self.assertFalse(_has_faster_whisper(sys.executable))

    def test_discovers_huggingface_snapshot_in_configured_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            snapshot = cache / 'models--Systran--faster-whisper-base' / 'snapshots' / 'test-revision'
            snapshot.mkdir(parents=True)
            (snapshot / 'model.bin').write_bytes(b'test')
            self.assertEqual(_cached_model_path(cache, 'base'), snapshot)

            from unittest.mock import patch
            with patch.dict(os.environ, {'WHISPER_CACHE_DIR': str(cache)}):
                self.assertEqual(default_cache_dir(), cache)

    def test_cache_only_loader_fails_fast_for_uncached_model(self):
        from local_transcribe import _load_model
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ToolError, "not cached"):
                _load_model('nonexistent-model', directory, offline=True, threads=1)


class ChunkTests(unittest.TestCase):
    def test_splits_ranges_without_gaps_or_overlaps(self):
        ranges = [{"start": 1.0, "end": 26.0}]
        chunks = _chunk_ranges(ranges, 12.0)
        self.assertEqual([(x["start"], x["end"]) for x in chunks],
                         [(1.0, 13.0), (13.0, 25.0), (25.0, 26.0)])
        self.assertEqual(sum(x["duration"] for x in chunks), 25.0)

    def test_rejects_non_positive_chunk_duration(self):
        with self.assertRaisesRegex(ToolError, "greater than zero"):
            _chunk_ranges([{"start": 0.0, "end": 1.0}], 0)


class EnhancementChunkTests(unittest.TestCase):
    def test_events_are_clipped_and_shifted_to_chunk_clock(self):
        event = {"type": "callout", "start": 8.0, "end": 16.0, "render": "/tmp/card.mov"}
        first = _chunk_events([event], 0.0, 12.0)[0]
        second = _chunk_events([event], 12.0, 20.0)[0]
        self.assertEqual((first["start"], first["end"]), (8.0, 12.0))
        self.assertEqual((first["_render_trim_start"], first["_render_trim_end"]), (0.0, 4.0))
        self.assertEqual((second["start"], second["end"]), (0.0, 4.0))
        self.assertEqual((second["_render_trim_start"], second["_render_trim_end"]), (4.0, 8.0))

    def test_ass_cues_are_clipped_and_shifted(self):
        source = """[Script Info]
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:10.50,0:00:16.00,Default,,0,0,0,,Crosses chunk
Dialogue: 0,0:00:18.00,0:00:23.90,Default,,0,0,0,,Later cue
"""
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "input.ass"
            output_path = Path(directory) / "slice.ass"
            input_path.write_text(source, encoding="utf-8")
            _slice_ass(input_path, 12.0, 24.0, output_path)
            dialogue = [line for line in output_path.read_text(encoding="utf-8").splitlines()
                        if line.startswith("Dialogue:")]
            self.assertEqual(len(dialogue), 2)
            self.assertIn("0:00:00.00,0:00:04.00", dialogue[0])
            self.assertIn("0:00:06.00,0:00:11.89", dialogue[1])

    def test_layout_and_overlay_input_indices_are_sequential(self):
        events = [
            {"type": "split", "start": 2.0, "end": 8.0, "person": "bottom",
             "person_y": 0.15, "component": "/tmp/panel.html",
             "panel_component": "/tmp/panel.html", "panel_params": {},
             "render": "/tmp/panel.mov", "panel_render": "/tmp/panel.mov"},
            {"type": "callout", "start": 1.0, "end": 4.0, "component": "/tmp/card.html",
             "params": {}, "render": "/tmp/card.mov"},
        ]
        inputs, graph = build_graph(events, 480, 854, None, source_label="[vsrc]")
        self.assertEqual(inputs, ["-i", "/tmp/panel.mov", "-i", "/tmp/card.mov"])
        self.assertIn("[1:v]", graph)
        self.assertIn("[2:v]", graph)


class ChunkedSubtitleBurnTests(unittest.TestCase):
    def test_burns_ass_across_chunks_and_fully_decodes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.mp4'
            output = root / 'burned.mp4'
            ass = root / 'subs.ass'
            ass.write_text("""[Script Info]
ScriptType: v4.00+
PlayResX: 64
PlayResY: 64

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,12,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,1,0,2,4,4,4,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.40,0:00:01.40,Default,,0,0,0,,first chunk
Dialogue: 0,0:00:01.50,0:00:02.20,Default,,0,0,0,,second chunk
""", encoding='utf-8')
            run_ffmpeg([
                '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10:d=2.2',
                '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.2', '-shortest',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', str(source),
            ])
            info = probe(source)
            video = stream_of(info, 'video')
            report = _encode_enhanced_chunks(
                video=source, events=[], output=output, width=64, height=64,
                fps=frame_rate_of(video), duration=duration_of(info), crf=28,
                preset='ultrafast', ass=ass, audio_info=stream_of(info, 'audio'),
                renders_dir=root, chunk_seconds=1.0, chunk_timeout=10,
                started=time.time(),
            )
            self.assertEqual(report['chunk_count'], 3)
            self.assertLessEqual(abs(report['duration_seconds'] - duration_of(info)), 0.25)
            run_ffmpeg(['-v', 'error', '-i', str(output), '-f', 'null', '-'])


class AtomicFfmpegTests(unittest.TestCase):
    def test_failed_ffmpeg_does_not_publish_partial_output(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "broken.mp4"
            with self.assertRaises(ToolError):
                run_ffmpeg(["-f", "lavfi", "-i", "not-a-filter", str(target)])
            self.assertFalse(target.exists())
            self.assertFalse(list(Path(directory).glob("*.part-*.mp4")))

    def test_trim_cli_writes_atomic_output_and_reports_real_probe(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.mp4'
            target = Path(directory) / 'trim.mp4'
            run_ffmpeg([
                '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10:d=0.4',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                str(source),
            ])
            args = build_parser().parse_args([
                'trim', str(source), '--start', '0.1', '--duration', '0.2',
                '--preset', 'ultrafast', '--output', str(target),
            ])
            self.assertEqual(cmd_trim(args), 0)
            self.assertTrue(target.is_file())
            self.assertFalse(list(Path(directory).glob('*.part-*.mp4')))

    def test_silence_edit_never_overwrites_its_input(self):
        from argparse import Namespace
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.mp4'
            run_ffmpeg([
                '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10:d=0.5',
                '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-shortest',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', str(source),
            ])
            original_size = source.stat().st_size
            args = Namespace(
                input=str(source), noise='-30dB', min_silence=0.8, pad=0.08,
                start=None, end=None, chunked=False, chunk_seconds=8.0,
                chunk_timeout=30.0, plan_only=False, output=str(source),
                output_dir=None, audio_bitrate='128k', crf=20, preset='veryfast',
            )
            with self.assertRaisesRegex(ToolError, 'source is never overwritten'):
                remove_silence(args)
            self.assertEqual(source.stat().st_size, original_size)

    def test_late_output_path_is_not_mistaken_for_an_option_value(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'late-options.mp4'
            run_ffmpeg([
                '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10:d=0.2',
                '-vf', 'scale=64:64', '-c:v', 'libx264', '-preset', 'ultrafast',
                '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(target),
            ])
            self.assertTrue(target.is_file())
            self.assertFalse(list(Path(directory).glob('*.part-*.mp4')))

    def test_completed_ffmpeg_is_atomically_published(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "short.mp4"
            run_ffmpeg([
                "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10:d=0.2",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=0.2",
                "-shortest", "-c:v", "libx264", "-preset", "ultrafast",
                "-pix_fmt", "yuv420p", "-c:a", "aac", str(target),
            ])
            self.assertGreater(target.stat().st_size, 0)
            self.assertFalse(list(Path(directory).glob("*.part-*.mp4")))


if __name__ == "__main__":
    unittest.main()
