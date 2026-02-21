"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.openNativeFolderPicker = openNativeFolderPicker;
/**
 * Abre seletor nativo de pasta e retorna o caminho absoluto.
 * Usa comandos do SO: osascript (Mac), PowerShell (Windows), zenity/kdialog (Linux).
 */
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const execAsync = (0, util_1.promisify)(child_process_1.exec);
async function openNativeFolderPicker() {
    const platform = os.platform();
    try {
        if (platform === 'darwin') {
            const { stdout } = await execAsync(`osascript -e 'POSIX path of (choose folder with prompt "Selecione a pasta")'`, { timeout: 60000 });
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
            }
            finally {
                await fs.unlink(scriptPath).catch(() => { });
            }
        }
        if (platform === 'linux') {
            try {
                const { stdout } = await execAsync('zenity --file-selection --directory --title="Selecione a pasta"', { timeout: 60000 });
                return stdout.trim() || null;
            }
            catch {
                try {
                    const { stdout } = await execAsync('kdialog --getexistingdirectory . --title "Selecione a pasta"', { timeout: 60000 });
                    return stdout.trim() || null;
                }
                catch {
                    return null;
                }
            }
        }
        return null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=native-folder-picker.js.map