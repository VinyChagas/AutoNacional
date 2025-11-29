import { Routes } from '@angular/router';
import { LayoutComponent } from './components/layout/layout.component';
import { HomeComponent } from './components/home/home.component';
import { CertificadoUploadComponent } from './components/certificado-upload/certificado-upload.component';
import { ExecucaoComponent } from './components/execucao/execucao.component';
import { ConfiguracoesComponent } from './components/configuracoes/configuracoes.component';

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
        path: 'certificados',
        component: CertificadoUploadComponent,
        data: { animation: 'certificados' }
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
      }
    ]
  }
];
