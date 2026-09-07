import Foundation
import Darwin
import OS1Context

func voiceProcessChildIfRequested() {
    guard CommandLine.arguments.count == 2 else { return }
    switch CommandLine.arguments[1] {
    case "--voice-output-fixture":
        FileHandle.standardOutput.write(Data(repeating: 65, count: 1_000_000))
        FileHandle.standardError.write(Data(repeating: 66, count: 1_000_000))
        exit(0)
    case "--voice-wait-fixture":
        Thread.sleep(forTimeInterval: 10); exit(0)
    case "--voice-fail-fixture":
        FileHandle.standardError.write(Data("fixture failure".utf8)); exit(7)
    default: return
    }
}

func runVoiceProcessFixtures() throws {
    let binary = Bundle.main.executableURL!
    // Reproduce the old wait-before-drain ordering, bounded by the test harness.
    let old = Process(), stdout = Pipe(), stderr = Pipe()
    old.executableURL = binary; old.arguments = ["--voice-output-fixture"]
    old.standardOutput = stdout; old.standardError = stderr
    try old.run()
    Thread.sleep(forTimeInterval: 0.5)
    precondition(old.isRunning, "Legacy deadlock fixture must actually fill the undrained pipe")
    old.terminate(); old.waitUntilExit()
    try stdout.fileHandleForReading.close(); try stderr.fileHandleForReading.close()
    let data = try VoiceProcess.run(executable: binary, arguments: ["--voice-output-fixture"],
                                   cancellation: .init(), timeout: 5)
    precondition(data == Data(repeating: 65, count: 1_000_000))
    func rejects(_ mode: String, token: VoiceProcessCancellation = .init(), timeout: Double = 5,
                 limit: Int = 4_000_000, expected: (VoiceProcessError) -> Bool) throws {
        let start = ProcessInfo.processInfo.systemUptime
        do {
            _ = try VoiceProcess.run(executable: binary, arguments: [mode], cancellation: token,
                                     timeout: timeout, maximumOutput: limit)
            fatalError("Expected voice failure")
        } catch let error as VoiceProcessError { precondition(expected(error)) }
        precondition(ProcessInfo.processInfo.systemUptime - start < 3)
    }
    try rejects("--voice-wait-fixture", timeout: 0.1) { if case .timedOut = $0 { true } else { false } }
    let early = VoiceProcessCancellation(); early.cancel()
    try rejects("--voice-wait-fixture", token: early) { if case .cancelled = $0 { true } else { false } }
    let active = VoiceProcessCancellation()
    DispatchQueue.global().asyncAfter(deadline: .now() + 0.15) { active.cancel() }
    try rejects("--voice-wait-fixture", token: active) { if case .cancelled = $0 { true } else { false } }
    try rejects("--voice-output-fixture", limit: 1000) { if case .outputLimit = $0 { true } else { false } }
    try rejects("--voice-fail-fixture") { if case .failed(7, "fixture failure") = $0 { true } else { false } }
    print("OS-1 voice lifecycle: legacy pipe stall reproduced; 6 replacement fixtures passed")
}
