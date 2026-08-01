/**
 * Resolução do monitor (área total) vs tamanho da janela do Chromium.
 *
 * A configuração viewportPreset / viewportWidth / viewportHeight representa
 * a resolução do MONITOR onde os navegadores serão organizados — NÃO o
 * tamanho de cada janela individual.
 */
export type ViewportPresetName = 'DESKTOP_1366x768' | 'HD' | 'FULLHD' | 'QHD' | 'CUSTOM' | string;
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
export declare const VIEWPORT_PRESET_SIZES: Record<'DESKTOP_1366x768' | 'HD' | 'FULLHD' | 'QHD', MonitorResolution>;
export interface ViewportSettingsLike {
    viewportPreset?: string | null;
    viewportWidth?: number | null;
    viewportHeight?: number | null;
}
/**
 * Resolve a resolução do MONITOR configurada na tela de Configurações.
 * NÃO deve ser usada como tamanho de cada janela do Chromium.
 */
export declare function resolveMonitorResolutionFromSettings(config: ViewportSettingsLike | null | undefined): MonitorResolution;
/**
 * @deprecated Use resolveMonitorResolutionFromSettings.
 * Mantido para não quebrar imports existentes.
 */
export declare function resolveViewportFromSettings(config: ViewportSettingsLike | null | undefined): MonitorResolution;
//# sourceMappingURL=viewport-resolution.d.ts.map