-- CreateTable
CREATE TABLE "Relacion" (
    "id" TEXT NOT NULL,
    "origenId" TEXT NOT NULL,
    "destinoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descripcion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Relacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Relacion_origenId_idx" ON "Relacion"("origenId");

-- CreateIndex
CREATE INDEX "Relacion_destinoId_idx" ON "Relacion"("destinoId");

-- CreateIndex
CREATE UNIQUE INDEX "Relacion_origenId_destinoId_tipo_key" ON "Relacion"("origenId", "destinoId", "tipo");

-- AddForeignKey
ALTER TABLE "Relacion" ADD CONSTRAINT "Relacion_origenId_fkey" FOREIGN KEY ("origenId") REFERENCES "ItemConfiguracion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relacion" ADD CONSTRAINT "Relacion_destinoId_fkey" FOREIGN KEY ("destinoId") REFERENCES "ItemConfiguracion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
