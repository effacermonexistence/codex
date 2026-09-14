import Foundation
import OS1Context

/// Arithmetic fixtures only. No runtime outcomes, baseline evidence or paid calls are created.
func runGovernanceStatisticsFixtures() {
    var checks = 0
    func check(_ value: @autoclosure () -> Bool, _ label: String) { precondition(value(), label); checks += 1 }
    func near(_ value: Double?, _ expected: Double, _ label: String) {
        check(value.map { abs($0-expected) < 1e-10 } ?? false, label)
    }
    typealias Q = GovernanceQualitySummary
    typealias P = GovernancePairedSummary
    typealias R = P.Row
    let empty = Q(outcomes:[],tokens:[])
    check(empty.rate == nil && empty.bounds == nil && empty.totalTokens == nil, "empty != zero")
    let unknown = Q(outcomes:[true,false,nil],tokens:[100,200,300])
    check(unknown.eligible == 3 && unknown.verifiedSuccesses == 1 && unknown.verifiedFailures == 1 && unknown.unknown == 1, "separate unknown outcome")
    check(unknown.rate == nil && unknown.successesPerMillion == nil, "missing verdict blocks point estimate")
    near(unknown.bounds?.lowerBound,1.0/3,"identification lower bound")
    near(unknown.bounds?.upperBound,2.0/3,"identification upper bound")
    let known = Q(outcomes:[true,false],tokens:[100,900])
    near(known.rate,0.5,"binary observed rate")
    near(known.successesPerMillion,1000,"failure cost stays in denominator")
    near(Q(outcomes:[false],tokens:[100]).successesPerMillion,0,"known failure is zero success, not unknown")
    check(Q(outcomes:[true],tokens:[nil]).totalTokens == nil,"missing cost not imputed")
    check(Q(outcomes:[true],tokens:[-1]).totalTokens == nil,"negative cost rejected")
    check(Q(outcomes:[true],tokens:[]).totalTokens == nil,"cost cohort mismatch")
    check(Q(outcomes:[true,true],tokens:[Int.max,1]).totalTokens == nil,"integer overflow rejected")
    check(Q(outcomes:[true],tokens:[0]).successesPerMillion == nil,"zero cost denominator")
    near(GovernanceStatistics.savings(baseline:100,candidate:250),-1.5,"negative savings retained")
    near(GovernanceStatistics.savings(baseline:100,candidate:0),1,"measured zero candidate cost")
    check(GovernanceStatistics.savings(baseline:0,candidate:0) == nil,"zero baseline")
    check(GovernanceStatistics.savings(baseline:nil,candidate:1) == nil,"no synthetic baseline")
    check(GovernanceStatistics.savings(baseline:1,candidate:Double.nan) == nil,"NaN rejected")
    check(GovernanceStatistics.savings(baseline:Double.infinity,candidate:1) == nil,"infinite baseline rejected")
    check(GovernanceStatistics.savings(baseline:1,candidate:-1) == nil,"negative candidate rejected")
    check(GovernanceStatistics.savings(baseline:Double.leastNonzeroMagnitude,candidate:Double.greatestFiniteMagnitude) == nil,"floating overflow rejected")
    let rows = [R(id:"a",baselineSuccess:true,candidateSuccess:false,baselineTokens:1,candidateTokens:2),
                R(id:"b",baselineSuccess:false,candidateSuccess:true,baselineTokens:999,candidateTokens:499)]
    let paired = P(expectedIDs:["a","b"],rows:rows)!
    near(paired.tokenSavings,0.499,"ratio of sums, not mean percentage")
    near(paired.completionDelta,0,"net zero must not hide regression")
    check(paired.gains == 1 && paired.regressions == 1,"both off-diagonal counts exposed")
    near(paired.efficiencyGain,1000.0/501-1,"success-adjusted efficiency")
    near(paired.discordanceP,1,"balanced discordance")
    check(paired.pareto == "pareto_improvement","sample aggregate Pareto is not zero-regression proof")
    check(P(expectedIDs:["a","b"],rows:[rows[0]]) == nil,"missing pair rejected")
    check(P(expectedIDs:["a","b"],rows:[rows[0],rows[0]]) == nil,"duplicate rows rejected")
    check(P(expectedIDs:["a","a"],rows:rows) == nil,"duplicate cohort rejected")
    check(P(expectedIDs:["a","c"],rows:rows) == nil,"wrong row identity rejected")
    check(P(expectedIDs:[],rows:[]) == nil,"empty cohort rejected")
    let partial = P(expectedIDs:["a"],rows:[R(id:"a",baselineSuccess:true,candidateSuccess:nil,baselineTokens:1,candidateTokens:1)])!
    check(partial.completionDelta == nil && partial.discordanceP == nil && partial.efficiencyGain == nil && partial.pareto == "unmeasured","unknown outcome never treated as pass or fail")
    let noCost = P(expectedIDs:["a"],rows:[R(id:"a",baselineSuccess:false,candidateSuccess:true,baselineTokens:1,candidateTokens:nil)])!
    check(noCost.completionDelta == 1 && noCost.tokenSavings == nil && noCost.efficiencyGain == nil,"independent metric missingness")
    let gainRows = (0..<6).map { R(id:String($0),baselineSuccess:false,candidateSuccess:true,baselineTokens:100,candidateTokens:90) }
    let six = P(expectedIDs:gainRows.map(\.id),rows:gainRows)!
    near(six.discordanceP,0.03125,"exact McNemar six vs zero: 2/64")
    check(six.efficiencyGain == nil,"zero baseline success has undefined relative gain")
    let reverseRows = gainRows.map { R(id:$0.id,baselineSuccess:$0.candidateSuccess,candidateSuccess:$0.baselineSuccess,baselineTokens:$0.candidateTokens,candidateTokens:$0.baselineTokens) }
    let reverse = P(expectedIDs:reverseRows.map(\.id),rows:reverseRows)!
    near(reverse.discordanceP,six.discordanceP!,"paired label-swap invariance")
    near(reverse.efficiencyGain,-1,"total verified failure keeps negative efficiency")
    let equal = P(expectedIDs:["x"],rows:[R(id:"x",baselineSuccess:true,candidateSuccess:true,baselineTokens:1,candidateTokens:1)])!
    near(equal.discordanceP,1,"no discordances")
    check(equal.pareto == "unchanged","no fake improvement")
    check(GovernanceStatistics.pareto(tokenSavings:0.5,completionDelta:-0.1) == "tradeoff","cheaper but worse not improvement")
    check(GovernanceStatistics.pareto(tokenSavings:-0.5,completionDelta:0.1) == "tradeoff","better but expensive tradeoff")
    check(GovernanceStatistics.pareto(tokenSavings:-0.5,completionDelta:0) == "pareto_regression","equal quality more costly regression")
    check(GovernanceStatistics.pareto(tokenSavings:0,completionDelta:-0.1) == "pareto_regression","same cost lower quality regression")
    check(GovernanceStatistics.wilson(success:0,total:0) == nil,"no interval with zero denominator")
    check(GovernanceStatistics.wilson(success:2,total:1) == nil,"invalid count")
    let interval = GovernanceStatistics.wilson(success:5,total:10)!
    near(interval.lowerBound,0.236593090512564,"Wilson reference lower")
    near(interval.upperBound,0.7634069094874361,"Wilson reference upper")
    near(GovernanceStatistics.wilson(success:0,total:1)?.upperBound,0.7934506856227626,"small n not false certainty")
    near(GovernanceStatistics.wilson(success:1,total:1)?.lowerBound,0.20654931437723745,"all success interval not point 100%")
    print("Governance statistics: \(checks) checks PASS; arithmetic fixtures, not performance evidence")
}
