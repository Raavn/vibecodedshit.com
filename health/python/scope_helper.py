"""Line classification for Python files. Standard library only.

Reads {"files": [relative paths]} as JSON on stdin and prints
{path: {"parsed": bool, "hasDef": bool, "lines": int}} as JSON on stdout.
"lines" is the number of non-blank lines that are not comment-only and not
docstring lines.
"""

import ast
import io
import json
import sys
import tokenize

NON_CODE = {
    tokenize.COMMENT,
    tokenize.NL,
    tokenize.NEWLINE,
    tokenize.INDENT,
    tokenize.DEDENT,
    tokenize.ENDMARKER,
}


def read_text(path):
    with open(path, "rb") as handle:
        raw = handle.read()
    try:
        encoding, _ = tokenize.detect_encoding(io.BytesIO(raw).readline)
        text = raw.decode(encoding)
    except (SyntaxError, UnicodeDecodeError, LookupError):
        text = raw.decode("utf-8", errors="replace")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def fallback(text):
    count = 0
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            count += 1
    return {"parsed": False, "hasDef": True, "lines": count}


def docstring_lines(tree):
    lines = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if body:
                first = body[0]
                if (
                    isinstance(first, ast.Expr)
                    and isinstance(first.value, ast.Constant)
                    and isinstance(first.value.value, str)
                ):
                    lines.update(range(first.lineno, first.end_lineno + 1))
    return lines


def analyze(path):
    text = read_text(path)
    try:
        tree = ast.parse(text)
        code = set()
        for tok in tokenize.generate_tokens(io.StringIO(text).readline):
            if tok.type not in NON_CODE:
                code.update(range(tok.start[0], tok.end[0] + 1))
    except (SyntaxError, ValueError, tokenize.TokenError, RecursionError):
        return fallback(text)

    doc = docstring_lines(tree)
    all_lines = text.split("\n")
    count = 0
    for number in code:
        if number in doc:
            continue
        if number - 1 < len(all_lines) and all_lines[number - 1].strip() != "":
            count += 1
    has_def = any(
        isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        for node in ast.walk(tree)
    )
    return {"parsed": True, "hasDef": has_def, "lines": count}


def main():
    request = json.load(sys.stdin)
    result = {}
    for path in request["files"]:
        result[path] = analyze(path)
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
