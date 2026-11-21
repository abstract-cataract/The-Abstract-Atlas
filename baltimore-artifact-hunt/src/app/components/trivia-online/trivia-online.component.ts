import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output } from '@angular/core';
import { AnswerSplit, ChallengeResult, RunSummary, ServerQuestion } from '../../models/api.models';
import { Hotspot } from '../../models/game.models';
import { ApiError, GameApiService } from '../../services/game-api.service';
import { AuthUiService } from '../../services/auth-ui.service';
import { ChallengeLinkService } from '../../services/challenge-link.service';

type AnswerState = 'unanswered' | 'correct' | 'partial' | 'incorrect' | 'timeout'; // 11/21: + 'partial'
type Phase = 'loading' | 'question' | 'done' | 'error';

/** How long right/wrong feedback shows before the next question. Must match FEEDBACK_MS in server/src/scoring.ts. */
const FEEDBACK_MS = 2500; // was 900: long enough to read a tailored line

/**
 * Server-driven version of TriviaChallengeComponent. The server supplies the questions,
 * times each answer and works out the score; this component just shows them.
 * (The original local-only TriviaChallengeComponent is untouched and still used in offline mode.)
 */
@Component({
  selector: 'app-trivia-online',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './trivia-online.component.html',
  styleUrls: ['../trivia-challenge/trivia-challenge.component.css', './trivia-online.component.css'],
})
export class TriviaOnlineComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) hotspot!: Hotspot;
  @Output() finished = new EventEmitter<ChallengeResult>();

  phase: Phase = 'loading';
  question: ServerQuestion | null = null;
  answerState: AnswerState = 'unanswered';
  selectedChoice: number | null = null;
  correctChoice: number | null = null;
  /** Tailored line for the last answer, if the question has one. */
  responseLine: string | null = null;
  secondsLeft = 10;
  runningScore = 0;
  result: ChallengeResult | null = null;
  errorMessage = '';
  errorNeedsSignUp = false;
  /** 11/20: how everyone answered the current question (shown as bars during feedback). */
  split: AnswerSplit | null = null;
  /** 11/20: the friend whose challenge link this run came from. */
  rival: RunSummary | null = null;
  /** 11/20: the "Challenge a friend" panel on the results screen. */
  shareOpen = false;
  shareStatus = '';
  /** 11/20: the name your friend sees on the challenge. */
  shareName = '';
  savingName = false;
  nameError = '';

  private attemptId = '';
  private submitting = false;
  private runId = 0;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private advanceHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(public api: GameApiService, private authUi: AuthUiService, private challengeLinks: ChallengeLinkService) {}

  ngOnChanges() {
    void this.begin();
  }

  ngOnDestroy() {
    this.runId++;
    this.clearTimers();
  }

  async begin() {
    this.clearTimers();
    const run = ++this.runId;
    this.phase = 'loading';
    this.result = null;
    this.errorMessage = '';
    this.errorNeedsSignUp = false;
    this.runningScore = 0;
    this.rival = null;
    this.shareOpen = false;
    this.shareStatus = '';
    // 11/20: a friend's challenge link for this location plays their exact run.
    const challengeRunId = this.challengeLinks.runIdFor(this.hotspot.id);
    try {
      const res = await this.api.startChallenge(this.hotspot.id, challengeRunId);
      // was: const res = await this.api.startChallenge(this.hotspot.id);
      if (run !== this.runId) return;
      if (challengeRunId) this.challengeLinks.done();
      this.rival = res.challenge ?? null;
      this.attemptId = res.attemptId;
      this.showQuestion(res.question);
    } catch (e) {
      if (challengeRunId) this.challengeLinks.done(); // a bad or outdated link: "Try again" plays a normal run
      if (run === this.runId) this.fail(e);
    }
  }

  select(choiceIndex: number) {
    if (this.answerState !== 'unanswered' || this.submitting) return;
    this.clearTimer();
    this.selectedChoice = choiceIndex;
    void this.submit(choiceIndex);
  }

  openSignUp() {
    this.authUi.show('signup');
  }

  openLogin() {
    this.authUi.show('login');
  }

  private showQuestion(q: ServerQuestion) {
    this.question = q;
    this.phase = 'question';
    this.answerState = 'unanswered';
    this.selectedChoice = null;
    this.correctChoice = null;
    this.responseLine = null;
    this.split = null;
    this.submitting = false;
    this.secondsLeft = q.timeLimitSeconds;
    this.clearTimer();
    this.timerHandle = setInterval(() => {
      this.secondsLeft -= 1;
      if (this.secondsLeft <= 0) {
        this.clearTimer();
        void this.submit(null); // time's up
      }
    }, 1000);
  }

  private async submit(choiceIndex: number | null) {
    this.submitting = true;
    const run = this.runId;
    try {
      const res = await this.api.answer(this.hotspot.id, this.attemptId, choiceIndex);
      if (run !== this.runId) return;
      this.correctChoice = res.correctIndex;
      this.answerState = choiceIndex === null || res.timedOut ? 'timeout' : res.partial ? 'partial' : res.correct ? 'correct' : 'incorrect';
      // was: this.answerState = choiceIndex === null || res.timedOut ? 'timeout' : res.correct ? 'correct' : 'incorrect';
      this.responseLine = res.response ?? null;
      this.split = res.split ?? null; // 11/20
      this.runningScore += res.pointsAwarded;
      this.advanceHandle = setTimeout(() => {
        if (res.done && res.result) {
          this.result = res.result;
          this.phase = 'done';
          this.finished.emit(res.result);
        } else if (res.next) {
          this.showQuestion(res.next);
        }
      }, FEEDBACK_MS);
    } catch (e) {
      if (run === this.runId) this.fail(e);
    }
  }

  // ------------------------------------------------ 11/20: challenge a friend
  /** Green/red squares for the share text, one per question. */
  squares(answers: boolean[] | undefined): string {
    return (answers ?? []).map((a) => (a ? '🟩' : '🟥')).join('');
  }

  shareText(r: ChallengeResult): string {
    const where = this.hotspot.name;
    const time = r.seconds !== undefined ? ` in ${r.seconds}s` : '';
    const head =
      r.versus?.outcome === 'win'
        ? `I beat ${r.versus.them.playerName} in ${where}: ${r.correctAnswers}/${r.totalQuestions}${time}. Your move.`
        : `I got ${r.correctAnswers}/${r.totalQuestions} in ${where}${time} on The Abstract Atlas. Can you beat me?`;
    return `${head}\n${this.squares(r.answers)}`;
  }

  shareLink(r: ChallengeResult): string {
    return r.runId ? ChallengeLinkService.linkFor(r.runId) : '';
  }

  openShare() {
    this.shareOpen = true;
    this.shareStatus = '';
    this.shareName = this.api.playerName();
    this.nameError = '';
  }

  /** 11/20: saves the player's name (guests too). The link always shows the current name, so this works after sharing as well. */
  async saveShareName(): Promise<boolean> {
    const next = this.shareName.trim();
    if (!next || next === this.api.playerName()) return true;
    this.savingName = true;
    this.nameError = '';
    try {
      await this.api.rename(next);
      this.shareStatus = 'Name saved.';
      return true;
    } catch (e) {
      this.nameError = (e as Error).message || "That name can't be used. Try another.";
      return false;
    } finally {
      this.savingName = false;
    }
  }

  /** Phones: the system share sheet (Instagram, Messages...). Elsewhere: copy. */
  async share(r: ChallengeResult) {
    if (!(await this.saveShareName())) return; // 11/20: fix the name first
    const text = this.shareText(r);
    const url = this.shareLink(r);
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: 'The Abstract Atlas', text, url });
        this.shareStatus = 'Sent!';
        return;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return; // they closed the share sheet
      }
    }
    await this.copy(r);
  }

  async copy(r: ChallengeResult) {
    if (!(await this.saveShareName())) return; // 11/20
    try {
      await navigator.clipboard.writeText(`${this.shareText(r)}\n${this.shareLink(r)}`);
      this.shareStatus = 'Copied! Paste it in a DM or your story.';
    } catch {
      this.shareStatus = 'Copy the link below.';
    }
  }

  private fail(e: unknown) {
    this.clearTimers();
    this.phase = 'error';
    if (e instanceof ApiError) {
      this.errorMessage = e.message;
      this.errorNeedsSignUp = e.code === 'LOCATION_LOCKED';
      if (e.code === 'INVALID_TOKEN') {
        this.errorMessage = 'Your login expired. Please log in again.';
        this.authUi.show('login');
      }
      if (e.code === 'ATTEMPT_NOT_FOUND') this.errorMessage = 'That run ended. Start the challenge again.';
      if (e.code === 'CHALLENGE_NOT_FOUND' || e.code === 'CHALLENGE_OUTDATED') this.errorMessage = e.message + ' Tap "Try again" for a fresh run.'; // 11/20
    } else {
      this.errorMessage = 'Something went wrong. Please try again.';
    }
  }

  private clearTimer() {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private clearTimers() {
    this.clearTimer();
    if (this.advanceHandle) {
      clearTimeout(this.advanceHandle);
      this.advanceHandle = null;
    }
  }
}
