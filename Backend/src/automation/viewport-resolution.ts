/**
 * Resolução do monitor (área total) vs tamanho da janela do Chromium.
 *
 * A configuração viewportPreset / viewportWidth / viewportHeight representa
 * a resolução do MONITOR onde os navegadores serão organizados — NÃO o
 * tamanho de cada janela individual.
 */

export type ViewportPresetName =
  | 'DESKTOP_1366x768'
  | 'HD'
  | 'FULLHD'
  | 'QHD'
  | 'CUSTOM'
  | string;

/** Área total do monitor disponível para organizar janelas. */
export interface MonitorResolution {
  width: number;
  height: number;
}

/** Tamanho da janela do Chromium (slot visual). */
export interface AutomationBrowserWindowSize {
  width: number;
  height: number;
}

/** @deprecated Use MonitorResolution — mantido para compatibilidade. */
export type ResolutionSize = MonitorResolution;

/** Dimensões concretas associadas a cada preset (exceto CUSTOM). */
export const VIEWPORT_PRESET_SIZES: Record<
  'DESKTOP_1366x768' | 'HD' | 'FULLHD' | 'QHD',
  MonitorResolution
> = {
  DESKTOP_1366x768: { width: 1366, height: 768 },
  HD: { width: 1280, height: 720 },
  FULLHD: { width: 1920, height: 1080 },
  QHD: { width: 2560, height: 1440 },
};

export interface ViewportSettingsLike {
  viewportPreset?: string | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
}

/**
 * Resolve a resolução do MONITOR configurada na tela de Configurações.
 * NÃO deve ser usada como tamanho de cada janela do Chromium.
 */
export function resolveMonitorResolutionFromSettings(
  config: ViewportSettingsLike | null | undefined
): MonitorResolution {
  if (
    config?.viewportPreset === 'CUSTOM' &&
    config.viewportWidth &&
    config.viewportHeight &&
    config.viewportWidth > 0 &&
    config.viewportHeight > 0
  ) {
    return {
      width: Math.floor(config.viewportWidth),
      height: Math.floor(config.viewportHeight),
    };
  }

  switch (config?.viewportPreset) {
    case 'DESKTOP_1366x768':
      return { ...VIEWPORT_PRESET_SIZES.DESKTOP_1366x768 };
    case 'HD':
      return { ...VIEWPORT_PRESET_SIZES.HD };
    case 'QHD':
      return { ...VIEWPORT_PRESET_SIZES.QHD };
    case 'FULLHD':
    default:
      return { ...VIEWPORT_PRESET_SIZES.FULLHD };
  }
}

/**
 * @deprecated Use resolveMonitorResolutionFromSettings.
 * Mantido para não quebrar imports existentes.
 */
export function resolveViewportFromSettings(
  config: ViewportSettingsLike | null | undefined
): MonitorResolution {
  return resolveMonitorResolutionFromSettings(config);
}
