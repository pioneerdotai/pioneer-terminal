"""Verify built artifact data without executing application code or binaries."""

import argparse
import hashlib
import json
import struct
import tarfile
from pathlib import Path, PurePosixPath


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(stream):
    result = hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        result.update(chunk)
    return result.hexdigest()


def local_path(root, name):
    path = PurePosixPath(name)
    require(not path.is_absolute() and ".." not in path.parts and "\\" not in name,
            f"Invalid relative path: {name}")
    result = root.joinpath(*path.parts).resolve()
    require(result.is_relative_to(root), f"Path escapes package: {name}")
    return result


def verify(directory):
    root = directory.resolve()
    for line in (root / "SHA256SUMS").read_text().splitlines():
        expected, name = line.split("  ", 1)
        with local_path(root, name).open("rb") as stream:
            require(digest(stream) == expected, f"Package checksum mismatch: {name}")
    proposal = json.loads((root / "runtime.proposal.json").read_text())
    results = []
    for target, artifact in proposal["artifacts"].items():
        machine = {"linux-x64": 62, "linux-arm64": 183}[target]
        records = json.loads(local_path(root, artifact["files"]).read_text())
        entries = {entry["path"]: entry for entry in records}
        require(len(entries) == len(records), f"Duplicate index entries: {target}")
        archive = local_path(root, artifact["archive"])
        with archive.open("rb") as stream:
            require(digest(stream) == artifact["sha256"], f"Archive hash mismatch: {target}")
        found = set()
        total = 0
        native_count = 0
        native_pty = False
        runtime_target = None
        with tarfile.open(archive, "r|gz") as members:
            for member in members:
                local_path(root, member.name)
                require(member.name.split("/")[0] == "runtime", "Unexpected archive root")
                if member.isdir():
                    continue
                require(member.isfile(), f"Special file or link: {member.name}")
                require(member.name not in found, f"Duplicate archive entry: {member.name}")
                entry = entries[member.name]
                require(member.size == entry["size"] and member.mode & 0o777 == entry["mode"],
                        f"File size/mode mismatch: {member.name}")
                require(total + member.size <= 100 * 1024 * 1024, "Runtime exceeds size budget")
                stream = members.extractfile(member)
                header = stream.read(20)
                hasher = hashlib.sha256(header)
                capture = bytearray(header) if member.name == "runtime/runtime-target.json" else None
                while chunk := stream.read(1024 * 1024):
                    hasher.update(chunk)
                    if capture is not None:
                        capture.extend(chunk)
                require(hasher.hexdigest() == entry["sha256"], f"File hash mismatch: {member.name}")
                if header.startswith(b"\x7fELF"):
                    require(header[4] == 2 and header[5] == 1 and
                            struct.unpack_from("<H", header, 18)[0] == machine,
                            f"Wrong ELF architecture: {member.name}")
                    native_count += 1
                    if member.name == "runtime/node_modules/node-pty/build/Release/pty.node":
                        native_pty = True
                if capture is not None:
                    runtime_target = json.loads(capture)
                found.add(member.name)
                total += member.size
        require(found == set(entries), f"Missing files: {target}")
        require(native_count > 0 and native_pty,
                f"Missing native PTY: {target}")
        require(runtime_target and runtime_target["platform"] == "linux" and
                runtime_target["arch"] == target.split("-")[1] and
                runtime_target["nodeModulesABI"] == artifact["nodeModulesABI"],
                f"Wrong runtime target metadata: {target}")
        require(total == artifact["unpackedBytes"] and len(found) == artifact["runtimeFileCount"],
                f"Wrong package statistics: {target}")
        require(total <= 100 * 1024 * 1024, f"Runtime exceeds size budget: {target}")
        results.append({"target": target, "files": len(found), "unpackedBytes": total,
                        "nativeELFFiles": native_count, "sha256": artifact["sha256"]})
    require(set(proposal["artifacts"]) == {"linux-x64", "linux-arm64"}, "Incomplete architecture set")
    print(json.dumps({"scope": "artifact data only; application not executed", "results": results}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path)
    directory = parser.parse_args().directory
    if directory is None:
        project = Path(__file__).resolve().parents[2]
        app = json.loads((project / "app.json").read_text())
        directory = project / "dist/pioneer" / f"{app['slug']}-{app['version']}"
    verify(directory)
