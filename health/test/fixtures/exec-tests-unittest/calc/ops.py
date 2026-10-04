def add(a, b):
    return a + b


def clamp(n, lo, hi):
    if n < lo:
        return lo
    if n > hi:
        return hi
    return n
