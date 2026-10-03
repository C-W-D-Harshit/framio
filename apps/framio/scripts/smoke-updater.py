"""Exercise CLI and canvas update state using only a disposable compiled installation."""
import hashlib
import json
import os
import pathlib
import platform
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request

binary = pathlib.Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix="framio-updater-smoke-") as temporary:
    root = pathlib.Path(temporary).resolve()
    target = root / "custom-install" / ("framio.exe" if os.name == "nt" else "framio")
    target.parent.mkdir()
    shutil.copy2(binary, target)
    environment = {**os.environ, "HOME": str(root / "home"), "USERPROFILE": str(root / "home")}
    environment.pop("FRAMIO_INSTALLATION_TARGET", None)
    environment.pop("BUN_BE_BUN", None)
    version_output = subprocess.check_output([str(target), "--version"], env=environment, text=True).strip()
    current = re.search(r"(\d+\.\d+\.\d+)$", version_output).group(1)
    selected = f"{int(current.split('.')[0]) + 1}.0.0"
    project = root / "project"
    (project / ".framio" / "pages").mkdir(parents=True)
    theme = project / ".framio" / "theme.css"
    theme.write_text("/* User theme stays unchanged. */\n")
    identity = hashlib.sha256(str(target.resolve()).encode()).hexdigest()
    data = root / "home" / ".framio" / "updates"
    files = data / identity
    files.mkdir(parents=True)
    staged = files / ("staged.exe" if os.name == "nt" else "staged")
    if os.name == "nt":
        fixture = root / "replacement.ts"
        fixture.write_text(f"if (process.argv[2] === '--version') console.log('framio {selected}'); else process.exit(2);\n")
        subprocess.check_call(["bun", "build", "--compile", str(fixture), "--outfile", str(staged)], stdout=subprocess.DEVNULL)
    else:
        staged.write_text(f"#!/bin/sh\nif [ \"$1\" = --version ]; then printf 'framio {selected}\\n'; else exit 2; fi\n")
    staged.chmod(0o755)
    release_platform = {"Darwin": "darwin", "Linux": "linux", "Windows": "win32"}[platform.system()] + "-" + {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x64", "AMD64": "x64"}[platform.machine()]
    record = {"phase": "ready", "release": {"version": selected, "tag": "v" + selected, "description": "Local compiled updater fixture.", "notesUrl": "https://github.com/C-W-D-Harshit/framio/releases/tag/v" + selected, "assetId": 1, "assetName": f"framio-{release_platform}.tar.gz", "assetUrl": "https://api.github.com/repos/C-W-D-Harshit/framio/releases/assets/1", "assetSize": 100, "checksumUrl": "https://api.github.com/repos/C-W-D-Harshit/framio/releases/assets/2", "requiresProjectUpdate": False}, "bytes": 100, "total": 100, "error": None, "stagedHash": hashlib.sha256(staged.read_bytes()).hexdigest(), "previousVersion": None, "operation": None}
    with sqlite3.connect(data / "updates.sqlite") as database:
        database.execute("CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        database.execute("INSERT INTO state VALUES (?, ?)", ("installation:" + identity, json.dumps(record)))
        database.execute("INSERT INTO state VALUES (?, ?)", ("discovery:" + release_platform, json.dumps({"release": None, "etag": None, "nextCheck": time.time() * 1000 + 86400000, "failures": 0, "error": None})))
    database.close()
    log = (root / "session.log").open("w")
    session = subprocess.Popen([str(target), "start", "--no-open"], cwd=project, env=environment, stdout=log, stderr=log)
    def request(url):
        with urllib.request.urlopen(url, timeout=2) as response:
            return json.load(response)
    try:
        deadline = time.monotonic() + 20
        info = None
        while time.monotonic() < deadline:
            try:
                info = json.loads((project / ".framio" / ".state" / "server.json").read_text())
                if request(info["url"] + "/api/health")["version"] == current:
                    break
            except (OSError, ValueError):
                pass
            if session.poll() is not None:
                raise RuntimeError((root / "session.log").read_text())
            time.sleep(0.05)
        assert info and request(info["url"] + "/api/health")["version"] == current
        before = request(info["url"] + "/api/update")
        assert before["phase"] == "ready" and before["release"]["version"] == selected
        status = subprocess.check_output([str(target), "update", "--status"], env=environment, text=True, encoding="utf-8", timeout=20)
        assert "ready" in status and selected in status
        installed = subprocess.check_output([str(target), "update"], env=environment, text=True, encoding="utf-8", timeout=30)
        assert f"Installed Framio {selected}." in installed
        assert "Restart needed:" in installed and str(project) in installed
        after = request(info["url"] + "/api/update")
        assert after["installedVersion"] == selected and after["runningVersion"] == current and after["restartNeeded"]
        assert session.poll() is None and request(info["url"] + "/api/health")["pid"] == info["pid"]
        assert theme.read_text() == "/* User theme stays unchanged. */\n"
        backup = files / ("previous.exe" if os.name == "nt" else "previous")
        subprocess.check_call([str(backup), "upgrade", "--rollback"], env={**environment, "FRAMIO_INSTALLATION_TARGET": str(target)}, stdout=subprocess.DEVNULL, timeout=30)
        assert request(info["url"] + "/api/update")["installedVersion"] == current
        assert subprocess.check_output([str(target), "--version"], env=environment, text=True).strip() == version_output
        with sqlite3.connect(data / "updates.sqlite") as database:
            database.execute("UPDATE state SET value = ? WHERE key = ?", (json.dumps(record), "installation:" + identity))
        database.close()
        alias = subprocess.check_output([str(target), "upgrade"], env=environment, text=True, encoding="utf-8", timeout=30)
        assert f"Installed Framio {selected}." in alias
        subprocess.check_call([str(backup), "update", "--rollback"], env={**environment, "FRAMIO_INSTALLATION_TARGET": str(target)}, stdout=subprocess.DEVNULL, timeout=30)
        assert subprocess.check_output([str(target), "--version"], env=environment, text=True).strip() == version_output
        print("Verified compiled CLI/canvas shared state, custom target installation, retained foreground ownership and rollback")
    finally:
        if session.poll() is None:
            if os.name == "nt":
                subprocess.run([str(target), "stop"], cwd=project, env=environment, check=True, timeout=20)
            else:
                session.send_signal(signal.SIGINT)
            session.wait(timeout=15)
        log.close()
