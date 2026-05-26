import type { HistoryRow } from "./types";

export const HISTORY_SEED: readonly HistoryRow[] = [
  {
    jobId: "ti-workbench-1764950400123",
    started: "2026-05-23 14:20:00",
    status: "clean",
    stages: "generator·judge·visual·gate",
    artifacts: 10,
  },
  {
    jobId: "ti-workbench-1764871233981",
    started: "2026-05-22 16:11:33",
    status: "blocked",
    stages: "generator·judge·visual·gate",
    artifacts: 7,
  },
  {
    jobId: "ti-workbench-1764787012004",
    started: "2026-05-21 12:50:12",
    status: "clean",
    stages: "generator·judge·visual·gate",
    artifacts: 10,
  },
  {
    jobId: "ti-workbench-1764700001220",
    started: "2026-05-20 11:46:41",
    status: "degraded",
    stages: "generator·judge·visual",
    artifacts: 9,
  },
  {
    jobId: "ti-workbench-1764612447882",
    started: "2026-05-19 09:27:27",
    status: "blocked_failure",
    stages: "generator·judge",
    artifacts: 3,
  },
  {
    jobId: "ti-workbench-1764525001451",
    started: "2026-05-18 12:30:01",
    status: "clean",
    stages: "generator·judge·visual·gate",
    artifacts: 10,
  },
];
