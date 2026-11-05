#!/usr/bin/env python3
"""Root-owned release gate called only through a restricted GitHub Actions SSH key."""
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import signal
import subprocess
import sys
import tarfile
import time
import urllib.request

APP = "radar-3-app-yel259"
DB = "radar-v3-db-rbvsox"
DATABASE = "radar_v3"
ROOT = Path("/root/radar-releases")


def parse_command(value):
    match = re.fullmatch(r"(prepare|verify) ([a-f0-9]{40})", value)
    if not match:
        raise ValueError("Only prepare/verify with a full commit SHA are permitted")
    return match.group(1), match.group(2)


def validate_member(name, kind):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or kind not in (tarfile.REGTYPE, tarfile.DIRTYPE):
        raise ValueError("Unsafe release archive member")
    if any(part.startswith(".env") and part != ".env.example" for part in path.parts) or path.parts[0] in ("backups", "uploads", "node_modules", ".git"):
        raise ValueError("Private/runtime files are forbidden in release archives")


def checked_members(archive):
    members = archive.getmembers()
    if sum(member.size for member in members) > 100 * 1024 * 1024:
        raise ValueError("Release archive is too large")
    for member in members:
        validate_member(member.name, member.type)
    return members


def pending_migrations(available, applied):
    if set(applied) - set(available):
        raise ValueError("Release would remove an applied migration; downgrade refused")
    return sorted(set(available) - set(applied))


def env_text(values):
    if any("\n" in str(value) or "\r" in str(value) for value in values.values()):
        raise ValueError("Environment values cannot contain newlines")
    return "".join(f"{key}={value}\n" for key, value in values.items())


def run(args, data=None):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        # Docker/SQL errors can contain environment values or confidential rows.
        raise RuntimeError(f"Command failed: {args[0]} {args[1] if len(args) > 1 else ''}; exit {result.returncode}")
    return result.stdout.decode().strip()


def container(service):
    ids = run(["docker", "ps", "-q", "--filter", f"label=com.docker.swarm.service.name={service}"]).splitlines()
    if len(ids) != 1:
        raise RuntimeError(f"Expected one running container for {service}")
    return ids[0]


def dbsql(db, sql):
    return run(["docker", "exec", "-i", db, "sh", "-c",
                'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -u root --batch --skip-column-names radar_v3'], sql.encode())


def pgsql(sql):
    return run(["docker", "exec", container("dokploy-postgres"), "psql", "-U", "dokploy", "-d", "dokploy", "-Atc", sql])


def wait_database(db):
    for _ in range(60):
        try:
            dbsql(db, "SELECT 1;")
            return
        except RuntimeError:
            time.sleep(2)
    raise RuntimeError("Backup rehearsal database did not become ready")


def private_file(path, content):
    path.write_text(content)
    path.chmod(0o600)


def fingerprint(image, network, env, release, mode):
    run(["docker", "run", "--rm", "--user", "0", "--network", network, "--env-file", str(env),
         "-v", f"{release}:/release", "--entrypoint", "node", image,
         "/release/source/deploy/fingerprint.mjs", mode, "/release/original-data.json"])


def migrate(image, network, env):
    print("Applying migrations with a separate migration identity", flush=True)
    run(["docker", "run", "--rm", "--user", "0", "--network", network, "--env-file", str(env),
         "--entrypoint", "node", image, "dist/migrate.js"])


