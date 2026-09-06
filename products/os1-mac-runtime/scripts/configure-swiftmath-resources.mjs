// Mechanical, pinned SwiftMath 1.7.3 packaging adaptation. SwiftPM regenerates
// resource_bundle_accessor.swift during every build plan, so patch the three
// library call sites instead of an ephemeral generated file. No build-Mac path
// is used by the application's font loader.
import fs from 'node:fs';
import path from 'node:path';
for (const build of process.argv.slice(2)) {
  const source = path.join(path.dirname(build), 'checkouts/SwiftMath/Sources/SwiftMath');
  for (const [relative, expected] of [['MathBundle/MathFont.swift', 2], ['MathRender/MTFont.swift', 1]]) {
    const file = path.join(source, relative);
    const old = fs.readFileSync(file, 'utf8');
    if (old.includes('Bundle.os1Resources')) continue;
    if ((old.match(/Bundle\.module/g) ?? []).length !== expected) throw Error('Unexpected pinned SwiftMath resource call sites');
    let updated = old.replaceAll('Bundle.module', 'Bundle.os1Resources');
    if (relative.endsWith('MTFont.swift')) updated += `
// OS1 portable resources: survives SwiftPM build-plan regeneration.
extension Foundation.Bundle {
    static var os1Resources: Bundle {
        let root = Bundle.main.resourceURL ?? Bundle.main.bundleURL
        guard let bundle = Bundle(url: root.appendingPathComponent("SwiftMath_SwiftMath.bundle")) else {
            fatalError("OS-1 bundled math resources are missing")
        }
        return bundle
    }
}
`;
    const mode = fs.statSync(file).mode & 0o777;
    try {
      fs.chmodSync(file, mode | 0o200);
      fs.writeFileSync(file, updated);
    } finally { fs.chmodSync(file, mode); }
  }
}
