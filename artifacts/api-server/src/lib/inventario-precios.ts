import { roundMoney } from "./preferencias";

export type CalculoPrecio = {
  costo: number;
  tipo: "producto" | "servicio";
  metodo: "margen" | "recargo";
  margen: number;
  factor?: number;
  incluyeIva: boolean;
  iva: number;
  pvp?: number | null;
  pvpIncluyeIva: boolean;
};
/** Unit cost is always net; never divide a purchase invoice's unit cost by IVA. */
export function calcularPrecios(d: CalculoPrecio, decimales: number) {
  const net = d.tipo === "servicio" ? d.costo * (d.factor ?? 1)
    : d.metodo === "margen" ? d.costo / (1 - d.margen / 100) : d.costo * (1 + d.margen / 100);
  if (!Number.isFinite(net) || net < 0 || net > 1e12 || d.iva < 0 || d.iva > 100) throw new Error("Precio sugerido fuera de rango.");
  const neto = roundMoney(net, decimales);
  const montoIva = d.incluyeIva ? roundMoney(neto * d.iva / 100, decimales) : 0;
  const final = roundMoney(neto + montoIva, decimales);
  if (final > 1e12) throw new Error("Precio final fuera de rango.");
  const pvpNeto = d.pvp == null ? null : d.pvpIncluyeIva ? d.pvp / (1 + d.iva / 100) : d.pvp;
  const pvpFinal = pvpNeto == null ? null : roundMoney(d.incluyeIva
    ? d.pvpIncluyeIva ? d.pvp! : pvpNeto + roundMoney(pvpNeto * d.iva / 100, decimales)
    : pvpNeto, decimales);
  return {
    neto, montoIva, final, pvpNeto, pvpFinal,
    pvpUtilidad: pvpNeto == null ? null : pvpNeto - d.costo,
    pvpMargen: pvpNeto == null || pvpNeto <= 0 ? null : (pvpNeto - d.costo) / pvpNeto * 100,
  };
}
