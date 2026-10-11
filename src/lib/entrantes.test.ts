import { describe, expect, it } from "vitest";
import {
  claveComprobante,
  entrantesEnConflicto,
  esDeMesAnterior,
  motivoDeRevision,
  parsearItemsEntrante,
} from "@/lib/entrantes";

describe("claveComprobante", () => {
  it("identifica el comprobante por RUC, tipo, serie y número, sin monto ni fecha", () => {
    const base = {
      ruc: "210000000019",
      tipoCfe: "101",
      serie: "A",
      numero: "123",
      monto: "100.00",
      fecha: "01/10/2026",
      hash: "abc",
    };
    expect(claveComprobante(base)).toBe("210000000019|101|A|123");
    expect(
      claveComprobante({ ...base, monto: "999", fecha: "02/10/2026", hash: "x" })
    ).toBe(claveComprobante(base));
    expect(claveComprobante({ ...base, numero: "124" })).not.toBe(
      claveComprobante(base)
    );
  });
});

describe("parsearItemsEntrante", () => {
  it("lee los ítems guardados", () => {
    const json = JSON.stringify([
      {
        nombre: "COCA COLA 1,5 LT",
        precio: 120,
        tamano: "1,5 LT",
        unidades: 2,
        pesoTicket: null,
        precioPorKiloTicket: null,
      },
    ]);
    expect(parsearItemsEntrante(json)).toEqual([
      {
        nombre: "COCA COLA 1,5 LT",
        precio: 120,
        tamano: "1,5 LT",
        unidades: 2,
        pesoTicket: null,
        precioPorKiloTicket: null,
      },
    ]);
  });

  it("completa con null los campos opcionales que falten", () => {
    expect(parsearItemsEntrante('[{"nombre":"PAN","precio":50}]')).toEqual([
      {
        nombre: "PAN",
        precio: 50,
        tamano: null,
        unidades: null,
        pesoTicket: null,
        precioPorKiloTicket: null,
      },
    ]);
  });

  it("descarta filas sin nombre o sin precio numérico", () => {
    const json = JSON.stringify([
      { nombre: "", precio: 10 },
      { nombre: "SIN PRECIO" },
      { nombre: "PRECIO TEXTO", precio: "10" },
      null,
      { nombre: "OK", precio: 10 },
    ]);
    expect(parsearItemsEntrante(json).map((i) => i.nombre)).toEqual(["OK"]);
  });

  it("un JSON corrupto o con otra forma es una lista vacía, no un error", () => {
    expect(parsearItemsEntrante("{no es json")).toEqual([]);
    expect(parsearItemsEntrante('{"items":[]}')).toEqual([]);
  });
});

describe("esDeMesAnterior", () => {
  const hoy = new Date(2026, 9, 10); // 10 de octubre de 2026

  it("usa la fecha del comprobante", () => {
    const recibidoEn = "2026-10-05T12:00:00.000Z";
    expect(esDeMesAnterior({ fecha: "2026-09-30", recibidoEn }, hoy)).toBe(true);
    expect(esDeMesAnterior({ fecha: "2026-10-01", recibidoEn }, hoy)).toBe(false);
    expect(esDeMesAnterior({ fecha: "2025-12-31", recibidoEn }, hoy)).toBe(true);
  });

  it("sin fecha legible cuenta el día en que llegó", () => {
    expect(
      esDeMesAnterior({ fecha: null, recibidoEn: "2026-09-15T12:00:00.000Z" }, hoy)
    ).toBe(true);
    expect(
      esDeMesAnterior({ fecha: null, recibidoEn: "2026-10-02T12:00:00.000Z" }, hoy)
    ).toBe(false);
  });

  it("un comprobante viejo recibido este mes sigue siendo de un mes anterior", () => {
    expect(
      esDeMesAnterior(
        { fecha: "2026-09-28", recibidoEn: "2026-10-02T12:00:00.000Z" },
        hoy
      )
    ).toBe(true);
  });
});

