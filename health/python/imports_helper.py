"""Import statements, their flags and builtin open() calls per file. Stdlib only.

Input (stdin): {"root": "<abs>", "files": ["<rel>", ...]}
Output (stdout): {"files": {"<rel>": {"syntaxError": bool, "imports": [...], "opensBuiltin": bool}}}
"""
import ast
import json
import os
import sys


def is_type_checking(test):
    if isinstance(test, ast.Name):
        return test.id == "TYPE_CHECKING"
    if isinstance(test, ast.Attribute):
        return test.attr == "TYPE_CHECKING"
    return False


def bound_names(tree):
    """Every name the file binds anywhere, for the 'defines its own open' rule."""
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            names.add(node.id)
        elif isinstance(node, ast.arg):
            names.add(node.arg)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                names.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, ast.ExceptHandler) and node.name:
            names.add(node.name)
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            names.update(node.names)
        elif isinstance(node, (ast.MatchAs, ast.MatchStar)) and node.name:
            names.add(node.name)
        elif isinstance(node, ast.MatchMapping) and node.rest:
            names.add(node.rest)
    return names


def analyze(source):
    tree = ast.parse(source)
    imports = []

    def visit(node, lazy, type_only):
        if isinstance(node, ast.Import):
            imports.append(
                {
                    "line": node.lineno,
                    "level": 0,
                    "modules": [alias.name for alias in node.names],
                    "lazy": lazy,
                    "typeOnly": type_only,
                }
            )
            return
        if isinstance(node, ast.ImportFrom):
            imports.append(
                {
                    "line": node.lineno,
                    "level": node.level,
                    "modules": [node.module or ""],
                    "lazy": lazy,
                    "typeOnly": type_only,
                }
            )
            return
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for child in node.body:
                visit(child, True, type_only)
            # decorators, defaults and annotations run at definition time
            for child in ast.iter_child_nodes(node):
                if child not in node.body:
                    visit(child, lazy, type_only)
            return
        if isinstance(node, ast.Lambda):
            visit(node.body, True, type_only)
            for child in ast.iter_child_nodes(node):
                if child is not node.body:
                    visit(child, lazy, type_only)
            return
        if isinstance(node, ast.If) and is_type_checking(node.test):
            visit(node.test, lazy, type_only)
            for child in node.body:
                visit(child, lazy, True)
            for child in node.orelse:
                visit(child, lazy, type_only)
            return
        for child in ast.iter_child_nodes(node):
            visit(child, lazy, type_only)

    visit(tree, False, False)

    opens = False
    shadowed = "open" in bound_names(tree)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Name) and func.id == "open" and not shadowed:
            opens = True
        elif (
            isinstance(func, ast.Attribute)
            and func.attr == "open"
            and isinstance(func.value, ast.Name)
            and func.value.id == "builtins"
        ):
            opens = True
    return {"syntaxError": False, "imports": imports, "opensBuiltin": opens}


def main():
    request = json.load(sys.stdin)
    root = request["root"]
    result = {}
    for rel in request["files"]:
        try:
            with open(os.path.join(root, rel), "rb") as handle:
                source = handle.read()
            result[rel] = analyze(source)
        except (SyntaxError, ValueError, RecursionError, MemoryError):
            result[rel] = {"syntaxError": True, "imports": [], "opensBuiltin": False}
        except OSError:
            result[rel] = {"syntaxError": True, "imports": [], "opensBuiltin": False}
    json.dump({"files": result}, sys.stdout)


if __name__ == "__main__":
    main()
