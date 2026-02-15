import { Routes } from '@angular/router';
import { LayoutComponent } from './components/layout/layout.component';
import { HomeComponent } from './components/home/home.component';
import { ExecucaoComponent } from './components/execucao/execucao.component';
import { ConfiguracoesComponent } from './components/configuracoes/configuracoes.component';
import { ContabilidadesComponent } from './components/contabilidades/contabilidades.component';
import { EmpresasComponent } from './components/empresas/empresas.component';

export const routes: Routes = [
  {
    path: '',
    component: LayoutComponent,
    children: [
      {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full'
      },
      {
        path: 'home',
        component: HomeComponent,
        data: { animation: 'home' }
      },
      {
        path: 'empresas',
        component: EmpresasComponent,
        data: { animation: 'empresas' }
      },
      {
        path: 'certificados',
        redirectTo: 'empresas',
        pathMatch: 'full'
      },
      {
        path: 'credenciais',
        redirectTo: 'empresas',
        pathMatch: 'full'
      },
      {
        path: 'execucao',
        component: ExecucaoComponent,
        data: { animation: 'execucao' }
      },
      {
        path: 'configuracoes',
        component: ConfiguracoesComponent,
        data: { animation: 'configuracoes' }
      },
      {
        path: 'contabilidades',
        component: ContabilidadesComponent,
        data: { animation: 'contabilidades' }
      }
    ]
  }
];
