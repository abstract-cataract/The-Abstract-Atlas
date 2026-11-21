import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api.js';
import { getHotspot } from '../src/content.js';
import { FEEDBACK_MS } from '../src/scoring.js';
import { MemoryRepo } from './memoryRepo.js';

// The guest location's challenge (Ridgely's again since the 11/20 release; Uptown for 11/17). Expected scores scale with its question count,
// so adding or removing questions doesn't break these tests.
const GUEST_HS = 'ridgelys-beacon';
const GUEST_LOC = 'ridgelys';
const N = getHotspot(GUEST_HS)!.questions.length;
// Seconds per question (15 since 11/11). pts(s) = points for a right answer given after s seconds.
const T = getHotspot(GUEST_HS)!.questions[0]!.timeLimitSeconds;
const pts = (s: number) => 100 + 10 * (T - s);

const SECRET = 'x'.repeat(40);

let repo: MemoryRepo;
let clock: number;
let idCounter: number;
let api: ReturnType<typeof createApi>;

beforeEach(() => {
  repo = new MemoryRepo();
  clock = 1_700_000_000_000;
  idCounter = 0;
  api = createApi({
    repo,
    now: () => clock,
    rand: () => 0.5,
    newId: () => `id${++idCounter}`,
    guestSecret: SECRET,
    // Test "Cognito": token "user:<sub>:<email>" is valid.
    verifyUserToken: async (token) => {
      const [kind, sub, email] = token.split(':');
      return kind === 'user' && sub ? { sub, email } : null;
    },
  });
});

async function call(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) {
  const event = {
    rawPath: path,
    headers: opts.headers ?? {},
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
    requestContext: { http: { method } },
  } as unknown as APIGatewayProxyEventV2;
  const res = (await api(event)) as { statusCode: number; body: string };
  return { status: res.statusCode, json: JSON.parse(res.body) as any };
}

async function newGuest() {
  const res = await call('POST', '/guest');
  expect(res.status).toBe(201);
  return { 'x-guest-token': res.json.guestToken as string };
}

const user = (sub: string, email = `${sub}@example.com`) => ({ authorization: `Bearer user:${sub}:${email}` });

/** Plays a whole hotspot run, answering every question correctly after `secondsPerQuestion`. */
async function playRun(headers: Record<string, string>, hotspotId: string, opts: { allCorrect?: boolean; secondsPerQuestion?: number } = {}) {
  const { allCorrect = true, secondsPerQuestion = 2 } = opts;
  const hotspot = getHotspot(hotspotId)!;
  const start = await call('POST', `/challenges/${hotspotId}/start`, { headers });
  expect(start.status).toBe(200);
  const attemptId = start.json.attemptId as string;
  let question = start.json.question;
  let last: any;
  for (let i = 0; i < hotspot.questions.length; i++) {
    const original = hotspot.questions.find((q) => q.id === question.id)!;
    const correctText = original.choices[original.correctIndex];
    const choiceIndex = allCorrect ? question.choices.indexOf(correctText) : (question.choices.indexOf(correctText) + 1) % question.choices.length;
    // A player sees the next question only after the feedback pause, then answers s seconds later.
    clock += (i > 0 ? FEEDBACK_MS : 0) + secondsPerQuestion * 1000;
    last = await call('POST', `/challenges/${hotspotId}/answer`, { headers, body: { attemptId, choiceIndex } });
    expect(last.status).toBe(200);
    question = last.json.next;
  }
  expect(last.json.done).toBe(true);
  return last.json;
}

