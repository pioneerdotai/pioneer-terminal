"""Materialize a bounded, indexed CI runtime archive into a ready payload tree."""
import hashlib
import json
import shutil
import sys
import tarfile
from pathlib import Path, PurePosixPath

archive, index, destination = map(Path, sys.argv[1:])
records = json.loads(index.read_text())
entries = {entry["path"]: entry for entry in records}
if len(entries) != len(records) or len(entries) > 50000:
    raise ValueError("Invalid runtime file index")
destination.mkdir(parents=True, exist_ok=False, mode=0o755)
found = set()
seen = set()
total = 0
with tarfile.open(archive, "r|gz") as members:
    for member in members:
        name = member.name.rstrip("/")
        path = PurePosixPath(name)
        if (path.is_absolute() or ".." in path.parts or "\\" in name or
                not path.parts or path.parts[0] != "runtime" or name in seen):
            raise ValueError("Invalid runtime archive member")
        seen.add(name)
        if len(seen) > 100000:
            raise ValueError("Too many archive members")
        target = destination.joinpath(*path.parts[1:])
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True, mode=0o755)
            target.chmod(0o755)
            continue
        if not member.isfile() or len(path.parts) < 2:
            raise ValueError("Runtime links and special files are forbidden")
        entry = entries[name]
        if member.size != entry["size"] or member.mode & 0o777 != entry["mode"]:
            raise ValueError("Runtime file size/mode mismatch")
        total += member.size
        if total > 100 * 1024 * 1024:
            raise ValueError("Runtime exceeds 100 MiB")
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        with members.extractfile(member) as source, target.open("xb") as output:
            shutil.copyfileobj(source, output, 1024 * 1024)
        target.chmod(entry["mode"])
        with target.open("rb") as data:
            if hashlib.file_digest(data, "sha256").hexdigest() != entry["sha256"]:
                raise ValueError("Runtime file checksum mismatch")
        found.add(name)
if found != set(entries):
    raise ValueError("Missing indexed runtime files")
destination.chmod(0o755)
