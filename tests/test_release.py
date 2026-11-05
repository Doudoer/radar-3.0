import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("release", Path(__file__).parents[1] / "deploy/release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseGateTests(unittest.TestCase):
    def test_only_exact_prepare_and_verify_sha_commands_are_accepted(self):
        sha = "a" * 40
        self.assertEqual(release.parse_command("prepare " + sha), ("prepare", sha))
        self.assertEqual(release.parse_command("verify " + sha), ("verify", sha))
        for value in ["bash", "prepare main", "prepare " + sha + "; id", "verify " + sha + " extra"]:
            with self.assertRaises(ValueError):
                release.parse_command(value)

    def test_archive_rejects_traversal_links_and_credentials(self):
        for name, kind in [("../escape", tarfile.REGTYPE), ("/absolute", tarfile.REGTYPE),
                           (".env", tarfile.REGTYPE), ("uploads/client", tarfile.REGTYPE),
                           ("src/link", tarfile.SYMTYPE)]:
            with self.assertRaises(ValueError):
                release.validate_member(name, kind)
        release.validate_member("src/App.tsx", tarfile.REGTYPE)
        release.validate_member("migrations/023_order_payments.sql", tarfile.REGTYPE)
        release.validate_member(".github/workflows/production.yml", tarfile.REGTYPE)
        release.validate_member(".env.example", tarfile.REGTYPE)

    def test_only_known_migrations_are_considered_pending(self):
        self.assertEqual(release.pending_migrations(["001.sql", "002.sql"], ["001.sql"]), ["002.sql"])
        with self.assertRaises(ValueError):
            release.pending_migrations(["001.sql"], ["001.sql", "002.sql"])

    def test_environment_files_reject_newline_injection(self):
        self.assertEqual(release.env_text({"DB_USER": "migrator", "DB_PASSWORD": "safe-value"}), "DB_USER=migrator\nDB_PASSWORD=safe-value\n")
        with self.assertRaises(ValueError):
            release.env_text({"DB_PASSWORD": "value\nINJECT=1"})

    def test_extract_only_regular_source_files(self):
        content = io.BytesIO()
        with tarfile.open(fileobj=content, mode="w") as archive:
            member = tarfile.TarInfo("package.json")
            member.size = 2
            archive.addfile(member, io.BytesIO(b"{}"))
        content.seek(0)
        with tarfile.open(fileobj=content) as archive:
            self.assertEqual(release.checked_members(archive)[0].name, "package.json")

    def test_verification_waits_for_swarm_zero_and_two_container_transitions(self):
        sha = "b" * 40
        states = iter(["", "old\nnew", "new"])
        def fake_container(service):
            if service == "dokploy":
                return "dokploy"
            raise RuntimeError("Swarm is replacing the application container")
        def fake_run(args, data=None):
            if args[:2] == ["docker", "ps"]:
                return next(states)
            if "rev-parse" in args:
                return sha
            if args[:2] == ["docker", "inspect"]:
                return '[{"Image":"image-id","State":{"Health":{"Status":"healthy"}}}]'
            if args[:3] == ["docker", "image", "inspect"]:
                return "image-id"
            raise AssertionError(args)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / sha).mkdir()
            (root / sha / "prepared.json").write_text('{"sha":"' + sha + '"}')
            with patch.object(release, "ROOT", root), patch.object(release, "container", side_effect=fake_container), \
                 patch.object(release, "run", side_effect=fake_run), patch.object(release, "pgsql", return_value="done"), \
                 patch.object(release.time, "sleep") as sleep, \
                 patch.object(release.urllib.request, "urlopen", return_value=io.StringIO('{"ok":true,"database":"connected"}')):
                release.verify(sha)
                self.assertEqual(sleep.call_count, 2)
                self.assertTrue((root / sha / "verified.json").exists())


if __name__ == "__main__":
    unittest.main()
