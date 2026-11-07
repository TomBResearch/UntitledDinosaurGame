# Workloads and measurements

> Source: UDG-CONTRACTS-M0-001 v1.0, section 7.4. Repository edition 1. Shared requirements are authoritative here; task files link to them.

### 7.4 Workloads and statistics

Use seeds 1001, 1002 and 1003 for each spike scenario. Each browser network run has two real client contexts, 20 seconds warm-up and 120 seconds measurement. Collect every eligible authoritative acknowledgement, including zero corrections. Report total ack opportunities, zero values, nonzero values, excluded labelled resets and p50/p95/p99/max. Use nearest-rank percentiles, sorted sample at ceiling(p times N); if N is zero or below 100 measured acknowledgements per run, fail the run as insufficient evidence. Correction is the magnitude of raw predicted-versus-authoritative horizontal state at the same acknowledged input boundary before display smoothing; render offsets are a separate metric.

Profiles are LAN 0-10 ms RTT with minimal jitter; moderate 50 ms RTT/10 ms jitter; elevated 100/20 ms; poor 200/40 ms. Run all four at each spike; the elevated profile carries the numerical correction gate. Implement a development WebSocket proxy with symmetric one-way delay set to half target RTT and bounded uniform delay variation whose achieved RTT jitter is measured and reported. Preserve byte order and model TCP stalls as stalls; do not call application message dropping packet-loss simulation. Record requested and achieved p50/p95 RTT, the exact jitter statistic and sample count. If achieved median RTT differs by more than 10 ms or measured p95-minus-p50 exceeds the declared budget by more than 10 ms, mark the profile INVALID and rerun, without claiming a pass.

Gate measurements record server OS/CPU/memory, Node version, browser/version, headed or headless mode and monotonic clock source. Compare matched simulation boundaries, not unsynchronised wall-clock positions. Record tick execution, schedule lateness, overrun count, buffer depth, navigation CPU/queue depth, traffic bytes, correction, browser frame time and entity/resource counts. These two-client spike runs do not certify the later 20-client, ten-minute M0 workload.
