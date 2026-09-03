export const FORMATOS_PROVEEDOR_CFE = [
  "scanntech",
  "taface",
  "sicfe",
  "otro",
] as const;
export type FormatoProveedorCfe = (typeof FORMATOS_PROVEEDOR_CFE)[number];

export type Procesador = {
  id: FormatoProveedorCfe;
  nombre: string;
  soportado: boolean;
  urlEjemplo?: string;
};

export const PROCESADORES_CONOCIDOS: Procesador[] = [
  {
    id: "scanntech",
    nombre: "Scanntech",
    soportado: true,
    urlEjemplo: "https://efactura.scanntech.com/products.eticket.consultaQR/",
  },
  {
    id: "taface",
    nombre: "Taface",
    soportado: true,
    urlEjemplo: "https://consulta.taface.com.uy/wpcomprobanteview.aspx",
  },
  { id: "sicfe", nombre: "SICFE / FEMI", soportado: false },
];

export function buscarProcesador(id: string): Procesador | undefined {
  return PROCESADORES_CONOCIDOS.find((p) => p.id === id);
}
