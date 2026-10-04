from typing import overload

def annotated(a: int, b: str) -> bool:
    return True

def untyped(a, b):
    return a

def defaults(a=1, *args, b: int = 2, **kw) -> None:
    return None

def _private(a):
    return a

class Service:
    def __init__(self, a: int):
        self.a = a

    def run(self, x) -> int:
        return 1

    @classmethod
    def build(cls, y: int):
        return cls(y)

    @staticmethod
    def helper(z):
        return z

    def _hidden(self, q):
        return q

    def __call__(self, w: int) -> int:
        return w

    def __new__(cls, v):
        return super().__new__(cls)

    class Inner:
        def nested_method(self, a):
            return a

class _PrivateClass:
    def pub(self, a):
        return a

if True:
    def conditional(a: int) -> int:
        return a

def outer(a: int) -> int:
    def nested(x):
        return x
    return a

@overload
def over(a: int) -> int: ...
@overload
def over(a: str) -> str: ...
def over(a):
    return a
