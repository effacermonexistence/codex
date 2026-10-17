import Foundation
import OS1Context

/// A request about OS-1 that does not say "OS1" must still run in OS-1's own
/// source tree. On 2026-09-23 three such owner requests (bubble fit, queue on
/// a new chat, routing label) ran in HOME: two edited the live tree without
/// OS-1's lease, one edited a stale copy, and none was built or installed.
/// The texts below are the owner's real requests (attachment paths kept).
func runOS1SelfReferenceFixtures() throws {
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "OS-1 self-reference: " + message); count += 1
    }
    let home = FileManager.default.temporaryDirectory.appendingPathComponent("os1-selfref-" + UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: home) }
    let attached = { (path: String) in "\n\n참조 파일 경로:\n" + String(decoding: try! JSONEncoder().encode(path), as: UTF8.self) }
    func bound(_ request: String, projectless: Bool = true) -> OS1SelfReference.Inference {
        OS1SelfReference.infer(request: request, projectless: projectless, os1Roots: [], home: home)
    }

    // The three requests that never reached the app.
    let bubble = "그리고 이거 눈에 존나 거슬려... 왜 말풍선이 딱 안 맞냐? 코덱스 보면 말풍선이 딱딱 맞거든? 봐봐, 이런 거 보면은... 코덱스 기준으로 고쳐" +
        attached("/Users/LUA/Desktop/Screenshot 2026-09-23 at 2.30.39 PM.png")
    let queue = "야 그리고 이상한 현상이 있어 새로운 채팅에 열면은 내가 뭐 해라 뭐 해라 하면 바로 보내지지 않아? 근데 테스크가 다 끝나고 보내면 바로 빡 보내줘야 되는데 Q에 쌓여 그거 고쳐"
    let steering = "그리고 방금도 내가 스티어링 해서 줬잖아 그럼 네가 한거 마지막에 다시 넣어야 되는데 바로 딱 붙어 버리잖아 니가 출력을 먼저 했으면 그 다음에 후속으로 스티어링이 넘어가야 되는데 코덱스 기준으로 고쳐"
    let routing = "그리고 이거 존나 헷갈리거든? 봐봐 이게 코덱스의 라우팅이 된건지, GPT의 라우팅이 된건지, 클로드 코드의 라우팅이 된건지, 클로드의 라우팅이 된건지 구분이 안가. 그것 좀 고쳐.그러니까 고치란 이유가 뭐냐면은 GPT에다가 라우팅을 시켰어. 그럼 코타가 안 단단 말이야 그러면 난 안심해서 어 그래 코타를 안 달게 잘 작업을 하고 있군 판단이 안 돼" +
        attached("/Users/LUA/Desktop/Screenshot 2026-09-23 at 2.33.03 PM.png")
    for (name, text) in [("bubble", bubble), ("queue", queue), ("steering", steering), ("routing label", routing)] {
        let inference = bound(text)
        check(inference.bound, "\(name) request binds OS-1 (blocked by \(inference.blockedBy ?? "-"))")
    }
    check(bound(bubble).signals.contains("말풍선") && bound(bubble).signals.contains("Codex/Claude Code 기준 비교"), "bubble evidence is named")
    check(bound(queue).signals.contains("대기열"), "Q에 쌓여 is the queue")

    // Other real OS-1 requests without the name.
    for text in [
        "야 시발놈아 왼쪽에 있는 코덱스가 왜 사라져버렸어 고쳐",
        "그리고 클로드한테도 넘기게 해 왜 코덱스한테만 넘기냐? 항상 전체적으로 토큰 다 감시해야 돼",
        "야 이거 봐봐 이거 첨부하면은 이렇게 나온단 말이야? 이렇게 나오면 안되고 코디스처럼 나와야 되거든? 고쳐" + attached("/Users/LUA/Desktop/Screenshot 2026-09-20 at 2.59.52 PM.png"),
        "아 이거 액티비티 모니터 처럼 실시간으로 움직여야 된다니까? 고쳐" + attached("/Users/LUA/Desktop/Screenshot 2026-09-20 at 6.38.52 PM.png"),
        "이것도 고쳐 OOS1 세션창 누를 때 코덱스처럼 무슨 세션창 눌렀는지 시각적으로 그게 안 돼",
        "/Users/LUA/Desktop/Screenshot 2026-09-15 at 11.47.16 AM.png야 이거 탭 누를 때마다 이상한 인터페이스가 있거든? 이거 삭제해",
        "그리고 default 언어 영어로 설정하고 다국어로 해 그리고 세팅에 가서 사람들이 클로드 코드나 코덱스처럼 설정할 수 있으면 좋을 텐데",
        "OS1 자가수리를 실행해. 대상은 /Users/LUA/Documents/Codex/OS1-Air-Takeover-20260913-c8410129bd1556e7/products/os1-mac-runtime. 자동 라우팅 시 Codex와 Claude 창이 전경을 빼앗지 않게 필요한 수정까지 끝내. 공개 배포·Instagram·외부 발송 금지. 이미 수정됐다면 불필요한 수정은 하지 마.",
    ] {
        let inference = bound(text)
        check(inference.bound, "binds: \(text.prefix(40)) (blocked by \(inference.blockedBy ?? "-"))")
    }

    // Never inferred: another product, a site, a path elsewhere, read-only
    // work, a question, or a folder inside another project.
    for (text, reason) in [
        ("야, WeMakeLolLeague.com 좀 고치자 그... Immersion mode 버튼 제대로 보이지도 않고", "a named website"),
        ("야 하나만 수정하자. 오마이... AGI.COM 가면은 벤치마크에 ABCD에 2.39에서 1.93 M이라고 했거든? 그거 좀 단위 좀 바꿔.", "OmarAGI site"),
        ("야 인스타그램 오토메이션 수정해야 되니까 준비해라", "Instagram"),
        ("OS1_NATIVE_DESKTOP_ACCEPTANCE_197: Codex로 독립 로컬 구현 작업을 실행해. /Users/LUA/Documents/Codex/os1-desktop-acceptance197/index.html 파일을 새로 만들고 제목 OS1 Native Desktop, 상태 Ready를 넣어.", "a target outside OS-1"),
        ("OS1 build188 GUI 경로 검증입니다. 파일 변경·설치·배포 없이 /Users/LUA/Applications/OS-1 CLODEX.app/Contents/Info.plist 의 CFBundleVersion만 실제로 읽고 결과를 한 줄로 알려 주세요.", "no file changes"),
        ("스티어링 확인 코드 PINK205_A. 최종 답변에 이 코드도 포함하세요. 파일 수정은 하지 마세요.", "edits forbidden"),
        ("GUI_STEERING_205 확인 작업: 파일 수정이나 배포 없이 shell sleep 25를 한 번 실행하세요.", "STEERING inside a token is not the steering UI"),
        ("코덱스로 답해. 바다와 호수의 차이를 다섯 문장으로 설명해. 파일 수정은 하지 마.", "an explanation"),
        ("야 너 셀프로 OS1 고칠 수 있냐?", "a feasibility question"),
        ("야 뭐야 내가 왜 세창에 했는데 왜 병렬로 안 돌아가", "a question without a change request"),
        ("express 라우팅 코덱스로 고쳐줘", "web routing done with Codex"),
        ("코덱스처럼 파이썬 스크립트 만들어줘", "like Codex, but making something new"),
        ("AI 거버넌스 문서 만들어줘", "governance as a document topic"),
        ("이번 주 작업 목록 만들어줘", "a task list"),
    ] {
        let inference = bound(text)
        check(!inference.bound, "not bound (\(reason)): \(text.prefix(40))")
    }
    check(!bound(bubble, projectless: false).bound, "a conversation inside another project is never rebound")
    check(bound(bubble, projectless: false).blockedBy?.contains("다른 프로젝트") == true, "the reason names the other project")

    // Projectless means HOME or a folder that is not inside a checkout.
    let loose = home.appendingPathComponent("notes/2026", isDirectory: true)
    let repo = home.appendingPathComponent("Documents/site", isDirectory: true)
    try FileManager.default.createDirectory(at: loose, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: repo.appendingPathComponent(".git/objects"), withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: repo.appendingPathComponent("src"), withIntermediateDirectories: true)
    check(OS1SelfReference.isProjectless(home.path, home: home), "HOME is projectless")
    check(OS1SelfReference.isProjectless(loose.path, home: home), "a loose folder under HOME is projectless")
    check(!OS1SelfReference.isProjectless(repo.appendingPathComponent("src").path, home: home), "a folder inside a checkout is a project")
    check(!OS1SelfReference.isProjectless("/private/tmp", home: home), "a folder outside HOME is not treated as HOME")

    // A registered OS-1 root with spaces in its path is OS-1's, not a target elsewhere.
    let root = home.appendingPathComponent("Documents/Documents - MacBook Air (2)/Codex/OS1-live").path
    let named = "OS1 스티어링 고쳐. 대상은 \(root)/products/os1-mac-runtime 이다."
    check(OS1SelfReference.infer(request: named, projectless: true, os1Roots: [root], home: home).bound,
          "a path inside a registered OS-1 root does not block")
    print("OS-1 self-reference: \(count) checks passed")
}
