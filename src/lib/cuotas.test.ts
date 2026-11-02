import { describe, expect, it } from "vitest";
import {
  ajustarPlan,
  cuotaParaLinea,
  cuotasEsperadas,
  gruposDeCompra,
  interesImplicito,
  pareceCompraEntera,
  planDeCuotas,
  recalcularPendientes,
  repartoDeCuota,
  tarjetaCompatible,
  type CompraParaCruce,
  type CuotaDeCompra,
  type LineaParaEsperar,
} from "@/lib/cuotas";

const suma = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

function cuotas(importes: number[], pagadas: Record<number, number> = {}) {
  return importes.map((importeCalculado, i) => ({
    numero: i + 1,
    importeCalculado,
    importePagado: pagadas[i + 1] ?? null,
    pagada: pagadas[i + 1] !== undefined,
  }));
}

describe("planDeCuotas", () => {
  it("divide el total en partes iguales cuando no hay recargo", () => {
    expect(planDeCuotas(24000, 4, 0)).toEqual([6000, 6000, 6000, 6000]);
  });

  it("aplica el recargo sobre el precio", () => {
    expect(planDeCuotas(1000, 2, 10)).toEqual([550, 550]);
  });

  it("la última cuota absorbe el redondeo y la suma da exacta", () => {
    const plan = planDeCuotas(1000, 3, 0);
    expect(plan).toEqual([333.33, 333.33, 333.34]);
    expect(suma(plan)).toBe(1000);
  });
});

describe("interesImplicito", () => {
  it("deduce el recargo de lo que se termina pagando", () => {
    expect(interesImplicito(1000, 1100)).toBe(10);
    expect(interesImplicito(1000, 1000)).toBe(0);
  });
});

describe("recalcularPendientes", () => {
  it("reparte lo que falta del total financiado entre las cuotas sin pagar", () => {
    const plan = recalcularPendientes(1200, 0, cuotas([400, 400, 400], { 1: 400 }));
    expect(plan.map((c) => c.importeCalculado)).toEqual([400, 400, 400]);
  });

  it("al cambiar el total sólo se recalculan las que faltan", () => {
    const plan = recalcularPendientes(1500, 0, cuotas([400, 400, 400], { 1: 400 }));
    expect(plan.map((c) => c.importeCalculado)).toEqual([400, 550, 550]);
    expect(plan[0].importePagado).toBe(400);
  });
});

describe("ajustarPlan", () => {
  it("no ajusta si el cobro difiere sólo por redondeo", () => {
    const r = ajustarPlan(24000, 0, cuotas([6000, 6000, 6000, 6000], { 1: 6001.5 }));
    expect(r.ajustado).toBe(false);
    expect(r.cuotas.map((c) => c.importeCalculado)).toEqual([6000, 6000, 6000, 6000]);
  });

  it("si el banco cobró otra cosa, las que faltan pasan a valer lo cobrado y el recargo se deduce", () => {
    const r = ajustarPlan(24000, 0, cuotas([6000, 6000, 6000, 6000], { 1: 6150 }));
    expect(r.ajustado).toBe(true);
    expect(r.cuotas.map((c) => c.importeCalculado)).toEqual([6000, 6150, 6150, 6150]);
    expect(r.interesPct).toBe(2.5);
  });

  it("las cuotas pagadas conservan lo que se calculó y lo que se cobró", () => {
    const r = ajustarPlan(24000, 0, cuotas([6000, 6000, 6000, 6000], { 1: 6150 }));
    expect(r.cuotas[0]).toMatchObject({ importeCalculado: 6000, importePagado: 6150 });
  });

  it("mira la última cuota pagada: si ésa coincide no hay nada que ajustar", () => {
    const r = ajustarPlan(
      24000,
      2.5,
      cuotas([6000, 6150, 6150, 6150], { 1: 6150, 2: 6150 })
    );
    expect(r.ajustado).toBe(false);
  });
});

describe("repartoDeCuota", () => {
  const grupos = [
    { categoriaId: 1, esHormiga: false, monto: 3000 },
    { categoriaId: 2, esHormiga: true, monto: 1000 },
  ];

  it("reparte el capital en proporción a lo que pesa cada grupo en la compra", () => {
    const r = repartoDeCuota(grupos, 1000, 1000);
    expect(r.recargo).toBe(0);
    expect(r.lineas).toEqual([
      { categoriaId: 1, esHormiga: false, monto: 750 },
      { categoriaId: 2, esHormiga: true, monto: 250 },
    ]);
  });

  it("lo que se paga por encima del capital es recargo y va aparte", () => {
    const r = repartoDeCuota(grupos, 1100, 1000);
    expect(r.recargo).toBe(100);
    expect(suma(r.lineas.map((l) => l.monto))).toBe(1000);
  });

  it("el redondeo lo absorbe la última línea y la cuota suma exacta", () => {
    const r = repartoDeCuota(
      [
        { categoriaId: 1, esHormiga: false, monto: 1 },
        { categoriaId: 2, esHormiga: false, monto: 1 },
        { categoriaId: 3, esHormiga: false, monto: 1 },
      ],
      100,
      100
    );
    expect(suma(r.lineas.map((l) => l.monto))).toBe(100);
  });

  it("un cobro menor al capital no genera recargo negativo", () => {
    const r = repartoDeCuota(grupos, 900, 1000);
    expect(r.recargo).toBe(0);
    expect(suma(r.lineas.map((l) => l.monto))).toBe(900);
  });
});

