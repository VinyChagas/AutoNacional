"use strict";
/**
 * Resolução do monitor (área total) vs tamanho da janela do Chromium.
 *
 * A configuração viewportPreset / viewportWidth / viewportHeight representa
 * a resolução do MONITOR onde os navegadores serão organizados — NÃO o
 * tamanho de cada janela individual.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VIEWPORT_PRESET_SIZES = void 0;
exports.resolveMonitorResolutionFromSettings = resolveMonitorResolutionFromSettings;
exports.resolveViewportFromSettings = resolveViewportFromSettings;
/** Dimensões concretas associadas a cada preset (exceto CUSTOM). */
exports.VIEWPORT_PRESET_SIZES = {
    DESKTOP_1366x768: { width: 1366, height: 768 },
    HD: { width: 1280, height: 720 },
    FULLHD: { width: 1920, height: 1080 },
    QHD: { width: 2560, height: 1440 },
};
/**
 * Resolve a resolução do MONITOR configurada na tela de Configurações.
 * NÃO deve ser usada como tamanho de cada janela do Chromium.
 */
function resolveMonitorResolutionFromSettings(config) {
    if (config?.viewportPreset === 'CUSTOM' &&
        config.viewportWidth &&
        config.viewportHeight &&
        config.viewportWidth > 0 &&
        config.viewportHeight > 0) {
        return {
            width: Math.floor(config.viewportWidth),
            height: Math.floor(config.viewportHeight),
        };
    }
    switch (config?.viewportPreset) {
        case 'DESKTOP_1366x768':
            return { ...exports.VIEWPORT_PRESET_SIZES.DESKTOP_1366x768 };
        case 'HD':
            return { ...exports.VIEWPORT_PRESET_SIZES.HD };
        case 'QHD':
            return { ...exports.VIEWPORT_PRESET_SIZES.QHD };
        case 'FULLHD':
        default:
            return { ...exports.VIEWPORT_PRESET_SIZES.FULLHD };
    }
}
/**
 * @deprecated Use resolveMonitorResolutionFromSettings.
 * Mantido para não quebrar imports existentes.
 */
function resolveViewportFromSettings(config) {
    return resolveMonitorResolutionFromSettings(config);
}
//# sourceMappingURL=viewport-resolution.js.map