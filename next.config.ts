import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "win.burro-cordylus.ts.net",
    ...(process.env.DEV_LAN_IP ? [process.env.DEV_LAN_IP] : []),
  ],
  // `unpdf` empaqueta pdfjs y no está en la lista de externals que Next trae de
  // fábrica (a diferencia de `better-sqlite3`). Se deja declarado a propósito:
  // el build actual pasa igual, pero el bundling de pdfjs es frágil y este es
  // el mecanismo soportado para que se resuelva en runtime, no en el bundle.
  serverExternalPackages: ["unpdf"],
};

export default nextConfig;
