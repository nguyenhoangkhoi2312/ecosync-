# Branch B: OCR & Graph Search

This module builds the electrical netlist from the blueprint.

## Role in EcoSync
- Uses OCR (PaddleOCR) to read labels.
- Uses Hough transforms and graph search to connect devices to electrical circuits (which breaker controls which zone).
