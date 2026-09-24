import Foundation

/// A request about OS-1 itself rarely names "OS1": the owner is looking at
/// OS-1 while typing it ("왜 말풍선이 딱 안 맞냐? 코덱스 기준으로 고쳐",
/// "새 채팅에서 보낸 게 Q에 쌓여 그거 고쳐"). Left unbound, such a request ran
/// in HOME and the backend edited either the live tree without OS-1's source
/// lease or an unregistered stale copy, so OS-1 never built or installed the
/// fix (2026-09-23). This recognizes OS-1's own surfaces so the request runs in
/// OS-1's registered source tree, where OS-1 finishes the repair itself.
/// Binding projection only: the prompt and its constraints stay unchanged.
public enum OS1SelfReference {
    public struct Inference: Equatable, Sendable {
        public let bound: Bool
        /// Short, human-readable evidence ("말풍선", "Codex 기준 비교").
        public let signals: [String]
        /// Why a request with OS-1 signals was not bound.
        public let blockedBy: String?
    }

    /// Names, including speech-recognition spellings seen in owner requests.
    static let namedPatterns = [
        #"(?<![a-z0-9_])o{1,2}s[ -]?1(?![0-9a-z_])"#,
        #"(?<![a-z0-9_])(?:clodex|cluedex|clue ?dex|cluex)(?![a-z0-9_])"#,
        #"클로덱스|클루덱스|클러덱스|클로드덱스|클루엑스"#,
        #"/products/os1-mac-runtime"#,
    ]
    /// OS-1 surfaces a request can only mean inside OS-1.
    static let surfaces: [(label: String, pattern: String)] = [
        ("말풍선", #"말풍선|(?<![a-z0-9_])bubble(?![a-z0-9_])|버블"#),
        ("채팅창", #"채팅\s*창|새\s*채팅|새로운\s*채팅|새\s*대화|새로운\s*대화|대화\s*창|입력\s*창|컴포저|(?<![a-z0-9_])composer(?![a-z0-9_])"#),
        ("스티어링", #"스티어링|(?<![a-z0-9_])steering(?![a-z0-9_])"#),
        ("대기열", #"대기열|(?:^|[^a-z가-힣])(?:q|큐)\s*(?:에|가|를|로|는|에서)?\s*(?:쌓|밀려|걸려|남아|들어가|넘어가)"#),
        ("사이드바", #"사이드\s*바|(?<![a-z0-9_])sidebar(?![a-z0-9_])|세션\s*창|세창"#),
        ("거버넌스", #"(?:rcc|os1|os-1)\s*(?:가버|가보|거버|가이브)|(?:거버넌스|가버넌스|governance)\s*(?:모니터|monitor|탭|tab|레이어|패널|panel|그래프|창)|액티비티\s*모니터\s*(?:처럼|같이)|activity monitor"#),
        ("음성 입력", #"위스퍼|(?<![a-z0-9_])whisper(?![a-z0-9_])|받아쓰기|음성\s*입력"#),
        ("라우팅", #"(?:코덱스|codex|클로드|claude|gpt|지피티|클러더|클로즈)[^.?!\n]{0,20}라우팅|(?:자동|니가|네가|너가)\s*라우팅|라우팅(?:을|이)?\s*(?:왜\s*)?(?:계속\s*)?(?:코덱스|codex|클로드|claude|gpt)\s*(?:한테|에게)|(?:코덱스|codex|클로드|claude|클러더)\s*(?:한테|에게)\s*(?:만|도)?\s*(?:넘기|넘겨|보내|시키)"#),
        ("백엔드 창", #"(?:코덱스|codex|클로드|claude).{0,30}(?:앞으로|앞에|위로|맨\s*위)\s*(?:떠|뜨|튀어|나오|나와)|왼쪽(?:에|의)?\s*(?:있는\s*)?(?:코덱스|클로드|codex|claude)"#),
    ]
    /// The owner's standing measure: OS-1 must behave like Codex / Claude Code.
    static let parityPattern = #"(?:코덱스|코디스|코덱|codex|클로드\s*코드|claude\s*code|커로드\s*코드)\s*(?:기준|처럼|같이|보면|수준|컨버전스|(?:랑|와|하고|이랑)\s*.{0,12}(?:똑같|일치|통일|맞춰|같게|컨버전스))|like\s+(?:codex|claude\s+code)|(?:codex|claude\s+code)[- ](?:style|parity)"#
    /// Weaker hints: count only in combination.
    static let hints: [(label: String, pattern: String)] = [
        ("백엔드", #"백엔드|백겐드|백핸드|(?<![a-z0-9_])backend(?![a-z0-9_])"#),
        ("토큰·완료율", #"코타|쿼타|quota|토큰\s*(?:절감|절약|감소|세이브)|테스크\s*완료율|태스크\s*완료율|task completion"#),
        ("첨부", #"첨부|드래그|drag"#),
        ("버튼", #"(?:멈춤|정지|전송|보내기)\s*버튼|stop button"#),
        ("OS-1 동작", #"(?:니가|네가|너가|너는|넌)\s.{0,24}(?:라우팅|출력|답변|보내|실행|띄우|넘기)"#),
    ]
    static let deicticPattern = #"이거|이런|요거|여기|저거|봐봐|보이지|보여"#
    static let inlineImagePattern = #"\.(?:png|jpe?g|gif|webp|heic)(?![a-z0-9])"#
    /// Fixing what is there (not making something new), including the
    /// complaint form OS-1 must act on ("…게 해", "…돼야 되는데", "…안 된다니까").
    static let fixPatterns = [
        #"고쳐|고치|고철|수정|바꿔|바꾸|손봐|손 봐|맞춰|통일|개선|해결|잡아줘|삭제|(?<![a-z0-9_])(?:fix|modify|remove)(?![a-z])"#,
        #"(?:로|으로)\s*(?:해(?!서)|바꿔|설정)"#,
        #"(?:나오|보이|되|뜨|떠|움직이|넘기|보내지|쌓이|붙)(?:게|도록)\s*(?:해|하라|해줘|해라|해봐|만들어|바꿔)"#,
        #"(?:올려|내려|넣어|빼줘|빼라|없애|지워|옮겨|띄워|숨겨|정리해)"#,
        #"(?:되|돼)야\s*(?:돼|되|한다|하는데|되는데|된다니까|되거든)"#,
        #"안\s*(?:된다니까|되잖아|되거든|보여)|못\s*(?:하잖아|해)|하면\s*안\s*(?:돼|된다)"#,
    ]
    /// Anything naming a different product or a website is never inferred.
    static let foreignPatterns = [
        #"사이트|홈페이지|웹\s*사이트|웹\s*페이지|website|web\s*site|web\s*page|landing|랜딩"#,
        #"인스타|instagram|(?<![a-z])scv(?![a-z])|매니챗|manychat|(?<![a-z])wml(?![a-z])|롤\s*리그|lol\s*league|wemakelol"#,
        #"오마이\s*(?:agi|에이지아이|아지아이|아티스트)|omar\s*agi|omaragi|(?<![a-z])byok(?![a-z])|닷컴|dot\s*com"#,
        #"(?<![a-z0-9@._/-])[a-z0-9][a-z0-9-]{1,62}\.(?:com|net|org|io|ai|dev|co|kr|xyz|site|me|gg|tv)(?![a-z0-9])"#,
    ]
    /// A clause that excludes or preserves something ("…하지 마", "…금지", "보존").
    static let exclusionPattern = #"하지\s*마|하지\s*말|금지|제외|손대지|건드리지|보존|(?<![a-z])(?:do not|don't|preserve|without)(?![a-z])"#
    /// The whole request forbids editing ("수정은 하지 마", "파일 수정·배포 없이").
    static let noChangePattern = #"(?:수정|변경|편집|고치|손대)\s*(?:은|는|을|를|도)?\s*하지\s*마|(?:수정|변경|편집)[^.\n]{0,14}없이|(?<![a-z])(?:without (?:modifying|changing|editing)|no file changes)(?![a-z])"#
    static let scopedChangePattern = #"(?:불필요한|쓸데없는|다른|추가|관련\s*없는|기존|(?<![a-z])(?:unnecessary|unrelated|other|extra))\s*(?:\S+\s*){0,2}(?:수정|변경|편집|modif|chang|edit)"#
    static let mediaExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "heic", "tiff", "tif", "bmp",
                                                "mov", "mp4", "m4a", "mp3", "wav", "pdf"]

    static func matches(_ pattern: String, _ text: String) -> Bool {
        text.range(of: pattern, options: .regularExpression) != nil
    }

    /// True when the directory is not inside another project checkout: HOME
    /// itself, or a folder under HOME with no enclosing git work tree.
    public static func isProjectless(_ workspace: String, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> Bool {
        let homePath = home.standardizedFileURL.resolvingSymlinksInPath().path
        var url = URL(fileURLWithPath: workspace).standardizedFileURL.resolvingSymlinksInPath()
        guard url.path == homePath || url.path.hasPrefix(homePath + "/") else { return false }
        for _ in 0..<16 {
            if url.path == homePath { return true }
            if FileManager.default.fileExists(atPath: url.appendingPathComponent(".git").path) { return false }
            let parent = url.deletingLastPathComponent()
            if parent.path == url.path { break }
            url = parent
        }
        return true
    }

    /// An absolute path the owner typed as a work target outside OS-1 (not an
    /// attachment, media, OS-1's own data, or a drop folder such as Desktop).
    static func foreignTargetPath(in text: String, os1Roots: [String], home: String) -> String? {
        var scan = text
        for root in os1Roots { scan = scan.replacingOccurrences(of: root, with: " ") }
        let own = ["/Library/Application Support/OS-1", "/.os1", "/Applications/OS-1 CLODEX.app", "/.local/bin",
                   "/Library/Logs", "/.codex", "/.claude", "/Desktop", "/Downloads", "/Pictures", "/Movies", "/Applications"].map { home + $0 }
        guard let regex = try? NSRegularExpression(pattern: #"(?:~|/Users/[^/\s"'“”]+)(?:/[^\s"'“”)<>,]+)+"#) else { return nil }
        for match in regex.matches(in: scan, range: NSRange(scan.startIndex..., in: scan)) {
            guard let range = Range(match.range, in: scan) else { continue }
            var path = String(scan[range]).trimmingCharacters(in: CharacterSet(charactersIn: ".:;"))
            if path.hasPrefix("~") { path = home + path.dropFirst() }
            if mediaExtensions.contains(URL(fileURLWithPath: path).pathExtension.lowercased()) { continue }
            if path.contains("/products/os1-mac-runtime") ||
                LocalProjectWorkspace.root(containing: path, projectID: "os1-clodex") != nil { continue }
            if own.contains(where: { path == $0 || path.hasPrefix($0 + "/") }) { continue }
            if path.contains("/Desktop") || path.lowercased().contains("screenshot") { continue }
            return path
        }
        return nil
    }

    /// Decide whether a request not bound to any project is about OS-1 itself.
    /// - request: the owner's words (the app's attachment block may follow).
    /// - projectless: the conversation folder is HOME or not a project checkout.
    /// - os1Roots: registered OS-1 source roots.
    public static func infer(request: String, projectless: Bool, os1Roots: [String] = [],
                             home: URL = FileManager.default.homeDirectoryForCurrentUser) -> Inference {
        let words = OwnerIntentText.authorityText(PromptAttachments.textWithoutReferences(request))
        let text = words.precomposedStringWithCanonicalMapping.lowercased()
        let named = namedPatterns.contains { matches($0, text) }
        let surfaceHits = surfaces.filter { matches($0.pattern, text) }.map(\.label)
        let parity = matches(parityPattern, text)
        let weak = hints.filter { matches($0.pattern, text) }.map(\.label)
        let hasImage = !PromptAttachments.imagePaths(in: request).isEmpty || matches(inlineImagePattern, text)
        let showing = hasImage && matches(deicticPattern, text)
        var signals = (named ? ["OS-1 이름"] : []) + surfaceHits
        if parity { signals.append("Codex/Claude Code 기준 비교") }
        if showing { signals.append("화면 첨부") }
        signals += weak
        func blocked(_ reason: String) -> Inference { Inference(bound: false, signals: signals, blockedBy: reason) }
        guard named || parity || !surfaceHits.isEmpty || weak.count >= 2 || showing else {
            return blocked("OS-1 표면 신호 없음")
        }
        guard projectless else { return blocked("대화 폴더가 다른 프로젝트 안에 있음") }
        // Only what the owner asks for counts: "instagram·배포는 하지 마" and
        // "usung-demo는 보존해" exclude something, they do not target it.
        let asked = words.replacingOccurrences(of: #"(?:[.!?]\s+|[;\n])"#, with: "\n", options: .regularExpression)
            .components(separatedBy: "\n").filter { !matches(exclusionPattern, $0.lowercased()) }.joined(separator: "\n")
        if foreignPatterns.contains(where: { matches($0, asked.lowercased()) }) { return blocked("다른 제품·사이트를 가리킴") }
        if let path = foreignTargetPath(in: asked, os1Roots: os1Roots, home: home.path) {
            return blocked("OS-1 밖의 작업 경로를 지정함: \(path)")
        }
        // The owner must be asking for a change, not asking about one.
        let normalized = OwnerIntentText.normalized(words)
        // "불필요한 수정은 하지 마" limits the change; it does not forbid it.
        let forbidsAnyChange = normalized.replacingOccurrences(of: #"(?:[.!?]\s+|[;\n])"#, with: "\n", options: .regularExpression)
            .components(separatedBy: "\n").contains { matches(noChangePattern, $0) && !matches(scopedChangePattern, $0) }
        if PreparationIntent.modificationProhibitions.contains(where: normalized.contains) || forbidsAnyChange {
            return blocked("수정 금지·설명만 요청")
        }
        if PreparationIntent.isFeasibilityOnlyQuestion(normalized) { return blocked("가능 여부만 묻는 질문") }
        let fix = fixPatterns.contains { matches($0, normalized) }
        let work = fix || PreparationIntent.changeVerbs.contains(where: normalized.contains) ||
            PreparationIntent.executionDirectives.contains(where: normalized.contains)
        // A named OS-1 or one of its surfaces with any work request binds.
        // "Like Codex", a shown screen or loose hints only bind a fix of
        // something that exists ("코덱스처럼 만들어줘" may mean a new file).
        let bound = ((named || !surfaceHits.isEmpty) && work) || ((parity || showing || weak.count >= 2) && fix)
        return bound ? Inference(bound: true, signals: signals, blockedBy: nil) : blocked("수정·작업 지시 없음")
    }
}