describe('guest flow', () => {
  it("creates a guest who can play Ridgely's and University City (11/20 release)", async () => {
    const guest = await newGuest();
    const { json } = await call('GET', '/locations', { headers: guest });
    const byId = Object.fromEntries(json.locations.map((l: any) => [l.id, l.accessible]));
    expect(byId).toEqual({ ridgelys: true, 'inner-harbor': false, uptown: false, university: true });
  });

  it('blocks guests from coming-soon locations (signing up unlocks nothing extra right now)', async () => {
    const guest = await newGuest();
    const res = await call('POST', '/challenges/inner-harbor-beacon/start', { headers: guest });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('LOCATION_LOCKED');
    expect(res.json.error.unlockedBySignUp).toEqual([]);
  });

  it('never sends correct answers to the client when a run starts', async () => {
    const guest = await newGuest();
    const start = await call('POST', `/challenges/${GUEST_HS}/start`, { headers: guest });
    expect(JSON.stringify(start.json)).not.toContain('correctIndex');
    expect(start.json.question.choices).toHaveLength(4);
  });

  it('scores on the server: 100 + 10/sec left, perfect run at 2s each = N * pts(2)', async () => {
    const guest = await newGuest();
    const result = (await playRun(guest, GUEST_HS)).result;
    expect(result).toMatchObject({ correctAnswers: N, totalQuestions: N, score: N * pts(2), completed: true, badgeEarned: true });
    expect(result.badge.id).toBe('delight-seeker');
  });

  it("shows the sign-up prompt with unlocked locations when a guest completes Ridgely's", async () => {
    const guest = await newGuest();
    const result = (await playRun(guest, GUEST_HS)).result;
    expect(result.locationCompleted).toBe(true);
    expect(result.signUpPrompt.badges.map((b: any) => b.id)).toEqual(['delight-seeker']);
    expect(result.signUpPrompt.unlockedLocations).toEqual([]);
  });

  it('does not show the sign-up prompt to signed-in users', async () => {
    const result = (await playRun(user('u1'), GUEST_HS)).result;
    expect(result.signUpPrompt).toBeUndefined();
  });

  it('ignores answers that arrive after the time limit', async () => {
    const guest = await newGuest();
    const start = await call('POST', `/challenges/${GUEST_HS}/start`, { headers: guest });
    clock += 30_000;
    const res = await call('POST', `/challenges/${GUEST_HS}/answer`, {
      headers: guest,
      body: { attemptId: start.json.attemptId, choiceIndex: 0 },
    });
    expect(res.json).toMatchObject({ correct: false, timedOut: true, pointsAwarded: 0 });
  });

  it('rejects answers for a replaced or unknown attempt', async () => {
    const guest = await newGuest();
    const first = await call('POST', `/challenges/${GUEST_HS}/start`, { headers: guest });
    await call('POST', `/challenges/${GUEST_HS}/start`, { headers: guest });
    const res = await call('POST', `/challenges/${GUEST_HS}/answer`, {
      headers: guest,
      body: { attemptId: first.json.attemptId, choiceIndex: 0 },
    });
    expect(res.status).toBe(409);
  });

  it('rejects forged guest tokens and requests with no identity', async () => {
    expect((await call('GET', '/me', { headers: { 'x-guest-token': 'bad.token.here' } })).status).toBe(401);
    expect((await call('GET', '/me')).status).toBe(401);
  });
});

describe('question timing', () => {
  it('does not charge the feedback pause against the next question', async () => {
    const headers = user('timer');
    const start = await call('POST', `/challenges/${GUEST_HS}/start`, { headers });
    const hs = getHotspot(GUEST_HS)!;
    const answer = async (q: any, idx: number) =>
      call('POST', `/challenges/${GUEST_HS}/answer`, { headers, body: { attemptId: start.json.attemptId, choiceIndex: idx } });
    const correctShown = (q: any) => q.choices.indexOf(hs.questions.find((x) => x.id === q.id)!.choices[hs.questions.find((x) => x.id === q.id)!.correctIndex]);

    clock += 1000; // Q1 answered after 1s
    const r1 = await answer(start.json.question, correctShown(start.json.question));
    expect(r1.json.pointsAwarded).toBe(pts(1));

    clock += 900; // client is still showing feedback; Q2 has not even appeared yet
    const r2 = await answer(r1.json.next, correctShown(r1.json.next));
    expect(r2.json.pointsAwarded).toBe(pts(0)); // elapsed clamps to 0, full time left
  });
});

