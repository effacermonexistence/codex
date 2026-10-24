#!/usr/bin/env python3
"""Current source call-site guards only; no provider, CLI run, RPC or HOME."""
from pathlib import Path
r=Path(__file__).resolve().parents[1]
s=(r/'Sources/OS1/main.swift').read_text()
a=s[s.index('private func rccNativeAdapter('):s.index('/// A route-all order',s.index('private func rccNativeAdapter('))]
assert a.count('RCCNativeDisplayStore.Publisher(ticket: t, nativeReceipt: receipt.path, workspace: workspace)')==1
assert a.index('let receipt = root.appendingPathComponent')<a.index('RCCNativeDisplayStore.Publisher')<a.index('RuntimeActivity.Observation.$sink.withValue')<a.index('try execute(ticket: signed')
assert 'onDispatch: { session in dispatched = true; display.session(session) }' in a
assert a.index('guard try Data(contentsOf: receipt) == data')<a.index('nativeDisplay?.finish(')
assert 'finalOutputSHA256: record.output.map { RCCRuntimeContract.digest(Data($0.utf8)) }' in a
assert 'record.observedConfig = nil' in a
activity=(r/'Sources/OS1Context/RuntimeActivity.swift').read_text()
emit=activity[activity.index('    public static func emit('):]
sink=emit[emit.index('Observation.sink?'):emit.index('guard let path')]
assert 'model: model' not in sink and 'effort: effort' not in sink and 'publicText: publicText' not in sink
loader=(r/'Sources/OS1Context/RCCNativeDisplayReceipts.swift').read_text()
assert 'RCCNativeDisplayStore.load(snapshot, homeDirectory: homeDirectory)' in loader
projection=(r/'Sources/OS1Context/RCCRuntimeProjection.swift').read_text()
for required in ['value.attemptID == attempt','value.requestSHA256 == core.requestSHA256','value.nodeID == child.id',
 'RCCRuntimeContract.digest(receipt) == receiptSHA','native.sessionID == value.sessionID','native.turnID == value.turnID',
 'model: display?.model, effort: display?.effort','nativeProgress: display?.progress']:
 assert required in projection,required
assert 'model: child.selectedConfig?.model' not in projection
gateway=(r/'Sources/OS1/RCCRuntimeGatewayClient.swift').read_text()
assert 'RCCRuntimeProjection.shouldRefreshDisplay(previousRevision: emittedRevision, previousAt: displayObservedAt,' in gateway
assert 'last = try observe(minimumRevision: current.revision)' in gateway
print('RCC_NATIVE_DISPLAY_SOURCE_WIRING_PASS: exact source guards; model/SDK/RPC/native CLI calls 0')
