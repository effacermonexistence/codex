import Foundation
import OS1Context

/// The attachment reference block is the only bridge between the app's
/// composer and the runtime's image inputs; both sides must parse it the
/// same way and never treat a path as anything but data.
func runAttachmentFixtures() throws {
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Attachments: " + message); count += 1
    }
    let request = "이거 봐봐 고쳐\n\n참조 파일 경로:\n\"/Users/LUA/Desktop/Screenshot 2026-09-15 at 11.47.16 AM.png\"\n\"/Users/LUA/notes/spec.md\"\n\"/Users/LUA/Desktop/Screenshot 2026-09-15 at 11.47.16 AM.png\""
    let paths = PromptAttachments.paths(in: request)
    check(paths == ["/Users/LUA/Desktop/Screenshot 2026-09-15 at 11.47.16 AM.png", "/Users/LUA/notes/spec.md"],
          "quoted paths parse in order without duplicates: \(paths)")
    check(PromptAttachments.imagePaths(in: request) == ["/Users/LUA/Desktop/Screenshot 2026-09-15 at 11.47.16 AM.png"],
          "only image extensions count as images")
    check(PromptAttachments.textWithoutReferences(request) == "이거 봐봐 고쳐", "owner text is separated from the block")
    check(PromptAttachments.paths(in: "그냥 질문").isEmpty && PromptAttachments.textWithoutReferences("그냥 질문") == "그냥 질문",
          "no block, no paths, text untouched")
    check(PromptAttachments.paths(in: "참조 파일 경로:\nrelative.png\n\"/ok/a.PNG\"") == ["/ok/a.PNG"], "unquoted or relative lines are ignored")
    check(PromptAttachments.isImagePath("/x/y.HEIC") && !PromptAttachments.isImagePath("/x/y.txt"), "extension check is case-insensitive")
    check(!NativeIngestion.isOS1ControlPrompt(request), "an attachment request is the owner's own turn")
    print("Attachments: \(count) checks passed; reference block parsing, image filter, owner text")
}