describe('accounts and leaderboard', () => {
  it('lets signed-in users play the open locations, and nobody the coming-soon ones', async () => {
    for (const id of ['university-beacon', 'ridgelys-beacon']) {
      const res = await call('POST', `/challenges/${id}/start`, { headers: user('u1') });
      expect(res.status).toBe(200);
    }
    // 11/20 release: Uptown and Inner Harbor are coming soon, closed even with an account.
    for (const id of ['uptown-beacon', 'inner-harbor-beacon']) {
      expect((await call('POST', `/challenges/${id}/start`, { headers: user('u1') })).status).toBe(403);
    }
  });

  it('has no Federal Hill, NoDa or Pigtown for anyone (off the map), and lists the 4 open locations', async () => {
    for (const id of ['federal-hill-beacon', 'noda-beacon', 'pigtown-beacon']) {
      expect((await call('POST', `/challenges/${id}/start`, { headers: user('u1') })).status).toBe(404);
      expect((await call('POST', `/challenges/${id}/start`, { headers: await newGuest() })).status).toBe(404);
    }
    const { json } = await call('GET', '/locations');
    expect(json.locations.map((l: any) => l.id)).toEqual(['ridgelys', 'inner-harbor', 'uptown', 'university']);
  });

  it('keeps only the best score per hotspot', async () => {
    const headers = user('u1');
    await playRun(headers, GUEST_HS, { secondsPerQuestion: 2 }); // N * pts(2)
    const worse = (await playRun(headers, GUEST_HS, { secondsPerQuestion: 8 })).result; // N * pts(8)
    expect(worse).toMatchObject({ score: N * pts(8), bestScore: N * pts(2), isNewBest: false });
  });

  it('ranks registered players and leaves guests off the leaderboard', async () => {
    await call('PATCH', '/me', { headers: user('fast', 'fast@example.com'), body: { playerName: 'fast' } });
    await call('PATCH', '/me', { headers: user('slow', 'slow@example.com'), body: { playerName: 'slow' } });
    await playRun(user('fast', 'fast@example.com'), GUEST_HS, { secondsPerQuestion: 1 });
    await playRun(user('slow', 'slow@example.com'), GUEST_HS, { secondsPerQuestion: 7 });
    await playRun(await newGuest(), GUEST_HS, { secondsPerQuestion: 0 });
    const board = await call('GET', `/leaderboard/${GUEST_LOC}`);
    expect(board.json.entries.map((e: any) => [e.rank, e.playerName])).toEqual([
      [1, 'fast'],
      [2, 'slow'],
    ]);
  });

  it('validates display names and updates leaderboard rows when renamed', async () => {
    const headers = user('u1', 'someone@example.com');
    await playRun(headers, GUEST_HS);
    expect((await call('PATCH', '/me', { headers, body: { playerName: 'x' } })).status).toBe(400);
    expect((await call('PATCH', '/me', { headers, body: { playerName: '<script>' } })).status).toBe(400);
    // Curse words / slurs and over-long or markup-laden input are refused by the API itself (not just the browser).
    expect((await call('PATCH', '/me', { headers, body: { playerName: 'sh1t' } })).status).toBe(400);
    expect((await call('PATCH', '/me', { headers, body: { playerName: 'a'.repeat(5000) } })).status).toBe(400);
    expect((await call('PATCH', '/me', { headers, body: { playerName: { $ne: '' } } })).status).toBe(400);
    expect((await call('GET', '/' + 'a'.repeat(300), { headers })).status).toBe(414);
    expect((await call('PATCH', '/me', { headers, body: { playerName: 'Crab Cakes' } })).status).toBe(200);
    const board = await call('GET', `/leaderboard/${GUEST_LOC}`);
    expect(board.json.entries[0].playerName).toBe('Crab Cakes');
  });
});

