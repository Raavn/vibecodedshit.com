__all__ = ["_listed", "Exposed"]
__all__ += ["extra"]
__all__.append("more")

def _listed(a: int) -> int:
    return a

def unlisted(a):
    return a

class Exposed:
    def m(self, a) -> None:
        return None

class Hidden:
    def m(self, a):
        return a

def extra(a: int) -> int:
    return a

def more(a):
    return a
