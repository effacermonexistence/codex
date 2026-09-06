import AppKit

// Pixel verification of generated sidebar previews. Reads images only.
func rgba(_ path: String) throws -> (Int, Int, [UInt8]) {
    guard let image = NSImage(contentsOfFile: path),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        throw NSError(domain: "ActivityPreview", code: 1)
    }
    var bytes = [UInt8](repeating: 0, count: cg.width * cg.height * 4)
    let ok = bytes.withUnsafeMutableBytes { data -> Bool in
        guard let context = CGContext(data: data.baseAddress, width: cg.width, height: cg.height,
            bitsPerComponent: 8, bytesPerRow: cg.width * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        context.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height)); return true
    }
    guard ok else { throw NSError(domain: "ActivityPreview", code: 2) }
    return (cg.width, cg.height, bytes)
}
let first = try rgba(CommandLine.arguments[1]), second = try rgba(CommandLine.arguments[2])
precondition(first.0 == second.0 && first.1 == second.1)
var changes = [0, 0, 0]
for y in 0..<first.1 {
    for x in 0..<first.0 {
        let offset = (y * first.0 + x) * 4
        if first.2[offset..<offset+4] != second.2[offset..<offset+4] {
            changes[min(2, y * 3 / first.1)] += 1
        }
    }
}
precondition(changes[0] > 0 && changes[1] > 0 && changes[2] == 0,
    "Both active rows must animate; completed row must remain still: \(changes)")
print("PASS sidebar pixels: active rows \(changes[0]), \(changes[1]) changed; completed row \(changes[2]) changed")
