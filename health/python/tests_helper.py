"""Import and test-case facts for Python files (1.4 and 1.5). Standard library only.

Reads {"files": [relative paths]} as JSON on stdin and prints
{path: {"ok": false}
      | {"ok": true, "imports": [...], "defined": [...], "reexports": [...], "cases": [...]}}.

imports:   every import statement at any nesting depth:
           {"module": str | null, "level": int, "names": [{"name", "asname"}], "star": bool}
           ("import a.b" has module "a.b", level 0 and no names; "from . import x" has module null and level 1).
defined:   names defined at module level (functions, classes, assignments).
reexports: module-level "from m import a as b" bindings (including inside top-level if/try/with):
           {"name": bound name, "module", "level", "orig"}; used for __init__.py re-exports.
cases:     test_* functions at module level or directly in a class body: {"name", "line", "asserts": bool}.
"""

import ast
import json
import sys

NESTED = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)
DEFS = (ast.FunctionDef, ast.AsyncFunctionDef)


def read_tree(path):
    with open(path, "rb") as handle:
        return ast.parse(handle.read().decode("utf-8", errors="replace"), filename=path)


def target_names(target):
    if isinstance(target, ast.Name):
        return [target.id]
    if isinstance(target, (ast.Tuple, ast.List)):
        return [n for t in target.elts for n in target_names(t)]
    if isinstance(target, ast.Starred):
        return target_names(target.value)
    return []


def top_level(nodes):
    """Statements at module level, descending into if/try/with but not into definitions."""
    for node in nodes:
        yield node
        if isinstance(node, ast.If):
            yield from top_level(node.body + node.orelse)
        elif isinstance(node, ast.Try):
            yield from top_level(node.body + node.orelse + node.finalbody)
            for handler in node.handlers:
                yield from top_level(handler.body)
        elif isinstance(node, (ast.With, ast.AsyncWith)):
            yield from top_level(node.body)


def pytest_names(tree):
    modules, members = set(), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "pytest":
                    modules.add(alias.asname or "pytest")
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module == "pytest":
            for alias in node.names:
                if alias.name in ("raises", "warns"):
                    members.add(alias.asname or alias.name)
    return modules, members


def walk_body(nodes):
    """Every node of a body, not descending into nested def, lambda or class bodies."""
    stack = list(reversed(nodes))
    while stack:
        node = stack.pop()
        yield node
        if isinstance(node, NESTED):
            continue
        stack.extend(reversed(list(ast.iter_child_nodes(node))))


def is_assertion(node, pytest_modules, pytest_members):
    if isinstance(node, ast.Assert):
        return True
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    if isinstance(func, ast.Attribute):
        if isinstance(func.value, ast.Name) and func.value.id == "self" and func.attr.startswith("assert"):
            return True
        if func.attr in ("raises", "warns") and isinstance(func.value, ast.Name) and func.value.id in pytest_modules:
            return True
        if func.attr.startswith("assert_"):
            return True
    return isinstance(func, ast.Name) and func.id in pytest_members


def direct_assertion(body, pm, pf):
    return any(is_assertion(n, pm, pf) for n in walk_body(body))


def case_asserts(func, class_methods, module_funcs, pm, pf):
    nodes = list(walk_body(func.body))
    if any(is_assertion(n, pm, pf) for n in nodes):
        return True
    inner = {n.name: n for n in nodes if isinstance(n, DEFS)}
    for node in nodes:
        if not isinstance(node, ast.Call):
            continue
        helper = None
        if isinstance(node.func, ast.Name):
            helper = inner.get(node.func.id) or module_funcs.get(node.func.id)
        elif isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id == "self":
            helper = class_methods.get(node.func.attr)
        if helper is not None and helper is not func and direct_assertion(helper.body, pm, pf):
            return True
    return False


def analyze(path):
    tree = read_tree(path)
    pm, pf = pytest_names(tree)
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append({"module": alias.name, "level": 0, "names": [], "star": False, "asname": alias.asname})
        elif isinstance(node, ast.ImportFrom):
            imports.append({
                "module": node.module,
                "level": node.level,
                "names": [{"name": a.name, "asname": a.asname} for a in node.names if a.name != "*"],
                "star": any(a.name == "*" for a in node.names),
            })
    defined, reexports = [], []
    module_funcs = {}
    for node in top_level(tree.body):
        if isinstance(node, DEFS):
            defined.append(node.name)
            module_funcs[node.name] = node
        elif isinstance(node, ast.ClassDef):
            defined.append(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                defined.extend(target_names(target))
        elif isinstance(node, (ast.AnnAssign, ast.AugAssign)):
            defined.extend(target_names(node.target))
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name != "*":
                    reexports.append({"name": alias.asname or alias.name, "module": node.module, "level": node.level, "orig": alias.name})
    cases = []
    for node in tree.body:
        if isinstance(node, DEFS) and node.name.startswith("test_"):
            cases.append({"name": node.name, "line": node.lineno, "asserts": case_asserts(node, {}, module_funcs, pm, pf)})
        elif isinstance(node, ast.ClassDef):
            methods = {n.name: n for n in node.body if isinstance(n, DEFS)}
            for method in methods.values():
                if method.name.startswith("test_"):
                    cases.append({"name": f"{node.name}.{method.name}", "line": method.lineno, "asserts": case_asserts(method, methods, module_funcs, pm, pf)})
    return {"ok": True, "imports": imports, "defined": sorted(set(defined)), "reexports": reexports, "cases": cases}


def main():
    request = json.load(sys.stdin)
    out = {}
    for path in request["files"]:
        try:
            out[path] = analyze(path)
        except (SyntaxError, ValueError, OSError, RecursionError):
            out[path] = {"ok": False}
    json.dump(out, sys.stdout)


main()
