import { notFound } from "next/navigation";
import {
  listarConversaciones,
  obtenerConversacion,
} from "@/app/actions/chat-ia";
import { obtenerProveedoresDisponiblesIA } from "@/app/actions/configuracion";
import { ChatIAView } from "@/components/chat-ia-view";
import { PageContainer } from "@/components/page-container";
import { Encabezado } from "@/app/reportes/asistente/page";

export const dynamic = "force-dynamic";

export default async function ConversacionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [conversacion, conversaciones, proveedores] = await Promise.all([
    obtenerConversacion(Number(id)),
    listarConversaciones(),
    obtenerProveedoresDisponiblesIA(),
  ]);
  if (!conversacion) notFound();

  return (
    <PageContainer maxWidth="6xl">
      <Encabezado />
      <ChatIAView
        conversaciones={conversaciones}
        conversacionActiva={conversacion}
        proveedores={proveedores.disponibles}
        proveedorActivo={proveedores.activo}
      />
    </PageContainer>
  );
}
