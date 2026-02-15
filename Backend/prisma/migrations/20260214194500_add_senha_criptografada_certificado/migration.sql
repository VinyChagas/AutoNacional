-- AlterTable
ALTER TABLE "certificados_digitais" ADD COLUMN IF NOT EXISTS "senha_criptografada" TEXT;
