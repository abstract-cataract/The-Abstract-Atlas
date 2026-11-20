import { Injectable, signal } from '@angular/core';
import { RunSummary } from '../models/api.models';
import { GameApiService } from './game-api.service';
import { GameDataService } from './game-data.service';

/** A friend's challenge someone opened a link for. */
export interface PendingChallenge {
  run: RunSummary;
  locationName: string;
  cityId: string;
  /** True once they tapped "Accept": the location's trivia opens straight away. */
  accepted: boolean;
}

/**
 * 11/20: challenge links ("Can you beat me?").
 * A link looks like  https://.../The-Abstract-Atlas/?challenge=<runId>
 * Opening it shows a banner (see ChallengeBannerComponent); accepting takes the player to that location,
 * and the trivia plays the exact same run the friend played.
 */
@Injectable({ providedIn: 'root' })
export class ChallengeLinkService {
  readonly pending = signal<PendingChallenge | null>(null);
  readonly error = signal('');

  constructor(private api: GameApiService, private gameData: GameDataService) {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const runId = params.get('challenge');
    if (runId && /^[\w-]{1,64}$/.test(runId)) {
      // Tidy the address bar so a refresh doesn't bring the banner back after the challenge is played.
      params.delete('challenge');
      const rest = params.toString();
      try {
        window.history.replaceState(window.history.state, '', window.location.pathname + (rest ? '?' + rest : '') + window.location.hash);
      } catch {
        // ignore
      }
      void this.load(runId);
    }
  }

  async load(runId: string) {
    if (!this.api.enabled) return;
    try {
      const { run, locationName } = await this.api.getRun(runId);
      const cityId = this.gameData.getLocation(run.locationId)?.cityId ?? '';
      this.pending.set({ run, locationName, cityId, accepted: false });
      this.error.set('');
    } catch {
      this.error.set('That challenge link has expired or does not exist.');
    }
  }

  accept() {
    const p = this.pending();
    if (p) this.pending.set({ ...p, accepted: true });
  }

  dismiss() {
    this.pending.set(null);
    this.error.set('');
  }

  /** The run id to play for this location, if the player accepted a challenge for it. */
  runIdFor(hotspotId: string): string | undefined {
    const p = this.pending();
    return p?.accepted && p.run.hotspotId === hotspotId ? p.run.runId : undefined;
  }

  /** Called once the challenge run has started (or failed): the banner and link are used up. */
  done() {
    this.pending.set(null);
  }

  /** The link to send for a finished run. */
  static linkFor(runId: string): string {
    // Uses the address the game is open at: github.io when live, localhost:4200 with ng serve.
    return new URL('./?challenge=' + encodeURIComponent(runId), document.baseURI).href;
  }
}
