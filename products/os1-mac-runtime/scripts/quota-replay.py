#!/usr/bin/env python3
"""Offline quota replay (K16, ROUTING-ARCHITECTURE-V2 §4.2): M1-M4 kept apart.

  python3 -I scripts/quota-replay.py --m1 <route-replay usage report> --m1-sha256 <hex>
      [--price-card <path> --price-card-sha256 <hex>] [--cf-card <path> --cf-card-sha256 <hex>]
      [--quota-windows <path> --quota-windows-sha256 <hex>] [--out <new file>]
  python3 -I scripts/quota-replay.py --self-test

Reads only the files it is named, each pinned by its SHA-256, never writes
them, never calls a provider, a model or the network. Python 3.9 stdlib only.

- M1 (recorded): `route-replay.mjs usage` output, passed through per pool.
- M2 (estimate): a price proxy from a PRICE card, per pool, over the tasks M1
  marks complete in that pool. An incomplete task is excluded and counted,
  never filled. Delivery is not a filter: an undelivered task's tokens count.
- M3 (estimate_only): that price proxy against a modelled native
  counterfactual (CF card) for the same tasks. A zero denominator is FAIL
  with no ratio, never 0 or infinity.
- M4 (the only verdict): a same-batch quota-window observation (a D4
  artifact). Per pool, never summed across pools: PASS iff the
  quantization-conservative lower bound 1 - (dO + q) / (dR - q) >= 0.15.
  `m4_verdict` receives only the M4 object and M1's per-task pools, so no
  price or counterfactual can reach it. No artifact: NOT_RUN.

Exit codes (shared with route-replay.mjs): 0 PASS, 1 FAIL, 2 NOT_RUN,
64 usage or input error. Output: JSON with sorted keys on stdout, or into
--out, a new file (O_EXCL, 0600). Never accepted_B, quality parity or a cash
cost.
"""
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from decimal import Decimal
from fractions import Fraction

EXIT_PASS, EXIT_FAIL, EXIT_NOT_RUN, EXIT_USAGE = 0, 1, 2, 64
VERDICT_EXIT = {"PASS": EXIT_PASS, "FAIL": EXIT_FAIL, "NOT_RUN": EXIT_NOT_RUN}
THRESHOLD = Fraction(15, 100)
LOCAL_POOL = "none"
TUPLE_KEYS = ("uncached", "cache_read", "cache_write", "output")
MAX_INPUT_BYTES = 268435456
MAX_COUNT = 2 ** 53 - 1
HEX64 = re.compile(r"[0-9a-f]{64}")
VERDICT_BASIS = "M4_quota_window_observation_only"
ACCEPTED_B = "not_evaluated_by_quota_replay"
CLAIM = ("M1 recorded; M2 and M3 are labelled estimates that never reach the verdict; the verdict is M4 "
         "quota-window observation only, per pool; not accepted_B, quality parity or a cash cost")


class InputError(Exception):
    pass