describe("motivoDeRevision", () => {
  const linea = { catalogada: true, cantidad: 1, precio: 100 };
  const limpio = {
    lectura: "qr" as const,
    aviso: null,
    total: 250,
    lineas: [linea, { catalogada: true, cantidad: 2, precio: 75 }],
  };

  it("se guarda solo cuando no queda nada por decidir", () => {
    expect(motivoDeRevision(limpio)).toBeNull();
  });

  it("tolera hasta $1 de diferencia con el total, no más", () => {
    expect(motivoDeRevision({ ...limpio, total: 250.9 })).toBeNull();
    expect(motivoDeRevision({ ...limpio, total: 252 })).toMatch(/no coincide/);
  });

  it("una lectura con IA nunca se guarda sola, aunque todo cierre", () => {
    expect(motivoDeRevision({ ...limpio, lectura: "link" })).toMatch(/IA/);
    expect(motivoDeRevision({ ...limpio, lectura: "ticket" })).toMatch(/IA/);
  });

  it("un aviso del proveedor o de moneda manda a revisión con ese texto", () => {
    expect(motivoDeRevision({ ...limpio, aviso: "Está en USD" })).toBe(
      "Está en USD"
    );
  });

  it("un ítem sin reconocer alcanza para frenar", () => {
    expect(
      motivoDeRevision({
        ...limpio,
        lineas: [linea, { catalogada: false, cantidad: 2, precio: 75 }],
      })
    ).toBe("Hay 1 ítem sin reconocer.");
  });

  it("sin detalle, sin total o con una línea sin precio no se guarda", () => {
    expect(motivoDeRevision({ ...limpio, lineas: [] })).toMatch(/detalle/);
    expect(motivoDeRevision({ ...limpio, total: null })).toMatch(/total/);
    expect(
      motivoDeRevision({ ...limpio, lineas: [{ ...linea, precio: 0 }] })
    ).toMatch(/sin precio/);
  });

  it("un total o un precio que no es un número nunca pasa por bueno", () => {
    expect(motivoDeRevision({ ...limpio, total: NaN })).toMatch(/total/);
    expect(
      motivoDeRevision({ ...limpio, lineas: [{ ...linea, precio: NaN }] })
    ).toMatch(/sin precio/);
    expect(
      motivoDeRevision({ ...limpio, lineas: [{ ...linea, cantidad: NaN }] })
    ).toMatch(/sin precio/);
  });
});

describe("entrantesEnConflicto", () => {
  const tolerancia = { dias: 1, monto: 2 };
  const movimientos = [
    { indice: 0, fecha: "2026-09-10", montoPesos: 1240 },
    { indice: 1, fecha: "2026-09-20", montoPesos: 350 },
    { indice: 2, fecha: "2026-09-25", montoPesos: null },
  ];
  const entrante = {
    id: 1,
    fecha: "2026-09-10",
    recibidoEn: "2026-09-10T15:00:00.000Z",
    total: 1240,
  };

  it("choca con el movimiento de mismo monto y misma fecha", () => {
    expect(entrantesEnConflicto(movimientos, [entrante], tolerancia)).toEqual([
      { entranteId: 1, movimientos: [0], sinDatos: false },
    ]);
  });

  it("tolera un día y $2, igual que el match contra gastos", () => {
    const corrido = { ...entrante, fecha: "2026-09-11", total: 1241.5 };
    expect(entrantesEnConflicto(movimientos, [corrido], tolerancia)).toHaveLength(1);
  });

  it("no choca si el monto o la fecha quedan fuera de la tolerancia", () => {
    expect(
      entrantesEnConflicto(movimientos, [{ ...entrante, total: 1250 }], tolerancia)
    ).toEqual([]);
    expect(
      entrantesEnConflicto(
        movimientos,
        [{ ...entrante, fecha: "2026-09-13" }],
        tolerancia
      )
    ).toEqual([]);
  });

  it("un comprobante sin total o sin fecha choca si cae dentro del período", () => {
    const sinTotal = { ...entrante, id: 2, fecha: "2026-09-15", total: null };
    const sinFecha = {
      id: 3,
      fecha: null,
      recibidoEn: "2026-09-18T15:00:00.000Z",
      total: 99,
    };
    expect(
      entrantesEnConflicto(movimientos, [sinTotal, sinFecha], tolerancia)
    ).toEqual([
      { entranteId: 2, movimientos: [], sinDatos: true },
      { entranteId: 3, movimientos: [], sinDatos: true },
    ]);
  });

  it("un comprobante sin datos de otro período no frena nada", () => {
    const viejo = { ...entrante, fecha: "2026-07-01", total: null };
    expect(entrantesEnConflicto(movimientos, [viejo], tolerancia)).toEqual([]);
  });

  it("sin movimientos por importar no hay conflicto posible", () => {
    expect(entrantesEnConflicto([], [entrante], tolerancia)).toEqual([]);
  });
});
