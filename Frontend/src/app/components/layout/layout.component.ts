import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, RouterOutlet, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { trigger, transition, style, query, animateChild, group, animate } from '@angular/animations';
import { SidebarService } from '../../services/sidebar.service';
import { Subscription } from 'rxjs';

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
      transition('* => contabilidades', [
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
      transition('contabilidades => *', [
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
export class LayoutComponent implements OnInit, OnDestroy {
  currentRoute = 'home';
  sidebarCollapsed: boolean;
  private sub?: Subscription;

  constructor(
    private router: Router,
    private sidebar: SidebarService,
  ) {
    // Detecta mudanças de rota
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: any) => {
        const url = event.urlAfterRedirects;
        
        if (url.includes('/home')) {
          this.currentRoute = 'home';
        } else if (url.includes('/empresas')) {
          this.currentRoute = 'empresas';
        } else if (url.includes('/execucao')) {
          this.currentRoute = 'execucao';
        } else if (url.includes('/contabilidades')) {
          this.currentRoute = 'contabilidades';
        } else if (url.includes('/configuracoes')) {
          this.currentRoute = 'configuracoes';
        }
      });
    this.sidebarCollapsed = this.sidebar.collapsed;
  }

  ngOnInit(): void {
    this.sub = this.sidebar.collapsedState.subscribe((v) => (this.sidebarCollapsed = v));
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  toggleSidebar(): void {
    this.sidebar.toggle();
  }

  getRouteOutletState(outlet: RouterOutlet) {
    return outlet.isActivated ? outlet.activatedRoute.snapshot.url[0]?.path || 'home' : 'home';
  }
}

