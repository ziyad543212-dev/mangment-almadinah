import unittest
import cv2
import numpy as np
from image_pipeline import deskew, enhance_contrast, binary_variant, quality_metrics, rotate_document


class ImagePipelineTests(unittest.TestCase):
    def test_restoration_preserves_geometry(self):
        image = np.full((400, 700, 3), 150, np.uint8)
        cv2.putText(image, "PASSPORT", (70, 200), cv2.FONT_HERSHEY_SIMPLEX, 1.8, (40, 40, 40), 2)
        self.assertEqual(enhance_contrast(image).shape, image.shape)
        self.assertEqual(binary_variant(image).shape, image.shape)
        self.assertEqual(quality_metrics(image)["width"], 700)

    def test_right_angle_round_trip_preserves_every_pixel(self):
        image = np.arange(1200, dtype=np.uint8).reshape((20, 20, 3))
        np.testing.assert_array_equal(rotate_document(rotate_document(image, 90), 270), image)

    def test_blank_document_is_not_rotated_by_noise(self):
        image = np.full((300, 500, 3), 255, np.uint8)
        restored, angle = deskew(image)
        self.assertEqual(angle, 0)
        np.testing.assert_array_equal(restored, image)


if __name__ == "__main__":
    unittest.main()
