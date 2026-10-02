import Foundation
import OS1Context

/// The website and preview delivery cards go only to website work. Attached to
/// every write-scope turn, they turned the owner's question "일단은 글로벌해야
/// 되고 대기업 웹페이지 문법을 따라야 되는데?" (2026-10-02) into a fifteen-minute
/// page build with headless Chrome. The texts are the owner's own.
func runWebsiteDeliveryRelevanceFixtures() throws {
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Website delivery relevance: " + message); count += 1
    }
    for request in [
        "https://www.effacermonexistence.com야 이거 완전 1대1 완전 픽셀까지 다 똑같은 복잡 사이트 하나 만들어 로컬에 만들고 레일에 올려",
        "야, WeMakeLolLeague.com 좀 고치자 그... Immersion mode 버튼 제대로 보이지도 않고 뭐 허용하시겠습니까? 그거 뜨지도 않고 딱 첫 번째 페이지만 너무 AI 슬럼 느낌 나는데? 그걸 사진 느낌으로 고쳐",
        "Railway에 배포해",
        "http://127.0.0.1:5173/ 열어서 버튼 정렬 고쳐",
        "Build a landing page for the new product.",
        "랜딩 페이지 디자인 바꿔줘",
    ] {
        check(WebsiteDelivery.relevant(request: request), "website work: \(request.prefix(40))")
    }
    check(WebsiteDelivery.relevant(request: "다 로컬에 만들고 올려",
                                   context: "Owner: 프렌치 웹사이트는 다 복사해야 되는데 이번엔 한번에 잘 못했지?"),
          "a short follow-up in a website conversation keeps the card")
    for request in [
        "일단은 글로벌해야 되고 대기업 웹페이지 문법을 따라야 되는데?\\",
        "그럼 도메인으로 쓸 수 있는 거 예시 좀 줘봐.",
        "usungcorp.com이걸로 하자.",
        "아 씨발놈아 해라고.",
        "이 페이지 무슨 뜻이야?",
        "이 함수 설명해줘",
        "QM이랑 GR 통합할 거 스키마 좀 쓰자",
        "OS1 라우팅 고쳐",
    ] {
        check(!WebsiteDelivery.relevant(request: request), "not website work: \(request.prefix(40))")
    }
    check(!WebsiteDelivery.relevant(request: "그래서 챕터를 다 올린거야?",
                                    context: "Owner: 프렌치 웹사이트는 다 복사해야 되는데"),
          "a status question in a website conversation is not a build")
    check(!WebsiteDelivery.relevant(request: "일단은 글로벌해야 되고 대기업 웹페이지 문법을 따라야 되는데?",
                                    context: "Owner: 유성 도메인 하나 만들어라. 사이트 주소로 쓸 거야"),
          "the owner's domain question stays a question even after a site was mentioned")
    print("Website delivery relevance: \(count) checks passed; delivery cards only for website work")
}
