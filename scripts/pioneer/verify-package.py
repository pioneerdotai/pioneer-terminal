"""Verify ready App payloads without executing application code or binaries."""
import argparse
import hashlib
import json
import struct
from pathlib import Path, PurePosixPath


def require(condition, message):
    if not condition:
        raise ValueError(message)


def local_path(root, name):
    path = PurePosixPath(name)
    require(not path.is_absolute() and ".." not in path.parts and "\\" not in name,
            f"Invalid relative path: {name}")
    result = root.joinpath(*path.parts).resolve()
    require(result.is_relative_to(root) and result != root, f"Path escapes package: {name}")
    return result


def digest(file):
    with file.open("rb") as data:
        return hashlib.file_digest(data, "sha256").hexdigest()


def tree_digest(root):
    members = [("", root)] + [(p.relative_to(root).as_posix(), p) for p in root.rglob("*")]
    result = hashlib.sha256(b"pioneer-plugin-tree-v1\0")
    for key, path in sorted(members, key=lambda item: item[0].encode()):
        require(not path.is_symlink(), "Payload links are forbidden")
        data = key.encode()
        result.update(struct.pack("<Q", len(data)) + data)
        mode = path.stat().st_mode & 0o777
        if path.is_dir():
            result.update(b"d" + struct.pack("<I", mode))
        else:
            require(path.is_file(), "Special payload member")
            result.update(b"f" + struct.pack("<IQ", mode, path.stat().st_size))
            with path.open("rb") as stream:
                while chunk := stream.read(1024 * 1024):
                    result.update(chunk)
    return result.hexdigest()


def verify(directory):
    root = directory.resolve()
    for line in (root / "SHA256SUMS").read_text().splitlines():
        expected, name = line.split("  ", 1)
        require(digest(local_path(root, name)) == expected, f"Package checksum mismatch: {name}")
    manifest = json.loads((root / "app.json").read_text())
    proposal = json.loads((root / "build-info.json").read_text())
    architectures = set(manifest["runtime"]["artifacts"])
    require(bool(architectures) and architectures <= {"linux/amd64", "linux/arm64"}, "Invalid architecture set")
    require(architectures == set(proposal["artifacts"]), "Manifest/provenance architecture mismatch")
    require((root / "runtime/start.cjs").is_file(), "Missing common launcher")
    results = []
    for architecture, member in manifest["runtime"]["artifacts"].items():
        artifact = proposal["artifacts"][architecture]
        target, machine, node_arch = {"linux/amd64": ("linux-x64", 62, "x64"), "linux/arm64": ("linux-arm64", 183, "arm64")}[architecture]
        payload = local_path(root, member["path"])
        require(tree_digest(payload) == member["sha256"] == artifact["sha256"], f"Payload tree mismatch: {architecture}")
        records = json.loads((root / f"{target}.files.json").read_text())
        entries = {entry["path"]: entry for entry in records}
        require(len(entries) == len(records), "Duplicate index entries")
        found, total, native = set(), 0, 0
        for path in payload.rglob("*"):
            if path.is_dir():
                continue
            require(path.is_file() and not path.is_symlink(), "Invalid payload file")
            name = "runtime/" + path.relative_to(payload).as_posix()
            entry = entries[name]
            require(path.stat().st_size == entry["size"] and path.stat().st_mode & 0o777 == entry["mode"] and digest(path) == entry["sha256"], f"Runtime file mismatch: {name}")
            with path.open("rb") as stream:
                header = stream.read(20)
            if header.startswith(b"\x7fELF"):
                require(len(header) == 20 and header[4] == 2 and header[5] == 1 and struct.unpack_from("<H", header, 18)[0] == machine, f"Wrong ELF architecture: {name}")
                native += 1
            found.add(name)
            total += path.stat().st_size
        runtime = json.loads((payload / "runtime-target.json").read_text())
        require(runtime["platform"] == "linux" and runtime["arch"] == node_arch and runtime["nodeMajor"] == 26 and runtime["nodeModulesABI"] == artifact["nodeModulesABI"], "Wrong runtime metadata")
        require(found == set(entries) and total == artifact["unpackedBytes"] and len(found) == artifact["runtimeFileCount"], "Wrong payload statistics")
        require(total <= 100 * 1024 * 1024, "Runtime exceeds 100 MiB")
        results.append({"architecture": architecture, "files": len(found), "bytes": total, "nativeELFFiles": native, "sha256": member["sha256"]})
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
