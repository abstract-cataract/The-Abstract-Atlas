// Shapes of the JSON returned by the game server (server/src/api.ts).

import { Badge, PlayerHotspotResult } from './game.models';

export interface UnlockableLocation {
  id: string;
  name: string;
  tagline: string;
}

export interface LocationView extends UnlockableLocation {
  hotspotIds: string[];
  /** False for guests on locations that need an account, and for everyone on coming-soon locations. */
  accessible: boolean;
  /** Not open to anyone yet. */
  comingSoon?: boolean;
  progressPct: number;
  completed: boolean;
}

export interface MeResponse {
  player: { id: string; name: string; isGuest: boolean };
  results: PlayerHotspotResult[];
  badges: Badge[];
  locations: LocationView[];
  /** Guests only: locations that signing up unlocks. */
  signUpUnlocks?: UnlockableLocation[];
}

/** A question as the server sends it: choices already shuffled, no answer included. */
export interface ServerQuestion {
  index: number;
  total: number;
  id: string;
  prompt: string;
  choices: string[];
  timeLimitSeconds: number;
  /** Picture to show above the question, if it has one. */
  image?: string;
}

export interface StartResponse {
  attemptId: string;
  hotspotId: string;
  question: ServerQuestion;
  /** 11/20: present when this run came from a friend's challenge link. */
  challenge?: RunSummary;
}

/** 11/20: a finished run that can be shared as a challenge link. */
export interface RunSummary {
  runId: string;
  hotspotId: string;
  locationId: string;
  playerName: string;
  correctAnswers: number;
  totalQuestions: number;
  score: number;
  seconds: number;
  /** Right/wrong per question, in question order. */
  answers: boolean[];
  createdAt: number;
}

/** 11/20: you vs. the friend who sent the challenge. */
export interface Versus {
  you: RunSummary;
  them: RunSummary;
  outcome: 'win' | 'lose' | 'tie';
}

/** 11/20: "what everyone said": percent of players who picked each choice, in the order shown. */
export interface AnswerSplit {
  answered: number;
  percents: number[];
}

export interface SignUpPrompt {
  message: string;
  badges: Badge[];
  unlockedLocations: UnlockableLocation[];
}

export interface ChallengeResult {
  hotspotId: string;
  completed: boolean;
  correctAnswers: number;
  totalQuestions: number;
  score: number;
  bestScore: number;
  isNewBest: boolean;
  badgeEarned: boolean;
  badge: Badge | null;
  locationId: string;
  locationCompleted: boolean;
  /** Present when a guest finishes a location: drives the "sign up to save badges" screen. */
  signUpPrompt?: SignUpPrompt;
  /** 11/20: id for this run's challenge link. */
  runId?: string;
  /** 11/20: seconds spent answering, and right/wrong per question (for the share card). */
  seconds?: number;
  answers?: boolean[];
  /** 11/20: only when this run was a friend's challenge. */
  versus?: Versus;
}

export interface AnswerResponse {
  correct: boolean;
  timedOut: boolean;
  /** Index of the right answer in the order the choices were shown. */
  correctIndex: number;
  pointsAwarded: number;
  secondsLeft: number;
  /** Tailored line for this answer, if the question has one. */
  response?: string;
  /** 11/20: how everyone answered this question. */
  split?: AnswerSplit;
  done: boolean;
  next?: ServerQuestion;
  result?: ChallengeResult;
}

export interface LeaderboardRow {
  rank: number;
  playerName: string;
  score: number;
}
