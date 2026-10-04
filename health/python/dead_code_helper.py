"""Symbols, __all__ and imports of Python files for the 4.4 dead-code parameter. Standard library only.

Reads {"files": [relative paths]} as JSON on stdin and prints, per path,
{"ok": bool,
 "symbols": [{"name", "qualname", "kind": "function"|"class"|"method", "line", "startLine", "decorated"}],
 "allNames": [str] | null,
 "imports": [{"module": str, "level": int, "names": [str]}]}
as JSON on stdout. "line" is the def/class line, "startLine" the first decorator line (or "line").
A file that cannot be read or parsed gives {"ok": false}.
"""

import ast
import json
import sys

FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef)
BLOCKS = (ast.If, ast.Try, ast.With, ast.AsyncWith)


def start_line(node):
    lines = [node.lineno] + [d.lineno for d in node.decorator_list]
    return min(lines)


def symbol(node, kind, qualname):
    return {
        "name": node.name,
        "qualname": qualname,
        "kind": kind,
        "line": node.lineno,
        "startLine": start_line(node),
        "decorated": bool(node.decorator_list),
    }


def child_bodies(node):
    if isinstance(node, ast.If):
        return [node.body, node.orelse]
    if isinstance(node, ast.Try):
        bodies = [node.body, node.orelse, node.finalbody]
        bodies.extend(handler.body for handler in node.handlers)
        return bodies
    return [node.body]


def collect(statements, out):
    """Module-level functions and classes, also inside top-level if/try/with, plus methods of those classes."""
    for node in statements:
        if isinstance(node, FUNCTIONS):
            out.append(symbol(node, "function", node.name))
        elif isinstance(node, ast.ClassDef):
            out.append(symbol(node, "class", node.name))
            for member in node.body:
                if isinstance(member, FUNCTIONS):
                    out.append(symbol(member, "method", node.name + "." + member.name))
        elif isinstance(node, BLOCKS):
            for body in child_bodies(node):
                collect(body, out)


def string_items(value):
    if isinstance(value, (ast.List, ast.Tuple)):
        return [e.value for e in value.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
    return None


def all_names(tree):
    names = None
    for node in tree.body:
        targets = []
        value = None
        if isinstance(node, ast.Assign):
            targets, value = node.targets, node.value
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets, value = [node.target], node.value
        elif isinstance(node, ast.AugAssign):
            targets, value = [node.target], node.value
        if not any(isinstance(t, ast.Name) and t.id == "__all__" for t in targets):
            continue
        items = string_items(value)
        if items is not None:
            names = (names or []) + items
    return names


def imports(tree):
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                found.append({"module": alias.name, "level": 0, "names": []})
        elif isinstance(node, ast.ImportFrom):
            found.append(
                {
                    "module": node.module or "",
                    "level": node.level,
                    "names": [alias.name for alias in node.names],
                }
            )
    return found


def analyze(path):
    try:
        with open(path, "rb") as handle:
            tree = ast.parse(handle.read(), filename=path)
    except (OSError, SyntaxError, ValueError, RecursionError):
        return {"ok": False}
    symbols = []
    collect(tree.body, symbols)
    return {"ok": True, "symbols": symbols, "allNames": all_names(tree), "imports": imports(tree)}


def main():
    request = json.load(sys.stdin)
    json.dump({path: analyze(path) for path in request["files"]}, sys.stdout)


if __name__ == "__main__":
    main()
