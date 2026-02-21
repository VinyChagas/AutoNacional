/**
 * Abre seletor nativo de pasta e retorna o caminho absoluto.
 * Usa comandos do SO: osascript (Mac), PowerShell (Windows), zenity/kdialog (Linux).
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

export async function openNativeFolderPicker(): Promise<string | null> {
  const platform = os.platform();

  try {
    if (platform === 'darwin') {
      const { stdout } = await execAsync(
        `osascript -e 'POSIX path of (choose folder with prompt "Selecione a pasta")'`,
        { timeout: 60000 }
      );
      return stdout.trim() || null;
    }

    if (platform === 'win32') {
      const scriptContent = `
Add-Type -AssemblyName System.Windows.Forms
$folder = New-Object System.Windows.Forms.FolderBrowserDialog
$folder.Description = "Selecione a pasta"
$folder.ShowNewFolderButton = $true
if ($folder.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $folder.SelectedPath
}
`;
      const tmpDir = os.tmpdir();
      const scriptPath = path.join(tmpDir, `select-folder-${Date.now()}.ps1`);
      await fs.writeFile(scriptPath, scriptContent, 'utf8');
      try {
        const { stdout } = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, {
          timeout: 60000,
        });
        return stdout.trim() || null;
      } finally {
        await fs.unlink(scriptPath).catch(() => {});
      }
    }

    if (platform === 'linux') {
      try {
        const { stdout } = await execAsync(
          'zenity --file-selection --directory --title="Selecione a pasta"',
          { timeout: 60000 }
        );
        return stdout.trim() || null;
      } catch {
        try {
          const { stdout } = await execAsync(
            'kdialog --getexistingdirectory . --title "Selecione a pasta"',
            { timeout: 60000 }
          );
          return stdout.trim() || null;
        } catch {
          return null;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}
