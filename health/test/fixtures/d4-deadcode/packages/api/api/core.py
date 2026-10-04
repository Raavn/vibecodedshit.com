__all__ = ["exported_fn"]


def register(fn):
    return fn


def used_fn():
    return 1


def unused_fn():
    return 2


class UnusedClass:
    def unused_method(self):
        return 3


@register
def decorated_fn():
    return 4


def exported_fn():
    return 5
