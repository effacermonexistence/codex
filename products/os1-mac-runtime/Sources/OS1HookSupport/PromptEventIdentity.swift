import Foundation

public enum PromptEventIdentity {
    // Claude can invoke UserPromptSubmit before creating its first transcript.
    // The containing session ID and prompt are also bound into the submit hash.
    public static func claudeTranscript(path: String, projectsRoot: URL) -> String? {
        let manager = FileManager.default
        let url = URL(fileURLWithPath: path).resolvingSymlinksInPath()
        let root = projectsRoot.resolvingSymlinksInPath().path
        guard url.path.hasPrefix(root + "/"), url.pathExtension == "jsonl" else { return nil }
        do {
            let attributes = try manager.attributesOfItem(atPath: url.path)
            guard attributes[.type] as? FileAttributeType == .typeRegular,
                  let size = attributes[.size] as? NSNumber,
                  let inode = attributes[.systemFileNumber] as? NSNumber else { return nil }
            return "transcript:\(url.path):\(inode):\(size)"
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile || error.code == .fileNoSuchFile {
            return "transcript:\(url.path):initial"
        } catch { return nil }
    }
}
