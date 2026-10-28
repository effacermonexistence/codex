import Foundation
import OS1Context

/// `os1 dictation transcribe --wav PATH [--language CODE] [--timeout-seconds N]`.
///
/// Same lane and credential source as OS1App's voice controller: the App's
/// defaults are `CodexDictationAuthorization.credential()` (the selected Codex
/// CLI's ChatGPT sign-in, read in memory through its app-server) and
/// `CodexDictationURLSessionTransport()`, and its batch call is
/// `CodexNativeDictation.transcribe(wav:)`. No new sign-in flow, API key,
/// stored token or App IPC; the token never reaches stdout, stderr or disk.
/// Stdout carries only the transcript; failures use the exit statuses in
/// `CodexDictationFileTranscription.ExitStatus`.
enum DictationCommand {
    static func run(_ arguments: [String]) async -> Int32 {
        await CodexDictationFileTranscription.run(arguments,
            credential: CodexDictationAuthorization.credential(),
            transport: CodexDictationURLSessionTransport(),
            standardOutput: { text in FileHandle.standardOutput.write(Data((text + "\n").utf8)) },
            standardError: { line in FileHandle.standardError.write(Data((line + "\n").utf8)) })
    }
}
