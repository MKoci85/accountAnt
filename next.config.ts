import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // IP de LAN desde la que se accede en dev (celular, etc.) para probar cámara/QR
  // sin el warning de "cross origin request". Se define por env var porque es
  // particular de cada red local, no algo que tenga sentido commitear.
  allowedDevOrigins: process.env.DEV_LAN_IP ? [process.env.DEV_LAN_IP] : [],
  // `unpdf` empaqueta pdfjs y no está en la lista de externals que Next trae de
  // fábrica (a diferencia de `better-sqlite3`). Se deja declarado a propósito:
  // el build actual pasa igual, pero el bundling de pdfjs es frágil y este es
  // el mecanismo soportado para que se resuelva en runtime, no en el bundle.
  serverExternalPackages: ["unpdf"],
};

export default nextConfig;
