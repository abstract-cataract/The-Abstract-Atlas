import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ChallengeLinkService } from '../../services/challenge-link.service';

/** 11/20: "Iverson challenged you" banner, shown when someone opens a challenge link. */
@Component({
  selector: 'app-challenge-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="cb" *ngIf="links.pending() as p" role="dialog" aria-label="Challenge from a friend">
      <ng-container *ngIf="!p.accepted">
        <div class="cb-kicker">You've been challenged</div>
        <p class="cb-line">
          <strong>{{ p.run.playerName }}</strong> got <strong>{{ p.run.correctAnswers }}/{{ p.run.totalQuestions }}</strong>
          in <strong>{{ p.locationName }}</strong> in {{ p.run.seconds }}s. Same questions, same clock. Can you beat that?
        </p>
        <div class="cb-dots" aria-hidden="true"><span *ngFor="let a of p.run.answers" [class.y]="a"></span></div>
        <div class="cb-actions">
          <button type="button" class="cb-go" (click)="accept(p.cityId)">Accept challenge</button>
          <button type="button" class="cb-later" (click)="links.dismiss()">Not now</button>
        </div>
      </ng-container>
    </div>
    <div class="cb cb-error" *ngIf="links.error() as err" role="status">
      <p class="cb-line">{{ err }}</p>
      <div class="cb-actions"><button type="button" class="cb-later" (click)="links.dismiss()">OK</button></div>
    </div>
  `,
  styles: [
    `
      .cb {
        position: fixed;
        z-index: 2000;
        left: 50%;
        top: calc(16px + env(safe-area-inset-top, 0px));
        transform: translateX(-50%);
        width: min(92vw, 440px);
        background: #fff6dc;
        color: #1a1410;
        border: 3px solid #1a1410;
        border-radius: 8px;
        box-shadow: 6px 6px 0 #000;
        padding: 14px 16px;
        font-family: Arial, sans-serif;
        animation: cb-in 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
      }
      .cb-kicker {
        font-family: 'Bangers', Impact, sans-serif;
        font-size: 22px;
        letter-spacing: 0.04em;
        color: #c0392b;
      }
      .cb-line { margin: 4px 0 8px; line-height: 1.4; }
      .cb-dots { display: flex; gap: 4px; margin-bottom: 10px; }
      .cb-dots span { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #1a1410; background: #ff5a4f; }
      .cb-dots span.y { background: #2bd17a; }
      .cb-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .cb-go, .cb-later {
        font: bold 14px Arial, sans-serif;
        border: 2.5px solid #1a1410;
        border-radius: 6px;
        padding: 8px 14px;
        cursor: pointer;
      }
      .cb-go { background: #ffe23a; box-shadow: 3px 3px 0 #1a1410; }
      .cb-later { background: #fff; }
      @keyframes cb-in { from { transform: translate(-50%, -30px); opacity: 0; } }
      @media (prefers-reduced-motion: reduce) { .cb { animation: none; } }
    `,
  ],
})
export class ChallengeBannerComponent {
  constructor(public links: ChallengeLinkService, private router: Router) {}

  accept(cityId: string) {
    this.links.accept();
    void this.router.navigate(cityId ? ['/city', cityId] : ['/']);
  }
}
