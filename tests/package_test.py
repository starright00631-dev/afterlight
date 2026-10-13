"""Black-box release checks; Python 3.9+ with no third-party modules required."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile


PROJECT = Path(__file__).resolve().parents[1]
ROOT_TEXT = (
    "README.md", "AGENTS.md", "PRESENTATION.md", "CREDITS.md", "Start-Afterlight.bat",
    "LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.md", ".gitignore", ".gitattributes",
    "docs/table-material-prompts.md",
)
RELEASE_DOCS = (
    "design.md", "research.md", "lighting-studies.md", "unified-studio-experience.md",
    "reading-room-proposal.md", "reading-room-design.md", "immersive-reading-room.md",
    "reading-room-evidence.md", "publication-proposal.md", "publication-design.md", "public-distribution.md",
)
RELEASE_QA = (
    "CURRENT-REPORT.md", "studio-night-desktop.jpg", "studio-day-desktop.jpg", "studio-mobile.jpg",
    "studio-compact.jpg", "studio-difference.jpg", "studio-report.html", "studio-readings.csv",
    "studio-study.json", "workspace-export.json", "readme-studio-night.png", "readme-studio-day.png", "readme-planner.png",
)
WORKBENCH_EVIDENCE = (
    "docs/study-planner-rationale.md", "qa/WORKBENCH-ACCEPTANCE.md",
    "qa/workbench-export.json", "qa/workbench-calendar.ics", "qa/workbench-rea-artifact.json",
    "qa/workbench-week-night.jpg", "qa/workbench-week-day.jpg", "qa/workbench-week-phone.jpg",
    "qa/workbench-review-hidden.jpg", "qa/workbench-review-phone.jpg", "qa/workbench-compact.jpg",
    "qa/workbench-static.jpg",
    "qa/CLARITY-ACCEPTANCE.md",
    "qa/clarity-calendar-day.jpg",
    "qa/clarity-calendar-night.jpg",
    "qa/clarity-calendar-phone.jpg",
    "qa/clarity-pdf-compact.jpg",
    "qa/clarity-pdf-phone.jpg",
    "qa/clarity-exports.jpg",
    "qa/clarity-workspace.json",
    "qa/clarity-readings.csv",
    "qa/WEEK-REFINEMENT-ACCEPTANCE.md", "qa/week-refinement-day.png", "qa/week-refinement-night.png",
    "qa/week-refinement-phone.png", "qa/week-refinement-compact.png", "qa/week-refinement-proposed.png",
    "qa/week-refinement-static.png", "qa/week-refinement-before.json", "qa/week-refinement-preview.json",
    "qa/week-refinement-workspace.json", "qa/week-refinement-calendar.ics",
    "qa/RELEASE-3.3.0.md", "qa/readme-week-day.png", "qa/readme-week-night.png",
)


class ReleasePackaging(unittest.TestCase):
    def setUp(self) -> None:
        # Deliberately has spaces and no dependency installation, Git metadata or
        # real development planning store. Only the public inputs are required.
        self.directory = tempfile.TemporaryDirectory(prefix="afterlight packaging ")
        self.addCleanup(self.directory.cleanup)
        self.workspace = Path(self.directory.name)
        self.root = self.workspace / "standalone checkout"
        self.root.mkdir()
        self.script = self.root / "scripts" / "package.py"
        self.script.parent.mkdir()
        shutil.copyfile(PROJECT / "scripts" / "package.py", self.script)
        self.output = self.workspace / "candidate.zip"
        self.write("package.json", json.dumps({"name": "afterlight", "version": "3.3.0", "engines": {"node": ">=22.13.0 || >=24"}}))
        self.write("package-lock.json", '{"name":"afterlight","lockfileVersion":3}\n')
        for name in ROOT_TEXT:
            self.write(name, "Committed release text: " + name + "\n")
        for name in RELEASE_DOCS:
            self.write("docs/openspec/" + name, "Committed planning text: " + name + "\n")
        for name in RELEASE_QA:
            self.write("qa/" + name, "Release evidence fixture: " + name + "\n")
        for name in (
            "index.html", "server.js", "studio-renderer.js", "style.css", "services/ai.mjs",
            "tests/example.test.js", "tests/package_test.py", "assets/lamp-brass.png", "assets/reading-book.png",
            "assets/table-oak-refined.png", "licenses/pdfjs-dist-LICENSE.txt", ".github/workflows/ci.yml",
        ):
            self.write(name, "Public payload fixture: " + name + "\n")
        for name in (
            ".env", ".git/config", "node_modules/private.js", ".runtime/server.log", "scratch/draft.js",
            "assets/fixtures/private.png", "tests/fixtures/source-fixture.pdf", "services/verification.json",
            "scripts/verify-lab-export.mjs", "lab-ui.js", "qa/old-private-record.json", "docs/unselected-private.md",
        ):
            self.write(name, "PRIVATE INPUT MUST NOT BE RELEASED\n")

    def write(self, relative: str, text: str) -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="\n") as stream:
            stream.write(text)
        return path

    def run_packager(self, *args: str, success: bool = True) -> subprocess.CompletedProcess[str]:
        result = subprocess.run([sys.executable, str(self.script), "--output", str(self.output), *args],
                                cwd=self.workspace, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result

    def add_workbench_inputs(self) -> None:
        self.write("scripts/verify-workbench-export.mjs", "Public workbench verifier fixture\n")
        for relative in WORKBENCH_EVIDENCE:
            self.write(relative, "Selected synthetic workbench fixture: " + relative + "\n")

    def test_workbench_verifier_travels_with_selected_evidence_and_rationale_only(self) -> None:
        self.add_workbench_inputs()
        for name in ("qa/workbench-private-notes.json", "qa/workbench-unselected.jpg", "qa/workbench-tests.log"):
            self.write(name, "PRIVATE INPUT MUST NOT BE RELEASED\n")
        planned = json.loads(self.run_packager("--dry-run").stdout)
        required = set(WORKBENCH_EVIDENCE) | {"scripts/verify-workbench-export.mjs"}
        self.assertTrue(required.issubset(planned["paths"]))
        self.assertFalse(any("PRIVATE" in (self.root / name).read_text(encoding="utf-8") for name in planned["paths"]))
        self.assertFalse(self.output.exists())
        self.run_packager()
        with zipfile.ZipFile(self.output) as archive:
            members = set(archive.namelist())
            for relative in required:
                self.assertEqual(archive.read("afterlight/" + relative), (self.root / relative).read_bytes())
            self.assertNotIn("afterlight/qa/workbench-private-notes.json", members)
            self.assertNotIn("afterlight/qa/workbench-unselected.jpg", members)
            self.assertNotIn("afterlight/qa/old-private-record.json", members)
            manifest = json.loads(archive.read("afterlight/qa/release-manifest.json"))
            self.assertTrue(required.issubset({entry["path"] for entry in manifest["files"]}))

    def test_missing_workbench_inputs_fail_before_writing_or_replacing_an_archive(self) -> None:
        self.add_workbench_inputs()
        for relative in ("qa/workbench-export.json", "qa/workbench-review-hidden.jpg", "docs/study-planner-rationale.md"):
            with self.subTest(relative=relative):
                path = self.root / relative
                saved = path.read_bytes()
                path.unlink()
                self.run_packager(success=False)
                self.assertFalse(self.output.exists())
                self.output.write_bytes(b"Retain the exact previous release")
                self.run_packager("--replace", success=False)
                self.assertEqual(self.output.read_bytes(), b"Retain the exact previous release")
                self.assertFalse(self.output.with_name(self.output.name + ".building").exists())
                self.assertFalse(self.output.with_suffix(".manifest.json").exists())
                self.assertFalse(self.output.with_suffix(".receipt.json").exists())
                self.assertFalse(list(self.workspace.glob("afterlight-v*-release.zip")))
                self.output.unlink()
                path.write_bytes(saved)

    def test_standalone_checkout_and_neighboring_plans_produce_same_release(self) -> None:
        first = json.loads(self.run_packager("--dry-run").stdout)
        self.assertFalse(first["archiveWritten"])
        self.assertFalse(self.output.exists())
        expected = {"AGENTS.md", "docs/table-material-prompts.md", "qa/CURRENT-REPORT.md"}
        expected.update("qa/" + name for name in ("readme-studio-night.png", "readme-studio-day.png", "readme-planner.png"))
        expected.update("docs/openspec/" + name for name in RELEASE_DOCS)
        self.assertTrue(expected.issubset(first["paths"]))
        self.assertEqual(first["paths"], sorted(first["paths"]))
        self.assertFalse(any("PRIVATE" in (self.root / name).read_text(encoding="utf-8") for name in first["paths"]))
        self.run_packager()
        original = self.output.read_bytes()
        # A stale or machine-specific sibling store cannot replace public docs.
        for change in ("unify-afterlight-studio", "craft-immersive-reading-room", "publish-afterlight"):
            path = self.workspace / "openspec" / "changes" / change / "design.md"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("PRIVATE NEIGHBOR PLAN MUST NOT BE RELEASED", encoding="utf-8")
        second = json.loads(self.run_packager("--dry-run").stdout)
        self.assertEqual(second, first)
        self.run_packager("--replace")
        self.assertEqual(self.output.read_bytes(), original)
        with zipfile.ZipFile(self.output) as archive:
            for name in RELEASE_DOCS:
                relative = "docs/openspec/" + name
                self.assertEqual(archive.read("afterlight/" + relative), (self.root / relative).read_bytes())

    def test_archive_manifest_members_hashes_and_reproducibility(self) -> None:
        receipt = json.loads(self.run_packager().stdout)
        original = self.output.read_bytes()
        manifest_bytes = self.output.with_suffix(".manifest.json").read_bytes()
        manifest = json.loads(manifest_bytes)
        self.assertEqual(receipt["archive"]["sha256"], hashlib.sha256(original).hexdigest())
        self.assertEqual(receipt["manifest"]["sha256"], hashlib.sha256(manifest_bytes).hexdigest())
        self.assertIsNone(receipt["priorArchivePreserved"])
        self.assertTrue(manifest["manifestExcludesOwnHash"])
        self.assertEqual(manifest["verification"], "qa/CURRENT-REPORT.md")
        with zipfile.ZipFile(self.output) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(set(archive.namelist()), {"afterlight/" + entry["path"] for entry in manifest["files"]} | {"afterlight/qa/release-manifest.json"})
            self.assertEqual(archive.read("afterlight/qa/release-manifest.json"), manifest_bytes)
            for entry in manifest["files"]:
                content = archive.read("afterlight/" + entry["path"])
                self.assertEqual(len(content), entry["bytes"])
                self.assertEqual(hashlib.sha256(content).hexdigest(), entry["sha256"])
        second_output = self.workspace / "second.zip"
        self.run_packager("--output", str(second_output))
        self.assertEqual(second_output.read_bytes(), original)

    def test_required_evidence_cannot_be_omitted_or_replace_existing_archive(self) -> None:
        for relative in ("qa/CURRENT-REPORT.md", "qa/readme-planner.png", "AGENTS.md", "docs/openspec/design.md"):
            with self.subTest(relative=relative):
                path = self.root / relative
                saved = path.read_bytes()
                path.unlink()
                self.output.write_bytes(b"Retain the previous release")
                self.run_packager("--replace", success=False)
                self.assertEqual(self.output.read_bytes(), b"Retain the previous release")
                self.assertFalse(self.output.with_name(self.output.name + ".building").exists())
                self.assertFalse(self.output.with_suffix(".manifest.json").exists())
                path.write_bytes(saved)

    def test_replacement_requires_flag_and_preserves_exact_prior_archive(self) -> None:
        self.run_packager()
        original = self.output.read_bytes()
        self.write("README.md", "Updated public documentation\n")
        self.run_packager(success=False)
        self.assertEqual(self.output.read_bytes(), original)
        receipt = json.loads(self.run_packager("--replace").stdout)
        backup = self.workspace / receipt["priorArchivePreserved"]
        self.assertEqual(backup.read_bytes(), original)
        self.assertNotEqual(self.output.read_bytes(), original)
        # Same version with a different archive uses the content-qualified name
        # and does not overwrite the first backup.
        second = self.output.read_bytes()
        self.write("README.md", "Another public documentation change\n")
        next_receipt = json.loads(self.run_packager("--replace").stdout)
        self.assertNotEqual(next_receipt["priorArchivePreserved"], backup.name)
        self.assertEqual((self.workspace / next_receipt["priorArchivePreserved"]).read_bytes(), second)
        self.assertEqual(backup.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
