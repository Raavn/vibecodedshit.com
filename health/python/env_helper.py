"""Environment variable names read by Python files (6.5). Standard library only.

Reads {"files": [relative paths]} as JSON on stdin and prints {path: {"ok": false} | {"ok": true, "names": [str]}}.
Reads: os.environ["X"] (Load context only), os.environ.get("X"), os.getenv("X"), also through
"from os import environ, getenv" and "import os as <alias>". Only literal string names count.
"""

import ast
import json
import sys


def literal(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def analyze(path):
    with open(path, "rb") as handle:
        tree = ast.parse(handle.read().decode("utf-8", errors="replace"), filename=path)
    os_names, environ_names, getenv_names = set(), set(), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "os":
                    os_names.add(alias.asname or "os")
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module == "os":
            for alias in node.names:
                if alias.name == "environ":
                    environ_names.add(alias.asname or "environ")
                elif alias.name == "getenv":
                    getenv_names.add(alias.asname or "getenv")

    def is_environ(node):
        if isinstance(node, ast.Name):
            return node.id in environ_names
        return isinstance(node, ast.Attribute) and node.attr == "environ" and isinstance(node.value, ast.Name) and node.value.id in os_names

    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Subscript) and isinstance(node.ctx, ast.Load) and is_environ(node.value):
            name = literal(node.slice)
            if name is not None:
                names.add(name)
        elif isinstance(node, ast.Call) and node.args:
            func = node.func
            name = literal(node.args[0])
            if name is None:
                continue
            if isinstance(func, ast.Attribute) and func.attr == "get" and is_environ(func.value):
                names.add(name)
            elif isinstance(func, ast.Attribute) and func.attr == "getenv" and isinstance(func.value, ast.Name) and func.value.id in os_names:
                names.add(name)
            elif isinstance(func, ast.Name) and func.id in getenv_names:
                names.add(name)
    return sorted(names)


def main():
    request = json.load(sys.stdin)
    out = {}
    for path in request["files"]:
        try:
            out[path] = {"ok": True, "names": analyze(path)}
        except (SyntaxError, ValueError, OSError, RecursionError):
            out[path] = {"ok": False}
    json.dump(out, sys.stdout)


main()
