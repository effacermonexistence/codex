import CryptoKit
import Foundation

/// A bounded UI-command ledger, not a second task owner. The caller retains
/// authority over session lookup, submission, cancellation and persistence.
/// An accepted stop receipt means the store accepted the cancellation request;
/// it is never proof that a native process has acknowledged or stopped.
public enum SimulationSessionControl {
    public static let maximumRememberedCommands = 128
    /// Finite per-coordinator identity budget, not an estimate of throughput or
    /// a performance guarantee. Recent receipts can expire without allowing
    /// their commands to execute again. At this larger bound restart the
    /// connection explicitly; never silently forget an executed identity.
    public static let maximumCommandIdentities = 65_536
    public static let maximumTextBytes = 128_000

    public enum Action: String, Codable, Equatable, Sendable {
        case select, open, new, close, order, stop, resume, settings

        public var requiresSession: Bool {
            switch self {
            case .select, .open, .order, .stop, .resume: return true
            case .new, .close, .settings: return false
            }
        }
    }

    public struct Command: Equatable, Sendable {
        public let commandID: UUID
        public let action: Action
        public let sessionID: UUID?
        public let text: String?

        private init(commandID: UUID, action: Action, sessionID: UUID?, text: String?) {
            self.commandID = commandID; self.action = action
            self.sessionID = sessionID; self.text = text
        }

        /// Parsing grants no authorization: the coordinator must independently
        /// bind the main frame, bundled URL and session to its current snapshot.
        public static func parse(commandID: String, action: String,
                                 sessionID: String?, text: String?) -> Command? {
            guard let commandID = UUID(uuidString: commandID), let action = Action(rawValue: action) else { return nil }
            let parsedID: UUID?
            if let sessionID {
                guard let value = UUID(uuidString: sessionID) else { return nil }
                parsedID = value
            } else { parsedID = nil }
            guard !action.requiresSession || parsedID != nil else { return nil }
            // Only an order carries prompt text. Keep its exact bytes, including
            // whitespace, for both execution and replay identity.
            if action == .order {
                guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      text.utf8.count <= maximumTextBytes, !text.contains("\0") else { return nil }
            } else if text != nil { return nil }
            return Command(commandID: commandID, action: action, sessionID: parsedID, text: text)
        }

        fileprivate var fingerprint: String {
            // A typed, length-preserving encoding avoids delimiter collisions.
            let object: [String: Any] = [
                "commandID": commandID.uuidString.lowercased(), "action": action.rawValue,
                "sessionID": sessionID.map { $0.uuidString.lowercased() } ?? NSNull(),
                "text": text.map { $0 as Any } ?? NSNull()
            ]
            let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        }
    }

    public struct ControlOutcome: Codable, Equatable, Sendable {
        public let accepted: Bool
        public let sessionID: UUID?
        public let submissionID: UUID?
        public let message: String

        public init(accepted: Bool, sessionID: UUID? = nil, submissionID: UUID? = nil, message: String) {
            self.accepted = accepted; self.sessionID = sessionID
            self.submissionID = submissionID; self.message = message
        }
    }

    public struct CommandReceipt: Codable, Equatable, Sendable {
        public let commandID: UUID
        public let action: Action
        public let sessionID: UUID?
        public let accepted: Bool
        public let submissionID: UUID?
        public let message: String

        fileprivate init(command: Command, outcome: ControlOutcome) {
            commandID = command.commandID; action = command.action
            sessionID = command.sessionID ?? outcome.sessionID
            accepted = outcome.accepted; submissionID = outcome.submissionID
            message = outcome.message
        }
    }

    public struct Deduplicator: Sendable {
        public enum Decision: Equatable, Sendable {
            case execute
            case replay(CommandReceipt)
            case reject(CommandReceipt)
        }

        private struct Entry: Sendable {
            let fingerprint: String
            var completed: Bool
        }
        private var entries: [UUID: Entry] = [:]
        private var receipts: [UUID: CommandReceipt] = [:]
        private var completedOrder: [UUID] = []
        public let capacity: Int
        public let maximumIdentities: Int
        public var count: Int { entries.count }
        public var receiptCount: Int { receipts.count }

        public init(capacity: Int = maximumRememberedCommands,
                    maximumIdentities: Int = maximumCommandIdentities) {
            precondition((1...maximumRememberedCommands).contains(capacity))
            precondition((1...maximumCommandIdentities).contains(maximumIdentities))
            self.capacity = capacity
            self.maximumIdentities = maximumIdentities
        }

        /// Reserve before invoking any callback. A pending duplicate cannot
        /// dispatch twice, including a re-entrant callback. Only completed
        /// receipt bodies age out of the small cache. Their identity/fingerprint
        /// tombstones remain, so receipt eviction cannot repeat an old action.
        public mutating func begin(_ command: Command) -> Decision {
            if let entry = entries[command.commandID] {
                guard entry.fingerprint == command.fingerprint else {
                    return .reject(receipt(command, message: "Command ID reused with a different payload."))
                }
                if let receipt = receipts[command.commandID] { return .replay(receipt) }
                if entry.completed {
                    return .reject(receipt(command,
                        message: "Command already completed; receipt expired; no action repeated."))
                }
                return .reject(receipt(command, message: "Command already pending; no action repeated."))
            }
            guard entries.count < maximumIdentities else {
                return .reject(receipt(command,
                    message: "Command identity capacity reached; explicitly restart the connection; no action dispatched."))
            }
            entries[command.commandID] = Entry(fingerprint: command.fingerprint, completed: false)
            return .execute
        }

        /// Recording is not authorization and never executes the action. The
        /// original receipt wins if completion is accidentally reported twice.
        public mutating func record(_ command: Command, outcome: ControlOutcome) -> CommandReceipt {
            guard var entry = entries[command.commandID], entry.fingerprint == command.fingerprint else {
                return receipt(command, message: "Command was not reserved with this payload.")
            }
            if let receipt = receipts[command.commandID] { return receipt }
            guard !entry.completed else {
                return receipt(command, message: "Command already completed; receipt expired; no action repeated.")
            }
            let exactOutcome: ControlOutcome
            if let suppliedID = outcome.sessionID, let requestedID = command.sessionID, suppliedID != requestedID {
                exactOutcome = ControlOutcome(accepted: false, sessionID: requestedID,
                    message: "Control outcome session does not match the requested session.")
            } else { exactOutcome = outcome }
            let result = CommandReceipt(command: command, outcome: exactOutcome)
            entry.completed = true; entries[command.commandID] = entry
            receipts[command.commandID] = result
            completedOrder.append(command.commandID)
            while completedOrder.count > capacity {
                receipts.removeValue(forKey: completedOrder.removeFirst())
            }
            return result
        }

        private func receipt(_ command: Command, message: String) -> CommandReceipt {
            CommandReceipt(command: command, outcome: ControlOutcome(accepted: false,
                sessionID: command.sessionID, message: message))
        }
    }

    public enum Status: String, Codable, Equatable, Sendable {
        case stopping, working, paused, queued, failed, completed, idle
    }

    /// Projection only. Pausing the queue does not claim an already executing
    /// task has stopped. Cancellation remains `stopping` until active clears.
    public static func status(active: Bool, cancellationRequested: Bool, queuePaused: Bool,
                              queuedCount: Int, failed: Bool, completed: Bool) -> Status {
        if active { return cancellationRequested ? .stopping : .working }
        if queuePaused { return .paused }
        if queuedCount > 0 { return .queued }
        if failed { return .failed }
        if completed { return .completed }
        return .idle
    }
}