def prepare(sha):
    release = ROOT / sha
    if release.exists():
        raise RuntimeError("Release already exists; inspect its logs before retrying")
    release.mkdir(mode=0o700, parents=True)
    archive_path = release / "source.tar"
    with archive_path.open("wb") as target:
        size = 0
        while True:
            chunk = sys.stdin.buffer.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > 100 * 1024 * 1024:
                raise ValueError("Release archive exceeded limit")
            target.write(chunk)
    source = release / "source"
    source.mkdir()
    with tarfile.open(archive_path) as archive:
        archive.extractall(source, members=checked_members(archive))
    db = container(DB)
    app = container(APP)
    service = json.loads(run(["docker", "service", "inspect", APP]))[0]
    private_file(release / "service-before.json", json.dumps(service))
    app_data = json.loads(run(["docker", "inspect", app]))[0]
    old_image = app_data["Image"]
    run(["docker", "tag", old_image, f"radar-rollback:{sha}"])
    network_id = service["Spec"]["TaskTemplate"]["Networks"][0]["Target"]
    network = json.loads(run(["docker", "network", "inspect", network_id]))[0]["Name"]
    env = dict(item.split("=", 1) for item in app_data["Config"]["Env"] if "=" in item)
    available = [file.name for file in (source / "migrations").glob("*.sql")]
    applied = dbsql(db, "SELECT name FROM schema_migrations ORDER BY name;").splitlines()
    pending = pending_migrations(available, applied)
    for name in pending:
        sql = re.sub(r"--[^\n]*", "", (source / "migrations" / name).read_text())
        statements = [value.strip() for value in sql.split(";") if value.strip()]
        if not all(re.match(r"^(CREATE TABLE IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS|ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS)\b", statement, re.I) for statement in statements):
            raise RuntimeError(f"Non-additive migration {name} requires a separately reviewed rollout")
    image = f"radar-candidate:{sha}"
    print(f"Building candidate {sha}; pending migrations: {', '.join(pending) or 'none'}", flush=True)
    with (release / "build.log").open("w") as log:
        subprocess.run(["docker", "build", "--label", f"org.opencontainers.image.revision={sha}", "-t", image, str(source)],
                       stdout=log, stderr=subprocess.STDOUT, check=True)
    paused = False
    scratch = f"radar-rehearsal-{sha[:12]}"
    scratch_network = f"radar-rehearsal-{sha[:12]}"
    created_network = False
    created_scratch = False
    migrator = f"radar_migrate_{sha[:12]}"
    created_user = False
    try:
        if pending:
            print("Pausing application writes for final backup and migration rehearsal", flush=True)
            run(["docker", "service", "scale", f"{APP}=0"])
            paused = True
            for _ in range(60):
                if not run(["docker", "ps", "-q", "--filter", f"label=com.docker.swarm.service.name={APP}"]):
                    break
                time.sleep(1)
            else:
                raise RuntimeError("Application did not stop; refusing to migrate with active writes")
        dump = release / "database.sql.gz"
        with dump.open("wb") as output:
            process = subprocess.Popen(["docker", "exec", db, "sh", "-c",
                'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb-dump -u root --single-transaction --routines --triggers --hex-blob radar_v3'],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            with gzip.GzipFile(fileobj=output, mode="wb") as compressed:
                while True:
                    chunk = process.stdout.read(1024 * 1024)
                    if not chunk:
                        break
                    compressed.write(chunk)
            if process.wait():
                raise RuntimeError("Database backup failed")
        with gzip.open(dump) as compressed:
            while compressed.read(1024 * 1024):
                pass
        private_file(release / "database.sha256", hashlib.sha256(dump.read_bytes()).hexdigest() + "\n")
        # Preserve attachment and backup files; never replace the production mounts.
        run(["tar", "-czf", str(release / "files.tar.gz"), "-C", "/var/lib/radar-data", "uploads", "backups"])
        if pending:
            password = secrets.token_hex(32)
            dbsql(db, f"CREATE USER '{migrator}'@'%' IDENTIFIED BY '{password}'; GRANT ALL PRIVILEGES ON radar_v3.* TO '{migrator}'@'%';")
            created_user = True
            live_env = release / "migrate.env"
            private_file(live_env, env_text({**env, "DB_USER": migrator, "DB_PASSWORD": password}))
            fingerprint(image, network, live_env, release, "before")
            run(["docker", "network", "create", "--internal", scratch_network])
            created_network = True
            scratch_env = release / "scratch.env"
            scratch_password = secrets.token_hex(32)
            private_file(scratch_env, env_text({"MARIADB_ROOT_PASSWORD": scratch_password, "MARIADB_DATABASE": DATABASE}))
            run(["docker", "run", "-d", "--name", scratch, "--network", scratch_network, "--env-file", str(scratch_env),
                 "--tmpfs", "/var/lib/mysql:rw,size=2g", "mariadb:11"])
            created_scratch = True
            wait_database(scratch)
            with gzip.open(dump) as data:
                restored = subprocess.Popen(["docker", "exec", "-i", scratch, "sh", "-c",
                    'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -u root radar_v3'], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                while True:
                    chunk = data.read(1024 * 1024)
                    if not chunk:
                        break
                    restored.stdin.write(chunk)
                restored.stdin.close()
                if restored.wait():
                    raise RuntimeError("Backup restoration rehearsal failed")
            rehearsal_env = release / "rehearsal.env"
            private_file(rehearsal_env, env_text({**env, "NODE_ENV": "development", "DB_HOST": scratch,
                "DB_PORT": "3306", "DB_NAME": DATABASE, "DB_USER": "root", "DB_PASSWORD": scratch_password}))
            fingerprint(image, scratch_network, rehearsal_env, release, "after")
            migrate(image, scratch_network, rehearsal_env)
            fingerprint(image, scratch_network, rehearsal_env, release, "after")
            print("Backup restored and additive migrations rehearsed; original data verified", flush=True)
            migrate(image, network, live_env)
            fingerprint(image, network, live_env, release, "after")
            print("Production migrations applied; all original values verified unchanged", flush=True)
        private_file(release / "prepared.json", json.dumps({"sha": sha, "pending": pending, "previousImage": old_image}))
        print(f"PREPARED {sha}; backups retained privately on VPS", flush=True)
    finally:
        if paused:
            run(["docker", "service", "scale", f"{APP}=1"])
        if created_user:
            dbsql(db, f"DROP USER '{migrator}'@'%';")
        for name in ("migrate.env", "scratch.env", "rehearsal.env"):
            (release / name).unlink(missing_ok=True)
        if created_scratch:
            run(["docker", "rm", "-f", scratch])
        if created_network:
            run(["docker", "network", "rm", scratch_network])


def verify(sha):
    release = ROOT / sha
    state = json.loads((release / "prepared.json").read_text())
    if state["sha"] != sha:
        raise RuntimeError("Prepared revision does not match")
    print("Waiting for Dokploy to deploy the promoted production revision", flush=True)
    for _ in range(120):
        dokploy = container("dokploy")
        revision = run(["docker", "exec", dokploy, "git", "-C", f"/etc/dokploy/applications/{APP}/code", "rev-parse", "HEAD"])
        deployment = pgsql(f"""SELECT status FROM deployment WHERE "applicationId"='UHRvm5xDRsjhw0chOd81v' ORDER BY "createdAt" DESC LIMIT 1;""")
        if revision == sha and deployment == "error":
            raise RuntimeError("Dokploy build failed; inspect private Dokploy logs")
        if revision == sha and deployment == "done":
            app = container(APP)
            inspect = json.loads(run(["docker", "inspect", app]))[0]
            latest = run(["docker", "image", "inspect", f"{APP}:latest", "--format", "{{.Id}}"])
            if inspect["Image"] == latest and inspect["State"].get("Health", {}).get("Status") == "healthy":
                with urllib.request.urlopen("https://radar-rsy.store/health", timeout=15) as response:
                    health = json.load(response)
                if health.get("ok") is True and health.get("database") == "connected":
                    private_file(release / "verified.json", json.dumps({"sha": sha, "image": latest, "health": health}))
                    print(f"VERIFIED {sha}: Dokploy done, running image matches, HTTPS and database healthy", flush=True)
                    return
        time.sleep(10)
    raise RuntimeError("Deployment verification timed out; previous image and backups retained")


def main():
    os.umask(0o077)
    def interrupted(signum, _frame):
        raise RuntimeError(f"Release interrupted by signal {signum}")
    for signum in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(signum, interrupted)
    operation, sha = parse_command(os.environ.get("SSH_ORIGINAL_COMMAND", " ".join(sys.argv[1:])))
    ROOT.mkdir(mode=0o700, exist_ok=True)
    with (ROOT / "deployment.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if operation == "prepare":
            prepare(sha)
        else:
            try:
                verify(sha)
            except Exception:
                if (ROOT / sha / "prepared.json").exists():
                    print("Restoring previous application image; database is not restored or overwritten", flush=True)
                    run(["docker", "service", "update", "--detach=false", "--image", f"radar-rollback:{sha}", APP])
                raise


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"RELEASE FAILED ({type(error).__name__}): {error}", file=sys.stderr)
        sys.exit(1)
