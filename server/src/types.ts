// Shared server-side types.

export type Caller =
  | { kind: 'guest'; playerId: string }
  | { kind: 'user'; playerId: string; email?: string };

export interface Profile {
  playerId: string;
  playerName: string;
  isGuest: boolean;
  createdAt: number;
}

/** Best result a player has for one hotspot (mirrors the frontend's PlayerHotspotResult). */
export interface HotspotResult {
  hotspotId: string;
  completed: boolean;
  correctAnswers: number;
  totalQuestions: number;
  /** Best score across all attempts. */
  score: number;
  badgeEarned: boolean;
  updatedAt: number;
}

/** An in-progress challenge run. One active attempt per player per hotspot. */
export interface Attempt {
  attemptId: string;
  hotspotId: string;
  /** For each question, the original choice indexes in the order they were shown to the player. */
  choiceOrders: number[][];
  questionIndex: number;
  /** Server clock time (ms) the current question was served. */
  servedAt: number;
  correct: number;
  score: number;
  /** 11/20: right/wrong for each question answered so far (for the challenge head-to-head). */
  answers?: boolean[];
  /** 11/20: total time spent answering, in ms (each question capped at its time limit). */
  elapsedMs?: number;
  /** 11/20: set when this run was started from a friend's challenge link. */
  challengeRunId?: string;
}

/** 11/20: a finished run that can be shared as a challenge link (stored for 60 days). */
export interface Run {
  runId: string;
  /** 11/20: who played it (private), so the link shows their current name if they rename after sharing. */
  playerId?: string;
  hotspotId: string;
  locationId: string;
  playerName: string;
  correctAnswers: number;
  totalQuestions: number;
  score: number;
  seconds: number;
  /** Right/wrong per question, in question order. */
  answers: boolean[];
  /** The choice order each question was shown in, so a friend gets the exact same run. */
  choiceOrders: number[][];
  createdAt: number;
}

/** What anyone can see about a shared run (no answer order). */
export type RunSummary = Omit<Run, 'choiceOrders' | 'playerId'>;
// was: export type RunSummary = Omit<Run, 'choiceOrders'>;

export interface LocationTotal {
  locationId: string;
  playerName: string;
  score: number;
}

export interface LeaderboardRow {
  rank: number;
  playerName: string;
  score: number;
}