describe('claiming guest progress on sign-up', () => {
  it('moves the guest badge and score into the new account and puts it on the leaderboard', async () => {
    const guest = await newGuest();
    await playRun(guest, GUEST_HS);

    const claim = await call('POST', '/account/claim', { headers: { ...user('newbie', 'newbie@example.com'), ...guest } });
    expect(claim.status).toBe(200);
    expect(claim.json.claimed).toBe(1);
    expect(claim.json.badges.map((b: any) => b.id)).toEqual(['delight-seeker']);
    expect(claim.json.player.isGuest).toBe(false);
    expect(claim.json.player.name).toMatch(/^Explorer-\d{4}$/); // never derived from the email

    const board = await call('GET', `/leaderboard/${GUEST_LOC}`);
    expect(board.json.entries).toHaveLength(1);
    expect(board.json.entries[0]).toMatchObject({ rank: 1, score: N * pts(2) });
    expect(JSON.stringify(board.json)).not.toContain('newbie');

    // The guest profile is gone, and the guest can no longer see old progress.
    const guestMe = await call('GET', '/me', { headers: guest });
    expect(guestMe.json.results).toEqual([]);
  });

  it('merges with an existing account, keeping the best of each', async () => {
    const guest = await newGuest();
    await playRun(guest, GUEST_HS, { secondsPerQuestion: 1 }); // N * pts(1)
    const headers = user('vet', 'vet@example.com');
    await playRun(headers, GUEST_HS, { secondsPerQuestion: 6 }); // N * pts(6)
    await playRun(headers, 'university-beacon', { secondsPerQuestion: 2 });

    const claim = await call('POST', '/account/claim', { headers: { ...headers, ...guest } });
    const fh = claim.json.results.find((r: any) => r.hotspotId === GUEST_HS);
    expect(fh.score).toBe(N * pts(1));
    expect(claim.json.badges).toHaveLength(2);
  });

  it('keeps a name the guest chose, and requires both identities', async () => {
    const guest = await newGuest();
    await call('PATCH', '/me', { headers: guest, body: { playerName: 'Hon' } });
    const claim = await call('POST', '/account/claim', { headers: { ...user('n1'), ...guest } });
    expect(claim.json.player.name).toBe('Hon');

    expect((await call('POST', '/account/claim', { headers: guest })).status).toBe(401);
    expect((await call('POST', '/account/claim', { headers: user('n2') })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------------------- 11/20
describe('what everyone said (answer split)', () => {
  it('returns the percent of players who picked each choice, in the order shown', async () => {
    const hs = getHotspot(GUEST_HS)!;
    // Three players answer question 1: two right, one wrong.
    const picks: any[] = [];
    for (const [i, right] of [[0, true], [1, true], [2, false]] as const) {
      const headers = user(`p${i}`);
      const start = await call('POST', `/challenges/${GUEST_HS}/start`, { headers });
      const q = start.json.question;
      const original = hs.questions.find((x) => x.id === q.id)!;
      const correctShown = q.choices.indexOf(original.choices[original.correctIndex]);
      const choiceIndex = right ? correctShown : (correctShown + 1) % q.choices.length;
      clock += 1000;
      const res = await call('POST', `/challenges/${GUEST_HS}/answer`, { headers, body: { attemptId: start.json.attemptId, choiceIndex } });
      picks.push({ res: res.json, correctShown, choiceIndex });
    }
    const last = picks[2];
    expect(last.res.split.answered).toBe(3);
    expect(last.res.split.percents[last.correctShown]).toBe(67);
    expect(last.res.split.percents[last.choiceIndex]).toBe(33);
    expect(last.res.split.percents).toHaveLength(4);
  });

  it('does not count a timed-out answer', async () => {
    const headers = user('slowpoke');
    const start = await call('POST', `/challenges/${GUEST_HS}/start`, { headers });
    clock += 1000;
    const res = await call('POST', `/challenges/${GUEST_HS}/answer`, { headers, body: { attemptId: start.json.attemptId, choiceIndex: null } });
    expect(res.json.split).toEqual({ answered: 0, percents: [0, 0, 0, 0] });
  });
});

describe('challenge a friend', () => {
  it('saves each finished run, and anyone can look it up by its link', async () => {
    await call('PATCH', '/me', { headers: user('iv'), body: { playerName: 'Iverson' } });
    const done = await playRun(user('iv'), GUEST_HS, { secondsPerQuestion: 3 });
    const runId = done.result.runId;
    expect(runId).toBeTruthy();
    const look = await call('GET', `/runs/${runId}`); // no login
    expect(look.status).toBe(200);
    expect(look.json.run).toMatchObject({ playerName: 'Iverson', correctAnswers: N, totalQuestions: N, seconds: 3 * N, hotspotId: GUEST_HS });
    expect(look.json.run.answers).toHaveLength(N);
    expect(look.json.run.choiceOrders).toBeUndefined(); // the answer order stays private
    expect(look.json.locationName).toBe("Ridgely's");
    expect((await call('GET', '/runs/nope')).status).toBe(404);
  });

  it("gives the friend the exact same run and a head-to-head at the end", async () => {
    await call('PATCH', '/me', { headers: user('iv'), body: { playerName: 'Iverson' } });
    const mine = await playRun(user('iv'), GUEST_HS, { secondsPerQuestion: 4 });
    const runId = mine.result.runId;

    const friend = await newGuest();
    const start = await call('POST', `/challenges/${GUEST_HS}/start`, { headers: friend, body: { challengeRunId: runId } });
    expect(start.status).toBe(200);
    expect(start.json.challenge.playerName).toBe('Iverson');
    const myRun = await repo.getRun(runId);
    const attempt = await repo.getAttempt([...repo.profiles.keys()].find((k) => k.startsWith('g_'))!, GUEST_HS);
    expect(attempt!.choiceOrders).toEqual(myRun!.choiceOrders); // same order as the challenger saw

    // Friend finishes the run faster -> wins.
    const attemptId = start.json.attemptId;
    let q = start.json.question;
    let last: any;
    const hs = getHotspot(GUEST_HS)!;
    for (let i = 0; i < N; i++) {
      const original = hs.questions.find((x) => x.id === q.id)!;
      clock += (i > 0 ? FEEDBACK_MS : 0) + 2000;
      last = await call('POST', `/challenges/${GUEST_HS}/answer`, { headers: friend, body: { attemptId, choiceIndex: q.choices.indexOf(original.choices[original.correctIndex]) } });
      q = last.json.next;
    }
    expect(last.json.result.versus.outcome).toBe('win');
    expect(last.json.result.versus.them.playerName).toBe('Iverson');
    expect(last.json.result.versus.you.score).toBeGreaterThan(last.json.result.versus.them.score);
    expect(last.json.result.runId).toBeTruthy(); // so the friend can send it back
  });

  it('refuses a challenge link for a different location', async () => {
    const mine = await playRun(user('iv'), GUEST_HS);
    const res = await call('POST', '/challenges/university-beacon/start', { headers: user('x'), body: { challengeRunId: mine.result.runId } });
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe('CHALLENGE_NOT_FOUND');
  });
});

describe('challenge names (11/20)', () => {
  it("shows the player's current name on a link they shared before renaming", async () => {
    const guest = await newGuest();
    const mine = await playRun(guest, GUEST_HS);
    await call('PATCH', '/me', { headers: guest, body: { playerName: 'Iverson' } });
    const look = await call('GET', `/runs/${mine.result.runId}`);
    expect(look.json.run.playerName).toBe('Iverson');
    expect(look.json.run.playerId).toBeUndefined(); // stays private
  });
});

describe('first run counts (11/20)', () => {
  it("keeps the first run on the leaderboard; a better replay doesn't replace it", async () => {
    await call('PATCH', '/me', { headers: user('u1'), body: { playerName: 'First' } });
    const first = await playRun(user('u1'), GUEST_HS, { secondsPerQuestion: 10 });
    expect(first.result.counted).toBe(true);
    const replay = await playRun(user('u1'), GUEST_HS, { secondsPerQuestion: 1 });
    expect(replay.result.score).toBeGreaterThan(first.result.score);
    expect(replay.result.counted).toBe(false);
    expect(replay.result.badgeEarned).toBe(false);
    expect(replay.result.bestScore).toBe(first.result.score);
    expect(replay.result.runId).toBeTruthy(); // still shareable
    const board = await call('GET', `/leaderboard/${GUEST_LOC}`);
    expect(board.json.entries.find((e: any) => e.playerName === 'First').score).toBe(first.result.score);
  });
});

describe('half credit (11/21)', () => {
  it('Prospector counts as right for half the points, with its own line', async () => {
    const headers = user('half');
    const start = await call('POST', '/challenges/university-beacon/start', { headers });
    const q = start.json.question;
    expect(q.id).toBe('un-1');
    clock += 2000;
    const res = await call('POST', '/challenges/university-beacon/answer', { headers, body: { attemptId: start.json.attemptId, choiceIndex: q.choices.indexOf('Prospector') } });
    expect(res.json.correct).toBe(true);
    expect(res.json.partial).toBe(true);
    expect(res.json.pointsAwarded).toBe(Math.round((100 + 13 * 10) / 2));
    expect(res.json.response).toBe('Ok, fine this one can count.');
  });
});
