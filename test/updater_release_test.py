import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('updater_release', Path(__file__).resolve().parents[1] / '.github/scripts/updater_release.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class UpdaterReleaseTests(unittest.TestCase):
    def test_ci_passes_public_key_to_bundler_and_runtime(self):
        workflow = (Path(__file__).resolve().parents[1] / '.github/workflows/desktop.yml').read_text(encoding='utf-8')
        self.assertIn("'plugins': {'updater': {'pubkey': os.environ.get('UPDATER_PUBLIC_KEY', '').strip()}}", workflow)
        self.assertIn('ZENCODE_UPDATER_PUBLIC_KEY: ${{ vars.ZENCODE_UPDATER_PUBLIC_KEY }}', workflow)
        self.assertEqual(workflow.count('bundles: app,dmg'), 2)

    def test_manifest_platforms_channels_and_signatures(self):
        for version in ['0.2.0', '0.3.0-beta.1']:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for name in module.updater_names(version).values():
                    (root / name).write_bytes(b'installer fixture')
                    (root / (name + '.sig')).write_text('signature fixture')
                result = module.manifest(root, 'yoonzm/zencode', 'v' + version, 'Changes')
                self.assertEqual(set(result['platforms']), {'windows-x86_64', 'darwin-x86_64', 'darwin-aarch64'})
                self.assertEqual(result['version'], version)
                for target in result['platforms'].values():
                    self.assertIn('/releases/download/v' + version + '/', target['url'])
                    self.assertEqual(target['signature'], 'signature fixture')
                path = module.write_manifest(root, 'yoonzm/zencode', 'v' + version, 'Changes')
                self.assertEqual(path.name, 'beta.json' if '-' in version else 'stable.json')
                next(root.glob('*.sig')).unlink()
                with self.assertRaisesRegex(AssertionError, 'Missing signature'):
                    module.manifest(root, 'yoonzm/zencode', 'v' + version, '')

    def test_missing_artifact_and_invalid_tag_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            for tag in ['v0.2.0', 'v0.2.0-unknown', '../unsafe']:
                with self.assertRaises(AssertionError):
                    module.manifest(Path(directory), 'yoonzm/zencode', tag, '')
