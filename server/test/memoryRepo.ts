import { Repo } from '../src/repo.js';
import { Attempt, HotspotResult, LeaderboardRow, LocationTotal, Profile, Run } from '../src/types.js';

/** In-memory Repo for tests. Mirrors DynamoRepo's behavior, including "guests never reach the leaderboard". */
export class MemoryRepo implements Repo {
  profiles = new Map<string, Profile>();
  results = new Map<string, Map<string, HotspotResult>>();
  attempts = new Map<string, Attempt>();
  totals = new Map<string, { total: LocationTotal; isGuest: boolean }>();
  answerCounts = new Map<string, number[]>();
  runs = new Map<string, Run>();

  async recordAnswer(questionId: string, choiceIndex: number | null, choiceCount: number) {
    const counts = this.answerCounts.get(questionId) ?? new Array(choiceCount).fill(0);
    if (choiceIndex !== null) counts[choiceIndex] = (counts[choiceIndex] ?? 0) + 1;
    this.answerCounts.set(questionId, counts);
    return [...counts];
  }
  async putRun(run: Run) {
    this.runs.set(run.runId, structuredClone(run));
  }
  async getRun(runId: string) {
    const r = this.runs.get(runId);
    return r ? structuredClone(r) : undefined;
  }

  async getProfile(id: string) {
    return this.profiles.get(id);
  }
  async putProfile(p: Profile) {
    this.profiles.set(p.playerId, p);
  }
  async getResults(id: string) {
    return [...(this.results.get(id)?.values() ?? [])];
  }
  async putResult(id: string, r: HotspotResult) {
    if (!this.results.has(id)) this.results.set(id, new Map());
    this.results.get(id)!.set(r.hotspotId, r);
  }
  async getAttempt(id: string, hotspotId: string) {
    return this.attempts.get(`${id}|${hotspotId}`);
  }
  async putAttempt(id: string, a: Attempt) {
    this.attempts.set(`${id}|${a.hotspotId}`, structuredClone(a));
  }
  async deleteAttempt(id: string, hotspotId: string) {
    this.attempts.delete(`${id}|${hotspotId}`);
  }
  async getLocationTotals(id: string) {
    return [...this.totals.entries()].filter(([k]) => k.startsWith(`${id}|`)).map(([, v]) => v.total);
  }
  async putLocationTotal(id: string, total: LocationTotal, isGuest: boolean) {
    this.totals.set(`${id}|${total.locationId}`, { total, isGuest });
  }
  async getLeaderboard(locationId: string, limit: number): Promise<LeaderboardRow[]> {
    return [...this.totals.values()]
      .filter((v) => !v.isGuest && v.total.locationId === locationId)
      .sort((a, b) => b.total.score - a.total.score)
      .slice(0, limit)
      .map((v, i) => ({ rank: i + 1, playerName: v.total.playerName, score: v.total.score }));
  }
  async deletePlayer(id: string) {
    this.profiles.delete(id);
    this.results.delete(id);
    for (const key of [...this.attempts.keys()]) if (key.startsWith(`${id}|`)) this.attempts.delete(key);
    for (const key of [...this.totals.keys()]) if (key.startsWith(`${id}|`)) this.totals.delete(key);
  }
}
