"""Import graph and contract violations for one unit, through grimp and import-linter.

Run with the interpreter that holds import-linter (see src/measure/d3/py/interpreter.ts), in isolated mode:
    python -I graph_helper.py --in in.json --out out.json

Input:  {"workDir", "roots": [{"dir", "name"}], "declared": "<abs path>" | null, "contracts": [options]}
Output: {"versions", "emptied", "edges", "violations", "skipped"} or {"error": "<message>"}

Repository code is never executed: grimp and import-linter read source files, and each root package is
looked up with importlib.util.find_spec (top-level names only, no package __init__ runs).
"""
import argparse
import ast
import copy
import importlib.metadata
import importlib.util
import json
import os
import sys

DIRECTION_TYPES = ("layers", "forbidden", "independence")


def fail(message):
    return {"error": message}


def load_import_linter():
    try:
        import grimp
        from importlinter import configuration
        from importlinter.application import use_cases
    except ImportError as exc:
        return None, fail("import-linter cannot be imported: %s" % exc)
    version = importlib.metadata.version("import-linter")
    for name in ("read_user_options", "create_report", "_register_contract_types"):
        if not hasattr(use_cases, name):
            return None, fail("unsupported import-linter %s: missing %s" % (version, name))
    for name in ("build_graph",):
        if not hasattr(grimp, name):
            return None, fail("unsupported grimp: missing %s" % name)
    configuration.configure()
    return (grimp, use_cases, configuration, version), None


def empty_unparseable(work_dir, roots):
    emptied = []
    for root in roots:
        base = os.path.join(work_dir, root["dir"], root["name"])
        for current, _dirs, files in os.walk(base):
            for name in files:
                if not name.endswith(".py"):
                    continue
                path = os.path.join(current, name)
                try:
                    with open(path, "rb") as handle:
                        ast.parse(handle.read())
                except (SyntaxError, ValueError, RecursionError, MemoryError):
                    with open(path, "wb"):
                        pass
                    emptied.append(os.path.relpath(path, work_dir).replace(os.sep, "/"))
    return sorted(emptied)


class FileMap:
    """Module name to repository-relative file, for the modules that have one."""

    def __init__(self, work_dir, roots):
        self.work_dir = work_dir
        self.roots = roots
        self.cache = {}

    def file_of(self, module):
        if module in self.cache:
            return self.cache[module]
        found = None
        top = module.split(".")[0]
        parts = module.split(".")
        for root in self.roots:
            if root["name"] != top:
                continue
            base = os.path.join(self.work_dir, root["dir"], *parts)
            for candidate in (base + ".py", os.path.join(base, "__init__.py")):
                if os.path.isfile(candidate):
                    found = os.path.relpath(candidate, self.work_dir).replace(os.sep, "/")
                    break
            if found:
                break
        self.cache[module] = found
        return found


def emit_edges(graph, files):
    edges = []
    for module in sorted(graph.modules):
        source = files.file_of(module)
        if source is None:
            continue
        for imported in sorted(graph.find_modules_directly_imported_by(module)):
            target = files.file_of(imported)
            if target is None or target == source:
                continue
            lines = sorted(
                {d["line_number"] for d in graph.get_import_details(importer=module, imported=imported)}
            )
            edges.append({"from": source, "to": target, "lines": lines})
    return edges


def one_step_chains(raw_chains):
    for item in raw_chains:
        chain = item["chain"] if isinstance(item, dict) else item
        if len(chain) == 1:
            yield chain[0]


def violations_of(contract_type, metadata):
    if contract_type == "layers":
        for dependency in metadata.get("invalid_dependencies", []):
            for step in one_step_chains(dependency["routes"]):
                yield step
    elif contract_type == "independence":
        for entry in metadata.get("invalid_chains", []):
            for step in one_step_chains(entry["chains"]):
                yield step
    else:
        for entry in metadata.get("invalid_chains", []):
            for step in one_step_chains(entry["chains"]):
                yield step


def contract_type_of(contract):
    name = type(contract).__name__.lower()
    if "layer" in name:
        return "layers"
    if "independ" in name:
        return "independence"
    return "forbidden"


def run_report(use_cases, session, contracts):
    from importlinter.application.user_options import UserOptions

    options = UserOptions(session_options=session, contracts_options=contracts)
    use_cases._register_contract_types(options)
    report = use_cases.create_report(options, cache_dir=None)
    if report.could_not_run:
        reasons = "; ".join(
            "%s: %s" % (name, exc) for name, exc in report.invalid_contract_options.items()
        )
        raise ValueError(reasons)
    return report


