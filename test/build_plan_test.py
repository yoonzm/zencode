import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('build_plan', Path(__file__).resolve().parents[1] / '.github/scripts/build_plan.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SHA = 'a' * 40
REPO = 'yoonzm/zencode'

def fixtures():
    return {
        'releases?per_page=100': [{'tag_name': 'v0.1.0', 'target_commitish': SHA, 'draft': False,
            'body': f'Build commit: `{SHA}`\nVerified build: https://github.com/{REPO}/actions/runs/123\n',
            'assets': [{'name': name, 'size': 123, 'state': 'uploaded', 'digest': 'sha256:' + 'b' * 64} for name in
                       ['ZenCode_0.1.0_x64-setup.exe', 'ZenCode_0.1.0_x64.dmg', 'ZenCode_0.1.0_aarch64.dmg', 'SHA256SUMS.txt']]}],
        'actions/runs/123': {'head_sha': SHA, 'path': '.github/workflows/desktop.yml', 'status': 'completed', 'conclusion': 'success'},
        'actions/runs/123/jobs?per_page=100': {'jobs': [{'name': f'build (runner, {t}, bundle)', 'conclusion': 'success'} for t in module.TARGETS]},
        'actions/runs/123/artifacts?per_page=100': {'artifacts': [{'name': 'ZenCode-' + t, 'expired': False, 'size_in_bytes': 123} for t in module.TARGETS]},
    }

class BuildPlanTests(unittest.TestCase):
    def decide(self, data, event='push', ref='refs/tags/v0.1.0'):
        return module.should_build(event, ref, SHA, REPO, data.__getitem__)

    def test_branch_and_manual_builds_do_not_query_releases(self):
        self.assertTrue(self.decide({}, ref='refs/heads/main'))
        self.assertTrue(self.decide({}, event='workflow_dispatch'))

    def test_new_version_builds(self):
        self.assertTrue(self.decide({'releases?per_page=100': []}))

    def test_verified_published_or_upload_complete_draft_skips(self):
        data = fixtures()
        self.assertFalse(self.decide(data))
        data['releases?per_page=100'][0]['draft'] = True
        self.assertFalse(self.decide(data))

    def test_wrong_sha_or_unvalidated_build_stops_instead_of_reusing(self):
        for key, field, value in [('actions/runs/123', 'head_sha', 'c'*40), ('actions/runs/123', 'conclusion', 'failure'), ('actions/runs/123', 'status', 'in_progress'), ('actions/runs/123', 'path', '.github/workflows/other.yml')]:
            with self.subTest(field=field):
                data = fixtures(); data[key][field] = value
                with self.assertRaises(AssertionError): self.decide(data)
        data = fixtures(); data['releases?per_page=100'][0]['target_commitish'] = 'main'
        with self.assertRaises(AssertionError): self.decide(data)

    def test_missing_expired_or_incomplete_artifacts_stop(self):
        for mutation in ('expired', 'empty', 'missing_asset', 'uploading', 'no_digest', 'failed_platform'):
            with self.subTest(mutation=mutation):
                data = fixtures()
                artifacts = data['actions/runs/123/artifacts?per_page=100']['artifacts']
                assets = data['releases?per_page=100'][0]['assets']
                if mutation == 'expired': artifacts[0]['expired'] = True
                elif mutation == 'empty': artifacts[0]['size_in_bytes'] = 0
                elif mutation == 'missing_asset': assets.pop()
                elif mutation == 'uploading': assets[0]['state'] = 'new'
                elif mutation == 'no_digest': assets[0]['digest'] = None
                else: data['actions/runs/123/jobs?per_page=100']['jobs'][0]['conclusion'] = 'failure'
                with self.assertRaises(AssertionError): self.decide(data)

    def test_workflow_gates_matrix_and_release_depends_on_build(self):
        workflow = Path('.github/workflows/desktop.yml').read_text()
        self.assertIn("needs: plan\n    if: needs.plan.outputs.build == 'true'", workflow)
        self.assertIn('needs: build', workflow)
        self.assertIn("tags: ['v*.*.*']", workflow)

if __name__ == '__main__':
    unittest.main()
