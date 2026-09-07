import Foundation
import OS1Context

func runProjectMaterialFixtures() throws {
    var count = 0
    func check(_ value: @autoclosure () throws -> Bool) throws {
        let result = try value(); precondition(result); count += 1
    }
    func rejects(_ operation: () throws -> Void) {
        do { try operation(); fatalError("invalid project material accepted") } catch { count += 1 }
    }
    let incident = "인스타그램은 오토매이션 수정 좀 보자 데이트 다 가져와 봐"
    for request in [incident, incident.decomposedStringWithCanonicalMapping,
                    "인스타그램 오토메이션 수정 준비 자료 다 가져와", "SCV source data fetch",
                    "R2에서 인스타그램 자료 가져와", "Instagram automation 자료 다 가져와"] {
        try check(ProjectMaterialIntent.scv(request)?.requiresTransformation == false)
    }
    for request in ["인스타그램 자료 가져와서 분석해", "SCV source fetch and implement the change"] {
        try check(ProjectMaterialIntent.scv(request)?.requiresTransformation == true)
    }
    for request in ["QMGR 자료 가져와", "인스타그램 자료 가져오지 마", "인스타그램 데이터 로컬에서만 가져와",
                    "SCV source fetch from Dropbox", "SCV data restore latest Gold", "인스타그램 데이트 일정 가져와",
                    "\"인스타그램 자료 가져와\" 번역해", "인스타그램 자료 가져오기 기능 수정해",
                    "GitHub에서 인스타그램 소스 가져와", "인스타그램 고객 데이터 연결 기능 설명해",
                    "SCV source fetch from GitHub", "인스타그램 실제 고객 데이터 다 가져와", "로컬에서 인스타그램 자료 가져와"] {
        try check(ProjectMaterialIntent.scv(request) == nil)
    }
    let runtime = Data("source".utf8), manifest = Data("release".utf8)
    let runtimeHash = ProjectMaterialObject.digest(runtime), releaseHash = ProjectMaterialObject.digest(manifest)
    var descriptor: [String: Any] = ["schema":"scv-instagram-recovery-point-fixture", "recovery_point_id":"scv-instagram-fixture",
        "captured_at_utc":"2026-09-06T12:00:00Z",
        "release":["release_id":"scv-instagram-fixture-v1", "release_manifest_sha256":releaseHash],
        "components":[
            ["name":"runtime", "key":"scv-instagram-automation/release-ready/fixture/source.tar.gz", "sha256":runtimeHash, "bytes":runtime.count],
            ["name":"release_manifest", "key":"scv-instagram-automation/recovery-points/fixture/SCV_SINGLE_RELEASE.json", "sha256":releaseHash, "bytes":manifest.count],
            ["name":"production_state", "key":"NEVER_FETCH_CUSTOMERS", "bytes":100],
        ]]
    func encode(_ json: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: json, options: .sortedKeys) }
    func pointer(_ data: Data) throws -> Data {
        try encode(["private_bucket":"omar-private-archive", "current_recovery_point":[
            "recovery_point_id":"scv-instagram-fixture", "key":"scv-instagram-automation/recovery-points/fixture/SCV_RECOVERY_POINT.json",
            "sha256":ProjectMaterialObject.digest(data)]])
    }
    let data = try encode(descriptor), pinned = try pointer(data)
    let plan = try SCVProjectMaterials(pointer:pinned, descriptor:data)
    try check(plan.runtime.name == "runtime" && plan.release.name == "release_manifest")
    try check(plan.releaseID == "scv-instagram-fixture-v1")
    let operating = TaskContext.BaselineRecord(id: "scv-instagram-fixture-v2",
        key: "scv-instagram-automation/release-ready/fixture/v2.tar.gz",
        sha256: String(repeating: "a", count: 64), bytes: 1441639)
    let chosen = try plan.preparationArchive(operating: operating)
    try check(chosen.key == operating.key && chosen.sha256 == operating.sha256 && chosen.bytes == operating.bytes)
    try check(chosen != plan.runtime && plan.releaseID == "scv-instagram-fixture-v1")
    try check(try plan.preparationArchive(operating: nil) == plan.runtime)
    rejects { _ = try plan.preparationArchive(operating: TaskContext.BaselineRecord(id: "v2")) }
    var unsafe = operating
    unsafe.key = "scv-instagram-automation/timestamped-snapshots/customers.tar.gz"
    rejects { _ = try plan.preparationArchive(operating: unsafe) }
    try plan.runtime.verify(runtime); count += 1
    try plan.release.verify(manifest); count += 1
    rejects { try plan.runtime.verify(Data("changed".utf8)) }
    rejects { _ = try SCVProjectMaterials(pointer:pinned, descriptor:Data("{}".utf8)) }
    var components = descriptor["components"] as! [[String:Any]]
    components.append(components[0]); descriptor["components"] = components
    var corrupted = try encode(descriptor)
    rejects { _ = try SCVProjectMaterials(pointer:pointer(corrupted), descriptor:corrupted) }
    components.removeLast(); components[0]["key"] = "scv-instagram-automation/timestamped-snapshots/customers.tar.gz"
    descriptor["components"] = components; corrupted = try encode(descriptor)
    rejects { _ = try SCVProjectMaterials(pointer:pointer(corrupted), descriptor:corrupted) }
    for key in ["/root/source", "../../secrets", "x/../secrets", "foo\nbar", "foo;echo", "x y"] {
        try check(!ProjectMaterialObject.validKey(key))
    }
    try check(try SCVProjectMaterials.archiveInventory("package.json\nSCV_SINGLE_RELEASE.json\nDockerfile\n").count == 3)
    for list in ["package.json\npackage.json\nSCV_SINGLE_RELEASE.json", "../file\npackage.json\nSCV_SINGLE_RELEASE.json", "Dockerfile"] {
        rejects { _ = try SCVProjectMaterials.archiveInventory(list) }
    }
    try check(WorkspaceDiscovery.nodeContext(version:"../../secrets").isEmpty)
    try check(WorkspaceDiscovery.nodeContext(version:"20.20.2",home:URL(fileURLWithPath:"/nonexistent-fixture")).contains("does not block"))
    let home = FileManager.default.temporaryDirectory.appendingPathComponent("os1-node-hint-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at:home) }
    let node = home.appendingPathComponent(".local/share/node-v20.20.2/bin/node")
    try FileManager.default.createDirectory(at:node.deletingLastPathComponent(),withIntermediateDirectories:true)
    try Data("fixture, never execute".utf8).write(to:node)
    try FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:node.path)
    try check(WorkspaceDiscovery.nodeContext(version:"20.20.2",home:home).contains(node.path))
    try check(WorkspaceDiscovery.nodeContext(version:"20.20.2",home:home).contains("verify --version"))
    let output = "R2에서 Instagram 자동화 수정 준비 자료를 검증해 회수했습니다.\n\n자료를 가져왔습니다. 운영 현재 버전은 조회하지 않았습니다.\n\nGitHub 기준: sha\n\n### Dockerfile\n\nFROM node:20.20.2\n"
    let display = RetrievedAnswer.fromEvidence(output:output,sourcePaths:["Dockerfile","source-inventory.txt"])!
    try check(display.overview.contains("조회하지 않았습니다"))
    try check(!display.overview.contains("FROM node") && !display.overview.contains("GitHub 기준"))
    try check(display.original.contains("FROM node:20.20.2"))
    print("Project acquisition intent, artifact boundary, toolchain and readable output: \(count) checks passed")
}
