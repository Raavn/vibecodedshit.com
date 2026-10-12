"""Symbols, __all__, imports and class bases of Python files for the 4.4 dead-code parameter. Standard library only.

Reads {"files": [relative paths]} as JSON on stdin and prints, per path,
{"ok": bool,
 "symbols": [{"name", "qualname", "kind": "function"|"class"|"method", "line", "startLine", "decorated"}],
 "allNames": [str] | null,
 "imports": [{"module": str, "level": int, "names": [str]}],
 "classes": {class name: {"bases": [{"name": str, "file": str | null, "class": str | null}]}}}
as JSON on stdout. "line" is the def/class line, "startLine" the first decorator line (or "line").
A base with "file" and "class" resolves to a class defined in one of the scanned files; a base with
null "file" is defined outside them (standard library, third party, or not resolvable). `object` and
`Generic[...]` are left out. A file that cannot be read or parsed gives {"ok": false}.
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


# ---- class bases ------------------------------------------------------------------------

IGNORED_BASES = {"object", "Generic"}
MAX_HOPS = 5


def class_nodes(statements, out):
    """Module-level classes, also inside top-level if/try/with (the same ones `collect` reports)."""
    for node in statements:
        if isinstance(node, ast.ClassDef):
            out.append(node)
        elif isinstance(node, BLOCKS):
            for body in child_bodies(node):
                class_nodes(body, out)


def dotted(node):
    """`a.b.C` as ["a", "b", "C"]; `Generic[T]` as its value; None for anything else (a call, ...)."""
    if isinstance(node, ast.Subscript):
        return dotted(node.value)
    if isinstance(node, ast.Name):
        return [node.id]
    if isinstance(node, ast.Attribute):
        head = dotted(node.value)
        return None if head is None else head + [node.attr]
    return None


def bindings(tree):
    """Module-level names bound by imports: name -> ("module", level, parts) or ("from", level, parts, name)."""
    bound = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                parts = alias.name.split(".")
                if alias.asname:
                    bound[alias.asname] = ("module", 0, parts)
                else:
                    bound[parts[0]] = ("module", 0, parts[:1])
        elif isinstance(node, ast.ImportFrom):
            parts = node.module.split(".") if node.module else []
            for alias in node.names:
                if alias.name != "*":
                    bound[alias.asname or alias.name] = ("from", node.level, parts, alias.name)
    return bound


class Index:
    """Classes and import bindings of every scanned file, and module lookup by path."""

    def __init__(self, trees):
        self.trees = trees
        self.classes = {}
        self.bound = {}
        for path, tree in trees.items():
            nodes = []
            class_nodes(tree.body, nodes)
            self.classes[path] = {node.name: node for node in nodes}
            self.bound[path] = bindings(tree)

    def module_file(self, importer, level, parts):
        """The scanned file of a module, absolute (path suffix) or relative to `importer`."""
        if level > 0:
            base = importer.split("/")[:-1]
            if level - 1 > len(base):
                return None
            base = base[: len(base) - (level - 1)]
            stem = "/".join(base + parts)
            for candidate in (stem + ".py", stem + "/__init__.py"):
                if candidate in self.trees:
                    return candidate
            return None
        if not parts:
            return None
        stem = "/".join(parts)
        for candidate in sorted(self.trees):
            for suffix in (stem + ".py", stem + "/__init__.py"):
                if candidate == suffix or candidate.endswith("/" + suffix):
                    return candidate
        return None

    def class_in(self, path, name, hops):
        """(file, class) for `name` as seen from module `path`, following re-exports."""
        if path is None or hops > MAX_HOPS:
            return None
        if name in self.classes.get(path, {}):
            return (path, name)
        binding = self.bound.get(path, {}).get(name)
        if binding is None or binding[0] != "from":
            return None
        _, level, parts, imported = binding
        return self.class_in(self.module_file(path, level, parts), imported, hops + 1)

    def resolve(self, path, parts):
        """Resolve base `parts` in module `path` to (file, class), or None."""
        head, rest = parts[0], parts[1:]
        if not rest and head in self.classes.get(path, {}):
            return (path, head)
        binding = self.bound.get(path, {}).get(head)
        if binding is None:
            return None
        if binding[0] == "module":
            _, level, mod = binding
            module_parts = mod + rest[:-1]
            if not rest:
                return None
            return self.class_in(self.module_file(path, level, module_parts), rest[-1], 0)
        _, level, mod, imported = binding
        if not rest:
            return self.class_in(self.module_file(path, level, mod), imported, 0)
        # `from pkg import module` then `module.Class`.
        module = self.module_file(path, level, mod + [imported] + rest[:-1])
        return self.class_in(module, rest[-1], 0)

    def bases(self, path):
        out = {}
        for name, node in self.classes[path].items():
            entries = []
            for base in node.bases:
                parts = dotted(base)
                if parts is not None and parts[-1] in IGNORED_BASES:
                    continue
                found = self.resolve(path, parts) if parts is not None else None
                text = ".".join(parts) if parts is not None else ast.dump(base)[:80]
                entries.append({"name": text, "file": found[0] if found else None, "class": found[1] if found else None})
            out[name] = {"bases": entries}
        return out


def parse(path):
    try:
        with open(path, "rb") as handle:
            return ast.parse(handle.read(), filename=path)
    except (OSError, SyntaxError, ValueError, RecursionError):
        return None


def analyze(path, tree, index):
    if tree is None:
        return {"ok": False}
    symbols = []
    collect(tree.body, symbols)
    return {
        "ok": True,
        "symbols": symbols,
        "allNames": all_names(tree),
        "imports": imports(tree),
        "classes": index.bases(path),
    }


def main():
    request = json.load(sys.stdin)
    trees = {path: parse(path) for path in request["files"]}
    index = Index({path: tree for path, tree in trees.items() if tree is not None})
    json.dump({path: analyze(path, tree, index) for path, tree in trees.items()}, sys.stdout)


if __name__ == "__main__":
    main()
