-- CreateEnum
CREATE TYPE "UsuarioRole" AS ENUM ('ADMINISTRATOR', 'MANAGER', 'EDITOR', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "UsuarioStatus" AS ENUM ('ACTIVE', 'PENDING_VERIFICATION', 'DEACTIVATED');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UsuarioRole" NOT NULL,
    "status" "UsuarioStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");
