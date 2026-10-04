"""Typing facts for Python files. Standard library only.

Reads {"files": [relative paths]} as JSON on stdin and prints
{path: {"ok": false}
      | {"ok": true, "points": {...}, "allNames": [...] | null, "defs": [...]}}
as JSON on stdout. The helper only extracts facts; counting and publicness rules are applied by the caller.

points: anyCount, castCount, typeIgnoreLine, typeIgnoreHeader, pyrightIgnore, mypyIgnoreErrors (bool).
defs: public-surface candidates in source order, module level only (including inside top-level if,
try and with blocks):
  {"kind": "function", "name", "info": fn} or {"kind": "class", "name", "methods": [fn]}
fn: {"name", "params": [{"name", "typed", "kind"}], "returns": bool, "decorators": [str]}
"""

import ast
import io
import json
import re
import sys
import tokenize

TYPE_IGNORE = re.compile(r"#\s*type:\s*ignore\b")
PYRIGHT_IGNORE = re.compile(r"#\s*pyright:\s*ignore\b")
MYPY_IGNORE_ERRORS = re.compile(r"^#\s*mypy:\s*ignore-errors\b")
TYPING_MODULES = ("typing", "typing_extensions")


def read_text(path):
    with open(path, "rb") as handle:
        raw = handle.read()
    try:
        encoding, _ = tokenize.detect_encoding(io.BytesIO(raw).readline)
        text = raw.decode(encoding)
    except (SyntaxError, UnicodeDecodeError, LookupError):
        text = raw.decode("utf-8", errors="replace")
    return text.replace("\r\n", "\n").replace("\r", "\n")


class Imports:
    """Names that resolve to typing.Any, typing.cast and the typing modules themselves."""

    def __init__(self, tree):
        self.any_names = set()
        self.cast_names = set()
        self.modules = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module in TYPING_MODULES:
                for alias in node.names:
                    bound = alias.asname or alias.name
                    if alias.name == "Any":
                        self.any_names.add(bound)
                    elif alias.name == "cast":
                        self.cast_names.add(bound)
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name in TYPING_MODULES:
                        self.modules.add(alias.asname or alias.name)

    def is_member(self, node, member, names):
        if isinstance(node, ast.Name):
            return node.id in names
        return (
            isinstance(node, ast.Attribute)
            and node.attr == member
            and isinstance(node.value, ast.Name)
            and node.value.id in self.modules
        )


def count_any(annotation, imports):
    if annotation is None:
        return 0
    total = 0
    for node in ast.walk(annotation):
        if isinstance(node, (ast.Name, ast.Attribute)) and imports.is_member(node, "Any", imports.any_names):
            total += 1
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            try:
                inner = ast.parse(node.value.strip(), mode="eval")
            except SyntaxError:
                continue
            total += count_any(inner.body, imports)
    return total


def all_arguments(args):
    return list(args.posonlyargs) + list(args.args) + ([args.vararg] if args.vararg else []) + list(args.kwonlyargs) + ([args.kwarg] if args.kwarg else [])


def describe_function(node):
    args = node.args
    params = []
    for kind, group in (
        ("positional", list(args.posonlyargs) + list(args.args)),
        ("vararg", [args.vararg] if args.vararg else []),
        ("keyword", list(args.kwonlyargs)),
        ("kwarg", [args.kwarg] if args.kwarg else []),
    ):
        for arg in group:
            params.append({"name": arg.arg, "typed": arg.annotation is not None, "kind": kind})
    decorators = []
    for decorator in node.decorator_list:
        try:
            decorators.append(ast.unparse(decorator))
        except Exception:
            decorators.append("")
    return {"name": node.name, "params": params, "returns": node.returns is not None, "decorators": decorators}


FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef)


def module_level(statements):
    """Statements at module level, descending into if, try and with blocks but not into functions or classes."""
    for statement in statements:
        yield statement
        if isinstance(statement, ast.If):
            yield from module_level(statement.body)
            yield from module_level(statement.orelse)
        elif isinstance(statement, (ast.With, ast.AsyncWith)):
            yield from module_level(statement.body)
        elif isinstance(statement, (ast.Try, getattr(ast, "TryStar", ast.Try))):
            yield from module_level(statement.body)
            for handler in statement.handlers:
                yield from module_level(handler.body)
            yield from module_level(statement.orelse)
            yield from module_level(statement.finalbody)


