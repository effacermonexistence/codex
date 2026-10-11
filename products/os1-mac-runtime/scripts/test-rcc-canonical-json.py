#!/usr/bin/env python3
"""Offline cross-language canonical wire regression. No native/model/network calls.

Compile only RCCCanonicalJSON.swift with a private fixture; ROOT app/CLI binaries
are not rebuilt. Optional --real-host checks a privately captured policy envelope
without printing or sending policy text. Unsafe native integers fail, never round.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SWIFT_FIXTURE = 'import Foundation\n@main struct Check {\n static func main() throws {\n  let values:[(String,Any)] = [\n   ("real_checked_at",NSNumber(value:1791655060.63789)),("bool_true",NSNumber(value:true)),("bool_false",NSNumber(value:false)),\n   ("integer_one",NSNumber(value:Int64(1))),("integer_zero",NSNumber(value:Int64(0))),("integer_safe_max",NSNumber(value:Int64(9007199254740991))),\n   ("double_whole",NSNumber(value:Double(2))),("double_negative_zero",NSNumber(value:-Double.zero)),\n   ("decimal_lower_edge",NSNumber(value:1e-6)),("exponent_below_edge",NSNumber(value:1e-7)),\n   ("decimal_upper_edge",NSNumber(value:1e20)),("exponent_upper_edge",NSNumber(value:1e21)),\n   ("least_subnormal",NSNumber(value:Double.leastNonzeroMagnitude)),("greatest_finite",NSNumber(value:Double.greatestFiniteMagnitude)),\n   ("negative_fraction",NSNumber(value:-0.002)),("shortest_roundtrip",NSNumber(value:333333333.33333329)),\n   ("unicode_values",["text":"é e\\u{301} 한글 💙 / \\n \\t \\u{2028}\\u{2029}\\u{0000} quote\\"slash\\\\"]),\n   ("utf16_key_order",["2":2,"10":10,"A":1,"a":2,"Ω":3,"\\u{10000}":4,"\\u{e000}":5]),\n   ("arrays_and_null",[NSNull(),NSNumber(value:true),NSNumber(value:Int64(1)),"a/b",["x":NSNull()]])]\n  var results:[[String:Any]]=[]\n  for (name,value) in values {\n   let data=try RCCCanonicalJSON.encode(value)\n   if let n=value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), String(cString:n.objCType)=="d", n.doubleValue != 0 {\n    guard let parsed=Double(String(decoding:data,as:UTF8.self)),parsed.bitPattern==n.doubleValue.bitPattern else {throw NSError(domain:"no-rounding",code:1)}\n   }\n   results.append(["name":name,"encoded":String(decoding:data,as:UTF8.self)])\n  }\n  var rng:UInt64=0x4c55415243433236\n  for i in 0..<1_000 {\n   rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17\n   let value=Double(bitPattern:rng)\n   if !value.isFinite {continue}\n   let data=try RCCCanonicalJSON.encode(NSNumber(value:value))\n   guard let restored=Double(String(decoding:data,as:UTF8.self)), value == 0 || restored.bitPattern==value.bitPattern else {throw NSError(domain:"random-no-rounding",code:1)}\n   results.append(["name":"finite_bits_\\(i)","encoded":String(decoding:data,as:UTF8.self)])\n  }\n  let rejected:[(String,Any)] = [("unsafe_positive_integer",NSNumber(value:Int64(9007199254740992))),\n   ("unsafe_negative_integer",NSNumber(value:Int64(-9007199254740992))),\n   ("unsafe_unsigned_integer",NSNumber(value:UInt64.max)),("nan",NSNumber(value:Double.nan)),\n   ("infinity",NSNumber(value:Double.infinity)),("unsupported_date",Date(timeIntervalSince1970:0))]\n  var failures:[String]=[]\n  for(name,value)in rejected {do{_ = try RCCCanonicalJSON.encode(value);throw NSError(domain:"expected-rejection",code:1)}catch let error as RCCCanonicalJSON.Failure{failures.append(name+":"+String(describing:error))}}\n  if CommandLine.arguments.count==2 {\n   let value=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1])))\n   results.append(["name":"real_host","encoded":String(decoding:try RCCCanonicalJSON.encode(value),as:UTF8.self)])\n  }\n  print(String(decoding:try JSONSerialization.data(withJSONObject:["cases":results,"rejected":failures],options:[.sortedKeys,.fragmentsAllowed]),as:UTF8.self))\n }\n}\n'
parser = argparse.ArgumentParser()
parser.add_argument("--real-host", type=Path)
args = parser.parse_args()
with tempfile.TemporaryDirectory(prefix="os1-rcc-canonical-") as temporary:
    directory = Path(temporary)
    source = directory / "main.swift"
    source.write_text(SWIFT_FIXTURE)
    binary = directory / "check"
    subprocess.run(["swiftc", "-parse-as-library", str(ROOT / "Sources/OS1Context/RCCCanonicalJSON.swift"),
                    str(source), "-o", str(binary)], check=True, capture_output=True)
    command = [str(binary)] + ([str(args.real_host.resolve())] if args.real_host else [])
    result = subprocess.run(command, check=True, capture_output=True)
    data = json.loads(result.stdout)
    pinned = Path.home() / ".local/share/node-v24.20.0/bin/node"
    node = os.environ.get("OS1_RCC_CANONICAL_NODE", str(pinned) if pinned.is_file() else "node")
    oracle = """
    import {pathToFileURL} from 'node:url';import{readFileSync}from'node:fs';
    const {canonicalHostContext}=await import(pathToFileURL(process.argv[1]).href);
    const values=JSON.parse(readFileSync(0,'utf8'));
    process.stdout.write(JSON.stringify(values.map(x=>({name:x.name,
      match:canonicalHostContext(JSON.parse(x.encoded))===x.encoded}))));
    """
    verified = subprocess.run([node, "--input-type=module", "-e", oracle,
                               str(ROOT / "Resources/openclaw-os1-bridge/rcc-runtime.mjs")],
                              input=json.dumps(data["cases"]).encode(), check=True, capture_output=True)
    cases = json.loads(verified.stdout)
    mismatches = [case["name"] for case in cases if not case["match"]]
    assert not mismatches, "Canonical ECMAScript mismatch: " + ", ".join(mismatches)
    assert len(data["rejected"]) == 6, "Unsafe value rejection coverage missing"
    if args.real_host:
        original = args.real_host.read_bytes()
        actual = next(case["encoded"].encode() for case in data["cases"] if case["name"] == "real_host")
        assert actual == original, "Real source-envelope canonical byte identity changed"
        print("REAL host canonical byte identity PASS; bytes", len(actual), "sha256", hashlib.sha256(actual).hexdigest())
    print(f"PASS: {len(cases)} Swift/JS canonical cases + 6 unsafe value rejections; no rounding; native/model/network calls 0")
