import { Attempt, HotspotResult, LeaderboardRow, LocationTotal, Profile, Run } from './types.js';

/** Storage interface. DynamoRepo is the real one; MemoryRepo (test/) backs the unit tests. */
export interface Repo {
  getProfile(playerId: string): Promise<Profile | undefined>;
  putProfile(profile: Profile): Promise<void>;

  getResults(playerId: string): Promise<HotspotResult[]>;
  putResult(playerId: string, result: HotspotResult, isGuest: boolean): Promise<void>;

  getAttempt(playerId: string, hotspotId: string): Promise<Attempt | undefined>;
  putAttempt(playerId: string, attempt: Attempt): Promise<void>;
  deleteAttempt(playerId: string, hotspotId: string): Promise<void>;

  getLocationTotals(playerId: string): Promise<LocationTotal[]>;
  /** Registered players only appear on the leaderboard; guests are stored without leaderboard keys. */
  putLocationTotal(playerId: string, total: LocationTotal, isGuest: boolean): Promise<void>;
  getLeaderboard(locationId: string, limit: number): Promise<LeaderboardRow[]>;

  /** Remove every item belonging to a player (used after a guest's progress is claimed). */
  deletePlayer(playerId: string): Promise<void>;

  // 11/20: "what everyone said" — how many players picked each choice of a question.
  /** Adds one answer (original choice index) and returns the new counts per choice. Pass null to just read. */
  recordAnswer(questionId: string, choiceIndex: number | null, choiceCount: number): Promise<number[]>;

  // 11/20: challenge links.
  putRun(run: Run): Promise<void>;
  getRun(runId: string): Promise<Run | undefined>;
}
