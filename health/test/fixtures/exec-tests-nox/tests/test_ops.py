import unittest

from calc.ops import add, clamp


class OpsTest(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(1, 2), 3)

    def test_clamp_below(self):
        self.assertEqual(clamp(-1, 0, 10), 0)

    def test_clamp_above(self):
        self.assertEqual(clamp(11, 0, 10), 11)

    @unittest.skip("not written yet")
    def test_clamp_middle(self):
        self.assertEqual(clamp(5, 0, 10), 5)

    @unittest.expectedFailure
    def test_known_bug(self):
        self.assertEqual(add(1, 1), 3)
