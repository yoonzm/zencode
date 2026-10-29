"""Publish only verified installer artifacts; never overwrite a release or tag."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

repo = os.environ['GITHUB_REPOSITORY']
run_id = os.environ['RELEASE_RUN']
commit = os.environ['RELEASE_COMMIT']
tag = os.environ['RELEASE_TAG']
assert re.fullmatch(r'\d+', run_id), 'Invalid run ID'
assert re.fullmatch(r'[a-f0-9]{40}', commit), 'Expected exact commit SHA'
assert re.fullmatch(r'v\d+\.\d+\.\d+', tag), 'Expected vX.Y.Z'

def gh(*args):
    return subprocess.check_output(['gh', *args], text=True)

def api(path):
    return json.loads(gh('api', f'repos/{repo}/{path}'))

def verify():
    run = api(f'actions/runs/{run_id}')
    assert run['head_sha'] == commit, 'Build commit mismatch'
    assert run['path'] == '.github/workflows/desktop.yml', 'Unexpected build workflow'
    # Tag-triggered caller is still running; all three build jobs must already pass.
    jobs = api(f'actions/runs/{run_id}/jobs?per_page=100')['jobs']
    builds = [j for j in jobs if j['name'].startswith('build (')]
    assert len(builds) == 3 and all(j['conclusion'] == 'success' for j in builds), 'Installer checks did not all pass'
    assert run['conclusion'] == 'success' or (run['status'] == 'in_progress' and run['event'] == 'push' and run['head_branch'] == tag), 'Build is not successful'
    package = json.loads(gh('api', f'repos/{repo}/contents/package.json?ref={commit}', '-H', 'Accept: application/vnd.github.raw+json'))
    assert tag == 'v' + package['version'], 'Version mismatch'
    releases = json.loads(gh('api', '--paginate', f'repos/{repo}/releases'))
    assert not any(r['tag_name'] == tag for r in releases), 'Release already exists; refusing to overwrite'
    refs = api(f'git/matching-refs/tags/{tag}')
    exact = [r for r in refs if r['ref'] == 'refs/tags/' + tag]
    if exact:
        obj = exact[0]['object']
        if obj['type'] == 'tag':
            obj = api('git/tags/' + obj['sha'])['object']
        assert obj['type'] == 'commit' and obj['sha'] == commit, 'Existing tag targets a different commit'

verify()
if sys.argv[1] == 'publish':
    root = Path('release-assets')
    expected = {f'ZenCode_{tag[1:]}_x64-setup.exe', f'ZenCode_{tag[1:]}_x64.dmg', f'ZenCode_{tag[1:]}_aarch64.dmg'}
    files = [p for p in root.rglob('*') if p.is_file()]
    assert {p.name for p in files} == expected and len(files) == 3, 'Unexpected or missing installer files'
    checksums = root / 'SHA256SUMS.txt'
    checksums.write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n' for p in sorted(files)))
    notes = Path('release-notes.md')
    notes.write_text(f'''ZenCode {tag} — Tauri 2 / Rust desktop application.

Build commit: `{commit}`
Verified build: https://github.com/{repo}/actions/runs/{run_id}

Includes Windows x64 NSIS installer and macOS Intel / Apple Silicon disk images (macOS 13.3+).
Type checking, automated tests and builds passed. Windows installation/startup smoke test and macOS disk-image checksum/mount checks passed.

**Validation limits:** Installers are unsigned and macOS builds are not notarized. Live authenticated ZenTao → Codex → GitLab end-to-end execution, native credential-vault roundtrips, interactive macOS flows and visual parity remain unverified. The cloud browser blocked visual comparison. Codex handshake passed with an empty writable configuration; this is not authenticated model execution. Install and authenticate Codex CLI separately.

MR submission does not write links, comments, task status or fix versions to ZenTao. Unsupported API/interaction variants return errors. This release is not a claim of complete production acceptance.

SHA256SUMS.txt contains installer checksums.
''')
    gh('release', 'create', tag, '--repo', repo, '--target', commit, '--title', f'ZenCode {tag}', '--notes-file', str(notes), '--draft')
    gh('release', 'upload', tag, '--repo', repo, *map(str, files), str(checksums))
    # The by-tag endpoint can return 404 until a draft is published and its tag exists.
    release = next(r for r in api('releases?per_page=100') if r['tag_name'] == tag and r['draft'])
    assert release['target_commitish'] == commit, 'Draft target mismatch'
    assert {a['name'] for a in release['assets']} == expected | {'SHA256SUMS.txt'}, 'Upload incomplete; draft retained'
    gh('release', 'edit', tag, '--repo', repo, '--draft=false')
    print(gh('release', 'view', tag, '--repo', repo, '--json', 'url,assets'))
