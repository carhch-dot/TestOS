-- CreateTable
CREATE TABLE "ItemConfiguracion" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "dominioPropietario" TEXT,
    "direccionRed" TEXT,
    "tipo" TEXT NOT NULL,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemConfiguracion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemConfiguracion_nombre_key" ON "ItemConfiguracion"("nombre");

-- CreateIndex
CREATE INDEX "ItemConfiguracion_tipo_idx" ON "ItemConfiguracion"("tipo");
