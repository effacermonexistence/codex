#!/usr/bin/env python3
"""Fail before compilation if bundle and native release identities diverge.

This source gate supplements, never replaces, the signed executed-binary checks
in build-release.sh. Fixtures use private temporary files, no app/model calls.
"""
import argparse
import json
import pathlib
import plistlib
import re
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
PATTERN = re.compile(r'^let os1RuntimeVersionString = "OS-1 Runtime ([0-9]+\.[0-9]+\.[0-9]+) '
                     r'\([a-z0-9-]*build([0-9]+)\)"$', re.M)


def verify(root, expected_version=None):
    info = root / 'Resources/Info.plist'
    source = root / 'Sources/OS1/SelfUpdateCommands.swift'
    if info.stat().st_size > 65536 or source.stat().st_size > 2_000_000:
        raise ValueError('release identity source exceeds bounds')
    bundle = plistlib.loads(info.read_bytes())
    lines = PATTERN.findall(source.read_text())
    if len(lines) != 1:
        raise ValueError('exactly one native release identity is required')
    version, build = lines[0]
    if str(bundle.get('CFBundleShortVersionString')) != version or str(bundle.get('CFBundleVersion')) != build:
        raise ValueError('bundle and native SOURCE release identities differ')
    if expected_version and expected_version != version:
        raise ValueError('requested release version differs from the bundle/native source')
    return {'version': version, 'build': build, 'basis': 'source_only_not_executed_release'}


class Tests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='os1-release-source-')
        self.addCleanup(self.directory.cleanup)
        self.root = pathlib.Path(self.directory.name)
        (self.root / 'Resources').mkdir()
        (self.root / 'Sources/OS1').mkdir(parents=True)
        self.write()

    def write(self, version='0.9.350', build='416', source=None):
        (self.root / 'Resources/Info.plist').write_bytes(plistlib.dumps({
            'CFBundleShortVersionString': version, 'CFBundleVersion': build}))
        (self.root / 'Sources/OS1/SelfUpdateCommands.swift').write_text(source or
            'import Foundation\nlet os1RuntimeVersionString = "OS-1 Runtime 0.9.350 (fixture-build416)"\n')

    def test_match(self):
        self.assertEqual(verify(self.root)['build'], '416')

    def test_version_mismatch(self):
        self.write(version='0.9.349')
        with self.assertRaises(ValueError): verify(self.root)

    def test_build_mismatch(self):
        self.write(build='415')
        with self.assertRaises(ValueError): verify(self.root)

    def test_override_mismatch(self):
        with self.assertRaises(ValueError): verify(self.root, '0.9.349')

    def test_override_match(self):
        self.assertEqual(verify(self.root, '0.9.350')['version'], '0.9.350')

    def test_duplicate(self):
        line = 'let os1RuntimeVersionString = "OS-1 Runtime 0.9.350 (fixture-build416)"\n'
        self.write(source=line + line)
        with self.assertRaises(ValueError): verify(self.root)

    def test_missing(self):
        self.write(source='// no runtime identity\n')
        with self.assertRaises(ValueError): verify(self.root)

    def test_comment_is_not_identity(self):
        self.write(source='// let os1RuntimeVersionString = "OS-1 Runtime 0.9.349 (old-build415)"\n'
                   'let os1RuntimeVersionString = "OS-1 Runtime 0.9.350 (fixture-build416)"\n')
        self.assertEqual(verify(self.root)['version'], '0.9.350')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--verify-current', action='store_true')
    parser.add_argument('--expected-version')
    args = parser.parse_args()
    if args.self_test:
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
        raise SystemExit(0 if result.wasSuccessful() else 1)
    if not args.verify_current: parser.error('choose --self-test or --verify-current')
    print(json.dumps(verify(ROOT, args.expected_version), sort_keys=True))
