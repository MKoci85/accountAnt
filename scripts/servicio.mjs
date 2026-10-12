import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Levanta la app (`next start`) y el webhook de WhatsApp como dos procesos
 * hijos, para que un solo servicio de Windows alcance para los dos. Siguen
 * siendo procesos separados: el webhook no comparte memoria con la app, que es
 * lo que lo hace seguro de publicar.
 *
 * Si cualquiera de los dos se cae, se corta el otro y este proceso termina con
 * error: reiniciar es trabajo del servicio, que así los vuelve a levantar
 * juntos en vez de dejar uno solo andando sin que nadie lo note.
 */

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

const PROCESOS = [
  { nombre: "app", args: [join("node_modules", "next", "dist", "bin", "next"), "start"] },
  { nombre: "webhook", args: [join("webhook", "servidor.mjs")] },
];

let terminando = false;

const hijos = PROCESOS.map(({ nombre, args }) => {
  const hijo = spawn(process.execPath, args, { cwd: RAIZ, stdio: "inherit" });
  hijo.on("error", (e) => {
    console.error(`Servicio: no se pudo iniciar ${nombre}: ${e.message}`);
    terminar(1);
  });
  hijo.on("exit", (codigo, senal) => {
    if (terminando) return;
    console.error(`Servicio: ${nombre} terminó (${senal ?? `código ${codigo}`}); se corta todo.`);
    terminar(1);
  });
  return hijo;
});

function terminar(codigo) {
  if (terminando) return;
  terminando = true;
  for (const hijo of hijos) {
    if (hijo.exitCode === null && hijo.signalCode === null) hijo.kill();
  }
  process.exitCode = codigo;
}

for (const senal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  process.on(senal, () => terminar(0));
}
