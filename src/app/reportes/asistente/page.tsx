import Link from "next/link";
import { listarConversaciones } from "@/app/actions/chat-ia";
import { obtenerProveedoresDisponiblesIA } from "@/app/actions/configuracion";
import { ChatIAView } from "@/components/chat-ia-view";
import { PageContainer } from "@/components/page-container";

export const dynamic = "force-dynamic";

export default async function AsistentePage() {
  const [conversaciones, proveedores] = await Promise.all([
    listarConversaciones(),
    obtenerProveedoresDisponiblesIA(),
  ]);

  return (
    <PageContainer maxWidth="6xl">
      <Encabezado />
      <ChatIAView
        conversaciones={conversaciones}
        conversacionActiva={null}
        proveedores={proveedores.disponibles}
        proveedorActivo={proveedores.activo}
      />
    </PageContainer>
  );
}

export function Encabezado() {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/reportes" className="hover:text-foreground">
          Reportes
        </Link>
        <span>/</span>
        <span className="font-medium text-foreground">Asistente</span>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Conversá sobre tus gastos con el proveedor de IA que elijas al empezar
        cada conversación. Adjuntale un reporte para que razone sobre esos
        números.
      </p>
    </div>
  );
}
