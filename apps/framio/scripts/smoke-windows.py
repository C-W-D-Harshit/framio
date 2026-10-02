"""Exercise the PowerShell installer and compiled Windows CLI in paths containing spaces."""
import functools
import hashlib
import http.server
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

if os.name != "nt":
    raise SystemExit("This smoke check requires Windows")
binary = pathlib.Path(sys.argv[1]).resolve()
installer = pathlib.Path(__file__).resolve().parents[3] / "install.ps1"
with tempfile.TemporaryDirectory(prefix="framio windows smoke ") as temporary:
    root = pathlib.Path(temporary).resolve()
    releases = root / "releases"
    releases.mkdir()
    archive = releases / "framio-win32-x64.tar.gz"
    import shutil
    shutil.copy2(binary.with_suffix(".tar.gz"), archive)
    sums = releases / "SHA256SUMS"
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    sums.write_text(f"{checksum}  {archive.name}\n")
    registry = {"name": "windows-card", "type": "registry:item", "dependencies": ["nanoid@5.1.5"], "files": [{"path": "components/windows-card.tsx", "type": "registry:component", "content": 'export function WindowsCard(){return <section data-layer="Registry card">Windows registry component</section>}'}]}
    (releases / "card.json").write_text(json.dumps(registry))
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(releases))
    http = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    environment = {**os.environ, "HOME": str(root / "home"), "USERPROFILE": str(root / "home"), "FRAMIO_INSTALL": str(root / "install with spaces"), "FRAMIO_DOWNLOAD_URL": f"http://127.0.0.1:{http.server_port}", "FRAMIO_VERSION": "latest"}
    environment.pop("BUN_BE_BUN", None)
    environment.pop("FRAMIO_INSTALLATION_TARGET", None)
    target = root / "install with spaces" / "bin" / "framio.exe"
    project = root / "project with spaces"
    project.mkdir()
    def install(expect_success=True):
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(installer), "-NoPath"], env=environment, text=True, encoding="utf-8", capture_output=True, timeout=60)
        if (result.returncode == 0) != expect_success:
            raise RuntimeError(result.stdout + result.stderr)
    def cli(*args, timeout=90, env=None):
        return subprocess.check_output([str(target), *args], cwd=project, env=env or environment, text=True, encoding="utf-8", stderr=subprocess.STDOUT, timeout=timeout)
    def request(path):
        with urllib.request.urlopen(info["url"] + path, timeout=5) as response:
            return json.load(response)
    try:
        install()
        original = hashlib.sha256(target.read_bytes()).hexdigest()
        sums.write_text(f"{'0' * 64}  {archive.name}\n")
        install(False)
        assert hashlib.sha256(target.read_bytes()).hexdigest() == original
        sums.write_text(f"{checksum}  {archive.name}\n")
        # Framio's embedded Bun installs packages without an external Bun or Node.
        clean_path = {**environment, "PATH": str(pathlib.Path(os.environ["SystemRoot"]) / "System32")}
        cli("init", env=clean_path, timeout=180)
        assert (project / ".framio" / "node_modules" / "react").exists()
        cli("add", f"http://127.0.0.1:{http.server_port}/card.json", "--verbose", timeout=180)
        assert (project / ".framio" / "components" / "windows-card.tsx").exists()
        assert (project / ".framio" / "node_modules" / "nanoid").exists()
        frame = project / ".framio" / "pages" / "01-windows" / "home.tsx"
        frame.parent.mkdir()
        frame.write_text('import {WindowsCard} from "../../components/windows-card"; export const meta={name:"Windows",width:390,height:844}; export default function Frame(){return <main data-layer="Windows frame"><WindowsCard /></main>}')
        cli("start", "--background", "--no-open")
        info = json.loads((project / ".framio" / ".state" / "server.json").read_text())
        assert request("/api/health")["pid"] == info["pid"]
        assert str(info["pid"]) in cli("ps")
        first_pid = info["pid"]
        cli("start", "--background", "--no-open")
        assert request("/api/health")["pid"] == first_pid
        install()  # Reinstall while the old compiled canvas is still running.
        captured = cli("screenshot", "01-windows/home", timeout=180)
        assert "Registry card" in captured and "Windows frame" in captured
        frame.write_text(frame.read_text().replace("Windows frame", "Edited frame"))
        deadline = time.monotonic() + 20
        while True:
            captured = cli("screenshot", "01-windows/home", timeout=90)
            if "Edited frame" in captured:
                break
            assert time.monotonic() < deadline, captured
            time.sleep(0.2)
        cli("stop")
        assert not (project / ".framio" / ".state" / "server.lock").exists()
        assert not (project / ".framio" / ".state" / "server.json").exists()
        cli("start", "--background", "--no-open")
        cli("stop", "--all")
        assert not (project / ".framio" / ".state" / "server.lock").exists()
        cli("screenshot", "01-windows/home", timeout=180)
        assert not (project / ".framio" / ".state" / "server.lock").exists()
        assert not (project / ".framio" / ".state" / "server.json").exists()
        print("Verified PowerShell install/reinstall, checksum refusal, standalone package install, registry dependency install, detached server reuse, browser layers, watched edits and graceful shutdown")
    finally:
        if target.exists():
            subprocess.run([str(target), "stop", "--all"], cwd=project, env=environment, capture_output=True, timeout=30)
        http.shutdown()
