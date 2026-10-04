"""Sessions of noxfile.py files. Standard library only.

Reads {"files": [relative paths]} as JSON on stdin and prints
{path: {"ok": false} | {"ok": true, "sessions": [{"name", "commands": [str], "notify": [str]}]}}.

A session is a function decorated with nox.session (with or without arguments). Its name is the name=
keyword when that is a string literal, else the function name. Commands are session.run(...) and
session.run_always(...) calls with the positional arguments joined by spaces (a non-literal argument
becomes "?"; keyword arguments are ignored). session.notify("<name>") is a call to another session.
"""

import ast
import json
import sys


def literal(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def session_decorator(node):
    target = node.func if isinstance(node, ast.Call) else node
    if isinstance(target, ast.Attribute):
        return target.attr == "session" and isinstance(target.value, ast.Name) and target.value.id == "nox"
    return isinstance(target, ast.Name) and target.id == "session"


def session_name(func, decorator):
    if isinstance(decorator, ast.Call):
        for keyword in decorator.keywords:
            if keyword.arg == "name":
                name = literal(keyword.value)
                if name is not None:
                    return name
    return func.name


def analyze(path):
    with open(path, "rb") as handle:
        tree = ast.parse(handle.read().decode("utf-8", errors="replace"), filename=path)
    sessions = []
    for func in ast.walk(tree):
        if not isinstance(func, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        decorators = [d for d in func.decorator_list if session_decorator(d)]
        if not decorators:
            continue
        arg = func.args.args[0].arg if func.args.args else "session"
        commands = []
        notify = []
        for node in ast.walk(func):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
                continue
            if not (isinstance(node.func.value, ast.Name) and node.func.value.id == arg):
                continue
            if node.func.attr in ("run", "run_always"):
                parts = [literal(a) if literal(a) is not None else "?" for a in node.args if not isinstance(a, ast.Starred)]
                if parts:
                    commands.append(" ".join(parts))
            elif node.func.attr == "notify" and node.args and literal(node.args[0]) is not None:
                notify.append(literal(node.args[0]))
        sessions.append({"name": session_name(func, decorators[0]), "commands": commands, "notify": notify})
    return sessions


def main():
    request = json.load(sys.stdin)
    out = {}
    for path in request["files"]:
        try:
            out[path] = {"ok": True, "sessions": analyze(path)}
        except (SyntaxError, ValueError, OSError):
            out[path] = {"ok": False}
    json.dump(out, sys.stdout)


main()
