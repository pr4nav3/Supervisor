#!/usr/bin/env python3
"""Checks that do not need a model or a camera."""

from __future__ import annotations

import unittest

from detectors import CELL_PHONE_CLASS, PERSON_CLASS, Box, nms_per_class


class NmsTests(unittest.TestCase):
    def test_overlapping_phone_and_person_both_survive(self):
        phone = Box(0, 0, 40, 40, 0.9, CELL_PHONE_CLASS)
        person = Box(0, 0, 40, 40, 0.8, PERSON_CLASS)
        kept = nms_per_class([phone, person])
        self.assertEqual({box.class_id for box in kept}, {CELL_PHONE_CLASS, PERSON_CLASS})


if __name__ == "__main__":
    unittest.main()
