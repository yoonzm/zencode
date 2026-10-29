"""Validate signed updater assets and generate an immutable per-release manifest."""
import json
import re
from datetime import datetime, timezone
from pathlib import Path

VERSION_TAG = r'v\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?'

def installer_names(version):
    return {f'ZenCode_{version}_x64-setup.exe', f'ZenCode_{version}_x64.dmg', f'ZenCode_{version}_aarch64.dmg'}

def updater_names(version):
    return {
        'windows-x86_64': f'ZenCode_{version}_x64-setup.exe',
        'darwin-x86_64': f'ZenCode_{version}_x64.app.tar.gz',
        'darwin-aarch64': f'ZenCode_{version}_aarch64.app.tar.gz',
    }

def release_names(version):
    updates = set(updater_names(version).values())
    channel = 'beta' if '-' in version else 'stable'
    return installer_names(version) | updates | {n + '.sig' for n in updates} | {f'{channel}.json', 'SHA256SUMS.txt'}

def manifest(root, repo, tag, notes):
    assert re.fullmatch(VERSION_TAG, tag), 'Invalid version tag'
    version = tag[1:]
    platforms = {}
    for target, name in updater_names(version).items():
        asset = root / name
        sig = root / (name + '.sig')
        assert asset.is_file() and asset.stat().st_size > 0, f'Missing updater artifact: {name}'
        assert sig.is_file() and sig.read_text().strip(), f'Missing signature: {name}'
        platforms[target] = {'url': f'https://github.com/{repo}/releases/download/{tag}/{name}', 'signature': sig.read_text().strip()}
    return {'version': version, 'notes': notes, 'pub_date': datetime.now(timezone.utc).isoformat(), 'platforms': platforms}

def write_manifest(root, repo, tag, notes):
    channel = 'beta' if '-' in tag else 'stable'
    path = root / f'{channel}.json'
    path.write_text(json.dumps(manifest(root, repo, tag, notes), ensure_ascii=False, indent=2), encoding='utf-8')
    return path

if __name__ == '__main__':
    import os
    import shutil
    # macOS bundles use the same app name on both architectures. Rename before merging CI artifacts.
    target = os.environ['BUILD_TARGET']
    version = json.loads(Path('package.json').read_text())['version']
    if 'apple-darwin' in target:
        arch = 'aarch64' if target.startswith('aarch64') else 'x64'
        base = Path('src-tauri/target') / target / 'release/bundle/macos'
        for source in base.glob('*.app.tar.gz'):
            dest = base / f'ZenCode_{version}_{arch}.app.tar.gz'
            if source != dest:
                shutil.move(str(source), str(dest))
                signature = Path(str(source) + '.sig')
                if signature.exists(): shutil.move(str(signature), str(dest) + '.sig')
