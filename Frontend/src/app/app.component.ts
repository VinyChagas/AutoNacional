import { Component } from '@angular/core';
import { CertificadoUploadComponent } from './components/certificado-upload/certificado-upload.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CertificadoUploadComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  title = 'Frontend';
}