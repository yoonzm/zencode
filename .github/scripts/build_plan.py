"""Skip tag builds only when this repository already has verified installers for that SHA."""
import json
import os
import re
import subprocess

TARGETS = {'x86_64-pc-windows-msvc', 'x86_64-apple-darwin', 'aarch64-apple-darwin'}


def should_build(event, ref, sha, repo, api):
    if event != 'push' or not ref.startswith('refs/tags/'):
        return True
    tag = ref.removeprefix('refs/tags/')
    assert re.fullmatch(r'v\d+\.\d+\.\d+', tag), 'Invalid version tag'
    # Listing also finds drafts during the short tag-publication race.
    releases = api('releases?per_page=100')
    matches = [r for r in releases if r['tag_name'] == tag]
    if not matches:
        return True
    assert len(matches) == 1, 'Ambiguous existing release'
    release = matches[0]
    assert release['target_commitish'] == sha, 'Existing release SHA mismatch; refusing automatic rebuild'
    body = release.get('body') or ''
    assert f'Build commit: `{sha}`' in body, 'Missing exact build provenance'
    match = re.search(r'^Verified build: https://github\.com/' + re.escape(repo) + r'/actions/runs/(\d+)\s*$', body, re.M)
    assert match, 'Missing same-repository build provenance'
    run_id = match[1]
    run = api(f'actions/runs/{run_id}')
    assert run['head_sha'] == sha and run['path'] == '.github/workflows/desktop.yml', 'Wrong build source'
    assert run['status'] == 'completed' and run['conclusion'] == 'success', 'Source build not successful'
    jobs = api(f'actions/runs/{run_id}/jobs?per_page=100')['jobs']
    builds = [j for j in jobs if j['name'].startswith('build (')]
    assert len(builds) == 3 and all(j['conclusion'] == 'success' for j in builds), 'Platform validation incomplete'
    for target in TARGETS:
        assert sum(target in j['name'] for j in builds) == 1, 'Missing platform validation'
    artifacts = api(f'actions/runs/{run_id}/artifacts?per_page=100')['artifacts']
    for target in TARGETS:
        found = [a for a in artifacts if a['name'] == 'ZenCode-' + target]
        assert len(found) == 1 and not found[0]['expired'] and found[0]['size_in_bytes'] > 0, 'Source artifact unavailable'
    version = tag[1:]
    expected = {f'ZenCode_{version}_x64-setup.exe', f'ZenCode_{version}_x64.dmg', f'ZenCode_{version}_aarch64.dmg', 'SHA256SUMS.txt'}
    assets = release.get('assets', [])
    assert len(assets) == 4 and {a['name'] for a in assets} == expected, 'Release assets incomplete'
    assert all(a['state'] == 'uploaded' and a['size'] > 0 and re.fullmatch(r'sha256:[0-9a-f]{64}', a.get('digest') or '') for a in assets), 'Assets not uploaded/hashed'
    return False


def main():
    repo = os.environ['GITHUB_REPOSITORY']
    def api(path):
        return json.loads(subprocess.check_output(['gh', 'api', f'repos/{repo}/{path}'], text=True))
    build = should_build(os.environ['GITHUB_EVENT_NAME'], os.environ['GITHUB_REF'], os.environ['GITHUB_SHA'], repo, api)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'build={str(build).lower()}\n')
    print('Build required' if build else 'Existing same-SHA release and successful installer build verified; skipping duplicate build')


if __name__ == '__main__':
    main()