def string_list(node):
    if isinstance(node, (ast.List, ast.Tuple)):
        return [e.value for e in node.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
    return None


def find_all_names(tree):
    names = None
    for statement in tree.body:
        if isinstance(statement, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "__all__" for t in statement.targets):
            listed = string_list(statement.value)
            if listed is not None:
                names = list(listed)
        elif isinstance(statement, ast.AnnAssign) and isinstance(statement.target, ast.Name) and statement.target.id == "__all__" and statement.value is not None:
            listed = string_list(statement.value)
            if listed is not None:
                names = list(listed)
        elif isinstance(statement, ast.AugAssign) and isinstance(statement.target, ast.Name) and statement.target.id == "__all__" and isinstance(statement.op, ast.Add):
            listed = string_list(statement.value)
            if listed is not None:
                names = (names or []) + listed
        elif (
            isinstance(statement, ast.Expr)
            and isinstance(statement.value, ast.Call)
            and isinstance(statement.value.func, ast.Attribute)
            and isinstance(statement.value.func.value, ast.Name)
            and statement.value.func.value.id == "__all__"
            and statement.value.args
        ):
            method = statement.value.func.attr
            argument = statement.value.args[0]
            if method == "extend":
                listed = string_list(argument)
                if listed is not None:
                    names = (names or []) + listed
            elif method == "append" and isinstance(argument, ast.Constant) and isinstance(argument.value, str):
                names = (names or []) + [argument.value]
    return names


def comment_points(text, first_statement_line):
    points = {"typeIgnoreLine": 0, "typeIgnoreHeader": 0, "pyrightIgnore": 0, "mypyIgnoreErrors": False}
    for token in tokenize.generate_tokens(io.StringIO(text).readline):
        if token.type != tokenize.COMMENT:
            continue
        comment = token.string
        if TYPE_IGNORE.search(comment):
            if first_statement_line is None or token.start[0] < first_statement_line:
                points["typeIgnoreHeader"] += 1
            else:
                points["typeIgnoreLine"] += 1
        if PYRIGHT_IGNORE.search(comment):
            points["pyrightIgnore"] += 1
        if MYPY_IGNORE_ERRORS.match(comment):
            points["mypyIgnoreErrors"] = True
    return points


def analyze(path):
    text = read_text(path)
    try:
        tree = ast.parse(text)
        first = tree.body[0].lineno if tree.body else None
        points = comment_points(text, first)
    except (SyntaxError, ValueError, tokenize.TokenError, RecursionError, MemoryError):
        return {"ok": False}

    imports = Imports(tree)
    any_count = 0
    cast_count = 0
    for node in ast.walk(tree):
        if isinstance(node, FUNCTIONS) or isinstance(node, ast.Lambda):
            if isinstance(node, FUNCTIONS):
                for arg in all_arguments(node.args):
                    any_count += count_any(arg.annotation, imports)
                any_count += count_any(node.returns, imports)
        elif isinstance(node, ast.AnnAssign):
            any_count += count_any(node.annotation, imports)
        elif isinstance(node, ast.Call) and imports.is_member(node.func, "cast", imports.cast_names):
            cast_count += 1
    points["anyCount"] = any_count
    points["castCount"] = cast_count

    defs = []
    for statement in module_level(tree.body):
        if isinstance(statement, FUNCTIONS):
            defs.append({"kind": "function", "name": statement.name, "info": describe_function(statement)})
        elif isinstance(statement, ast.ClassDef):
            methods = [describe_function(m) for m in statement.body if isinstance(m, FUNCTIONS)]
            defs.append({"kind": "class", "name": statement.name, "methods": methods})
    return {"ok": True, "points": points, "allNames": find_all_names(tree), "defs": defs}


def main():
    request = json.load(sys.stdin)
    result = {}
    for path in request["files"]:
        try:
            result[path] = analyze(path)
        except OSError:
            result[path] = {"ok": False}
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
