-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "previousPasswordHashes" TEXT[] DEFAULT ARRAY[]::TEXT[];