describe("gruposDeCompra", () => {
  it("suma las líneas por categoría y marca hormiga", () => {
    expect(
      gruposDeCompra([
        { categoriaId: 1, esHormiga: false, monto: 10 },
        { categoriaId: 1, esHormiga: false, monto: 5.5 },
        { categoriaId: 1, esHormiga: true, monto: 2 },
      ])
    ).toEqual([
      { categoriaId: 1, esHormiga: false, monto: 15.5 },
      { categoriaId: 1, esHormiga: true, monto: 2 },
    ]);
  });
});

function cuotaDeCompra(
  id: number,
  numero: number,
  importeCalculado: number,
  pago?: { importe: number; fecha: string; gastoId: number }
): CuotaDeCompra {
  return {
    id,
    numero,
    importeCalculado,
    importePagado: pago?.importe ?? null,
    pagada: !!pago,
    gastoId: pago?.gastoId ?? null,
    fechaPago: pago?.fecha ?? null,
  };
}

function compra(parcial: Partial<CompraParaCruce> = {}): CompraParaCruce {
  return {
    compraId: 1,
    gastoId: 100,
    fecha: "2026-08-15",
    emisorId: 7,
    emisorNombre: "TIENDA",
    cantidad: 4,
    total: 24000,
    tarjeta: null,
    cuotas: [
      cuotaDeCompra(11, 1, 6000),
      cuotaDeCompra(12, 2, 6000),
      cuotaDeCompra(13, 3, 6000),
      cuotaDeCompra(14, 4, 6000),
    ],
    ...parcial,
  };
}

describe("tarjetaCompatible", () => {
  it("una compra sin tarjeta aprendida puede estar en cualquier estado de cuenta", () => {
    expect(tarjetaCompatible(null, "7041")).toBe(true);
    expect(tarjetaCompatible("7041", "7041")).toBe(true);
    expect(tarjetaCompatible("7041", "1234")).toBe(false);
  });
});

describe("cuotaParaLinea", () => {
  const linea = {
    fechaCompra: "2026-08-15",
    cuota: { numero: 2, total: 4 },
    montoPesos: 6000,
  };

  it("toma la misma cuota de la compra con esa fecha y esa cantidad de cuotas", () => {
    expect(cuotaParaLinea(linea, [compra()], null, new Set())?.cuota.id).toBe(12);
  });

  it("tolera un día de diferencia en la fecha de compra", () => {
    expect(
      cuotaParaLinea({ ...linea, fechaCompra: "2026-08-16" }, [compra()], null, new Set())
    ).not.toBeNull();
    expect(
      cuotaParaLinea({ ...linea, fechaCompra: "2026-08-18" }, [compra()], null, new Set())
    ).toBeNull();
  });

  it("el importe no decide: una cuota mal calculada igual se cruza", () => {
    expect(
      cuotaParaLinea({ ...linea, montoPesos: 6150 }, [compra()], null, new Set())
    ).not.toBeNull();
  });

  it("no toma una cuota pagada, tomada por otra línea, ni de otra tarjeta", () => {
    const pagada = compra({
      cuotas: [cuotaDeCompra(12, 2, 6000, { importe: 6000, fecha: "2026-09-30", gastoId: 5 })],
    });
    expect(cuotaParaLinea(linea, [pagada], null, new Set())).toBeNull();
    expect(cuotaParaLinea(linea, [compra()], null, new Set([12]))).toBeNull();
    expect(cuotaParaLinea(linea, [compra({ tarjeta: "1234" })], "7041", new Set())).toBeNull();
  });

  it("entre dos compras parecidas desempata por el importe", () => {
    const otra = compra({
      compraId: 2,
      cuotas: [cuotaDeCompra(22, 2, 3000)],
    });
    expect(
      cuotaParaLinea({ ...linea, montoPesos: 3000 }, [compra(), otra], null, new Set())
        ?.compra.compraId
    ).toBe(2);
  });
});

