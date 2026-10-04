import typing
import typing as t
from typing import Any, cast
from typing import Any as AnyAlias

def param(a: Any) -> None:
    return None

def ret() -> Any:
    return None

x: Any = 1

def stringy(a: "Any") -> "dict[str, Any]":
    return {}

def aliases(a: typing.Any, b: t.Any, c: AnyAlias) -> None:
    return None

def casted(v: object) -> int:
    return cast(int, v)

def casted2(v: object) -> int:
    return typing.cast(int, v)

def ignored(v: int) -> int:
    w = v + 1  # type: ignore
    z = w  # pyright: ignore[reportGeneralTypeIssues]
    q = z  # noqa  # type: ignore[attr-defined]
    return q
