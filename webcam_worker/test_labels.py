#!/usr/bin/env python3
"""Runnable check for presence / phone hysteresis. No camera, no models."""

from __future__ import annotations

import unittest

from labels import Hysteresis, TrackerState, compose_frame


class HysteresisTests(unittest.TestCase):
    def test_phone_needs_three_hits_in_five(self):
        h = Hysteresis(window=5, on_threshold=3, off_clear=2)
        self.assertFalse(h.update(False))
        self.assertFalse(h.update(True))
        self.assertFalse(h.update(True))
        self.assertTrue(h.update(True))

    def test_phone_clears_after_two_misses(self):
        h = Hysteresis(window=5, on_threshold=2, off_clear=2)
        self.assertFalse(h.update(True))
        self.assertTrue(h.update(True))
        self.assertTrue(h.update(True))
        self.assertTrue(h.update(False))
        self.assertFalse(h.update(False))


class PresenceTests(unittest.TestCase):
    def test_a_person_without_a_face_is_present(self):
        state = TrackerState.default()
        compose_frame(state, face_in_frame=False, person_in_frame=True, phone_raw=False)
        out = compose_frame(state, face_in_frame=False, person_in_frame=True, phone_raw=False)
        self.assertTrue(out["present"])

    def test_single_face_frame_does_not_assert_present(self):
        state = TrackerState.default()
        out = compose_frame(
            state,
            face_in_frame=True,
            person_in_frame=False,
            phone_raw=False,
        )
        self.assertFalse(out["present"])

    def test_present_after_two_frames(self):
        state = TrackerState.default()
        compose_frame(state, face_in_frame=True, person_in_frame=False, phone_raw=False)
        out = compose_frame(state, face_in_frame=True, person_in_frame=False, phone_raw=False)
        self.assertTrue(out["present"])
        self.assertIsNone(out["gaze"])
        self.assertFalse(out["looking_at_phone"])


class BurstTests(unittest.TestCase):
    def test_burst_lasts_until_a_hit_leaves_the_window(self):
        phone = TrackerState.default().phone
        self.assertFalse(phone.recent_hit())
        phone.update(True)
        for _ in range(4):
            phone.update(False)
            self.assertTrue(phone.recent_hit())
        phone.update(False)
        self.assertFalse(phone.recent_hit())


if __name__ == "__main__":
    unittest.main()