def collect(report, files, out):
    for contract, check in report.get_contracts_and_checks():
        for step in violations_of(contract_type_of(contract), check.metadata):
            imported_file = files.file_of(step["imported"])
            importer_file = files.file_of(step["importer"])
            if importer_file is None:
                continue
            out.append(
                {
                    "contract": contract.name,
                    "importer": importer_file,
                    "imported": imported_file or step["imported"],
                    "external": imported_file is None,
                }
            )


def run_contracts(use_cases, session, contracts, files, violations, skipped):
    if not contracts:
        return
    try:
        collect(run_report(use_cases, session, contracts), files, violations)
        return
    except Exception:  # noqa: BLE001 - one bad contract aborts the whole report; retry one by one
        pass
    for options in contracts:
        try:
            collect(run_report(use_cases, copy.deepcopy(session), [options]), files, violations)
        except Exception as exc:  # noqa: BLE001
            skipped.append({"contract": options.get("name", "*"), "reason": "%s: %s" % (type(exc).__name__, exc)})


def declared_contracts(use_cases, declared, root_names, skipped):
    try:
        options = use_cases.read_user_options(declared)
    except Exception as exc:  # noqa: BLE001
        skipped.append({"contract": "*", "reason": "%s: %s" % (type(exc).__name__, exc)})
        return None, []
    session = dict(options.session_options)
    session.pop("contract_types", None)
    names = [name for name in session.get("root_packages", []) if name in root_names]
    if not names:
        skipped.append({"contract": "*", "reason": "the declared rules name no first-party package of this unit"})
        return None, []
    session["root_packages"] = names
    # import-linter reads boolean session options as strings
    session["include_external_packages"] = "true"
    session["exclude_type_checking_imports"] = "false"
    contracts = [c for c in options.contracts_options if c.get("type") in DIRECTION_TYPES]
    return session, contracts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="infile", required=True)
    parser.add_argument("--out", dest="outfile", required=True)
    args = parser.parse_args()
    with open(args.infile, encoding="utf8") as handle:
        request = json.load(handle)

    def write(result):
        with open(args.outfile, "w", encoding="utf8") as handle:
            json.dump(result, handle)

    loaded, error = load_import_linter()
    if error:
        write(error)
        return
    grimp, use_cases, _configuration, il_version = loaded

    work_dir = os.path.abspath(request["workDir"])
    roots = request["roots"]
    for root in reversed(roots):
        sys.path.insert(0, os.path.join(work_dir, root["dir"]))
    skipped = []
    emptied = empty_unparseable(work_dir, roots)

    # A root whose spec is not inside the work copy is a first-party package named like an imported module.
    usable = []
    for root in roots:
        spec = importlib.util.find_spec(root["name"])
        location = spec.origin if spec and spec.origin else None
        locations = list(spec.submodule_search_locations or []) if spec else []
        inside = [p for p in ([location] if location else []) + locations if os.path.abspath(p).startswith(work_dir + os.sep)]
        if spec is None or not inside:
            skipped.append({"contract": "*", "reason": "root package %s is shadowed outside the work copy" % root["name"]})
            continue
        usable.append(root)
    names = [root["name"] for root in usable]
    result = {
        "versions": {"grimp": importlib.metadata.version("grimp"), "import-linter": il_version},
        "emptied": emptied,
        "edges": [],
        "violations": [],
        "skipped": skipped,
    }
    if not usable:
        write(result)
        return

    files = FileMap(work_dir, usable)
    graph = grimp.build_graph(*names, include_external_packages=True, cache_dir=None)
    result["edges"] = emit_edges(graph, files)

    session = {"root_packages": names, "include_external_packages": "true", "exclude_type_checking_imports": "false"}
    run_contracts(use_cases, session, request.get("contracts", []), files, result["violations"], skipped)
    if request.get("declared"):
        declared_session, declared = declared_contracts(use_cases, request["declared"], set(names), skipped)
        if declared_session is not None:
            run_contracts(use_cases, declared_session, declared, files, result["violations"], skipped)
    write(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        try:
            outfile = sys.argv[sys.argv.index("--out") + 1]
            with open(outfile, "w", encoding="utf8") as handle:
                json.dump(fail("%s: %s" % (type(exc).__name__, exc)), handle)
        except (ValueError, IndexError, OSError):
            raise exc
