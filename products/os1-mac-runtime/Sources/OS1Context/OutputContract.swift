import Foundation

/// Public presentation/structure contract; no private routing policy.
public enum HumanOutputContract {
    /// Necessary coverage for a snapshot-only recoverability assessment, not
    /// a claim that regexes prove factual correctness or a restore succeeded.
    public static func snapshotReadinessIssues(in answer: String) -> [String] {
        let text = answer.precomposedStringWithCanonicalMapping.lowercased()
        var issues: [String] = []
        let restoreProof = text.range(of: #"(?:복원|복구|restore|recovery)[^.!?\n]{0,55}(?:시험|테스트|리허설|실습|드릴|검증|test|drill|rehearsal)|(?:test|drill|rehearsal)[^.!?\n]{0,35}(?:restore|recovery)"#, options: .regularExpression) != nil ||
            (text.range(of: #"드라이\s*런|dry[- ]?run"#, options: .regularExpression) != nil &&
             ["복원", "복구", "새 클론", "새 기기", "새 환경", "restore", "recovery", "clean environment"].contains(where: text.contains))
        if !restoreProof {
            issues.append("Include an isolated restore test and what it must verify. Upload integrity or a commit schedule alone is not evidence that the system can be recovered.")
        }
        let prerequisites = ["인증", "자격", "비밀", "시크릿", "토큰", "credential", "secret", "oauth", "authentication"]
            .contains(where: text.contains)
        let operationalState = ["데이터베이스", "고객 데이터", "실행 상태", "서비스 상태", "설정", "런타임 데이터", "database", "runtime state", "service state", "configuration"]
            .contains(where: text.contains)
        if !prerequisites || !operationalState {
            issues.append("Distinguish source-code recovery from service configuration, runtime data and per-device authentication/secret prerequisites. Mark unobserved coverage as unknown; do not request pasted credentials or copy auth caches.")
        }
        return issues
    }

    public static func preservesOriginalValues(_ request: String) -> Bool {
        let value = request.precomposedStringWithCanonicalMapping.lowercased()
        let korean = #"(?:원문|원래)(?:\s*(?:값|내용|문구|텍스트))?\s*그대로"#
        if value.range(of: korean + #"\s*(?:말고|아니|쓰지|하지)"#, options: .regularExpression) != nil ||
            value.range(of: #"(?:not|without|don't|do not)\s+(?:use\s+)?verbatim"#, options: .regularExpression) != nil { return false }
        return value.range(of: korean, options: .regularExpression) != nil ||
            value.contains("verbatim") || value.contains("original values unchanged")
    }

    public static func wantsMachineFormat(_ request: String) -> Bool {
        let value = request.precomposedStringWithCanonicalMapping.lowercased()
        if value.range(of: #"(?:json|yaml|코드)(?:을|를|은|는|이런\s*거)?\s*(?:말고|없이|쓰지|아니)|(?:no|without|not)\s+(?:raw\s+)?(?:json|yaml)|(?:don't|do not)\s+(?:use|output|return)\s+(?:json|yaml)"#, options: .regularExpression) != nil { return false }
        return ["json", "yaml", "typescript", "sql", "코드로", "코드만", "원문 그대로", "code only"]
            .contains(where: value.contains)
            || value.range(of: #"\braw\b"#, options: .regularExpression) != nil
    }

    public static func wantsKorean(_ request: String) -> Bool {
        let value = request.precomposedStringWithCanonicalMapping.lowercased()
        if ["영어로", "in english", "answer in english"].contains(where: value.contains) { return false }
        return value.unicodeScalars.filter { (0xAC00...0xD7A3).contains($0.value) }.count >= 3
    }

    public static func instructions(for request: String) -> String {
        """
        User-facing OS-1 answer contract:
        - \(preservesOriginalValues(request) ? "The user requests original values or wording. Preserve them exactly, including their original language; do not add a translation just to satisfy a language preference." : wantsKorean(request) ? "Answer in Korean; preserve identifiers and code as needed." : "Use the user's requested language.")
        - Lead with the result in natural language, like a clear conversational coding assistant. Use short paragraphs and only a few meaningful headings. Avoid repetitive 'conclusion/current position/summary' sections. Do not narrate your internal instructions or reasoning process.
        - Prefer short named components and numbered steps for architectures. Do not use a wide matrix of ALL_CAPS stage IDs, gate IDs and dependency IDs as the main explanation. Use a compact table only when it makes a comparison clearer; put technical identifiers beside the relevant explanation only when needed. Do not end by offering to produce the deliverable the user already requested.
        - \(wantsMachineFormat(request) ? "The user requested a machine/code format: provide that format accurately." : "Schema/architecture/design requests mean a human-readable design, not a machine contract. Describe components, data flow, dependencies and limits in prose. Do not append JSON stages/depends_on configurations unless explicitly requested. Use displayed LaTeX for equations rather than a code block.")
        - Keep source facts distinct from proposed extensions and unknowns. Do not claim tests ran or a scientific problem is solved without evidence. Passing proposed internal compatibility gates is NOT sufficient to establish a new physical theory; empirical predictions, independent validation and agreement with existing observations remain separate requirements. A research plan is not a proof that unification is achievable by completing its checklist.
        - For staged designs, use one consistent set of stages and dependencies. Adoption must cover every required stage/blocker. Do not call a stage independent while requiring all earlier stages to finish first. For machine contracts use explicit required_stage_ids and depends_on arrays instead of duplicated prose ranges.
        - Cite useful source names briefly. OS-1 attaches verified hashes and execution metadata separately; do not repeat hashes, model names, effort or permission settings unless the user asks. No generic VERIFIED/correctness claim in the answer.
        """
    }

    public static func issues(in answer: String, request: String) -> [String] {
        // Reproducing a source/log is not an assertion that its syntax or
        // stage design is valid. Never "repair" quoted original material.
        let intent = request.precomposedStringWithCanonicalMapping.lowercased()
        if ["원문 그대로", "수정 없이", "verbatim", "without modification"].contains(where: intent.contains) { return [] }
        var issues: [String] = []
        let text = answer.precomposedStringWithCanonicalMapping
        let blocks = fencedJSON(text)
        if !wantsMachineFormat(request) {
            let neutral = text.range(of: #"^[\p{N}\s\p{P}\p{S}]+$"#, options: .regularExpression) != nil || Double(text.trimmingCharacters(in: .whitespacesAndNewlines)) != nil
            if wantsKorean(request), !preservesOriginalValues(request), !neutral, !text.unicodeScalars.contains(where: { (0xAC00...0xD7A3).contains($0.value) }) {
                issues.append("Answer the user's Korean request in Korean, not English-only prose.")
            }
            let codeSize = blocks.reduce(0) { $0 + $1.count }
            if codeSize > 900 && codeSize * 2 > text.count {
                issues.append("Replace the JSON-dominated response with a human-readable result, components, dependencies and limitations. The user did not request JSON.")
            }
            let stagePattern = try! NSRegularExpression(pattern: #"\bV([0-9]+)_[A-Z][A-Z_0-9]+\b"#)
            let ns = text as NSString
            let stages = Set(stagePattern.matches(in: text, range: NSRange(location: 0, length: ns.length)).compactMap { Int(ns.substring(with: $0.range(at: 1))) })
            // This catches the exact prose/table mismatch without rejecting
            // ordinary version comparisons or partial work explicitly labelled
            // as a subset. Source reproduction is excluded above.
            let ranges = try! NSRegularExpression(pattern: #"(?i)\bv([0-9]+)\s*[~–-]\s*v?([0-9]+)[^\n.]{0,70}(?:입니다|전체|모두|전부|all|required)"#)
            for match in ranges.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
                let fragment = ns.substring(with: match.range).lowercased()
                if ["일부", "중간", "먼저", "subset", "partial"].contains(where: fragment.contains) { continue }
                if let end = Int(ns.substring(with: match.range(at: 2))), let last = stages.max(), stages.count >= 3, end < last {
                    issues.append("The prose stage range ends at V\(end), but the architecture declares V\(last). Make the summary and declared stages consistent; do not omit a required stage.")
                }
            }
            let tableLines = text.components(separatedBy: "\n").filter { $0.trimmingCharacters(in: .whitespaces).hasPrefix("|") }
            let schemaRequest = ["스키마", "설계", "schema", "architecture"].contains(where: intent.contains)
            if tableLines.count >= 5, tableLines.filter({ $0.filter { $0 == "|" }.count >= 5 }).count >= 5,
               (stagePattern.numberOfMatches(in: text, range: NSRange(location: 0, length: ns.length)) >= 8 || schemaRequest) {
                issues.append("Replace the identifier-dominated wide architecture matrix with concise named components, their purpose and dependencies in readable steps. Preserve technical details but do not use an ID dump as the main answer.")
            }
            if (intent.contains("qmgr") || (intent.contains("qm") && intent.contains("gr"))),
               ["스키마", "설계", "schema", "architecture"].contains(where: intent.contains),
               (text.contains("최종 승인조건") || text.contains("통합\"이라고 주장할 수")),
               !["충분조건이 아", "충분하지", "보장하지", "관측", "실증", "empirical"].contains(where: text.contains) {
                issues.append("Internal compatibility gates are necessary research checks, not sufficient approval of physical QMGR unification. Separate that checklist from empirical predictions, independent validation and observational agreement; do not promise unification by completing V7.")
            }
        }
        for block in blocks {
            guard let data = block.data(using: .utf8) else { continue }
            guard let value = try? JSONSerialization.jsonObject(with: data) else {
                issues.append("A JSON-labelled block is invalid JSON. Correct its syntax or explicitly label it as pseudocode.")
                continue
            }
            guard let root = value as? [String: Any], let stages = root["stages"] as? [[String: Any]] else { continue }
            if !wantsMachineFormat(request), !stages.isEmpty {
                issues.append("The user asked for a readable design, not a stages/depends_on JSON contract. Express the same components and dependencies as concise prose steps; retain the technical substance.")
            }
            let ids = stages.compactMap { $0["stage_id"] as? String }
            let idSet = Set(ids)
            if ids.count != stages.count || idSet.count != ids.count { issues.append("Every stage needs a unique stage_id.") }
            let objective = root["objective"] as? [String: Any] ?? [:]
            if let required = objective["required_stage_ids"] as? [String] {
                let mustCover = Set(stages.filter { $0["required"] as? Bool != false }.compactMap { $0["stage_id"] as? String })
                if !Set(required).isSubset(of: idSet) || !mustCover.isSubset(of: Set(required)) {
                    issues.append("required_stage_ids must cover every required declared stage and reference no missing stage.")
                }
            }
            let numbers = Set(ids.compactMap { id -> Int? in
                guard let match = id.range(of: #"(?i)(?<=STAGE_)\d+"#, options: .regularExpression) else { return nil }
                return Int(id[match])
            })
            let rule = objective["full_adoption_rule"] as? String ?? ""
            if let range = rule.range(of: #"(?i)stages?\s+\d+\s*[-–]\s*\d+"#, options: .regularExpression) {
                let endpoints = rule[range].split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
                if endpoints.count == 2, let maxStage = numbers.max(), endpoints[1] < maxStage {
                    issues.append("Full adoption omits declared stages: the range ends at \(endpoints[1]), but stage \(maxStage) is required.")
                }
            }
            if let state = objective["current_stage"] as? String,
               let r = state.range(of: #"STAGE_\d+_\d+_UNRESOLVED"#, options: .regularExpression) {
                let limits = state[r].split(separator: "_").compactMap { Int($0) }
                let pending = stages.filter { !(($0["status"] as? String ?? "").uppercased().hasPrefix("PASS")) }
                if limits.count == 2, pending.contains(where: { stage in
                    let id = stage["stage_id"] as? String ?? ""
                    return numbers.filter { $0 > limits[1] }.contains { id.uppercased().hasPrefix("STAGE_\($0)_") }
                }) { issues.append("The current_stage summary omits unresolved declared stages. Derive it from the stage list.") }
            }
            let policy = root["adoption_policy"] as? [String: Any] ?? [:]
            let passRule = objective["executable_pass_rule"] as? String ?? ""
            if policy["no_stage_skipping"] as? Bool == true,
               passRule.lowercased().contains("before the next stage"),
               stages.contains(where: { ($0["status"] as? String ?? "").lowercased().contains("independent of") }) {
                issues.append("Independent stages conflict with mandatory sequential unlocking; use consistent depends_on edges.")
            }
            var edges: [String: [String]] = [:]
            for stage in stages {
                guard let id = stage["stage_id"] as? String else { continue }
                let dependencies = stage["depends_on"] as? [String] ?? []
                edges[id] = dependencies
                if dependencies.contains(id) || !Set(dependencies).isSubset(of: idSet) {
                    issues.append("Stage \(id) has a self-reference or missing dependency.")
                }
            }
            // Iterative traversal keeps untrusted deep graphs off the stack.
            var counts = edges.mapValues { Set($0).intersection(idSet).count }
            var dependents: [String: [String]] = [:]
            for (id, dependencies) in edges {
                for dependency in Set(dependencies).intersection(idSet) { dependents[dependency, default: []].append(id) }
            }
            var ready = counts.filter { $0.value == 0 }.map(\.key), seen = 0
            while let id = ready.popLast() {
                seen += 1
                for dependent in dependents[id] ?? [] {
                    counts[dependent, default: 0] -= 1
                    if counts[dependent] == 0 { ready.append(dependent) }
                }
            }
            if seen < idSet.count { issues.append("Stage dependencies contain a cycle.") }
        }
        return Array(Set(issues)).sorted()
    }

    private static func fencedJSON(_ answer: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: "(?is)```json\\s*\\n(.*?)\\n```") else { return [] }
        let ns = answer as NSString
        return regex.matches(in: answer, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range(at: 1)) }
    }
}
