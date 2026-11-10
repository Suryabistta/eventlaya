import datetime

from django.test import SimpleTestCase

from .bs import bs_text, to_bs


class BsDateTests(SimpleTestCase):
    def test_matches_the_website_and_the_published_calendar(self):
        self.assertEqual(to_bs(datetime.date(2026, 10, 18)), (2083, 7, 1))  # Kartik 1, 2083 = 18 Oct 2026
        self.assertEqual(bs_text(datetime.date(2026, 10, 27), weekday=True), 'Tue, 10 Kartik 2083')
        self.assertEqual(to_bs(datetime.date(2013, 4, 14)), (2070, 1, 1))
        self.assertIsNone(to_bs(datetime.date(2000, 1, 1)))
