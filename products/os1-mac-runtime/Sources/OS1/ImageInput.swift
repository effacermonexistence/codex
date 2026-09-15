import Foundation
import ImageIO
import UniformTypeIdentifiers
import OS1Context

/// Turns an attached image path into a model image input: downscaled to a
/// bounded edge and re-encoded, so a Retina screenshot fits the backends'
/// per-image limits. Nothing else about the file is read or kept.
enum ImageInput {
    struct Encoded {
        let mediaType: String
        let base64: String
        let path: String
    }

    static let maximumEdge = 1_600
    static let maximumBytes = 4_500_000

    static func encode(path: String, maximumEdge: Int = ImageInput.maximumEdge) -> Encoded? {
        guard PromptAttachments.isImagePath(path), FileManager.default.isReadableFile(atPath: path),
              let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maximumEdge,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(destination), data.length > 0, data.length <= maximumBytes else { return nil }
        return Encoded(mediaType: "image/jpeg", base64: (data as Data).base64EncodedString(), path: path)
    }

    /// Every attached image in the request that could be encoded, in order.
    static func encodeAll(in prompt: String, limit: Int = 8) -> [Encoded] {
        PromptAttachments.imagePaths(in: prompt).prefix(limit).compactMap { encode(path: $0) }
    }
}
