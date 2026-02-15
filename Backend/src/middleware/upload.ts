/**
 * Multer: upload multipart para certificados e importações.
 */
import multer from 'multer';
import { Request } from 'express';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES_ARRAY = 50;

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES_ARRAY,
  },
  fileFilter(
    _req: Request,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback
  ) {
    const ext = (file.originalname || '').toLowerCase();
    if (ext.endsWith('.pfx') || ext.endsWith('.p12')) {
      cb(null, true);
      return;
    }
    cb(null, true); // Aceita outros para imports (planilhas, etc.)
  },
});

/** Upload de um único arquivo (ex.: certificado) */
export const uploadSingle = (field = 'certificado') =>
  upload.single(field);

/** Upload de múltiplos arquivos (ex.: lote de certificados) */
export const uploadArray = (field = 'certificados', maxCount = MAX_FILES_ARRAY) =>
  upload.array(field, maxCount);

/** Upload de planilha (Excel) */
export const uploadPlanilha = (field = 'arquivo') =>
  upload.single(field);
