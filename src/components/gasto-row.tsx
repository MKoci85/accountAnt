"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";

export function GastoRow({
  id,
  children,
}: {
  id: number;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => router.push(`/gastos/${id}`)}
    >
      {children}
    </TableRow>
  );
}
