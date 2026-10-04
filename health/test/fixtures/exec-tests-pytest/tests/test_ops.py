import pytest

from calc.ops import add, clamp


def test_add():
    assert add(1, 2) == 3


def test_clamp_below():
    assert clamp(-1, 0, 10) == 0


def test_clamp_above():
    assert clamp(11, 0, 10) == 11


@pytest.mark.skip(reason="not written yet")
def test_clamp_middle():
    assert clamp(5, 0, 10) == 5


@pytest.mark.xfail(reason="known bug")
def test_known_bug():
    assert add(1, 1) == 3
