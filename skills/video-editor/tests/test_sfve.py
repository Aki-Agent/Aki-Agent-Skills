"""Focused tests for the SFVE review-to-edit contract."""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import sfve
from ffmpeg_lib import ToolError


class SFVEReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.project = Path(self.tmp.name)
        self.video = self.project / "tight.mp4"
        self.video.write_bytes(b"video")
        self.transcript = self.project / "tight.json"
        data = {"duration": 6.0, "segments": [
            {"start": 0.2, "end": 1.5, "words": [
                {"word": "Hola,", "start": 0.2, "end": 0.6},
                {"word": "mundo", "start": 0.8, "end": 1.1},
                {"word": "azul.", "start": 1.2, "end": 1.5}]},
            {"start": 3.0, "end": 3.8, "words": [
                {"word": "Otra", "start": 3.0, "end": 3.3},
                {"word": "frase.", "start": 3.4, "end": 3.8}]}
        ]}
        self.transcript.write_text(json.dumps(data), encoding="utf-8")
        self.baseline = self.project / "original.sfve.md"
        self.original = ("# Script\n@0000 0.200s | Hola, mundo azul.\n[zoom 2s]\n\n"
                         "@0001 3.000s | Otra frase.\n[pantalla 1s: Idea]\n")
        self.baseline.write_text(self.original, encoding="utf-8")
        self.reviewed = self.project / "reviewed.md"
        self.reviewed.write_text(self.original, encoding="utf-8")
        manifest = {"video": str(self.video), "transcript": str(self.transcript),
                    "baseline": str(self.baseline)}
        for key in ("video", "transcript", "baseline"):
            manifest[key + "_sha256"] = sfve.digest(Path(manifest[key]))
            manifest[key] = Path(manifest[key]).name
        (self.project / "sfve.json").write_text(json.dumps(manifest), encoding="utf-8")
        patcher = patch("sfve.probe", return_value={})
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = patch("sfve.duration_of", return_value=6.0)
        patcher.start()
        self.addCleanup(patcher.stop)

    def diff(self, text):
        self.reviewed.write_text(text, encoding="utf-8")
        return sfve.diff_project(self.project, self.reviewed)[1]

    def test_deletion_and_directive_changes_are_remapped(self):
        text = self.original.replace("mundo ", "").replace("[zoom 2s]", "[overlay 1s: Intro]")
        changes = self.diff(text)
        self.assertEqual([w["text"] for w in changes["deleted_words"]], ["mundo"])
        self.assertEqual(changes["cuts"][0]["from_word"], 1)
        self.assertEqual([e["type"] for e in changes["events"]], ["callout", "screen-detail"])
        self.assertAlmostEqual(changes["events"][1]["start"], 2.7)
        self.assertEqual(changes["instructions_before"]["0"], ["[zoom 2s]"])

    def test_effect_keeps_requested_length_across_deleted_speech(self):
        text = self.original.replace("mundo ", "")
        changes = self.diff(text)
        self.assertAlmostEqual(changes["events"][0]["end"] - changes["events"][0]["start"], 2.0)

    def test_removing_segment_and_suggestion_removes_both(self):
        text = "@0001 3.000s | Otra frase.\n"
        changes = self.diff(text)
        self.assertEqual([w["text"] for w in changes["deleted_words"]], ["Hola,", "mundo", "azul."])
        self.assertEqual(changes["events"], [])

    def test_text_correction_does_not_remove_audio(self):
        changes = self.diff(self.original.replace("azul.", "celeste!"))
        self.assertEqual(changes["deleted_words"], [])
        self.assertEqual(changes["text_corrections"][0]["to"], ["celeste!"])
        self.assertFalse(changes["text_corrections"][0]["audio_changed"])

    def test_punctuation_only_change_is_recorded(self):
        changes = self.diff(self.original.replace("Hola,", "Hola."))
        self.assertEqual(changes["text_corrections"][0]["to"], ["Hola."])

    def test_insertion_fails(self):
        with self.assertRaisesRegex(ToolError, "inserted or ambiguous"):
            self.diff(self.original.replace("mundo azul", "mundo muy azul"))

    def test_advanced_component_preserves_user_parameters(self):
        directive = '[efecto {"type":"counter","duration":1.5,"params":{"value":10}}]'
        changes = self.diff(self.original.replace("[zoom 2s]", directive))
        self.assertEqual(changes["events"][0]["type"], "counter")
        self.assertEqual(changes["events"][0]["params"]["value"], 10)
        self.assertAlmostEqual(changes["events"][0]["end"], 1.7)

    def test_advanced_effect_cannot_override_timestamps(self):
        directive = '[efecto {"type":"counter","duration":1,"start":4}]'
        with self.assertRaisesRegex(ToolError, "cannot override its timeline"):
            self.diff(self.original.replace("[zoom 2s]", directive))

    def test_unknown_instruction_fails(self):
        with self.assertRaisesRegex(ToolError, "unsupported edit instruction"):
            self.diff(self.original.replace("[zoom 2s]", "[dance 2s]"))

    def test_orphaned_instruction_fails_instead_of_moving_to_prior_block(self):
        text = self.original.replace("@0001 3.000s | Otra frase.\n", "")
        with self.assertRaisesRegex(ToolError, "invalid script line"):
            self.diff(text)

    def test_changed_timestamp_fails(self):
        with self.assertRaisesRegex(ToolError, "timestamps must not be edited"):
            self.diff(self.original.replace("0.200s", "0.201s"))

    def test_project_can_be_restored_at_another_path(self):
        with tempfile.TemporaryDirectory() as directory:
            moved = Path(directory) / "restored"
            shutil.copytree(self.project, moved)
            _, changes, _ = sfve.diff_project(moved, moved / "reviewed.md")
            self.assertEqual(len(changes["events"]), 2)

    def test_baseline_tampering_fails(self):
        self.baseline.write_text("modified", encoding="utf-8")
        with self.assertRaisesRegex(ToolError, "baseline is missing or changed"):
            self.diff(self.original)


if __name__ == "__main__":
    unittest.main()
