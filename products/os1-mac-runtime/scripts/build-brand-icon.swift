// AppKit icon composition, using the unmodified existing brand mark.
// The opaque backing is UI chrome, not a generated/reinterpreted logo.
import AppKit
import Foundation

// macOS fits this full-bleed square to the Dock icon body, so the mark is inset:
// its ring (97.7% of the mark canvas) then spans 80% of the body, the Dock margin
// measured for Chrome (80.9%), ChatGPT (79.1%) and Safari (80.3%).
let markInset: CGFloat = 0.09

let args = CommandLine.arguments
guard args.count == 3, let mark = NSImage(contentsOfFile: args[1]) else { fatalError("logo input and iconset directory required") }
let root = URL(fileURLWithPath: args[2], isDirectory: true)
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let size = points * scale
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        let rect = NSRect(x: 0, y: 0, width: size, height: size)
        NSColor.black.setFill(); rect.fill()
        let inset = CGFloat(size) * markInset
        mark.draw(in: rect.insetBy(dx: inset, dy: inset), from: .zero, operation: .sourceOver, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        // Black corners, edge margin and central hole must be opaque, not near-black noise.
        let m = Int(inset) - 1
        for (x,y) in [(0,0),(size/2,size/2),(size/2,m),(m,size/2),(size/2,size-1-m),(size-1-m,size/2)] {
            let c = bitmap.colorAt(x:x,y:y)!.usingColorSpace(.deviceRGB)!
            precondition(c.redComponent == 0 && c.greenComponent == 0 && c.blueComponent == 0 && c.alphaComponent == 1)
        }
        let name = "icon_\(points)x\(points)\(scale == 2 ? "@2x" : "").png"
        try bitmap.representation(using: .png, properties: [:])!.write(to: root.appendingPathComponent(name))
    }
}
