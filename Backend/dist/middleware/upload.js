"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadPlanilha = exports.uploadArray = exports.uploadSingle = void 0;
/**
 * Multer: upload multipart para certificados e importações.
 */
const multer_1 = __importDefault(require("multer"));
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES_ARRAY = 50;
const storage = multer_1.default.memoryStorage();
const upload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: MAX_FILES_ARRAY,
    },
    fileFilter(_req, file, cb) {
        const ext = (file.originalname || '').toLowerCase();
        if (ext.endsWith('.pfx') || ext.endsWith('.p12')) {
            cb(null, true);
            return;
        }
        cb(null, true); // Aceita outros para imports (planilhas, etc.)
    },
});
/** Upload de um único arquivo (ex.: certificado) */
const uploadSingle = (field = 'certificado') => upload.single(field);
exports.uploadSingle = uploadSingle;
/** Upload de múltiplos arquivos (ex.: lote de certificados) */
const uploadArray = (field = 'certificados', maxCount = MAX_FILES_ARRAY) => upload.array(field, maxCount);
exports.uploadArray = uploadArray;
/** Upload de planilha (Excel) */
const uploadPlanilha = (field = 'arquivo') => upload.single(field);
exports.uploadPlanilha = uploadPlanilha;
//# sourceMappingURL=upload.js.map