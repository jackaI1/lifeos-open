import unittest
from solution import normalize_tags


class HiddenTests(unittest.TestCase):
    def test_empty_and_order(self):
        self.assertEqual(normalize_tags([' ', ' B ', 'a', 'b', '', ' A ']), ['b', 'a'])

    def test_other_values(self):
        self.assertEqual(normalize_tags(['One', 'TWO', 'one', ' three ']), ['one', 'two', 'three'])

    def test_no_values(self):
        self.assertEqual(normalize_tags([]), [])
