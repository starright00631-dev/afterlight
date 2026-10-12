"""Build one inspectable Afterlight release; run only after final QA is saved."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
CHANGE = WORKSPACE / "openspec" / "changes" / "unify-afterlight-studio"
MANIFEST_MEMBER = "qa/release-manifest.json"
IGNORED_PARTS = {"node_modules", ".git", ".runtime", ".cache", "scratch", "__pycache__", "fixtures"}
ROOT_SUFFIXES = {".js", ".mjs", ".css", ".html"}
CURRENT_QA_FILES = (
    "studio-night-desktop.jpg", "studio-day-desktop.jpg", "studio-mobile.jpg", "studio-compact.jpg", "studio-difference.jpg",
    "studio-report.html", "studio-readings.csv", "studio-study.json", "workspace-export.json",
)
TREE_SUFFIXES = {
    "services": {".js", ".mjs", ".json"},
    "tests": {".js", ".mjs", ".ps1", ".py"},
    "scripts": {".js", ".mjs", ".ps1", ".py"},
    "assets": {".svg", ".woff", ".woff2", ".png", ".webp"},
    "licenses": {".txt", ".md"},
    ".github": {".yml", ".yaml"},
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def source_file(path: Path) -> bytes:
    resolved = path.resolve(strict=True)
    if path.is_symlink() or not resolved.is_relative_to(ROOT):
        raise ValueError(f"Refusing a linked or outside application file: {path.name}")
    return path.read_bytes()


def payload() -> tuple[str, dict[str, bytes]]:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    version = package.get("version", "")
    if package.get("name") != "afterlight" or not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?", version):
        raise ValueError("package.json must identify an Afterlight semantic version")
    files: dict[str, bytes] = {}
    for name in ("package.json", "package-lock.json", "README.md", "PRESENTATION.md", "CREDITS.md", "Start-Afterlight.bat", "LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.md", ".gitignore", ".gitattributes"):
        files[name] = source_file(ROOT / name)
    for path in sorted(ROOT.iterdir()):
        if path.is_file() and path.suffix in ROOT_SUFFIXES and path.name != "lab-ui.js":
            files[path.name] = source_file(path)
    for folder, suffixes in TREE_SUFFIXES.items():
        for path in sorted((ROOT / folder).rglob("*")):
            relative = path.relative_to(ROOT)
            if not path.is_file() or path.suffix not in suffixes or any(part in IGNORED_PARTS for part in relative.parts):
                continue
            if relative.as_posix() in {"services/verification.json", "scripts/verify-lab-export.mjs"}:
                continue
            files[relative.as_posix()] = source_file(path)
    report = ROOT / "qa" / "CURRENT-REPORT.md"
    if not report.is_file():
        raise ValueError("Save the final qa/CURRENT-REPORT.md before packaging. No archive was written.")
    files["qa/CURRENT-REPORT.md"] = source_file(report)
    for name in CURRENT_QA_FILES:
        files["qa/" + name] = source_file(ROOT / "qa" / name)

    selected = {
        "design.md": "docs/openspec/design.md",
        "research.md": "docs/openspec/research.md",
        "specs/lighting-studies/spec.md": "docs/openspec/lighting-studies.md",
        "specs/unified-studio-experience/spec.md": "docs/openspec/unified-studio-experience.md",
    }
    for original, destination in selected.items():
        path = CHANGE / original
        if not path.is_file():
            path = ROOT / destination
        if not path.is_file():
            raise ValueError(f"Missing selected design/specification text: {original}")
        text = path.read_text(encoding="utf-8-sig")
        if original == "design.md":
            text = text.replace("See proposal.md for the problem and selected scope.", "The problem and scope are described in the delivery README.")
            text = text.replace("Use concepts/studio-night.png and concepts/studio-day.png as visual direction, not as functioning screens or scientifically calibrated raster fields. They were generated with the built-in image tool.", "Day and night concept sketches informed the visual direction. Those generated images are excluded from this release and were never functioning screens or scientifically calibrated fields.")
            text = text.replace("Research and exact source links are in research.md.", "Research and exact source links are in the adjacent research.md.")
        if original == "research.md":
            text = text.replace("The current app and release remain 2.1.0.", "This was a pre-implementation audit of version 2.1.0; the delivery README and qa/CURRENT-REPORT.md identify the current release.")
            text = text.replace("Both images show an explicitly labelled example study.", "The excluded concept sketches showed an explicitly labelled example study. The following calculation is design-reference evidence, not a live screenshot.")
        preface = "> Planning and source-research record. Use the delivery README and qa/CURRENT-REPORT.md for implemented behaviour and current verification.\n\n"
        files[destination] = (text if text.startswith(preface) else preface + text).encode("utf-8")
    room_change = WORKSPACE / "openspec" / "changes" / "craft-immersive-reading-room"
    for original, destination in {"proposal.md": "docs/openspec/reading-room-proposal.md", "design.md": "docs/openspec/reading-room-design.md", "specs/immersive-reading-room/spec.md": "docs/openspec/immersive-reading-room.md", "evidence.md": "docs/openspec/reading-room-evidence.md"}.items():
        path = room_change / original
        if not path.is_file():
            path = ROOT / destination
        text = path.read_text(encoding="utf-8-sig")
        text = text.replace("(proposal.md)", "(reading-room-proposal.md)").replace("(design.md)", "(reading-room-design.md)").replace("(evidence.md)", "(reading-room-evidence.md)")
        text = text.replace("(specs/immersive-reading-room/spec.md)", "(immersive-reading-room.md)")
        text = re.sub(r"\[`?release-baseline-rea.json`?\]\(\.?/?release-baseline-rea.json\)", "release-baseline-rea.json (raw forensic record retained in the development workspace; excluded from this package)", text)
        # Public rationale describes the evidence without publishing machine-specific paths.
        text = text.replace("`D:\\work\\afterlight-v3.0.0-release.zip`", "`afterlight-v3.0.0-release.zip`")
        text = text.replace("`D:\\work\\afterlight-release.zip`", "`afterlight-release.zip`")
        text = text.replace("`D:\\work\\afterlight-release-rea.json`", "`afterlight-release-rea.json`")
        text = text.replace("`D:\\work\\get-it-src`", "the local Get It reference checkout")
        text = re.sub(r"`[CD]:[\\/][^`\n]+`", "the local development artifact", text)
        text = text.replace("Native canvas dragging remains outside the root browser tool's acceptance scope", "The current QA records one verified native mouse drag and numeric restoration in the in-app browser; touch and other-browser coverage remain unverified")
        text = text.replace("The browser checks did not exercise native pointer dragging.", "The subsequent 3.1 clean-release check exercised one native mouse lamp drag and labelled numeric restoration, as recorded in qa/CURRENT-REPORT.md; touch and other-browser coverage remain unverified.")
        files[destination] = text.encode("utf-8")
    publish_change = WORKSPACE / "openspec" / "changes" / "publish-afterlight"
    for original, destination in {"proposal.md": "docs/openspec/publication-proposal.md", "design.md": "docs/openspec/publication-design.md", "specs/public-distribution/spec.md": "docs/openspec/public-distribution.md"}.items():
        path = publish_change / original
        if not path.is_file():
            path = ROOT / destination
        text = path.read_text(encoding="utf-8-sig").replace("See proposal.md.", "See publication-proposal.md.")
        files[destination] = text.encode("utf-8")
    return version, files


def previous_backup(target: Path) -> Path:
    data = target.read_bytes()
    previous_version = "unknown"
    try:
        with zipfile.ZipFile(target) as archive:
            old = json.loads(archive.read("afterlight/qa/release-manifest.json"))
            candidate = str(old.get("version", ""))
            if re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?", candidate):
                previous_version = candidate
    except (OSError, KeyError, ValueError, zipfile.BadZipFile):
        pass
    backup = target.parent / f"afterlight-v{previous_version}-release.zip"
    if backup.exists():
        if digest(backup.read_bytes()) == digest(data):
            return backup
        backup = target.parent / f"afterlight-v{previous_version}-{digest(data)[:12]}-release.zip"
    if backup.exists() and digest(backup.read_bytes()) != digest(data):
        raise ValueError("The intended prior-release backup already exists with different content")
    if not backup.exists():
        shutil.copy2(target, backup)
    return backup


def build(target: Path, *, replace: bool, dry_run: bool) -> dict[str, object]:
    version, files = payload()
    entries = [{"path": name, "bytes": len(data), "sha256": digest(data)} for name, data in sorted(files.items())]
    manifest = json_bytes({"application": "Afterlight", "version": version,
        "applicationRoot": "afterlight/", "entryPoint": "Start-Afterlight.bat",
        "nodeRequirement": json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["engines"]["node"], "dependencyInstallation": "npm ci",
        "verification": "qa/CURRENT-REPORT.md", "manifestExcludesOwnHash": True, "files": entries})
    if dry_run:
        return {"version": version, "payloadFiles": len(files), "manifestMember": MANIFEST_MEMBER,
            "paths": [entry["path"] for entry in entries], "archiveWritten": False}
    if target.suffix.lower() != ".zip":
        raise ValueError("The archive destination must end in .zip")
    if target.exists() and not replace:
        raise ValueError("The archive already exists. Use --replace only after approving this final package; the prior archive will be preserved separately.")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".building")
    if temporary.exists():
        raise ValueError("An unfinished .building file exists; inspect it before retrying")
    complete = dict(files)
    complete[MANIFEST_MEMBER] = manifest
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, data in sorted(complete.items()):
                item = zipfile.ZipInfo("afterlight/" + name, date_time=(2026, 1, 1, 0, 0, 0))
                item.compress_type = zipfile.ZIP_DEFLATED
                item.external_attr = 0o100644 << 16
                archive.writestr(item, data)
        with zipfile.ZipFile(temporary) as archive:
            if archive.testzip() is not None:
                raise ValueError("Archive CRC verification failed")
            if set(archive.namelist()) != {"afterlight/" + name for name in complete}:
                raise ValueError("Archive membership does not match the inclusion policy")
            for entry in entries:
                data = archive.read("afterlight/" + entry["path"])
                if len(data) != entry["bytes"] or digest(data) != entry["sha256"]:
                    raise ValueError(f"Archive payload verification failed: {entry['path']}")
            if digest(archive.read("afterlight/" + MANIFEST_MEMBER)) != digest(manifest):
                raise ValueError("Archive manifest verification failed")
        backup = previous_backup(target) if target.exists() else None
        os.replace(temporary, target)
        external_manifest = target.with_suffix(".manifest.json")
        external_manifest.write_bytes(manifest)
        receipt = {"application": "Afterlight", "version": version,
            "archive": {"file": target.name, "bytes": target.stat().st_size, "sha256": digest(target.read_bytes())},
            "manifest": {"file": external_manifest.name, "archiveMember": "afterlight/" + MANIFEST_MEMBER, "sha256": digest(manifest)},
            "payloadFiles": len(entries), "crcAndMemberHashes": "passed",
            "priorArchivePreserved": backup.name if backup else None}
        receipt_path = target.with_suffix(".receipt.json")
        receipt_path.write_bytes(json_bytes(receipt))
        return {**receipt, "receipt": receipt_path.name}
    except Exception:
        if temporary.is_file():
            temporary.unlink()
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=WORKSPACE / "afterlight-release.zip")
    parser.add_argument("--replace", action="store_true", help="Explicitly replace an existing archive after preserving a prior-release copy")
    parser.add_argument("--dry-run", action="store_true", help="Inspect planned members without writing an archive or manifest")
    args = parser.parse_args()
    try:
        print(json.dumps(build(args.output.resolve(), replace=args.replace, dry_run=args.dry_run), indent=2))
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Afterlight packaging: {error}\n")


if __name__ == "__main__":
    main()
