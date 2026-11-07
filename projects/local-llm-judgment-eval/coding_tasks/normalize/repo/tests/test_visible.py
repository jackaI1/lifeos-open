import unittest
from solution import normalize_tags


class VisibleTests(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(normalize_tags([' Python ', 'python', 'AI']), ['python', 'ai'])
