# Research repair verification

The live report is `official-research.json` with its generated Markdown. It uses the unchanged user instruction, DeepSeek, no ScaleDown and no automatic fallback. It processed 18/18 pages with three bounded recoveries, suppressed 83 unsupported batch placeholders and emitted 169 findings.

Source checks against the original PDF confirmed:
- Page 1 contains the article title and seven authors.
- Page 6 states 63 volunteers, nine technical-data exclusions and three age-related exclusions. Written counts now match their numeric values while source quotes remain unchanged.
- Page 7 uses CG for the control group. No GG condition appears in the new output.
- Page 17 now contributes own-study conclusions, technical tracking/registration limitations, and transferability limitations.
- No abbreviated running-author item appears in the live report.

The final conservative percentage matcher was verified by replaying these exact saved candidates through the production pipeline without API calls. `official-research-replay.json` is labeled demo/offline-replay and records the SHA-256 of the live report. It emits 168 findings, grouping the repeated 14% result into one finding with citations on pages 1 and 14. The original live report is preserved unchanged.

This is a targeted source audit, not a complete manual accuracy score for all findings. Other paraphrases and source regions still require manual review. The number-word matcher supports English integers below 100 and leaves larger magnitudes/fractions for review.