describe("pareceCompraEntera", () => {
  const linea = {
    fechaCompra: "2026-08-15",
    cuota: { numero: 1, total: 4 },
    montoPesos: 6000,
  };

  it("un gasto del día de la compra que vale cuota × cantidad es la compra entera", () => {
    expect(
      pareceCompraEntera({ fecha: "2026-08-15", total: 24000, mismoComercio: false }, linea)
    ).toEqual({ interesPct: 0 });
  });

  it("con recargo sólo lo acepta si es del mismo comercio, y deduce el recargo", () => {
    const conRecargo = { ...linea, montoPesos: 6150 };
    expect(
      pareceCompraEntera({ fecha: "2026-08-15", total: 24000, mismoComercio: false }, conRecargo)
    ).toBeNull();
    expect(
      pareceCompraEntera({ fecha: "2026-08-15", total: 24000, mismoComercio: true }, conRecargo)
    ).toEqual({ interesPct: 2.5 });
  });

  it("no toma un gasto de otra fecha ni uno que vale más que lo financiado", () => {
    expect(
      pareceCompraEntera({ fecha: "2026-08-20", total: 24000, mismoComercio: true }, linea)
    ).toBeNull();
    expect(
      pareceCompraEntera({ fecha: "2026-08-15", total: 30000, mismoComercio: true }, linea)
    ).toBeNull();
  });
});

function lineaEsperar(parcial: Partial<LineaParaEsperar> & { indice: number }): LineaParaEsperar {
  return {
    descripcion: "COMPRA",
    fechaCompra: "2026-09-10",
    montoPesos: 100,
    cuota: null,
    cuotaAsignadaId: null,
    gastoExistenteId: null,
    ...parcial,
  };
}

describe("cuotasEsperadas", () => {
  const estado = { corte: "2026-09-30", tarjeta: null };

  it("una compra sin ninguna línea en el estado de cuenta espera su siguiente cuota", () => {
    const [esperada] = cuotasEsperadas([compra()], estado, []);
    expect(esperada).toMatchObject({ cuotaId: 11, numero: 1, tipo: "faltante" });
  });

  it("no espera nada de una compra cuya cuota ya tomó una línea", () => {
    expect(
      cuotasEsperadas([compra()], estado, [lineaEsperar({ indice: 0, cuotaAsignadaId: 11 })])
    ).toEqual([]);
  });

  it("una línea ya registrada contra el gasto de una cuota también cuenta como de la compra", () => {
    const pagada = compra({
      cuotas: [
        cuotaDeCompra(11, 1, 6000, { importe: 6000, fecha: "2026-09-30", gastoId: 50 }),
        cuotaDeCompra(12, 2, 6000),
      ],
    });
    expect(
      cuotasEsperadas([pagada], estado, [lineaEsperar({ indice: 0, gastoExistenteId: 50 })])
    ).toEqual([]);
  });

  it("si se pagó una cuota posterior, las anteriores son de un estado de cuenta sin importar", () => {
    const esperadas = cuotasEsperadas([compra()], estado, [
      lineaEsperar({ indice: 0, cuotaAsignadaId: 13 }),
    ]);
    expect(esperadas.map((e) => [e.numero, e.tipo])).toEqual([
      [1, "sin_registrar"],
      [2, "sin_registrar"],
    ]);
  });

  it("la primera cuota de una compra de días antes del cierre puede venir en el próximo", () => {
    const [esperada] = cuotasEsperadas([compra({ fecha: "2026-09-27" })], estado, []);
    expect(esperada.tipo).toBe("puede_venir");
  });

  it("ignora compras posteriores al corte, de otra tarjeta o con un pago posterior", () => {
    expect(cuotasEsperadas([compra({ fecha: "2026-10-05" })], estado, [])).toEqual([]);
    expect(
      cuotasEsperadas([compra({ tarjeta: "1234" })], { ...estado, tarjeta: "7041" }, [])
    ).toEqual([]);
    const pagadaDespues = compra({
      cuotas: [
        cuotaDeCompra(11, 1, 6000, { importe: 6000, fecha: "2026-10-31", gastoId: 50 }),
        cuotaDeCompra(12, 2, 6000),
      ],
    });
    expect(cuotasEsperadas([pagadaDespues], estado, [])).toEqual([]);
  });

  it("propone primero la línea más parecida y dice en qué no coincide", () => {
    const [esperada] = cuotasEsperadas([compra()], estado, [
      lineaEsperar({ indice: 0, descripcion: "OTRA", montoPesos: 50 }),
      lineaEsperar({
        indice: 1,
        fechaCompra: "2026-08-15",
        cuota: { numero: 1, total: 4 },
        montoPesos: 6150,
      }),
    ]);
    expect(esperada.candidatos[0].indice).toBe(1);
    expect(esperada.candidatos[0].motivos.join(" ")).toMatch(/importe distinto/);
  });

  it("una línea sin marca de cuota se ofrece igual, diciendo que no la tiene", () => {
    const [esperada] = cuotasEsperadas([compra()], estado, [
      lineaEsperar({ indice: 0, fechaCompra: "2026-08-15", montoPesos: 6000 }),
    ]);
    expect(esperada.candidatos).toEqual([
      { indice: 0, motivos: ["no tiene marca de cuota"] },
    ]);
  });

  it("no ofrece líneas que ya son otra cosa", () => {
    const [esperada] = cuotasEsperadas([compra()], estado, [
      lineaEsperar({ indice: 0, montoPesos: 6000, gastoExistenteId: 9 }),
    ]);
    expect(esperada.candidatos).toEqual([]);
  });
});
