import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, RouterOutlet, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { trigger, transition, style, query, animateChild, group, animate } from '@angular/animations';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, RouterOutlet],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.scss'],
  animations: [
    trigger('routeAnimations', [
      transition('home => certificados', [
        query(':enter, :leave', [
          style({
            position: 'relative',
            width: '100%'
          })
        ], { optional: true }),
        query(':enter', [
          style({ transform: 'translateX(100%)', opacity: 0 })
        ], { optional: true }),
        query(':leave', animateChild(), { optional: true }),
        group([
          query(':leave', [
            animate('400ms ease-in-out', style({ transform: 'translateX(-100%)', opacity: 0 }))
          ], { optional: true }),
          query(':enter', [
            animate('400ms ease-in-out', style({ transform: 'translateX(0%)', opacity: 1 }))
          ], { optional: true })
        ]),
        query(':enter', animateChild(), { optional: true }),
      ]),
      transition('certificados => home', [
        query(':enter, :leave', [
          style({
            position: 'relative',
            width: '100%'
          })
        ], { optional: true }),
        query(':enter', [
          style({ transform: 'translateX(-100%)', opacity: 0 })
        ], { optional: true }),
        query(':leave', animateChild(), { optional: true }),
        group([
          query(':leave', [
            animate('400ms ease-in-out', style({ transform: 'translateX(100%)', opacity: 0 }))
          ], { optional: true }),
          query(':enter', [
            animate('400ms ease-in-out', style({ transform: 'translateX(0%)', opacity: 1 }))
          ], { optional: true })
        ]),
        query(':enter', animateChild(), { optional: true }),
      ]),
      transition('certificados => execucao', [
        query(':enter, :leave', [
          style({
            position: 'relative',
            width: '100%'
          })
        ], { optional: true }),
        query(':enter', [
          style({ transform: 'translateX(100%)', opacity: 0 })
        ], { optional: true }),
        query(':leave', animateChild(), { optional: true }),
        group([
          query(':leave', [
            animate('400ms ease-in-out', style({ transform: 'translateX(-100%)', opacity: 0 }))
          ], { optional: true }),
          query(':enter', [
            animate('400ms ease-in-out', style({ transform: 'translateX(0%)', opacity: 1 }))
          ], { optional: true })
        ]),
        query(':enter', animateChild(), { optional: true }),
      ]),
      transition('execucao => certificados', [
        query(':enter, :leave', [
          style({
            position: 'relative',
            width: '100%'
          })
        ], { optional: true }),
        query(':enter', [
          style({ transform: 'translateX(-100%)', opacity: 0 })
        ], { optional: true }),
        query(':leave', animateChild(), { optional: true }),
        group([
          query(':leave', [
            animate('400ms ease-in-out', style({ transform: 'translateX(100%)', opacity: 0 }))
          ], { optional: true }),
          query(':enter', [
            animate('400ms ease-in-out', style({ transform: 'translateX(0%)', opacity: 1 }))
          ], { optional: true })
        ]),
        query(':enter', animateChild(), { optional: true }),
      ]),
      transition('home => execucao', [
        query(':enter, :leave', [
          style({
            position: 'relative',
            width: '100%'
          })
        ], { optional: true }),
        query(':enter', [
          style({ transform: 'translateX(100%)', opacity: 0 })
        ], { optional: true }),
        query(':leave', animateChild(), { optional: true }),
        group([
          query(':leave', [
            animate('400ms ease-in-out', style({ transform: 'translateX(-100%)', opacity: 0 }))
          ], { optional: true }),
          query(':enter', [
            animate('400ms ease-in-out', style({ transform: 'translateX(0%)', opacity: 1 }))
          ], { optional: true })
        ]),
        query(':enter', animateChild(), { optional: true }),
      ]),
      transition('execucao => home', [
        query(':enter, :leave', [
          style({
            position: 'relative',
            width: '100%'
          })
        ], { optional: true }),
        query(':enter', [
          style({ transform: 'translateX(-100%)', opacity: 0 })
        ], { optional: true }),
        query(':leave', animateChild(), { optional: true }),
        group([
          query(':leave', [
            animate('400ms ease-in-out', style({ transform: 'translateX(100%)', opacity: 0 }))
          ], { optional: true }),
          query(':enter', [
            animate('400ms ease-in-out', style({ transform: 'translateX(0%)', opacity: 1 }))
          ], { optional: true })
        ]),
        query(':enter', animateChild(), { optional: true }),
      ]),
    ])
  ]
})
export class LayoutComponent {
  currentRoute = 'home';

  constructor(private router: Router) {
    // Detecta mudanças de rota
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: any) => {
        const url = event.urlAfterRedirects;
        
        if (url.includes('/home')) {
          this.currentRoute = 'home';
        } else if (url.includes('/certificados')) {
          this.currentRoute = 'certificados';
        } else if (url.includes('/execucao')) {
          this.currentRoute = 'execucao';
        } else if (url.includes('/configuracoes')) {
          this.currentRoute = 'configuracoes';
        }
      });
  }

  getRouteOutletState(outlet: RouterOutlet) {
    return outlet.isActivated ? outlet.activatedRoute.snapshot.url[0]?.path || 'home' : 'home';
  }
}