# ---- Input custody: regular file, never a symlink, SHA-256 pinned, strict JSON. ----
def _no_duplicates(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise InputError("duplicate JSON key: " + key)
        out[key] = value
    return out


def _reject_constant(name):
    raise InputError("non-finite JSON number: " + name)


def parse_json_bytes(data, label):
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise InputError(label + ": not UTF-8")
    try:
        return json.loads(text, parse_float=Decimal, parse_constant=_reject_constant,
                          object_pairs_hook=_no_duplicates)
    except InputError:
        raise
    except ValueError as error:
        raise InputError(label + ": not JSON (" + str(error) + ")")


def read_pinned(path, expected, label):
    if not isinstance(path, str) or not path:
        raise InputError(label + ": a path is required")
    if not isinstance(expected, str) or not HEX64.fullmatch(expected):
        raise InputError(label + ": a " + label + "-sha256 pin (64 lowercase hex) is required")
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as error:
        raise InputError("cannot read %s: %s" % (path, error.strerror))
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            raise InputError("not a regular file: " + path)
        if before.st_size > MAX_INPUT_BYTES:
            raise InputError("input too large: " + path)
        chunks, remaining = [], before.st_size
        while remaining > 0:
            chunk = os.read(fd, min(remaining, 1 << 20))
            if not chunk:
                raise InputError("short read: " + path)
            chunks.append(chunk)
            remaining -= len(chunk)
        after = os.fstat(fd)
        if (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
            raise InputError("input changed while read: " + path)
    finally:
        os.close(fd)
    data = b"".join(chunks)
    digest = hashlib.sha256(data).hexdigest()
    if digest != expected:
        raise InputError("%s: sha256 mismatch (pinned %s, read %s)" % (label, expected, digest))
    return parse_json_bytes(data, label), digest


# ---- Shapes. Malformed input is an input error, never a verdict. ----
def _is_count(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_COUNT


def _is_number(value):
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    return isinstance(value, Decimal) and value.is_finite()


def _need(condition, message):
    if not condition:
        raise InputError(message)


def _text(value, limit=256):
    return isinstance(value, str) and 0 < len(value) <= limit and "\0" not in value


def _tuple(value, label):
    _need(isinstance(value, dict) and set(value) == set(TUPLE_KEYS) and all(_is_count(value[k]) for k in TUPLE_KEYS),
          label + ": not a token tuple {uncached, cache_read, cache_write, output}")
    return dict(value)


def load_m1(value):
    _need(isinstance(value, dict) and value.get("schema") == 1 and value.get("kind") == "os1_route_replay_usage" and
          value.get("metric") == "M1_observed_tokens", "--m1: not a route-replay usage report (schema 1)")
    tasks, pools = value.get("tasks"), value.get("pools")
    _need(isinstance(tasks, list) and isinstance(pools, dict), "--m1: tasks or pools missing")
    out = {}
    for task in tasks:
        _need(isinstance(task, dict) and _text(task.get("task_id")) and task["task_id"] not in out and
              isinstance(task.get("pools"), dict), "--m1: task row invalid")
        own = {}
        for pool, row in task["pools"].items():
            _need(_text(pool, 64) and isinstance(row, dict) and isinstance(row.get("complete"), bool) and
                  isinstance(row.get("by_model"), dict), "--m1: task pool row invalid")
            consumption = _tuple(row.get("consumption"), "--m1 consumption")
            by_model = {model: _tuple(v, "--m1 by_model") for model, v in row["by_model"].items()}
            for key in TUPLE_KEYS:
                _need(sum(v[key] for v in by_model.values()) == consumption[key], "--m1: by_model does not sum")
            own[pool] = {"complete": row["complete"], "consumption": consumption, "by_model": by_model}
        out[task["task_id"]] = {"pools": own, "delivery": task.get("delivery") if _text(task.get("delivery"), 64) else None}
    passthrough = {}
    for pool, row in pools.items():
        _need(_text(pool, 64) and isinstance(row, dict), "--m1: pool summary invalid")
        for key in ("tasks", "complete_tasks", "incomplete_tasks"):
            _need(_is_count(row.get(key)), "--m1: pool " + key + " invalid")
        reasons = row.get("incomplete_reasons")
        _need(isinstance(reasons, dict) and all(_text(k, 64) and _is_count(v) for k, v in reasons.items()),
              "--m1: incomplete_reasons invalid")
        passthrough[pool] = {"label": "recorded", "subscription": pool != LOCAL_POOL, "tasks": row["tasks"],
                             "complete_tasks": row["complete_tasks"], "incomplete_tasks": row["incomplete_tasks"],
                             "consumption_complete_tasks": _tuple(row.get("consumption_complete_tasks"), "--m1"),
                             "known_subtotal_incomplete_tasks": _tuple(row.get("known_subtotal_incomplete_tasks"), "--m1"),
                             "incomplete_reasons": dict(reasons)}
    return {"tasks": out, "pools": passthrough, "accounting_complete": value.get("accounting_complete") is True,
            "attempt_coverage": value.get("attempt_coverage") if _text(value.get("attempt_coverage"), 64) else None}


def load_price_card(value):
    _need(isinstance(value, dict) and value.get("schema") == 1 and value.get("kind") == "os1_price_card" and
          _text(value.get("card_id")) and _text(value.get("source"), 1024) and _text(value.get("unit"), 64) and
          isinstance(value.get("models"), dict), "--price-card: not an os1_price_card (schema 1)")
    for model, prices in value["models"].items():
        _need(_text(model, 128) and isinstance(prices, dict) and set(prices) == set(TUPLE_KEYS) and
              all(_is_number(prices[k]) and prices[k] >= 0 for k in TUPLE_KEYS),
              "--price-card: model prices invalid: " + str(model))
    return value


def load_cf_card(value):
    _need(isinstance(value, dict) and value.get("schema") == 1 and value.get("kind") == "os1_cf_card" and
          _text(value.get("card_id")) and _text(value.get("source"), 1024) and _text(value.get("method"), 1024) and
          isinstance(value.get("price_card_sha256"), str) and HEX64.fullmatch(value["price_card_sha256"]) and
          isinstance(value.get("pools"), dict), "--cf-card: not an os1_cf_card (schema 1)")
    for pool, row in value["pools"].items():
        _need(_text(pool, 64) and isinstance(row, dict) and isinstance(row.get("tasks"), dict) and
              all(_text(t) and _is_number(v) and v >= 0 for t, v in row["tasks"].items()),
              "--cf-card: pool invalid: " + str(pool))
    return value


def _observation(value):
    _need(isinstance(value, dict) and set(value) == {"used_percent", "observed_at_ms", "resets_at_ms"} and
          _is_number(value["used_percent"]) and _is_count(value["observed_at_ms"]) and _is_count(value["resets_at_ms"]),
          "--quota-windows: observation must be {used_percent, observed_at_ms, resets_at_ms}")


def load_m4(value):
    _need(isinstance(value, dict) and value.get("schema") == 1 and value.get("kind") == "os1_quota_window_observation" and
          _text(value.get("batch_id")) and isinstance(value.get("arms"), dict) and
          set(value["arms"]) == {"reference", "os1"}, "--quota-windows: not an os1_quota_window_observation (schema 1)")
    quantum = value.get("used_percent_quantum", 1)
    _need(_is_number(quantum) and quantum > 0, "--quota-windows: used_percent_quantum must be > 0")
    _need("concurrent_use_controlled" not in value or isinstance(value["concurrent_use_controlled"], bool),
          "--quota-windows: concurrent_use_controlled must be a boolean")
    for arm in value["arms"].values():
        _need(isinstance(arm, dict) and isinstance(arm.get("task_ids"), list) and isinstance(arm.get("windows"), list) and
              all(_text(t) for t in arm["task_ids"]) and len(set(arm["task_ids"])) == len(arm["task_ids"]),
              "--quota-windows: arm must be {task_ids (unique), windows}")
        for window in arm["windows"]:
            _need(isinstance(window, dict) and _text(window.get("pool"), 64) and _text(window.get("window_key"), 64) and
                  isinstance(window.get("judged"), bool), "--quota-windows: window must name pool, window_key, judged")
            _observation(window.get("before"))
            _observation(window.get("after"))
    return value


# ---- M2 / M3: labelled estimates. They never reach m4_verdict. ----
def _estimate(value, label, card, sha):
    return {"value": float(value), "label": label, "source": card["source"], "card_sha256": sha}


def _subscription_pools(m1):
    return sorted({pool for task in m1["tasks"].values() for pool in task["pools"]} - {LOCAL_POOL})


def _price_proxies(m1, card):
    """Exact price proxy per pool over the tasks complete in it."""
    out = {}
    for pool in _subscription_pools(m1):
        included = sorted(t for t, task in m1["tasks"].items() if pool in task["pools"] and task["pools"][pool]["complete"])
        excluded = sum(1 for task in m1["tasks"].values() if pool in task["pools"] and not task["pools"][pool]["complete"])
        missing = sorted({model for t in included for model, v in m1["tasks"][t]["pools"][pool]["by_model"].items()
                          if any(v[k] for k in TUPLE_KEYS) and model not in card["models"]})
        value = None
        if not missing:
            value = sum((Fraction(v[k]) * Fraction(card["models"][model][k])
                         for t in included for model, v in m1["tasks"][t]["pools"][pool]["by_model"].items()
                         if any(v[k2] for k2 in TUPLE_KEYS) for k in TUPLE_KEYS), Fraction(0))
        out[pool] = {"included": included, "excluded": excluded, "missing": missing, "value": value}
    return out


def m2_estimate(m1, card, sha):
    if card is None:
        return {"label": "estimate", "status": "not_computed", "reason": "no_price_card"}
    pools = {}
    for pool, row in _price_proxies(m1, card).items():
        base = {"tasks_included": len(row["included"]), "tasks_excluded_incomplete": row["excluded"]}
        if row["missing"]:
            pools[pool] = dict(base, status="not_computed", reason="model_price_missing", models=row["missing"])
        else:
            pools[pool] = dict(base, status="computed", price_proxy=_estimate(row["value"], "estimate", card, sha))
    return {"label": "estimate", "status": "computed", "card_id": card["card_id"], "unit": card["unit"],
            "card_sha256": sha, "pools": pools}


def m3_estimate(m1, price, price_sha, cf, cf_sha):
    if cf is None:
        return {"label": "estimate_only", "status": "not_computed", "reason": "no_cf_card"}
    if price is None:
        return {"label": "estimate_only", "status": "not_computed", "reason": "no_price_card"}
    if cf["price_card_sha256"] != price_sha:
        return {"label": "estimate_only", "status": "not_computed", "reason": "cf_price_card_mismatch"}
    pools = {}
    for pool, row in _price_proxies(m1, price).items():
        base = {"tasks_included": len(row["included"]), "tasks_excluded_incomplete": row["excluded"]}
        modelled = cf["pools"].get(pool, {"tasks": {}})["tasks"]
        missing = [t for t in row["included"] if t not in modelled]
        if row["missing"]:
            pools[pool] = dict(base, status="not_computed", reason="model_price_missing")
        elif missing:
            pools[pool] = dict(base, status="not_computed", reason="cf_task_missing", tasks_missing=len(missing))
        else:
            denominator = sum((Fraction(modelled[t]) for t in row["included"]), Fraction(0))
            if denominator == 0:
                pools[pool] = dict(base, status="FAIL", reason="zero_denominator", cost_ratio=None, saving_estimate=None)
            else:
                ratio = row["value"] / denominator
                pools[pool] = dict(base, status="computed",
                                   os1_price_proxy=_estimate(row["value"], "estimate_only", cf, cf_sha),
                                   cf_reference=_estimate(denominator, "estimate_only", cf, cf_sha),
                                   cost_ratio=_estimate(ratio, "estimate_only", cf, cf_sha),
                                   saving_estimate=_estimate(1 - ratio, "estimate_only", cf, cf_sha))
    return {"label": "estimate_only", "status": "computed", "card_id": cf["card_id"], "method": cf["method"],
            "card_sha256": cf_sha, "price_card_sha256": price_sha, "pools": pools}


# ---- M4: the only verdict. ----
def m1_task_pools(m1):
    """Per M1 task, the subscription pools it consumed in or may have (incomplete)."""
    return {t: frozenset(pool for pool, row in task["pools"].items() if pool != LOCAL_POOL and
                         (not row["complete"] or any(row["consumption"][k] for k in TUPLE_KEYS)))
            for t, task in m1["tasks"].items()}


def _window_problem(window):
    before, after = window["before"], window["after"]
    if before["resets_at_ms"] != after["resets_at_ms"]:
        return "resets_at_differs"
    if not before["observed_at_ms"] < after["observed_at_ms"] < after["resets_at_ms"]:
        return "timestamps_not_ordered"
    if not all(0 <= o["used_percent"] <= 100 for o in (before, after)):
        return "used_percent_out_of_range"
    if after["used_percent"] < before["used_percent"]:
        return "after_below_before"
    return None


def _judge_pool(pool, reference, os1, quantum, controlled, batch):
    def fail(reason, **extra):
        return dict({"verdict": "FAIL", "reason": reason}, **extra)
    ref = [w for w in reference["windows"] if w["pool"] == pool and w["judged"] is True]
    own = [w for w in os1["windows"] if w["pool"] == pool and w["judged"] is True]
    if not ref or not own:
        return fail("pool_unobserved")
    if len(ref) != 1 or len(own) != 1:
        return fail("window_invalid", detail="judged_window_not_unique")
    ref, own = ref[0], own[0]
    if ref["window_key"] != own["window_key"]:
        return fail("window_invalid", detail="window_key_differs")
    for window in (ref, own):
        problem = _window_problem(window)
        if problem:
            return fail("window_invalid", detail=problem)
    # One window observed by both arms at once mixes their use.
    if not (ref["after"]["observed_at_ms"] <= own["before"]["observed_at_ms"] or
            own["after"]["observed_at_ms"] <= ref["before"]["observed_at_ms"]):
        return fail("window_invalid", detail="arms_overlap")
    if not controlled:
        return fail("uncontrolled_concurrent_use")
    if batch:
        return fail(batch)
    d_ref = Fraction(ref["after"]["used_percent"]) - Fraction(ref["before"]["used_percent"])
    d_os1 = Fraction(own["after"]["used_percent"]) - Fraction(own["before"]["used_percent"])
    deltas = {"window_key": ref["window_key"], "delta_reference": float(d_ref), "delta_os1": float(d_os1)}
    if d_ref - quantum <= 0:
        return fail("zero_denominator", **deltas)
    lower = 1 - (d_os1 + quantum) / (d_ref - quantum)
    point = 1 - d_os1 / d_ref
    passed = lower >= THRESHOLD
    return dict(deltas, verdict="PASS" if passed else "FAIL",
                reason="lower_bound_at_or_above_threshold" if passed else "lower_bound_below_threshold",
                savings_lower_bound=float(lower), savings_point=float(point))


def m4_verdict(m4, task_pools):
    """The 15% verdict from an M4 quota-window observation alone. `task_pools`
    is M1's per-task subscription pools; no M2 or M3 figure is an argument."""
    base = {"basis": VERDICT_BASIS, "accepted_B": ACCEPTED_B, "threshold": float(THRESHOLD)}
    if m4 is None:
        return dict(base, verdict="NOT_RUN", reason="no_quota_window_observation", pools={})
    quantum = Fraction(m4.get("used_percent_quantum", 1))
    reference, os1 = m4["arms"]["reference"], m4["arms"]["os1"]
    ref_ids, os1_ids = set(reference["task_ids"]), set(os1["task_ids"])
    batch = "batch_empty" if not ref_ids or not os1_ids else \
        "batch_mismatch" if ref_ids != os1_ids or not os1_ids <= set(task_pools) else None
    consumed = set()
    for task in os1_ids:
        consumed |= task_pools.get(task, frozenset())
    named = {w["pool"] for arm in (reference, os1) for w in arm["windows"]}
    judged = sorted((consumed | named) - {LOCAL_POOL})
    pools = {pool: _judge_pool(pool, reference, os1, quantum, m4.get("concurrent_use_controlled") is True, batch)
             for pool in judged}
    if not pools:
        return dict(base, verdict="FAIL", reason=batch or "no_judged_pool", batch_id=m4["batch_id"],
                    quantum=float(quantum), pools={})
    passed = all(row["verdict"] == "PASS" for row in pools.values())
    return dict(base, verdict="PASS" if passed else "FAIL",
                reason="every_judged_pool_passed" if passed else "a_judged_pool_failed",
                batch_id=m4["batch_id"], quantum=float(quantum), pools=pools)


def build_report(m1, m1_sha, price=None, price_sha=None, cf=None, cf_sha=None, m4=None, m4_sha=None, paths=None):
    paths = paths or {}
    verdict = m4_verdict(m4, m1_task_pools(m1))

    def source(name, sha):
        return None if sha is None else {"path": paths.get(name), "sha256": sha}
    return {"schema": 1, "kind": "os1_quota_replay",
            "inputs": {"m1": source("m1", m1_sha), "price_card": source("price_card", price_sha),
                       "cf_card": source("cf_card", cf_sha), "quota_windows": source("quota_windows", m4_sha)},
            "m1": {"label": "recorded", "accounting_complete": m1["accounting_complete"],
                   "attempt_coverage": m1["attempt_coverage"], "pools": m1["pools"]},
            "m2": m2_estimate(m1, price, price_sha), "m3": m3_estimate(m1, price, price_sha, cf, cf_sha),
            "verdict": verdict, "exit_code": VERDICT_EXIT[verdict["verdict"]], "claim_boundary": CLAIM}


def canonical(value):
    return json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False) + "\n"


def emit(report, out):
    text = canonical(report)
    if out is None:
        sys.stdout.write(text)
        return
    try:
        fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except OSError as error:
        raise InputError("cannot create --out %s: %s" % (out, error.strerror))
    try:
        os.write(fd, text.encode("utf-8"))
    finally:
        os.close(fd)


PAIRS = (("--m1", "m1"), ("--price-card", "price_card"), ("--cf-card", "cf_card"), ("--quota-windows", "quota_windows"))


def parse_args(argv):
    names = {flag for flag, _ in PAIRS} | {flag + "-sha256" for flag, _ in PAIRS} | {"--out"}
    options, index = {}, 0
    while index < len(argv):
        name = argv[index]
        if name not in names:
            raise InputError("unknown argument: " + name)
        if index + 1 >= len(argv) or argv[index + 1].startswith("--"):
            raise InputError(name + " needs a value")
        if name in options:
            raise InputError(name + " given twice")
        options[name] = argv[index + 1]
        index += 2
    if "--m1" not in options:
        raise InputError("usage: quota-replay.py --m1 <path> --m1-sha256 <hex> [--price-card ... --cf-card ... "
                         "--quota-windows ... (each with its -sha256)] [--out <new file>] | --self-test")
    for flag, _ in PAIRS:
        if (flag in options) != (flag + "-sha256" in options):
            raise InputError(flag + " and " + flag + "-sha256 go together")
    return options


LOADERS = {"m1": load_m1, "price_card": load_price_card, "cf_card": load_cf_card, "quota_windows": load_m4}


def main(argv):
    if argv == ["--self-test"]:
        try:
            return self_test()
        except Exception as error:  # an assertion or a crash: never a PASS
            sys.stderr.write("quota-replay self-test FAILED: %s: %s\n" % (type(error).__name__, error))
            return EXIT_FAIL
    try:
        options = parse_args(argv)
        values, shas, paths = {}, {}, {}
        for flag, name in PAIRS:
            if flag in options:
                raw, shas[name] = read_pinned(options[flag], options[flag + "-sha256"], flag)
                values[name], paths[name] = LOADERS[name](raw), options[flag]
        report = build_report(values["m1"], shas["m1"], values.get("price_card"), shas.get("price_card"),
                              values.get("cf_card"), shas.get("cf_card"), values.get("quota_windows"),
                              shas.get("quota_windows"), paths)
        emit(report, options.get("--out"))
        sys.stderr.write("quota-replay: %s (%s)\n" % (report["verdict"]["verdict"], report["verdict"]["reason"]))
        return report["exit_code"]
    except InputError as error:
        sys.stderr.write("quota-replay: " + str(error) + "\n")
        return EXIT_USAGE
    except Exception as error:  # an internal error is never read as a verdict
        sys.stderr.write("quota-replay: internal error: %s: %s\n" % (type(error).__name__, error))
        return EXIT_USAGE


# ---- --self-test: synthetic M1, cards and windows only. ----
def _m1(tasks, delivery=None):
    """A route-replay usage report: {task_id: {pool: (complete, {model: (uncached, read, write, output)})}}."""
    rows, pools = [], {}
    for task_id in sorted(tasks):
        own = {}
        for pool, (complete, models) in tasks[task_id].items():
            by_model = {m: dict(zip(TUPLE_KEYS, v)) for m, v in models.items()}
            consumption = {k: sum(v[k] for v in by_model.values()) for k in TUPLE_KEYS}
            own[pool] = {"complete": complete, "attempts": {"observed": len(models), "verified_zero": 0,
                                                            "unknown": 0 if complete else 1},
                         "consumption": consumption, "by_model": by_model,
                         "incomplete_reasons": [] if complete else ["usage_null"]}
            summary = pools.setdefault(pool, {"tasks": 0, "complete_tasks": 0, "incomplete_tasks": 0,
                                              "consumption_complete_tasks": dict.fromkeys(TUPLE_KEYS, 0),
                                              "known_subtotal_incomplete_tasks": dict.fromkeys(TUPLE_KEYS, 0),
                                              "incomplete_reasons": {}})
            summary["tasks"] += 1
            summary["complete_tasks" if complete else "incomplete_tasks"] += 1
            target = summary["consumption_complete_tasks" if complete else "known_subtotal_incomplete_tasks"]
            for key in TUPLE_KEYS:
                target[key] += consumption[key]
            if not complete:
                summary["incomplete_reasons"]["usage_null"] = summary["incomplete_reasons"].get("usage_null", 0) + 1
        rows.append({"task_id": task_id, "pools": own, "delivery": (delivery or {}).get(task_id, "delivered")})
    complete = all(row["complete"] for task in rows for pool, row in task["pools"].items() if pool != LOCAL_POOL)
    return {"schema": 1, "kind": "os1_route_replay_usage", "metric": "M1_observed_tokens", "label": "recorded",
            "accounting_complete": complete, "attempt_coverage": "snapshot_attempt_history", "tasks": rows,
            "pools": pools}


def _window(pool, before, after, start=1000, key="weekly_all", judged=True, resets=10 ** 9):
    return {"pool": pool, "window_key": key, "judged": judged,
            "before": {"used_percent": before, "observed_at_ms": start, "resets_at_ms": resets},
            "after": {"used_percent": after, "observed_at_ms": start + 100, "resets_at_ms": resets}}


def _m4(reference_windows, os1_windows, task_ids=("t1",), quantum=1, controlled=True, os1_ids=None):
    return {"schema": 1, "kind": "os1_quota_window_observation", "batch_id": "batch-1",
            "used_percent_quantum": quantum, "concurrent_use_controlled": controlled,
            "arms": {"reference": {"task_ids": list(task_ids), "windows": reference_windows},
                     "os1": {"task_ids": list(task_ids if os1_ids is None else os1_ids), "windows": os1_windows}}}


def _pool_m4(pool, d_ref, d_os1, **extra):
    return _m4([_window(pool, 10, 10 + d_ref, start=1000)], [_window(pool, 50, 50 + d_os1, start=5000)], **extra)


PRICE = {"schema": 1, "kind": "os1_price_card", "card_id": "fixture-prices", "source": "synthetic fixture",
         "unit": "fixture_units_per_token",
         "models": {"m-ref": {"uncached": 2, "cache_read": Decimal("0.5"), "cache_write": 1, "output": 4},
                    "m-low": {"uncached": 1, "cache_read": Decimal("0.25"), "cache_write": 1, "output": 2}}}


def _cf(price_sha, tasks):
    return {"schema": 1, "kind": "os1_cf_card", "card_id": "fixture-cf", "source": "synthetic fixture",
            "method": "fixture", "price_card_sha256": price_sha, "pools": {"openai_codex": {"tasks": tasks}}}


def self_test():
    checks = [0]

    def check(condition, message):
        if not condition:
            raise AssertionError(message)
        checks[0] += 1

    def walk(value):
        if isinstance(value, dict):
            yield value
            for item in value.values():
                for found in walk(item):
                    yield found
        elif isinstance(value, list):
            for item in value:
                for found in walk(item):
                    yield found

    def keys(value):
        return {k for item in walk(value) for k in item}

    price_sha = "a" * 64
    m1 = load_m1(_m1({
        "t1": {"openai_codex": (True, {"m-low": (600, 400, 0, 50)})},
        "t2": {"openai_codex": (True, {"m-ref": (100, 0, 0, 10)})},
        "t3": {"openai_codex": (False, {"m-ref": (999, 0, 0, 999)})},
        "t4": {"none": (True, {"local": (5, 0, 0, 1)})},
    }, delivery={"t2": "undelivered"}))
    # M2: complete tasks only; the incomplete task is counted, never filled.
    m2 = m2_estimate(m1, PRICE, price_sha)
    row = m2["pools"]["openai_codex"]
    check(row["status"] == "computed" and row["tasks_included"] == 2 and row["tasks_excluded_incomplete"] == 1,
          "M2 excludes and counts the incomplete task")
    expected = 600 * 1 + 100 + 50 * 2 + 100 * 2 + 10 * 4  # t1 (400 cache-read tokens at 0.25) + t2
    check(row["price_proxy"]["value"] == expected, "M2 sums complete tasks exactly: %r" % row["price_proxy"])
    check("none" not in m2["pools"], "the local pool is never priced as a subscription")
    # The undelivered task (t2) stays in the numerator: delivery is no filter.
    without = load_m1(_m1({"t1": {"openai_codex": (True, {"m-low": (600, 400, 0, 50)})}}))
    check(m2_estimate(without, PRICE, price_sha)["pools"]["openai_codex"]["price_proxy"]["value"] != expected,
          "removing the undelivered task changes M2")
    check(m2_estimate(m1, None, None) == {"label": "estimate", "status": "not_computed", "reason": "no_price_card"},
          "no price card: M2 not_computed")
    check(m2_estimate(load_m1(_m1({"t9": {"openai_codex": (True, {"m-new": (1, 0, 0, 1)})}})), PRICE, price_sha)
          ["pools"]["openai_codex"]["reason"] == "model_price_missing", "an unpriced model is not computed")
    # M3: the same tasks against the counterfactual; zero denominator FAIL.
    m3 = m3_estimate(m1, PRICE, price_sha, _cf(price_sha, {"t1": 9000, "t2": 1000}), "b" * 64)
    row = m3["pools"]["openai_codex"]
    check(row["status"] == "computed" and row["cost_ratio"]["value"] == float(Fraction(expected, 10000)) and
          row["saving_estimate"]["value"] == float(1 - Fraction(expected, 10000)) and row["tasks_excluded_incomplete"] == 1,
          "M3 ratio over the same complete tasks")
    zero = m3_estimate(m1, PRICE, price_sha, _cf(price_sha, {"t1": 0, "t2": 0}), "b" * 64)["pools"]["openai_codex"]
    check(zero["status"] == "FAIL" and zero["reason"] == "zero_denominator" and zero["cost_ratio"] is None and
          zero["saving_estimate"] is None, "M3 zero denominator: FAIL, never 0.0 or inf")
    check(m3_estimate(m1, PRICE, price_sha, _cf(price_sha, {"t1": 1}), "b" * 64)["pools"]["openai_codex"]["reason"] ==
          "cf_task_missing", "a complete task the CF card does not model: not computed")
    check(m3_estimate(m1, PRICE, price_sha, _cf("c" * 64, {"t1": 1, "t2": 1}), "b" * 64)["reason"] ==
          "cf_price_card_mismatch", "a CF card bound to another price card: not computed")
    check(m3_estimate(m1, None, None, None, None)["reason"] == "no_cf_card" and
          m3_estimate(m1, None, None, _cf(price_sha, {}), "b" * 64)["reason"] == "no_price_card",
          "no card: M3 not_computed")
    # Labels: every M2 figure is an estimate, every M3 figure estimate_only.
    for item in walk(m2):
        if "value" in item:
            check(item["label"] == "estimate" and item["card_sha256"] == price_sha, "M2 label")
    for item in walk(m3):
        if "value" in item:
            check(item["label"] == "estimate_only" and item["card_sha256"] == "b" * 64, "M3 label")

    # M4: no artifact is NOT_RUN, even when M3 implies a 90% saving.
    cheap_cf = _cf(price_sha, {"t1": expected * 5, "t2": expected * 5})
    report = build_report(m1, "d" * 64, PRICE, price_sha, cheap_cf, "b" * 64)
    check(report["m3"]["pools"]["openai_codex"]["saving_estimate"]["value"] == 0.9, "fixture M3 says 90%")
    check(report["verdict"]["verdict"] == "NOT_RUN" and report["exit_code"] == EXIT_NOT_RUN, "no M4: NOT_RUN")
    check(report["verdict"]["basis"] == VERDICT_BASIS and report["verdict"]["accepted_B"] == ACCEPTED_B,
          "verdict basis and accepted_B boundary")
    check(not any(k.startswith(("m2", "m3", "price", "cf", "cost", "saving_estimate")) for k in keys(report["verdict"])),
          "the verdict carries no M2/M3 key")
    # M3 90% but M4 shows 5%: FAIL. M3 0% but M4 shows 25% (bound 0.205): PASS.
    fail = build_report(m1, "d" * 64, PRICE, price_sha, cheap_cf, "b" * 64, _pool_m4("openai_codex", 40, 38))
    check(fail["verdict"]["verdict"] == "FAIL" and fail["exit_code"] == EXIT_FAIL, "M4 decides against M3")
    even_cf = _cf(price_sha, {"t1": 800, "t2": 240})
    zero_saving = build_report(m1, "d" * 64, PRICE, price_sha, even_cf, "b" * 64, _pool_m4("openai_codex", 40, 30))
    check(zero_saving["m3"]["pools"]["openai_codex"]["saving_estimate"]["value"] == 0, "fixture M3 says 0%")
    pool = zero_saving["verdict"]["pools"]["openai_codex"]
    check(zero_saving["verdict"]["verdict"] == "PASS" and zero_saving["exit_code"] == EXIT_PASS and
          abs(pool["savings_lower_bound"] - (1 - 31 / 39)) < 1e-12 and pool["savings_point"] == 0.25,
          "M4 decides for M3: bound 1-31/39")
    with_cards = canonical(zero_saving["verdict"])
    without_cards = canonical(build_report(m1, "d" * 64, m4=_pool_m4("openai_codex", 40, 30))["verdict"])
    check(with_cards == without_cards, "the verdict is byte-identical with and without the price and CF cards")
    # Quantization: a 20% point estimate with q=1 is a 0.105 bound: FAIL;
    # a bound of exactly 0.15 passes (>=).
    quantized = m4_verdict(_pool_m4("openai_codex", 20, 16), m1_task_pools(m1))["pools"]["openai_codex"]
    check(quantized["verdict"] == "FAIL" and quantized["savings_point"] == 0.2 and
          abs(quantized["savings_lower_bound"] - (1 - 17 / 19)) < 1e-12, "the quantization-conservative bound decides")
    boundary = m4_verdict(_pool_m4("openai_codex", 21, 16), m1_task_pools(m1))["pools"]["openai_codex"]
    check(boundary["verdict"] == "PASS" and boundary["savings_lower_bound"] == 0.15, "a bound of exactly 0.15 passes")
    fractional = _pool_m4("openai_codex", Decimal("2.1"), Decimal("1.6"), quantum=Decimal("0.1"))
    check(m4_verdict(fractional, m1_task_pools(m1))["pools"]["openai_codex"]["verdict"] == "PASS",
          "decimal percents compare exactly (bound 0.15)")
    # Zero denominators and an empty batch: FAIL, never a ratio.
    for d_ref, quantum in ((0, 1), (1, 1), (Decimal("0.5"), 1)):
        row = m4_verdict(_pool_m4("openai_codex", d_ref, 0, quantum=quantum), m1_task_pools(m1))["pools"]["openai_codex"]
        check(row["verdict"] == "FAIL" and row["reason"] == "zero_denominator" and "savings_lower_bound" not in row,
              "zero denominator at dR=%s q=%s" % (d_ref, quantum))
    empty = m4_verdict(_pool_m4("openai_codex", 40, 10, task_ids=()), m1_task_pools(m1))
    check(empty["verdict"] == "FAIL" and empty["pools"]["openai_codex"]["reason"] == "batch_empty", "empty batch FAIL")
    check(m4_verdict(_m4([], [], task_ids=()), m1_task_pools(m1))["reason"] == "batch_empty", "nothing judged: FAIL")
    # Invalid windows, uncontrolled use, a mismatched batch.
    resets = _pool_m4("openai_codex", 40, 10)
    resets["arms"]["os1"]["windows"][0]["after"]["resets_at_ms"] += 1
    unordered = _pool_m4("openai_codex", 40, 10)
    unordered["arms"]["reference"]["windows"][0]["after"]["observed_at_ms"] = 1000
    shrinking = _m4([_window("openai_codex", 30, 20)], [_window("openai_codex", 50, 60, start=5000)])
    overlap = _m4([_window("openai_codex", 10, 50, start=1000)], [_window("openai_codex", 50, 60, start=1050)])
    keyed = _m4([_window("openai_codex", 10, 50)], [_window("openai_codex", 50, 60, start=5000, key="session")])
    twice = _m4([_window("openai_codex", 10, 50), _window("openai_codex", 60, 70, start=2000)],
                [_window("openai_codex", 50, 60, start=5000)])
    for value, detail in ((resets, "resets_at_differs"), (unordered, "timestamps_not_ordered"),
                          (shrinking, "after_below_before"), (overlap, "arms_overlap"), (keyed, "window_key_differs"),
                          (twice, "judged_window_not_unique")):
        row = m4_verdict(value, m1_task_pools(m1))["pools"]["openai_codex"]
        check(row["verdict"] == "FAIL" and row["reason"] == "window_invalid" and row["detail"] == detail, detail)
    for value, reason in ((_pool_m4("openai_codex", 40, 10, controlled=False), "uncontrolled_concurrent_use"),
                          (_pool_m4("openai_codex", 40, 10, os1_ids=("t1", "t2")), "batch_mismatch"),
                          (_pool_m4("openai_codex", 40, 10, task_ids=("t1", "not-in-m1")), "batch_mismatch")):
        row = m4_verdict(value, m1_task_pools(m1))["pools"]["openai_codex"]
        check(row["verdict"] == "FAIL" and row["reason"] == reason, reason)
    uncontrolled = _pool_m4("openai_codex", 40, 10)
    del uncontrolled["concurrent_use_controlled"]
    check(m4_verdict(uncontrolled, m1_task_pools(m1))["verdict"] == "FAIL", "unstated concurrent control: FAIL")
    # Per pool: one pool's FAIL fails the batch; no all-pools figure exists.
    two = load_m1(_m1({"t1": {"openai_codex": (True, {"m-low": (10, 0, 0, 1)})},
                       "t2": {"anthropic_shared": (True, {"m-ref": (10, 0, 0, 1)})}}))
    windows = _m4([_window("openai_codex", 0, 40), _window("anthropic_shared", 0, 40, start=1000)],
                  [_window("openai_codex", 50, 60, start=5000), _window("anthropic_shared", 50, 89, start=5000)],
                  task_ids=("t1", "t2"))
    split = m4_verdict(windows, m1_task_pools(two))
    check(split["verdict"] == "FAIL" and split["pools"]["openai_codex"]["verdict"] == "PASS" and
          split["pools"]["anthropic_shared"]["verdict"] == "FAIL", "one pool PASS, one FAIL: overall FAIL")
    check(not any(("all" in k and "pool" in k) or "combined" in k or "total" in k for k in keys(split)),
          "no cross-pool figure")
    unobserved = _m4([_window("openai_codex", 0, 40)], [_window("openai_codex", 50, 60, start=5000)], task_ids=("t1", "t2"))
    row = m4_verdict(unobserved, m1_task_pools(two))
    check(row["verdict"] == "FAIL" and row["pools"]["anthropic_shared"]["reason"] == "pool_unobserved",
          "a pool OS-1 consumed in without a judged window: FAIL pool_unobserved")
    side = _m4([_window("openai_codex", 0, 40), _window("anthropic_shared", 0, 1, judged=False)],
               [_window("openai_codex", 50, 60, start=5000)])
    check(m4_verdict(side, m1_task_pools(m1))["pools"]["anthropic_shared"]["reason"] == "pool_unobserved",
          "a pool in the file without a judged window: FAIL")
    # An incomplete M1 task's pool is judged too (it may have consumed).
    incomplete = load_m1(_m1({"t1": {"openai_codex": (True, {"m-low": (1, 0, 0, 1)}),
                                     "anthropic_shared": (False, {})}}))
    check(m4_verdict(_pool_m4("openai_codex", 40, 10), m1_task_pools(incomplete))["pools"]["anthropic_shared"]["reason"] ==
          "pool_unobserved", "an incomplete pool still needs its window")
    check(m4_verdict(None, m1_task_pools(m1))["verdict"] == "NOT_RUN", "no file: NOT_RUN")

    # Shapes: malformed input is an input error.
    for bad in ({"schema": 2}, dict(_m1({}), kind="os1_route_replay_delivery")):
        try:
            load_m1(bad)
            check(False, "malformed M1 accepted")
        except InputError:
            check(True, "malformed M1 refused")
    broken = _m1({"t1": {"openai_codex": (True, {"m": (1, 0, 0, 1)})}})
    broken["tasks"][0]["pools"]["openai_codex"]["consumption"]["output"] = 5
    try:
        load_m1(broken)
        check(False, "by_model mismatch accepted")
    except InputError:
        check(True, "by_model must sum to the pool consumption")
    for bad in (dict(_pool_m4("p", 1, 1), used_percent_quantum=0), dict(_pool_m4("p", 1, 1), arms={"os1": {}}),
                dict(_pool_m4("p", 1, 1), concurrent_use_controlled="yes")):
        try:
            load_m4(bad)
            check(False, "malformed M4 accepted")
        except InputError:
            check(True, "malformed M4 refused")
    try:
        parse_json_bytes(b'{"a": 1, "a": 2}', "x")
        check(False, "duplicate key accepted")
    except InputError:
        check(True, "duplicate JSON keys refused")
    try:
        parse_json_bytes(b'{"a": NaN}', "x")
        check(False, "NaN accepted")
    except InputError:
        check(True, "non-finite numbers refused")

    # CLI under python3 -I: pins, custody, exclusive --out, exit codes.
    script = os.path.abspath(__file__)
    with tempfile.TemporaryDirectory(prefix="os1-quota-replay-") as directory:
        os.chmod(directory, 0o700)

        def put(name, value):
            path = os.path.join(directory, name)
            data = canonical(value).encode("utf-8")
            with open(path, "xb") as handle:
                handle.write(data)
            return path, hashlib.sha256(data).hexdigest()

        def run(*args):
            done = subprocess.run([sys.executable, "-I", script] + list(args), stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, universal_newlines=True, timeout=120)
            return done.returncode, done.stdout

        m1_path, m1_sha = put("m1.json", _m1({"t1": {"openai_codex": (True, {"m-low": (600, 400, 0, 50)})}}))
        status, out = run("--m1", m1_path, "--m1-sha256", m1_sha)
        check(status == EXIT_NOT_RUN and json.loads(out)["verdict"]["verdict"] == "NOT_RUN", "CLI without M4: exit 2")
        windows_path, windows_sha = put("m4.json", _pool_m4("openai_codex", 40, 30))
        status, out = run("--m1", m1_path, "--m1-sha256", m1_sha, "--quota-windows", windows_path,
                          "--quota-windows-sha256", windows_sha)
        check(status == EXIT_PASS and json.loads(out)["verdict"]["verdict"] == "PASS", "CLI PASS: exit 0")
        failing_path, failing_sha = put("m4-fail.json", _pool_m4("openai_codex", 40, 38))
        check(run("--m1", m1_path, "--m1-sha256", m1_sha, "--quota-windows", failing_path,
                  "--quota-windows-sha256", failing_sha)[0] == EXIT_FAIL, "CLI FAIL: exit 1")
        link = os.path.join(directory, "link.json")
        os.symlink(m1_path, link)
        out_path = os.path.join(directory, "report.json")
        status, out = run("--m1", m1_path, "--m1-sha256", m1_sha, "--out", out_path)
        check(status == EXIT_NOT_RUN and out == "" and stat.S_IMODE(os.stat(out_path).st_mode) == 0o600,
              "--out writes a new 0600 file")
        for args in (("--m1", m1_path, "--m1-sha256", "0" * 64), ("--m1", m1_path), ("--m1", link, "--m1-sha256", m1_sha),
                     ("--m1", directory, "--m1-sha256", m1_sha), ("--m1", m1_path, "--m1-sha256", m1_sha, "--bogus", "x"),
                     ("--m1", m1_path, "--m1-sha256", m1_sha, "--out", out_path),
                     ("--m1", m1_path, "--m1-sha256", m1_sha, "--quota-windows", windows_path), (),
                     ("--m1", windows_path, "--m1-sha256", windows_sha)):
            check(run(*args)[0] == EXIT_USAGE, "input error exit 64: " + " ".join(a.replace(directory, "<dir>") for a in args))
    sys.stdout.write("PASS: %d quota-replay self-test checks; model calls 0; network calls 0\n" % checks[0])
    return EXIT_PASS


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
