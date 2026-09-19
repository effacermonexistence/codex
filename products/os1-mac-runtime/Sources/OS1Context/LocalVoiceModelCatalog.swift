import Foundation

/// Engine-owned ID/file mapping. Never silently select a different model or download one.
public enum LocalVoiceModelCatalog {
    private struct Entry: Decodable {
        let id: String
        let filename: String
        let is_downloaded: Bool
    }
    public static func resolve(selectedID: String, data: Data, directory: URL) -> String? {
        guard let entries = try? JSONDecoder().decode([Entry].self, from: data),
              let entry = entries.first(where: { $0.id == selectedID }), entry.is_downloaded,
              !entry.filename.isEmpty, entry.filename != ".", entry.filename != "..",
              !entry.filename.contains("/"), !entry.filename.contains("\\") else { return nil }
        let root = directory.resolvingSymlinksInPath().standardizedFileURL.path + "/"
        let file = directory.appendingPathComponent(entry.filename).resolvingSymlinksInPath()
        guard file.path.hasPrefix(root), FileManager.default.fileExists(atPath: file.path) else { return nil }
        return entry.id
    }
}
